<?php

namespace App\Identity;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;

final class Accounts
{
    public const FIELDS = ['name', 'username', 'email', 'phone', 'links', 'about'];

    public function current(Request $request): object
    {
        $session = $request->attributes->get('identity');
        abort_unless($session, 401);

        $account = DB::table('identity_accounts')->find($session->account_id) ?? abort(401);
        abort_if(AccountLifecycle::unavailable($account), 410);

        return $account;
    }

    public function profile(object $account): array
    {
        return json_decode(Crypt::decryptString($account->profile), true, flags: JSON_THROW_ON_ERROR);
    }

    public function own(object $account): array
    {
        return ['rootKey' => $account->public_key, 'id' => $account->id, 'publicId' => $account->public_id, ...$this->profile($account), 'username' => $account->username, 'revision' => $account->revision, 'matrix' => ['state' => $account->matrix_state, 'userId' => $account->matrix_state === 'ready' ? app(MatrixBridge::class)->mxid($account->id) : null]];
    }

    public function challenge(Request $request): array
    {
        $data = $request->validate(['purpose' => 'required|in:register,login,recover', 'publicId' => 'required_if:purpose,login|string|max:32', 'rootKey' => 'required_if:purpose,register,recover|string|max:256', 'deviceId' => 'required|uuid', 'deviceKey' => 'required_unless:purpose,login|string|max:256', 'name' => 'required|string|max:80']);
        $bucket = 'identity:challenge:'.hash('sha256', (string) $request->ip());
        abort_if(RateLimiter::tooManyAttempts($bucket, 30), 429);
        RateLimiter::hit($bucket, 60);
        if ($data['purpose'] !== 'login') {
            Proof::publicKey($data['rootKey']);
        }
        if ($data['purpose'] !== 'login') {
            Proof::publicKey($data['deviceKey']);
        }
        $id = (string) Str::uuid();
        $nonce = bin2hex(random_bytes(32));
        $message = "photobunker.identity.v1\n".$data['purpose']."\n".$id."\n".$nonce."\n".hash('sha256', Proof::canonical($data));
        DB::table('identity_challenges')->insert(['id' => $id, 'purpose' => $data['purpose'], 'payload' => json_encode($data), 'message' => $message, 'expires_at' => now()->addMinutes(2)]);

        return ['id' => $id, 'nonce' => $nonce, 'message' => $message, 'expiresAt' => now()->addMinutes(2)->getTimestampMs()];
    }

    public function authenticate(Request $request): array
    {
        $data = $request->validate(['challengeId' => 'required|uuid', 'signature' => 'required|string|max:128']);
        $bucket = 'identity:proof:'.hash('sha256', (string) $request->ip());
        abort_if(RateLimiter::tooManyAttempts($bucket, 30), 429);
        RateLimiter::hit($bucket, 60);

        return DB::transaction(function () use ($data): array {
            $challenge = DB::table('identity_challenges')->where('id', $data['challengeId'])->lockForUpdate()->first();
            abort_unless($challenge && ! $challenge->consumed_at && strtotime($challenge->expires_at) > time(), 401);
            $payload = json_decode($challenge->payload, true, flags: JSON_THROW_ON_ERROR);
            $account = $challenge->purpose !== 'login'
                ? DB::table('identity_accounts')->where('key_fingerprint', hash('sha256', $payload['rootKey']))->lockForUpdate()->first()
                : DB::table('identity_accounts')->where('public_id', $payload['publicId'])->lockForUpdate()->first();
            $device = DB::table('identity_devices')->where('id', $payload['deviceId'])->lockForUpdate()->first();
            $key = $challenge->purpose === 'login' ? ($device && $account && $device->account_id === $account->id && ! $device->revoked_at ? $device->public_key : null) : ($challenge->purpose === 'register' ? $payload['rootKey'] : $account?->public_key);
            abort_unless($key && Proof::verify($key, $challenge->message, $data['signature']), 401);
            if (! $account) {
                abort_unless($challenge->purpose === 'register', 401);
                $id = (string) Str::uuid();
                $profile = ['fields' => array_fill_keys(self::FIELDS, ''), 'visibility' => array_fill_keys(self::FIELDS, 'private')];
                DB::table('identity_accounts')->insertOrIgnore(['id' => $id, 'public_id' => 'pb_'.strtolower(Str::random(16)), 'key_fingerprint' => hash('sha256', $payload['rootKey']), 'public_key' => $payload['rootKey'], 'profile' => Crypt::encryptString(json_encode($profile)), 'revision' => 1, 'matrix_password' => Crypt::encryptString(bin2hex(random_bytes(32))), 'matrix_state' => 'pending', 'created_at' => now(), 'updated_at' => now()]);
                $account = DB::table('identity_accounts')->where('key_fingerprint', hash('sha256', $payload['rootKey']))->lockForUpdate()->first();
                abort_unless($account, 409);
            }
            abort_if(AccountLifecycle::unavailable($account), 410);
            app(AccountLifecycle::class)->activity($account->id);
            if ($device) {
                abort_unless($device->account_id === $account->id && ! $device->revoked_at, 409);
                if ($challenge->purpose !== 'login') {
                    abort_unless(hash_equals($device->public_key, $payload['deviceKey']), 409);
                }
                DB::table('identity_devices')->where('id', $device->id)->update(['name' => trim($payload['name']), 'last_seen_at' => now(), 'updated_at' => now()]);
            } else {
                abort_if($challenge->purpose === 'login', 401);
                DB::table('identity_devices')->insert(['id' => $payload['deviceId'], 'account_id' => $account->id, 'public_key' => $payload['deviceKey'], 'name' => trim($payload['name']), 'created_at' => now(), 'updated_at' => now(), 'last_seen_at' => now()]);
            }
            DB::table('identity_challenges')->where('id', $challenge->id)->update(['consumed_at' => now()]);
            $token = bin2hex(random_bytes(32));
            $expires = null;
            DB::table('identity_sessions')->insert(['token_hash' => hash('sha256', $token), 'device_id' => $payload['deviceId'], 'expires_at' => $expires, 'created_at' => now()]);

            return ['account' => $this->own($account), 'deviceId' => $payload['deviceId'], 'expiresAt' => null, 'cookie' => $token];
        });
    }

