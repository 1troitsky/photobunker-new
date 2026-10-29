<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Storage;
use Mockery;
use Tests\TestCase;

final class StorageConfigureTest extends TestCase
{
    public function test_storage_configuration_is_rejected_in_production(): void
    {
        $this->app['env'] = 'production';
        Storage::shouldReceive('disk')->never();

        $this->artisan('photobunker:storage-configure')
            ->expectsOutput('Storage configuration is restricted to local development.')
            ->assertExitCode(1);
    }

    public function test_wildcard_origins_are_rejected_without_contacting_storage(): void
    {
        config(['filesystems.cors_allowed_origins' => ['*']]);
        Storage::shouldReceive('disk')->never();

        $this->artisan('photobunker:storage-configure')
            ->expectsOutput('AWS_CORS_ALLOWED_ORIGINS must contain explicit HTTP origins.')
            ->assertExitCode(1);
    }

    public function test_explicit_local_origins_get_narrow_methods_and_etag_exposure(): void
    {
        $origins = ['http://localhost:8080', 'https://photobunker.orb.local'];
        config(['filesystems.cors_allowed_origins' => $origins]);
        $client = Mockery::mock();
        $client->shouldReceive('putBucketCors')->once()->with([
            'Bucket' => config('filesystems.disks.s3.bucket'),
            'CORSConfiguration' => [
                'CORSRules' => [[
                    'AllowedOrigins' => $origins,
                    'AllowedMethods' => ['GET', 'HEAD', 'PUT'],
                    'AllowedHeaders' => ['Content-Type', 'Content-MD5', 'x-amz-*'],
                    'ExposeHeaders' => ['ETag', 'x-amz-checksum-sha256'],
                    'MaxAgeSeconds' => 600,
                ]],
            ],
        ])->andReturnNull();
        $disk = Mockery::mock();
        $disk->shouldReceive('getClient')->once()->andReturn($client);
        Storage::shouldReceive('disk')->with('s3')->once()->andReturn($disk);

        $this->artisan('photobunker:storage-configure')
            ->expectsOutput('Local storage CORS configured.')
            ->assertExitCode(0);
    }
}
