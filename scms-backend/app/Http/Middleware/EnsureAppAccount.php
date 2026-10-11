<?php

namespace App\Http\Middleware;

use App\Models\AppAccount;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Senior-app API: only app accounts (not staff tokens), and only accounts
 * that finished Create Account with an MPIN. Tokens from the old code-only
 * sign-in are refused (401), so those users log in again.
 */
class EnsureAppAccount
{
    public function handle(Request $request, Closure $next): Response
    {
        $account = $request->user();

        abort_unless($account instanceof AppAccount, 403, 'Please sign in with the SCMS app.');

        if (! $account->isRegistered()) {
            $account->currentAccessToken()?->delete();
            abort(401, 'Please log in again.');
        }

        return $next($request);
    }
}
