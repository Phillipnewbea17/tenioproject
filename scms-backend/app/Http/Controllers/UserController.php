<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Support\ActivityLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rule;

class UserController extends Controller
{
    private const ROLES = ['Administrator', 'User'];
    private const STATUSES = ['Active', 'Inactive'];

    /** GET /api/users */
    public function index(Request $request): JsonResponse
    {
        $this->requireAdministrator($request);

        $users = User::orderBy('name')
            ->get()
            ->map(fn (User $user) => $this->transform($user));

        return response()->json($users);
    }

    /** POST /api/users */
    public function store(Request $request): JsonResponse
    {
        $this->requireAdministrator($request);

        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'username' => ['required', 'string', 'max:255', 'unique:users,username'],
            'email' => ['required', 'email', 'max:255', 'unique:users,email'],
            'role' => ['required', Rule::in(self::ROLES)],
            'password' => ['required', 'string', 'min:8'],
        ]);

        $user = new User();
        $user->forceFill([
            'name' => $data['name'],
            'username' => $data['username'],
            'email' => $data['email'],
            'role' => $data['role'],
            'status' => 'Active',
            'password' => Hash::make($data['password']),
        ])->save();

        ActivityLogger::record('User Management', 'Created', "User account created with role {$user->role}.", $user, $this->label($user));

        return response()->json($this->transform($user), 201);
    }

    /** PUT/PATCH /api/users/{user} */
    public function update(Request $request, User $user): JsonResponse
    {
        $this->requireAdministrator($request);

        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'username' => [
                'sometimes', 'required', 'string', 'max:255',
                Rule::unique('users', 'username')->ignore($user->id),
            ],
            'email' => [
                'sometimes', 'required', 'email', 'max:255',
                Rule::unique('users', 'email')->ignore($user->id),
            ],
            'role' => ['sometimes', 'required', Rule::in(self::ROLES)],
            'status' => ['sometimes', 'required', Rule::in(self::STATUSES)],
        ]);

        // Never leave the system without an active administrator.
        $newRole = $data['role'] ?? $user->role;
        $newStatus = $data['status'] ?? $user->status;
        $losesAdminAccess = $user->role === 'Administrator'
            && $user->status === 'Active'
            && ($newRole !== 'Administrator' || $newStatus !== 'Active');

        if ($losesAdminAccess && ! $this->anotherActiveAdminExists($user)) {
            return response()->json([
                'message' => 'This is the only active administrator. Make another user an administrator first.',
            ], 422);
        }

        $user->forceFill($data)->save();

        $changes = ActivityLogger::changes($user);

        if ($changes) {
            $action = match (true) {
                isset($changes['status']) && $user->status === 'Inactive' => 'Deactivated',
                isset($changes['status']) => 'Reactivated',
                isset($changes['role']) => 'Role changed',
                default => 'Updated',
            };

            ActivityLogger::record('User Management', $action, 'Updated ' . ActivityLogger::fieldList($changes) . '.', $user, $this->label($user), $changes);
        }

        // A deactivated user should be logged out everywhere.
        if (($data['status'] ?? null) === 'Inactive' && method_exists($user, 'tokens')) {
            $user->tokens()->delete();
        }

        return response()->json($this->transform($user->fresh()));
    }

    /** POST /api/users/{user}/reset-password */
    public function resetPassword(Request $request, User $user): JsonResponse
    {
        $this->requireAdministrator($request);

        $data = $request->validate([
            'password' => ['required', 'string', 'min:8'],
        ]);

        $user->forceFill(['password' => Hash::make($data['password'])])->save();

        ActivityLogger::record('User Management', 'Password reset', 'Password reset by an administrator; the user was logged out everywhere.', $user, $this->label($user));

        if (method_exists($user, 'tokens')) {
            $user->tokens()->delete();
        }

        return response()->json(['message' => 'Password reset.']);
    }

    private function label(User $user): string
    {
        return $user->username ? "{$user->name} (@{$user->username})" : $user->name;
    }

    private function requireAdministrator(Request $request): void
    {
        abort_if(
            optional($request->user())->role !== 'Administrator',
            403,
            'Only administrators can manage users.'
        );
    }

    private function anotherActiveAdminExists(User $except): bool
    {
        return User::where('role', 'Administrator')
            ->where('status', 'Active')
            ->where('id', '!=', $except->id)
            ->exists();
    }

    /** Shape the frontend expects (see normalizeUser in UserManagement.jsx). */
    private function transform(User $user): array
    {
        return [
            'id' => $user->id,
            'name' => $user->name,
            'username' => $user->username ?? $user->name,
            'email' => $user->email,
            'role' => $user->role ?? 'User',
            'status' => $user->status ?? 'Active',
            'last_login_at' => $user->last_login_at
                ? Carbon::parse($user->last_login_at)->toIso8601String()
                : null,
        ];
    }
}