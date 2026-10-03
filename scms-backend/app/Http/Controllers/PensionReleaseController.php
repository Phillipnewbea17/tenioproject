<?php

namespace App\Http\Controllers;

use App\Models\PensionRelease;
use App\Support\ActivityLogger;
use App\Support\ProgramPayout;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Pension release records. Marking a pension Released pays it out of a
 * Pension fund (see ProgramPayout).
 */
class PensionReleaseController extends Controller
{
    public function index()
    {
        return response()->json(
            PensionRelease::with('fund:id,reference,name')->latest()->get()
        );
    }

    public function store(Request $request)
    {
        $validated = $request->validate($this->rules());

        $release = DB::transaction(function () use ($validated, $request) {
            $paying = $validated['status'] === 'Released';
            $details = collect($validated)->except(['amount', 'fund_id', 'release_date'])->all();

            $release = PensionRelease::create($details + ['status' => $paying ? 'Pending' : $validated['status']]);

            ActivityLogger::record('Programs', 'Created',
                "Pension for {$release->period} recorded.", $release, ProgramPayout::label($release));

            if ($paying) {
                $this->pay($release, $validated, $request);
            }

            return $release;
        });

        return response()->json($release->fresh('fund:id,reference,name'), 201);
    }

    public function update(Request $request, PensionRelease $pensionRelease)
    {
        $validated = $request->validate($this->rules());

        DB::transaction(function () use ($pensionRelease, $validated, $request) {
            ProgramPayout::guardLocked($pensionRelease, $validated);
            $paying = ProgramPayout::isPaying($pensionRelease, $validated);

            $details = collect($validated)->except(['amount', 'fund_id']);
            if ($paying) {
                $details = $details->except(ProgramPayout::paymentFields($pensionRelease));
            }

            $pensionRelease->update($details->all());
            $changes = ActivityLogger::changes($pensionRelease);

            if ($changes) {
                ActivityLogger::record(
                    'Programs',
                    isset($changes['status']) ? 'Status changed' : 'Updated',
                    isset($changes['status'])
                        ? "Pension for {$pensionRelease->period} changed to {$pensionRelease->status}."
                        : 'Updated ' . ActivityLogger::fieldList($changes) . '.',
                    $pensionRelease,
                    ProgramPayout::label($pensionRelease),
                    $changes,
                );
            }

            if ($paying) {
                $this->pay($pensionRelease, $validated, $request);
            }
        });

        return response()->json($pensionRelease->fresh('fund:id,reference,name'));
    }

    private function pay(PensionRelease $release, array $data, Request $request): void
    {
        $receivedBy = $data['received_by'] ?? $release->received_by;
        $recipient = $receivedBy === 'Senior' ? $release->name : "{$release->name} ({$receivedBy})";

        ProgramPayout::pay(
            $release,
            $data,
            $recipient,
            "Pension for {$release->period}: {$release->name} ({$release->senior_id}).",
            $request->user()?->name,
            ProgramPayout::label($release),
        );
    }

    private function rules(): array
    {
        return [
            'senior_id' => 'required|string|max:255',
            'name' => 'required|string|max:255',
            'period' => 'required|string|max:255',
            'release_date' => 'nullable|required_if:status,Released|date|before_or_equal:today',
            'received_by' => 'required|string|max:255',
            'status' => 'required|in:Released,Pending,On Hold',
            'reference' => 'nullable|string|max:255',
            'remarks' => 'nullable|string',
        ] + ProgramPayout::rules();
    }
}
