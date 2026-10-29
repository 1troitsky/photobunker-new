<?php

namespace App\Http\Middleware;

use App\Http\ApiResponse;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class RequestContext
{
    public function handle(Request $request, Closure $next): Response
    {
        // Generate our own identifier; incoming IDs are untrusted log data.
        ApiResponse::requestId($request);

        return ApiResponse::secure($request, $next($request));
    }
}
