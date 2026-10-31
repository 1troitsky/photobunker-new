<?php

namespace App\Http\Controllers;

use App\Encrypted\Keys;
use App\Encrypted\Objects;
use App\Encrypted\Protocol;
use App\Identity\Accounts;
use App\Prototype\Retention;
use App\Workspace\Photos;
use App\Workspace\Workspace;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\HttpException;

final class WorkspacePhotoController extends Controller
{
    public function __construct(private readonly Accounts $accounts, private readonly Workspace $workspace, private readonly Photos $photos) {}

    private function actor(Request $request): string
    {
        $actor = $this->accounts->current($request)->id;
        $keys = app(Keys::class);
        if ($keys->enabled($actor)) {
            // Strong read proof remains mandatory for every legacy operation.
            $keys->read($request);
            abort_if($request->isMethod('PATCH'), 409);
            if ($request->isMethod('POST') && ! $request->is('api/v1/identity/workspace/photos/*/reference')) {
                abort(409);
            }
        }

        return $actor;
    }

    public function index(Request $request)
    {
        $actor = $this->actor($request);
        $vaults = DB::table('workspace_vaults')->where('owner_id', $actor)->orWhereIn('assignment_id', DB::table('workspace_members')->where('account_id', $actor)->where('state', 'accepted')->select('record_id'))->pluck('id');
        $rows = DB::table('workspace_photos')->whereIn('vault_id', $vaults)->get();
        $visible = [];
        $deleted = [];
        $receipts = [];
        foreach ($rows as $row) {
            try {
                $grant = $this->workspace->grant($actor, $row);
            } catch (HttpException) {
                continue;
            }
            if ($row->state === 'deleted' || $row->expires_at <= Retention::milliseconds()) {
                $deleted[] = $row->id;

                continue;
            }
            if ($row->state !== 'active') {
                continue;
            }
            if ($grant['thumbnail']) {
                $visible[] = $this->photos->serialize($row, $actor);
            }
            if (! $grant['read'] && $row->creator_id === $actor) {
                $receipts[] = ['id' => $row->id, 'assignmentId' => $row->assignment_id, 'expiresAt' => (int) $row->expires_at, 'state' => 'received', 'revision' => (int) $row->revision, 'reviewState' => ($feedback = $this->photos->manifest($row))['reviewState'] ?? 'pending', 'reviewRevision' => $feedback['reviewRevision'] ?? 1, 'reviewComment' => $feedback['reviewComment'] ?? '', 'responseComment' => $feedback['responseComment'] ?? ''];
            }
        }

        return response()->json(['photos' => $visible, 'deleted' => $deleted, 'receipts' => $receipts]);
    }

