<?php

namespace Tests\Feature;

use Illuminate\Filesystem\FilesystemManager;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

final class PrototypeRetentionTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['prototype.enabled' => true]);
        Storage::fake('s3');
        $this->travelTo(now()->startOfSecond());
    }

    private function access(): array
    {
        $code = $this->postJson('/api/v1/prototype/libraries')->assertCreated()->json('accessCode');

        return ['Authorization' => 'Bearer '.$code];
    }

    private function manifest(array $headers): array
    {
        $anchor = $this->postJson('/api/v1/prototype/clock', [], $headers)->assertOk()->json();

        return ['id' => (string) Str::uuid(), 'createdAt' => now()->getTimestampMs(), 'width' => 800, 'height' => 600,
            'mime' => 'image/jpeg', 'method' => 'demo', 'title' => 'Synthetic title', 'note' => 'Synthetic note', 'favorite' => false,
            'retentionSeconds' => 3600, 'retentionAnchor' => $anchor['id']];
    }

    private function upload(array $headers, array $manifest)
    {
        return $this->post('/api/v1/prototype/photos', [
            'manifest' => json_encode($manifest),
            'original' => UploadedFile::fake()->createWithContent('original', 'synthetic-original'),
            'thumbnail' => UploadedFile::fake()->createWithContent('thumbnail', 'synthetic-thumbnail'),
        ], $headers);
    }

    public function test_offline_delay_and_retries_never_restart_capture_lifetime(): void
    {
        $headers = $this->access();
        $manifest = $this->manifest($headers);
        $deadline = $manifest['createdAt'] + 3600000;
        $this->travel(20)->minutes();
        $this->upload($headers, $manifest)->assertOk()->assertJsonPath('photo.expiresAt', $deadline);
        $this->travel(10)->minutes();
        $this->upload($headers, $manifest)->assertOk()->assertJsonPath('photo.expiresAt', $deadline);
        $this->assertDatabaseCount('prototype_photos', 1);
        $this->assertCount(2, Storage::disk('s3')->allFiles());
        // A client clock far ahead cannot increase the anchor's bound.
        $manifest['id'] = (string) Str::uuid();
        $manifest['createdAt'] += 86400000;
        $this->upload($headers, $manifest)->assertOk()->assertJsonPath('photo.expiresAt', $deadline);
    }

    public function test_expiry_closes_every_endpoint_before_cleanup_and_prevents_resurrection(): void
    {
        $headers = $this->access();
        $manifest = $this->manifest($headers);
        $this->upload($headers, $manifest)->assertOk();
        $this->travel(1)->hours();
        $path = '/api/v1/prototype/photos/'.$manifest['id'];
        foreach (['', '/original', '/thumbnail'] as $suffix) {
            $this->getJson($path.$suffix, $headers)->assertGone();
        }
        $this->patchJson($path, ['title' => '', 'note' => '', 'favorite' => false, 'revision' => 1], $headers)->assertGone();
        $this->upload($headers, $manifest)->assertGone();
        $this->getJson('/api/v1/prototype/photos', $headers)->assertJsonCount(0, 'photos')->assertJsonPath('deleted.0', $manifest['id']);
        $this->assertCount(2, Storage::disk('s3')->allFiles());
        $this->artisan('photobunker:prototype-cleanup')->assertSuccessful();
        $this->assertSame([], Storage::disk('s3')->allFiles());
        $this->assertDatabaseHas('prototype_photos', ['id' => $manifest['id'], 'state' => 'deleted', 'title' => '', 'note' => '', 'metadata' => null]);
        $this->upload($headers, $manifest)->assertGone();
    }

    public function test_expired_offline_capture_is_never_stored_and_anchor_is_scoped(): void
    {
        $headers = $this->access();
        $manifest = $this->manifest($headers);
        $this->upload($this->access(), $manifest)->assertUnprocessable();
        $this->upload($headers, [...$manifest, 'retentionSeconds' => 1209601])->assertUnprocessable();
        $withoutAnchor = $manifest;
        unset($withoutAnchor['retentionAnchor']);
        $this->upload($headers, $withoutAnchor)->assertUnprocessable();
        $this->travel(1)->hours();
        $this->upload($headers, $manifest)->assertGone();
        $this->assertDatabaseCount('prototype_photos', 0);
        $this->assertSame([], Storage::disk('s3')->allFiles());
    }

    public function test_deadline_only_shortens_and_old_retry_cannot_extend_it(): void
    {
        $headers = $this->access();
        $manifest = $this->manifest($headers);
        $this->upload($headers, $manifest)->assertOk();
        $path = '/api/v1/prototype/photos/'.$manifest['id'];
        $changes = ['title' => $manifest['title'], 'note' => $manifest['note'], 'favorite' => false, 'revision' => 1];
        $this->patchJson($path, [...$changes, 'expiresAt' => now()->getTimestampMs() + 3600001], $headers)->assertUnprocessable();
        $deadline = now()->getTimestampMs() + 5000;
        $this->patchJson($path, [...$changes, 'expiresAt' => $deadline], $headers)->assertOk()->assertJsonPath('photo.expiresAt', $deadline);
        $this->upload($headers, $manifest)->assertOk()->assertJsonPath('photo.expiresAt', $deadline);
        $this->patchJson($path, [...$changes, 'revision' => 2, 'expiresAt' => $deadline + 1], $headers)->assertUnprocessable();
        $this->travel(5)->seconds();
        $this->getJson($path, $headers)->assertGone();
    }

    public function test_failed_expiry_cleanup_retries_with_backoff_without_reopening_access(): void
    {
        $headers = $this->access();
        $manifest = $this->manifest($headers);
        $this->upload($headers, $manifest)->assertOk();
        $disk = Storage::disk('s3');
        $this->travel(1)->hours();
        Storage::shouldReceive('disk')->once()->with('s3')->andThrow(new \RuntimeException('synthetic-provider-failure'));
        $this->artisan('photobunker:prototype-cleanup')->assertSuccessful();
        $this->assertDatabaseHas('prototype_photos', ['id' => $manifest['id'], 'state' => 'deleted', 'delete_attempts' => 1, 'delete_verified_at' => null]);
        Storage::swap(new FilesystemManager($this->app));
        Storage::set('s3', $disk);
        $this->artisan('photobunker:prototype-cleanup')->assertSuccessful();
        $this->assertCount(2, $disk->allFiles());
        $this->getJson('/api/v1/prototype/photos/'.$manifest['id'].'/original', $headers)->assertGone();
        $this->travel(3)->seconds();
        $this->artisan('photobunker:prototype-cleanup')->assertSuccessful();
        $this->assertSame([], $disk->allFiles());
        $this->assertNotNull(DB::table('prototype_photos')->where('id', $manifest['id'])->value('delete_verified_at'));
        $this->deleteJson('/api/v1/prototype/photos/'.$manifest['id'], [], $headers)->assertOk()->assertJsonPath('deletion', 'verified');
    }

    public function test_transfer_checksum_failure_does_not_reserve_or_confirm_a_photo(): void
    {
        $headers = $this->access();
        $manifest = [...$this->manifest($headers), 'originalChecksum' => hash('sha256', 'synthetic-original'), 'thumbnailChecksum' => hash('sha256', 'synthetic-thumbnail')];
        $this->upload($headers, [...$manifest, 'originalChecksum' => str_repeat('0', 64)])->assertStatus(503);
        $this->assertDatabaseCount('prototype_photos', 0);
        $this->assertSame([], Storage::disk('s3')->allFiles());
        $this->upload($headers, $manifest)->assertOk();
        $this->upload($headers, $manifest)->assertOk();
        $this->assertDatabaseCount('prototype_photos', 1);
    }
}
