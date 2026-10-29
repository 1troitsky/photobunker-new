<?php

namespace App\Http;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

final class ApiResponse
{
    public static function requestId(Request $request): string
    {
        $requestId = $request->attributes->get('request_id');

        if (! is_string($requestId)) {
            $requestId = (string) Str::uuid();
            $request->attributes->set('request_id', $requestId);
        }

        return $requestId;
    }

    public static function secure(Request $request, Response $response): Response
    {
        $response->headers->set('X-Request-ID', self::requestId($request));
        $response->headers->set('X-Content-Type-Options', 'nosniff');
        $response->headers->set('Referrer-Policy', 'no-referrer');
        $response->headers->set('Cache-Control', 'no-store, private');
        $response->headers->set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");

        return $response;
    }

    public static function error(Request $request, int $status): JsonResponse
    {
        $code = match ($status) {
            400 => 'request.invalid',
            401 => 'auth.required',
            403 => 'access.denied',
            404 => 'resource.not_found',
            405 => 'request.method_not_allowed',
            409 => 'resource.conflict',
            410 => 'resource.expired',
            413 => 'request.too_large',
            422 => 'request.validation_failed',
            429 => 'request.rate_limited',
            503 => 'service.unavailable',
            default => $status >= 500 ? 'server.error' : 'request.failed',
        };

        $response = response()->json([
            'error' => [
                'code' => $code,
                'message_key' => $code,
                'request_id' => self::requestId($request),
                'retryable' => $status >= 500 || $status === 429,
            ],
        ], $status);

        if ($status === 503 || $status === 429) {
            $response->headers->set('Retry-After', '5');
        }

        self::secure($request, $response);

        return $response;
    }
}
