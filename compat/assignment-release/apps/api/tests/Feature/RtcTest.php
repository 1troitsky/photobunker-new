<?php

namespace Tests\Feature;

use App\Identity\Accounts;
use App\Identity\MatrixBridge;
use App\Rtc\Admissions;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

final class RtcTest extends TestCase
{
    use RefreshDatabase;

    private array $actor;

    private array $other;

    private array $state;

    private string $room = '!synthetic-room-v12';

    private bool $badGrant = false;

    private bool $removalFails = false;

    private int $removals = 0;

    private bool $revokeDuringState = false;

    protected function setUp(): void
    {
        parent::setUp();
        config(['identity.enabled' => true, 'rtc.enabled' => true, 'rtc.key' => 'synthetic-api-key', 'rtc.secret' => str_repeat('synthetic-', 8)]);
        $this->withCredentials()->withHeaders(['X-PhotoBunker' => 'identity-v1', 'Origin' => 'http://localhost:8080']);
        $this->actor = $this->fixture();
        $this->other = $this->fixture();
        $this->withUnencryptedCookie('pb_identity', $this->actor['cookie']);
        $this->state = [
            ['type' => 'm.room.create', 'state_key' => '', 'sender' => $this->actor['mxid']],
            ['type' => 'm.room.encryption', 'state_key' => '', 'content' => ['algorithm' => 'm.megolm.v1.aes-sha2']],
            ['type' => 'org.photobunker.chat', 'state_key' => '', 'content' => ['kind' => 'direct']],
            ['type' => 'm.room.power_levels', 'state_key' => '', 'content' => ['users' => [$this->actor['mxid'] => 100], 'events' => ['org.matrix.msc3401.call.member' => 0]]],
            ['type' => 'm.room.member', 'state_key' => $this->actor['mxid'], 'content' => ['membership' => 'join']],
            ['type' => 'm.room.member', 'state_key' => $this->other['mxid'], 'content' => ['membership' => 'join']],
        ];
        Http::preventStrayRequests();
        Http::fake(function ($request) {
            $path = parse_url($request->url(), PHP_URL_PATH);
            if (str_ends_with($path, '/login')) {
                return Http::response(['user_id' => $request['identifier']['user'], 'device_id' => $request['device_id'], 'access_token' => base64_encode(json_encode([$request['identifier']['user'], $request['device_id']]))]);
            }
            if (str_ends_with($path, '/account/whoami')) {
                [$user, $device] = json_decode(base64_decode(substr($request->header('Authorization')[0], 7)), true);

                return Http::response(['user_id' => $user, 'device_id' => $device]);
            }
            if (str_ends_with($path, '/state')) {
                if ($this->revokeDuringState) {
                    DB::table('identity_devices')->where('id', $this->actor['device'])->update(['revoked_at' => now()]);
                }

                return Http::response($this->state);
            }
            if (str_ends_with($path, '/state/m.room.power_levels')) {
                return Http::response([]);
            }
            if (str_ends_with($path, '/openid/request_token')) {
                return Http::response(['access_token' => 'synthetic-openid', 'matrix_server_name' => config('identity.matrix_server'), 'token_type' => 'Bearer', 'expires_in' => 60]);
            }
            if (str_ends_with($path, '/sfu/get')) {
                $claims = ['iss' => config('rtc.key'), 'sub' => $this->actor['mxid'].':'.$request['device_id'], 'nbf' => time() - 1, 'exp' => time() + 3600, 'video' => ['room' => $this->sfuRoom(), 'roomJoin' => true, 'roomAdmin' => $this->badGrant, 'canPublishData' => true]];

                return Http::response(['url' => 'ws://livekit:7880', 'jwt' => JWT::encode($claims, config('rtc.secret'), 'HS256')]);
            }
            if (str_ends_with($path, '/RemoveParticipant')) {
                $this->removals++;

                return Http::response([], $this->removalFails ? 503 : 200);
            }
            if (str_contains($path, '/devices/')) {
                return Http::response([]);
            }

            return Http::response([], 503);
        });
    }

