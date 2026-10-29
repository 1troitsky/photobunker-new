<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Symfony\Component\HttpFoundation\Response;

final class EmergencyIntentBoundary
{
    public function handle(Request $request, Closure $next): Response
    {
        // Intentionally cookie-independent; never relax IdentityBoundary or
        // accept cross-origin browser requests to a destructive endpoint.
        abort_unless(config('identity.enabled'), 404);
        abort_unless($request->isMethod('POST'), 405);
        abort_unless($request->header('X-PhotoBunker') === 'identity-v1', 403);
        abort_unless(in_array($request->header('Origin'), config('identity.origins'), true), 403);
        abort_unless(str_starts_with((string) $request->header('Content-Type'), 'application/json'), 415);
        abort_if(strlen($request->getContent()) > 2048, 413);
        $bucket = 'identity:emergency:intent:'.hash('sha256', (string) $request->ip());
        abort_if(RateLimiter::tooManyAttempts($bucket, 20), 429);
        RateLimiter::hit($bucket, 60);

        $response = $next($request);
        $response->headers->set('Cache-Control', 'no-store, private');

        return $response;
    }
}
