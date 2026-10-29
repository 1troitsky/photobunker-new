<?php

namespace App\Rtc;

use App\Identity\Accounts;
use App\Identity\MatrixBridge;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\HttpException;

final class Admissions
{
    public function __construct(private readonly MatrixBridge $matrix, private readonly Accounts $accounts) {}

    public function room(string $actor, string $roomId, bool $prepare = false): array
    {
        $path = '/_matrix/client/v3/rooms/'.rawurlencode($roomId);
        try {
            $state = $this->matrix->workspaceRequest($actor, 'GET', $path.'/state');
        } catch (\Throwable) {
            abort(403);
        }
        $find = fn ($type) => collect($state)->first(fn ($e) => ($e['type'] ?? '') === $type && ($e['state_key'] ?? '') === '');
        abort_unless(($find('m.room.encryption')['content']['algorithm'] ?? '') === 'm.megolm.v1.aes-sha2', 403);
        $chat = $find('org.photobunker.chat')['content']['kind'] ?? null;
        $assignment = $find('org.photobunker.assignment')['content']['id'] ?? null;
        abort_unless(in_array($chat, ['direct', 'group'], true) || is_string($assignment), 403);
        $members = collect($state)->where('type', 'm.room.member')->filter(fn ($e) => ($e['content']['membership'] ?? '') === 'join');
        abort_unless($members->contains(fn ($e) => $e['state_key'] === $this->matrix->mxid($actor)), 403);
        foreach ($members as $member) {
            $id = $this->accountFor($member['state_key']);
            abort_unless($id && ! $this->accounts->blocked($actor, $id), 403);
        }
        $creator = $this->accountFor($find('m.room.create')['sender'] ?? '');
        abort_unless($creator, 403);
        if ($assignment) {
            $record = DB::table('workspace_records')->where('id', $assignment)->where('kind', 'task')->whereNull('deleted_at')->first();
            abort_unless($record && $record->room_id === $roomId && ($record->owner_id === $actor || DB::table('workspace_members')->where('record_id', $assignment)->where('account_id', $actor)->where('state', 'accepted')->exists()), 403);
        }
        if ($prepare) {
            $powers = $find('m.room.power_levels')['content'] ?? [];
            $events = $powers['events'] ?? [];
            if (($events['org.matrix.msc3401.call.member'] ?? 50) !== 0) {
                $events['org.matrix.msc3401.call.member'] = 0;
                $this->matrix->workspaceRequest($creator, 'PUT', $path.'/state/m.room.power_levels', [...$powers, 'users' => (object) ($powers['users'] ?? []), 'events' => (object) $events]);
            }
        }

        return $state;
    }

    private function accountFor(string $mxid): ?string
    {
        if (! preg_match('/^@pb_([a-f0-9]{32}):'.preg_quote(config('identity.matrix_server'), '/').'$/D', $mxid, $m)) {
            return null;
        }
        $hex = $m[1];
        $id = substr($hex, 0, 8).'-'.substr($hex, 8, 4).'-'.substr($hex, 12, 4).'-'.substr($hex, 16, 4).'-'.substr($hex, 20);

        return DB::table('identity_accounts')->where('id', $id)->exists() ? $id : null;
    }

