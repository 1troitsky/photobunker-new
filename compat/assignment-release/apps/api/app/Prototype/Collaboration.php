<?php

namespace App\Prototype;

use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

final class Collaboration
{
    public static function access(string $actor, ?string $space): array
    {
        if ($space === null) {
            return ['role' => 'owner', 'readOwnPhotos' => true, 'manageProfiles' => true];
        }
        $row = DB::table('prototype_spaces')->where('id', $space)->first();
        abort_unless($row, 404);
        if ($row->owner_id === $actor) {
            return ['role' => 'owner', 'readOwnPhotos' => true, 'manageProfiles' => true];
        }
        $member = DB::table('prototype_members')->where('space_id', $space)->where('actor_id', $actor)->where('active', true)->first();
        abort_unless($member, 403);

        return ['role' => $member->role, 'readOwnPhotos' => (bool) $member->read_own, 'manageProfiles' => (bool) $member->manage_profiles];
    }

    public static function spaces(string $actor): array
    {
        return DB::table('prototype_spaces')->where('owner_id', $actor)->orWhereIn('id', DB::table('prototype_members')->where('actor_id', $actor)->where('active', true)->select('space_id'))
            ->get()->map(fn ($space) => ['id' => $space->id, 'name' => $space->name, 'ownerId' => $space->owner_id, ...self::access($actor, $space->id)])->all();
    }

    public static function profile(string $actor, string $id): object
    {
        $own = DB::table('prototype_profiles')->where('library_id', $actor)->where('id', $id)->first();
        if ($own) {
            return $own;
        }
        $row = DB::table('prototype_profiles')->where('id', $id)->whereIn('space_id', array_column(self::spaces($actor), 'id'))->first();
        abort_unless($row, 404);

        return $row;
    }

    public static function profileData(object $row, string $actor): array
    {
        $snapshot = DB::table('prototype_profile_versions')->where('library_id', $row->library_id)->where('profile_id', $row->id)->where('version', $row->version)->value('snapshot');

        return [...json_decode($snapshot, true), 'archived' => (bool) $row->archived, 'access' => self::access($actor, $row->space_id)];
    }

    public static function assertCapture(string $actor, ?string $space): array
    {
        $access = self::access($actor, $space);
        abort_unless(in_array($access['role'], ['owner', 'curator', 'contributor'], true), 403);

        return $access;
    }

    public static function assertPhoto(string $actor, object $photo, string $operation): array
    {
        if ($photo->space_id === null) {
            abort_unless($photo->library_id === $actor, 404);

            return self::access($actor, null);
        }
        $access = self::access($actor, $photo->space_id);
        if (in_array($access['role'], ['owner', 'curator'], true)) {
            return $access;
        }
        if ($access['role'] === 'viewer') {
            abort_unless($operation === 'read', 403);

            return $access;
        }
        abort_unless($photo->creator_id === $actor, 403);
        if ($operation === 'read') {
            abort_unless($access['readOwnPhotos'], 403);
        }

        return $access;
    }

    public static function findPhoto(string $actor, string $id): ?object
    {
        return Library::photos($actor)->where('id', $id)->first()
            ?? DB::table('prototype_photos')->where('id', $id)->whereIn('space_id', array_column(self::spaces($actor), 'id'))->first();
    }

    public static function visiblePhotos(string $actor): Builder
    {
        $spaces = self::spaces($actor);
        $all = array_column(array_filter($spaces, fn ($space) => in_array($space['role'], ['owner', 'curator', 'viewer'], true)), 'id');
        $own = array_column(array_filter($spaces, fn ($space) => $space['role'] === 'contributor' && $space['readOwnPhotos']), 'id');

        return DB::table('prototype_photos')->where(function ($query) use ($actor, $all, $own): void {
            $query->where(fn ($personal) => $personal->where('library_id', $actor)->whereNull('space_id'))
                ->orWhereIn('space_id', $all)->orWhere(fn ($mine) => $mine->whereIn('space_id', $own)->where('creator_id', $actor));
        });
    }

    public static function assignment(string $actor, string $id): object
    {
        $row = DB::table('prototype_assignments')->where('id', $id)->first();
        abort_unless($row, 404);
        $access = self::access($actor, $row->space_id);
        abort_if($access['role'] === 'contributor' && ! in_array($actor, json_decode($row->assignees, true), true), 403);

        return $row;
    }
}
