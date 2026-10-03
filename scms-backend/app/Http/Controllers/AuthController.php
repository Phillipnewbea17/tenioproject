<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\Request;
use App\Support\ActivityLogger;
use Illuminate\Support\Facades\Hash;

class AuthController extends Controller
{
    public function login(Request $request)
    {
        $validated = $request->validate([
            'username' => 'required|string',
            'password' => 'required|string',
        ]);

        $user = User::where('name', $validated['username'])->first();

        if (!$user || !Hash::check($validated['password'], $user->password)) {
            ActivityLogger::record('Authentication', 'Login failed', 'Wrong username or password.', userName: $validated['username']);

            return response()->json([
                'message' => 'Invalid username or password.'
            ], 401);
        }

        // Deactivated users must not be able to log in. This is checked after
        // the password so that someone guessing passwords cannot learn which
        // accounts are deactivated.
        if (($user->status ?? 'Active') === 'Inactive') {
            ActivityLogger::record('Authentication', 'Login blocked', 'A deactivated account tried to log in.', $user, $user->name, user: $user);

            return response()->json([
                'message' => 'This account has been deactivated. Please contact an administrator.'
            ], 403);
        }

        // Remember when this user last logged in (shown in User Management).
        $user->forceFill(['last_login_at' => now()])->save();

        ActivityLogger::record('Authentication', 'Logged in', null, $user, $user->name, user: $user);

        $token = $user->createToken('scms-admin-token')->plainTextToken;

        return response()->json([
            'message' => 'Login successful.',
            'token' => $token,
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'username' => $user->username,
                'email' => $user->email,
                'role' => $user->role,
            ],
        ]);
    }

    public function logout(Request $request)
    {
        ActivityLogger::record('Authentication', 'Logged out', null, $request->user(), $request->user()->name);

        $request->user()->currentAccessToken()?->delete();

        return response()->json([
            'message' => 'Logged out successfully.'
        ]);
    }
}