<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Senior-app routes that act on a senior citizen record (medical, burial,
 * help desk, Senior ID, pension): the account must be linked to its record.
 */
class EnsureLinkedSenior
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! $request->user()?->isLinked()) {
            return response()->json([
                'message' => 'Your account is not linked to your senior citizen record yet. '
                    . 'Please finish verifying your account, or contact the OSCA office.',
                'code' => 'not_linked',
            ], 403);
        }

        return $next($request);
    }
}
