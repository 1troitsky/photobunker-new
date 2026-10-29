<?php

namespace App\Workspace;

use App\Prototype\Retention;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

final class Photos
{
    public function __construct(private readonly Workspace $workspace) {}

    public function manifest(object $row): array
    {
        return json_decode(Crypt::decryptString($row->manifest), true, flags: JSON_THROW_ON_ERROR);
    }

    public function active(string $actor, string $id, string $operation = 'thumbnail'): object
    {
        $row = DB::table('workspace_photos')->find($id);
        abort_unless($row, 404);
        $grant = $this->workspace->grant($actor, $row);
        abort_unless($grant[$operation] ?? false, 403);
        abort_if($row->state === 'deleted' || $row->expires_at <= Retention::milliseconds(), 410);
        abort_unless($row->state === 'active', 404);

        return $row;
    }

    public function serialize(object $row, string $actor): array
    {
        $grant = $this->workspace->grant($actor, $row);
        $data = $this->manifest($row);

        if (! $grant['read']) {
            unset($data['reviewComment'], $data['responseComment']);
            $data = [...$data, 'metadata' => [], 'note' => '', 'tags' => [], 'profile' => null, 'category' => '', 'shot' => ''];
        }

        return [...$data, 'id' => $row->id, 'accountId' => $actor, 'workspaceVaultId' => $row->vault_id, 'workspaceAssignmentId' => $row->assignment_id,
            'uiAssignmentId' => $row->assignment_id, 'creatorId' => $data['creatorPublicId'], 'uiOnly' => true, 'uploadRequested' => false,
            'expiresAt' => (int) $row->expires_at, 'remoteRevision' => (int) $row->revision, 'workspaceAccess' => $grant,
            'uploadOnly' => ! $grant['thumbnail'], 'thumbnailOnly' => ! $grant['read'], 'access' => ['role' => $grant['role'], 'readOwnPhotos' => $grant['thumbnail'], 'manageProfiles' => false]];
    }

    public function cleanup(object $row): bool
    {
        if ($row->delete_verified_at) {
            return true;
        }
        try {
            $disk = Storage::disk(config('prototype.disk'));
            foreach (array_filter([$row->original_key, $row->thumbnail_key, $row->preview_key]) as $key) {
                if (! $disk->delete($key) || $disk->exists($key)) {
                    return false;
                }
            }
            DB::table('workspace_photos')->where('id', $row->id)->where('state', 'deleted')->update(['delete_verified_at' => now(), 'manifest' => Crypt::encryptString('{}')]);

            return true;
        } catch (\Throwable) {
            return false;
        }
    }

    public function cleanupAccount(string $actor): void
    {
        $rows = DB::table('workspace_photos')->whereIn('vault_id', DB::table('workspace_vaults')->where('owner_id', $actor)->select('id'))->get();
        foreach ($rows as $row) {
            DB::table('workspace_photos')->where('id', $row->id)->update(['state' => 'deleted']);
            abort_unless($this->cleanup($row), 503);
        }
    }
}