    private function fixture(): array
    {
        $id = (string) Str::uuid();
        $device = (string) Str::uuid();
        $cookie = bin2hex(random_bytes(32));
        DB::table('identity_accounts')->insert(['id' => $id, 'public_id' => 'pb_'.Str::lower(Str::random(16)), 'key_fingerprint' => hash('sha256', $id), 'public_key' => 'synthetic', 'profile' => Crypt::encryptString(json_encode(['fields' => array_fill_keys(Accounts::FIELDS, ''), 'visibility' => array_fill_keys(Accounts::FIELDS, 'private')])), 'matrix_password' => Crypt::encryptString('synthetic'), 'matrix_state' => 'ready', 'created_at' => now(), 'updated_at' => now()]);
        DB::table('identity_devices')->insert(['id' => $device, 'account_id' => $id, 'public_key' => 'synthetic', 'name' => 'Synthetic', 'created_at' => now(), 'updated_at' => now()]);
        DB::table('identity_sessions')->insert(['token_hash' => hash('sha256', $cookie), 'device_id' => $device, 'expires_at' => null, 'created_at' => now()]);

        return ['id' => $id, 'device' => $device, 'cookie' => $cookie, 'mxid' => app(MatrixBridge::class)->mxid($id)];
    }

    private function sfuRoom(): string
    {
        return rtrim(base64_encode(hash('sha256', json_encode([$this->room, 'm.call#ROOM']), true)), '=');
    }

    private function join(): array
    {
        return $this->postJson('/api/v1/identity/rtc/join', ['roomId' => $this->room])->assertOk()->json();
    }

    public function test_admission_is_scoped_short_and_cannot_be_reused_after_end(): void
    {
        $joined = $this->join();
        $claims = JWT::decode($joined['jwt'], new Key(config('rtc.secret'), 'HS256'));
        $this->assertLessThanOrEqual(60, $claims->exp - time());
        $this->assertSame($this->actor['mxid'].':PB_'.str_replace('-', '', $this->actor['device']), $claims->sub);
        $this->assertSame($this->sfuRoom(), $claims->video->room);
        $this->assertFalse($claims->video->canPublishData);
        $this->assertFalse($claims->video->canUpdateOwnMetadata);
        $this->assertFalse(isset($claims->video->roomAdmin));
        $this->withHeader('X-RTC-Token', $joined['jwt'])->get('/api/v1/rtc-gate')->assertOk();
        $this->postJson('/api/v1/identity/rtc/admissions/'.$joined['id'].'/check')->assertOk();
        $this->deleteJson('/api/v1/identity/rtc/admissions/'.$joined['id'])->assertOk();
        $this->withHeader('X-RTC-Token', $joined['jwt'])->get('/api/v1/rtc-gate')->assertForbidden();
        $this->assertGreaterThan(0, $this->removals);
        $this->assertDatabaseHas('rtc_admissions', ['id' => $joined['id'], 'session_hash' => hash('sha256', $this->actor['cookie'])]);
    }

    public function test_unjoined_plaintext_foreign_and_blocked_rooms_cannot_mint_tokens(): void
    {
        $original = $this->state;
        foreach (['unjoined', 'plaintext', 'foreign', 'blocked'] as $case) {
            $this->state = $original;
            if ($case === 'unjoined') {
                $this->state[4]['content']['membership'] = 'invite';
            }
            if ($case === 'plaintext') {
                $this->state[1]['content']['algorithm'] = 'invalid';
            }
            if ($case === 'foreign') {
                $this->state[5]['state_key'] = '@foreign:other.invalid';
            }
            if ($case === 'blocked') {
                DB::table('identity_blocks')->insert(['account_id' => $this->other['id'], 'blocked_id' => $this->actor['id'], 'created_at' => now()]);
            }
            $this->postJson('/api/v1/identity/rtc/join', ['roomId' => $this->room])->assertForbidden();
        }
        Http::assertNotSent(fn ($r) => str_ends_with($r->url(), '/sfu/get'));
        $this->assertDatabaseCount('rtc_admissions', 0);
    }

    public function test_privileged_upstream_and_forged_gate_tokens_fail_closed(): void
    {
        $this->badGrant = true;
        $this->postJson('/api/v1/identity/rtc/join', ['roomId' => $this->room])->assertServiceUnavailable();
        $this->assertDatabaseCount('rtc_admissions', 0);
        $this->withHeader('X-RTC-Token', JWT::encode(['iss' => config('rtc.key'), 'exp' => time() + 60], str_repeat('wrong-secret', 6), 'HS256'))->get('/api/v1/rtc-gate')->assertForbidden();
    }

    public function test_ticket_is_bound_to_device_and_revocation_blocks_reconnection(): void
    {
        $joined = $this->join();
        $this->withUnencryptedCookie('pb_identity', $this->other['cookie'])->postJson('/api/v1/identity/rtc/admissions/'.$joined['id'].'/check')->assertNotFound();
        DB::table('identity_devices')->where('id', $this->actor['device'])->update(['revoked_at' => now()]);
        $this->withHeader('X-RTC-Token', $joined['jwt'])->get('/api/v1/rtc-gate')->assertForbidden();
        app(Admissions::class)->maintain();
        $this->assertNotNull(DB::table('rtc_admissions')->value('ended_at'));
    }

