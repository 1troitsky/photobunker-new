<?php

namespace App\Encrypted;

use App\Prototype\Library;
use App\Prototype\Retention;
use App\Workspace\Photos;
use App\Workspace\Workspace;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class Migration
{
    public function source(string $actor, array $source, bool $deleted = false): array
    {
        Protocol::fields($source, ['kind', 'id', 'revision', 'reviewRevision', 'libraryId']);
        validator($source, ['kind' => 'required|in:local,workspace,legacy', 'id' => 'required|uuid', 'revision' => 'required|integer|min:0|max:9007199254740991', 'reviewRevision' => 'required|integer|min:0', 'libraryId' => 'present|nullable|uuid'])->validate();
        if ($source['kind'] === 'local') {
            return ['row' => null, 'assignmentId' => null, 'expiresAt' => null, 'photo' => null];
        }
        if ($source['kind'] === 'workspace') {
            $row = DB::table('workspace_photos')->find($source['id']);
            abort_unless($row && $row->creator_id === $actor, 404);
            abort_unless(app(Workspace::class)->grant($actor, $row)['read'], 403);
            $photo = $row->state === 'active' ? app(Photos::class)->serialize($row, $actor) : null;
            $assignment = $row->assignment_id;
        } else {
            abort_unless(DB::table('identity_legacy_claims')->where('account_id', $actor)->where('library_id', $source['libraryId'])->exists(), 403);
            $row = Library::photos($source['libraryId'])->where('id', $source['id'])->first();
            abort_unless($row, 404);
            $photo = $row->state === 'active' ? Library::serialize($row) : null;
            $assignment = null;
        }
        abort_unless((int) $row->revision === $source['revision'] && (int) ($row->review_revision ?? 1) === $source['reviewRevision'], 409);
        abort_if(! $deleted && ($row->state !== 'active' || Retention::expired($row)), 410);

        return ['row' => $row, 'assignmentId' => $assignment, 'expiresAt' => $row->expires_at === null ? null : (int) $row->expires_at, 'photo' => $photo];
    }

    public function mapping(string $actor, array $source): array
    {
        $sourceData = $this->source($actor, $source);
        $hash = hash('sha256', 'photo-e2ee:'.Protocol::canonical($source));

        return DB::transaction(function () use ($actor, $sourceData, $hash) {
            DB::table('identity_accounts')->where('id', $actor)->lockForUpdate()->firstOrFail();
            $row = DB::table('workspace_imports')->where('account_id', $actor)->where('source_hash', $hash)->first();
            if (! $row) {
                $id = (string) Str::uuid();
                DB::table('workspace_imports')->insert(['account_id' => $actor, 'source_hash' => $hash, 'target_id' => $id]);
            } else {
                $id = $row->target_id;
            }$target = DB::table('encrypted_photos')->find($id);
            abort_if($target && ($target->state === 'deleted' || Retention::expired($target)), 410);

            return ['id' => $id, 'committed' => $target?->state === 'active', 'assignmentId' => $sourceData['assignmentId'], 'expiresAt' => $sourceData['expiresAt']];
        });
    }

    public function upload(string $actor, array $submission): void
    {
        $source = $submission['migration'];
        $data = $this->source($actor, $source);
        $mapping = $this->mapping($actor, $source);
        abort_unless($mapping['id'] === $submission['id'] && $data['assignmentId'] === $submission['assignmentId'] && ($data['expiresAt'] === null || $submission['expiresAt'] <= $data['expiresAt']), 422);
    }
}
