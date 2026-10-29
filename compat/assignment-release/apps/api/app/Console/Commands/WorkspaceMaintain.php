<?php

namespace App\Console\Commands;

use App\Encrypted\Maintenance;
use App\Encrypted\Objects;
use App\Identity\MatrixFailure;
use App\Prototype\Retention;
use App\Workspace\Discussions;
use App\Workspace\Photos;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

final class WorkspaceMaintain extends Command
{
    protected $signature = 'photobunker:workspace-maintain {--diagnostics} {--assignment=}';

    protected $description = 'Reconcile assignment discussions and clean expired account material';

    public function handle(Discussions $discussions, Photos $photos): int
    {
        if (! app()->environment('local', 'testing') || ! config('identity.enabled')) {
            return self::SUCCESS;
        }
        $records = DB::table('workspace_records')->where('kind', 'task')->where('room_state', '!=', 'none');
        if ($this->option('assignment')) {
            $records->where('id', $this->option('assignment'));
        } else {
            $records->where(fn ($q) => $q->whereNull('room_retry_at')->orWhere('room_retry_at', '<=', now()));
        }
        foreach ($records->limit(100)->get() as $row) {
            try {
                $discussions->reconcile($row->id);
            } catch (\Throwable $error) {
                if ($this->option('diagnostics')) {
                    $stage = preg_match('/^workspace\.reconcile\.[a-z]+$/D', $error->getMessage()) ? $error->getMessage() : 'workspace.reconcile_failed';
                    $cause = $error->getPrevious() ?? $error;
                    $code = $cause instanceof MatrixFailure && preg_match('/^matrix\.[a-zA-Z_]+\.[0-9]{3}\.M_[A-Z_]+/', $cause->getMessage(), $match) ? $match[0] : 'failed';
                    $this->line($stage.':'.$code);
                }
            }
        }
        foreach (DB::table('workspace_photos')->whereNull('delete_verified_at')->where(fn ($q) => $q->where('state', 'deleted')->orWhere('expires_at', '<=', Retention::milliseconds())->orWhere(fn ($q) => $q->where('state', 'pending')->where('created_at', '<=', now()->subDay())))->limit(100)->get() as $row) {
            DB::table('workspace_photos')->where('id', $row->id)->update(['state' => 'deleted']);
            $photos->cleanup($row);
        }
        foreach (DB::table('encrypted_photos')->whereNull('delete_verified_at')->where(fn ($q) => $q->where('state', 'deleted')->orWhere('expires_at', '<=', Retention::milliseconds()))->limit(100)->get() as $row) {
            DB::transaction(function () use ($row) {
                $vault = DB::table('workspace_vaults')->find($row->vault_id);
                if (! $vault) {
                    return;
                }DB::table('identity_accounts')->where('id', $vault->owner_id)->lockForUpdate()->first();
                DB::table('workspace_vaults')->where('id', $vault->id)->lockForUpdate()->first();
                DB::table('encrypted_photos')->where('id', $row->id)->lockForUpdate()->first();
                DB::table('encrypted_photos')->where('id', $row->id)->update(['state' => 'deleted']);
            });
            app(Objects::class)->cleanup($row);
        }
        DB::table('encrypted_deletions')->where('expires_at', '<=', Retention::milliseconds())->delete();
        foreach (['photo_read_sessions', 'photo_read_challenges', 'photo_device_links'] as $table) {
            DB::table($table)->where('expires_at', '<=', now())->delete();
        }
        DB::table('workspace_clock_anchors')->where('issued_at', '<', Retention::milliseconds() - 1209600000)->delete();
        app(Maintenance::class)->orphans();
        $this->line('Workspace reconciliation finished.');

        return self::SUCCESS;
    }
}
