<?php

namespace App\Http\Controllers;

use App\Models\AppAccount;
use App\Models\PhoneVerification;
use App\Models\SeniorCitizen;
use App\Support\ActivityLogger;
use App\Support\UserRow;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * User Management > App Users: the seniors who signed up in the mobile app.
 * App accounts are kept apart from staff Users, so a senior can never sign in
 * to the admin web app. Admins can activate/deactivate them, link them to a
 * senior citizen record, and help a senior who lost their phone back in
 * (reset access, change the mobile number) — but never edit their MPIN.
 */
class AppAccountController extends Controller
{
    /** Record states that cannot be linked to an app account. */
    private const INELIGIBLE = ['Archived', 'Inactive', 'Deceased'];

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
     * to the senior app and is signed out everywhere. The optional reason is
     * kept with the account and shown in User Management. Admins only.
     */
    public function setStatus(Request $request, AppAccount $appAccount): JsonResponse
    {
        $this->requireAdministrator($request);

        $data = $request->validate([
            'status' => ['required', Rule::in(['Active', 'Inactive'])],
            'reason' => ['nullable', 'string', 'max:500'],
        ]);

        $reason = $this->tidy($data['reason'] ?? null);
        $appAccount->status = $data['status'];

        if ($data['status'] === 'Inactive') {
            $appAccount->deactivated_at = now();
            $appAccount->deactivated_by = $request->user()->id;
            $appAccount->deactivation_reason = $reason;
        } else {
            $appAccount->deactivated_at = null;
            $appAccount->deactivated_by = null;
            $appAccount->deactivation_reason = null;
        }

        $appAccount->save();

        if ($data['status'] === 'Inactive') {
            // Log the account out everywhere.
            $appAccount->tokens()->delete();
            ActivityLogger::record('User Management', 'Deactivated',
                'App user deactivated.' . ($reason ? " Reason: {$reason}" : ''),
                $appAccount, $this->label($appAccount));
        } else {
            ActivityLogger::record('User Management', 'Reactivated', 'App user reactivated.',
                $appAccount, $this->label($appAccount));
        }

        return response()->json($this->row($appAccount));
    }

    /**
     * POST /api/app-accounts/{appAccount}/reset-access
     *
     * For a senior who lost their phone: signs the account out everywhere and
     * forgets every trusted phone, so the next login needs a fresh code sent
     * by text. The MPIN is left alone (the senior resets it themselves with
     * Forgot MPIN) and is never shown to staff.
     */
    public function resetAccess(Request $request, AppAccount $appAccount): JsonResponse
    {
        $this->requireAdministrator($request);

        $reason = $this->tidy($request->validate([
            'reason' => ['nullable', 'string', 'max:500'],
        ])['reason'] ?? null);

        $appAccount->tokens()->delete();
        $appAccount->devices()->delete();
        $appAccount->mpin_attempts = 0;
        $appAccount->mpin_locked_until = null;
        $appAccount->save();

        // Any code already texted to this number stops working.
        PhoneVerification::where('phone', $appAccount->phone)
            ->whereNull('consumed_at')
            ->update(['consumed_at' => now()]);

        ActivityLogger::record('User Management', 'Access reset',
            'Signed out everywhere and forgot every trusted phone.' . ($reason ? " Reason: {$reason}" : ''),
            $appAccount, $this->label($appAccount));

        return response()->json($this->row($appAccount));
    }

    /**
     * POST /api/app-accounts/{appAccount}/phone
     *
     * Moves the account to a new mobile number (a senior who lost their phone
     * and their SIM). The account is signed out everywhere and every trusted
     * phone is forgotten, so the new number must prove itself with a code.
     */
    public function changePhone(Request $request, AppAccount $appAccount): JsonResponse
    {
        $this->requireAdministrator($request);

        $request->merge(['phone' => $this->normalizePhone($request->input('phone'))]);

        $data = $request->validate([
            'phone' => [
                'required', 'regex:/^9\d{9}$/',
                Rule::unique('app_accounts', 'phone')->ignore($appAccount->id),
            ],
            'reason' => ['nullable', 'string', 'max:500'],
        ], [
            'phone.regex' => 'Enter a 10-digit mobile number that starts with 9, for example 9171234567.',
            'phone.unique' => 'Another app user already uses this mobile number.',
        ]);

        if ($data['phone'] === $appAccount->phone) {
            return response()->json([
                'message' => 'This is already the mobile number on the account.',
                'errors' => ['phone' => ['This is already the mobile number on the account.']],
            ], 422);
        }

        $reason = $this->tidy($data['reason'] ?? null);
        $previous = $appAccount->displayPhone();
        $oldPhone = $appAccount->phone;

        $appAccount->phone = $data['phone'];
        $appAccount->mpin_attempts = 0;
        $appAccount->mpin_locked_until = null;
        $appAccount->save();

        // The old phone keeps neither a session nor its trusted-device key.
        $appAccount->tokens()->delete();
        $appAccount->devices()->delete();
        PhoneVerification::whereIn('phone', [$oldPhone, $appAccount->phone])
            ->whereNull('consumed_at')
            ->update(['consumed_at' => now()]);

        ActivityLogger::record('User Management', 'Phone changed',
            "Mobile number changed from {$previous} to {$appAccount->displayPhone()}."
                . ($reason ? " Reason: {$reason}" : ''),
            $appAccount, $this->label($appAccount),
            ['phone' => ['from' => $previous, 'to' => $appAccount->displayPhone()]]);

        return response()->json($this->row($appAccount));
    }

