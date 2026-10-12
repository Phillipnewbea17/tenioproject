<?php

namespace App\Http\Controllers;

use App\Models\SeniorCitizen;
use App\Support\ActivityLogger;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

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
        'gender' => ['required', Rule::in(SeniorCitizen::GENDERS)],
        'purok' => ['required', Rule::in(SeniorCitizen::PUROKS)],
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
            'age' => 'sometimes|nullable|integer|min:60',
            // A record created from an approved application may still be
            // missing these, so Edit record is allowed to send them empty.
            'birth_date' => 'nullable|date|before:today',
            'gender' => ['sometimes', 'nullable', Rule::in(SeniorCitizen::GENDERS)],
            'purok' => ['sometimes', 'nullable', Rule::in(SeniorCitizen::PUROKS)],
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

        // Age always follows the birth date, so the two can never disagree.
        if (array_key_exists('birth_date', $validated)) {
            $validated['age'] = $validated['birth_date']
                ? Carbon::parse($validated['birth_date'])->age
                : null;

            if ($validated['age'] !== null && $validated['age'] < 60) {
                return response()->json([
                    'message' => 'A senior citizen must be 60 or older. Please check the birth date.',
                    'errors' => ['birth_date' => ['A senior citizen must be 60 or older. Please check the birth date.']],
                ], 422);
            }
        }

        $seniorCitizen->fill($validated);

        // Completing a record that came from an approved application is what
        // makes it ready for an OSCA ID.
        if ($seniorCitizen->status === SeniorCitizen::NEEDS_ATTENTION
            && ! array_key_exists('status', $validated)
            && $seniorCitizen->isCompleteForId()) {
            $seniorCitizen->status = 'Active';
        }

        $seniorCitizen->save();

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

    /**
     * GET /api/senior-citizens/{seniorCitizen}/id-photo
     *
     * The 2x2 photo the senior uploaded with their registration documents,
     * printed on their OSCA ID card. The file is streamed straight from where
     * the upload put it (private storage, staff only) - it is never copied.
     */
    public function idPhoto(SeniorCitizen $seniorCitizen)
    {
        $document = $seniorCitizen->idPhotoDocument();

        abort_unless(
            $document && Storage::disk('local')->exists($document->path),
            404,
            'No 2x2 photo was uploaded for this senior.'
        );

        return Storage::disk('local')->response($document->path, null, [
            'Content-Type' => $document->mime_type ?: 'image/jpeg',
            'Cache-Control' => 'private, max-age=300',
        ]);
    }

    // No destroy(): senior records are kept permanently. Use status
    // "Archived" (or "Deceased") instead; see routes/api.php.
}