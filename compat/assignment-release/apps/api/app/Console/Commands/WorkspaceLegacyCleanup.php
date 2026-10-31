<?php

namespace App\Console\Commands;

use App\Prototype\Library;
use App\Prototype\Retention;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

final class WorkspaceLegacyCleanup extends Command
{
    protected $signature = 'photobunker:workspace-legacy-cleanup {account} {--fingerprint=} {--library=} {--library-fingerprint=} {--photo=}';

    protected $description = 'Remove only an exactly identified synthetic legacy import fixture';

    public function handle(): int
    {
        if (! app()->environment('local', 'testing')) {
            return self::FAILURE;
        }
        $account = DB::table('identity_accounts')->find($this->argument('account'));
        $devices = $account ? DB::table('identity_devices')->where('account_id', $account->id)->pluck('name') : collect();
        if (! $account || ! hash_equals($account->key_fingerprint, (string) $this->option('fingerprint')) || $devices->isEmpty() || $devices->contains(fn ($name) => ! str_starts_with($name, 'QA '))) {
            return self::FAILURE;
        }
        $id = $this->option('library');
        $library = DB::table('prototype_libraries')->find($id);
        if (! $library) {
            return self::SUCCESS;
        }
        if (! hash_equals($library->token_hash, (string) $this->option('library-fingerprint'))
            || DB::table('identity_legacy_claims')->where('library_id', $id)->where('account_id', '!=', $account->id)->exists()
            || DB::table('prototype_profiles')->where('library_id', $id)->exists()
            || DB::table('prototype_spaces')->where('owner_id', $id)->exists()
            || Library::photos($id)->where('id', '!=', $this->option('photo'))->exists()) {
            return self::FAILURE;
        }
        try {
            if (Library::photos($id)->where('id', $this->option('photo'))->exists()) {
                DB::transaction(function () use ($id) {
                    Library::lock($id);
                    Retention::revoke($id, $this->option('photo'));
                });
                if (! Library::cleanup($id, $this->option('photo'))) {
                    return self::FAILURE;
                }
            }
            DB::transaction(function () use ($id, $account) {
                Library::lock($id);
                Library::photos($id)->delete();
                DB::table('prototype_deletions')->where('library_id', $id)->delete();
                DB::table('prototype_clock_anchors')->where('library_id', $id)->delete();
                DB::table('identity_legacy_claims')->where('library_id', $id)->where('account_id', $account->id)->delete();
                DB::table('prototype_libraries')->where('id', $id)->delete();
            });
        } catch (\Throwable) {
            return self::FAILURE;
        }
        $this->line('Precisely identified legacy fixture cleanup verified.');

        return self::SUCCESS;
    }
}
