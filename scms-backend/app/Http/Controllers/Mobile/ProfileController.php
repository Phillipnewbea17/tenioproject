<?php

namespace App\Http\Controllers\Mobile;

use App\Http\Controllers\Controller;
use App\Models\AppAccount;
use App\Models\IdentityVerification;
use App\Models\SeniorCitizen;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * The signed-in app account's profile. One answer serves two app models:
 * UserProfile (fullName, phone, address) and LinkedProfile (the senior
 * citizen record's fields plus identityStatus).
 *
 * Once the account is linked, the senior citizen record is the source of
 * truth: its name and birthday are shown, and the app cannot change them.
 */
class ProfileController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        return response()->json(self::present($request->user()));
    }

    /** Accepts the app's UserProfile.toJson() (camelCase). */
    public function update(Request $request): JsonResponse
    {
        $data = $request->validate([
            'fullName' => 'sometimes|nullable|string|max:255',
            'role' => ['sometimes', 'nullable', Rule::in(AppAccount::ROLES)],
            'birthDate' => 'sometimes|nullable|date|before:today',
            'barangay' => 'sometimes|nullable|string|max:255',
            'municipality' => 'sometimes|nullable|string|max:255',
            'province' => 'sometimes|nullable|string|max:255',
            'firstName' => ['sometimes', 'nullable', 'string', 'max:100', "regex:/^[\\p{L} .'\\-]*$/u"],
            'middleName' => ['sometimes', 'nullable', 'string', 'max:100', "regex:/^[\\p{L} .'\\-]*$/u"],
            'lastName' => ['sometimes', 'nullable', 'string', 'max:100', "regex:/^[\\p{L} .'\\-]*$/u"],
            'suffix' => ['sometimes', 'nullable', 'string', 'max:10', 'regex:/^[A-Za-z.]*$/'],
            'noMiddleName' => 'sometimes|boolean',
        ], ['*.regex' => 'Please use letters only.']);

        $account = $request->user();

        // The official name and birthday come from the linked record.
        $fields = ['role' => 'role', 'barangay' => 'barangay', 'municipality' => 'municipality', 'province' => 'province'];
        if (! $account->isLinked()) {
            $fields += ['fullName' => 'full_name', 'birthDate' => 'birth_date',
                'firstName' => 'first_name', 'middleName' => 'middle_name', 'lastName' => 'last_name',
                'suffix' => 'suffix', 'noMiddleName' => 'no_middle_name'];
        }

        foreach ($fields as $from => $to) {
            if (array_key_exists($from, $data)) {
                $account->{$to} = $from === 'birthDate' && $data[$from] ? substr($data[$from], 0, 10) : $data[$from];
            }
        }
        $account->save();

        return response()->json(['ok' => true, 'profile' => self::present($account)]);
    }

    /**
     * POST /profile/photo (multipart "file"). Saves the senior's app-profile
     * photo on the private disk so staff can see it in User Management.
     */
    public function uploadPhoto(Request $request): JsonResponse
    {
        $request->validate([
            'file' => ['required', 'image', 'max:5120'], // up to 5 MB
        ]);

        $account = $request->user();
        $file = $request->file('file');

        $path = $file->storeAs(
            "app-profile-photos/{$account->id}",
            Str::uuid() . '.' . ($file->extension() ?: 'jpg'),
            'local'
        );

        $old = $account->photo_path;
        $account->photo_path = $path;
        $account->save();

        if ($old && $old !== $path) {
            Storage::disk('local')->delete($old);
        }

        return response()->json(['ok' => true]);
    }

    /** POST /profile/photo/remove. Clears the app-profile photo. */
    public function removePhoto(Request $request): JsonResponse
    {
        $account = $request->user();

        if ($account->photo_path) {
            Storage::disk('local')->delete($account->photo_path);
            $account->photo_path = null;
            $account->save();
        }

        return response()->json(['ok' => true]);
    }

    public static function present(AppAccount $account): array
    {
        $senior = $account->seniorCitizen;
        $pending = $senior ? null : $account->identityVerifications()
            ->where('status', 'Pending')->latest('id')->first();

        $base = [
            'phone' => $account->phone,
            'mobile' => $account->phone,
            'fullName' => $account->full_name ?? '',
            'role' => $account->role ?? 'senior',
            'birthDate' => $account->birth_date?->toDateString(),
            'barangay' => $account->barangay ?? '',
            'municipality' => $account->municipality ?? '',
            'province' => $account->province ?? '',
            'identityStatus' => $senior ? 'verified' : ($pending ? 'pending' : 'unverified'),
            'registrationStatus' => $senior?->status ?? '',
            'photoUrl' => '',
        ];

        if ($senior) {
            return array_merge($base, self::recordFields($senior));
        }

        if ($pending) {
            // What the senior sent, until OSCA checks it.
            $sent = collect($pending->submitted)->only([
                'firstName', 'middleName', 'lastName', 'suffix', 'birthDate', 'sex', 'civilStatus', 'seniorId',
            ])->all();

            return array_merge($base, $sent);
        }

        // The name typed in Create Account (Personal Information's fields).
        return array_merge($base, [
            'firstName' => $account->first_name ?? '',
            'middleName' => $account->middle_name ?? '',
            'lastName' => $account->last_name ?? '',
            'suffix' => $account->suffix ?? '',
            'noMiddleName' => (bool) $account->no_middle_name,
        ]);
    }

    /** The senior citizen record's fields, in the app's PersonalInfo shape. */
    public static function recordFields(SeniorCitizen $senior): array
    {
        [$first, $middle, $last] = self::splitName((string) $senior->name);
        $osca = $senior->currentOscaId;

        return [
            'fullName' => $senior->name,
            'firstName' => $first,
            'middleName' => $middle,
            'lastName' => $last,
            'birthDate' => $senior->birth_date ? substr((string) $senior->birth_date, 0, 10) : null,
            'sex' => $senior->gender ?? '',
            'civilStatus' => $senior->civil_status ?? '',
            'seniorId' => $osca?->id_number ?? $senior->senior_id,
            'purok' => $senior->purok ?? '',
        ];
    }

    /**
     * Records keep one name field. "Dela Cruz, Juan Santos" or "Juan Santos
     * Dela Cruz" -> [first, middle, last] (best effort, for display).
     */
    private static function splitName(string $name): array
    {
        $name = trim(preg_replace('/\s+/', ' ', $name));
        if (str_contains($name, ',')) {
            [$last, $rest] = array_map('trim', explode(',', $name, 2));

            return [$rest, '', $last];
        }

        $parts = explode(' ', $name);
        if (count($parts) === 1) {
            return [$name, '', ''];
        }

        $last = array_pop($parts);
        // Common two-word surnames: "Dela Cruz", "De Leon", "Del Rosario".
        if ($parts && in_array(strtolower(end($parts)), ['dela', 'de', 'del', 'delos', 'san', 'santa', 'sta.'], true)) {
            $last = array_pop($parts) . ' ' . $last;
        }

        return [implode(' ', $parts), '', $last];
    }
}