    /**
     * GET /api/app-accounts/{appAccount}/senior-matches?search=
     *
     * Senior citizen records this account could be linked to. Without a
     * search it suggests records that look like the app user (same surname or
     * same birthday). Records already linked to another account, and records
     * that are archived, inactive or deceased, are never offered.
     */
    public function seniorMatches(Request $request, AppAccount $appAccount): JsonResponse
    {
        $this->requireAdministrator($request);

        $data = $request->validate([
            'search' => ['nullable', 'string', 'max:100'],
            'birth_date' => ['nullable', 'date'],
        ]);

        $search = $this->tidy($data['search'] ?? null);
        $birthDate = $data['birth_date'] ?? null;

        $query = SeniorCitizen::query()
            ->whereNotIn('status', self::INELIGIBLE)
            // One record belongs to one account only.
            ->whereNotIn('id', AppAccount::whereNotNull('senior_citizen_id')
                ->where('id', '!=', $appAccount->id)
                ->pluck('senior_citizen_id'));

        if ($search !== null || $birthDate !== null) {
            $query->where(function ($where) use ($search, $birthDate) {
                if ($search !== null) {
                    $like = '%' . str_replace(['%', '_'], ['\%', '\_'], $search) . '%';
                    $where->where('name', 'like', $like)->orWhere('senior_id', 'like', $like);
                }
                if ($birthDate !== null) {
                    $where->orWhereDate('birth_date', $birthDate);
                }
            });
        } else {
            // No search yet: suggest the records that look like this person.
            $surname = $this->surname($appAccount);
            $own = $appAccount->birth_date?->toDateString();

            if ($surname === null && $own === null) {
                return response()->json(['matches' => [], 'suggested' => true]);
            }

            $query->where(function ($where) use ($surname, $own) {
                if ($surname !== null) {
                    $where->where('name', 'like', '%' . $surname . '%');
                }
                if ($own !== null) {
                    $where->orWhereDate('birth_date', $own);
                }
            });
        }

        $matches = $query->orderBy('name')->limit(25)->get()
            ->map(fn (SeniorCitizen $senior) => [
                'id' => $senior->id,
                'senior_id' => $senior->senior_id,
                'name' => $senior->name,
                'birth_date' => $senior->birth_date ? substr((string) $senior->birth_date, 0, 10) : null,
                'age' => $senior->age,
                'purok' => $senior->purok,
                'status' => $senior->status,
                'contact' => $senior->contact,
            ]);

        return response()->json([
            'matches' => $matches,
            'suggested' => $search === null && $birthDate === null,
        ]);
    }

    /**
     * POST /api/app-accounts/{appAccount}/link
     *
     * Links the account to an existing senior citizen record. This is the
     * same link the senior can earn in the app (Mobile\IdentityController),
     * so a verification still waiting for review is approved with it.
     */
    public function link(Request $request, AppAccount $appAccount): JsonResponse
    {
        $this->requireAdministrator($request);

        $data = $request->validate([
            'senior_citizen_id' => ['required', 'integer', 'exists:senior_citizens,id'],
        ]);

        if ($appAccount->isLinked()) {
            return $this->unprocessable('This app user is already linked to a senior citizen record.');
        }

        $senior = SeniorCitizen::findOrFail($data['senior_citizen_id']);

        if (in_array($senior->status, self::INELIGIBLE, true)) {
            return $this->unprocessable("This record is {$senior->status} and cannot be linked.");
        }

        if (AppAccount::where('senior_citizen_id', $senior->id)->where('id', '!=', $appAccount->id)->exists()) {
            return $this->unprocessable('This senior citizen record is already linked to another app user.');
        }

        $this->attachRecord($appAccount, $senior, $request);

        ActivityLogger::record('User Management', 'Linked',
            "App user linked to senior record {$senior->senior_id} · {$senior->name}.",
            $appAccount, $this->label($appAccount));

        return response()->json($this->row($appAccount));
    }

