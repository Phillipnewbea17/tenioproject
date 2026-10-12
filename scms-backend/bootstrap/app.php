<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->alias([
            'staff' => \App\Http\Middleware\EnsureStaff::class,
            'app.account' => \App\Http\Middleware\EnsureAppAccount::class,
            'app.linked' => \App\Http\Middleware\EnsureLinkedSenior::class,
        ]);

        // Nothing to redirect a guest to: sign-in is a page of the React
        // admin, not a Laravel route, and every guarded route is under
        // /api. Laravel's default is route('login'), which does not exist
        // here, so an expired or missing token raised "Route [login] not
        // defined" (HTTP 500) instead of 401 whenever the caller did not
        // send "Accept: application/json". Returning no redirect lets the
        // handler answer 401 (as JSON for /api/*, see withExceptions).
        $middleware->redirectGuestsTo(null);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
    })->create();
