<?php

namespace App\Http\Controllers;

use App\Models\SeniorCitizen;
use App\Models\SeniorId;
use App\Support\ActivityLogger;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Senior ID Management: local/LGU senior citizen IDs for Los Angeles,
 * Ubay, Bohol. This is not the national Digital Senior Citizens ID.
 *
 * Every change is recorded in senior_id_histories so the ID History of a
 * senior can be reviewed later.
 */
class SeniorIdController extends Controller
{
    /** Statuses that count as the senior's current ID (only one allowed). */
    private const CURRENT_STATUSES = ['Pending Issuance', 'Active', 'For Replacement'];

    /** Senior record statuses that cannot receive a new ID. */
    private const INELIGIBLE_SENIOR_STATUSES = ['Archived', 'Inactive', 'Deceased'];

    public function index()
    {
        $ids = SeniorId::with('seniorCitizen', 'replacedBy')
            ->latest('id')
            ->get();

        return response()->json($ids->map(fn (SeniorId $id) => $this->transform($id)));
    }

    /** Every ID one senior has held, current first (for the Records profile). */
    public function forSenior(SeniorCitizen $seniorCitizen)
    {
        $ids = SeniorId::with('seniorCitizen', 'replacedBy')
            ->where('senior_citizen_id', $seniorCitizen->id)
            ->orderByRaw("CASE WHEN status IN ('Pending Issuance', 'Active', 'For Replacement') THEN 0 ELSE 1 END")
            ->latest('id')
            ->get();

        return response()->json([
            'eligible' => ! in_array($seniorCitizen->status, self::INELIGIBLE_SENIOR_STATUSES, true),
            'ids' => $ids->map(fn (SeniorId $id) => $this->transform($id))->values(),
        ]);
    }

    public function show(SeniorId $seniorId)
    {
        $seniorId->load('seniorCitizen', 'replacedBy', 'histories');

        return response()->json($this->transform($seniorId, true));
    }

    /** Issue ID: give an approved senior a new local ID number. */
    public function store(Request $request)
    {
        $data = $request->validate([
            'senior_citizen_id' => 'required|integer|exists:senior_citizens,id',
            'status' => ['required', Rule::in(['Pending Issuance', 'Active'])],
            'date_issued' => 'nullable|required_if:status,Active|date|before_or_equal:today',
            'remarks' => 'nullable|string|max:1000',
        ]);

        $senior = SeniorCitizen::findOrFail($data['senior_citizen_id']);

        abort_if(
            in_array($senior->status, self::INELIGIBLE_SENIOR_STATUSES, true),
            422,
            "An ID cannot be issued to a senior whose record is {$senior->status}."
        );

        $seniorId = DB::transaction(function () use ($data, $senior, $request) {
            $this->ensureNoCurrentId($senior->id);

            $seniorId = SeniorId::create([
                'id_number' => $this->nextIdNumber(),
                'senior_citizen_id' => $senior->id,
                'status' => $data['status'],
                'date_issued' => $data['status'] === 'Active' ? $data['date_issued'] : null,
                'issued_by' => $this->staffName($request),
                'remarks' => $data['remarks'] ?? null,
            ]);

            $this->log($seniorId, $request, [
                'action' => 'Issued',
                'details' => $data['status'] === 'Active'
                    ? 'ID issued and activated.'
                    : 'ID number assigned; card is pending issuance.',
                'new_id_number' => $seniorId->id_number,
                'date_processed' => now()->toDateString(),
            ]);

            return $seniorId;
        });

        return response()->json($this->fresh($seniorId), 201);
    }

    /** Mark a Pending Issuance ID as released to the senior. */
    public function activate(Request $request, SeniorId $seniorId)
    {
        $this->requireStatus($seniorId, ['Pending Issuance']);

        $data = $request->validate([
            'date_issued' => 'required|date|before_or_equal:today',
        ]);

        DB::transaction(function () use ($seniorId, $data, $request) {
            $seniorId->update([
                'status' => 'Active',
                'date_issued' => $data['date_issued'],
            ]);

            $this->log($seniorId, $request, [
                'action' => 'Activated',
                'details' => 'ID card released to the senior and marked Active.',
                'date_processed' => $data['date_issued'],
            ]);
        });

        return response()->json($this->fresh($seniorId));
    }

