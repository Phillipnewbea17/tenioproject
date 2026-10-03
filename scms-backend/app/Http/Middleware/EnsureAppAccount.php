<?php

namespace App\Http\Middleware;

use App\Models\AppAccount;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** Senior-app API: only app accounts (not staff tokens). */
class EnsureAppAccount
{
    public function handle(Request $request, Closure $next): Response
    {
        abort_unless($request->user() instanceof AppAccount, 403, 'Please sign in with the SCMS app.');

        return $next($request);
    }
}