    public function upload(Request $request)
    {
        $actor = $this->actor($request);
        $request->validate(['manifest' => 'required|string|max:50000', 'original' => 'required|file|max:65536', 'thumbnail' => 'required|file|max:2048', 'preview' => 'required|file|max:2048']);
        $input = json_decode($request->input('manifest'), true);
        abort_unless(is_array($input), 422);
        $data = Validator::make($input, ['id' => 'required|uuid', 'createdAt' => 'required|integer|min:0|max:9007199254740991', 'width' => 'required|integer|min:1|max:32768', 'height' => 'required|integer|min:1|max:32768',
            'mime' => 'required|in:image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif', 'method' => 'required|in:demo,image-capture,video-frame',
            'title' => 'present|nullable|string|max:120', 'note' => 'present|nullable|string|max:2000', 'favorite' => 'required|boolean', 'category' => 'sometimes|nullable|string|max:80', 'shot' => 'sometimes|nullable|string|max:80',
            'tags' => 'sometimes|array|max:20', 'tags.*' => 'required|string|max:40|distinct', 'metadata' => 'sometimes|array',
            'assignmentId' => 'sometimes|nullable|uuid', 'taskRevision' => 'sometimes|integer|min:1', 'profile' => 'sometimes|nullable|array', 'legacyImport' => 'sometimes|boolean',
            'retentionAnchor' => 'required|uuid', 'retentionSeconds' => 'required|integer|min:3600|max:1209600', 'expiresAt' => 'required|integer|min:0|max:9007199254740991',
            'needsName' => 'sometimes|boolean', 'shortId' => 'sometimes|nullable|string|max:40', 'originalChecksum' => 'required|string|regex:/^[a-f0-9]{64}$/D', 'thumbnailChecksum' => 'required|string|regex:/^[a-f0-9]{64}$/D', 'previewChecksum' => 'required|string|regex:/^[a-f0-9]{64}$/D'])->validate();
        $existing = DB::table('workspace_photos')->find($data['id']);
        $committed = $existing && $existing->state === 'active' && $existing->creator_id === $actor && $existing->assignment_id === ($data['assignmentId'] ?? null);
        $task = ! empty($data['assignmentId']) ? $this->workspace->record($actor, $data['assignmentId'], 'task') : null;
        // An explicit mapped copy into the owner's imported archive is not a new submission.
        // Other contributors cannot use the import flag to bypass capture dates/completion.
        $committed = $committed || (($data['legacyImport'] ?? false) && $task?->owner_id === $actor
            && DB::table('workspace_imports')->where('account_id', $actor)->where('target_id', $data['id'])->exists());
        $vault = $this->workspace->capture($actor, $data['assignmentId'] ?? null, $committed);
        $config = $task ? $this->workspace->payload($task) : null;
        $capture = $config;
        if ($task) {
            $version = DB::table('workspace_record_versions')->where('record_id', $task->id)->where('revision', $data['taskRevision'] ?? 0)->first();
            abort_unless($version, 409);
            $capture = $this->workspace->payload($version);
            abort_if(! empty($data['category']) && $config['rules']['particularCategory'] && ! in_array($data['category'], $config['rules']['categories'], true), 422);
            abort_if(! empty($data['shot']) && ! in_array($data['shot'], $config['shots'], true), 422);
        }
        $anchor = DB::table('workspace_clock_anchors')->where('id', $data['retentionAnchor'])->where('account_id', $actor)->value('issued_at');
        abort_unless($anchor !== null, 422);
        $duration = $data['retentionSeconds'];
        if ($config && $config['preset']) {
            $options = $config['preset']['options'];
            $maximum = $options['retention'] === 'custom' ? $options['customHours'] * 3600 : $options['retention'];
            abort_if($maximum && $duration > $maximum, 422);
        }
        $expires = min($data['expiresAt'], (($data['legacyImport'] ?? false) ? Retention::milliseconds() : $data['createdAt']) + $duration * 1000, (int) $anchor + $duration * 1000);
        abort_if($expires <= Retention::milliseconds(), 410);
        $original = $request->file('original');
        $thumbnail = $request->file('thumbnail');
        $preview = $request->file('preview');
        abort_unless($original->getSize() && $thumbnail->getSize() && $preview->getSize(), 422);
        abort_unless(hash_equals($data['originalChecksum'], hash_file('sha256', $original->getRealPath())) && hash_equals($data['thumbnailChecksum'], hash_file('sha256', $thumbnail->getRealPath())) && hash_equals($data['previewChecksum'], hash_file('sha256', $preview->getRealPath())), 503);
        $fingerprint = hash('sha256', json_encode([$actor, $vault->id, $data['id'], $data['originalChecksum'], $data['thumbnailChecksum'], $data['previewChecksum'], $data['createdAt'], $data['width'], $data['height'], $data['mime'], $data['method']]));
        $metadata = $this->metadata($data['metadata'] ?? []);
        $owner = DB::table('identity_accounts')->find($actor);
        $profile = $capture['preset'] ?? (isset($data['profile']) ? Validator::make($data['profile'], ['id' => 'required|string|max:120', 'name' => 'required|string|max:80', 'version' => 'required|integer|min:0', 'description' => 'sometimes|nullable|string|max:1000', 'rules' => 'required|array'])->validate() : null);
        $nameId = app(\App\Workspace\PhotoNames::class)->forPhoto($data['id']);
        abort_if(($data['needsName'] ?? false) && ! $nameId, 409, 'photo_names.unassigned');
        abort_if(! $nameId && preg_match('/^[A-Z]{4}[0-9]{4}$/D', $data['shortId'] ?? ''), 422);
        $manifest = ['id' => $data['id'], 'createdAt' => $data['createdAt'], 'width' => $data['width'], 'height' => $data['height'], 'bytes' => $original->getSize(), 'mime' => $data['mime'], 'method' => $data['method'],
            'title' => trim($data['title'] ?? '') ?: ($nameId ?? ''), 'note' => trim($data['note'] ?? ''), 'favorite' => $data['favorite'], 'category' => $data['category'] ?? '', 'shot' => $data['shot'] ?? '', 'tags' => $data['tags'] ?? [], 'metadata' => $metadata,
            'creatorPublicId' => $owner->public_id, 'shortId' => $nameId ?? (($data['shortId'] ?? '') ?: strtoupper(substr(str_replace('-', '', $data['id']), 0, 10))), 'retentionSeconds' => $duration, 'retentionAnchor' => $data['retentionAnchor'],
            'profile' => $profile, 'uiRules' => $config ? ['descriptionRequired' => $config['rules']['descriptionRequired'], 'minLength' => $config['rules']['minLength'], 'particularCategory' => $config['rules']['particularCategory']] : null,
            'captureContext' => ['presetName' => $profile['name'] ?? 'Standard', 'presetVersion' => $profile['version'] ?? null, 'standard' => ! $profile || ($profile['id'] ?? '') === 'standard-local', 'teamId' => $task?->team_id,
                'teamName' => $config['teamName'] ?? null, 'author' => ($data['legacyImport'] ?? false) ? ['kind' => 'device'] : ['kind' => 'account', 'publicId' => $owner->public_id]]];
        DB::transaction(function () use ($actor, $vault, $data, $original, $thumbnail, $preview, $fingerprint, $manifest, $expires, $committed) {
            DB::table('identity_accounts')->where('id', $vault->owner_id)->lockForUpdate()->firstOrFail();
            DB::table('workspace_vaults')->where('id', $vault->id)->lockForUpdate()->firstOrFail();
            $this->workspace->capture($actor, $data['assignmentId'] ?? null, $committed);
            $row = DB::table('workspace_photos')->find($data['id']);
            if ($row) {
                abort_unless($row->creator_id === $actor && $row->vault_id === $vault->id, 404);
                abort_if($row->state === 'deleted' || $row->expires_at <= Retention::milliseconds(), 410);
                abort_unless(hash_equals($row->fingerprint, $fingerprint), 409);

                return;
            }
            $reserved = DB::table('workspace_photos')->whereIn('vault_id', DB::table('workspace_vaults')->where('owner_id', $vault->owner_id)->select('id'))->whereIn('state', ['active', 'pending']);
            abort_if($reserved->count() >= config('prototype.max_photos') || $reserved->sum(DB::raw('bytes + thumbnail_bytes + preview_bytes')) + $original->getSize() + $thumbnail->getSize() + $preview->getSize() > config('prototype.max_bytes'), 413);
            $prefix = 'workspace/'.Str::uuid();
            DB::table('workspace_photos')->insert(['id' => $data['id'], 'vault_id' => $vault->id, 'creator_id' => $actor, 'assignment_id' => $data['assignmentId'] ?? null,
                'manifest' => Crypt::encryptString(json_encode($manifest)), 'state' => 'pending', 'original_key' => $prefix.'/original', 'thumbnail_key' => $prefix.'/thumbnail', 'preview_key' => $prefix.'/preview', 'preview_bytes' => $preview->getSize(),
                'bytes' => $original->getSize(), 'thumbnail_bytes' => $thumbnail->getSize(), 'fingerprint' => $fingerprint, 'revision' => 1, 'expires_at' => $expires, 'created_at' => now()]);
        });
        $row = DB::transaction(function () use ($actor, $vault, $data, $original, $thumbnail, $preview, $committed) {
            DB::table('workspace_vaults')->where('id', $vault->id)->lockForUpdate()->firstOrFail();
            $this->workspace->capture($actor, $data['assignmentId'] ?? null, $committed);
            $row = DB::table('workspace_photos')->find($data['id']);
            abort_if($row->state === 'deleted' || $row->expires_at <= Retention::milliseconds(), 410);
            if ($row->state === 'active') {
                return $row;
            }
            try {
                $disk = Storage::disk(config('prototype.disk'));
                foreach ([[$row->original_key, $original, $row->bytes], [$row->thumbnail_key, $thumbnail, $row->thumbnail_bytes], [$row->preview_key, $preview, $row->preview_bytes]] as [$key, $file, $bytes]) {
                    $stream = fopen($file->getRealPath(), 'rb');
                    try {
                        abort_unless($disk->put($key, $stream) && $disk->size($key) === (int) $bytes, 503);
                    } finally {
                        if (is_resource($stream)) {
                            fclose($stream);
                        }
                    }
                }
            } catch (\Throwable) {
                abort(503);
            }
            abort_if($row->expires_at <= Retention::milliseconds(), 410);
            DB::table('workspace_photos')->where('id', $row->id)->update(['state' => 'active']);
            $row->state = 'active';

            return $row;
        });
        $grant = $this->workspace->grant($actor, $row);

        return response()->json(['photo' => $grant['thumbnail'] ? $this->photos->serialize($row, $actor) : ['id' => $row->id, 'accountId' => $actor, 'expiresAt' => (int) $row->expires_at, 'remoteRevision' => (int) $row->revision, 'uploadOnly' => true, 'workspaceAccess' => $grant, 'uploadRequested' => false]]);
    }

