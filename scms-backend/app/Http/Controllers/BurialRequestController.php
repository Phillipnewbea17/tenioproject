<?php

namespace App\Http\Controllers;

use App\Models\BurialRequest;
use App\Support\ActivityLogger;
use App\Support\ProgramPayout;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Burial assistance requests. Families will submit these through the Flutter
 * app (source "App"); staff record walk-ins (source "Walk-in").
 *
 * Releasing assistance pays it out of a fund (see ProgramPayout).
 */
class BurialRequestController extends Controller
{
    public function index()
    {
        return response()->json(
            BurialRequest::with('fund:id,reference,name')->latest()->get()
        );
    }

    public function store(Request $request)
    {
        $validated = $request->validate($this->rules() + [
            'reference' => 'nullable|string|max:255|unique:burial_requests,reference',
        ]);

        $burialRequest = DB::transaction(function () use ($validated, $request) {
            if (empty($validated['reference'])) {
                $nextNumber = (BurialRequest::max('id') ?? 0) + 1;

                $validated['reference'] =
                    'BUR-' . now()->year . '-' . str_pad($nextNumber, 4, '0', STR_PAD_LEFT);
            }

            $paying = $validated['status'] === 'Released';
            $details = collect($validated)->except(['amount', 'fund_id', 'release_date'])->all();

            // Staff can only record walk-ins; app requests arrive through the app API.
            $burialRequest = BurialRequest::create(
                ['source' => 'Walk-in'] + $details + ['status' => $paying ? 'Approved' : $validated['status']]
            );

            ActivityLogger::record('Programs', 'Created', 'Burial assistance request recorded (walk-in).', $burialRequest, ProgramPayout::label($burialRequest));

            if ($paying) {
                $this->pay($burialRequest, $validated, $request);
            }

            return $burialRequest;
        });

        return response()->json($burialRequest->fresh('fund:id,reference,name'), 201);
    }

    public function show(BurialRequest $burialRequest)
    {
        return response()->json($burialRequest->load('fund:id,reference,name'));
    }

    public function update(Request $request, BurialRequest $burialRequest)
    {
        $validated = $request->validate($this->rules(true) + [
            'reference' => [
                'sometimes',
                'required',
                'string',
                'max:255',
                'unique:burial_requests,reference,' . $burialRequest->id,
            ],
        ]);

        DB::transaction(function () use ($burialRequest, $validated, $request) {
            ProgramPayout::guardLocked($burialRequest, $validated);
            $paying = ProgramPayout::isPaying($burialRequest, $validated);

            $details = collect($validated)->except(['amount', 'fund_id']);
            if ($paying) {
                $details = $details->except(ProgramPayout::paymentFields($burialRequest));
            }

            $burialRequest->update($details->all());
            $changes = ActivityLogger::changes($burialRequest);

            if ($changes) {
                ActivityLogger::record(
                    'Programs',
                    isset($changes['status']) ? 'Status changed' : 'Updated',
                    isset($changes['status'])
                        ? "Burial request status changed to {$burialRequest->status}."
                        : 'Updated ' . ActivityLogger::fieldList($changes) . '.',
                    $burialRequest,
                    ProgramPayout::label($burialRequest),
                    $changes,
                );
            }

            if ($paying) {
                $this->pay($burialRequest, $validated, $request);
            }
        });

        return response()->json($burialRequest->fresh('fund:id,reference,name'));
    }

    public function destroy(BurialRequest $burialRequest)
    {
        abort_if($burialRequest->isPaidFromFund(), 422,
            'Released assistance cannot be deleted because it was paid from a fund. Void its disbursement in Fund Management first.');

        ActivityLogger::record('Programs', 'Deleted', 'Burial assistance request deleted.', $burialRequest, ProgramPayout::label($burialRequest));

        $burialRequest->delete();

        return response()->json([
            'message' => 'Burial request deleted successfully.',
        ]);
    }

    private function pay(BurialRequest $burialRequest, array $data, Request $request): void
    {
        abort_if(empty($data['received_by']), 422, 'To release burial assistance, enter who received it.');

        $burialRequest->update(['received_by' => $data['received_by']]);

        ProgramPayout::pay(
            $burialRequest,
            $data,
            $data['received_by'],
            "Burial assistance for {$burialRequest->senior_name} (claimant: {$burialRequest->claimant_name}).",
            $request->user()?->name,
            ProgramPayout::label($burialRequest),
        );
    }

    private function rules(bool $updating = false): array
    {
        $required = $updating ? 'sometimes|required' : 'required';

        return [
            'senior_name' => "{$required}|string|max:255",
            'claimant_name' => "{$required}|string|max:255",
            'senior_id' => 'nullable|string|max:255',
            'death_date' => 'nullable|date',
            'purok' => 'nullable|string|max:255',
            'contact' => 'nullable|string|max:255',
            'funeral_home' => 'nullable|string|max:255',
            'request_date' => "{$required}|date",
            'status' => "{$required}|in:Pending,Approved,Released,On Hold",
            'relationship' => 'nullable|string|max:255',
            'release_date' => 'nullable|date|before_or_equal:today',
            'received_by' => 'nullable|string|max:255',
            'remarks' => 'nullable|string',
        ] + ProgramPayout::rules();
    }
}
