<?php

namespace App\Http\Controllers;

use App\Models\AppAccount;
use App\Models\LoginLog;
use App\Models\User;
use App\Support\ActivityLogger;
use App\Support\UserRow;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rule;

class UserController extends Controller
{
    private const ROLES = ['Administrator', 'User'];
    private const STATUSES = ['Active', 'Inactive'];

    /**
     * GET /api/users
     *
     * One merged list of everyone who can log in: staff (admin web) and app
     * users (senior app), each with a "type" field. Supports search, type,
     * status, role and page query params, and returns global summary counts
     * for the cards. Without a page param the full (filtered) list is
     * returned so the page can sort and paginate on the client.
     */
    public function index(Request $request): JsonResponse
    {
        $this->requireAdministrator($request);

        $staff = User::orderBy('name')->get()
            ->map(fn (User $user) => UserRow::staff($user));

        $appUsers = AppAccount::withRowRelations()
            ->whereNotNull('mpin_hash')
            ->orderBy('full_name')
            ->get()
            ->map(fn (AppAccount $account) => UserRow::appUser($account));

        $all = $staff->concat($appUsers)->values();

        // Cards show global counts, independent of the active filters.
        $counts = [
            'total' => $all->count(),
            'active' => $all->where('status', 'Active')->count(),
            'inactive' => $all->where('status', 'Inactive')->count(),
            'staff' => $staff->count(),
            'app_users' => $appUsers->count(),
        ];

        $filtered = $this->applyFilters($all, $request)
            ->sortBy('name', SORT_NATURAL | SORT_FLAG_CASE)
            ->values();

        $total = $filtered->count();
        $perPage = max(1, (int) $request->query('per_page', 20));

        // No page param: hand back the whole list (the page filters/sorts it).
        if ($request->query('page') === null) {
            return response()->json([
                'data' => $filtered,
                'meta' => ['current_page' => 1, 'last_page' => 1, 'per_page' => $total, 'total' => $total],
                'counts' => $counts,
            ]);
        }

        $lastPage = max(1, (int) ceil($total / $perPage));
        $page = min(max(1, (int) $request->query('page', 1)), $lastPage);

        return response()->json([
            'data' => $filtered->forPage($page, $perPage)->values(),
            'meta' => ['current_page' => $page, 'last_page' => $lastPage, 'per_page' => $perPage, 'total' => $total],
            'counts' => $counts,
        ]);
    }

    /**
     * GET /api/users/recent-logins
     *
     * The latest successful logins (staff and app users) for the Recent
     * logins panel.
     */
    public function recentLogins(Request $request): JsonResponse
    {
        $this->requireAdministrator($request);

        $logs = LoginLog::orderByDesc('logged_in_at')->limit(50)->get();

        $staffNames = User::whereIn('id', $logs->where('type', LoginLog::TYPE_STAFF)->pluck('user_id'))
            ->pluck('name', 'id');
        $appAccounts = AppAccount::whereIn('id', $logs->where('type', LoginLog::TYPE_APP_USER)->pluck('user_id'))
            ->get()->keyBy('id');

        $rows = $logs->map(function (LoginLog $log) use ($staffNames, $appAccounts) {
            if ($log->type === LoginLog::TYPE_STAFF) {
                $name = $staffNames[$log->user_id] ?? 'Unknown staff';
                $detail = null;
            } else {
                $account = $appAccounts[$log->user_id] ?? null;
                $name = $account ? ($account->full_name ?: $account->displayPhone()) : 'Unknown app user';
                $detail = $account?->displayPhone();
            }

            return [
                'id' => $log->id,
                'type' => $log->type,
                'name' => $name,
                'detail' => $detail,
                'ip' => $log->ip,
                'device' => $log->device,
                'logged_in_at' => $log->logged_in_at?->toIso8601String(),
            ];
        });

        return response()->json($rows);
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

        return response()->json(UserRow::staff($user), 201);
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

        return response()->json(UserRow::staff($user->fresh()));
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

    /** Keep only the rows matching the search / type / status / role params. */
    private function applyFilters(\Illuminate\Support\Collection $rows, Request $request): \Illuminate\Support\Collection
    {
        $search = trim((string) $request->query('search', ''));
        $type = (string) $request->query('type', 'all');
        $status = (string) $request->query('status', 'all');
        $role = (string) $request->query('role', 'all');

        $needle = mb_strtolower($search);
        $searchDigits = preg_replace('/\D/', '', $search);

        return $rows->filter(function (array $row) use ($type, $status, $role, $needle, $searchDigits) {
            if ($type !== 'all' && $row['type'] !== $type) {
                return false;
            }
            if ($status !== 'all' && $row['status'] !== $status) {
                return false;
            }
            if ($role !== 'all' && $row['role'] !== $role) {
                return false;
            }
            if ($needle === '') {
                return true;
            }

            $haystack = mb_strtolower(implode(' ', array_filter([
                $row['name'], $row['username'], $row['email'], $row['phone'],
            ])));
            $phoneDigits = preg_replace('/\D/', '', (string) ($row['phone'] ?? ''));

            return str_contains($haystack, $needle)
                || ($searchDigits !== '' && $phoneDigits !== '' && str_contains($phoneDigits, $searchDigits));
        })->values();
    }

}