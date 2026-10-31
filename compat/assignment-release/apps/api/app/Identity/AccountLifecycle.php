<?php

namespace App\Identity;

use App\Encrypted\Objects;
use App\Http\Controllers\PhotoShareController;
use App\Prototype\Library;
use App\Prototype\Retention;
use App\Rtc\Admissions;
use App\Workspace\Photos;
use Carbon\Carbon;
use Closure;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

final class AccountLifecycle
{
    public static function unavailable(object $account): bool
    {
        return $account->deletion_requested_at !== null || ($account->inactivity_delete_at !== null && Carbon::parse($account->inactivity_delete_at)->lte(now()));
    }

    public function activity(string $id, ?int $days = null): object
    {
        return DB::transaction(function () use ($id, $days) {
            $account = DB::table('identity_accounts')->where('id', $id)->lockForUpdate()->first();
            abort_unless($account && ! self::unavailable($account), 410);
            DB::table('identity_accounts')->where('id', $id)->update(['inactivity_days' => $days ?? $account->inactivity_days, 'last_active_at' => now(), 'inactivity_delete_at' => now()->addDays($days ?? $account->inactivity_days)]);

            return DB::table('identity_accounts')->find($id);
        });
    }

    public function claim(string $id, bool $inactive = false, string $reason = 'user', ?Closure $beforeClaim = null): bool
    {
        return Cache::lock('identity:account-write:'.$id, 120)->block(10, fn () => DB::transaction(function () use ($id, $inactive, $reason, $beforeClaim) {
            $account = DB::table('identity_accounts')->where('id', $id)->lockForUpdate()->first();
            if (! $account || $account->deletion_requested_at) {
                return false;
            }
            // Recheck under the same lock as activity/login; the scanner is only a hint.
            if ($inactive && (! $account->inactivity_delete_at || Carbon::parse($account->inactivity_delete_at)->gt(now()))) {
                return false;
            }
            abort_unless(in_array($reason, ['user', 'inactivity', 'emergency'], true), 422);
            // The emergency receipt is inserted in this SAME transaction and
            // account write-lock as revoking every device/session/read grant.
            if ($beforeClaim !== null) {
                $beforeClaim($account);
            }
            DB::table('identity_accounts')->where('id', $id)->update(['deletion_requested_at' => now(), 'deletion_reason' => $inactive ? 'inactivity' : $reason, 'deletion_retry_at' => now()]);
            $devices = DB::table('identity_devices')->where('account_id', $id)->pluck('id');
            DB::table('identity_sessions')->whereIn('device_id', $devices)->delete();
            DB::table('identity_devices')->where('account_id', $id)->update(['revoked_at' => now(), 'matrix_revoke_pending' => true]);
            DB::table('identity_presence_leases')->whereIn('device_id', $devices)->delete();
            DB::table('photo_read_sessions')->where('account_id', $id)->delete();
            DB::table('photo_device_links')->where('account_id', $id)->delete();
            $photos = $this->photos($id)->pluck('id');
            DB::table('encrypted_photos')->whereIn('id', $photos)->update(['state' => 'deleted']);
            DB::table('encrypted_shares')->where(fn ($q) => $q->where('creator_id', $id)->orWhereIn('photo_id', $photos))->update(['revoked_at' => now()]);
            $this->legacyPhotos($id)->update(['state' => 'deleted']);
            DB::table('workspace_records')->where('owner_id', $id)->update(['deleted_at' => now()]);
            DB::table('workspace_members')->where('account_id', $id)->delete();
            DB::table('identity_contacts')->where('requester', $id)->orWhere('recipient', $id)->delete();
            DB::table('identity_blocks')->where('account_id', $id)->orWhere('blocked_id', $id)->delete();
            DB::table('account_recovery_bundles')->where('account_id', $id)->delete();
            $libraries = DB::table('identity_legacy_claims')->where('account_id', $id)->pluck('library_id');
            if ($libraries->isNotEmpty()) {
                $spaces = DB::table('prototype_spaces')->whereIn('owner_id', $libraries)->pluck('id');
                DB::table('prototype_photos')->whereIn('library_id', $libraries)->orWhereIn('creator_id', $libraries)->orWhereIn('space_id', $spaces)->update(['state' => 'deleted']);
                DB::table('prototype_members')->whereIn('space_id', $spaces)->orWhereIn('actor_id', $libraries)->update(['active' => false]);
                DB::table('prototype_invitations')->whereIn('space_id', $spaces)->orWhereIn('accepted_by', $libraries)->update(['revoked' => true]);
            }

            return true;
        }));
    }

    public function photos(string $id): Builder
    {
        return DB::table('encrypted_photos')->where(fn ($q) => $q->where('creator_id', $id)->orWhereIn('vault_id', DB::table('workspace_vaults')->where('owner_id', $id)->select('id')));
    }

    private function legacyPhotos(string $id): Builder
    {
        return DB::table('workspace_photos')->where(fn ($q) => $q->where('creator_id', $id)->orWhereIn('vault_id', DB::table('workspace_vaults')->where('owner_id', $id)->select('id')));
    }