    public function show(Request $request, string $id)
    {
        $actor = $this->actor($request);

        return response()->json(['photo' => $this->photos->serialize($this->photos->active($actor, $id), $actor)]);
    }

    public function content(Request $request, string $id, string $kind)
    {
        abort_unless(in_array($kind, ['original', 'thumbnail'], true), 404);
        $row = $this->photos->active($this->actor($request), $id, $kind === 'original' ? 'read' : 'thumbnail');
        if ($kind === 'thumbnail' && $row->preview_key && $this->workspace->grant($this->actor($request), $row)['read']) {
            $kind = 'preview';
        }
        try {
            $stream = Storage::disk(config('prototype.disk'))->readStream($row->{$kind.'_key'});
        } catch (\Throwable) {
            abort(503);
        }
        abort_unless(is_resource($stream), 503);

        return response()->stream(function () use ($stream) {
            try {
                fpassthru($stream);
            } finally {
                fclose($stream);
            }
        }, 200, ['Content-Type' => 'application/octet-stream', 'Content-Length' => (string) ($kind === 'original' ? $row->bytes : ($kind === 'preview' ? $row->preview_bytes : $row->thumbnail_bytes))]);
    }

    public function update(Request $request, string $id)
    {
        $actor = $this->actor($request);
        $data = $request->validate(['revision' => 'required|integer|min:1', 'title' => 'present|nullable|string|max:120', 'note' => 'present|nullable|string|max:2000', 'favorite' => 'required|boolean', 'category' => 'sometimes|nullable|string|max:80',
            'tags' => 'sometimes|array|max:20', 'tags.*' => 'required|string|max:40|distinct', 'metadata' => 'sometimes|array', 'expiresAt' => 'sometimes|integer|min:0|max:9007199254740991']);
        $row = DB::transaction(function () use ($actor, $id, $data) {
            $found = DB::table('workspace_photos')->find($id);
            abort_unless($found, 404);
            DB::table('workspace_vaults')->where('id', $found->vault_id)->lockForUpdate()->firstOrFail();
            $row = $this->photos->active($actor, $id, 'edit');
            if ((int) $row->revision !== $data['revision']) {
                $saved = $this->photos->manifest($row);
                $same = $data['revision'] < $row->revision;
                foreach ($data as $field => $value) {
                    if ($field === 'revision') {
                        continue;
                    }
                    if ($field === 'expiresAt') {
                        $same = $same && $row->expires_at <= $value;

                        continue;
                    }
                    if (in_array($field, ['title', 'note'], true)) {
                        $value = trim($value ?? '');
                    }
                    if ($field === 'metadata') {
                        $value = $this->metadata($value);
                    }
                    $same = $same && $value == ($saved[$field] ?? (in_array($field, ['metadata', 'tags'], true) ? [] : ''));
                }
                abort_unless($same, 409);

                return $row;
            }
            abort_if(isset($data['expiresAt']) && $data['expiresAt'] > $row->expires_at, 422);
            $manifest = $this->photos->manifest($row);
            if (isset($data['metadata'])) {
                $metadata = $this->metadata($data['metadata']);
                foreach (['capturedAt', 'camera', 'resolutionLimited'] as $field) {
                    abort_if(($metadata[$field] ?? null) !== ($manifest['metadata'][$field] ?? null), 403);
                }
                $data['metadata'] = $metadata;
            }
            if ($row->assignment_id && ! empty($data['category'])) {
                $task = DB::table('workspace_records')->find($row->assignment_id);
                $rules = $this->workspace->payload($task)['rules'];
                abort_if($rules['particularCategory'] && ! in_array($data['category'], $rules['categories'], true), 422);
            }
            $expires = $data['expiresAt'] ?? $row->expires_at;
            unset($data['revision'], $data['expiresAt']);
            DB::table('workspace_photos')->where('id', $id)->update(['manifest' => Crypt::encryptString(json_encode([...$manifest, ...$data, 'title' => trim($data['title'] ?? ''), 'note' => trim($data['note'] ?? '')])), 'revision' => $row->revision + 1, 'expires_at' => $expires]);

            return DB::table('workspace_photos')->find($id);
        });

        return response()->json(['photo' => $this->photos->serialize($row, $actor)]);
    }

