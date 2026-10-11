<?php

namespace App\Http\Controllers;

use App\Models\AppAccount;
use App\Models\SeniorCitizen;
use App\Support\ActivityLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * User Management > App Users: the seniors who signed up in the mobile app.
 * App accounts are kept apart from staff Users, so a senior can never sign in
 * to the admin web app. Admins can activate/deactivate them, but not edit
 * their role or password.
 */
class AppAccountController extends Controller
{
    public function index(): JsonResponse
    {
        $accounts = AppAccount::with([
            'seniorCitizen:id,senior_id,name,status',
            'identityVerifications' => fn ($q) => $q->latest('id')->limit(1),
        ])
            ->whereNotNull('mpin_hash')
            ->latest('id')
            ->limit(1000)
            ->get()
            ->map(fn (AppAccount $a) => [
                'id' => $a->id,
                'name' => $a->full_name,
                'phone' => $a->displayPhone(),
                'linked' => $a->isLinked(),
                'linked_at' => $a->linked_at?->toIso8601String(),
                'senior' => $a->seniorCitizen ? [
                    'id' => $a->seniorCitizen->id,
                    'senior_id' => $a->seniorCitizen->senior_id,
                    'name' => $a->seniorCitizen->name,
                    'status' => $a->seniorCitizen->status,
                ] : null,
                // Latest "link my record" try: Pending, Approved, Rejected, Failed.
                'verification' => $a->identityVerifications->first()?->status,
                'created_at' => $a->created_at?->toIso8601String(),
                'last_login_at' => $a->last_login_at?->toIso8601String(),
            ]);

        return response()->json($accounts);
    }

    /**
     * POST /api/app-accounts/{appAccount}/status
     *
     * Activate or deactivate an app user. A deactivated account can't log in
     * to the senior app and is signed out everywhere. Admins only.
     */
    public function setStatus(Request $request, AppAccount $appAccount): JsonResponse
    {
        abort_if(
            optional($request->user())->role !== 'Administrator',
            403,
            'Only administrators can manage users.'
        );

        $data = $request->validate([
            'status' => ['required', Rule::in(['Active', 'Inactive'])],
        ]);

        $appAccount->status = $data['status'];
        $appAccount->save();

        $label = ($appAccount->full_name ?: $appAccount->displayPhone()) . ' (app)';

        if ($data['status'] === 'Inactive') {
            // Log the account out everywhere.
            $appAccount->tokens()->delete();
            ActivityLogger::record('User Management', 'Deactivated', 'App user deactivated.', $appAccount, $label);
        } else {
            ActivityLogger::record('User Management', 'Reactivated', 'App user reactivated.', $appAccount, $label);
        }

        return response()->json($this->transform($appAccount->fresh()->load('seniorCitizen:id,senior_id,name')));
    }

    /** The senior's app-profile photo (private file, staff only). */
    public function photo(AppAccount $appAccount): StreamedResponse
    {
        return $this->streamPhoto($appAccount);
    }

    /**
     * The same photo, found through the senior citizen record instead of the
     * app account, so any page that knows the record can show it.
     */
    public function seniorPhoto(SeniorCitizen $seniorCitizen): StreamedResponse
    {
        return $this->streamPhoto($seniorCitizen->appAccount);
    }

    private function streamPhoto(?AppAccount $account): StreamedResponse
    {
        abort_unless(
            $account?->photo_path && Storage::disk('local')->exists($account->photo_path),
            404,
            'No photo.'
        );

        return Storage::disk('local')->response($account->photo_path);
    }

    /** The merged User Management row shape for an app user. */
    private function transform(AppAccount $account): array
    {
        return [
            'id' => $account->id,
            'uid' => 'app_user-' . $account->id,
            'type' => 'app_user',
            'name' => $account->full_name ?: $account->displayPhone(),
            'username' => null,
            'email' => null,
            'phone' => $account->displayPhone(),
            'role' => $account->role ?: 'senior',
            'status' => $account->status ?? 'Active',
            'has_photo' => (bool) $account->photo_path,
            'linked' => $account->isLinked(),
            'senior' => $account->seniorCitizen ? [
                'senior_id' => $account->seniorCitizen->senior_id,
                'name' => $account->seniorCitizen->name,
            ] : null,
            'last_login_at' => $account->last_login_at
                ? Carbon::parse($account->last_login_at)->toIso8601String()
                : null,
        ];
    }
}
