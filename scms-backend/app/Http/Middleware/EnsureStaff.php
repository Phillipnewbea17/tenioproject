<?php

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Admin API: only staff accounts. Sanctum accepts tokens from any account
 * type, so without this a senior-app token could open the admin routes.
 */
class EnsureStaff
{
    public function handle(Request $request, Closure $next): Response
    {
        abort_unless($request->user() instanceof User, 403, 'This is for SCMS staff only.');

        return $next($request);
    }
}
