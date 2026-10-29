<?php

namespace Tests\Feature;

use Illuminate\Filesystem\FilesystemManager;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

final class PrototypeLibraryTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['prototype.enabled' => true]);
        Storage::fake('s3');
    }

    private function token(): string
    {
        return $this->postJson('/api/v1/prototype/libraries')->assertCreated()->json('accessCode');
    }

    private function headers(string $token): array
    {
        return ['Accept' => 'application/json', 'Authorization' => 'Bearer '.$token];
    }

    private function upload(string $token, string $id, string $content = 'synthetic-original')
    {
        return $this->post('/api/v1/prototype/photos', [
            'manifest' => json_encode(['id' => $id, 'createdAt' => 1791800000000, 'width' => 1600, 'height' => 1200, 'mime' => 'image/jpeg', 'method' => 'demo', 'title' => '', 'note' => '', 'favorite' => false]),
            'original' => UploadedFile::fake()->createWithContent('original', $content),
            'thumbnail' => UploadedFile::fake()->createWithContent('thumbnail', 'synthetic-thumbnail'),
        ], $this->headers($token));
    }

    public function test_production_and_disabled_mode_hide_every_prototype_route(): void
    {
        config(['prototype.enabled' => false]);
        $this->postJson('/api/v1/prototype/libraries')->assertNotFound();
        config(['prototype.enabled' => true]);
        $this->app->instance('env', 'production');
        $this->postJson('/api/v1/prototype/libraries')->assertNotFound();
        $this->getJson('/api/v1/prototype/photos')->assertNotFound();
    }

    public function test_upload_requires_access_and_libraries_are_isolated(): void
    {
        $a = $this->token();
        $b = $this->token();
        $id = (string) Str::uuid();
        $this->getJson('/api/v1/prototype/photos')->assertUnauthorized();
        $this->getJson('/api/v1/prototype/photos', $this->headers(str_repeat('a', 64)))->assertUnauthorized();
        $this->upload($a, $id)->assertOk()->assertJsonPath('photo.id', $id);
        $this->getJson('/api/v1/prototype/photos', $this->headers($b))->assertJsonCount(0, 'photos');
        $this->getJson('/api/v1/prototype/photos/'.$id.'/original', $this->headers($b))->assertNotFound();
        $this->patchJson('/api/v1/prototype/photos/'.$id, ['title' => 'forbidden', 'note' => '', 'favorite' => false, 'revision' => 1], $this->headers($b))->assertNotFound();
        $this->deleteJson('/api/v1/prototype/photos/'.$id, [], $this->headers($b))->assertOk();
        $this->getJson('/api/v1/prototype/photos/'.$id, $this->headers($a))->assertOk();
        $this->assertDatabaseHas('prototype_libraries', ['token_hash' => hash('sha256', $a)]);
        $this->assertDatabaseMissing('prototype_libraries', ['token_hash' => $a]);
    }

    public function test_retry_is_idempotent_but_cannot_replace_original(): void
    {
        $token = $this->token();
        $id = (string) Str::uuid();
        $first = $this->upload($token, $id)->assertOk()->json('photo');
        $this->upload($token, $id)->assertOk()->assertJsonPath('photo', $first);
        $this->assertDatabaseCount('prototype_photos', 1);
        $this->assertCount(2, Storage::disk('s3')->allFiles());
        $this->upload($token, $id, 'different-original')->assertConflict();
        $response = $this->get('/api/v1/prototype/photos/'.$id.'/original', $this->headers($token))->assertOk();
        $this->assertSame('synthetic-original', $response->streamedContent());
        $this->assertStringContainsString('no-store', $response->headers->get('Cache-Control'));
    }

    public function test_metadata_conflicts_do_not_silently_overwrite(): void
    {
        $token = $this->token();
        $id = (string) Str::uuid();
        $this->upload($token, $id)->assertOk();
        $this->patchJson('/api/v1/prototype/photos/'.$id, ['title' => 'Название', 'note' => 'Заметка', 'favorite' => true, 'revision' => 1], $this->headers($token))->assertOk()->assertJsonPath('photo.remoteRevision', 2);
        $this->patchJson('/api/v1/prototype/photos/'.$id, ['title' => 'Lost update', 'note' => '', 'favorite' => false, 'revision' => 1], $this->headers($token))->assertConflict();
        $this->upload($token, $id)->assertOk()->assertJsonPath('photo.title', 'Название');
    }

    public function test_delete_revokes_content_and_prevents_old_upload_resurrection(): void
    {
        $token = $this->token();
        $id = (string) Str::uuid();
        $this->upload($token, $id)->assertOk();
        $this->deleteJson('/api/v1/prototype/photos/'.$id, [], $this->headers($token))->assertOk()->assertJsonPath('deletion', 'verified');
        $this->getJson('/api/v1/prototype/photos/'.$id.'/original', $this->headers($token))->assertGone();
        $this->getJson('/api/v1/prototype/photos/'.$id.'/thumbnail', $this->headers($token))->assertGone();
        $this->upload($token, $id)->assertGone();
        $this->assertSame([], Storage::disk('s3')->allFiles());
        $this->getJson('/api/v1/prototype/photos', $this->headers($token))->assertJsonCount(0, 'photos')->assertJsonPath('deleted.0', $id);
        $unknown = (string) Str::uuid();
        $this->deleteJson('/api/v1/prototype/photos/'.$unknown, [], $this->headers($token))->assertOk();
        $this->upload($token, $unknown)->assertGone();
    }

    public function test_storage_failure_leaves_retryable_reservation_not_false_success(): void
    {
        $token = $this->token();
        $id = (string) Str::uuid();
        $disk = Storage::disk('s3');
        Storage::shouldReceive('disk')->once()->with('s3')->andThrow(new \RuntimeException('provider-secret'));
        $this->upload($token, $id)->assertStatus(503)->assertDontSee('provider-secret');
        $this->assertDatabaseHas('prototype_photos', ['id' => $id, 'state' => 'pending']);
        $this->getJson('/api/v1/prototype/photos', $this->headers($token))->assertJsonCount(0, 'photos');
        Storage::swap(new FilesystemManager($this->app));
        Storage::set('s3', $disk);
        $this->upload($token, $id)->assertOk();
        $this->assertDatabaseCount('prototype_photos', 1);
    }

    public function test_failed_deletion_denies_access_then_cleanup_retries(): void
    {
        $token = $this->token();
        $id = (string) Str::uuid();
        $this->upload($token, $id)->assertOk();
        $disk = Storage::disk('s3');
        Storage::shouldReceive('disk')->once()->with('s3')->andThrow(new \RuntimeException('provider-secret'));
        $this->deleteJson('/api/v1/prototype/photos/'.$id, [], $this->headers($token))->assertStatus(202)->assertJsonPath('deletion', 'pending');
        $this->getJson('/api/v1/prototype/photos/'.$id.'/original', $this->headers($token))->assertGone();
        Storage::swap(new FilesystemManager($this->app));
        Storage::set('s3', $disk);
        $this->travel(3)->seconds();
        $this->artisan('photobunker:prototype-cleanup')->assertSuccessful();
        $this->assertSame([], $disk->allFiles());
        $this->assertNotNull(DB::table('prototype_photos')->where('id', $id)->value('delete_verified_at'));
    }

    public function test_quota_and_abandoned_reservations_are_bounded(): void
    {
        $token = $this->token();
        config(['prototype.max_photos' => 1]);
        $id = (string) Str::uuid();
        $this->upload($token, $id)->assertOk();
        $this->upload($token, (string) Str::uuid())->assertStatus(413);
        DB::table('prototype_photos')->where('id', $id)->update(['state' => 'pending', 'created_at' => now()->subHours(2)]);
        $this->artisan('photobunker:prototype-cleanup')->assertSuccessful();
        $this->assertSame([], Storage::disk('s3')->allFiles());
        $this->upload($token, $id)->assertGone();
    }
}