    public function remove(Request $request, string $id)
    {
        $actor = $this->actor($request);
        $row = DB::transaction(function () use ($actor, $id) {
            $found = DB::table('workspace_photos')->find($id);
            abort_unless($found, 404);
            DB::table('workspace_vaults')->where('id', $found->vault_id)->lockForUpdate()->firstOrFail();
            $row = DB::table('workspace_photos')->find($id);
            abort_unless($this->workspace->grant($actor, $row)['delete'], 403);
            DB::table('workspace_photos')->where('id', $id)->update(['state' => 'deleted']);

            return $row;
        });
        $verified = $this->photos->cleanup($row);

        return response()->json(['deletion' => $verified ? 'verified' : 'pending'], $verified ? 200 : 202);
    }

    public function reference(Request $request, string $id)
    {
        $actor = $this->actor($request);
        if (DB::table('encrypted_photos')->where('id', $id)->exists()) {
            $row = app(Objects::class)->active($actor, $id);
            abort_unless($this->workspace->grant($actor, $row)['share'], 403);
            $original = DB::table('encrypted_objects')->where('photo_id', $id)->where('kind', 'original')->firstOrFail();
            $packet = Protocol::decode($original->packet);
            abort_unless(collect($packet['envelopes'])->contains(fn ($envelope) => $envelope['accountId'] === $actor), 403);
        } else {
            $row = $this->photos->active($actor, $id, 'share');
        }
        abort_unless($row->assignment_id, 422);
        $task = $this->workspace->record($actor, $row->assignment_id, 'task');
        abort_unless($task->room_id && $task->room_state === 'ready', 409);

        return response()->json(['photoId' => $id, 'assignmentId' => $task->id, 'roomId' => $task->room_id]);
    }

