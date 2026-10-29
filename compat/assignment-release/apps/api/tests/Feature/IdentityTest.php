<?php

namespace Tests\Feature;

use App\Encrypted\Protocol;
use App\Identity\Accounts;
use App\Identity\MatrixBridge;
use App\Identity\MatrixFailure;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

final class IdentityTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['identity.enabled' => true]);
        $this->withCredentials();
        $this->withHeaders(['X-PhotoBunker' => 'identity-v1', 'Origin' => 'http://localhost:8080']);
        Http::preventStrayRequests();
    }

    private function key(): array
    {
        $private = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'prime256v1']);
        $public = openssl_pkey_get_details($private)['key'];
        $der = base64_decode(preg_replace('/-----[^-]+-----|\s/', '', $public));

        return ['private' => $private, 'public' => rtrim(strtr(base64_encode($der), '+/', '-_'), '=')];
    }

    private function signature(string $message, array $key): string
    {
        openssl_sign($message, $signature, $key['private'], OPENSSL_ALGO_SHA256);
        $offset = 2;
        $parts = '';
        for ($i = 0; $i < 2; $i++) {
            $offset++;
            $length = ord($signature[$offset++]);
            $parts .= str_pad(ltrim(substr($signature, $offset, $length), "\0"), 32, "\0", STR_PAD_LEFT);
            $offset += $length;
        }

        return rtrim(strtr(base64_encode($parts), '+/', '-_'), '=');
    }

    private function authenticate(array $payload, array $key): array
    {
        $challenge = $this->postJson('/api/v1/identity/challenges', $payload)->assertOk()->json();
        $response = $this->postJson('/api/v1/identity/sessions', ['challengeId' => $challenge['id'], 'signature' => $this->signature($challenge['message'], $key)])->assertOk();
        $cookie = collect($response->headers->getCookies())->first(fn ($cookie) => $cookie->getName() === 'pb_identity');
        $this->assertTrue($cookie->isHttpOnly());
        $this->assertSame('strict', $cookie->getSameSite());
        $this->withUnencryptedCookie('pb_identity', $cookie->getValue());

        return [...$response->json(), 'token' => $cookie->getValue()];
    }

    private function create(): array
    {
        $root = $this->key();
        $device = $this->key();
        $id = (string) Str::uuid();
        $result = $this->authenticate(['purpose' => 'register', 'rootKey' => $root['public'], 'deviceKey' => $device['public'], 'deviceId' => $id, 'name' => 'Synthetic browser'], $root);

        return [...$result, 'root' => $root, 'device' => $device];
    }

    public function test_private_presence_never_exposes_activity_to_unilateral_or_blocked_viewers(): void
    {
        $alice = $this->create();
        $bob = $this->create();
        $a = $alice['account']['id'];
        $b = $bob['account']['id'];
        $handle = $alice['account']['publicId'];
        $route = '/api/v1/identity/presence/'.$handle;
        $instance = (string) Str::uuid();

        $this->getJson('/api/v1/identity/presence/privacy')
            ->assertOk()->assertExactJson(['visibility' => 'contacts', 'revision' => 0]);
        $this->withUnencryptedCookie('pb_identity', $alice['token']);
        $this->postJson('/api/v1/identity/presence/pulse', [
            'instanceId' => $instance, 'sequence' => 1, 'active' => true,
        ])->assertOk();
        $this->withUnencryptedCookie('pb_identity', $bob['token'])
            ->getJson($route)->assertOk()->assertExactJson(['state' => 'hidden']);
        // A unilateral address-book entry or unaccepted invite is NOT mutual.
        DB::table('identity_address_book')->insert([
            'id' => (string) Str::uuid(), 'account_id' => $b,
            'contact_id' => $a, 'created_at' => now(),
        ]);
        $this->getJson($route)->assertExactJson(['state' => 'hidden']);
        DB::table('identity_address_book')->insert([
            'id' => (string) Str::uuid(), 'account_id' => $a,
            'contact_id' => $b, 'created_at' => now(),
        ]);
        $this->getJson($route)->assertExactJson(['state' => 'online'])
            ->assertJsonMissingPath('lastActiveAt')->assertJsonMissingPath('deviceId');

        $this->withUnencryptedCookie('pb_identity', $alice['token']);
        $op = (string) Str::uuid();
        $this->putJson('/api/v1/identity/presence/privacy', [
            'visibility' => 'nobody', 'expectedRevision' => 0, 'operationId' => $op,
        ])->assertOk()->assertJsonPath('revision', 1);
        $this->putJson('/api/v1/identity/presence/privacy', [
            'visibility' => 'nobody', 'expectedRevision' => 0, 'operationId' => $op,
        ])->assertOk()->assertJsonPath('revision', 1);
        $this->putJson('/api/v1/identity/presence/privacy', [
            'visibility' => 'all', 'expectedRevision' => 0, 'operationId' => (string) Str::uuid(),
        ])->assertConflict();
        $this->withUnencryptedCookie('pb_identity', $bob['token'])
            ->getJson($route)->assertExactJson(['state' => 'hidden']);

        $this->withUnencryptedCookie('pb_identity', $alice['token']);
        $this->putJson('/api/v1/identity/presence/privacy', [
            'visibility' => 'all', 'expectedRevision' => 1, 'operationId' => (string) Str::uuid(),
        ])->assertOk();
        // Either direction of an active block always suppresses activity.
        $this->withUnencryptedCookie('pb_identity', $bob['token']);
        $this->postJson('/api/v1/identity/blocks/'.$handle)->assertOk();
        $this->getJson($route)->assertExactJson(['state' => 'hidden']);
    }

    public function test_presence_lease_requires_living_session_and_timeout_and_never_resurrects(): void
    {
        $alice = $this->create();
        $bob = $this->create();
        $url = '/api/v1/identity/presence/'.$alice['account']['publicId'];
        $this->withUnencryptedCookie('pb_identity', $alice['token']);
        $instanceA = (string) Str::uuid();
        $instanceB = (string) Str::uuid();
        $pulse = fn ($instance, $sequence, $active) => [
            'instanceId' => $instance, 'sequence' => $sequence, 'active' => $active,
        ];
        $this->postJson('/api/v1/identity/presence/pulse', $pulse($instanceA, 1, true))->assertOk();
        $this->postJson('/api/v1/identity/presence/pulse', $pulse($instanceB, 1, true))->assertOk();
        $this->postJson('/api/v1/identity/presence/pulse', $pulse($instanceA, 3, false))->assertOk();
        $this->postJson('/api/v1/identity/presence/pulse', $pulse($instanceA, 2, true))->assertOk();
        $this->getJson($url)->assertExactJson(['state' => 'online']); // second tab still alive
        $this->postJson('/api/v1/identity/presence/pulse', $pulse($instanceB, 2, false))->assertOk();
        $this->getJson($url)->assertExactJson(['state' => 'recent']);
        $this->postJson('/api/v1/identity/presence/pulse', $pulse($instanceA, 4, true))->assertOk();
        $this->getJson($url)->assertExactJson(['state' => 'recent']); // closed tab cannot reopen

        $new = (string) Str::uuid();
        $this->postJson('/api/v1/identity/presence/pulse', $pulse($new, 1, true))->assertOk();
        try {
            Carbon::setTestNow(now()->addSeconds(90));
            $this->getJson($url)->assertExactJson(['state' => 'recent']);
            Carbon::setTestNow(now()->addHours(25));
            $this->getJson($url)->assertExactJson(['state' => 'longAgo']);
        } finally {
            Carbon::setTestNow();
        }
        // Logout kills server session; lease can no longer create online.
        $this->deleteJson('/api/v1/identity/session')->assertOk();
        $this->withUnencryptedCookie('pb_identity', $bob['token']);
        $this->getJson($url)->assertExactJson(['state' => 'hidden']); // contacts-only default
        $this->withUnencryptedCookie('pb_identity', $alice['token']);
        $this->postJson('/api/v1/identity/presence/pulse', $pulse((string) Str::uuid(), 1, true))
            ->assertUnauthorized();
    }

    public function test_presence_multiple_devices_survives_one_revoke_but_not_final_logout(): void
    {
        $alice = $this->create();
        $secondKey = $this->key();
        $secondDeviceId = (string) Str::uuid();
        $second = $this->authenticate([
            'purpose' => 'recover', 'rootKey' => $alice['root']['public'],
            'deviceKey' => $secondKey['public'], 'deviceId' => $secondDeviceId,
            'name' => 'Other synthetic device',
        ], $alice['root']);
        $bob = $this->create();
        $peerUrl = '/api/v1/identity/presence/'.$alice['account']['publicId'];
        $this->withUnencryptedCookie('pb_identity', $second['token']);
        $this->putJson('/api/v1/identity/presence/privacy', [
            'visibility' => 'all', 'expectedRevision' => 0, 'operationId' => (string) Str::uuid(),
        ])->assertOk();
        $this->withUnencryptedCookie('pb_identity', $alice['token']);
        $this->postJson('/api/v1/identity/presence/pulse', [
            'instanceId' => (string) Str::uuid(), 'sequence' => 1, 'active' => true,
        ])->assertOk();
        $this->withUnencryptedCookie('pb_identity', $second['token']);
        $this->postJson('/api/v1/identity/presence/pulse', [
            'instanceId' => (string) Str::uuid(), 'sequence' => 1, 'active' => true,
        ])->assertOk();
        $this->withUnencryptedCookie('pb_identity', $bob['token'])
            ->getJson($peerUrl)->assertExactJson(['state' => 'online']);
        $this->withUnencryptedCookie('pb_identity', $second['token'])
            ->deleteJson('/api/v1/identity/devices/'.$alice['deviceId'])->assertOk();
        $this->withUnencryptedCookie('pb_identity', $bob['token'])
            ->getJson($peerUrl)->assertExactJson(['state' => 'online']);
        $this->withUnencryptedCookie('pb_identity', $second['token'])
            ->deleteJson('/api/v1/identity/session')->assertOk();
        $this->withUnencryptedCookie('pb_identity', $bob['token'])
            ->getJson($peerUrl)->assertExactJson(['state' => 'recent']);
    }

    public function test_signed_registration_replay_expiry_and_device_binding(): void
    {
        $root = $this->key();
        $device = $this->key();
        $payload = ['purpose' => 'register', 'rootKey' => $root['public'], 'deviceKey' => $device['public'], 'deviceId' => (string) Str::uuid(), 'name' => 'Fixture'];
        $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
        $alias = substr($root['public'], 0, -1).$alphabet[strpos($alphabet, substr($root['public'], -1)) + 1];
        $this->postJson('/api/v1/identity/challenges', [...$payload, 'rootKey' => $alias])->assertUnprocessable();
        $challenge = $this->postJson('/api/v1/identity/challenges', $payload)->assertOk()->json();
        $body = ['challengeId' => $challenge['id'], 'signature' => $this->signature($challenge['message'], $root)];
        $this->postJson('/api/v1/identity/sessions', [...$body, 'signature' => $this->signature($challenge['message'], $device)])->assertUnauthorized();
        $this->postJson('/api/v1/identity/sessions', $body)->assertOk();
        $this->postJson('/api/v1/identity/sessions', $body)->assertUnauthorized();
        $this->assertDatabaseCount('identity_accounts', 1);
        $this->assertDatabaseCount('identity_devices', 1);
        $this->authenticate($payload, $root); // Same root/device cannot duplicate the identity.
        $this->assertDatabaseCount('identity_accounts', 1);
        $expired = $this->postJson('/api/v1/identity/challenges', $payload)->assertOk()->json();
        DB::table('identity_challenges')->where('id', $expired['id'])->update(['expires_at' => now()->subMinute()]);
        $this->postJson('/api/v1/identity/sessions', ['challengeId' => $expired['id'], 'signature' => $this->signature($expired['message'], $root)])->assertUnauthorized();
    }

    public function test_origin_guard_private_defaults_and_revision_conflicts(): void
    {
        $created = $this->create();
        $this->assertSame(array_fill_keys(Accounts::FIELDS, 'private'), $created['account']['visibility']);
        $profile = DB::table('identity_accounts')->value('profile');
        $this->assertStringNotContainsString('visibility', $profile);
        $this->assertArrayHasKey('visibility', json_decode(Crypt::decryptString($profile), true));
        $data = ['accountId' => $created['account']['id'], 'revision' => 1, 'fields' => $created['account']['fields'], 'visibility' => $created['account']['visibility']];
        $data['fields']['name'] = 'Synthetic private name';
        $this->patchJson('/api/v1/identity/profile', $data)->assertOk()->assertJsonPath('revision', 2);
        $this->patchJson('/api/v1/identity/profile', $data)->assertConflict();
        $this->withHeader('Origin', 'https://attacker.invalid')->patchJson('/api/v1/identity/profile', [...$data, 'revision' => 2])->assertForbidden();
    }

    public function test_recovery_enrolls_new_device_and_revoked_device_cannot_login(): void
    {
        $first = $this->create();
        $new = $this->key();
        $id = (string) Str::uuid();
        $second = $this->authenticate(['purpose' => 'recover', 'rootKey' => $first['root']['public'], 'deviceKey' => $new['public'], 'deviceId' => $id, 'name' => 'Recovery device'], $first['root']);
        $this->assertSame($first['account']['id'], $second['account']['id']);
        $this->deleteJson('/api/v1/identity/devices/'.$first['deviceId'])->assertOk()->assertJsonPath('revoked', true);
        $this->withUnencryptedCookie('pb_identity', $first['token'])->getJson('/api/v1/identity/me')->assertUnauthorized();
        $challenge = $this->postJson('/api/v1/identity/challenges', ['purpose' => 'login', 'publicId' => $first['account']['publicId'], 'deviceId' => $first['deviceId'], 'name' => 'Revoked'])->assertOk()->json();
        $this->postJson('/api/v1/identity/sessions', ['challengeId' => $challenge['id'], 'signature' => $this->signature($challenge['message'], $first['device'])])->assertUnauthorized();
    }

    public function test_contacts_enforce_visibility_recipient_and_blocking(): void
    {
        $first = $this->create();
        $second = $this->create();
        $fields = $second['account']['fields'];
        $fields['name'] = 'Public name';
        $fields['about'] = 'Contacts only';
        $fields['email'] = 'private@example.invalid';
        $visibility = $second['account']['visibility'];
        $visibility['name'] = 'public';
        $visibility['about'] = 'contacts';
        $this->patchJson('/api/v1/identity/profile', ['accountId' => $second['account']['id'], 'revision' => 1, 'fields' => $fields, 'visibility' => $visibility])->assertOk();
        $this->withUnencryptedCookie('pb_identity', $first['token']);
        $this->getJson('/api/v1/identity/people/'.$second['account']['publicId'])->assertOk()->assertJsonPath('fields', ['name' => 'Public name'])->assertJsonMissing(['id' => $second['account']['id']]);
        $request = $this->postJson('/api/v1/identity/contacts', ['publicId' => $second['account']['publicId']])->assertOk()->json('relationship.id');
        $this->patchJson('/api/v1/identity/contacts/'.$request, ['accept' => true])->assertStatus(410);
        $this->getJson('/api/v1/identity/people/'.$second['account']['publicId'])->assertOk()->assertJsonMissingPath('fields.about');
        $this->withUnencryptedCookie('pb_identity', $second['token'])->postJson('/api/v1/identity/contacts', ['publicId' => $first['account']['publicId']])->assertOk();
        $this->withUnencryptedCookie('pb_identity', $first['token'])->getJson('/api/v1/identity/people/'.$second['account']['publicId'])->assertOk()->assertJsonPath('fields.about', 'Contacts only')->assertJsonMissingPath('fields.email');
        $this->postJson('/api/v1/identity/blocks/'.$second['account']['publicId'])->assertOk();
        $this->withUnencryptedCookie('pb_identity', $second['token'])->getJson('/api/v1/identity/people/'.$first['account']['publicId'])->assertNotFound();
        $this->postJson('/api/v1/identity/contacts', ['publicId' => $first['account']['publicId']])->assertNotFound();
    }

    public function test_unknown_device_and_foreign_device_revocation_are_denied(): void
    {
        $first = $this->create();
        $second = $this->create();
        $this->deleteJson('/api/v1/identity/devices/'.$first['deviceId'])->assertNotFound();
        $this->assertDatabaseHas('identity_devices', ['id' => $first['deviceId'], 'revoked_at' => null]);
        $this->assertNotSame($first['account']['id'], $second['account']['id']);
    }

    public function test_matrix_outage_does_not_undo_account_and_keeps_revocation_intent(): void
    {
        $account = $this->create();
        DB::table('identity_accounts')->where('id', $account['account']['id'])->update(['matrix_state' => 'ready']);
        Http::fake(fn () => Http::response([], 503));
        $this->postJson('/api/v1/identity/matrix/session')->assertServiceUnavailable();
        $this->getJson('/api/v1/identity/me')->assertOk();
        $this->deleteJson('/api/v1/identity/devices/'.$account['deviceId'])->assertOk()->assertJsonPath('matrixPending', true);
        $this->getJson('/api/v1/identity/me')->assertUnauthorized();
        $this->assertDatabaseHas('identity_devices', ['id' => $account['deviceId'], 'matrix_revoke_pending' => true]);
    }

    public function test_stale_account_form_and_actor_header_cannot_mutate_new_session(): void
    {
        $first = $this->create();
        $second = $this->create();
        $this->patchJson('/api/v1/identity/profile', ['accountId' => $first['account']['id'], 'revision' => 1, 'fields' => $first['account']['fields'], 'visibility' => $first['account']['visibility']])->assertConflict();
        $this->assertDatabaseHas('identity_accounts', ['id' => $second['account']['id'], 'revision' => 1]);
        $this->withHeader('X-PhotoBunker-Account', $first['account']['id'])->deleteJson('/api/v1/identity/session')->assertConflict();
        $this->withHeader('X-PhotoBunker-Account', $second['account']['id'])->getJson('/api/v1/identity/me')->assertOk();
    }

    public function test_logout_invalidates_all_device_sessions_but_keeps_explicit_key_login(): void
    {
        $first = $this->create();
        $second = $this->authenticate(['purpose' => 'login', 'publicId' => $first['account']['publicId'], 'deviceId' => $first['deviceId'], 'name' => 'Same device'], $first['device']);
        $this->deleteJson('/api/v1/identity/session')->assertOk();
        $this->withUnencryptedCookie('pb_identity', $first['token'])->getJson('/api/v1/identity/me')->assertUnauthorized();
        $this->withUnencryptedCookie('pb_identity', $second['token'])->getJson('/api/v1/identity/me')->assertUnauthorized();
        $this->assertDatabaseHas('identity_devices', ['id' => $first['deviceId'], 'revoked_at' => null]);
        $this->authenticate(['purpose' => 'login', 'publicId' => $first['account']['publicId'], 'deviceId' => $first['deviceId'], 'name' => 'Explicit login'], $first['device']);
        $this->getJson('/api/v1/identity/me')->assertOk();
    }

    public function test_matrix_logout_keeps_failed_epoch_then_rotates_only_after_confirmed_delete(): void
    {
        $first = $this->create();
        $bridge = app(MatrixBridge::class);
        $old = $bridge->deviceId(DB::table('identity_devices')->find($first['deviceId']));
        DB::table('identity_accounts')->where('id', $first['account']['id'])->update(['matrix_state' => 'ready']);
        DB::table('identity_devices')->where('id', $first['deviceId'])->update(['matrix_revoke_pending' => true]);
        Cache::put('matrix:'.hash('sha256', config('identity.matrix_url')).':admin:token', Crypt::encryptString('synthetic-admin'), now()->addMinute());
        $available = false;
        $epoch = null;
        Http::fake(function ($request) use (&$available, &$epoch, $old, $first, $bridge) {
            if (! $available) {
                return Http::response([], 503);
            }
            if ($request->method() === 'DELETE') {
                $this->assertStringEndsWith('/devices/'.$old, rawurldecode($request->url()));
            }

            return Http::response(['user_id' => $bridge->mxid($first['account']['id']), 'device_id' => $epoch, 'access_token' => 'synthetic-new-token']);
        });
        try {
            $bridge->session($first['account']['id'], $first['deviceId']);
            $this->fail('A new Matrix session cannot bypass an unfinished logout.');
        } catch (MatrixFailure) {
            $this->assertDatabaseHas('identity_devices', ['id' => $first['deviceId'], 'matrix_revoke_pending' => true, 'matrix_device_id' => null]);
        }
        $available = true;
        $bridge->revoke($first['deviceId']);
        $device = DB::table('identity_devices')->find($first['deviceId']);
        $this->assertFalse((bool) $device->matrix_revoke_pending);
        $this->assertNotSame($old, $bridge->deviceId($device));
        $this->assertNull($device->revoked_at);
        $epoch = $device->matrix_device_id;
        $bridge->revoke($first['deviceId']);
        $this->assertDatabaseHas('identity_devices', ['id' => $first['deviceId'], 'matrix_device_id' => $epoch]);
        $this->authenticate(['purpose' => 'login', 'publicId' => $first['account']['publicId'], 'deviceId' => $first['deviceId'], 'name' => 'Explicit login'], $first['device']);
        $this->assertSame($epoch, $bridge->session($first['account']['id'], $first['deviceId'])['deviceId']);
    }

    public function test_legacy_proof_requires_existing_secret_and_is_exclusive_without_reassigning_photos(): void
    {
        $first = $this->create();
        $this->postJson('/api/v1/identity/legacy-proof', ['libraryCode' => str_repeat('0', 64)])->assertForbidden();
        $libraryId = (string) Str::uuid();
        $code = bin2hex(random_bytes(32));
        DB::table('prototype_libraries')->insert(['id' => $libraryId, 'token_hash' => hash('sha256', $code), 'created_at' => now()]);
        $this->postJson('/api/v1/identity/legacy-proof', ['libraryCode' => $code])->assertOk()->assertJsonPath('proofRecorded', true)->assertJsonPath('photosMigrated', false);
        $this->postJson('/api/v1/identity/legacy-proof', ['libraryCode' => $code])->assertOk();
        $this->create();
        $this->postJson('/api/v1/identity/legacy-proof', ['libraryCode' => $code])->assertConflict();
        $this->assertDatabaseHas('identity_legacy_claims', ['library_id' => $libraryId, 'account_id' => $first['account']['id']]);
        $this->assertDatabaseHas('prototype_libraries', ['id' => $libraryId, 'token_hash' => hash('sha256', $code)]);
    }

    public function test_messaging_peers_are_accepted_contacts_and_blocks_are_bilateral(): void
    {
        $first = $this->create();
        $second = $this->create();
        $this->getJson('/api/v1/identity/matrix/peers')->assertOk()->assertJsonPath('peers', []);
        $relation = $this->postJson('/api/v1/identity/contacts', ['publicId' => $first['account']['publicId']])->assertOk()->json('relationship.id');
        $this->withUnencryptedCookie('pb_identity', $first['token'])->postJson('/api/v1/identity/contacts', ['publicId' => $second['account']['publicId']])->assertOk();
        $response = $this->getJson('/api/v1/identity/matrix/peers')->assertOk();
        $response->assertJsonCount(1, 'peers')->assertJsonPath('peers.0.publicId', $second['account']['publicId'])->assertJsonPath('peers.0.fields', []);
        $this->postJson('/api/v1/identity/blocks/'.$second['account']['publicId'])->assertOk();
        $this->withUnencryptedCookie('pb_identity', $second['token'])->getJson('/api/v1/identity/matrix/peers')->assertOk()->assertJsonPath('peers', [])->assertJsonCount(1, 'blocked');
    }

    public function test_signing_proxy_refuses_foreign_identity_and_private_fields_before_any_matrix_call(): void
    {
        $created = $this->create();
        $this->postJson('/api/v1/identity/matrix/signing', ['keys' => ['private_key' => 'must-not-be-accepted']])->assertUnprocessable();
        $public = rtrim(base64_encode(random_bytes(32)), '=');
        $keys = [];
        foreach (['master_key' => 'master', 'self_signing_key' => 'self_signing', 'user_signing_key' => 'user_signing'] as $field => $usage) {
            $keys[$field] = ['user_id' => '@foreign:matrix.photobunker.test', 'usage' => [$usage], 'keys' => ['ed25519:'.$public => $public]];
        }
        $this->postJson('/api/v1/identity/matrix/signing', ['keys' => $keys])->assertUnprocessable();
        Http::assertNothingSent();
        $this->assertDatabaseHas('identity_accounts', ['id' => $created['account']['id']]);
    }

    public function test_signing_uia_stays_on_backend_and_never_resets_known_master_identity(): void
    {
        $created = $this->create();
        $mxid = '@pb_'.str_replace('-', '', $created['account']['id']).':matrix.photobunker.test';
        $device = 'PB_'.str_replace('-', '', $created['deviceId']);
        DB::table('identity_accounts')->where('id', $created['account']['id'])->update(['matrix_state' => 'ready']);
        Cache::put('matrix:'.hash('sha256', config('identity.matrix_url')).':token:'.$created['deviceId'], Crypt::encryptString('synthetic-token'), now()->addMinute());
        $keys = [];
        foreach (['master_key' => 'master', 'self_signing_key' => 'self_signing', 'user_signing_key' => 'user_signing'] as $field => $usage) {
            $value = rtrim(base64_encode(random_bytes(32)), '=');
            $keys[$field] = ['user_id' => $mxid, 'usage' => [$usage], 'keys' => ['ed25519:'.$value => $value]];
        }
        $known = null;
        $privatePassword = Crypt::decryptString(DB::table('identity_accounts')->value('matrix_password'));
        Http::fake(function ($request) use ($mxid, $device, &$known, $privatePassword) {
            if (str_ends_with($request->url(), '/account/whoami')) {
                return Http::response(['user_id' => $mxid, 'device_id' => $device]);
            }
            if (str_ends_with($request->url(), '/keys/query')) {
                return Http::response(['master_keys' => $known ? [$mxid => ['keys' => $known]] : []]);
            }
            if (str_ends_with($request->url(), '/keys/device_signing/upload')) {
                if (! isset($request['auth'])) {
                    return Http::response(['session' => 'synthetic-uia', 'flows' => [['stages' => ['m.login.password']]]], 401);
                }
                $this->assertSame($privatePassword, $request['auth']['password']);
                $this->assertSame($mxid, $request['auth']['identifier']['user']);

                return Http::response([]);
            }

            return Http::response([], 503);
        });
        $response = $this->postJson('/api/v1/identity/matrix/signing', ['keys' => $keys])->assertOk();
        $this->assertStringNotContainsString($privatePassword, $response->getContent());
        $known = ['ed25519:other' => rtrim(base64_encode(random_bytes(32)), '=')];
        $this->postJson('/api/v1/identity/matrix/signing', ['keys' => $keys])->assertConflict();
        $known = $keys['master_key']['keys'];
        $this->postJson('/api/v1/identity/matrix/signing', ['keys' => $keys])->assertOk();
    }

    public function test_identity_is_hidden_when_disabled_and_available_in_production_only_to_trusted_origin(): void
    {
        config(['identity.enabled' => false]);
        $this->getJson('/api/v1/identity/me')->assertNotFound();
        config(['identity.enabled' => true, 'identity.origins' => ['https://photos.example']]);
        app()->detectEnvironment(fn () => 'production');
        $this->withHeaders(['Origin' => 'https://photos.example'])
            ->getJson('/api/v1/identity/me')->assertUnauthorized();
        $this->withHeaders(['Origin' => 'https://attacker.example'])
            ->getJson('/api/v1/identity/me')->assertForbidden();
    }

    public function test_device_session_has_no_time_expiry_but_revocation_still_ends_access(): void
    {
        $created = $this->create();
        $this->assertNull($created['expiresAt']);
        $this->assertNull(DB::table('identity_sessions')->value('expires_at'));
        // Session credentials do not expire; real foreground use renews the
        // independent 180-day account inactivity deadline.
        for ($i = 0; $i < 8; $i++) {
            $this->travel(100)->days();
            $this->postJson('/api/v1/identity/activity')->assertOk();
        }
        $this->getJson('/api/v1/identity/me')->assertOk()->assertJsonPath('account.id', $created['account']['id']);
        DB::table('identity_devices')->where('id', $created['deviceId'])->update(['revoked_at' => now()]);
        $this->getJson('/api/v1/identity/me')->assertUnauthorized();
    }

    public function test_owner_can_open_and_unblock_a_blocked_profile_without_exposing_contact_only_fields(): void
    {
        $target = $this->create();
        $fields = $target['account']['fields'];
        $fields['name'] = 'Public sample';
        $fields['about'] = 'Contact sample';
        $fields['email'] = 'private@example.invalid';
        $visibility = $target['account']['visibility'];
        $visibility['name'] = 'public';
        $visibility['about'] = 'contacts';
        $this->patchJson('/api/v1/identity/profile', ['accountId' => $target['account']['id'], 'revision' => 1, 'fields' => $fields, 'visibility' => $visibility])->assertOk();
        $viewer = $this->create();
        $id = $target['account']['publicId'];
        $relation = $this->postJson('/api/v1/identity/contacts', ['publicId' => $id])->assertOk()->json('relationship.id');
        $this->withUnencryptedCookie('pb_identity', $target['token'])->postJson('/api/v1/identity/contacts', ['publicId' => $viewer['account']['publicId']])->assertOk();
        $this->withUnencryptedCookie('pb_identity', $viewer['token'])->postJson('/api/v1/identity/blocks/'.$id)->assertOk();
        $this->getJson('/api/v1/identity/people/'.$id)->assertOk()->assertJsonPath('blocked', true)->assertJsonPath('fields.name', 'Public sample')->assertJsonMissingPath('fields.about')->assertJsonMissingPath('fields.email');
        $this->getJson('/api/v1/identity/matrix/resolve/'.$id)->assertNotFound();
        $this->postJson('/api/v1/identity/matrix/conversations/prepare', ['peers' => [$id]])->assertNotFound();
        $this->withUnencryptedCookie('pb_identity', $target['token'])->getJson('/api/v1/identity/people/'.$viewer['account']['publicId'])->assertNotFound();
        $this->withUnencryptedCookie('pb_identity', $viewer['token'])->deleteJson('/api/v1/identity/blocks/'.$id)->assertOk();
        $this->getJson('/api/v1/identity/people/'.$id)->assertOk()->assertJsonPath('blocked', false)->assertJsonPath('fields.about', 'Contact sample');
        Http::assertNothingSent();
    }

    public function test_starting_a_conversation_provisions_the_recipient_without_requiring_them_to_open_messages(): void
    {
        $target = $this->create();
        $this->create();
        $mxid = app(MatrixBridge::class)->mxid($target['account']['id']);
        config(['identity.matrix_secret' => 'synthetic-register-secret']);
        Cache::put('matrix:'.hash('sha256', config('identity.matrix_url')).':admin:token', Crypt::encryptString('synthetic-admin'), now()->addMinute());
        Http::fake(function ($request) use ($mxid) {
            if (str_ends_with($request->url(), '/register')) {
                return Http::response($request->method() === 'GET' ? ['nonce' => 'synthetic-nonce'] : ['user_id' => $mxid]);
            }

            return Http::response(['name' => $mxid, 'admin' => false]);
        });
        $this->postJson('/api/v1/identity/matrix/conversations/prepare', ['peers' => [$target['account']['publicId']]])->assertOk()->assertJsonPath('peers.0.ready', true)->assertJsonPath('peers.0.matrixUserId', $mxid)->assertJsonMissingPath('peers.0.fields.email');
        $this->assertDatabaseHas('identity_accounts', ['id' => $target['account']['id'], 'matrix_state' => 'ready']);
        $this->assertDatabaseHas('identity_devices', ['id' => $target['deviceId'], 'matrix_device_id' => null]);
        $this->assertDatabaseCount('identity_devices', 2);
        Http::assertSentCount(4);
        $this->postJson('/api/v1/identity/matrix/conversations/prepare', ['peers' => [$target['account']['publicId']]])->assertOk();
        Http::assertSentCount(4);
    }

    public function test_prepare_conversation_validates_all_peers_before_provisioning_and_sanitizes_outages(): void
    {
        $first = $this->create();
        $second = $this->create();
        $actor = $this->create();
        $this->postJson('/api/v1/identity/blocks/'.$second['account']['publicId'])->assertOk();
        $this->postJson('/api/v1/identity/matrix/conversations/prepare', ['peers' => [$first['account']['publicId'], $second['account']['publicId']]])->assertNotFound();
        $this->postJson('/api/v1/identity/matrix/conversations/prepare', ['peers' => [$actor['account']['publicId']]])->assertNotFound();
        $this->postJson('/api/v1/identity/matrix/conversations/prepare', ['peers' => []])->assertUnprocessable();
        $this->postJson('/api/v1/identity/matrix/conversations/prepare', ['peers' => array_fill(0, 31, $first['account']['publicId'])])->assertUnprocessable();
        Http::assertNothingSent();
        Http::fake(fn () => Http::response(['detail' => 'synthetic-sensitive-upstream-detail'], 503));
        $this->postJson('/api/v1/identity/matrix/conversations/prepare', ['peers' => [$first['account']['publicId']]])->assertServiceUnavailable()->assertExactJson(['code' => 'messaging_unavailable']);
        $this->assertDatabaseHas('identity_accounts', ['id' => $first['account']['id'], 'matrix_state' => 'pending']);
    }

    public function test_address_book_is_personal_idempotent_and_removable_only_by_its_owner(): void
    {
        $target = $this->create();
        $owner = $this->create();
        $data = ['publicId' => $target['account']['publicId']];
        $id = $this->postJson('/api/v1/identity/contacts', $data)->assertOk()->assertJsonPath('relationship.state', 'accepted')->json('relationship.id');
        $this->postJson('/api/v1/identity/contacts', $data)->assertOk()->assertJsonPath('relationship.id', $id);
        $this->assertDatabaseCount('identity_address_book', 1);
        $this->withUnencryptedCookie('pb_identity', $target['token'])->getJson('/api/v1/identity/contacts')->assertOk()->assertJsonCount(0, 'contacts');
        $this->deleteJson('/api/v1/identity/contacts/'.$id)->assertNotFound();
        $this->withUnencryptedCookie('pb_identity', $owner['token'])->getJson('/api/v1/identity/contacts')->assertOk()->assertJsonCount(1, 'contacts');
        $this->deleteJson('/api/v1/identity/contacts/'.$id)->assertOk();
        $this->postJson('/api/v1/identity/contacts', $data)->assertOk();
        $this->assertDatabaseCount('identity_address_book', 1);
    }

    public function test_direct_conversation_joins_recipient_without_a_request_and_rejects_unsafe_rooms(): void
    {
        $recipient = $this->create();
        $actor = $this->create();
        DB::table('identity_accounts')->update(['matrix_state' => 'ready']);
        $bridge = app(MatrixBridge::class);
        $actorId = $bridge->mxid($actor['account']['id']);
        $recipientId = $bridge->mxid($recipient['account']['id']);
        $encrypted = true;
        $inviter = $actorId;
        $joined = 0;
        $history = 'invited';
        $normalized = 0;
        Http::fake(function ($request) use ($actorId, $recipientId, &$encrypted, &$inviter, &$joined, &$history, &$normalized) {
            $path = parse_url($request->url(), PHP_URL_PATH);
            if (str_ends_with($path, '/login')) {
                return Http::response(['user_id' => $request['identifier']['user'], 'device_id' => 'PB_WORKSPACE', 'access_token' => 'synthetic:'.$request['identifier']['user']]);
            }
            if (str_ends_with($path, '/account/whoami')) {
                return Http::response(['user_id' => substr($request->header('Authorization')[0], strlen('Bearer synthetic:')), 'device_id' => 'PB_WORKSPACE']);
            }
            if (str_ends_with($path, '/state')) {
                return Http::response([
                    ['type' => 'org.photobunker.chat', 'content' => ['kind' => 'direct']],
                    ['type' => 'm.room.encryption', 'content' => ['algorithm' => $encrypted ? 'm.megolm.v1.aes-sha2' : 'invalid']],
                    ['type' => 'm.room.create', 'sender' => $actorId],
                    ['type' => 'm.room.history_visibility', 'content' => ['history_visibility' => $history]],
                    ['type' => 'm.room.member', 'state_key' => $actorId, 'content' => ['membership' => 'join']],
                    ['type' => 'm.room.member', 'state_key' => $recipientId, 'sender' => $inviter, 'content' => ['membership' => 'invite']],
                ]);
            }
            if (str_ends_with($path, '/state/m.room.history_visibility')) {
                $normalized++;

                return Http::response(['event_id' => '$synthetic']);
            }
            if (str_contains($path, '/join/')) {
                $joined++;

                return Http::response(['room_id' => '!synthetic:matrix.local']);
            }

            return Http::response([], 500);
        });
        $url = '/api/v1/identity/matrix/conversations/activate';
        $data = ['roomId' => '!synthetic:matrix.local'];
        $this->postJson($url, $data)->assertOk()->assertJsonPath('ready', true);
        $this->assertSame(1, $joined);
        $history = 'joined';
        $this->postJson($url, $data)->assertOk();
        $this->assertSame(1, $normalized);
        $encrypted = false;
        $this->postJson($url, $data)->assertForbidden();
        $encrypted = true;
        $inviter = $recipientId;
        $this->postJson($url, $data)->assertForbidden();
        $inviter = $actorId;
        $this->postJson('/api/v1/identity/blocks/'.$recipient['account']['publicId'])->assertOk();
        $this->postJson($url, $data)->assertForbidden();
        $this->assertSame(2, $joined);
    }

    public function test_public_usernames_are_normalized_unique_and_resolve_without_exposing_private_fields(): void
    {
        $first = $this->create();
        $profile = $first['account'];
        $profile['fields']['username'] = '@Alice-qa';
        $profile['fields']['name'] = 'Private name';
        $this->patchJson('/api/v1/identity/profile', ['accountId' => $profile['id'], 'revision' => $profile['revision'], 'fields' => $profile['fields'], 'visibility' => $profile['visibility']])->assertOk()->assertJsonPath('username', 'alice-qa');
        $second = $this->create();
        $this->getJson('/api/v1/identity/people/%40ALICE-QA')->assertOk()->assertJsonPath('publicId', $profile['publicId'])->assertJsonMissingPath('fields.name');
        $other = $second['account'];
        $other['fields']['username'] = 'ALICE-QA';
        $this->patchJson('/api/v1/identity/profile', ['accountId' => $other['id'], 'revision' => $other['revision'], 'fields' => $other['fields'], 'visibility' => $other['visibility']])->assertUnprocessable();
        $other['fields']['username'] = 'bad space';
        $this->patchJson('/api/v1/identity/profile', ['accountId' => $other['id'], 'revision' => $other['revision'], 'fields' => $other['fields'], 'visibility' => $other['visibility']])->assertUnprocessable();
        $this->getJson('/api/v1/identity/matrix/resolve/%40alice-qa')->assertOk()->assertJsonPath('publicId', $profile['publicId']);
        $mxid = app(MatrixBridge::class)->mxid($profile['id']);
        $this->getJson('/api/v1/identity/matrix/resolve/'.rawurlencode($mxid))->assertOk()->assertJsonPath('username', 'alice-qa')->assertJsonMissingPath('fields.name');
        $this->getJson('/api/v1/identity/matrix/resolve/'.rawurlencode(str_replace(config('identity.matrix_server'), 'foreign.invalid', $mxid)))->assertNotFound();
    }

    public function test_deletion_permission_upgrade_is_limited_to_a_two_member_direct_room_of_the_requester(): void
    {
        $creator = $this->create();
        $actor = $this->create();
        DB::table('identity_accounts')->update(['matrix_state' => 'ready']);
        $bridge = app(MatrixBridge::class);
        $ownerId = $bridge->mxid($creator['account']['id']);
        $actorId = $bridge->mxid($actor['account']['id']);
        $kind = 'group';
        $membership = 'join';
        $changes = 0;
        Http::fake(function ($request) use (&$kind, &$membership, &$changes, $ownerId, $actorId) {
            $path = parse_url($request->url(), PHP_URL_PATH);
            if (str_ends_with($path, '/login')) {
                return Http::response(['user_id' => $request['identifier']['user'], 'device_id' => 'PB_WORKSPACE', 'access_token' => 'synthetic:'.$request['identifier']['user']]);
            }
            if (str_ends_with($path, '/account/whoami')) {
                return Http::response(['user_id' => substr($request->header('Authorization')[0], strlen('Bearer synthetic:')), 'device_id' => 'PB_WORKSPACE']);
            }
            if (str_ends_with($path, '/state')) {
                return Http::response([['type' => 'm.room.create', 'sender' => $ownerId], ['type' => 'org.photobunker.chat', 'content' => ['kind' => $kind]], ['type' => 'm.room.member', 'state_key' => $ownerId, 'content' => ['membership' => 'join']], ['type' => 'm.room.member', 'state_key' => $actorId, 'content' => ['membership' => $membership]]]);
            }
            if (str_ends_with($path, '/state/m.room.power_levels')) {
                if ($request->method() === 'PUT') {
                    $changes++;

                    return Http::response([]);
                }

                return Http::response(['users' => [$ownerId => 100], 'events' => new \stdClass, 'redact' => 50]);
            }

            return Http::response(['errcode' => 'M_FORBIDDEN'], 403);
        });
        $body = ['roomId' => '!synthetic:matrix.photobunker.test'];
        $this->postJson('/api/v1/identity/matrix/conversations/deletion', $body)->assertForbidden();
        $this->assertSame(0, $changes);
        $kind = 'direct';
        $membership = 'leave';
        $this->postJson('/api/v1/identity/matrix/conversations/deletion', $body)->assertForbidden();
        $this->assertSame(0, $changes);
        $membership = 'join';
        $this->postJson('/api/v1/identity/matrix/conversations/deletion', $body)->assertOk()->assertJsonPath('ready', true);
        $this->assertSame(1, $changes);
        Http::assertSent(fn ($request) => $request->method() === 'PUT' && str_ends_with($request->url(), '/state/m.room.power_levels') && $request['redact'] === 0);
    }

    public function test_gallery_sized_read_bursts_do_not_consume_the_write_or_authentication_budget(): void
    {
        $created = $this->create();
        config(['identity.write_requests_per_minute' => 2]);
        for ($i = 0; $i < 181; $i++) {
            $this->getJson('/api/v1/identity/me')->assertOk();
        }
        $body = ['purpose' => 'login', 'publicId' => $created['account']['publicId'], 'deviceId' => $created['deviceId'], 'name' => 'Synthetic'];
        $this->postJson('/api/v1/identity/challenges', $body)->assertOk();
        $this->postJson('/api/v1/identity/challenges', $body)->assertOk();
        $this->postJson('/api/v1/identity/challenges', $body)->assertStatus(429);
        $this->getJson('/api/v1/identity/me')->assertOk()->assertJsonPath('account.id', $created['account']['id']);
    }

    public function test_single_account_recovery_bundle_is_signed_scoped_and_revisioned(): void
    {
        $person = $this->create();
        $id = $person['account']['id'];
        $this->getJson('/api/v1/identity/recovery')->assertOk()->assertJsonPath('envelope', null);
        $statement = ['version' => 1, 'accountId' => $id, 'revision' => 1, 'rootKey' => $person['root']['public'], 'iv' => Protocol::b64(random_bytes(12)), 'ciphertext' => Protocol::b64(random_bytes(64))];
        $encode = function (array $value, array $root): string {
            return Protocol::canonical(['statement' => $value, 'signature' => $this->signature(Protocol::message('account-recovery', $value), $root)]);
        };
        $document = $encode($statement, $person['root']);
        $this->putJson('/api/v1/identity/recovery', ['envelope' => $document])->assertOk();
        $this->putJson('/api/v1/identity/recovery', ['envelope' => $document])->assertOk();
        $this->getJson('/api/v1/identity/recovery')->assertOk()->assertJsonPath('envelope.statement.accountId', $id);
        $this->assertDatabaseCount('account_recovery_bundles', 1);
        $this->putJson('/api/v1/identity/recovery', ['envelope' => $encode([...$statement, 'revision' => 3], $person['root'])])->assertStatus(409);
        $this->putJson('/api/v1/identity/recovery', ['envelope' => $encode([...$statement, 'revision' => 2, 'ciphertext' => Protocol::b64(random_bytes(64))], $person['root'])])->assertOk();
        $this->putJson('/api/v1/identity/recovery', ['envelope' => $document])->assertStatus(409);
        $this->putJson('/api/v1/identity/recovery', ['envelope' => $encode([...$statement, 'revision' => 3], $person['device'])])->assertUnprocessable();
        $other = $this->create();
        $this->getJson('/api/v1/identity/recovery')->assertOk()->assertJsonPath('envelope', null);
        $this->putJson('/api/v1/identity/recovery', ['envelope' => $document])->assertUnprocessable();
    }

    public function test_account_recovery_rejects_plaintext_fields_and_invalid_nonce(): void
    {
        $person = $this->create();
        $statement = ['version' => 1, 'accountId' => $person['account']['id'], 'revision' => 1, 'rootKey' => $person['root']['public'], 'iv' => Protocol::b64(random_bytes(11)), 'ciphertext' => Protocol::b64(random_bytes(64))];
        $document = function (array $value) use ($person): string {
            return Protocol::canonical(['statement' => $value, 'signature' => $this->signature(Protocol::message('account-recovery', $value), $person['root'])]);
        };
        $this->putJson('/api/v1/identity/recovery', ['envelope' => $document($statement)])->assertUnprocessable();
        $this->putJson('/api/v1/identity/recovery', ['envelope' => $document([...$statement, 'iv' => Protocol::b64(random_bytes(12)), 'photoKey' => 'synthetic-forbidden-private-field'])])->assertUnprocessable();
        $this->assertDatabaseCount('account_recovery_bundles', 0);
    }
}