    // Keep the account and all object references until storage and Matrix acknowledge
    // cleanup. Every step can be repeated after a crash or a provider outage.
    public function erase(string $id): bool
    {
        return Cache::lock('identity:erase:'.$id, 300)->get(function () use ($id) {
            $account = DB::table('identity_accounts')->find($id);
            if (! $account || ! $account->deletion_requested_at) {
                return true;
            }
            try {
                foreach (DB::table('rtc_admissions')->where('account_id', $id)->whereNull('removed_at')->get() as $ticket) {
                    if (! app(Admissions::class)->remove($ticket)) {
                        throw new \RuntimeException('account.cleanup_pending');
                    }
                }
                if (! $account->matrix_erased_at) {
                    Cache::lock('matrix:account:'.$id, 120)->block(10, fn () => app(MatrixBridge::class)->eraseAccount($id));
                    DB::table('identity_accounts')->where('id', $id)->update(['matrix_erased_at' => now()]);
                }
                foreach ($this->photos($id)->limit(100)->get() as $photo) {
                    if (! app(Objects::class)->cleanup($photo)) {
                        throw new \RuntimeException('account.cleanup_pending');
                    }
                    DB::table('encrypted_photos')->where('id', $photo->id)->delete();
                }
                foreach ($this->legacyPhotos($id)->limit(100)->get() as $photo) {
                    if (! app(Photos::class)->cleanup($photo)) {
                        throw new \RuntimeException('account.cleanup_pending');
                    }
                    DB::table('workspace_photos')->where('id', $photo->id)->delete();
                }
                // Edits/links made on somebody else's photos belong to the deleting
                // account; keep the original and the other owner's versions.
                foreach (DB::table('encrypted_shares')->where('creator_id', $id)->get() as $share) {
                    if (! app(PhotoShareController::class)->cleanup($share)) {
                        throw new \RuntimeException('account.cleanup_pending');
                    }
                    DB::table('encrypted_shares')->where('id', $share->id)->delete();
                }
                foreach (DB::table('encrypted_versions')->where('creator_id', $id)->get() as $version) {
                    foreach ([$version->image_id, $version->metadata_id] as $objectId) {
                        $object = DB::table('encrypted_objects')->find($objectId);
                        if ($object) {
                            $this->deleteObject($object->object_key);
                        }
                    }
                    DB::transaction(function () use ($version) {
                        DB::table('encrypted_versions')->where('id', $version->id)->delete();
                        DB::table('encrypted_objects')->whereIn('id', [$version->image_id, $version->metadata_id])->delete();
                    });
                }
                $this->erasePrototypeClaims($id);
                if ($this->photos($id)->exists() || $this->legacyPhotos($id)->exists()) {
                    DB::table('identity_accounts')->where('id', $id)->update(['deletion_retry_at' => now()]);

                    return false;
                }
                // Include ciphertext written before a failed DB transaction,
                // even if it never acquired an encrypted_objects reference.
                $disk = Storage::disk(config('prototype.disk'));
                foreach (DB::table('workspace_vaults')->where('owner_id', $id)->pluck('id') as $vault) {
                    $prefix = 'encrypted/'.$vault;
                    foreach ($disk->allFiles($prefix) as $path) {
                        $this->deleteObject($path);
                    }
                    if ($disk->allFiles($prefix)) {
                        throw new \RuntimeException('account.cleanup_pending');
                    }
                }
                DB::transaction(function () use ($id) {
                    DB::table('identity_accounts')->where('id', $id)->lockForUpdate()->first();
                    DB::table('identity_accounts')->where('id', $id)->delete();
                });
                // Retained separately from account FKs for permanent idempotent
                // replies even after physical cleanup. Worker also reconciles a
                // crash between account deletion and this update.
                DB::table('identity_emergency_receipts')->where('account_id', $id)->whereNull('completed_at')->update(['completed_at' => now()]);

                return true;
            } catch (\Throwable) {
                DB::table('identity_accounts')->where('id', $id)->update(['deletion_attempts' => $account->deletion_attempts + 1, 'deletion_retry_at' => now()->addSeconds(min(3600, 2 ** min(11, $account->deletion_attempts + 1)))]);

                return false;
            }
        }) ?? false;
    }

    private function deleteObject(string $path): void
    {
        $disk = Storage::disk(config('prototype.disk'));
        $disk->delete($path);
        if ($disk->exists($path)) {
            throw new \RuntimeException('account.cleanup_pending');
        }
    }

    private function erasePrototypeClaims(string $id): void
    {
        foreach (DB::table('identity_legacy_claims')->where('account_id', $id)->pluck('library_id') as $library) {
            $spaces = DB::table('prototype_spaces')->where('owner_id', $library)->pluck('id');
            $photos = DB::table('prototype_photos')->where('library_id', $library)->orWhere('creator_id', $library)->orWhereIn('space_id', $spaces)->get();
            foreach ($photos as $photo) {
                DB::transaction(fn () => Retention::revoke($photo->library_id, $photo->id));
                if (! Library::cleanup($photo->library_id, $photo->id)) {
                    throw new \RuntimeException('account.cleanup_pending');
                }
                Library::photos($photo->library_id)->where('id', $photo->id)->delete();
            }
            DB::table('prototype_assignments')->whereIn('space_id', $spaces)->delete();
            DB::table('prototype_invitations')->whereIn('space_id', $spaces)->orWhere('accepted_by', $library)->delete();
            DB::table('prototype_members')->whereIn('space_id', $spaces)->orWhere('actor_id', $library)->delete();
            DB::table('prototype_spaces')->whereIn('id', $spaces)->delete();
            DB::table('prototype_profiles')->where('library_id', $library)->delete();
            DB::table('prototype_clock_anchors')->where('library_id', $library)->delete();
            DB::table('prototype_deletions')->where('library_id', $library)->delete();
            DB::table('prototype_libraries')->where('id', $library)->delete();
        }
    }
}
