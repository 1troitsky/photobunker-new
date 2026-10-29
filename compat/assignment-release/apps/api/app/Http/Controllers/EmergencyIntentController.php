<?php

namespace App\Http\Controllers;

use App\Encrypted\Protocol;
use App\Identity\AccountLifecycle;
use App\Identity\Accounts;
use App\Identity\Proof;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class EmergencyIntentController extends Controller
{
    private function active(string $owner, string $device): ?object
    {
        return DB::table('identity_emergency_keys')->where('account_id', $owner)
            ->where('device_id', $device)->whereNull('revoked_at')->first();
    }

    public function show(Request $request, Accounts $accounts): array
    {
        $owner = $accounts->current($request)->id;
        $device = $request->attributes->get('identity')->device_id;
        $active = $this->active($owner, $device);
        $revision = (int) DB::table('identity_emergency_keys')->where('account_id', $owner)->where('device_id', $device)->max('revision');

        return ['keyId' => $active?->key_id, 'revision' => $revision,
            'active' => $active !== null, 'createdAt' => $active?->created_at];
    }

    public function register(Request $request, Accounts $accounts): array
    {
        $owner = $accounts->current($request)->id;
        $device = $request->attributes->get('identity')->device_id;
        Protocol::fields($request->all(), ['operationId', 'keyId', 'publicKey', 'expectedRevision']);
        $data = $request->validate([
            'operationId' => 'required|uuid', 'keyId' => 'required|uuid',
            'publicKey' => 'required|string|max:256', 'expectedRevision' => 'required|integer|min:0|max:1000000',
        ]);
        Proof::publicKey($data['publicKey']);
        $fingerprint = hash('sha256', Proof::canonical([
            'action' => 'register', 'accountId' => $owner, 'deviceId' => $device,
            'keyId' => $data['keyId'], 'publicKey' => $data['publicKey'],
            'expectedRevision' => (int) $data['expectedRevision'],
        ]));

        return DB::transaction(function () use ($owner, $device, $data, $fingerprint) {
            DB::table('identity_accounts')->where('id', $owner)->lockForUpdate()->first() ?? abort(410);
            abort_unless(DB::table('identity_devices')->where('id', $device)->where('account_id', $owner)->whereNull('revoked_at')->exists(), 403);
            $prior = DB::table('identity_emergency_operations')->where('operation_id', $data['operationId'])->first();
            if ($prior) {
                abort_unless($prior->account_id === $owner && $prior->device_id === $device &&
                    $prior->action === 'register' && hash_equals($prior->payload_hash, $fingerprint), 409);
                $key = DB::table('identity_emergency_keys')->where('key_id', $prior->key_id)->first();
                abort_unless($key, 409);

                return ['keyId' => $key->key_id, 'revision' => (int) $key->revision,
                    'active' => $key->revoked_at === null];
            }
            $current = $this->active($owner, $device);
            $revision = (int) DB::table('identity_emergency_keys')->where('account_id', $owner)->where('device_id', $device)->max('revision');
            abort_unless((int) $data['expectedRevision'] === $revision && $revision < 1000000, 409);
            abort_unless(! DB::table('identity_emergency_keys')->where('key_id', $data['keyId'])->exists(), 409);
            if ($current) {
                DB::table('identity_emergency_keys')->where('key_id', $current->key_id)->update(['revoked_at' => now()]);
            }
            $next = $revision + 1;
            DB::table('identity_emergency_keys')->insert([
                'key_id' => $data['keyId'], 'account_id' => $owner, 'device_id' => $device,
                'revision' => $next, 'public_key' => $data['publicKey'],
                'operation_id' => $data['operationId'], 'created_at' => now(),
            ]);
            DB::table('identity_emergency_operations')->insert([
                'operation_id' => $data['operationId'], 'account_id' => $owner,
                'device_id' => $device, 'key_id' => $data['keyId'],
                'action' => 'register', 'revision' => $next, 'payload_hash' => $fingerprint,
                'created_at' => now(),
            ]);

            return ['keyId' => $data['keyId'], 'revision' => $next, 'active' => true];
        });
    }

    public function disable(Request $request, Accounts $accounts): array
    {
        $owner = $accounts->current($request)->id;
        $device = $request->attributes->get('identity')->device_id;
        Protocol::fields($request->all(), ['operationId', 'keyId', 'revision']);
        $data = $request->validate([
            'operationId' => 'required|uuid', 'keyId' => 'required|uuid',
            'revision' => 'required|integer|min:1|max:1000000',
        ]);
        $fingerprint = hash('sha256', Proof::canonical([
            'action' => 'disable', 'accountId' => $owner, 'deviceId' => $device,
            'keyId' => $data['keyId'], 'revision' => (int) $data['revision'],
        ]));

        return DB::transaction(function () use ($owner, $device, $data, $fingerprint) {
            DB::table('identity_accounts')->where('id', $owner)->lockForUpdate()->first() ?? abort(410);
            $prior = DB::table('identity_emergency_operations')->where('operation_id', $data['operationId'])->first();
            if ($prior) {
                abort_unless($prior->account_id === $owner && $prior->device_id === $device &&
                    $prior->action === 'disable' && hash_equals($prior->payload_hash, $fingerprint), 409);

                return ['keyId' => $prior->key_id, 'revision' => (int) $prior->revision, 'active' => false];
            }
            $key = $this->active($owner, $device);
            abort_unless($key && $key->key_id === $data['keyId'] &&
                (int) $key->revision === (int) $data['revision'], 409);
            DB::table('identity_emergency_keys')->where('key_id', $key->key_id)->update(['revoked_at' => now()]);
            DB::table('identity_emergency_operations')->insert([
                'operation_id' => $data['operationId'], 'account_id' => $owner, 'device_id' => $device,
                'key_id' => $key->key_id, 'action' => 'disable', 'revision' => $key->revision,
                'payload_hash' => $fingerprint, 'created_at' => now(),
            ]);

            return ['keyId' => $key->key_id, 'revision' => (int) $key->revision, 'active' => false];
        });
    }

    private function result(object $receipt, bool $new = false): JsonResponse
    {
        $account = DB::table('identity_accounts')->where('id', $receipt->account_id)->first();
        $completed = $receipt->completed_at !== null || ! $account;
        $state = $completed ? 'completed' : ($new ? 'accepted' : 'processing');

        return response()->json(['operationId' => $receipt->operation_id, 'state' => $state], 202);
    }

    /** No session or device credential is required; only a previously registered
     * emergency signing key can authorize a new destructive AccountLifecycle claim.
     */
    public function intent(Request $request, AccountLifecycle $lifecycle): JsonResponse
    {
        // Laravel trims request strings before controllers run. Parse the raw body
        // here so whitespace added to the signed canonical intent cannot be
        // silently normalized into a valid destructive request.
        try {
            $data = json_decode($request->getContent(), true, 8, JSON_THROW_ON_ERROR);
        } catch (\Throwable) {
            abort(422);
        }
        abort_unless(is_array($data), 422);
        Protocol::fields($data, ['intent', 'signature']);
        abort_unless(is_string($data['intent']) && strlen($data['intent']) <= 1024 &&
            is_string($data['signature']) && strlen($data['signature']) <= 128, 422);
        $intent = Protocol::decode($data['intent'], 1024);
        Protocol::fields($intent, ['version', 'operationId', 'accountId', 'keyId', 'revision', 'action']);
        abort_unless($intent['version'] === 1 && $intent['action'] === 'emergency-delete' &&
            is_string($intent['operationId']) && Str::isUuid($intent['operationId']) &&
            is_string($intent['accountId']) && Str::isUuid($intent['accountId']) &&
            is_string($intent['keyId']) && Str::isUuid($intent['keyId']) &&
            is_int($intent['revision']) && $intent['revision'] >= 1 && $intent['revision'] <= 1000000, 422);
        $payloadHash = hash('sha256', $data['intent']);
        $signatureHash = hash('sha256', $data['signature']);
        $readReceipt = fn () => DB::table('identity_emergency_receipts')->where('operation_id', $intent['operationId'])->first();
        $existing = $readReceipt();
        if ($existing) {
            abort_unless($existing->account_id === $intent['accountId'] &&
                $existing->key_id === $intent['keyId'] &&
                (int) $existing->revision === $intent['revision'] &&
                hash_equals($existing->payload_hash, $payloadHash) &&
                hash_equals($existing->signature_hash, $signatureHash), 409);
            Protocol::p256('emergency-delete', $intent, $data['signature'], $existing->public_key);

            return $this->result($existing);
        }

        // No object removal in HTTP request. claim() owns the account write
        // cache lock and a DB transaction containing BOTH receipt and revokes.
        $claimed = $lifecycle->claim($intent['accountId'], false, 'emergency', function (object $account) use ($intent, $data, $payloadHash, $signatureHash): void {
            $key = DB::table('identity_emergency_keys')->where('key_id', $intent['keyId'])
                ->where('account_id', $account->id)->whereNull('revoked_at')->lockForUpdate()->first();
            abort_unless($key && (int) $key->revision === $intent['revision'], 403);
            $device = DB::table('identity_devices')->where('id', $key->device_id)
                ->where('account_id', $account->id)->whereNull('revoked_at')->first();
            abort_unless($device, 403);
            Protocol::p256('emergency-delete', $intent, $data['signature'], $key->public_key);
            DB::table('identity_emergency_receipts')->insert([
                'operation_id' => $intent['operationId'], 'account_id' => $account->id,
                'device_id' => $key->device_id, 'key_id' => $key->key_id,
                'revision' => $key->revision, 'payload_hash' => $payloadHash,
                'signature_hash' => $signatureHash, 'public_key' => $key->public_key,
                'accepted_at' => now(),
            ]);
            DB::table('identity_emergency_keys')->where('account_id', $account->id)
                ->whereNull('revoked_at')->update(['revoked_at' => now()]);
        });
        $receipt = $readReceipt();
        abort_unless($receipt, $claimed ? 503 : 410);

        return $this->result($receipt, $claimed);
    }
}
