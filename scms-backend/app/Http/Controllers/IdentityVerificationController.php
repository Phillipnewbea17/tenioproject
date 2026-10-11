<?php

namespace App\Http\Controllers;

use App\Models\AppAccount;
use App\Models\IdentityVerification;
use App\Support\ActivityLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Staff side of senior-app account linking. The backend already checked
 * that the ID number, name and birthday match the record; staff compare the
 * live selfie with the senior and approve (links the account to the record)
 * or reject (the senior can try again in the app).
 */
class IdentityVerificationController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $status = $request->query('status', 'Pending');

        $items = IdentityVerification::with(['appAccount', 'seniorCitizen'])
            ->when($status !== 'All', fn ($q) => $q->where('status', $status))
            ->latest('id')
            ->limit(200)
            ->get()
            ->map(fn (IdentityVerification $v) => $this->transform($v));

        return response()->json($items);
    }

    /** The selfie (private file, staff only). */
    public function selfie(IdentityVerification $identityVerification): StreamedResponse
    {
        abort_unless($identityVerification->selfie_path
            && Storage::disk('local')->exists($identityVerification->selfie_path), 404, 'No selfie was sent.');

        return Storage::disk('local')->response($identityVerification->selfie_path);
    }

    public function approve(Request $request, IdentityVerification $identityVerification): JsonResponse
    {
        $data = $request->validate(['remarks' => 'nullable|string|max:1000']);
        abort_unless($identityVerification->status === 'Pending', 422, 'Only pending verifications can be approved.');

        DB::transaction(function () use ($identityVerification, $data, $request) {
            $verification = IdentityVerification::whereKey($identityVerification->id)->lockForUpdate()->first();
            $account = AppAccount::whereKey($verification->app_account_id)->lockForUpdate()->firstOrFail();
            $seniorId = $verification->senior_citizen_id;

            abort_unless($seniorId, 422, 'This verification has no matching senior record.');
            abort_if(AppAccount::where('senior_citizen_id', $seniorId)->where('id', '!=', $account->id)->exists(),
                422, 'This senior record is already linked to another app account.');

            $account->senior_citizen_id = $seniorId;
            $account->linked_at = now();
            $account->save();

            $verification->update([
                'status' => 'Approved',
                'reviewed_by' => $request->user()?->name,
                'reviewed_at' => now(),
                'remarks' => $data['remarks'] ?? null,
            ]);

            // Other pending requests for the same record can no longer be approved.
            IdentityVerification::where('senior_citizen_id', $seniorId)->where('status', 'Pending')
                ->where('id', '!=', $verification->id)
                ->update(['status' => 'Rejected', 'remarks' => 'The record was linked to another account.',
                    'reviewed_by' => $request->user()?->name, 'reviewed_at' => now()]);
        });

        $identityVerification->refresh()->load(['appAccount', 'seniorCitizen']);
        ActivityLogger::record('Senior App', 'Account linked', 'Selfie checked; app account linked to the senior record.',
            $identityVerification, $this->label($identityVerification));

        return response()->json($this->transform($identityVerification));
    }

    public function reject(Request $request, IdentityVerification $identityVerification): JsonResponse
    {
        $data = $request->validate(['remarks' => 'required|string|max:1000'], [
            'remarks.required' => 'Please give the reason, so the senior knows what to do.',
        ]);
        abort_unless($identityVerification->status === 'Pending', 422, 'Only pending verifications can be rejected.');

        $identityVerification->update([
            'status' => 'Rejected',
            'reviewed_by' => $request->user()?->name,
            'reviewed_at' => now(),
            'remarks' => $data['remarks'],
        ]);

        $identityVerification->load(['appAccount', 'seniorCitizen']);
        ActivityLogger::record('Senior App', 'Verification rejected', $data['remarks'],
            $identityVerification, $this->label($identityVerification));

        return response()->json($this->transform($identityVerification));
    }

    private function transform(IdentityVerification $v): array
    {
        $senior = $v->seniorCitizen;

        return [
            'id' => $v->id,
            'status' => $v->status,
            'failure' => $v->failure,
            'method' => $v->method,
            'submitted' => $v->submitted,
            'has_selfie' => (bool) $v->selfie_path,
            'phone' => $v->appAccount?->displayPhone(),
            'senior' => $senior ? [
                'id' => $senior->id,
                'senior_id' => $senior->senior_id,
                'name' => $senior->name,
                'birth_date' => $senior->birth_date ? substr((string) $senior->birth_date, 0, 10) : null,
                'purok' => $senior->purok,
            ] : null,
            'reviewed_by' => $v->reviewed_by,
            'reviewed_at' => $v->reviewed_at?->toIso8601String(),
            'remarks' => $v->remarks,
            'created_at' => $v->created_at?->toIso8601String(),
        ];
    }

    private function label(IdentityVerification $v): string
    {
        return ($v->seniorCitizen?->senior_id ?? 'No record') . ' · ' . ($v->seniorCitizen?->name ?? $v->appAccount?->displayPhone());
    }
}
