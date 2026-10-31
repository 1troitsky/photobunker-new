<?php

namespace App\Prototype;

use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Throwable;

final class Library
{
    public static function lock(string $id): void
    {
        DB::table('prototype_libraries')->where('id', $id)->lockForUpdate()->firstOrFail();
    }

    public static function photos(string $library): Builder
    {
        return DB::table('prototype_photos')->where('library_id', $library);
    }

    public static function serialize(object $photo, ?string $actor = null): array
    {
        return array_filter([
            'expiresAt' => $photo->expires_at !== null ? (int) $photo->expires_at : null,
            'retentionSeconds' => $photo->retention_seconds !== null ? (int) $photo->retention_seconds : null,
            'retentionAnchor' => $photo->retention_anchor,
            'id' => $photo->id, 'createdAt' => (int) $photo->captured_at,
            'width' => (int) $photo->width, 'height' => (int) $photo->height,
            'bytes' => (int) $photo->bytes, 'mime' => $photo->mime, 'method' => $photo->method,
            'title' => $photo->title, 'note' => $photo->note, 'favorite' => (bool) $photo->favorite,
            'remoteRevision' => (int) $photo->revision, 'remoteLibraryId' => $actor ?? $photo->library_id,
            'spaceId' => $photo->space_id, 'creatorId' => $photo->creator_id, 'assignmentId' => $photo->assignment_id, 'replacesId' => $photo->replaces_id,
            'reviewState' => $photo->space_id ? $photo->review_state : null, 'reviewRevision' => (int) $photo->review_revision,
            'reviewComment' => $photo->review_comment, 'responseComment' => $photo->response_comment,
            'access' => $actor ? Collaboration::access($actor, $photo->space_id) : null,
            'uploadOnly' => $actor && $photo->space_id ? (($grant = Collaboration::access($actor, $photo->space_id))['role'] === 'contributor' && ! $grant['readOwnPhotos']) : false,
            'tags' => $photo->tags ? json_decode($photo->tags, true) : [],
            'profile' => $photo->profile_snapshot ? json_decode($photo->profile_snapshot, true) : null,
            'shortId' => $photo->short_id, 'category' => $photo->category, 'shot' => $photo->shot,
            'metadata' => $photo->metadata ? (object) json_decode($photo->metadata, true) : null,
        ], fn ($value) => $value !== null);
    }

    // Access is revoked by a committed tombstone before physical deletion starts.
    public static function cleanup(string $library, string $id): bool
    {
        return DB::transaction(function () use ($library, $id): bool {
            self::lock($library);
            $photo = self::photos($library)->where('id', $id)->first();
            if (! $photo || $photo->state !== 'deleted') {
                return false;
            }
            if ($photo->delete_verified_at !== null) {
                return true;
            }
            try {
                $disk = Storage::disk(config('prototype.disk'));
                foreach ([$photo->original_key, $photo->thumbnail_key] as $key) {
                    if (! $disk->delete($key) || $disk->exists($key)) {
                        throw new \RuntimeException('prototype.delete_unverified');
                    }
                }
                self::photos($library)->where('id', $id)->update(['delete_verified_at' => now(), 'delete_retry_at' => null,
                    'title' => '', 'note' => '', 'category' => '', 'shot' => '', 'tags' => null, 'short_id' => null, 'metadata' => null, 'profile_snapshot' => null,
                    'review_comment' => null, 'response_comment' => null]);

                return true;
            } catch (Throwable) {
                self::photos($library)->where('id', $id)->update(['delete_attempts' => $photo->delete_attempts + 1, 'delete_retry_at' => now()->addSeconds(min(3600, 2 ** min(11, $photo->delete_attempts + 1)))]);

                return false;
            }
        });
    }
}
