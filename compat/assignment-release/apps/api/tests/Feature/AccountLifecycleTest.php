<?php

namespace Tests\Feature;

use App\Identity\AccountLifecycle;
use App\Identity\Accounts;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Factory;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

final class AccountLifecycleTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['identity.enabled' => true]);
        Http::preventStrayRequests();
        Storage::fake(config('prototype.disk'));
        $this->withCredentials()->withHeaders(['X-PhotoBunker' => 'identity-v1', 'Origin' => 'http://localhost:8080']);
    }

    private function account(): string
    {
        $id = (string) Str::uuid();
        $device = (string) Str::uuid();
        DB::table('identity_accounts')->insert(['id' => $id, 'public_id' => 'pb_'.Str::random(16), 'public_key' => 'fixture', 'key_fingerprint' => hash('sha256', $id), 'profile' => Crypt::encryptString(json_encode(['fields' => array_fill_keys(Accounts::FIELDS, ''), 'visibility' => array_fill_keys(Accounts::FIELDS, 'private')])), 'matrix_password' => Crypt::encryptString('fixture'), 'created_at' => now(), 'updated_at' => now(), 'last_active_at' => now(), 'inactivity_delete_at' => now()->addDays(180)]);
        DB::table('identity_devices')->insert(['id' => $device, 'account_id' => $id, 'public_key' => 'fixture', 'name' => 'QA lifecycle', 'created_at' => now(), 'updated_at' => now()]);
        $token = bin2hex(random_bytes(32));
        DB::table('identity_sessions')->insert(['token_hash' => hash('sha256', $token), 'device_id' => $device, 'created_at' => now()]);
        $this->withUnencryptedCookie('pb_identity', $token);

        return $id;
    }

    private function photo(string $owner, ?string $creator = null): array
    {
        $vault = (string) Str::uuid();
        $photo = (string) Str::uuid();
        $object = (string) Str::uuid();
        $path = "encrypted/$vault/$photo/$object";
        DB::table('workspace_vaults')->insert(['id' => $vault, 'owner_id' => $owner, 'kind' => 'personal']);
        DB::table('encrypted_photos')->insert(['id' => $photo, 'vault_id' => $vault, 'creator_id' => $creator ?? $owner, 'submission' => '{}', 'submission_signature' => 'fixture', 'submission_hash' => str_repeat('a', 43), 'expires_at' => now()->addDay()->getTimestampMs(), 'state' => 'active', 'created_at' => now(), 'updated_at' => now()]);
        DB::table('encrypted_objects')->insert(['id' => $object, 'photo_id' => $photo, 'kind' => 'original', 'revision' => 1, 'bytes' => 23, 'object_key' => $path, 'packet' => '{}', 'created_at' => now()]);
        Storage::disk(config('prototype.disk'))->put($path, random_bytes(23));

        return [$photo, $path];
    }

    private function absentMatrix(): void
    {
        Http::swap(new Factory);
        Http::preventStrayRequests();
        Cache::put('matrix:'.hash('sha256', config('identity.matrix_url')).':admin:token', Crypt::encryptString('synthetic-admin'), now()->addHour());
        Http::fake(fn ($request) => str_ends_with($request->url(), '/account/whoami') ? Http::response(['user_id' => '@service:fixture']) : Http::response(['errcode' => 'M_NOT_FOUND'], 404));
    }

    public function test_settings_defaults_bounds_and_counts_are_account_scoped(): void
    {
        $other = $this->account();
        $this->photo($other);
        $owner = $this->account();
        $this->photo($owner);
        $this->getJson('/api/v1/identity/storage')->assertOk()->assertJsonPath('inactivityDays', 180)->assertJsonPath('ownedPhotos', 1)->assertJsonPath('encryptedBytes', 23);
        foreach ([29, 361, 30.5, 'no'] as $days) {
            $this->patchJson('/api/v1/identity/storage', ['inactivityDays' => $days])->assertUnprocessable();
        }
        foreach ([30, 360] as $days) {
            $this->patchJson('/api/v1/identity/storage', ['inactivityDays' => $days])->assertOk()->assertJsonPath('inactivityDays', $days);
            $this->assertSame(now()->addDays($days)->format('Y-m-d H:i:s'), DB::table('identity_accounts')->where('id', $owner)->value('inactivity_delete_at'));
        }
    }

    public function test_only_foreground_activity_renews_deadline_and_stale_scan_cannot_delete_active_account(): void
    {
        $owner = $this->account();
        $before = DB::table('identity_accounts')->where('id', $owner)->value('inactivity_delete_at');
        $this->travel(179)->days();
        $this->getJson('/api/v1/identity/me')->assertOk();
        $this->getJson('/api/v1/identity/storage')->assertOk();
        $this->assertSame($before, DB::table('identity_accounts')->where('id', $owner)->value('inactivity_delete_at'));
        $this->postJson('/api/v1/identity/activity')->assertOk();
        $this->assertFalse(app(AccountLifecycle::class)->claim($owner, true));
        $this->travel(181)->days();
        $this->getJson('/api/v1/identity/me')->assertGone();
        $this->postJson('/api/v1/identity/activity')->assertGone();
        $this->assertTrue(app(AccountLifecycle::class)->claim($owner, true));
    }

    public function test_delete_requires_confirmation_and_binding_then_revokes_before_cleanup(): void
    {
        $other = $this->account();
        $owner = $this->account();
        [$photo, $path] = $this->photo($owner);
        DB::table('account_recovery_bundles')->insert(['account_id' => $owner, 'revision' => 1, 'document' => 'ciphertext', 'created_at' => now(), 'updated_at' => now()]);
        $this->deleteJson('/api/v1/identity/account', ['accountId' => $owner])->assertUnprocessable();
        $this->deleteJson('/api/v1/identity/account', ['accountId' => $other, 'confirmation' => 'DELETE'])->assertConflict();
        $this->deleteJson('/api/v1/identity/account', ['accountId' => $owner, 'confirmation' => 'DELETE'])->assertStatus(202);
        $this->assertDatabaseHas('encrypted_photos', ['id' => $photo, 'state' => 'deleted']);
        $this->assertDatabaseMissing('account_recovery_bundles', ['account_id' => $owner]);
        Storage::disk(config('prototype.disk'))->assertExists($path);
        $this->getJson('/api/v1/identity/storage')->assertUnauthorized();
        Http::fake(fn () => Http::response([], 503));
        $this->assertFalse(app(AccountLifecycle::class)->erase($owner));
        $this->assertDatabaseHas('identity_accounts', ['id' => $owner, 'deletion_attempts' => 1]);
        $this->absentMatrix();
        $this->assertTrue(app(AccountLifecycle::class)->erase($owner));
        $this->assertTrue(app(AccountLifecycle::class)->erase($owner));
        $this->assertDatabaseMissing('identity_accounts', ['id' => $owner]);
        $this->assertDatabaseHas('identity_accounts', ['id' => $other]);
        Storage::disk(config('prototype.disk'))->assertMissing($path);
    }

    public function test_scheduler_deletes_inactive_scope_and_keeps_other_users_files(): void
    {
        $inactive = $this->account();
        $active = $this->account();
        [$own, $ownPath] = $this->photo($inactive);
        [$shared, $sharedPath] = $this->photo($active, $inactive);
        [$other, $otherPath] = $this->photo($active);
        DB::table('identity_accounts')->where('id', $inactive)->update(['inactivity_delete_at' => now()->subSecond()]);
        $this->absentMatrix();
        $this->artisan('photobunker:account-maintain')->assertSuccessful();
        $this->assertDatabaseMissing('identity_accounts', ['id' => $inactive]);
        $this->assertDatabaseMissing('encrypted_photos', ['id' => $own]);
        $this->assertDatabaseMissing('encrypted_photos', ['id' => $shared]);
        $this->assertDatabaseHas('encrypted_photos', ['id' => $other, 'state' => 'active']);
        Storage::disk(config('prototype.disk'))->assertMissing($ownPath);
        Storage::disk(config('prototype.disk'))->assertMissing($sharedPath);
        Storage::disk(config('prototype.disk'))->assertExists($otherPath);
    }

    public function test_matrix_backup_versions_are_erased_before_verified_deactivation(): void
    {
        $owner = $this->account();
        $this->absentMatrix();
        $versions = ['2', '1'];
        $deactivated = false;
        Http::swap(new Factory);
        Http::preventStrayRequests();
        Http::fake(function ($request) use (&$versions, &$deactivated) {
            $url = rawurldecode($request->url());
            if (str_ends_with($url, '/account/whoami')) {
                return Http::response(['user_id' => '@service:fixture']);
            }
            if (str_ends_with($url, '/login')) {
                return Http::response(['access_token' => 'synthetic-eraser']);
            }
            if (str_ends_with($url, '/room_keys/version')) {
                return $versions ? Http::response(['version' => $versions[0]]) : Http::response(['errcode' => 'M_NOT_FOUND'], 404);
            }
            if ($request->method() === 'DELETE' && str_contains($url, '/room_keys/version/')) {
                $this->assertStringEndsWith('/'.array_shift($versions), $url);

                return Http::response([]);
            }
            if (str_contains($url, '/deactivate/')) {
                $this->assertSame([], $versions);
                $this->assertTrue($request['erase']);
                $deactivated = true;

                return Http::response([]);
            }
            if (str_ends_with($url, '/devices')) {
                return Http::response(['devices' => []]);
            }

            return Http::response(['deactivated' => $deactivated]);
        });
        app(AccountLifecycle::class)->claim($owner);
        $this->assertTrue(app(AccountLifecycle::class)->erase($owner));
        $this->assertTrue($deactivated);
    }

    public function test_failed_object_deletion_keeps_references_and_retries_without_restoring_access(): void
    {
        $owner = $this->account();
        [$photo, $path] = $this->photo($owner);
        $disk = Storage::disk(config('prototype.disk'));
        $failed = \Mockery::mock();
        $failed->shouldReceive('allFiles')->andReturn([$path]);
        $failed->shouldReceive('delete')->once()->with($path)->andReturn(false);
        $failed->shouldReceive('exists')->once()->with($path)->andReturn(true);
        Storage::shouldReceive('disk')->with(config('prototype.disk'))->andReturn($failed, $disk);
        $this->absentMatrix();
        app(AccountLifecycle::class)->claim($owner);
        $this->assertFalse(app(AccountLifecycle::class)->erase($owner));
        $this->assertDatabaseHas('encrypted_photos', ['id' => $photo, 'state' => 'deleted', 'delete_verified_at' => null]);
        $this->assertDatabaseHas('identity_accounts', ['id' => $owner, 'deletion_attempts' => 1]);
        $this->assertTrue(app(AccountLifecycle::class)->erase($owner));
        $disk->assertMissing($path);
    }

    public function test_unreferenced_ciphertext_in_owned_vault_is_verified_before_account_disappears(): void
    {
        $owner = $this->account();
        [$photo, $path] = $this->photo($owner);
        $vault = DB::table('encrypted_photos')->where('id', $photo)->value('vault_id');
        $orphan = 'encrypted/'.$vault.'/'.Str::uuid().'/'.Str::uuid();
        Storage::disk(config('prototype.disk'))->put($orphan, random_bytes(23));
        $this->absentMatrix();
        app(AccountLifecycle::class)->claim($owner);
        $this->assertTrue(app(AccountLifecycle::class)->erase($owner));
        Storage::disk(config('prototype.disk'))->assertMissing($orphan);
        Storage::disk(config('prototype.disk'))->assertMissing($path);
    }

    public function test_pending_deletion_disappears_from_contacts_and_public_lookups_without_breaking_peers(): void
    {
        $owner = $this->account();
        $publicId = DB::table('identity_accounts')->where('id', $owner)->value('public_id');
        $viewer = $this->account();
        $ids = [$owner, $viewer];
        sort($ids);
        DB::table('identity_contacts')->insert(['id' => (string) Str::uuid(), 'requester' => $owner, 'recipient' => $viewer, 'pair_key' => implode(':', $ids), 'state' => 'accepted', 'created_at' => now(), 'updated_at' => now()]);
        app(AccountLifecycle::class)->claim($owner);
        $this->getJson('/api/v1/identity/contacts')->assertOk()->assertJsonPath('contacts', []);
        $this->getJson('/api/v1/identity/matrix/peers')->assertOk()->assertJsonPath('peers', []);
        $this->getJson('/api/v1/identity/people/'.$publicId)->assertNotFound();
        $this->getJson('/api/v1/identity/matrix/resolve/'.$publicId)->assertNotFound();
        $this->postJson('/api/v1/identity/contacts', ['publicId' => $publicId])->assertNotFound();
    }
}
