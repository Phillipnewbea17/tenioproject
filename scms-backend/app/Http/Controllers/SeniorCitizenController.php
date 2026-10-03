<?php

namespace App\Http\Controllers;

use App\Models\SeniorCitizen;
use App\Support\ActivityLogger;
use Illuminate\Http\Request;

class SeniorCitizenController extends Controller
{
    public function index()
    {
        return response()->json(
            SeniorCitizen::with('currentOscaId')->orderBy('created_at', 'desc')->get()
                ->map(fn (SeniorCitizen $senior) => $senior->toRecordArray())
        );
    }

    public function store(Request $request)
{
    $validated = $request->validate([
        'name' => 'required|string|max:255',
        'age' => 'required|integer|min:60',
        'birth_date' => 'nullable|date',
        'gender' => 'required|string',
        'purok' => 'required|string',
        'contact' => 'nullable|string',

        'blood_type' => 'nullable|string',
        'condition' => 'nullable|string',
        'maintenance' => 'nullable|string',
        'last_checkup' => 'nullable|date',

        'civil_status' => 'nullable|string',
        'emergency_contact' => 'nullable|string',
        'relationship' => 'nullable|string',
        'osca_id' => 'nullable|in:Active,Inactive',
    ]);

    $nextNumber = (SeniorCitizen::max('id') ?? 0) + 1;

    $validated['senior_id'] =
        'SC-' . now()->year . '-' . str_pad($nextNumber, 4, '0', STR_PAD_LEFT);

    $validated['status'] = 'Active';
    $validated['osca_id'] = $validated['osca_id'] ?? 'Active';

    $seniorCitizen = SeniorCitizen::create($validated);

    ActivityLogger::record('Senior Records', 'Created', 'Senior record added.', $seniorCitizen, $this->label($seniorCitizen));

    return response()->json($seniorCitizen->toRecordArray(), 201);
}

    private function label(SeniorCitizen $senior): string
    {
        return "{$senior->senior_id} · {$senior->name}";
    }

    public function show(SeniorCitizen $seniorCitizen)
    {
        return response()->json($seniorCitizen->toRecordArray());
    }

    public function update(Request $request, SeniorCitizen $seniorCitizen)
    {
        $validated = $request->validate([
            'senior_id' => 'sometimes|string|unique:senior_citizens,senior_id,' . $seniorCitizen->id,
            'name' => 'sometimes|string|max:255',
            'age' => 'sometimes|integer|min:60',
            'birth_date' => 'nullable|date',
            'gender' => 'sometimes|string',
            'purok' => 'sometimes|string',
            'contact' => 'nullable|string',
            
'status' => 'sometimes|required|in:Active,Needs follow-up,Needs attention,Archived,Inactive,Deceased',

            'blood_type' => 'nullable|string',
            'condition' => 'nullable|string',
            'maintenance' => 'nullable|string',
          

            'civil_status' => 'nullable|string',
            'emergency_contact' => 'nullable|string',
            'relationship' => 'nullable|string',
            'osca_id' => 'nullable|string',
        ]);

        $seniorCitizen->update($validated);

        $changes = ActivityLogger::changes($seniorCitizen);

        if ($changes) {
            ActivityLogger::record(
                'Senior Records',
                isset($changes['status']) ? 'Status changed' : 'Updated',
                isset($changes['status'])
                    ? "Record status changed to {$seniorCitizen->status}."
                    : 'Updated ' . ActivityLogger::fieldList($changes) . '.',
                $seniorCitizen,
                $this->label($seniorCitizen),
                $changes,
            );
        }

        return response()->json($seniorCitizen->fresh()->toRecordArray());
    }

    // No destroy(): senior records are kept permanently. Use status
    // "Archived" (or "Deceased") instead; see routes/api.php.
}