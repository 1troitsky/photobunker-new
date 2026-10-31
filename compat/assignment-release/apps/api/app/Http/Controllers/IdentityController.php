<?php

namespace App\Http\Controllers;

use App\Identity\AccountLifecycle;
use App\Identity\Accounts;
use App\Identity\MatrixBridge;
use App\Rtc\Admissions;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\HttpException;

final class IdentityController extends Controller
{
    public function __construct(private readonly Accounts $accounts) {}

    public function challenge(Request $request)
    {
        return response()->json($this->accounts->challenge($request));
    }

    public function authenticate(Request $request)
    {
        $result = $this->accounts->authenticate($request);
        $token = $result['cookie'];
        unset($result['cookie']);

        return response()->json($result)->cookie('pb_identity', $token, config('identity.session_minutes'), '/api/v1/identity', null, str_starts_with((string) $request->header('Origin'), 'https://'), true, false, 'Strict');
    }

    public function me(Request $request)
    {
        $account = $this->accounts->current($request);

        return response()->json(['account' => $this->accounts->own($account), 'deviceId' => $request->attributes->get('identity')->device_id, 'expiresAt' => $request->attributes->get('identity')->expires_at ? strtotime($request->attributes->get('identity')->expires_at) * 1000 : null]);
    }

    public function profile(Request $request)
    {
        $account = $this->accounts->current($request);
        $rules = ['accountId' => 'required|uuid', 'revision' => 'required|integer|min:1', 'fields' => 'required|array:'.implode(',', Accounts::FIELDS), 'visibility' => 'required|array:'.implode(',', Accounts::FIELDS)];
        foreach (Accounts::FIELDS as $field) {
            $rules['fields.'.$field] = 'present|nullable|string|max:'.(in_array($field, ['links', 'about']) ? 1000 : 120);
            $rules['visibility.'.$field] = 'required|in:private,contacts,public';
        }
        $data = $request->validate($rules);
        abort_unless(hash_equals($account->id, $data['accountId']), 409);
        foreach ($data['fields'] as &$value) {
            $value = trim($value ?? '');
        } unset($value);
        $username = strtolower(ltrim($data['fields']['username'], '@'));
        abort_if($username !== '' && ! preg_match('/^[a-z][a-z0-9_-]{2,31}$/D', $username), 422);
        $data['fields']['username'] = $username;
        if ($username !== '') {
            $data['visibility']['username'] = 'public';
        }
        DB::transaction(function () use ($account, $data, $username): void {
            DB::table('identity_accounts')->where('id', $account->id)->lockForUpdate()->first();
            if ($username !== '' && DB::table('identity_accounts')->where('username', $username)->where('id', '!=', $account->id)->exists()) {
                throw new HttpResponseException(response()->json(['code' => 'username_taken'], 422));
            }
            try {
                $updated = DB::table('identity_accounts')->where('id', $account->id)->where('revision', $data['revision'])->update(['username' => $username ?: null, 'profile' => Crypt::encryptString(json_encode(['fields' => $data['fields'], 'visibility' => $data['visibility']])), 'revision' => $account->revision + 1, 'updated_at' => now()]);
            } catch (UniqueConstraintViolationException) {
                throw new HttpResponseException(response()->json(['code' => 'username_taken'], 422));
            }
            abort_unless($updated, 409);
        });

        return response()->json($this->accounts->own(DB::table('identity_accounts')->find($account->id)));
    }

    public function logout(Request $request, MatrixBridge $matrix)
    {
        $this->accounts->current($request);
        $id = $request->attributes->get('identity')->device_id;
        DB::transaction(function () use ($id): void {
            DB::table('identity_devices')->where('id', $id)->lockForUpdate()->first();
            DB::table('identity_sessions')->where('device_id', $id)->delete();
            DB::table('identity_presence_leases')->where('device_id', $id)->delete();
            DB::table('identity_devices')->where('id', $id)->update(['matrix_revoke_pending' => true]);
        });
        if (config('rtc.enabled')) {
            app(Admissions::class)->revokeDevice($id);
        }
        try {
            $matrix->revoke($id);
        } catch (\Throwable) {
        }

        return response()->json(['signedOut' => true])->withoutCookie('pb_identity', '/api/v1/identity');
    }

