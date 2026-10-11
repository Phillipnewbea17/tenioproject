<?php

namespace App\Http\Controllers;

use App\Models\ProfileCorrection;
use App\Support\ActivityLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Staff side of the senior app's correction requests. Approving does not
 * change the senior record by itself: staff correct the record in Senior
 * Citizens, then approve, so every record change goes through the usual
 * screen. The remarks are shown to the senior in the app.
 */
class ProfileCorrectionController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $status = $request->query('status', 'Pending');

        $items = ProfileCorrection::with(['appAccount', 'seniorCitizen'])
            ->when($status !== 'All', fn ($q) => $q->where('status', $status))
            ->latest('id')
            ->limit(200)
            ->get()
            ->map(fn (ProfileCorrection $c) => $this->transform($c));

        return response()->json($items);
    }

    /** The supporting photo (private file, staff only). */
    public function attachment(ProfileCorrection $profileCorrection): StreamedResponse
    {
        abort_unless($profileCorrection->attachment_path
            && Storage::disk('local')->exists($profileCorrection->attachment_path), 404, 'No photo was sent.');

        return Storage::disk('local')->response($profileCorrection->attachment_path);
    }

    public function approve(Request $request, ProfileCorrection $profileCorrection): JsonResponse
    {
        $data = $request->validate(['remarks' => 'nullable|string|max:1000']);

        return $this->review($request, $profileCorrection, 'Approved',
            $data['remarks'] ?? 'Your record was corrected.');
    }

    public function reject(Request $request, ProfileCorrection $profileCorrection): JsonResponse
    {
        $data = $request->validate(['remarks' => 'required|string|max:1000'], [
            'remarks.required' => 'Please give the reason, so the senior knows what to do.',
        ]);

        return $this->review($request, $profileCorrection, 'Rejected', $data['remarks']);
    }

    private function review(Request $request, ProfileCorrection $correction, string $status, string $remarks): JsonResponse
    {
        abort_unless($correction->status === 'Pending', 422, 'Only pending requests can be reviewed.');

        $correction->update([
            'status' => $status,
            'reviewed_by' => $request->user()?->name,
            'reviewed_at' => now(),
            'remarks' => $remarks,
        ]);

        $correction->load(['appAccount', 'seniorCitizen']);
        ActivityLogger::record('Senior App', "Correction {$status}", $remarks,
            $correction, $this->label($correction));

        return response()->json($this->transform($correction));
    }

    private function transform(ProfileCorrection $c): array
    {
        $senior = $c->seniorCitizen;

        return [
            'id' => $c->id,
            'reference' => $c->reference(),
            'status' => $c->status,
            'field' => $c->field,
            'field_label' => $c->fieldLabel(),
            'current_value' => $c->current_value,
            'requested_value' => $c->requested_value,
            'reason' => $c->reason,
            'has_attachment' => (bool) $c->attachment_path,
            'phone' => $c->appAccount?->displayPhone(),
            'account_name' => $c->appAccount?->full_name,
            'senior' => $senior ? [
                'id' => $senior->id,
                'senior_id' => $senior->senior_id,
                'name' => $senior->name,
            ] : null,
            'reviewed_by' => $c->reviewed_by,
            'reviewed_at' => $c->reviewed_at?->toIso8601String(),
            'remarks' => $c->remarks,
            'created_at' => $c->created_at?->toIso8601String(),
        ];
    }

    private function label(ProfileCorrection $c): string
    {
        return $c->reference() . ' · ' . ($c->seniorCitizen?->name ?? $c->appAccount?->full_name ?? $c->appAccount?->displayPhone());
    }
}