    public function captureMetadata(Request $request, string $id)
    {
        $actor = $this->actor($request);
        $data = $request->validate(['revision' => 'required|integer|min:1', 'metadata' => 'required|array']);
        $revision = DB::transaction(function () use ($actor, $id, $data) {
            $found = DB::table('workspace_photos')->find($id);
            abort_unless($found, 404);
            DB::table('workspace_vaults')->where('id', $found->vault_id)->lockForUpdate()->firstOrFail();
            $row = DB::table('workspace_photos')->find($id);
            $this->workspace->grant($actor, $row); // Membership must still be current even without read access.
            abort_unless($row->creator_id === $actor, 403);
            abort_if($row->state !== 'active' || $row->expires_at <= Retention::milliseconds(), 410);
            abort_if(strtotime($row->created_at) + 120 < now()->getTimestamp(), 403);
            $manifest = $this->photos->manifest($row);
            $metadata = $this->metadata($data['metadata']);
            if ((int) $row->revision !== $data['revision']) {
                abort_unless($data['revision'] < $row->revision && $metadata == ($manifest['metadata'] ?? []), 409);

                return $row->revision;
            }
            foreach (['capturedAt', 'camera', 'resolutionLimited', 'date', 'time', 'locationEditedAt'] as $field) {
                abort_if(($metadata[$field] ?? null) !== ($manifest['metadata'][$field] ?? null), 403);
            }
            abort_if(($manifest['metadata']['location']['source'] ?? '') === 'manual' || ($metadata['location']['source'] ?? '') === 'manual', 403);
            if (isset($metadata['location'])) {
                abort_unless(isset($metadata['location']['measuredAt'], $metadata['location']['accuracy']) && abs($metadata['location']['measuredAt'] - $manifest['createdAt']) <= ($manifest['profile']['rules']['locationWindow'] ?? 15) * 1000, 422);
            }
            DB::table('workspace_photos')->where('id', $id)->update(['manifest' => Crypt::encryptString(json_encode([...$manifest, 'metadata' => $metadata])), 'revision' => $row->revision + 1]);

            return $row->revision + 1;
        });

        return response()->json(['remoteRevision' => $revision]);
    }