    /**
     * POST /api/app-accounts/{appAccount}/senior-record
     *
     * Creates a senior citizen record from this app user's own details and
     * links the account to it, for a senior who has no record yet.
     */
    public function createSeniorRecord(Request $request, AppAccount $appAccount): JsonResponse
    {
        $this->requireAdministrator($request);

        if ($appAccount->isLinked()) {
            return $this->unprocessable('This app user is already linked to a senior citizen record.');
        }

        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'birth_date' => ['required', 'date', 'before:today'],
            'gender' => ['required', 'string', 'max:20'],
            'purok' => ['required', 'string', 'max:255'],
            'contact' => ['nullable', 'string', 'max:50'],
            'civil_status' => ['nullable', 'string', 'max:30'],
        ]);

        $age = Carbon::parse($data['birth_date'])->age;

        if ($age < 60) {
            return $this->unprocessable(
                'A senior citizen record needs an age of 60 or older. Please check the birth date.',
                'birth_date'
            );
        }

        $senior = DB::transaction(function () use ($appAccount, $data, $age, $request) {
            $next = (SeniorCitizen::max('id') ?? 0) + 1;

            $senior = SeniorCitizen::create(array_merge($data, [
                'senior_id' => 'SC-' . now()->year . '-' . str_pad((string) $next, 4, '0', STR_PAD_LEFT),
                'age' => $age,
                'status' => 'Active',
                'osca_id' => 'Active',
                // No contact typed: the number the senior uses in the app.
                'contact' => $this->tidy($data['contact'] ?? null) ?? $appAccount->phone,
            ]));

            $this->attachRecord($appAccount, $senior, $request);

            return $senior;
        });

        ActivityLogger::record('Senior Records', 'Created',
            'Senior record added from the app user\'s details in User Management.',
            $senior, "{$senior->senior_id} · {$senior->name}");
        ActivityLogger::record('User Management', 'Linked',
            "App user linked to new senior record {$senior->senior_id} · {$senior->name}.",
            $appAccount, $this->label($appAccount));

        return response()->json($this->row($appAccount), 201);
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

    // -------------------------------------------------------------------------

    /**
     * The photo the senior set in the app; when they never set one, the 2x2
     * photo they uploaded with their registration documents.
     */
    private function streamPhoto(?AppAccount $account): StreamedResponse
    {
        $path = $account?->photo_path;

        if (! $path || ! Storage::disk('local')->exists($path)) {
            $path = $account?->idPhotoDocument()?->path;
        }

        abort_unless($path && Storage::disk('local')->exists($path), 404, 'No photo.');

        return Storage::disk('local')->response($path);
    }

    /** Links the record and approves a verification that was still pending. */
    private function attachRecord(AppAccount $account, SeniorCitizen $senior, Request $request): void
    {
        $account->senior_citizen_id = $senior->id;
        $account->linked_at = now();
        $account->linked_by = $request->user()->id;
        $account->save();

        $account->identityVerifications()
            ->where('status', 'Pending')
            ->update([
                'status' => 'Approved',
                'senior_citizen_id' => $senior->id,
                'reviewed_by' => $request->user()->name,
                'reviewed_at' => now(),
                'remarks' => 'Linked by staff in User Management.',
            ]);
    }

    /** The merged User Management row shape for an app user. */
    private function row(AppAccount $account): array
    {
        return UserRow::appUser(AppAccount::withRowRelations()->findOrFail($account->id));
    }

    private function label(AppAccount $account): string
    {
        return ($account->full_name ?: $account->displayPhone()) . ' (app)';
    }

    private function requireAdministrator(Request $request): void
    {
        abort_if(
            optional($request->user())->role !== 'Administrator',
            403,
            'Only administrators can manage users.'
        );
    }

    private function unprocessable(string $message, string $field = 'senior_citizen_id'): JsonResponse
    {
        return response()->json(['message' => $message, 'errors' => [$field => [$message]]], 422);
    }

    /** "+63 917 123 4567", "0917 123 4567" and "9171234567" all mean the same. */
    private function normalizePhone(mixed $value): string
    {
        $digits = preg_replace('/\D/', '', (string) $value);

        return preg_replace('/^(?:0063|63|0)/', '', (string) $digits);
    }

    private function tidy(?string $value): ?string
    {
        $value = trim((string) $value);

        return $value === '' ? null : $value;
    }

    /** The app user's surname, for suggesting records to link. */
    private function surname(AppAccount $account): ?string
    {
        $last = trim((string) ($account->last_name ?: ''));

        if ($last === '') {
            $parts = preg_split('/\s+/', trim((string) $account->full_name), -1, PREG_SPLIT_NO_EMPTY) ?: [];
            $last = $parts ? (string) end($parts) : '';
        }

        return $last === '' ? null : $last;
    }
}