    /** Update ID information. Administrators only. */
    public function update(Request $request, SeniorId $seniorId)
    {
        $this->requireAdministrator($request, 'Only administrators can update ID information.');
        $this->requireStatus($seniorId, self::CURRENT_STATUSES);

        $data = $request->validate([
            'date_issued' => 'sometimes|nullable|date|before_or_equal:today',
            'remarks' => 'sometimes|nullable|string|max:1000',
        ]);

        abort_if(
            $seniorId->status !== 'Pending Issuance'
                && array_key_exists('date_issued', $data)
                && empty($data['date_issued']),
            422,
            'An issued ID must keep its date issued.'
        );

        DB::transaction(function () use ($seniorId, $data, $request) {
            $seniorId->fill($data);
            $changed = array_keys($seniorId->getDirty());

            if (! $changed) {
                return;
            }

            $seniorId->save();

            $labels = ['date_issued' => 'date issued', 'remarks' => 'remarks'];

            $this->log($seniorId, $request, [
                'action' => 'Updated',
                'details' => 'Updated ' . implode(' and ', array_map(fn ($key) => $labels[$key], $changed)) . '.',
                'date_processed' => now()->toDateString(),
            ]);
        });

        return response()->json($this->fresh($seniorId));
    }

    /** Record that the senior asked for a replacement card. */
    public function requestReplacement(Request $request, SeniorId $seniorId)
    {
        $this->requireStatus($seniorId, ['Active']);

        $data = $request->validate([
            'reason' => ['required', Rule::in(SeniorId::REPLACEMENT_REASONS)],
            'date_requested' => 'required|date|before_or_equal:today',
            'remarks' => 'nullable|string|max:1000',
        ]);

        DB::transaction(function () use ($seniorId, $data, $request) {
            $seniorId->update([
                'status' => 'For Replacement',
                'replacement_reason' => $data['reason'],
                'replacement_requested_at' => $data['date_requested'],
                // Seniors will request replacements in the app; staff record walk-ins.
                'replacement_source' => 'Walk-in',
            ]);

            $this->log($seniorId, $request, [
                'action' => 'Replacement Requested',
                'details' => $data['remarks'] ?? null,
                'reason' => $data['reason'],
                'previous_id_number' => $seniorId->id_number,
                'date_requested' => $data['date_requested'],
            ]);
        });

        return response()->json($this->fresh($seniorId));
    }

    /**
     * Process a replacement: the old ID becomes Inactive and a new ID number
     * is issued to the same senior.
     */
    public function replace(Request $request, SeniorId $seniorId)
    {
        $this->requireStatus($seniorId, ['Active', 'For Replacement']);

        $data = $request->validate([
            'reason' => ['required', Rule::in(SeniorId::REPLACEMENT_REASONS)],
            'date_requested' => 'nullable|date|before_or_equal:today',
            'remarks' => 'nullable|string|max:1000',
        ]);

        $newId = DB::transaction(function () use ($seniorId, $data, $request) {
            $today = now()->toDateString();
            $dateRequested = $data['date_requested']
                ?? $seniorId->replacement_requested_at?->toDateString()
                ?? $today;

            $newId = SeniorId::create([
                'id_number' => $this->nextIdNumber(),
                'senior_citizen_id' => $seniorId->senior_citizen_id,
                'status' => 'Active',
                'date_issued' => $today,
                'issued_by' => $this->staffName($request),
                'remarks' => $data['remarks'] ?? null,
            ]);

            $seniorId->update([
                'status' => 'Inactive',
                'replacement_reason' => $data['reason'],
                'replacement_requested_at' => $dateRequested,
                'replacement_source' => $seniorId->replacement_source ?? 'Walk-in',
                'replaced_by_id' => $newId->id,
            ]);

            $entry = [
                'reason' => $data['reason'],
                'previous_id_number' => $seniorId->id_number,
                'new_id_number' => $newId->id_number,
                'date_requested' => $dateRequested,
                'date_processed' => $today,
            ];

            $this->log($seniorId, $request, $entry + [
                'action' => 'Replaced',
                'details' => "Deactivated and replaced by {$newId->id_number}.",
            ]);

            $this->log($newId, $request, $entry + [
                'action' => 'Issued',
                'details' => "Replacement for {$seniorId->id_number}." .
                    (empty($data['remarks']) ? '' : ' ' . $data['remarks']),
            ]);

            return $newId;
        });

        return response()->json([
            'previous' => $this->fresh($seniorId),
            'replacement' => $this->fresh($newId),
        ], 201);
    }

    /** Deactivate an ID without issuing a new one. Administrators only. */
    public function deactivate(Request $request, SeniorId $seniorId)
    {
        $this->requireAdministrator($request, 'Only administrators can deactivate IDs.');
        $this->requireStatus($seniorId, self::CURRENT_STATUSES);

        $data = $request->validate([
            'remarks' => 'required|string|max:1000',
        ]);

        DB::transaction(function () use ($seniorId, $data, $request) {
            $seniorId->update(['status' => 'Inactive']);

            $this->log($seniorId, $request, [
                'action' => 'Deactivated',
                'details' => $data['remarks'],
                'previous_id_number' => $seniorId->id_number,
                'date_processed' => now()->toDateString(),
            ]);
        });

        return response()->json($this->fresh($seniorId));
    }