    public function devices(Request $request)
    {
        $account = $this->accounts->current($request);

        return response()->json(['devices' => DB::table('identity_devices')->where('account_id', $account->id)->get(['id', 'name', 'created_at', 'last_seen_at', 'revoked_at', 'matrix_revoke_pending'])]);
    }

    public function revoke(Request $request, string $id, MatrixBridge $matrix)
    {
        $account = $this->accounts->current($request);
        DB::transaction(function () use ($id, $account): void {
            $device = DB::table('identity_devices')->where('id', $id)->where('account_id', $account->id)->lockForUpdate()->first();
            abort_unless($device, 404);
            DB::table('identity_devices')->where('id', $id)->update(['revoked_at' => now(), 'matrix_revoke_pending' => true]);
            DB::table('identity_sessions')->where('device_id', $id)->delete();
            DB::table('identity_presence_leases')->where('device_id', $id)->delete();
        });
        if (config('rtc.enabled')) {
            app(Admissions::class)->revokeDevice($id);
        }
        try {
            $matrix->revoke($id);
        } catch (\Throwable) { /* Retryable intent remains durable. */
        }

        return response()->json(['revoked' => true, 'matrixPending' => (bool) DB::table('identity_devices')->where('id', $id)->value('matrix_revoke_pending')]);
    }

    public function matrix(Request $request, MatrixBridge $matrix)
    {
        $account = $this->accounts->current($request);
        try {
            $result = $matrix->session($account->id, $request->attributes->get('identity')->device_id);
        } catch (HttpException $error) {
            throw $error;
        } catch (\Throwable) {
            abort(503);
        }

        if (! DB::table('identity_sessions')->where('token_hash', hash('sha256', $request->cookie('pb_identity')))->where(fn ($q) => $q->whereNull('expires_at')->orWhere('expires_at', '>', now()))->exists()) {
            $id = $request->attributes->get('identity')->device_id;
            DB::transaction(function () use ($id, $result, $matrix): void {
                $device = DB::table('identity_devices')->where('id', $id)->lockForUpdate()->first();
                // An earlier logout already deleted this epoch. Never revoke its replacement.
                if ($device && $matrix->deviceId($device) === $result['deviceId']) {
                    DB::table('identity_devices')->where('id', $id)->update(['matrix_revoke_pending' => true]);
                }
            });
            try {
                $matrix->revoke($id);
            } catch (\Throwable) {
            } abort(401);
        }

        return response()->json($result);
    }

    public function provision(Request $request, MatrixBridge $matrix)
    {
        $account = $this->accounts->current($request);
        try {
            $matrix->provision($account->id);
        } catch (\Throwable) {
            abort(503);
        }

        return response()->json(['state' => 'ready']);
    }

    public function infrastructure(Request $request, MatrixBridge $matrix)
    {
        $this->accounts->current($request);

        return response()->json(['matrix' => ['ready' => $matrix->healthy(), 'serverName' => config('identity.matrix_server')], 'photos' => ['encrypted' => false, 'mode' => 'local-prototype']]);
    }

    public function person(Request $request, string $publicId)
    {
        $viewer = $this->accounts->current($request);
        $account = $this->accounts->byHandle($publicId);
        abort_unless($account, 404);

        return response()->json($this->accounts->person($account, $viewer->id, true));
    }