    public function review(Request $request, string $id)
    {
        $actor = $this->actor($request);
        $data = $request->validate(['revision' => 'required|integer|min:1', 'state' => 'required|in:accepted,correction,reshoot,rejected', 'comment' => 'present|nullable|string|max:2000']);
        DB::transaction(function () use ($actor, $id, $data) {
            $found = DB::table('workspace_photos')->find($id);
            abort_unless($found, 404);
            DB::table('workspace_vaults')->where('id', $found->vault_id)->lockForUpdate()->firstOrFail();
            $row = $this->photos->active($actor, $id, 'edit');
            $grant = $this->workspace->grant($actor, $row);
            abort_unless($row->assignment_id && in_array($grant['role'], ['owner', 'curator'], true), 403);
            abort_if($data['state'] !== 'accepted' && trim($data['comment'] ?? '') === '', 422);
            $manifest = $this->photos->manifest($row);
            abort_unless(($manifest['reviewRevision'] ?? 1) === $data['revision'], 409);
            DB::table('workspace_photos')->where('id', $id)->update(['manifest' => Crypt::encryptString(json_encode([...$manifest, 'reviewState' => $data['state'], 'reviewRevision' => $data['revision'] + 1, 'reviewComment' => trim($data['comment'] ?? ''), 'responseComment' => ''])), 'revision' => $row->revision + 1]);
        });

        return response()->json(['reviewed' => true]);
    }

    public function response(Request $request, string $id)
    {
        $actor = $this->actor($request);
        $data = $request->validate(['revision' => 'required|integer|min:1', 'comment' => 'required|string|max:2000']);
        DB::transaction(function () use ($actor, $id, $data) {
            $found = DB::table('workspace_photos')->find($id);
            abort_unless($found, 404);
            DB::table('workspace_vaults')->where('id', $found->vault_id)->lockForUpdate()->firstOrFail();
            $row = DB::table('workspace_photos')->find($id);
            $this->workspace->grant($actor, $row);
            abort_unless($row->creator_id === $actor && $row->assignment_id, 403);
            abort_if($row->state !== 'active' || $row->expires_at <= Retention::milliseconds(), 410);
            $manifest = $this->photos->manifest($row);
            abort_unless(in_array($manifest['reviewState'] ?? 'pending', ['correction', 'reshoot'], true), 409);
            abort_unless(($manifest['reviewRevision'] ?? 1) === $data['revision'], 409);
            abort_unless(trim($data['comment']) !== '', 422);
            DB::table('workspace_photos')->where('id', $id)->update(['manifest' => Crypt::encryptString(json_encode([...$manifest, 'reviewRevision' => $data['revision'] + 1, 'responseComment' => trim($data['comment'])])), 'revision' => $row->revision + 1]);
        });

        return response()->json(['responded' => true]);
    }

    private function metadata(array $value): array
    {
        return Validator::make($value, ['date' => 'sometimes|string|max:40', 'time' => 'sometimes|string|max:40', 'camera' => 'sometimes|string|max:120', 'capturedAt' => 'sometimes|integer|min:0', 'resolutionLimited' => 'sometimes|boolean',
            'locationStatus' => 'sometimes|in:pending,unavailable', 'locationEditedAt' => 'sometimes|integer|min:0', 'location' => 'sometimes|array:source,latitude,longitude,accuracy,measuredAt',
            'location.source' => 'sometimes|in:manual,gps', 'location.latitude' => 'required_with:location|numeric|min:-90|max:90', 'location.longitude' => 'required_with:location|numeric|min:-180|max:180',
            'location.accuracy' => 'sometimes|numeric|min:0|max:100000', 'location.measuredAt' => 'sometimes|integer|min:0'])->validate();
    }
}
