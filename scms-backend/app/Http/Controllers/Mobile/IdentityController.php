<?php

namespace App\Http\Controllers\Mobile;

use App\Http\Controllers\Controller;
use App\Models\AppAccount;
use App\Models\IdentityVerification;
use App\Models\SeniorCitizen;
use App\Support\ActivityLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * Links a senior-app account to its existing senior citizen record. No
 * record is ever created here.
 *
 *   POST /identity/lookup  seniorId -> found | not_found | already_linked
 *   POST /identity/verify  the confirmed information + a live selfie
 *
 * verify checks the record match itself (ID number, name and birthday must
 * all match). The selfie cannot be checked automatically: the records have
 * no photo to compare it with and no face-matching service is configured.
 * So a match is answered "pending": OSCA staff compare the selfie and
 * approve (the account is linked) or reject it in the admin web app.
 * Nothing is reported as verified before that.
 */
class IdentityController extends Controller
{
    /** Failed matches allowed per account per day, to stop guessing. */
    private const MAX_FAILED_PER_DAY = 5;

    private const INELIGIBLE = ['Archived', 'Inactive', 'Deceased'];

    /**
     * Is there a record with this ID number that can be linked? Only says
     * whether it exists: the record's details are never sent here, so an ID
     * number alone does not reveal anyone's name or birthday.
     */
    public function lookup(Request $request): JsonResponse
    {
        $id = trim((string) $request->validate(['seniorId' => 'required|string|max:50'])['seniorId']);
        $account = $request->user();
        $senior = self::findRecord($id);

        if (! $senior || in_array($senior->status, self::INELIGIBLE, true)) {
            return response()->json(['status' => 'not_found',
                'message' => 'We could not find a matching senior citizen record.']);
        }

        if (self::linkedElsewhere($senior, $account)) {
            return response()->json(['status' => 'already_linked',
                'message' => 'This senior citizen record is already linked to an account.']);
        }

        return response()->json([
            'status' => 'found',
            'record' => ['seniorId' => $id],
            'lockedFields' => ['seniorId'],
        ]);
    }

    public function verify(Request $request): JsonResponse
    {
        $data = $request->validate([
            'seniorId' => 'required|string|max:50',
            'firstName' => 'required|string|max:100',
            'middleName' => 'nullable|string|max:100',
            'lastName' => 'required|string|max:100',
            'suffix' => 'nullable|string|max:20',
            'birthDate' => 'required|date|before:today',
            'sex' => 'nullable|string|max:20',
            'civilStatus' => 'nullable|string|max:30',
            'method' => ['nullable', Rule::in(['qr', 'idPhoto', 'manual'])],
            'file' => 'required|image|max:8192',
        ], [
            'file.required' => 'Please take a selfie.',
            'file.image' => 'Please take a selfie.',
        ]);

        $account = $request->user();

        if ($account->isLinked()) {
            return response()->json(['status' => 'verified', 'profile' => ProfileController::present($account)]);
        }

        if ($account->identityVerifications()->where('status', 'Pending')->exists()) {
            return response()->json(['status' => 'pending',
                'message' => 'Your information was already sent. The OSCA office will check it soon.',
                'profile' => ProfileController::present($account)], 202);
        }

        $failed = $account->identityVerifications()->where('status', 'Failed')
            ->where('created_at', '>', now()->subDay())->count();
        if ($failed >= self::MAX_FAILED_PER_DAY) {
            return self::answer('too_many_attempts', 429,
                'Verification could not be completed. Please contact the OSCA office for help.');
        }

        $submitted = collect($data)->except('file')->map(fn ($v) => is_string($v) ? trim($v) : $v)->all();
        $senior = self::findRecord($submitted['seniorId']);

        if (! $senior || in_array($senior->status, self::INELIGIBLE, true)) {
            return self::fail($account, $submitted, $data['method'] ?? 'manual', 'not_found', 404,
                'We could not find a matching senior citizen record.', $failed);
        }

        if (self::linkedElsewhere($senior, $account)) {
            return self::answer('already_linked', 409,
                'This senior citizen record is already linked to an account. Please contact OSCA if you believe this is an error.');
        }

        if (! self::sameBirthday($senior, $submitted['birthDate']) || ! self::sameName($senior, $submitted)) {
            return self::fail($account, $submitted, $data['method'] ?? 'manual', 'info_mismatch', 422,
                'Some information does not match our records.', $failed, $senior);
        }

        $file = $request->file('file');
        $path = $file->storeAs("identity-selfies/{$account->id}", Str::uuid() . '.' . ($file->extension() ?: 'jpg'), 'local');

        $verification = $account->identityVerifications()->create([
            'senior_citizen_id' => $senior->id,
            'method' => $data['method'] ?? 'manual',
            'submitted' => $submitted,
            'selfie_path' => $path,
            'status' => 'Pending',
        ]);

        ActivityLogger::record('Senior App', 'Identity sent for review',
            'Information matches the record. Selfie waiting for staff review.',
            $verification, "{$senior->senior_id} · {$senior->name}");

        return response()->json([
            'status' => 'pending',
            'message' => 'Your information matches our records. The OSCA office will now check your selfie '
                . 'and link your account. We will let you know.',
            'profile' => ProfileController::present($account),
        ], 202);
    }

