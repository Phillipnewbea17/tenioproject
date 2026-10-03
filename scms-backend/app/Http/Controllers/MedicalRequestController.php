<?php

namespace App\Http\Controllers;

use App\Models\MedicalRequest;
use App\Support\ActivityLogger;
use App\Support\ProgramPayout;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Medical assistance requests. Seniors will submit these through the Flutter
 * app (source "App"); staff record walk-ins (source "Walk-in").
 *
 * Completing a request pays the assistance out of a fund (see ProgramPayout).
 */
class MedicalRequestController extends Controller
{
    public function index()
    {
        return response()->json(
            MedicalRequest::with('fund:id,reference,name')->latest()->get()
        );
    }

    public function store(Request $request)
    {
        $validated = $request->validate($this->rules() + [
            'reference' => 'nullable|string|max:255|unique:medical_requests,reference',
        ]);

        $medicalRequest = DB::transaction(function () use ($validated, $request) {
            if (empty($validated['reference'])) {
                $nextNumber = (MedicalRequest::max('id') ?? 0) + 1;

                $validated['reference'] =
                    'MED-' . now()->year . '-' . str_pad($nextNumber, 4, '0', STR_PAD_LEFT);
            }

            $paying = $validated['status'] === 'Completed';
            $details = collect($validated)->except(['amount', 'fund_id', 'completed_date'])->all();

            // Staff can only record walk-ins; app requests arrive through the app API.
            $medicalRequest = MedicalRequest::create(
                ['source' => 'Walk-in'] + $details + ['status' => $paying ? 'Approved' : $validated['status']]
            );

            ActivityLogger::record('Programs', 'Created', 'Medical assistance request recorded (walk-in).', $medicalRequest, ProgramPayout::label($medicalRequest));

            if ($paying) {
                $this->pay($medicalRequest, $validated, $request);
            }

            return $medicalRequest;
        });

        return response()->json($medicalRequest->fresh('fund:id,reference,name'), 201);
    }

    public function show(MedicalRequest $medicalRequest)
    {
        return response()->json($medicalRequest->load('fund:id,reference,name'));
    }

    public function update(Request $request, MedicalRequest $medicalRequest)
    {
        $validated = $request->validate($this->rules(true) + [
            'reference' => [
                'sometimes',
                'required',
                'string',
                'max:255',
                'unique:medical_requests,reference,' . $medicalRequest->id,
            ],
        ]);

        DB::transaction(function () use ($medicalRequest, $validated, $request) {
            ProgramPayout::guardLocked($medicalRequest, $validated);
            $paying = ProgramPayout::isPaying($medicalRequest, $validated);

            $details = collect($validated)->except(['amount', 'fund_id']);
            if ($paying) {
                $details = $details->except(ProgramPayout::paymentFields($medicalRequest));
            }

            $medicalRequest->update($details->all());
            $changes = ActivityLogger::changes($medicalRequest);

            if ($changes) {
                ActivityLogger::record(
                    'Programs',
                    isset($changes['status']) ? 'Status changed' : 'Updated',
                    isset($changes['status'])
                        ? "Medical request status changed to {$medicalRequest->status}."
                        : 'Updated ' . ActivityLogger::fieldList($changes) . '.',
                    $medicalRequest,
                    ProgramPayout::label($medicalRequest),
                    $changes,
                );
            }

            if ($paying) {
                $this->pay($medicalRequest, $validated, $request);
            }
        });

        return response()->json($medicalRequest->fresh('fund:id,reference,name'));
    }

    public function destroy(MedicalRequest $medicalRequest)
    {
        abort_if($medicalRequest->isPaidFromFund(), 422,
            'This assistance was paid from a fund and cannot be deleted. Void its disbursement in Fund Management first.');

        ActivityLogger::record('Programs', 'Deleted', 'Medical assistance request deleted.', $medicalRequest, ProgramPayout::label($medicalRequest));

        $medicalRequest->delete();

        return response()->json([
            'message' => 'Medical request deleted successfully.',
        ]);
    }

    private function pay(MedicalRequest $medicalRequest, array $data, Request $request): void
    {
        $recipient = $data['received_by'] ?? $medicalRequest->received_by ?: $medicalRequest->senior_name;
        $medicalRequest->update(['received_by' => $recipient]);

        ProgramPayout::pay(
            $medicalRequest,
            $data,
            $recipient,
            "{$medicalRequest->assistance_type} assistance for {$medicalRequest->senior_name}" .
                ($medicalRequest->facility ? " ({$medicalRequest->facility})." : '.'),
            $request->user()?->name,
            ProgramPayout::label($medicalRequest),
        );
    }

    private function rules(bool $updating = false): array
    {
        $required = $updating ? 'sometimes|required' : 'required';

        return [
            'senior_name' => "{$required}|string|max:255",
            'senior_id' => "{$required}|string|max:255",
            'purok' => 'nullable|string|max:255',
            'contact' => 'nullable|string|max:255',
            'assistance_type' => "{$required}|string|max:255",
            'request_date' => "{$required}|date",
            'facility' => 'nullable|string|max:255',
            'status' => "{$required}|in:Pending,Approved,Completed,On Hold",
            'completed_date' => 'nullable|date|before_or_equal:today',
            'received_by' => 'nullable|string|max:255',
            'remarks' => 'nullable|string',
        ] + ProgramPayout::rules();
    }
}
