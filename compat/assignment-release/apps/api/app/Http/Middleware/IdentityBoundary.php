<?php

namespace App\Http\Middleware;

use App\Identity\AccountLifecycle;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Symfony\Component\HttpFoundation\Response;

final class IdentityBoundary
{
    public function handle(Request $request, Closure $next): Response
    {
        abort_unless(config('identity.enabled'), 404);
        abort_unless($request->header('X-PhotoBunker') === 'identity-v1', 403);
        if (! $request->isMethod('GET') || $request->hasHeader('Origin')) {
            abort_unless(in_array($request->header('Origin'), config('identity.origins'), true), 403);
        }
        $token = $request->cookie('pb_identity', '');
        // A foreground return after the deadline must not revive an expired
        // account while waiting for the minute-based deletion worker.
        if (preg_match('/^[a-f0-9]{64}$/D', $token)) {
            $owner = DB::table('identity_sessions')->join('identity_devices', 'identity_devices.id', '=', 'identity_sessions.device_id')->join('identity_accounts', 'identity_accounts.id', '=', 'identity_devices.account_id')->where('token_hash', hash('sha256', $token))->select('identity_accounts.*')->first();
            if ($owner && AccountLifecycle::unavailable($owner)) {
                return response()->json(['code' => 'account_expired'], 410);
            }
        }
        $session = preg_match('/^[a-f0-9]{64}$/D', $token) ? DB::table('identity_sessions')->join('identity_devices', 'identity_devices.id', '=', 'identity_sessions.device_id')->where('token_hash', hash('sha256', $token))->where(fn ($q) => $q->whereNull('expires_at')->orWhere('expires_at', '>', now()))->whereNull('revoked_at')->select('identity_devices.account_id', 'identity_devices.id as device_id', 'identity_sessions.expires_at')->first() : null;
        // Authenticated workspace polling must not share one gateway IP bucket.
        $bucket = $session ? 'identity:device:'.hash('sha256', $session->account_id.':'.$session->device_id).($request->isMethod('GET') ? ':read' : ':write') : 'identity:'.hash('sha256', (string) $request->ip());
        $limit = $session ? config($request->isMethod('GET') ? 'identity.read_requests_per_minute' : 'identity.write_requests_per_minute') : 180;
        abort_if(RateLimiter::tooManyAttempts($bucket, $limit), 429);
        RateLimiter::hit($bucket, 60);
        if ($request->hasHeader('X-PhotoBunker-Account')) {
            abort_unless($session, 401);
            abort_unless(hash_equals($session->account_id, (string) $request->header('X-PhotoBunker-Account')), 409);
        }
        $request->attributes->set('identity', $session);
        $invoke = function () use ($request, $next, $session) {
            if ($session) {
                $account = DB::table('identity_accounts')->find($session->account_id);
                abort_unless($account && ! AccountLifecycle::unavailable($account), 410);
            }

            return $next($request);
        };
        // Recheck a write after waiting for an in-flight deletion claim.
        $response = $session && ! $request->isMethod('GET') && ! $request->is('api/v1/identity/account')
            ? Cache::lock('identity:account-write:'.$session->account_id, 120)->block(10, $invoke)
            : $invoke();
        $response->headers->set('Cache-Control', 'no-store, private');

        if ($session && ! $request->is('api/v1/identity/session', 'api/v1/identity/sessions')) {
            $response->headers->setCookie(cookie('pb_identity', $token, 60 * 24 * 400, '/api/v1/identity', null, str_starts_with((string) $request->header('Origin'), 'https://') || $request->isSecure(), true, false, 'Strict'));
        }

        return $response;
    }
}
