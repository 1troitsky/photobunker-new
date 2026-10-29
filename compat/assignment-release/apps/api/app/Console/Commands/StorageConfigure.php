<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;
use Throwable;

final class StorageConfigure extends Command
{
    protected $signature = 'photobunker:storage-configure';

    protected $description = 'Configure CORS for the local development S3 bucket';

    public function handle(): int
    {
        if (! app()->environment(['local', 'testing'])) {
            $this->error('Storage configuration is restricted to local development.');

            return self::FAILURE;
        }

        $origins = config('filesystems.cors_allowed_origins');

        if (! is_array($origins) || $origins === []) {
            $this->error('Configure AWS_CORS_ALLOWED_ORIGINS before configuring storage.');

            return self::FAILURE;
        }

        foreach ($origins as $origin) {
            $parts = parse_url($origin);

            if (! is_array($parts)
                || ! in_array($parts['scheme'] ?? '', ['http', 'https'], true)
                || ! isset($parts['host'])
                || (isset($parts['user']) || isset($parts['pass']))
                || isset($parts['query']) || isset($parts['fragment'])
                || ! in_array($parts['path'] ?? '', ['', '/'], true)) {
                $this->error('AWS_CORS_ALLOWED_ORIGINS must contain explicit HTTP origins.');

                return self::FAILURE;
            }
        }

        try {
            $disk = Storage::disk('s3');
            $disk->getClient()->putBucketCors([
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
            ]);
        } catch (Throwable) {
            $this->error('Local storage CORS configuration failed. Check the private storage configuration.');

            return self::FAILURE;
        }

        $this->info('Local storage CORS configured.');

        return self::SUCCESS;
    }
}
