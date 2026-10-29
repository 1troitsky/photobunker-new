<?php

namespace App\Console\Commands;

use App\Identity\MatrixBridge;
use App\Identity\MatrixFailure;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

final class IdentityMaintain extends Command
{
    protected $signature = 'photobunker:identity-maintain {--health} {--diagnostics}';

    protected $description = 'Check Matrix readiness or retry durable provisioning/revocation intents without disclosing identities';

    public function handle(MatrixBridge $matrix): int
    {
        if (! app()->environment('local', 'testing')) {
            return self::FAILURE;
        }
        if ($this->option('health')) {
            $ready = $matrix->healthy();
            $this->line($ready ? 'Matrix client API ready.' : 'Matrix unavailable; camera/API remain independent.');

            return $ready ? self::SUCCESS : self::FAILURE;
        }
        $failed = 0;
        foreach (DB::table('identity_accounts')->whereNull('deletion_requested_at')->where('matrix_state', 'pending')->limit(50)->pluck('id') as $id) {
            try {
                $matrix->provision($id);
            } catch (\Throwable $error) {
                if ($this->option('diagnostics')) {
                    $this->line($error instanceof MatrixFailure ? $error->getMessage() : $error::class);
                }
                $failed++;
            }
        }
        foreach (DB::table('identity_devices')->where('matrix_revoke_pending', true)->limit(100)->pluck('id') as $id) {
            try {
                $matrix->revoke($id);
            } catch (\Throwable $error) {
                if ($this->option('diagnostics')) {
                    $this->line($error instanceof MatrixFailure ? $error->getMessage() : $error::class);
                }
                $failed++;
            }
        }
        DB::table('identity_challenges')->where('expires_at', '<', now()->subHour())->delete();
        DB::table('identity_sessions')->where('expires_at', '<', now())->delete();
        $this->line($failed ? 'Identity intents remain pending and will retry.' : 'Identity intents reconciled.');

        return $failed ? self::FAILURE : self::SUCCESS;
    }
}
