<?php

namespace App\Encrypted;

use App\Http\Controllers\PhotoShareController;
use App\Prototype\Retention;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

final class Maintenance
{
    // A ciphertext written immediately before a database failure has no reference.
    // A full-day grace protects writes in flight; live/pending references are kept.
    public function orphans(): void
    {
        foreach (DB::table('encrypted_shares')->whereNotNull('revoked_at')->orWhere('expires_at', '<=', Retention::milliseconds())->get() as $share) {
            app(PhotoShareController::class)->cleanup($share);
        }
        try {
            $disk = Storage::disk(config('prototype.disk'));
            $removed = 0;
            foreach ($disk->allFiles('encrypted') as $path) {
                if (! preg_match('#^encrypted/[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}$#D', $path) || DB::table('encrypted_objects')->where('object_key', $path)->exists() || $disk->lastModified($path) > now()->subDay()->getTimestamp()) {
                    continue;
                }$disk->delete($path);
                if (++$removed >= 100) {
                    break;
                }
            }
        } catch (\Throwable) {/* Next scheduled maintenance retries without exposing storage errors. */
        }
    }
}
