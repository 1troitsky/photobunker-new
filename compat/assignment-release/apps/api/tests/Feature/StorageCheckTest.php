<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Mockery;
use RuntimeException;
use Tests\TestCase;

final class StorageCheckTest extends TestCase
{
    public function test_storage_probe_deletes_its_synthetic_fixture(): void
    {
        $disk = Storage::fake('probe');

        $this->artisan('photobunker:storage-check', ['--disk' => 'probe'])
            ->expectsOutput('Storage PUT, HEAD, GET, DELETE and cleanup verification passed.')
            ->assertExitCode(0);

        $this->assertSame([], $disk->allFiles());
    }

    public function test_failure_still_cleans_up_and_hides_provider_secrets(): void
    {
        $disk = Mockery::mock();
        $disk->shouldReceive('put')->once()->andReturnTrue();
        $disk->shouldReceive('exists')->once()->andThrow(new RuntimeException('private-provider-secret'));
        $disk->shouldReceive('delete')->once()->andReturnTrue();
        $disk->shouldReceive('exists')->once()->andReturnFalse();
        Storage::shouldReceive('disk')->with('broken')->once()->andReturn($disk);

        $this->artisan('photobunker:storage-check', ['--disk' => 'broken'])
            ->expectsOutput('Storage check failed. Check private local configuration and provider availability.')
            ->doesntExpectOutput('private-provider-secret')
            ->assertExitCode(1);
    }

    public function test_signed_requests_and_private_access_are_verified_before_cleanup(): void
    {
        $disk = Mockery::mock();
        $fixture = null;
        $disk->shouldReceive('put')->once()->withArgs(function (string $key, string $bytes) use (&$fixture): bool {
            $fixture = $bytes;

            return str_starts_with($key, 'diagnostics/');
        })->andReturnTrue();
        $disk->shouldReceive('exists')->once()->andReturnTrue();
        $disk->shouldReceive('size')->once()->andReturn(64);
        $disk->shouldReceive('get')->once()->andReturnUsing(function () use (&$fixture) {
            return $fixture;
        });
        $url = 'http://local-storage/test?synthetic-signature';
        $disk->shouldReceive('temporaryUploadUrl')->once()->andReturn(['url' => $url, 'headers' => []]);
        $disk->shouldReceive('temporaryUrl')->once()->withArgs(function (string $key, $expiry): bool {
            return str_starts_with($key, 'diagnostics/') && now()->diffInSeconds($expiry) <= 30;
        })->andReturn($url);
        $disk->shouldReceive('delete')->once()->andReturnTrue();
        $disk->shouldReceive('exists')->once()->andReturnFalse();
        Storage::shouldReceive('disk')->with('probe')->once()->andReturn($disk);
        Http::fake(function ($request) use (&$fixture) {
            return match (true) {
                $request->method() === 'PUT' => Http::response('', 200),
                $request->url() === 'http://local-storage/test' => Http::response('', 403),
                default => Http::response($fixture, 200),
            };
        });

        $this->artisan('photobunker:storage-check', ['--disk' => 'probe', '--signed' => true])
            ->assertExitCode(0);

        Http::assertSentCount(3);
    }
}
