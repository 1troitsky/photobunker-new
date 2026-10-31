<?php

use App\Http\ApiResponse;
use App\Http\Middleware\RequestContext;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->prepend(RequestContext::class);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(fn (Request $request): bool => true);

        $exceptions->render(function (Throwable $exception, Request $request) {
            $status = match (true) {
                $exception instanceof ValidationException => 422,
                $exception instanceof AuthenticationException => 401,
                $exception instanceof AuthorizationException => 403,
                $exception instanceof HttpExceptionInterface => $exception->getStatusCode(),
                default => 500,
            };

            return ApiResponse::error($request, $status);
        });

        $exceptions->report(function (Throwable $exception): bool {
            // Default exception logs include SQL, bindings, URLs, and traces.
            Log::error('api.exception', [
                'exception_type' => $exception::class,
                'request_id' => app()->bound('request')
                    ? request()->attributes->get('request_id')
                    : null,
            ]);

            return false;
        });
    })->create();