    public function blocked(string $first, string $second): bool
    {
        return DB::table('identity_blocks')->where(fn ($q) => $q->where('account_id', $first)->where('blocked_id', $second))->orWhere(fn ($q) => $q->where('account_id', $second)->where('blocked_id', $first))->exists();
    }

    public function lockPair(string $first, string $second): void
    {
        foreach (DB::table('identity_accounts')->whereIn('id', [$first, $second])->orderBy('id')->lockForUpdate()->get() as $account) {
            abort_if(AccountLifecycle::unavailable($account), 404);
        }
    }

    public function pair(string $first, string $second): string
    {
        $ids = [$first, $second];
        sort($ids);

        return implode(':', $ids);
    }

    public function byHandle(string $handle): ?object
    {
        if (preg_match('/^@pb_([a-f0-9]{32}):'.preg_quote(config('identity.matrix_server'), '/').'$/D', $handle, $match)) {
            $hex = $match[1];

            return DB::table('identity_accounts')->find(substr($hex, 0, 8).'-'.substr($hex, 8, 4).'-'.substr($hex, 12, 4).'-'.substr($hex, 16, 4).'-'.substr($hex, 20));
        }

        return str_starts_with($handle, '@')
            ? DB::table('identity_accounts')->where('username', strtolower(substr($handle, 1)))->first()
            : DB::table('identity_accounts')->where('public_id', $handle)->first();
    }

    public function person(object $account, string $viewer, bool $showOwnBlock = false): array
    {
        abort_if(AccountLifecycle::unavailable($account), 404);
        $ownBlock = DB::table('identity_blocks')->where('account_id', $viewer)->where('blocked_id', $account->id)->exists();
        abort_if(DB::table('identity_blocks')->where('account_id', $account->id)->where('blocked_id', $viewer)->exists() || $ownBlock && ! $showOwnBlock, 404);
        $relation = DB::table('identity_address_book')->where('account_id', $viewer)->where('contact_id', $account->id)->first();
        $viewerIsContact = DB::table('identity_address_book')->where('account_id', $account->id)->where('contact_id', $viewer)->exists();
        $profile = $this->profile($account);
        $fields = [];
        foreach (self::FIELDS as $field) {
            $visibility = $profile['visibility'][$field] ?? 'private';
            if ($account->id === $viewer || $visibility === 'public' || $visibility === 'contacts' && ! $ownBlock && $viewerIsContact) {
                $fields[$field] = $profile['fields'][$field];
            }
        }

        return ['publicId' => $account->public_id, 'username' => $account->username, 'fields' => $fields, 'self' => $account->id === $viewer, 'blocked' => $ownBlock, 'relationship' => $relation ? ['id' => $relation->id, 'state' => 'accepted', 'incoming' => false] : null];
    }
}