    public function test_stale_heartbeat_and_membership_loss_remove_participant_and_retry_failed_removal(): void
    {
        $joined = $this->join();
        $this->removalFails = true;
        DB::table('rtc_admissions')->where('id', $joined['id'])->update(['created_at' => now()->subSeconds(46)]);
        app(Admissions::class)->maintain();
        $this->assertNotNull(DB::table('rtc_admissions')->value('ended_at'));
        $this->assertNull(DB::table('rtc_admissions')->value('removed_at'));
        $this->removalFails = false;
        app(Admissions::class)->maintain();
        $this->assertNotNull(DB::table('rtc_admissions')->value('removed_at'));
        $next = $this->join();
        $this->state[4]['content']['membership'] = 'leave';
        $this->postJson('/api/v1/identity/rtc/admissions/'.$next['id'].'/check')->assertForbidden();
    }

    public function test_maintenance_of_old_ticket_does_not_disconnect_a_new_call(): void
    {
        $old = $this->join();
        $this->deleteJson('/api/v1/identity/rtc/admissions/'.$old['id'])->assertOk();
        $next = $this->join();
        $before = $this->removals;
        app(Admissions::class)->maintain();
        $this->assertSame($before, $this->removals);
        $this->postJson('/api/v1/identity/rtc/admissions/'.$next['id'].'/check')->assertOk();
        $this->withHeader('X-RTC-Token', $old['jwt'])->get('/api/v1/rtc-gate')->assertForbidden();
    }

    public function test_logout_kicks_media_and_invalidates_both_initial_and_refreshed_tokens(): void
    {
        $joined = $this->join();
        $claims = (array) JWT::decode($joined['jwt'], new Key(config('rtc.secret'), 'HS256'));
        // LiveKit preserves participant attributes when issuing its longer refresh token.
        $claims['exp'] = time() + 3600;
        $refreshed = JWT::encode($claims, config('rtc.secret'), 'HS256');
        $this->withHeader('X-RTC-Token', $refreshed)->get('/api/v1/rtc-gate')->assertOk();
        $this->deleteJson('/api/v1/identity/session')->assertOk();
        $this->assertGreaterThan(0, $this->removals);
        foreach ([$joined['jwt'], $refreshed] as $token) {
            $this->withHeader('X-RTC-Token', $token)->get('/api/v1/rtc-gate')->assertForbidden();
        }
        $this->assertNotNull(DB::table('rtc_admissions')->value('ended_at'));
    }

    public function test_disabled_rtc_and_production_gate_are_closed(): void
    {
        config(['rtc.enabled' => false]);
        $this->getJson('/api/v1/identity/rtc/config')->assertOk()->assertJsonPath('enabled', false);
        $this->postJson('/api/v1/identity/rtc/join', ['roomId' => $this->room])->assertServiceUnavailable();
        config(['rtc.enabled' => true]);
        $joined = $this->join();
        app()->detectEnvironment(fn () => 'production');
        $this->withHeader('X-RTC-Token', $joined['jwt'])->get('/api/v1/rtc-gate')->assertForbidden();
    }

    public function test_busy_device_removal_is_durable_without_crossing_a_new_join(): void
    {
        $joined = $this->join();
        $lock = Cache::lock('rtc-device:'.$this->actor['device'], 120);
        $this->assertTrue($lock->get());
        $before = $this->removals;
        try {
            $this->deleteJson('/api/v1/identity/rtc/admissions/'.$joined['id'])->assertStatus(202);
            $this->assertSame($before, $this->removals);
            $this->withHeader('X-RTC-Token', $joined['jwt'])->get('/api/v1/rtc-gate')->assertForbidden();
        } finally {
            $lock->release();
        }
        app(Admissions::class)->maintain();
        $this->assertGreaterThan($before, $this->removals);
        $this->assertNotNull(DB::table('rtc_admissions')->value('removed_at'));
    }

    public function test_revoke_committed_during_matrix_authorization_cannot_admit_a_handshake(): void
    {
        $joined = $this->join();
        $this->revokeDuringState = true;
        $this->withHeader('X-RTC-Token', $joined['jwt'])->get('/api/v1/rtc-gate')->assertForbidden();
        $this->assertNotNull(DB::table('identity_devices')->where('id', $this->actor['device'])->value('revoked_at'));
    }
}
