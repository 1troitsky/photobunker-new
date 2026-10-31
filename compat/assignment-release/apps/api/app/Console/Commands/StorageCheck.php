<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

final class StorageCheck extends Command
{
    protected $signature = 'photobunker:storage-check
        {--disk=s3 : Configured storage disk to check}
        {--signed : Also verify short-lived presigned PUT/GET and anonymous denial}';

    protected $description = 'Check private storage with a synthetic fixture, then delete and verify cleanup';

    public function handle(): int
    {
        $key = 'diagnostics/'.Str::uuid();
        $fixture = random_bytes(64);
        $disk = null;
        $failed = false;

        try {
            $disk = Storage::disk((string) $this->option('disk'));

            if (! $disk->put($key, $fixture)
                || ! $disk->exists($key)
                || $disk->size($key) !== strlen($fixture)
                || ! hash_equals($fixture, $disk->get($key))) {
                throw new RuntimeException('storage.operation_failed');
            }

            if ($this->option('signed')) {
                $upload = $disk->temporaryUploadUrl($key, now()->addSeconds(30));
                $put = Http::connectTimeout(3)->timeout(10)
                    ->withHeaders($upload['headers'])->withBody($fixture, 'application/octet-stream')
                    ->put($upload['url']);

                if (! $put->successful()) {
                    throw new RuntimeException('storage.signed_put_failed');
                }

                $url = $disk->temporaryUrl($key, now()->addSeconds(30));
                $response = Http::connectTimeout(3)->timeout(10)->get($url);

                if (! $response->successful() || ! hash_equals($fixture, $response->body())) {
                    throw new RuntimeException('storage.signed_get_failed');
                }

                $unsignedUrl = explode('?', $url, 2)[0];
                $anonymous = Http::connectTimeout(3)->timeout(10)->get($unsignedUrl);

                if (! in_array($anonymous->status(), [401, 403], true)) {
                    throw new RuntimeException('storage.anonymous_read_not_denied');
                }
            }
        } catch (Throwable) {
            // Provider messages may contain credentials or signed request URLs.
            $this->error('Storage check failed. Check private local configuration and provider availability.');
            $failed = true;
        } finally {
            if ($disk !== null) {
                try {
                    if (! $disk->delete($key) || $disk->exists($key)) {
                        throw new RuntimeException('storage.cleanup_failed');
                    }
                } catch (Throwable) {
                    // Opaque diagnostic key is safe and lets an operator clean up.
                    $this->error('Synthetic fixture cleanup failed: '.$key);
                    $failed = true;
                }
            }
        }

        if ($failed) {
            return self::FAILURE;
        }

        $this->info('Storage PUT, HEAD, GET, DELETE and cleanup verification passed.'
            .($this->option('signed') ? ' Presigned PUT/GET and anonymous denial passed.' : ''));

        return self::SUCCESS;
    }
}
