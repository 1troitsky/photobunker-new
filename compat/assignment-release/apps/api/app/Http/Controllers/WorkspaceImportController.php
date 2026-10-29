<?php

namespace App\Http\Controllers;

use App\Encrypted\Keys;
use App\Identity\Accounts;
use App\Prototype\Retention;
use App\Workspace\Workspace;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

final class WorkspaceImportController extends Controller
{
    public function __construct(private readonly Accounts $accounts, private readonly Workspace $workspace) {}

    public function record(Request $request)
    {
        $actor = $this->accounts->current($request)->id;
        $input = $request->validate(['kind' => 'required|in:team,task,preset', 'source' => 'required|string|max:200', 'value' => 'required|array']);
        abort_if(strlen(json_encode($input['value'])) > 50000, 413);
        $source = hash('sha256', $input['kind'].':'.$input['source']);
        $result = DB::transaction(function () use ($actor, $input, $source) {
            DB::table('identity_accounts')->where('id', $actor)->lockForUpdate()->firstOrFail();
            $mapping = DB::table('workspace_imports')->where('account_id', $actor)->where('source_hash', $source)->first();
            if ($mapping) {
                return $this->workspace->serialize($this->workspace->record($actor, $mapping->target_id, $input['kind']), $actor);
            }
            $id = (string) Str::uuid();
            // Existing textual participants/legacy actor IDs are never credentials or grants.
            $data = $this->workspace->validate($input['kind'], [...$input['value'], 'id' => $id, 'revision' => 0, 'participants' => []]);
            $saved = $this->workspace->save($actor, $input['kind'], $id, $data);
            DB::table('workspace_imports')->insert(['account_id' => $actor, 'source_hash' => $source, 'target_id' => $id]);

            return $saved;
        });

        return response()->json($result);
    }

    public function localPhotoId(Request $request)
    {
        $actor = $this->accounts->current($request)->id;
        $data = $request->validate(['source' => 'required|string|max:200']);
        $hash = hash('sha256', 'local-photo:'.$data['source']);
        $result = DB::transaction(function () use ($actor, $hash) {
            DB::table('identity_accounts')->where('id', $actor)->lockForUpdate()->firstOrFail();
            $mapping = DB::table('workspace_imports')->where('account_id', $actor)->where('source_hash', $hash)->first();
            if (! $mapping) {
                $id = (string) Str::uuid();
                DB::table('workspace_imports')->insert(['account_id' => $actor, 'source_hash' => $hash, 'target_id' => $id]);
            } else {
                $id = $mapping->target_id;
            }
            $photo = DB::table('workspace_photos')->find($id);
            abort_if($photo && ($photo->state === 'deleted' || $photo->expires_at <= Retention::milliseconds()), 410);

            return ['id' => $id, 'committed' => $photo?->state === 'active'];
        });

        return response()->json($result);
    }

    public function preview(Request $request)
    {
        $actor = $this->accounts->current($request)->id;
        $libraries = DB::table('identity_legacy_claims')->where('account_id', $actor)->pluck('library_id');
        $spaces = DB::table('prototype_spaces')->whereIn('owner_id', $libraries)->get();
        $profiles = DB::table('prototype_profiles')->whereIn('library_id', $libraries)->get()->map(function ($row) {
            $snapshot = DB::table('prototype_profile_versions')->where('library_id', $row->library_id)->where('profile_id', $row->id)->where('version', $row->version)->value('snapshot');

            return ['libraryId' => $row->library_id, 'profile' => [...json_decode($snapshot, true), 'archived' => (bool) $row->archived]];
        });
        $tasks = DB::table('prototype_assignments')->whereIn('space_id', $spaces->pluck('id'))->get()->map(fn ($row) => ['id' => $row->id, 'spaceId' => $row->space_id, 'name' => $row->name, 'instructions' => $row->instructions,
            'profile' => json_decode($row->profile_snapshot, true), 'shots' => json_decode($row->shots, true), 'finishesAt' => $row->due_at === null ? null : (int) $row->due_at, 'completed' => (bool) $row->closed]);
        $photos = DB::table('prototype_photos')->whereIn('library_id', $libraries)->where('state', 'active')->get()->reject(Retention::expired(...))->map(fn ($row) => ['id' => $row->id, 'libraryId' => $row->library_id, 'expiresAt' => $row->expires_at === null ? null : (int) $row->expires_at]);

        return response()->json(['teams' => $spaces->map(fn ($row) => ['id' => $row->id, 'name' => $row->name, 'libraryId' => $row->owner_id]), 'presets' => $profiles, 'tasks' => $tasks, 'photos' => $photos->values()]);
    }

