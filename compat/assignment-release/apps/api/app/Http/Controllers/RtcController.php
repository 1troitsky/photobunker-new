<?php

namespace App\Http\Controllers;

use App\Identity\Accounts;
use App\Identity\MatrixBridge;
use App\Rtc\Admissions;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

final class RtcController
{
    public function __construct(private readonly Admissions $rtc, private readonly Accounts $accounts, private readonly MatrixBridge $matrix) {}

    public function gate(Request $r)
    {
        abort_unless(app()->environment('local', 'testing') && config('identity.enabled') && config('rtc.enabled'), 403);
        abort_if(strlen((string) $r->header('X-RTC-Token')) > 8192, 403);
        try {
            $claims = JWT::decode((string) $r->header('X-RTC-Token'), new Key(config('rtc.secret'), 'HS256'));
        } catch (\Throwable) {
            abort(403);
        }
        abort_unless(($claims->iss ?? '') === config('rtc.key') && ! empty($claims->video->roomJoin) && empty($claims->video->roomAdmin) && empty($claims->video->roomCreate), 403);
        $ticket = DB::table('rtc_admissions')->where('id', $claims->attributes->pb_admission ?? '')->where('participant', $claims->sub ?? '')->where('sfu_room', $claims->video->room ?? '')->whereNull('ended_at')->first();
        abort_unless($ticket && $this->rtc->valid($ticket), 403);

        return response('', 200, ['Cache-Control' => 'no-store']);
    }

    public function config(Request $r)
    {
        $this->accounts->current($r);

        return response()->json(['enabled' => (bool) config('rtc.enabled'), 'focusPath' => '/api/v1/identity/rtc', 'sfuPath' => '/rtc/sfu', 'membershipExpiryMs' => 30000, 'delayedEvents' => false]);
    }

    public function join(Request $r)
    {
        abort_unless(config('rtc.enabled'), 503);
        $actor = $this->accounts->current($r)->id;
        $identity = $r->attributes->get('identity');
        $input = $r->validate(['roomId' => ['required', 'string', 'max:255', 'regex:/^![^\s]+$/D']]);
        $result = Cache::lock('rtc-device:'.$identity->device_id, 120)->block(10, function () use ($r, $actor, $identity, $input) {
            $this->rtc->room($actor, $input['roomId'], true);
            $session = $this->matrix->session($actor, $identity->device_id);
            $token = $this->rtc->upstream($session, $input['roomId']);
            // Recheck after every external call; a concurrent logout or kick must not mint admission.
            abort_unless(DB::table('identity_sessions')->where('token_hash', hash('sha256', $r->cookie('pb_identity', '')))->exists() && ! DB::table('identity_devices')->where('id', $identity->device_id)->whereNotNull('revoked_at')->exists(), 401);
            $this->rtc->room($actor, $input['roomId']);
            $this->rtc->revokeDevice($identity->device_id, true);
            $id = $token['id'];
            DB::table('rtc_admissions')->insert(['id' => $id, 'account_id' => $actor, 'device_id' => $identity->device_id, 'session_hash' => hash('sha256', $r->cookie('pb_identity', '')), 'room_id' => $input['roomId'], 'sfu_room' => $token['room'], 'participant' => $token['participant'], 'created_at' => now(), 'expires_at' => now()->addHours(2)]);

            return ['id' => $id, 'jwt' => $token['jwt'], 'participant' => $token['participant'], 'expiresIn' => 60, 'sfuPath' => '/rtc/sfu', 'focusPath' => '/api/v1/identity/rtc'];
        });

        return response()->json($result);
    }

    private function ticket(Request $r, string $id): object
    {
        $actor = $this->accounts->current($r)->id;
        $identity = $r->attributes->get('identity');

        return DB::table('rtc_admissions')->where('id', $id)->where('account_id', $actor)->where('device_id', $identity->device_id)->where('session_hash', hash('sha256', $r->cookie('pb_identity', '')))->first() ?? abort(404);
    }

    public function check(Request $r, string $id)
    {
        $t = $this->ticket($r, $id);
        if (! $this->rtc->valid($t)) {
            $this->rtc->remove($t);
            abort(403);
        }DB::table('rtc_admissions')->where('id', $id)->update(['checked_at' => now()]);

        return response()->json(['active' => true]);
    }

    public function leave(Request $r, string $id)
    {
        $ok = $this->rtc->remove($this->ticket($r, $id));

        return response()->json(['ended' => true, 'removal' => $ok ? 'confirmed' : 'pending'], $ok ? 200 : 202);
    }
}