    // -------------------------------------------------------------------------

    /** By the record's SCMS number or its OSCA ID number (any letter case). */
    public static function findRecord(string $id): ?SeniorCitizen
    {
        $id = strtoupper(trim($id));
        if ($id === '') {
            return null;
        }

        return SeniorCitizen::whereRaw('UPPER(senior_id) = ?', [$id])->first()
            ?? SeniorCitizen::whereHas('seniorIds', fn ($q) => $q->whereRaw('UPPER(id_number) = ?', [$id]))->first();
    }

    /** Linked to (or waiting for staff to link to) a different account. */
    public static function linkedElsewhere(SeniorCitizen $senior, AppAccount $account): bool
    {
        return AppAccount::where('senior_citizen_id', $senior->id)->where('id', '!=', $account->id)->exists()
            || IdentityVerification::where('senior_citizen_id', $senior->id)
                ->where('status', 'Pending')->where('app_account_id', '!=', $account->id)->exists();
    }

    private static function sameBirthday(SeniorCitizen $senior, string $birthDate): bool
    {
        // A record without a birthday cannot be matched by the app.
        return $senior->birth_date
            && Carbon::parse($senior->birth_date)->isSameDay(Carbon::parse($birthDate));
    }

    /** The first and last names typed must both be in the record's name. */
    private static function sameName(SeniorCitizen $senior, array $submitted): bool
    {
        $words = fn (string $text) => array_values(array_filter(explode(' ',
            preg_replace('/[^a-z ]/', ' ', strtolower(Str::ascii($text))))));

        $record = $words((string) $senior->name);
        foreach (['firstName', 'lastName'] as $field) {
            $typed = $words((string) ($submitted[$field] ?? ''));
            if (! $typed || array_diff($typed, $record)) {
                return false;
            }
        }

        return true;
    }

    private static function fail(AppAccount $account, array $submitted, string $method, string $code,
        int $status, string $message, int $failedBefore, ?SeniorCitizen $senior = null): JsonResponse
    {
        $account->identityVerifications()->create([
            'senior_citizen_id' => $senior?->id,
            'method' => $method,
            'submitted' => $submitted,
            'status' => 'Failed',
            'failure' => $code,
        ]);

        $left = self::MAX_FAILED_PER_DAY - $failedBefore - 1;

        return response()->json(['status' => $code, 'code' => $code, 'message' => $message,
            'attemptsLeft' => max(0, $left)], $status);
    }

    private static function answer(string $code, int $status, string $message): JsonResponse
    {
        return response()->json(['status' => $code, 'code' => $code, 'message' => $message], $status);
    }
}
