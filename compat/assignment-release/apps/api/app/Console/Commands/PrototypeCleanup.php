<?php

namespace App\Console\Commands;

use App\Prototype\Library;
use App\Prototype\Retention;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

final class PrototypeCleanup extends Command
{
    protected $signature = 'photobunker:prototype-cleanup';

    protected $description = 'Retry local prototype deletions and expire abandoned upload reservations';

    public function handle(): int
    {
        if (! app()->environment('local', 'testing') || ! config('prototype.enabled')) {
            return self::SUCCESS;
        }
        DB::table('prototype_photos')->whereIn('state', ['pending', 'active'])->where(function ($query): void {
            $query->where('expires_at', '<=', Retention::milliseconds())->orWhere(fn ($pending) => $pending->where('state', 'pending')->where('created_at', '<=', now()->subHour()));
        })->get()->each(function ($photo): void {
            DB::transaction(function () use ($photo): void {
                Library::lock($photo->library_id);
                $current = Library::photos($photo->library_id)->where('id', $photo->id)->first();
                if ($current && (Retention::expired($current) || $current->state === 'pending' && $current->created_at <= now()->subHour()->toDateTimeString())) {
                    Retention::revoke($photo->library_id, $photo->id);
                }
            });
        });
        DB::table('prototype_photos')->where('state', 'deleted')->whereNull('delete_verified_at')->where(fn ($query) => $query->whereNull('delete_retry_at')->orWhere('delete_retry_at', '<=', now()))->get()->each(function ($photo): void {
            Library::cleanup($photo->library_id, $photo->id);
        });

        DB::table('prototype_clock_anchors')->where('issued_at', '<', Retention::milliseconds() - 1209600000)->delete();

        return self::SUCCESS;
    }
}
