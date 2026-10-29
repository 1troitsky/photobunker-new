<?php

namespace App\Http\Controllers;

use App\Http\ApiResponse;
use App\Prototype\Collaboration;
use App\Prototype\Library;
use App\Prototype\Retention;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Throwable;

final class PrototypeLibraryController extends Controller
{
    public function create()
    {
        $token = bin2hex(random_bytes(32));
        $id = (string) Str::uuid();
        DB::table('prototype_libraries')->insert([
            'id' => $id, 'token_hash' => hash('sha256', $token), 'created_at' => now(),
        ]);

        return response()->json(['accessCode' => $token, 'libraryId' => $id], 201);
    }

    public function clock(Request $request)
    {
        $id = (string) Str::uuid();
        $issued = Retention::milliseconds();
        DB::table('prototype_clock_anchors')->insert(['id' => $id, 'library_id' => $request->attributes->get('prototype_library'), 'issued_at' => $issued]);

        return response()->json(['id' => $id, 'issuedAt' => $issued]);
    }

    public function index(Request $request)
    {
        $library = $request->attributes->get('prototype_library');
        $rows = Collaboration::visiblePhotos($library)->get();

        return response()->json([
            'photos' => $rows->where('state', 'active')->reject(Retention::expired(...))->sortByDesc('captured_at')->map(fn ($photo) => Library::serialize($photo, $library))->values(),
            'deleted' => $rows->filter(fn ($row) => $row->state === 'deleted' || Retention::expired($row))->pluck('id')->merge(DB::table('prototype_deletions')->where('library_id', $library)->pluck('id'))->unique()->values(),
            'libraryId' => $library, 'spaces' => Collaboration::spaces($library),
        ]);
    }