    public function upstream(array $session, string $room): array
    {
        try {
            $openid = Http::baseUrl(config('identity.matrix_url'))->withToken($session['accessToken'])->connectTimeout(2)->timeout(8)->post('/_matrix/client/v3/user/'.rawurlencode($session['userId']).'/openid/request_token', (object) []);
            abort_unless($openid->successful() && $openid->json('matrix_server_name') === config('identity.matrix_server'), 503);
            $result = Http::connectTimeout(2)->timeout(15)->post(config('rtc.jwt_url').'/sfu/get', ['room' => $room, 'device_id' => $session['deviceId'], 'openid_token' => $openid->json()]);
            abort_unless($result->successful() && is_string($result->json('jwt')), 503);
            $claims = (array) JWT::decode($result->json('jwt'), new Key(config('rtc.secret'), 'HS256'));
            abort_unless(($claims['iss'] ?? '') === config('rtc.key') && ($claims['sub'] ?? '') === $session['userId'].':'.$session['deviceId'] && isset($claims['video']->room) && $claims['video']->roomJoin === true && $claims['video']->room === rtrim(base64_encode(hash('sha256', json_encode([$room, 'm.call#ROOM'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), true)), '=') && empty($claims['video']->roomAdmin) && empty($claims['video']->roomCreate), 503);
            $id = (string) Str::uuid();
            $claims['attributes'] = ['pb_admission' => $id];
            $claims['metadata'] = '';
            $claims['iat'] = time();
            $claims['nbf'] = time() - 1;
            $claims['exp'] = time() + 60;
            // Permit only media publication/subscription in this exact room, no metadata/admin/data grants.
            $claims['video'] = ['room' => $claims['video']->room, 'roomJoin' => true, 'canPublish' => true, 'canSubscribe' => true, 'canPublishData' => false, 'canUpdateOwnMetadata' => false];

            return ['id' => $id, 'jwt' => JWT::encode($claims, config('rtc.secret'), 'HS256'), 'room' => $claims['video']['room'], 'participant' => $claims['sub']];
        } catch (HttpException $e) {
            throw $e;
        } catch (\Throwable) {
            abort(503);
        }
    }

    private function current(object $ticket): bool
    {
        if ($ticket->ended_at || strtotime($ticket->expires_at) <= time() || strtotime($ticket->checked_at ?? $ticket->created_at) + 45 < time()) {
            return false;
        }
        $device = DB::table('identity_devices')->where('id', $ticket->device_id)->where('account_id', $ticket->account_id)->first();

        return $device && ! $device->revoked_at && ! $device->matrix_revoke_pending && DB::table('identity_sessions')->where('token_hash', $ticket->session_hash)->where('device_id', $ticket->device_id)->where(fn ($q) => $q->whereNull('expires_at')->orWhere('expires_at', '>', now()))->exists();
    }

    public function valid(object $ticket): bool
    {
        if (! $this->current($ticket)) {
            return false;
        }
        try {
            $this->room($ticket->account_id, $ticket->room_id);
            // Room authorization performs network I/O. End/revoke may commit while it is pending.
            $latest = DB::table('rtc_admissions')->find($ticket->id);

            return $latest && $this->current($latest);
        } catch (\Throwable) {
            return false;
        }
    }

    private function adminToken(array $grants): string
    {
        return JWT::encode(['iss' => config('rtc.key'), 'nbf' => time() - 1, 'exp' => time() + 30, 'video' => $grants], config('rtc.secret'), 'HS256');
    }

    public function remove(object $ticket, bool $lockHeld = false): bool
    {
        // End admission immediately even when another device operation owns the lock.
        DB::table('rtc_admissions')->where('id', $ticket->id)->update(['ended_at' => $ticket->ended_at ?? now()]);
        if ($lockHeld) {
            return $this->removeFromSfu($ticket);
        }

        return (bool) Cache::lock('rtc-device:'.$ticket->device_id, 120)->get(fn () => $this->removeFromSfu($ticket));
    }

    private function removeFromSfu(object $ticket): bool
    {
        DB::table('rtc_admissions')->where('id', $ticket->id)->update(['ended_at' => $ticket->ended_at ?? now()]);
        if (DB::table('rtc_admissions')->where('id', '!=', $ticket->id)->where('sfu_room', $ticket->sfu_room)->where('participant', $ticket->participant)->whereNull('ended_at')->exists()) {
            DB::table('rtc_admissions')->where('id', $ticket->id)->update(['removed_at' => now()]);

            return true;
        }
        try {
            $result = Http::withToken($this->adminToken(['room' => $ticket->sfu_room, 'roomAdmin' => true]))->connectTimeout(2)->timeout(5)->post(config('rtc.sfu_url').'/twirp/livekit.RoomService/RemoveParticipant', ['room' => $ticket->sfu_room, 'identity' => $ticket->participant]);
            if (! $result->successful() && ! in_array($result->status(), [404], true)) {
                return false;
            }
            DB::table('rtc_admissions')->where('id', $ticket->id)->update(['removed_at' => now()]);

            return true;
        } catch (\Throwable) {
            return false;
        }
    }

    public function revokeDevice(string $id, bool $lockHeld = false): void
    {
        foreach (DB::table('rtc_admissions')->where('device_id', $id)->whereNull('ended_at')->get() as $t) {
            $this->remove($t, $lockHeld);
        }
    }

    public function maintain(): void
    {
        if (! config('rtc.enabled')) {
            return;
        }
        DB::table('rtc_admissions')->where('ended_at', '<', now()->subDay())->whereNotNull('removed_at')->delete();
        foreach (DB::table('rtc_admissions')->where(function ($q) {
            $q->whereNull('ended_at')->orWhere('ended_at', '>', now()->subSeconds(65))->orWhereNull('removed_at');
        })->orderBy('id')->get() as $t) {
            // Repeat removals through the issued token's original admission window.
            if ($t->ended_at || ! $this->valid($t)) {
                $this->remove($t);
            }
        }
    }
}
