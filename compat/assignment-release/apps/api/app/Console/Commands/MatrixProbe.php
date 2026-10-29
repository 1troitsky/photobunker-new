<?php

namespace App\Console\Commands;

use App\Encrypted\Objects;
use App\Identity\MatrixBridge;
use App\Workspace\Photos;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

final class MatrixProbe extends Command
{
    protected $signature = 'photobunker:matrix-probe {account} {--device=} {--restore-url=} {--cleanup} {--fingerprint=}';

    protected $description = 'Probe restored Matrix identity or clean a precisely identified synthetic QA account';

    public function handle(MatrixBridge $matrix): int
    {
        if (! app()->environment('local', 'testing')) {
            return self::FAILURE;
        }
        $id = $this->argument('account');
        $account = DB::table('identity_accounts')->find($id);
        if (! $account) {
            return $this->option('cleanup') ? self::SUCCESS : self::FAILURE;
        }
        if ($this->option('cleanup')) {
            $devices = DB::table('identity_devices')->where('account_id', $id)->pluck('name');
            if (! hash_equals($account->key_fingerprint, (string) $this->option('fingerprint')) || $devices->isEmpty() || $devices->contains(fn ($name) => ! str_starts_with($name, 'QA ')) || DB::table('identity_legacy_claims')->where('account_id', $id)->exists()) {
                $this->error('Synthetic cleanup ownership check failed.');

                return self::FAILURE;
            }
            try {
                foreach (DB::table('encrypted_photos')->where('creator_id', $id)->orWhereIn('vault_id', DB::table('workspace_vaults')->where('owner_id', $id)->select('id'))->get() as $photo) {
                    DB::table('encrypted_photos')->where('id', $photo->id)->update(['state' => 'deleted']);
                    if (! app(Objects::class)->cleanup($photo)) {
                        throw new \RuntimeException('cleanup.pending');
                    }
                    DB::table('encrypted_photos')->where('id', $photo->id)->delete();
                }
                app(Photos::class)->cleanupAccount($id);
                $matrix->deleteSyntheticAccount($id);
                DB::table('identity_accounts')->where('id', $id)->delete();
            } catch (\Throwable) {
                $this->error('Synthetic cleanup remains pending.');

                return self::FAILURE;
            }
            $this->line('Synthetic account cleanup verified.');

            return self::SUCCESS;
        }
        $url = $this->option('restore-url');
        if (! is_string($url) || ! preg_match('#^http://photobunker-matrix-restore-qa-[a-f0-9]+:8008$#D', $url)) {
            return self::FAILURE;
        }
        config(['identity.matrix_url' => $url]);
        try {
            $result = $matrix->session($id, $this->option('device'));
            if ($result['userId'] !== $matrix->mxid($id)) {
                return self::FAILURE;
            }
        } catch (\Throwable) {
            $this->error('Restored Matrix probe failed.');

            return self::FAILURE;
        } finally {
            $matrix->forgetSessionCache((string) $this->option('device'));
        }
        $this->line('Restored Matrix identity and device login verified.');

        return self::SUCCESS;
    }
}