    private function ensureNoCurrentId(int $seniorCitizenId): void
    {
        $current = SeniorId::where('senior_citizen_id', $seniorCitizenId)
            ->whereIn('status', self::CURRENT_STATUSES)
            ->lockForUpdate()
            ->first();

        abort_if(
            $current !== null,
            422,
            "This senior already has ID {$current?->id_number} ({$current?->status}). Use Replacement instead."
        );
    }

    /** Next number in the form LA-SC-2026-0001 (resets every year). */
    private function nextIdNumber(): string
    {
        $prefix = 'LA-SC-' . now()->year . '-';

        $last = SeniorId::where('id_number', 'like', $prefix . '%')
            ->lockForUpdate()
            ->pluck('id_number')
            ->map(fn ($number) => (int) substr($number, strlen($prefix)))
            ->max() ?? 0;

        return $prefix . str_pad($last + 1, 4, '0', STR_PAD_LEFT);
    }

    private function requireStatus(SeniorId $seniorId, array $allowed): void
    {
        abort_unless(
            in_array($seniorId->status, $allowed, true),
            422,
            "This action is not available for an ID that is {$seniorId->status}."
        );
    }

    private function requireAdministrator(Request $request, string $message): void
    {
        abort_if(optional($request->user())->role !== 'Administrator', 403, $message);
    }

    private function staffName(Request $request): ?string
    {
        return optional($request->user())->name;
    }

    /** Writes the ID History entry and the matching Activity Log entry. */
    private function log(SeniorId $seniorId, Request $request, array $entry): void
    {
        $seniorId->histories()->create($entry + [
            'performed_by' => $this->staffName($request),
        ]);

        $action = match ($entry['action']) {
            'Issued' => 'ID issued',
            'Activated' => 'ID activated',
            'Updated' => 'ID updated',
            'Replaced' => 'ID replaced',
            'Deactivated' => 'ID deactivated',
            default => $entry['action'],
        };

        $seniorId->loadMissing('seniorCitizen');

        ActivityLogger::record(
            'OSCA IDs',
            $action,
            collect([$entry['details'] ?? null, isset($entry['reason']) ? "Reason: {$entry['reason']}." : null])->filter()->implode(' ') ?: null,
            $seniorId,
            "{$seniorId->id_number} · " . ($seniorId->seniorCitizen?->name ?? 'Unknown senior'),
        );
    }

    private function fresh(SeniorId $seniorId): array
    {
        return $this->transform(
            $seniorId->fresh(['seniorCitizen', 'replacedBy', 'histories']),
            true
        );
    }

    /** Shape the frontend expects (see mapSeniorId in services/api.js). */
    private function transform(SeniorId $id, bool $withHistory = false): array
    {
        $senior = $id->seniorCitizen;

        $data = [
            'id' => $id->id,
            'id_number' => $id->id_number,
            'status' => $id->status,
            'date_issued' => $id->date_issued?->toDateString(),
            'issued_by' => $id->issued_by,
            'remarks' => $id->remarks,
            'replacement_reason' => $id->replacement_reason,
            'replacement_source' => $id->replacement_source,
            'replacement_requested_at' => $id->replacement_requested_at?->toDateString(),
            'replaced_by' => $id->replacedBy?->id_number,
            'created_at' => $id->created_at,
            'updated_at' => $id->updated_at,
            'senior' => $senior ? [
                'id' => $senior->id,
                'senior_id' => $senior->senior_id,
                'name' => $senior->name,
                'age' => $senior->age,
                'birth_date' => $senior->birth_date
                    ? substr((string) $senior->birth_date, 0, 10)
                    : null,
                'gender' => $senior->gender,
                'purok' => $senior->purok,
                'status' => $senior->status,
                'registered_at' => $senior->created_at,
            ] : null,
        ];

        if ($withHistory) {
            $data['history'] = $id->histories->map(fn ($entry) => [
                'id' => $entry->id,
                'action' => $entry->action,
                'details' => $entry->details,
                'reason' => $entry->reason,
                'previous_id_number' => $entry->previous_id_number,
                'new_id_number' => $entry->new_id_number,
                'date_requested' => $entry->date_requested?->toDateString(),
                'date_processed' => $entry->date_processed?->toDateString(),
                'performed_by' => $entry->performed_by,
                'created_at' => $entry->created_at,
            ])->values();
        }

        return $data;
    }
}