    public function contacts(Request $request)
    {
        $account = $this->accounts->current($request);
        $rows = DB::table('identity_address_book')->where('account_id', $account->id)->get();
        $contacts = [];
        foreach ($rows as $row) {
            $other = $row->contact_id;
            $person = DB::table('identity_accounts')->find($other);
            if ($person && ! AccountLifecycle::unavailable($person) && ! $this->accounts->blocked($account->id, $other)) {
                $contacts[] = $this->accounts->person($person, $account->id);
            }
        }
        $blocked = DB::table('identity_blocks')->join('identity_accounts', 'identity_accounts.id', '=', 'identity_blocks.blocked_id')->where('account_id', $account->id)->pluck('public_id');

        return response()->json(['contacts' => $contacts, 'blocked' => $blocked]);
    }

    public function requestContact(Request $request)
    {
        $account = $this->accounts->current($request);
        $data = $request->validate(['publicId' => 'required|string|max:32']);
        $other = DB::table('identity_accounts')->where('public_id', $data['publicId'])->first();
        abort_unless($other && $other->id !== $account->id && ! $this->accounts->blocked($account->id, $other->id), 404);
        DB::transaction(function () use ($account, $other): void {
            $this->accounts->lockPair($account->id, $other->id);
            abort_if($this->accounts->blocked($account->id, $other->id), 404);
            DB::table('identity_address_book')->insertOrIgnore(['id' => (string) Str::uuid(), 'account_id' => $account->id, 'contact_id' => $other->id, 'created_at' => now()]);
        });

        return response()->json($this->accounts->person($other, $account->id));
    }

    public function respond(Request $request, string $id)
    {
        $this->accounts->current($request);

        return response()->json(['code' => 'contact_requests_removed'], 410);
    }

    public function removeContact(Request $request, string $id)
    {
        $account = $this->accounts->current($request);
        $row = DB::table('identity_address_book')->where('id', $id)->where('account_id', $account->id)->first();
        abort_unless($row, 404);
        DB::transaction(function () use ($account, $row, $id): void {
            $this->accounts->lockPair($account->id, $row->contact_id);
            DB::table('identity_address_book')->where('id', $id)->where('account_id', $account->id)->delete();
        });

        return response()->json(['removed' => true]);
    }

    public function block(Request $request, string $publicId)
    {
        $account = $this->accounts->current($request);
        $other = DB::table('identity_accounts')->where('public_id', $publicId)->first();
        abort_unless($other && $other->id !== $account->id, 404);
        DB::transaction(function () use ($request, $account, $other): void {
            $this->accounts->lockPair($account->id, $other->id);
            if ($request->isMethod('DELETE')) {
                DB::table('identity_blocks')->where('account_id', $account->id)->where('blocked_id', $other->id)->delete();
            } else {
                DB::table('identity_blocks')->insertOrIgnore(['account_id' => $account->id, 'blocked_id' => $other->id, 'created_at' => now()]);
                DB::table('identity_address_book')->where('account_id', $account->id)->where('contact_id', $other->id)->delete();
                DB::table('identity_contacts')->where('pair_key', $this->accounts->pair($account->id, $other->id))->update(['state' => 'removed', 'updated_at' => now()]);
            }
        });

        return response()->json(['saved' => true]);
    }

    public function claim(Request $request)
    {
        $account = $this->accounts->current($request);
        $data = $request->validate(['libraryCode' => 'required|string|size:64']);
        $library = DB::table('prototype_libraries')->where('token_hash', hash('sha256', $data['libraryCode']))->first();
        abort_unless($library, 403);
        $claim = DB::table('identity_legacy_claims')->where('library_id', $library->id)->first();
        abort_if($claim && $claim->account_id !== $account->id, 409);
        DB::table('identity_legacy_claims')->insertOrIgnore(['library_id' => $library->id, 'account_id' => $account->id, 'created_at' => now()]);
        abort_unless(DB::table('identity_legacy_claims')->where('library_id', $library->id)->where('account_id', $account->id)->exists(), 409);

        return response()->json(['proofRecorded' => true, 'photosMigrated' => false]);
    }
}
