<?php

namespace Tests\Feature;

use App\Encrypted\Protocol;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

final class EncryptedPhotosTest extends TestCase
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

    private function signPhoto(string $purpose, array $value, string $secret): string
    {
        return Protocol::b64(sodium_crypto_sign_detached(Protocol::message($purpose, $value), $secret));
    }

    private function enable(array $created): array
    {
        $p = Protocol::class;
        $authority = sodium_crypto_sign_keypair();
        $read = sodium_crypto_sign_keypair();
        $box = sodium_crypto_box_keypair();
        $record = ['version' => 1, 'accountId' => $created['account']['id'], 'publicId' => $created['account']['publicId'], 'authorityKey' => $p::b64(sodium_crypto_sign_publickey($authority)), 'readKey' => $p::b64(sodium_crypto_sign_publickey($read)), 'recipientKey' => $p::b64(sodium_crypto_box_publickey($box)), 'pendingKey' => $p::b64(sodium_crypto_box_publickey(sodium_crypto_box_keypair())), 'revision' => 1, 'previousHash' => '', 'recoveryId' => (string) Str::uuid(), 'bundleHash' => ''];
        $bundle = ['version' => 1, 'accountId' => $record['accountId'], 'recoveryId' => $record['recoveryId'], 'revision' => 1, 'fingerprint' => $p::digest(sodium_crypto_sign_publickey($authority)), 'nonce' => $p::b64(random_bytes(24)), 'ciphertext' => $p::b64(random_bytes(128))];
        $record['bundleHash'] = $p::digest($bundle);
        $binding = ['version' => 1, 'accountId' => $record['accountId'], 'authorityKey' => $record['authorityKey']];
        $document = ['record' => $record, 'signature' => $this->signPhoto('photo-key', $record, sodium_crypto_sign_secretkey($authority)), 'binding' => $binding, 'rootSignature' => $this->signature($p::message('photo-authority', $binding), $created['root']), 'rootKey' => $created['root']['public']];
        $this->postJson('/api/v1/identity/secure/keys', ['document' => $p::canonical($document), 'bundle' => $p::canonical($bundle)])->assertOk();

        return compact('authority', 'read', 'box', 'document', 'bundle');
    }

    private function unlockPhoto(array $keys): string
    {
        $challenge = $this->postJson('/api/v1/identity/secure/read/challenge')->assertOk()->json();
        $token = $this->postJson('/api/v1/identity/secure/read/session', ['id' => $challenge['id'], 'signature' => $this->signPhoto('read-proof', $challenge, sodium_crypto_sign_secretkey($keys['read']))])->assertOk()->json('token');
        $this->withHeader('X-PhotoBunker-Read', $token);

        return $token;
    }

    public function test_photo_root_requires_identity_signature_and_strong_one_use_device_bound_proof(): void
    {
        $created = $this->create();
        $keys = $this->enable($created);
        $p = Protocol::class;
        $this->getJson('/api/v1/identity/secure/photos')->assertStatus(423);
        $challenge = $this->postJson('/api/v1/identity/secure/read/challenge')->assertOk()->json();
        $body = ['id' => $challenge['id'], 'signature' => $this->signPhoto('read-proof', $challenge, sodium_crypto_sign_secretkey($keys['authority']))];
        $this->postJson('/api/v1/identity/secure/read/session', $body)->assertUnprocessable();
        $body['signature'] = $this->signPhoto('read-proof', $challenge, sodium_crypto_sign_secretkey($keys['read']));
        $response = $this->postJson('/api/v1/identity/secure/read/session', $body)->assertOk();
        $this->postJson('/api/v1/identity/secure/read/session', $body)->assertUnauthorized();
        $this->withHeader('X-PhotoBunker-Read', $response->json('token'));
        $this->getJson('/api/v1/identity/secure/photos')->assertOk();
        $doc = $keys['document'];
        $doc['record']['recipientKey'] = $p::b64(random_bytes(32));
        $this->postJson('/api/v1/identity/secure/keys', ['document' => $p::canonical($doc), 'bundle' => $p::canonical($keys['bundle'])])->assertUnprocessable();
        DB::table('photo_read_sessions')->update(['expires_at' => now()->subSecond()]);
        $this->getJson('/api/v1/identity/secure/photos')->assertStatus(423);
    }

    public function test_owner_signed_plan_is_invalidated_by_key_changes_and_identity_alone_cannot_sign_it(): void
    {
        $created = $this->create();
        $keys = $this->enable($created);
        $p = Protocol::class;
        $context = $this->getJson('/api/v1/identity/secure/context')->assertOk()->json();
        $plan = ['statement' => $context['draft'], 'authority' => $keys['document'], 'signature' => $this->signPhoto('capture-plan', $context['draft'], sodium_crypto_sign_secretkey($keys['authority']))];
        $this->putJson('/api/v1/identity/secure/plan', ['plan' => $p::canonical($plan)])->assertStatus(423);
        $this->unlockPhoto($keys);
        $this->putJson('/api/v1/identity/secure/plan', ['plan' => $p::canonical($plan)])->assertOk();
        $this->getJson('/api/v1/identity/secure/context')->assertOk()->assertJsonPath('plan.signature', $plan['signature']);
        $tampered = $plan;
        $tampered['statement']['epoch']++;
        $this->putJson('/api/v1/identity/secure/plan', ['plan' => $p::canonical($tampered)])->assertConflict();
        $this->deleteJson('/api/v1/identity/secure/read/session')->assertOk();
        $this->getJson('/api/v1/identity/secure/photos')->assertStatus(423);
    }

    private function uploadFixture(): array
    {
        $created = $this->create();
        $keys = $this->enable($created);
        $this->unlockPhoto($keys);
        $p = Protocol::class;
        Storage::fake(config('prototype.disk'));
        $capture = $this->key();
        $statement = ['version' => 1, 'accountId' => $created['account']['id'], 'deviceId' => $created['deviceId'], 'authorityKey' => $keys['document']['record']['authorityKey'], 'signingKey' => $capture['public'], 'expiresAt' => now()->addDay()->getTimestampMs()];
        $certificate = ['statement' => $statement, 'signature' => $this->signPhoto('capture-device', $statement, sodium_crypto_sign_secretkey($keys['authority']))];
        $this->putJson('/api/v1/identity/secure/device', ['certificate' => $p::canonical($certificate)])->assertOk();
        $context = $this->getJson('/api/v1/identity/secure/context')->assertOk()->json('draft');
        $plan = ['statement' => $context, 'authority' => $keys['document'], 'signature' => $this->signPhoto('capture-plan', $context, sodium_crypto_sign_secretkey($keys['authority']))];
        $this->putJson('/api/v1/identity/secure/plan', ['plan' => $p::canonical($plan)])->assertOk();
        $anchor = $this->postJson('/api/v1/identity/secure/clock')->assertOk()->json();
        $id = (string) Str::uuid();
        $packets = [];
        $files = [];
        foreach (['metadata', 'original', 'preview', 'restricted-metadata', 'thumbnail'] as $kind) {
            $clear = 'synthetic-private-photo';
            $descriptor = ['format' => 'pb-object', 'version' => 1, 'suite' => 'sodium-secretstream-xchacha20poly1305', 'vault_id' => $context['vaultId'], 'asset_id' => $id, 'object_id' => (string) Str::uuid(), 'kind' => $kind, 'object_revision' => 1, 'encryption_epoch' => $context['epoch'], 'chunk_bytes' => 1048576, 'plaintext_bytes' => (string) strlen($clear), 'frame_count' => 1];
            $key = random_bytes(32);
            [$stream,$header] = sodium_crypto_secretstream_xchacha20poly1305_init_push($key);
            $aad = "photobunker/object/v1\0".sodium_crypto_generichash($p::canonical($descriptor), '', 32).pack('N2', 0, strlen($clear));
            $frame = sodium_crypto_secretstream_xchacha20poly1305_push($stream, $clear, $aad, SODIUM_CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_TAG_FINAL);
            $bytes = 'PBOBJ001'.pack('N', strlen($p::canonical($descriptor))).$p::canonical($descriptor).$header.pack('N', strlen($frame)).$frame;
            $envelopes = [['accountId' => $created['account']['id'], 'fingerprint' => $p::digest(sodium_crypto_box_publickey($keys['box'])), 'sealed' => $p::b64(sodium_crypto_box_seal($p::canonical(['version' => 1, 'key' => $p::b64($key), 'descriptorHash' => $p::digest($descriptor), 'context' => $descriptor, 'recipient' => $p::digest(sodium_crypto_box_publickey($keys['box'])), 'recipientEpoch' => $context['epoch']]), sodium_crypto_box_publickey($keys['box'])))]];
            $s = ['version' => 1, 'descriptor' => $descriptor, 'descriptorHash' => $p::digest($descriptor), 'ciphertextHash' => $p::digest($bytes), 'ciphertextBytes' => (string) strlen($bytes), 'recipientEpoch' => $context['epoch'], 'wrappingRevision' => 1, 'envelopesHash' => $p::digest($envelopes), 'planHash' => $p::digest($plan), 'accountId' => $created['account']['id'], 'deviceId' => $created['deviceId'], 'certificateHash' => $p::digest($certificate), 'initialHash' => ''];
            $packets[$kind] = ['statement' => $s, 'signature' => $this->signature($p::message('object-manifest', $s), $capture), 'certificate' => $certificate, 'plan' => $plan, 'envelopes' => $envelopes];
            $files[$kind] = UploadedFile::fake()->createWithContent('ciphertext', $bytes);
        }
        $s = ['version' => 1, 'id' => $id, 'creatorId' => $created['account']['id'], 'deviceId' => $created['deviceId'], 'vaultId' => $context['vaultId'], 'assignmentId' => null, 'epoch' => $context['epoch'], 'planHash' => $p::digest($plan), 'anchor' => $anchor['id'], 'retentionSeconds' => 3600, 'expiresAt' => $anchor['issuedAt'] + 3600000, 'packetHashes' => array_map($p::digest(...), $packets)];
        $body = ['submission' => $p::canonical($s), 'signature' => $this->signature($p::message('submission', $s), $capture), 'packets' => $p::canonical($packets), 'files' => $files];

        return compact('created', 'keys', 'capture', 'certificate', 'context', 'plan', 'anchor', 'id', 'packets', 'files', 's', 'body');
    }

    public function test_ciphertext_upload_roundtrip_is_private_idempotent_and_strong_gated(): void
    {
        extract($this->uploadFixture());
        $this->post('/api/v1/identity/secure/photos', $body)->assertOk();
        $this->post('/api/v1/identity/secure/photos', $body)->assertOk();
        $this->getJson('/api/v1/identity/secure/photos')->assertOk()->assertJsonPath('photos.0.id', $id);
        $this->assertDatabaseCount('encrypted_objects', 5);
        $this->assertStringNotContainsString('synthetic-private-photo', DB::table('encrypted_photos')->value('submission'));
    }

    public function test_upload_rejects_corruption_wrong_recipient_and_expired_anchor_without_reserving_storage(): void
    {
        extract($this->uploadFixture());
        $bad = $body;
        $bad['files']['original'] = UploadedFile::fake()->createWithContent('ciphertext', 'corrupt');
        $this->post('/api/v1/identity/secure/photos', $bad)->assertUnprocessable();
        $wrong = $packets;
        $wrong['original']['envelopes'][0]['accountId'] = (string) Str::uuid();
        $bad = [...$body, 'packets' => Protocol::canonical($wrong)];
        $this->post('/api/v1/identity/secure/photos', $bad)->assertUnprocessable();
        $this->assertDatabaseCount('encrypted_photos', 0);
        $this->assertDatabaseCount('encrypted_objects', 0);
        DB::table('workspace_clock_anchors')->delete();
        $this->post('/api/v1/identity/secure/photos', $body)->assertUnprocessable();
        $this->assertDatabaseCount('encrypted_photos', 0);
    }

    public function test_cancel_before_upload_is_scoped_strong_gated_idempotent_and_prevents_resurrection(): void
    {
        extract($this->uploadFixture());
        $cancel = ['vaultId' => $context['vaultId'], 'assignmentId' => null, 'expiresAt' => $s['expiresAt']];
        $this->withHeader('X-PhotoBunker-Read', '');
        $this->deleteJson('/api/v1/identity/secure/pending/'.$id, $cancel)->assertStatus(423);
        $this->unlockPhoto($keys);
        $this->deleteJson('/api/v1/identity/secure/pending/'.$id, [...$cancel, 'vaultId' => (string) Str::uuid()])->assertNotFound();
        $this->deleteJson('/api/v1/identity/secure/pending/'.$id, $cancel)->assertOk();
        $this->deleteJson('/api/v1/identity/secure/pending/'.$id, $cancel)->assertOk();
        $this->post('/api/v1/identity/secure/photos', $body)->assertGone();
        $this->assertDatabaseCount('encrypted_photos', 0);
        $this->assertDatabaseCount('encrypted_deletions', 1);
    }

    public function test_delete_and_expiry_reject_replayed_uploads_and_ciphertext_reads(): void
    {
        extract($this->uploadFixture());
        $this->post('/api/v1/identity/secure/photos', $body)->assertOk();
        $object = $packets['original']['statement']['descriptor']['object_id'];
        $this->get('/api/v1/identity/secure/photos/'.$id.'/objects/'.$object)->assertOk();
        DB::table('encrypted_photos')->where('id', $id)->update(['expires_at' => now()->subSecond()->getTimestampMs()]);
        $this->getJson('/api/v1/identity/secure/photos/'.$id)->assertGone();
        $this->post('/api/v1/identity/secure/photos', $body)->assertGone();
        $this->deleteJson('/api/v1/identity/secure/photos/'.$id)->assertOk();
        $this->assertDatabaseHas('encrypted_photos', ['id' => $id, 'state' => 'deleted']);
        $this->get('/api/v1/identity/secure/photos/'.$id.'/objects/'.$object)->assertGone();
        $this->assertSame([], Storage::disk(config('prototype.disk'))->allFiles());
    }

    public function test_strong_unlock_does_not_allow_new_plaintext_writes_or_unverified_migration_cleanup(): void
    {
        $created = $this->create();
        $keys = $this->enable($created);
        $id = (string) Str::uuid();
        $this->getJson('/api/v1/identity/workspace/photos')->assertStatus(423);
        $this->postJson('/api/v1/identity/workspace/photos', [])->assertStatus(423);
        $this->unlockPhoto($keys);
        $this->postJson('/api/v1/identity/workspace/photos', [])->assertConflict();
        $this->patchJson('/api/v1/identity/workspace/photos/'.$id, [])->assertConflict();
        $this->deleteJson('/api/v1/identity/secure/migration/'.$id, [])->assertUnprocessable();
        $this->deleteJson('/api/v1/identity/secure/migration/'.$id, ['confirmed' => true])->assertConflict();
        $this->assertDatabaseCount('photo_migration_checks', 0);
    }

    public function test_failed_storage_never_acknowledges_and_exact_retry_completes_reserved_objects(): void
    {
        extract($this->uploadFixture());
        $disk = Storage::disk(config('prototype.disk'));
        $failed = \Mockery::mock(FilesystemAdapter::class);
        $failed->shouldReceive('put')->once()->andReturn(false);
        Storage::shouldReceive('disk')->with(config('prototype.disk'))->andReturn($failed, $disk);
        $this->post('/api/v1/identity/secure/photos', $body)->assertStatus(503);
        $this->assertDatabaseHas('encrypted_photos', ['id' => $id, 'state' => 'pending']);
        $this->getJson('/api/v1/identity/secure/photos')->assertOk()->assertJsonCount(0, 'photos');
        $this->post('/api/v1/identity/secure/photos', $body)->assertOk();
        $this->assertDatabaseHas('encrypted_photos', ['id' => $id, 'state' => 'active']);
        $this->assertDatabaseCount('encrypted_objects', 5);
        $this->assertCount(5, $disk->allFiles());
    }

    public function test_correctly_signed_malformed_framing_is_rejected_before_storage(): void
    {
        extract($this->uploadFixture());
        $bytes = file_get_contents($files['original']->getRealPath());
        $bytes[0] = 'X';
        $packets['original']['statement']['ciphertextHash'] = Protocol::digest($bytes);
        $packets['original']['signature'] = $this->signature(Protocol::message('object-manifest', $packets['original']['statement']), $capture);
        $s['packetHashes']['original'] = Protocol::digest($packets['original']);
        $body['packets'] = Protocol::canonical($packets);
        $body['submission'] = Protocol::canonical($s);
        $body['signature'] = $this->signature(Protocol::message('submission', $s), $capture);
        $body['files']['original'] = UploadedFile::fake()->createWithContent('ciphertext', $bytes);
        $this->post('/api/v1/identity/secure/photos', $body)->assertUnprocessable();
        $this->assertDatabaseCount('encrypted_photos', 0);
        $this->assertSame([], Storage::disk(config('prototype.disk'))->allFiles());
    }

    private function versionBody(array $fixture, ?string $base = null): array
    {
        extract($fixture);
        $p = Protocol::class;
        $initial = $p::digest($s);
        $version = (string) Str::uuid();
        $vpackets = [];
        $vfiles = [];
        foreach (['image' => 'local-version', 'metadata' => 'version-metadata'] as $name => $kind) {
            $clear = 'synthetic-private-photo';
            $descriptor = ['format' => 'pb-object', 'version' => 1, 'suite' => 'sodium-secretstream-xchacha20poly1305', 'vault_id' => $context['vaultId'], 'asset_id' => $id, 'object_id' => (string) Str::uuid(), 'kind' => $kind, 'object_revision' => 1, 'encryption_epoch' => $context['epoch'], 'chunk_bytes' => 1048576, 'plaintext_bytes' => (string) strlen($clear), 'frame_count' => 1];
            $key = random_bytes(32);
            [$stream,$header] = sodium_crypto_secretstream_xchacha20poly1305_init_push($key);
            $aad = "photobunker/object/v1\0".sodium_crypto_generichash($p::canonical($descriptor), '', 32).pack('N2', 0, strlen($clear));
            $frame = sodium_crypto_secretstream_xchacha20poly1305_push($stream, $clear, $aad, SODIUM_CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_TAG_FINAL);
            $bytes = 'PBOBJ001'.pack('N', strlen($p::canonical($descriptor))).$p::canonical($descriptor).$header.pack('N', strlen($frame)).$frame;
            $envelopes = [['accountId' => $created['account']['id'], 'fingerprint' => $p::digest(sodium_crypto_box_publickey($keys['box'])), 'sealed' => $p::b64(sodium_crypto_box_seal($p::canonical(['version' => 1, 'key' => $p::b64($key), 'descriptorHash' => $p::digest($descriptor), 'context' => $descriptor, 'recipient' => $p::digest(sodium_crypto_box_publickey($keys['box'])), 'recipientEpoch' => $context['epoch']]), sodium_crypto_box_publickey($keys['box'])))]];
            $s = ['version' => 1, 'descriptor' => $descriptor, 'descriptorHash' => $p::digest($descriptor), 'ciphertextHash' => $p::digest($bytes), 'ciphertextBytes' => (string) strlen($bytes), 'recipientEpoch' => $context['epoch'], 'wrappingRevision' => 1, 'envelopesHash' => $p::digest($envelopes), 'planHash' => $p::digest($plan), 'accountId' => $created['account']['id'], 'deviceId' => $created['deviceId'], 'certificateHash' => $p::digest($certificate), 'initialHash' => $initial];
            $packet = ['statement' => $s, 'signature' => $this->signature($p::message('object-manifest', $s), $capture), 'certificate' => $certificate, 'plan' => $plan, 'envelopes' => $envelopes];
            $file = UploadedFile::fake()->createWithContent('ciphertext', $bytes);
            $vpackets[$name] = $packet;
            $vfiles[$name] = $file;
        }
        $event = ['version' => 1, 'id' => $version, 'photoId' => $id, 'parent' => $initial, 'baseId' => $base, 'imageHash' => $p::digest($vpackets['image']), 'metadataHash' => $p::digest($vpackets['metadata'])];

        return ['event' => $p::canonical($event), 'signature' => $this->signature($p::message('editor-version', $event), $capture), 'packets' => $p::canonical($vpackets), 'files' => $vfiles];
    }

    public function test_editor_versions_are_immutable_idempotent_and_keep_concurrent_saves(): void
    {
        $f = $this->uploadFixture();
        $id = $f['id'];
        $this->post('/api/v1/identity/secure/photos', $f['body'])->assertOk();
        $first = $this->versionBody($f);
        $second = $this->versionBody($f);
        $a = $this->post('/api/v1/identity/secure/photos/'.$id.'/versions', $first)->assertOk()->assertJsonPath('conflict', false)->json('id');
        $this->post('/api/v1/identity/secure/photos/'.$id.'/versions', $first)->assertOk()->assertJsonPath('id', $a);
        $this->post('/api/v1/identity/secure/photos/'.$id.'/versions', $second)->assertOk()->assertJsonPath('conflict', true);
        $this->getJson('/api/v1/identity/secure/photos/'.$id.'/versions')->assertOk()->assertJsonCount(2, 'versions');
        $this->getJson('/api/v1/identity/secure/photos/'.$id)->assertOk()->assertJsonPath('revision', 1)->assertJsonMissingPath('objects.local-version');
        $this->assertDatabaseCount('encrypted_versions', 2);
        $this->assertDatabaseCount('encrypted_objects', 9);
        $bad = $this->versionBody($f);
        $bad['files']['image'] = UploadedFile::fake()->createWithContent('ciphertext', 'tampered');
        $this->post('/api/v1/identity/secure/photos/'.$id.'/versions', $bad)->assertUnprocessable();
        $collision = $this->versionBody($f);
        $packet = Protocol::decode($collision['packets'])['image'];
        $original = DB::table('encrypted_objects')->where('photo_id', $id)->where('kind', 'original')->first();
        $originalBytes = Storage::disk(config('prototype.disk'))->get($original->object_key);
        DB::table('encrypted_objects')->insert([...get_object_vars($original), 'id' => $packet['statement']['descriptor']['object_id']]);
        $this->post('/api/v1/identity/secure/photos/'.$id.'/versions', $collision)->assertConflict();
        $this->assertSame($originalBytes, Storage::disk(config('prototype.disk'))->get($original->object_key));
        DB::table('encrypted_objects')->where('id', $packet['statement']['descriptor']['object_id'])->delete();
        config(['prototype.max_bytes' => 1]);
        $this->post('/api/v1/identity/secure/photos/'.$id.'/versions', $this->versionBody($f))->assertStatus(413);
        config(['prototype.max_bytes' => 999999999]);
        $other = $this->create();
        $this->unlockPhoto($this->enable($other));
        $this->getJson('/api/v1/identity/secure/photos/'.$id.'/versions')->assertNotFound();
    }

    public function test_external_export_is_isolated_scope_limited_revocable_and_bound_to_parent_ttl(): void
    {
        $f = $this->uploadFixture();
        $id = $f['id'];
        $this->post('/api/v1/identity/secure/photos', $f['body'])->assertOk();
        $cipher = random_bytes(80);
        $share = (string) Str::uuid();
        $manifest = ['version' => 1, 'id' => $share, 'scope' => 'view', 'versionId' => null, 'expiresAt' => $f['s']['expiresAt'], 'iv' => Protocol::b64(random_bytes(12)), 'ciphertextHash' => Protocol::digest($cipher), 'ciphertextBytes' => strlen($cipher)];
        $body = ['manifest' => Protocol::canonical($manifest), 'file' => UploadedFile::fake()->createWithContent('ciphertext', $cipher)];
        $path = '/api/v1/identity/secure/photos/'.$id.'/shares';
        $this->post($path, $body)->assertOk();
        $this->post($path, $body)->assertOk();
        $this->getJson($path)->assertOk()->assertJsonCount(1, 'shares');
        $public = $this->getJson('/api/v1/shares/'.$share)->assertOk()->json();
        $this->assertSame(Protocol::canonical($manifest), Protocol::canonical($public));
        $this->assertArrayNotHasKey('creatorId', $public);
        $this->assertArrayNotHasKey('photoId', $public);
        $object = DB::table('encrypted_shares')->find($share)->object_id;
        $this->get('/api/v1/identity/secure/photos/'.$id.'/objects/'.$object)->assertNotFound();
        $this->get('/api/v1/shares/'.$share.'/content')->assertOk()->assertHeader('Cache-Control', 'no-store, private');
        DB::table('encrypted_photos')->where('id', $id)->update(['expires_at' => now()->subSecond()->getTimestampMs()]);
        $this->getJson('/api/v1/shares/'.$share)->assertGone();
        $this->get('/api/v1/shares/'.$share.'/content')->assertGone();
        DB::table('encrypted_photos')->where('id', $id)->update(['expires_at' => $f['s']['expiresAt']]);
        $this->deleteJson($path.'/'.$share)->assertOk()->assertJsonPath('revoked', true);
        $this->getJson('/api/v1/shares/'.$share)->assertGone();
        $this->post($path, $body)->assertGone();
        $this->assertSame(0, (int) DB::table('encrypted_objects')->find($object)->bytes);
        $manifest['id'] = (string) Str::uuid();
        $manifest['expiresAt']++;
        $body['manifest'] = Protocol::canonical($manifest);
        $this->post($path, $body)->assertUnprocessable();
        $this->deleteJson('/api/v1/identity/secure/photos/'.$id)->assertOk();
        foreach (Storage::disk(config('prototype.disk'))->allFiles('encrypted/'.$f['context']['vaultId'].'/'.$id) as $file) {
            $this->fail('Child ciphertext survived verified deletion');
        }
    }

    public function test_private_card_v2_is_ciphertext_only_scope_limited_and_isolated_from_legacy(): void
    {
        $f = $this->uploadFixture();
        $id = $f['id'];
        $this->post('/api/v1/identity/secure/photos', $f['body'])->assertOk();
        $ciphertext = random_bytes(96);
        $shareId = (string) Str::uuid();
        $scopes = ['card' => true, 'photo' => false, 'original' => false,
            'download' => false, 'metadata' => false];
        $manifest = ['type' => 'photo-card', 'version' => 2, 'id' => $shareId,
            'scopes' => $scopes, 'expiresAt' => min($f['s']['expiresAt'], now()->addHour()->getTimestampMs()), 'durationSeconds' => 3600,
            'object' => ['type' => 'card', 'version' => 1,
                'iv' => Protocol::b64(random_bytes(12)),
                'ciphertextHash' => Protocol::digest($ciphertext),
                'ciphertextBytes' => strlen($ciphertext)]];
        $body = ['manifest' => Protocol::canonical($manifest),
            'file' => UploadedFile::fake()->createWithContent('ciphertext', $ciphertext)];
        $private = '/api/v1/identity/secure/photos/'.$id.'/cards';
        $public = '/api/v1/cards/'.$shareId;
        $this->post($private, $body)->assertOk()->assertJsonPath('id', $shareId);
        $this->post($private, $body)->assertOk()->assertJsonPath('id', $shareId);
        $this->assertDatabaseCount('encrypted_shares', 1);
        $this->getJson($private)->assertOk()->assertJsonCount(1, 'shares');
        $this->getJson('/api/v1/identity/secure/photos/'.$id.'/shares')->assertOk()->assertJsonCount(0, 'shares');
        $this->getJson($public)->assertOk()->assertJsonPath('type', 'photo-card')
            ->assertJsonPath('scopes.card', true)->assertJsonPath('scopes.photo', false);
        $this->get($public.'/content')->assertOk();
        $this->getJson('/api/v1/shares/'.$shareId)->assertNotFound();
        $this->get('/api/v1/shares/'.$shareId.'/content')->assertNotFound();

        $bad = $manifest;
        $bad['id'] = (string) Str::uuid();
        $bad['scopes']['download'] = true;
        $body['manifest'] = Protocol::canonical($bad);
        $this->post($private, $body)->assertUnprocessable();
        $bad['scopes']['download'] = false;
        $bad['scopes']['photo'] = true;
        $body['manifest'] = Protocol::canonical($bad);
        $this->post($private, $body)->assertUnprocessable();

        $this->deleteJson($private.'/'.$shareId)->assertOk()->assertJsonPath('revoked', true);
        $this->deleteJson($private.'/'.$shareId)->assertOk()->assertJsonPath('revoked', true);
        $this->getJson($public)->assertGone();
        $this->get($public.'/content')->assertGone();
        $body['manifest'] = Protocol::canonical($manifest);
        $this->post($private, $body)->assertGone();
        $this->assertDatabaseHas('photo_card_share_tombstones', ['id' => $shareId, 'photo_id' => $id]);
    }

    public function test_card_pre_revoke_tombstone_defeats_lost_create_ack(): void
    {
        $f = $this->uploadFixture();
        $id = $f['id'];
        $this->post('/api/v1/identity/secure/photos', $f['body'])->assertOk();
        $shareId = (string) Str::uuid();
        $this->deleteJson('/api/v1/identity/secure/photos/'.$id.'/cards/'.$shareId)
            ->assertOk()->assertJsonPath('revoked', true);
        $this->assertDatabaseHas('photo_card_share_tombstones', ['id' => $shareId, 'photo_id' => $id]);
        $bytes = random_bytes(80);
        $manifest = ['type' => 'photo-card', 'version' => 2, 'id' => $shareId,
            'scopes' => ['card' => true, 'photo' => false, 'original' => false,
                'download' => false, 'metadata' => false], 'expiresAt' => min($f['s']['expiresAt'], now()->addHour()->getTimestampMs()), 'durationSeconds' => 3600,
            'object' => ['type' => 'card', 'version' => 1,
                'iv' => Protocol::b64(random_bytes(12)),
                'ciphertextHash' => Protocol::digest($bytes), 'ciphertextBytes' => strlen($bytes)]];
        $this->post('/api/v1/identity/secure/photos/'.$id.'/cards', [
            'manifest' => Protocol::canonical($manifest),
            'file' => UploadedFile::fake()->createWithContent('ciphertext', $bytes),
        ])->assertGone();
        $this->getJson('/api/v1/cards/'.$shareId)->assertNotFound();
    }

    public function test_photo_card_multi_object_share_is_all_or_nothing_and_revokes_every_kind(): void
    {
        $f = $this->uploadFixture();
        $id = $f['id'];
        $this->post('/api/v1/identity/secure/photos', $f['body'])->assertOk();
        $version = $this->versionBody($f);
        $saved = $this->post('/api/v1/identity/secure/photos/'.$id.'/versions', $version)->assertOk()->json();
        $versionId = $saved['id'];
        $card = random_bytes(96);
        $safe = random_bytes(120);
        $original = random_bytes(150);
        $share = (string) Str::uuid();
        $descriptor = fn (string $kind, string $bytes) => [
            'type' => $kind, 'version' => 1, 'iv' => Protocol::b64(random_bytes(12)),
            'ciphertextHash' => Protocol::digest($bytes), 'ciphertextBytes' => strlen($bytes),
        ];
        $m = ['type' => 'photo-card', 'version' => 2, 'id' => $share,
            'scopes' => ['card' => true, 'photo' => true, 'original' => true,
                'download' => true, 'metadata' => false],
            'expiresAt' => min($f['s']['expiresAt'], now()->addMinutes(20)->getTimestampMs()),
            'durationSeconds' => 3600,
            'object' => $descriptor('card', $card),
            'objects' => [
                'photo' => [...$descriptor('photo', $safe), 'versionId' => $versionId],
                'original' => [...$descriptor('original', $original), 'mime' => 'image/png'],
            ],
        ];
        $make = fn (array $manifest) => [
            'manifest' => Protocol::canonical($manifest),
            'file' => UploadedFile::fake()->createWithContent('card', $card),
            'photo' => UploadedFile::fake()->createWithContent('photo', $safe),
            'original' => UploadedFile::fake()->createWithContent('original', $original),
        ];
        $path = '/api/v1/identity/secure/photos/'.$id.'/cards';
        $public = '/api/v1/cards/'.$share;
        $missing = $make($m);
        unset($missing['photo']);
        $this->post($path, $missing)->assertUnprocessable();
        $this->getJson($public)->assertNotFound();
        $extra = $make($m);
        $extra['unexpected'] = UploadedFile::fake()->create('extra');
        $this->post($path, $extra)->assertUnprocessable();
        $this->getJson($public)->assertNotFound();
        $this->post($path, $make($m))->assertOk()->assertJsonPath('id', $share);
        $this->post($path, $make($m))->assertOk()->assertJsonPath('id', $share);
        $this->assertDatabaseCount('encrypted_shares', 1);
        $this->assertDatabaseCount('photo_card_share_objects', 2);
        foreach (['', '/photo', '/original'] as $suffix) {
            $this->get($public.'/content'.$suffix)->assertOk();
        }
        $this->get($public.'/content/metadata')->assertNotFound();
        $this->getJson('/api/v1/shares/'.$share)->assertNotFound();
        $this->deleteJson($path.'/'.$share)->assertOk();
        $this->deleteJson($path.'/'.$share)->assertOk();
        $this->getJson($public)->assertGone();
        foreach (['', '/photo', '/original'] as $suffix) {
            $this->get($public.'/content'.$suffix)->assertGone();
        }
        $this->post($path, $make($m))->assertGone();
        $this->assertSame(0, (int) DB::table('encrypted_objects')
            ->where('id', DB::table('encrypted_shares')->where('id', $share)->value('object_id'))->value('bytes'));
        foreach (DB::table('photo_card_share_objects')->where('share_id', $share)->get() as $object) {
            $this->assertSame(0, (int) DB::table('encrypted_objects')->where('id', $object->object_id)->value('bytes'));
        }
    }

    public function test_card_download_scope_cannot_invent_a_photo_object(): void
    {
        $f = $this->uploadFixture();
        $id = $f['id'];
        $this->post('/api/v1/identity/secure/photos', $f['body'])->assertOk();
        $bytes = random_bytes(88);
        $manifest = ['type' => 'photo-card', 'version' => 2, 'id' => (string) Str::uuid(),
            'scopes' => ['card' => true, 'photo' => false, 'original' => false,
                'download' => true, 'metadata' => false],
            'expiresAt' => min($f['s']['expiresAt'], now()->addMinutes(20)->getTimestampMs()),
            'durationSeconds' => 3600,
            'object' => ['type' => 'card', 'version' => 1,
                'iv' => Protocol::b64(random_bytes(12)),
                'ciphertextHash' => Protocol::digest($bytes), 'ciphertextBytes' => strlen($bytes)],
        ];
        $this->post('/api/v1/identity/secure/photos/'.$id.'/cards', [
            'manifest' => Protocol::canonical($manifest),
            'file' => UploadedFile::fake()->createWithContent('ciphertext', $bytes),
        ])->assertUnprocessable();
    }

    public function test_version_pair_storage_failure_does_not_publish_and_exact_retry_keeps_original(): void
    {
        $f = $this->uploadFixture();
        $id = $f['id'];
        $this->post('/api/v1/identity/secure/photos', $f['body'])->assertOk();
        $body = $this->versionBody($f);
        $disk = Storage::disk(config('prototype.disk'));
        $original = DB::table('encrypted_objects')->where('photo_id', $id)->where('kind', 'original')->first();
        $bytes = $disk->get($original->object_key);
        $failed = \Mockery::mock(FilesystemAdapter::class);
        $writes = 0;
        $failed->shouldReceive('put')->twice()->andReturnUsing(function ($path, $stream) use ($disk, &$writes) {
            return ++$writes === 1 ? $disk->put($path, $stream) : false;
        });
        $failed->shouldReceive('size')->once()->andReturnUsing(fn ($path) => $disk->size($path));
        Storage::shouldReceive('disk')->with(config('prototype.disk'))->andReturn($failed, $failed, $disk, $disk);
        $this->post('/api/v1/identity/secure/photos/'.$id.'/versions', $body)->assertStatus(503);
        $this->assertDatabaseCount('encrypted_versions', 0);
        $this->assertDatabaseCount('encrypted_objects', 5);
        $this->post('/api/v1/identity/secure/photos/'.$id.'/versions', $body)->assertOk();
        $this->assertDatabaseCount('encrypted_versions', 1);
        $this->assertDatabaseCount('encrypted_objects', 7);
        $this->assertSame($bytes, $disk->get($original->object_key));
    }
}
