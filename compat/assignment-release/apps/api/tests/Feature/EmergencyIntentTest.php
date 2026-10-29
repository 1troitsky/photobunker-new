<?php

namespace Tests\Feature;

use App\Encrypted\Protocol;
use App\Identity\AccountLifecycle;
use App\Identity\Accounts;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Factory;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

final class EmergencyIntentTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['identity.enabled' => true]);
        Http::preventStrayRequests();
        Storage::fake(config('prototype.disk'));
        RateLimiter::clear('identity:emergency:intent:'.hash('sha256', '127.0.0.1'));
        $this->withCredentials()->withHeaders(['X-PhotoBunker' => 'identity-v1', 'Origin' => 'http://localhost:8080']);
    }

    /** ONLY ephemeral synthetic testing keys/accounts, never a real identity. */
    private function key(): array
    {
        $private = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'prime256v1']);
        $this->assertNotFalse($private);
        $pem = openssl_pkey_get_details($private)['key'];
        $der = base64_decode(preg_replace('/-----[^-]+-----|\s/', '', $pem));

        return [$private, rtrim(strtr(base64_encode($der), '+/', '-_'), '=')];
    }

    private function identity(): array
    {
        $id = (string) Str::uuid();
        $device = (string) Str::uuid();
        $token = bin2hex(random_bytes(32));
        DB::table('identity_accounts')->insert([
            'id' => $id, 'public_id' => 'pb_'.strtolower(Str::random(16)),
            'public_key' => 'synthetic-root', 'key_fingerprint' => hash('sha256', $id),
            'profile' => Crypt::encryptString(json_encode([
                'fields' => array_fill_keys(Accounts::FIELDS, ''),
                'visibility' => array_fill_keys(Accounts::FIELDS, 'private'),
            ])),
            'matrix_password' => Crypt::encryptString('synthetic-only'),
            'created_at' => now(), 'updated_at' => now(),
            'last_active_at' => now(), 'inactivity_delete_at' => now()->addDays(180),
        ]);
        DB::table('identity_devices')->insert([
            'id' => $device, 'account_id' => $id, 'public_key' => 'synthetic-device',
            'name' => 'Synthetic device', 'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('identity_sessions')->insert([
            'token_hash' => hash('sha256', $token), 'device_id' => $device, 'created_at' => now(),
        ]);
        $this->withUnencryptedCookie('pb_identity', $token);

        return ['accountId' => $id, 'deviceId' => $device, 'token' => $token];
    }

    private function register(array $who, string $public, int $rev = 0, ?string $op = null, ?string $keyId = null): array
    {
        $data = [
            'operationId' => $op ?? (string) Str::uuid(),
            'keyId' => $keyId ?? (string) Str::uuid(),
            'publicKey' => $public, 'expectedRevision' => $rev,
        ];
        $this->withUnencryptedCookie('pb_identity', $who['token'])
            ->putJson('/api/v1/identity/emergency/key', $data)->assertOk()
            ->assertJsonPath('active', true)->assertJsonPath('revision', $rev + 1);

        return $data;
    }

    private function intent(array $who, array $key): array
    {
        return [
            'version' => 1, 'operationId' => (string) Str::uuid(),
            'accountId' => $who['accountId'], 'keyId' => $key['keyId'],
            'revision' => $key['expectedRevision'] + 1, 'action' => 'emergency-delete',
        ];
    }

    /** Convert test-only OpenSSL DER ECDSA to WebCrypto P1363 bytes. */
    private function signature($private, array $intent): string
    {
        $ok = openssl_sign(Protocol::message('emergency-delete', $intent), $der, $private, OPENSSL_ALGO_SHA256);
        $this->assertTrue($ok);
        $i = 2;
        $this->assertSame(2, ord($der[$i++]));
        $rLen = ord($der[$i++]);
        $r = substr($der, $i, $rLen);
        $i += $rLen;
        $this->assertSame(2, ord($der[$i++]));
        $sLen = ord($der[$i++]);
        $s = substr($der, $i, $sLen);
        $raw = str_pad(ltrim($r, "\0"), 32, "\0", STR_PAD_LEFT).
            str_pad(ltrim($s, "\0"), 32, "\0", STR_PAD_LEFT);

        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }

    private function send(array $intent, string $signature)
    {
        // No authenticated cookie; credential-independent by design.
        $this->withUnencryptedCookie('pb_identity', '');

        return $this->postJson('/api/v1/identity/emergency/intent', [
            'intent' => Protocol::canonical($intent), 'signature' => $signature,
        ]);
    }

    public function test_signed_intent_without_cookie_revokes_only_synthetic_a_and_replay_is_one_claim(): void
    {
        $a = $this->identity();
        [$private, $public] = $this->key();
        $k = $this->register($a, $public);
        $b = $this->identity();
        $payload = $this->intent($a, $k);
        $sig = $this->signature($private, $payload);
        $this->send($payload, $sig)->assertStatus(202)->assertJsonPath('state', 'accepted');
        $this->assertDatabaseHas('identity_accounts', [
            'id' => $a['accountId'], 'deletion_reason' => 'emergency',
        ]);
        $this->assertDatabaseHas('identity_emergency_receipts', [
            'operation_id' => $payload['operationId'], 'account_id' => $a['accountId'],
        ]);
        $this->assertDatabaseHas('identity_accounts', [
            'id' => $b['accountId'], 'deletion_requested_at' => null,
        ]);
        $this->assertDatabaseMissing('identity_sessions', ['device_id' => $a['deviceId']]);
        $this->send($payload, $sig)->assertStatus(202)->assertJsonPath('state', 'processing');
        $this->assertSame(1, DB::table('identity_emergency_receipts')->where('account_id', $a['accountId'])->count());
        $second = $this->intent($a, $k);
        $this->send($second, $this->signature($private, $second))->assertGone();
        $this->assertSame(1, DB::table('identity_emergency_receipts')->where('account_id', $a['accountId'])->count());
    }

    public function test_tampered_payload_signature_account_or_operation_uuid_does_not_claim(): void
    {
        $a = $this->identity();
        [$private, $public] = $this->key();
        $key = $this->register($a, $public);
        $b = $this->identity();
        $payload = $this->intent($a, $key);
        $signature = $this->signature($private, $payload);
        foreach ([
            [...$payload, 'accountId' => $b['accountId']],
            [...$payload, 'keyId' => (string) Str::uuid()],
            [...$payload, 'revision' => 200],
        ] as $tampered) {
            $this->send($tampered, $signature)->assertForbidden();
        }
        $this->send([...$payload, 'operationId' => (string) Str::uuid()], $signature)
            ->assertUnprocessable();
        $this->send($payload, $signature)->assertStatus(202);
        $this->send([...$payload, 'revision' => 2], $signature)->assertConflict();
        $this->send([...$payload, 'keyId' => (string) Str::uuid()], $signature)->assertConflict();
        $this->assertDatabaseHas('identity_accounts', ['id' => $b['accountId'], 'deletion_requested_at' => null]);
        $this->assertSame(1, DB::table('identity_emergency_receipts')->count());
    }

    public function test_key_rotation_revokes_old_key_and_disable_revokes_new_key(): void
    {
        $a = $this->identity();
        [$first, $firstPub] = $this->key();
        [$second, $secondPub] = $this->key();
        $one = $this->register($a, $firstPub);
        $two = $this->register($a, $secondPub, 1);
        $old = $this->intent($a, $one);
        $this->send($old, $this->signature($first, $old))->assertForbidden();
        $this->assertDatabaseHas('identity_accounts', ['id' => $a['accountId'], 'deletion_requested_at' => null]);

        $this->withUnencryptedCookie('pb_identity', $a['token'])
            ->deleteJson('/api/v1/identity/emergency/key', [
                'operationId' => (string) Str::uuid(), 'keyId' => $two['keyId'], 'revision' => 2,
            ])->assertOk()->assertJsonPath('active', false);
        $new = $this->intent($a, $two);
        $this->send($new, $this->signature($second, $new))->assertForbidden();
        $this->assertDatabaseHas('identity_accounts', ['id' => $a['accountId'], 'deletion_requested_at' => null]);
    }

    public function test_register_lost_ack_is_idempotent_and_changed_key_id_is_conflict(): void
    {
        $a = $this->identity();
        [, $public] = $this->key();
        $op = (string) Str::uuid();
        $id = (string) Str::uuid();
        $one = $this->register($a, $public, 0, $op, $id);
        $this->register($a, $public, 0, $op, $id);
        $this->withUnencryptedCookie('pb_identity', $a['token'])
            ->putJson('/api/v1/identity/emergency/key', [...$one,
                'keyId' => (string) Str::uuid()])->assertConflict();
        $this->assertSame(1, DB::table('identity_emergency_keys')->where('account_id', $a['accountId'])->count());
    }

    public function test_pending_cleanup_never_reports_completed_and_worker_can_retry(): void
    {
        $a = $this->identity();
        [$private, $public] = $this->key();
        $key = $this->register($a, $public);
        $payload = $this->intent($a, $key);
        $sig = $this->signature($private, $payload);
        $this->send($payload, $sig)->assertStatus(202);
        Http::fake(fn () => Http::response([], 503));
        $this->assertFalse(app(AccountLifecycle::class)->erase($a['accountId']));
        $this->send($payload, $sig)->assertJsonPath('state', 'processing');
        $this->assertDatabaseHas('identity_emergency_receipts', [
            'operation_id' => $payload['operationId'], 'completed_at' => null,
        ]);
    }

    public function test_replay_remains_completed_after_synthetic_account_erasure(): void
    {
        $a = $this->identity();
        [$private, $public] = $this->key();
        $key = $this->register($a, $public);
        $payload = $this->intent($a, $key);
        $sig = $this->signature($private, $payload);
        $this->send($payload, $sig)->assertJsonPath('state', 'accepted');
        Http::swap(new Factory);
        Http::preventStrayRequests();
        Cache::put('matrix:'.hash('sha256', config('identity.matrix_url')).':admin:token',
            Crypt::encryptString('synthetic-admin'), now()->addHour());
        Http::fake(fn ($request) => str_ends_with($request->url(), '/account/whoami')
            ? Http::response(['user_id' => '@service:fixture'])
            : Http::response(['errcode' => 'M_NOT_FOUND'], 404));
        $this->assertTrue(app(AccountLifecycle::class)->erase($a['accountId']));
        $this->assertDatabaseMissing('identity_accounts', ['id' => $a['accountId']]);
        $this->send($payload, $sig)->assertJsonPath('state', 'completed');
        $this->assertDatabaseHas('identity_emergency_receipts', [
            'operation_id' => $payload['operationId'],
        ]);
        $this->assertSame(1, DB::table('identity_emergency_receipts')->count());
    }

    public function test_intent_rejects_noncanonical_bytes_and_same_origin_header_is_mandatory(): void
    {
        $a = $this->identity();
        [$private, $public] = $this->key();
        $key = $this->register($a, $public);
        $payload = $this->intent($a, $key);
        $sig = $this->signature($private, $payload);
        $this->withUnencryptedCookie('pb_identity', '')
            ->postJson('/api/v1/identity/emergency/intent', [
                'intent' => ' '.Protocol::canonical($payload), 'signature' => $sig,
            ])->assertUnprocessable();
        $this->withHeaders(['Origin' => 'https://attacker.invalid'])
            ->postJson('/api/v1/identity/emergency/intent', [
                'intent' => Protocol::canonical($payload), 'signature' => $sig,
            ])->assertForbidden();
        $this->assertDatabaseHas('identity_accounts', [
            'id' => $a['accountId'], 'deletion_requested_at' => null,
        ]);
    }
}