    public function upload(Request $request)
    {
        $request->validate(['manifest' => 'required|string|max:40000', 'original' => 'required|file|max:65536', 'thumbnail' => 'required|file|max:2048']);
        $manifest = json_decode($request->input('manifest'), true);
        abort_unless(is_array($manifest), 422);
        $data = Validator::make($manifest, [
            'id' => 'required|uuid', 'createdAt' => 'required|integer|min:0|max:9007199254740991',
            'width' => 'required|integer|min:1|max:32768', 'height' => 'required|integer|min:1|max:32768',
            'mime' => ['required', Rule::in(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic', 'image/heif'])],
            'method' => ['required', Rule::in(['demo', 'image-capture', 'video-frame'])],
            'title' => 'present|nullable|string|max:120', 'note' => 'present|nullable|string|max:2000', 'favorite' => 'required|boolean',
            'profile' => 'sometimes|array', 'profile.id' => 'required_with:profile|uuid', 'profile.version' => 'required_with:profile|integer|min:1',
            'shortId' => 'required_with:profile|string|max:24|regex:/^[A-Z0-9-]+$/D',
            'category' => 'sometimes|nullable|string|max:80', 'shot' => 'sometimes|nullable|string|max:80',
            'assignmentId' => 'sometimes|uuid', 'replacesId' => 'sometimes|uuid',
            'metadata' => 'sometimes|array',
            'tags' => 'sometimes|array|max:20', 'tags.*' => 'required|string|max:40|distinct',
            'retentionAnchor' => 'sometimes|uuid', 'retentionSeconds' => 'sometimes|integer|min:3600|max:1209600',
            'expiresAt' => 'sometimes|integer|min:0|max:9007199254740991',
            'originalChecksum' => 'sometimes|string|regex:/^[a-f0-9]{64}$/D',
            'thumbnailChecksum' => 'sometimes|string|regex:/^[a-f0-9]{64}$/D',
        ])->validate();
        $actor = $request->attributes->get('prototype_library');
        $library = $actor;
        $profile = null;
        if (isset($data['profile'])) {
            $row = DB::table('prototype_profiles')->where('id', $data['profile']['id'])->where(fn ($query) => $query->where('library_id', $actor)->orWhereIn('space_id', array_column(Collaboration::spaces($actor), 'id')))->first();
            abort_unless($row, 422);
            $snapshot = DB::table('prototype_profile_versions')->where('library_id', $row->library_id)->where('profile_id', $row->id)->where('version', $data['profile']['version'])->value('snapshot');
            abort_unless($snapshot, 422);
            $profile = json_decode($snapshot, true);
            $library = $row->library_id;
            abort_if(! isset($profile['spaceId']) && $actor !== $library, 403);
        }
        $space = $profile['spaceId'] ?? null;
        Collaboration::assertCapture($actor, $space);
        $committed = Library::photos($library)->where('id', $data['id'])->where('creator_id', $actor)->where('state', 'active')->exists();
        $assignment = isset($data['assignmentId']) ? Collaboration::assignment($actor, $data['assignmentId']) : null;
        if ($assignment) {
            abort_unless($space === $assignment->space_id && $profile['id'] === $assignment->profile_id, 422);
            $bound = json_decode($assignment->profile_snapshot, true);
            abort_unless($profile['version'] === $bound['version'], 422);
            abort_if($assignment->closed && ! $committed || ! in_array($actor, json_decode($assignment->assignees, true), true), 403);
        }
        if ($profile) {
            $shots = $assignment ? json_decode($assignment->shots, true) : $profile['rules']['shotList'];
            abort_if(! empty($data['category']) && ! in_array($data['category'], $profile['rules']['categories'], true), 422);
            abort_if(! empty($data['shot']) && ! in_array($data['shot'], $shots, true), 422);
        }
        if (isset($data['replacesId']) && ! $committed) {
            $previous = Library::photos($library)->where('id', $data['replacesId'])->first();
            abort_unless($space && $previous && $previous->space_id === $space && $previous->profile_id === $profile['id'] && $previous->assignment_id === $assignment?->id && $previous->creator_id === $actor && $previous->review_state === 'reshoot' && $previous->state === 'active' && ! Retention::expired($previous), 422);
        }
        $metadata = $this->metadata($data['metadata'] ?? [], $profile);
        $deadline = Retention::deadline($actor, $data, $profile);
        $original = $request->file('original');
        $thumbnail = $request->file('thumbnail');
        abort_unless($original->getSize() > 0 && $thumbnail->getSize() > 0, 422);
        $originalHash = hash_file('sha256', $original->getRealPath());
        $thumbnailHash = hash_file('sha256', $thumbnail->getRealPath());
        if (isset($data['originalChecksum']) && ! hash_equals($data['originalChecksum'], $originalHash)
            || isset($data['thumbnailChecksum']) && ! hash_equals($data['thumbnailChecksum'], $thumbnailHash)) {
            return ApiResponse::error($request, 503);
        }
        $fingerprintParts = [
            $originalHash, $thumbnailHash,
            $data['createdAt'], $data['width'], $data['height'], $data['mime'], $data['method'],
        ];
        if ($profile) {
            array_push($fingerprintParts, $profile['id'], $profile['version'], $data['shortId'], $data['shot'] ?? '');
        }
        if ($deadline !== null) {
            array_push($fingerprintParts, $data['retentionAnchor'], $data['retentionSeconds']);
        }
        if ($space) {
            array_push($fingerprintParts, $space, $actor, $data['assignmentId'] ?? null, $data['replacesId'] ?? null);
        }
        $fingerprint = hash('sha256', json_encode($fingerprintParts));
        // Commit a reservation before any S3 I/O; crashes leave discoverable keys.
        DB::transaction(function () use ($library, $actor, $space, $assignment, $data, $original, $thumbnail, $fingerprint, $profile, $metadata, $deadline): void {
            Library::lock($library);
            Collaboration::assertCapture($actor, $space);
            abort_if(DB::table('prototype_deletions')->where('library_id', $library)->where('id', $data['id'])->exists(), 410);
            $existing = Library::photos($library)->where('id', $data['id'])->first();
            if ($existing) {
                Collaboration::assertPhoto($actor, $existing, 'upload');
                abort_if($existing->state === 'deleted' || Retention::expired($existing), 410);
                abort_unless(hash_equals($existing->fingerprint, $fingerprint), 409);

                return;
            }
            if ($assignment) {
                abort_if(Collaboration::assignment($actor, $assignment->id)->closed, 403);
            }
            $reserved = Library::photos($library)->whereIn('state', ['active', 'pending']);
            abort_if(isset($data['shortId']) && Library::photos($library)->where('short_id', $data['shortId'])->exists(), 409);
            abort_if($reserved->count() >= config('prototype.max_photos') || $reserved->sum(DB::raw('bytes + thumbnail_bytes')) + $original->getSize() + $thumbnail->getSize() > config('prototype.max_bytes'), 413);
            $prefix = 'prototype/'.Str::uuid();
            Library::photos($library)->insert([
                'library_id' => $library, 'id' => $data['id'], 'state' => 'pending',
                'creator_id' => $actor, 'space_id' => $space, 'assignment_id' => $data['assignmentId'] ?? null, 'replaces_id' => $data['replacesId'] ?? null,
                'original_key' => $prefix.'/original', 'thumbnail_key' => $prefix.'/thumbnail',
                'fingerprint' => $fingerprint, 'bytes' => $original->getSize(), 'thumbnail_bytes' => $thumbnail->getSize(),
                'captured_at' => $data['createdAt'], 'width' => $data['width'], 'height' => $data['height'],
                'mime' => $data['mime'], 'method' => $data['method'], 'title' => $data['title'] ?? '',
                'note' => $data['note'] ?? '', 'favorite' => $data['favorite'], 'revision' => 1, 'created_at' => now(),
                'expires_at' => $deadline, 'retention_anchor' => $data['retentionAnchor'] ?? null, 'retention_seconds' => $data['retentionSeconds'] ?? null,
                'profile_id' => $profile['id'] ?? null, 'profile_version' => $profile['version'] ?? null,
                'profile_snapshot' => $profile ? json_encode($profile) : null, 'short_id' => $data['shortId'] ?? null,
                'metadata' => json_encode($metadata), 'tags' => json_encode($data['tags'] ?? []), 'category' => $data['category'] ?? '', 'shot' => $data['shot'] ?? '',
            ]);
        });
        $photo = DB::transaction(function () use ($library, $actor, $space, $assignment, $data, $original, $thumbnail) {
            Library::lock($library);
            Collaboration::assertCapture($actor, $space);
            $row = Library::photos($library)->where('id', $data['id'])->firstOrFail();
            Collaboration::assertPhoto($actor, $row, 'upload');
            abort_if($row->state === 'deleted' || Retention::expired($row), 410);
            if ($row->state === 'active') {
                return $row;
            }
            if ($assignment) {
                abort_if(Collaboration::assignment($actor, $assignment->id)->closed, 403);
            }
            try {
                $disk = Storage::disk(config('prototype.disk'));
                foreach ([[$row->original_key, $original, $row->bytes], [$row->thumbnail_key, $thumbnail, $row->thumbnail_bytes]] as [$key, $file, $bytes]) {
                    $stream = fopen($file->getRealPath(), 'rb');
                    try {
                        if (! $disk->put($key, $stream) || $disk->size($key) !== (int) $bytes) {
                            return null;
                        }
                    } finally {
                        if (is_resource($stream)) {
                            fclose($stream);
                        }
                    }
                }
            } catch (Throwable) {
                return null;
            }
            abort_if(Retention::expired($row), 410);
            Library::photos($library)->where('id', $row->id)->update(['state' => 'active']);

            return $row;
        });

        return $photo ? response()->json(['photo' => Library::serialize($photo, $actor)]) : ApiResponse::error($request, 503);
    }

    public function show(Request $request, string $id)
    {
        return response()->json(['photo' => Library::serialize($this->active($request, $id), $request->attributes->get('prototype_library'))]);
    }

    public function content(Request $request, string $id, string $kind)
    {
        abort_unless(in_array($kind, ['original', 'thumbnail'], true), 404);
        $photo = $this->active($request, $id);
        try {
            $stream = Storage::disk(config('prototype.disk'))->readStream($kind === 'original' ? $photo->original_key : $photo->thumbnail_key);
            if (! is_resource($stream)) {
                return ApiResponse::error($request, 503);
            }
        } catch (Throwable) {
            return ApiResponse::error($request, 503);
        }

        return response()->stream(function () use ($stream): void {
            try {
                fpassthru($stream);
            } finally {
                fclose($stream);
            }
        }, 200, ['Content-Type' => 'application/octet-stream', 'Content-Length' => (string) ($kind === 'original' ? $photo->bytes : $photo->thumbnail_bytes)]);
    }

    public function update(Request $request, string $id)
    {
        $data = $request->validate(['title' => 'present|nullable|string|max:120', 'note' => 'present|nullable|string|max:2000', 'favorite' => 'required|boolean', 'revision' => 'required|integer|min:1', 'category' => 'sometimes|nullable|string|max:80', 'metadata' => 'sometimes|array', 'expiresAt' => 'sometimes|integer|min:0|max:9007199254740991', 'tags' => 'sometimes|array|max:20', 'tags.*' => 'required|string|max:40|distinct']);
        $photo = DB::transaction(function () use ($request, $id, $data) {
            $actor = $request->attributes->get('prototype_library');
            $found = Collaboration::findPhoto($actor, $id);
            abort_unless($found, 404);
            $library = $found->library_id;
            Library::lock($library);
            $row = $this->active($request, $id, 'update');
            $access = Collaboration::assertPhoto($actor, $row, 'update');
            if ((int) $row->revision !== (int) $data['revision']) {
                $same = trim($data['title'] ?? '') === $row->title && trim($data['note'] ?? '') === $row->note && $data['favorite'] === (bool) $row->favorite
                    && (! isset($data['category']) || $data['category'] === $row->category)
                    && (! isset($data['tags']) || $data['tags'] === json_decode($row->tags ?? '[]', true))
                    && (! isset($data['metadata']) || $this->metadata($data['metadata'], $row->profile_snapshot ? json_decode($row->profile_snapshot, true) : null) == json_decode($row->metadata ?? '{}', true))
                    && (! isset($data['expiresAt']) || $row->expires_at !== null && $row->expires_at <= $data['expiresAt']);
                abort_unless($data['revision'] < $row->revision && $same, 409);

                return $row;
            }
            if (isset($data['expiresAt'])) {
                abort_if($data['expiresAt'] > ($row->expires_at ?? Retention::milliseconds() + 1209600000), 422);
            }
            $profile = $row->profile_snapshot ? json_decode($row->profile_snapshot, true) : null;
            $editable = $row->space_id && in_array($access['role'], ['owner', 'curator'], true) ? ($profile['rules']['curatorDescriptionEditable'] ?? true) : ($profile['rules']['descriptionEditable'] ?? true);
            if (! $editable) {
                $previousTags = json_decode($row->tags ?? '[]', true);
                abort_if($previousTags !== [] && isset($data['tags']) && $data['tags'] !== $previousTags, 403);
                foreach (['title', 'note', 'category'] as $field) {
                    abort_if($row->$field !== '' && array_key_exists($field, $data) && trim($data[$field] ?? '') !== $row->$field, 403);
                }
            }
            abort_if($profile && ! empty($data['category']) && ! in_array($data['category'], $profile['rules']['categories'], true), 422);
            $metadata = isset($data['metadata']) ? $this->metadata($data['metadata'], $profile) : json_decode($row->metadata ?? '{}', true);
            if (isset($data['metadata'])) {
                $previous = json_decode($row->metadata ?? '{}', true);
                foreach (['capturedAt', 'camera', 'resolutionLimited'] as $field) {
                    abort_if(($previous[$field] ?? null) !== ($metadata[$field] ?? null), 403);
                }
            }
            Library::photos($library)->where('id', $id)->update([
                'title' => trim($data['title'] ?? ''), 'note' => trim($data['note'] ?? ''),
                'favorite' => $data['favorite'], 'revision' => $row->revision + 1,
                'expires_at' => $data['expiresAt'] ?? $row->expires_at,
                'tags' => isset($data['tags']) ? json_encode($data['tags']) : $row->tags,
                'category' => $data['category'] ?? $row->category, 'metadata' => json_encode($metadata),
            ]);

            return Library::photos($library)->where('id', $id)->firstOrFail();
        });

        return response()->json(['photo' => Library::serialize($photo, $request->attributes->get('prototype_library'))]);
    }

    public function delete(Request $request, string $id)
    {
        $data = $request->validate(['spaceId' => 'sometimes|uuid']);
        $actor = $request->attributes->get('prototype_library');
        $photo = Collaboration::findPhoto($actor, $id);
        $library = $photo?->library_id ?? $actor;
        if (! $photo && isset($data['spaceId'])) {
            Collaboration::assertCapture($actor, $data['spaceId']);
            $library = DB::table('prototype_spaces')->where('id', $data['spaceId'])->value('owner_id');
        }
        DB::transaction(function () use ($library, $actor, $id, $data): void {
            Library::lock($library);
            $current = Library::photos($library)->where('id', $id)->first();
            if ($current) {
                Collaboration::assertPhoto($actor, $current, 'delete');
            } elseif (isset($data['spaceId'])) {
                Collaboration::assertCapture($actor, $data['spaceId']);
            }
            Retention::revoke($library, $id);
        });
        $verified = ! Library::photos($library)->where('id', $id)->exists() || Library::cleanup($library, $id);

        return response()->json(['deletion' => $verified ? 'verified' : 'pending'], $verified ? 200 : 202);
    }

    private function active(Request $request, string $id, string $operation = 'read'): object
    {
        $actor = $request->attributes->get('prototype_library');
        $photo = Collaboration::findPhoto($actor, $id);
        abort_unless($photo, 404);
        Collaboration::assertPhoto($actor, $photo, $operation);
        abort_if($photo->state === 'deleted' || Retention::expired($photo), 410);
        abort_unless($photo->state === 'active', 404);

        return $photo;
    }

    private function metadata(array $metadata, ?array $profile): array
    {
        $value = Validator::make(['metadata' => $metadata], [
            'metadata' => 'array:capturedAt,camera,location,locationStatus,resolutionLimited',
            'metadata.capturedAt' => 'sometimes|integer|min:0|max:9007199254740991',
            'metadata.camera' => 'sometimes|string|max:120',
            'metadata.locationStatus' => ['sometimes', Rule::in(['pending', 'unavailable'])],
            'metadata.resolutionLimited' => 'sometimes|boolean',
            'metadata.location' => 'sometimes|array:latitude,longitude,accuracy,measuredAt',
            'metadata.location.latitude' => 'required_with:metadata.location|numeric|between:-90,90',
            'metadata.location.longitude' => 'required_with:metadata.location|numeric|between:-180,180',
            'metadata.location.accuracy' => 'required_with:metadata.location|numeric|min:0|max:10000000',
            'metadata.location.measuredAt' => 'required_with:metadata.location|integer|min:0|max:9007199254740991',
        ])->validate()['metadata'];
        if ($profile) {
            $rules = $profile['rules'];
            abort_if(! $rules['keepDate'] && isset($value['capturedAt']), 422);
            abort_if(! $rules['keepCamera'] && isset($value['camera']), 422);
            abort_if($rules['location'] === 'off' && (isset($value['location']) || isset($value['locationStatus'])), 422);
        }

        return $value;
    }
}
