<?php

namespace App\Workspace;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * R1-02: never reuse numbers (even after photo deletion, TTL or revocation).
 * A committed lease is irrevocable and scoped to its original device/account.
 */
final class PhotoNames
{
    public function __construct(private readonly Workspace $workspace) {}

    private function subject(string $actor, ?string $assignment): string
    {
        if ($assignment) {
            $task = $this->workspace->record($actor, $assignment, 'task');
            $member = $this->workspace->member($actor, $task);
            $role = $task->owner_id === $actor ? 'owner' : $member?->role;
            abort_unless(in_array($role, ['owner', 'curator', 'contributor'], true), 403);
            return 'assignment:'.$assignment;
        }

        return 'account:'.$actor;
    }

    private function letters(int $index): string
    {
        abort_if($index >= 26 ** 4, 507, 'photo_names.exhausted');
        $value = '';
        for ($i = 0; $i < 4; $i++) {
            $value = chr(65 + $index % 26).$value;
            $index = intdiv($index, 26);
        }
        return $value;
    }

    /**
     * Must execute inside a DB transaction. All prefix counters, the global
     * allocator and lease creation are serialized by row locks.
     */
    private function lease(string $actor, string $device, ?string $assignment, string $requestKey, int $count): array
    {
        $subject = $this->subject($actor, $assignment);
        // Even repeated reserve requests serialize before the idempotency
        // lookup, including when the prior HTTP ACK was lost.
        $allocator = DB::table('photo_name_allocator')->where('id', 1)->lockForUpdate()->first();
        $existing = DB::table('photo_name_leases')->where('account_id', $actor)->where('device_id', $device)->where('request_key', $requestKey)->first();
        if ($existing) {
            abort_unless($existing->subject === $subject && $existing->assignment_id === $assignment, 409);
            return $this->formatLease($existing);
        }
        // A global lock serializes prefix rollover with parallel allocations
        // by other accounts and assignment participants.
        $prefix = DB::table('photo_name_prefixes')->where('subject', $subject)->where('next_number', '<=', 9999)->orderByDesc('sequence')->lockForUpdate()->first();
        if (! $prefix) {
            $preferred = null;
            if ($assignment) {
                $task = $this->workspace->record($actor, $assignment, 'task');
                $preset = $this->workspace->payload($task)['preset'] ?? null;
                $option = $preset['rules']['idPrefix'] ?? null;
                if (is_string($option) && preg_match('/^[A-Z]{4}$/D', $option) &&
                    ! DB::table('photo_name_prefixes')->where('prefix', $option)->exists())
                    $preferred = $option;
            }
            // The global sequence never assigns a previously claimed preferred
            // prefix to a different subject. Exhausted prefixes are permanent.
            $next = (int) $allocator->next_prefix;
            if ($preferred) {
                $letters = $preferred;
                $next++;
            } else {
                do {
                    $letters = $this->letters($next++);
                } while (DB::table('photo_name_prefixes')->where('prefix', $letters)->exists());
            }
            DB::table('photo_name_allocator')->where('id', 1)->update(['next_prefix' => $next]);
            DB::table('photo_name_prefixes')->insert(['prefix' => $letters, 'subject' => $subject, 'sequence' => $next - 1, 'next_number' => 1]);
            $prefix = DB::table('photo_name_prefixes')->where('prefix', $letters)->first();
        }
        $first = (int) $prefix->next_number;
        $last = min(9999, $first + $count - 1);
        DB::table('photo_name_prefixes')->where('prefix', $prefix->prefix)->update(['next_number' => $last + 1]);
        $id = (string) Str::uuid();
        DB::table('photo_name_leases')->insert([
            'id' => $id, 'account_id' => $actor, 'device_id' => $device,
            'assignment_id' => $assignment, 'subject' => $subject,
            'prefix' => $prefix->prefix, 'first_number' => $first,
            'last_number' => $last, 'request_key' => $requestKey,
        ]);
        return ['id' => $id, 'prefix' => $prefix->prefix, 'first' => $first, 'last' => $last, 'assignmentId' => $assignment];
    }

    private function formatLease(object $row): array
    {
        return ['id' => $row->id, 'prefix' => $row->prefix,
            'first' => (int) $row->first_number, 'last' => (int) $row->last_number,
            'assignmentId' => $row->assignment_id];
    }

    public function reserve(string $actor, string $device, ?string $assignment, string $key, int $count = 32): array
    {
        abort_unless(Str::isUuid($key) && $count >= 1 && $count <= 64, 422);
        return DB::transaction(fn () => $this->lease($actor, $device, $assignment, $key, $count), 3);
    }

    /** Bind idempotently to UUID; same photo can never acquire a second code. */
    public function claim(string $actor, string $device, string $photo, ?string $assignment, ?string $leaseId, ?int $number): string
    {
        return DB::transaction(function () use ($actor, $device, $photo, $assignment, $leaseId, $number) {
            // Serialize concurrent claims (including lost ACK replay) before
            // testing UUID and code uniqueness.
            DB::table('photo_name_allocator')->where('id', 1)->lockForUpdate()->first();
            $prior = DB::table('photo_name_codes')->where('photo_id', $photo)->first();
            if ($prior) {
                abort_unless($prior->creator_id === $actor, 404);
                return $prior->code;
            }
            // Older uploaded photos have published shortIds in their
            // original manifests; never assign them a new public name.
            abort_if(DB::table('workspace_photos')->where('id', $photo)->exists() ||
                DB::table('encrypted_photos')->where('id', $photo)->exists(), 409, 'photo_names.published');
            $this->subject($actor, $assignment);
            if ($leaseId) {
                $lease = DB::table('photo_name_leases')->where('id', $leaseId)->first();
                abort_unless($lease && $lease->account_id === $actor &&
                    $lease->device_id === $device && $lease->assignment_id === $assignment, 403);
                abort_unless($number !== null && $number >= $lease->first_number && $number <= $lease->last_number, 422);
                $code = $lease->prefix.sprintf('%04d', $number);
            } else {
                abort_unless($number === null, 422);
                // Bind a single number after reconnect. Photo UUID is the
                // idempotency key if the server response is lost.
                $reserved = $this->lease($actor, $device, $assignment, $photo, 1);
                $leaseId = $reserved['id'];
                $code = $reserved['prefix'].sprintf('%04d', $reserved['first']);
            }
            abort_if(DB::table('photo_name_codes')->where('code', $code)->exists(), 409, 'photo_names.used');
            // Unique(photo_id) AND unique(code) enforce one-to-one mapping.
            DB::table('photo_name_codes')->insert([
                'photo_id' => $photo, 'code' => $code,
                'creator_id' => $actor, 'device_id' => $device, 'lease_id' => $leaseId,
            ]);
            return $code;
        }, 3);
    }

    public function forPhoto(string $id): ?string
    {
        return DB::table('photo_name_codes')->where('photo_id', $id)->value('code');
    }
}
