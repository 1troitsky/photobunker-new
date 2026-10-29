<?php

namespace App\Prototype;

use Illuminate\Support\Facades\DB;

final class Retention
{
    public static function milliseconds(): int
    {
        return (int) floor(now()->getTimestampMs());
    }

    public static function expired(object $photo): bool
    {
        return $photo->expires_at !== null && (int) $photo->expires_at <= self::milliseconds();
    }

    public static function deadline(string $library, array $data, ?array $profile): ?int
    {
        if (! isset($data['retentionSeconds']) && ! isset($profile['rules']['retentionSeconds'])) {
            return null; // Existing prototype captures keep their original policy.
        }
        abort_unless(isset($data['retentionSeconds'], $data['retentionAnchor']), 422);
        $duration = $data['retentionSeconds'];
        abort_if($duration > ($profile['rules']['retentionSeconds'] ?? 1209600), 422);
        $issued = DB::table('prototype_clock_anchors')->where('id', $data['retentionAnchor'])->where('library_id', $library)->value('issued_at');
        abort_unless($issued !== null, 422);
        // Client capture time can shorten this bound, never extend a server anchor.
        $deadline = min((int) $issued + $duration * 1000, $data['createdAt'] + $duration * 1000, $data['expiresAt'] ?? PHP_INT_MAX);
        abort_if($deadline <= self::milliseconds(), 410);

        return $deadline;
    }

    public static function revoke(string $library, string $id): void
    {
        DB::table('prototype_deletions')->insertOrIgnore(['library_id' => $library, 'id' => $id]);
        Library::photos($library)->where('id', $id)->update(['state' => 'deleted']);
    }
}
