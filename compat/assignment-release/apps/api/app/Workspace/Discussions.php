<?php

namespace App\Workspace;

use App\Identity\Accounts;
use App\Identity\MatrixBridge;
use App\Identity\MatrixFailure;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

final class Discussions
{
    public function __construct(private readonly Workspace $workspace, private readonly MatrixBridge $matrix) {}

    public function reconcile(string $id): void
    {
        Cache::lock('workspace:discussion:'.$id, 180)->block(10, function () use ($id): void {
            $row = DB::table('workspace_records')->where('id', $id)->where('kind', 'task')->first();
            if (! $row || $row->room_state === 'none') {
                return;
            }
            $version = $row->revision;
            $stage = 'create';
            try {
                $call = fn ($method, $path, $data = []) => $this->matrix->workspaceRequest($row->owner_id, $method, '/_matrix/client/v3/'.$path, $data);
                $mxid = $this->matrix->mxid($row->owner_id);
                $payload = $this->workspace->payload($row);
                $room = $row->room_id;
                if (! $room && ! $row->deleted_at) {
                    $aliasName = 'photobunker_assignment_'.str_replace('-', '', $id);
                    $alias = '#'.$aliasName.':'.config('identity.matrix_server');
                    try {
                        $room = $call('GET', 'directory/room/'.rawurlencode($alias))['room_id'];
                    } catch (MatrixFailure $error) {
                        if (! str_contains($error->getMessage(), '.404.')) {
                            throw new \RuntimeException('workspace.reconcile.'.$stage, previous: $error);
                        }
                    }
                    if (! $room) {
                        $room = $call('POST', 'createRoom', ['room_alias_name' => $aliasName, 'name' => $payload['name'], 'preset' => 'private_chat',
                            'initial_state' => [['type' => 'm.room.encryption', 'state_key' => '', 'content' => ['algorithm' => 'm.megolm.v1.aes-sha2']],
                                ['type' => 'm.room.history_visibility', 'state_key' => '', 'content' => ['history_visibility' => 'joined']],
                                ['type' => 'org.photobunker.assignment', 'state_key' => '', 'content' => ['id' => $id, 'version' => 1]]]])['room_id'];
                    }
                    // A room alias is only an idempotency locator, never proof of ownership.
                    $stage = 'binding';
                    $state = $call('GET', 'rooms/'.rawurlencode($room).'/state');
                    $created = collect($state)->firstWhere('type', 'm.room.create');
                    $binding = collect($state)->firstWhere('type', 'org.photobunker.assignment');
                    $encryption = collect($state)->firstWhere('type', 'm.room.encryption');
                    abort_unless(($created['sender'] ?? '') === $mxid && ($binding['content']['id'] ?? '') === $id && ($encryption['content']['algorithm'] ?? '') === 'm.megolm.v1.aes-sha2', 503);
                    DB::table('workspace_records')->where('id', $id)->update(['room_id' => $room]);
                }
                if ($room) {
                    $desired = [$mxid];
                    if (! $row->deleted_at) {
                        foreach (DB::table('workspace_members')->where('record_id', $id)->where('state', 'accepted')->get() as $member) {
                            if (! app(Accounts::class)->blocked($row->owner_id, $member->account_id)) {
                                $desired[] = $this->matrix->mxid($member->account_id);
                            }
                        }
                    }
                    $stage = 'policy';
                    $creation = $call('GET', 'rooms/'.rawurlencode($room).'/state/m.room.create');
                    $roomVersion = $creation['room_version'] ?? '1';
                    abort_unless(in_array($roomVersion, array_map('strval', range(1, 12)), true) && empty($creation['additional_creators']), 503);
                    $users = $roomVersion === '12' ? [] : [$mxid => 100];
                    $powers = $call('GET', 'rooms/'.rawurlencode($room).'/state/m.room.power_levels');
                    $policy = [...$powers, 'users' => (object) $users, 'users_default' => 0, 'invite' => 50, 'kick' => 50, 'ban' => 50, 'state_default' => 50, 'events_default' => 0, 'redact' => $powers['redact'] ?? 50, 'events' => (object) ($powers['events'] ?? []), 'notifications' => (object) ($powers['notifications'] ?? ['room' => 50])];
                    if (($powers['invite'] ?? 0) !== 50 || ($powers['users'] ?? []) !== $users || ($powers['state_default'] ?? 50) !== 50 || ($powers['users_default'] ?? 0) !== 0) {
                        $call('PUT', 'rooms/'.rawurlencode($room).'/state/m.room.power_levels', $policy);
                    }
                    $stage = 'members';
                    $members = $call('GET', 'rooms/'.rawurlencode($room).'/members')['chunk'];
                    $present = [];
                    foreach ($members as $member) {
                        if (in_array($member['content']['membership'] ?? '', ['join', 'invite'], true)) {
                            $present[] = $member['state_key'];
                        }
                    }
                    $operations = 0;
                    foreach (array_diff($present, $desired) as $user) {
                        if (++$operations > 10) {
                            $this->retryBatch($id, $version);

                            return;
                        }
                        if (! $this->current($id, $version)) {
                            return;
                        }
                        $stage = 'remove';
                        $call('POST', 'rooms/'.rawurlencode($room).'/kick', ['user_id' => $user, 'reason' => 'PhotoBunker access updated']);
                    }
                    foreach (array_diff($desired, $present) as $user) {
                        if (++$operations > 10) {
                            $this->retryBatch($id, $version);

                            return;
                        }
                        if (! $this->current($id, $version)) {
                            return;
                        }
                        $stage = 'invite';
                        $call('POST', 'rooms/'.rawurlencode($room).'/invite', ['user_id' => $user]);
                    }
                    if (! $row->deleted_at && $this->current($id, $version)) {
                        $stage = 'name';
                        $call('PUT', 'rooms/'.rawurlencode($room).'/state/m.room.name/', ['name' => $payload['name']]);
                    }
                }
                DB::table('workspace_records')->where('id', $id)->where('revision', $version)->update(['room_state' => 'ready', 'room_retry_at' => now()->addMinutes(5)]);
            } catch (\Throwable $error) {
                DB::table('workspace_records')->where('id', $id)->where('revision', $version)->update(['room_state' => 'pending', 'room_retry_at' => now()->addSeconds(30)]);
                throw new \RuntimeException('workspace.reconcile.'.$stage, previous: $error);
            }
        });
    }

    private function retryBatch(string $id, int $revision): void
    {
        DB::table('workspace_records')->where('id', $id)->where('revision', $revision)->update(['room_state' => 'pending', 'room_retry_at' => now()->addSeconds(15)]);
    }

    private function current(string $id, int $revision): bool
    {
        return DB::table('workspace_records')->where('id', $id)->where('revision', $revision)->exists();
    }
}
