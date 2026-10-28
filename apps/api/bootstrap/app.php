<?php
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(web: __DIR__.'/../routes/web.php', commands: __DIR__.'/../routes/console.php')
    ->withCommands([\App\Console\Commands\PhotoMaintain::class,\App\Console\Commands\StorageCheck::class])
    ->withMiddleware(function (Middleware $middleware): void {
        // Do not trust arbitrary X-Forwarded-* headers; Codex configures the actual proxy.
    })
    ->withExceptions(function (Exceptions $exceptions): void {})
    ->create();
