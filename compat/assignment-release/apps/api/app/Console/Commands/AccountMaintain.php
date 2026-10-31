<?php

namespace App\Console\Commands;

use App\Identity\AccountLifecycle;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class AccountMaintain extends Command
{
    protected $signature = 'photobunker:account-maintain {--account=}';

    protected $description = 'Revoke expired accounts and retry verified deletion without disclosing user data';

    public function handle(AccountLifecycle $lifecycle): int
    {
        if (! config('identity.enabled')) {
            return self::SUCCESS;
        }
        $scope = DB::table('identity_accounts');
        if ($this->option('account')) {
            if (! Str::isUuid($this->option('account'))) {
                return self::FAILURE;
            }
            $scope->where('id', $this->option('account'));
        }
        foreach ((clone $scope)->whereNull('deletion_requested_at')->where('inactivity_delete_at', '<=', now())->limit(100)->pluck('id') as $id) {
            $lifecycle->claim($id, true);
        }
        $pending = 0;
        foreach ((clone $scope)->whereNotNull('deletion_requested_at')->where('deletion_retry_at', '<=', now())->limit(50)->pluck('id') as $id) {
            if (! $lifecycle->erase($id)) {
                $pending++;
            }
        }
        // A process may crash after the account row is physically removed
        // but before the retained emergency receipt's completedAt is set.
        // Account absence is definitive ONLY after lifecycle erase() removed
        // that account; claim() never deletes the row.
        DB::table('identity_emergency_receipts')
            ->whereNull('completed_at')
            ->whereNotIn('account_id', DB::table('identity_accounts')->select('id'))
            ->update(['completed_at' => now()]);
        $this->line($pending ? 'Account cleanup pending; automatic retries scheduled.' : 'Account lifecycle reconciled.');

        return self::SUCCESS;
    }
}