    public function photo(Request $request, string $id)
    {
        abort_if(app(Keys::class)->enabled($this->accounts->current($request)->id), 409);
        $actor = $this->accounts->current($request)->id;
        $data = $request->validate(['libraryId' => 'required|uuid']);
        abort_unless(DB::table('identity_legacy_claims')->where('library_id', $data['libraryId'])->where('account_id', $actor)->exists(), 403);
        $source = DB::table('prototype_photos')->where('library_id', $data['libraryId'])->where('id', $id)->first();
        abort_unless($source, 404);
        abort_if($source->state !== 'active' || Retention::expired($source), 410);
        $hash = hash('sha256', 'legacy-photo:'.$data['libraryId'].':'.$id);
        $vault = $this->workspace->personal($actor);
        $target = DB::transaction(function () use ($actor, $source, $hash, $vault) {
            DB::table('identity_accounts')->where('id', $vault->owner_id)->lockForUpdate()->firstOrFail();
            DB::table('workspace_vaults')->where('id', $vault->id)->lockForUpdate()->firstOrFail();
            $mapping = DB::table('workspace_imports')->where('account_id', $actor)->where('source_hash', $hash)->first();
            if ($mapping) {
                return DB::table('workspace_photos')->find($mapping->target_id);
            }
            $reserved = DB::table('workspace_photos')->whereIn('vault_id', DB::table('workspace_vaults')->where('owner_id', $vault->owner_id)->select('id'))->whereIn('state', ['active', 'pending']);
            abort_if($reserved->count() >= config('prototype.max_photos') || $reserved->sum(DB::raw('bytes + thumbnail_bytes + preview_bytes')) + $source->bytes + $source->thumbnail_bytes > config('prototype.max_bytes'), 413);
            $id = (string) Str::uuid();
            $prefix = 'workspace/'.Str::uuid();
            $profile = $source->profile_snapshot ? json_decode($source->profile_snapshot, true) : null;
            $manifest = ['id' => $id, 'createdAt' => (int) $source->captured_at, 'width' => (int) $source->width, 'height' => (int) $source->height, 'bytes' => (int) $source->bytes,
                'mime' => $source->mime, 'method' => $source->method, 'title' => $source->title, 'note' => $source->note, 'favorite' => (bool) $source->favorite, 'category' => $source->category,
                'shot' => $source->shot, 'shortId' => $source->short_id, 'tags' => json_decode($source->tags ?? '[]', true), 'metadata' => json_decode($source->metadata ?? '{}', true), 'profile' => $profile,
                'creatorPublicId' => DB::table('identity_accounts')->where('id', $actor)->value('public_id'), 'retentionSeconds' => 1209600,
                'captureContext' => ['presetName' => $profile['name'] ?? 'Standard', 'presetVersion' => $profile['version'] ?? null, 'standard' => ! $profile, 'author' => ['kind' => 'unknown']]];
            DB::table('workspace_photos')->insert(['id' => $id, 'vault_id' => $vault->id, 'creator_id' => $actor, 'manifest' => Crypt::encryptString(json_encode($manifest)), 'state' => 'pending',
                'original_key' => $prefix.'/original', 'thumbnail_key' => $prefix.'/thumbnail', 'bytes' => $source->bytes, 'thumbnail_bytes' => $source->thumbnail_bytes, 'fingerprint' => hash('sha256', $source->fingerprint), 'revision' => 1,
                'expires_at' => min(Retention::milliseconds() + 1209600000, $source->expires_at ?? PHP_INT_MAX), 'created_at' => now()]);
            DB::table('workspace_imports')->insert(['account_id' => $actor, 'source_hash' => $hash, 'target_id' => $id]);

            return DB::table('workspace_photos')->find($id);
        });
        abort_unless($target && $target->state !== 'deleted' && $target->expires_at > Retention::milliseconds(), 410);
        if ($target->state === 'pending') {
            DB::transaction(function () use ($source, $target) {
                DB::table('prototype_libraries')->where('id', $source->library_id)->lockForUpdate()->firstOrFail();
                DB::table('workspace_vaults')->where('id', $target->vault_id)->lockForUpdate()->firstOrFail();
                $source = DB::table('prototype_photos')->where('library_id', $source->library_id)->where('id', $source->id)->first();
                $current = DB::table('workspace_photos')->find($target->id);
                abort_if(! $source || $source->state !== 'active' || Retention::expired($source) || $current->state === 'deleted' || $current->expires_at <= Retention::milliseconds(), 410);
                try {
                    $disk = Storage::disk(config('prototype.disk'));
                    foreach (['original', 'thumbnail'] as $kind) {
                        $key = $kind.'_key';
                        $bytes = $kind === 'original' ? 'bytes' : 'thumbnail_bytes';
                        $copied = false;
                        try {
                            $copied = $disk->copy($source->$key, $current->$key);
                        } catch (\Throwable) {
                        }
                        if (! $copied) {
                            $stream = $disk->readStream($source->$key);
                            abort_unless(is_resource($stream), 503);
                            try {
                                $copied = $disk->put($current->$key, $stream);
                            } finally {
                                fclose($stream);
                            }
                        }
                        abort_unless($copied && $disk->size($current->$key) === (int) $source->$bytes, 503);
                    }
                } catch (\Throwable) {
                    abort(503);
                }
                abort_if(Retention::expired($source) || $current->expires_at <= Retention::milliseconds(), 410);
                DB::table('workspace_photos')->where('id', $target->id)->update(['state' => 'active']);
            });
        }

        return response()->json(['id' => $target->id, 'originalPreserved' => true]);
    }
}
