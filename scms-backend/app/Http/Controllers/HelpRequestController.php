<?php

namespace App\Http\Controllers;

use App\Models\HelpRequest;
use App\Models\SeniorCitizen;
use App\Models\User;
use App\Support\ActivityLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Help & Complaint Desk. Any logged-in staff member can record, assign,
 * work on and resolve cases. Cases are never deleted; they are closed.
 *
 * Every change adds a timeline entry (help_request_updates) and an
 * Activity Log entry.
 */
class HelpRequestController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'search' => 'nullable|string|max:255',
            'status' => ['nullable', Rule::in(HelpRequest::STATUSES)],
            'category' => ['nullable', Rule::in(HelpRequest::CATEGORIES)],
            'priority' => ['nullable', Rule::in(HelpRequest::PRIORITIES)],
            'source' => ['nullable', Rule::in(HelpRequest::SOURCES)],
            // A user id, "me" or "unassigned".
            'assigned' => 'nullable|string|max:20',
            'senior_citizen_id' => 'nullable|integer',
        ]);

        $assigned = $data['assigned'] ?? null;

        $requests = HelpRequest::with('assignee', 'seniorCitizen')
            ->when($data['status'] ?? null, fn ($q, $status) => $q->where('status', $status))
            ->when($data['category'] ?? null, fn ($q, $category) => $q->where('category', $category))
            ->when($data['priority'] ?? null, fn ($q, $priority) => $q->where('priority', $priority))
            ->when($data['source'] ?? null, fn ($q, $source) => $q->where('source', $source))
            ->when($data['senior_citizen_id'] ?? null, fn ($q, $id) => $q->where('senior_citizen_id', $id))
            ->when($assigned === 'me', fn ($q) => $q->where('assigned_user_id', $request->user()->id))
            ->when($assigned === 'unassigned', fn ($q) => $q->whereNull('assigned_user_id'))
            ->when(ctype_digit((string) $assigned), fn ($q) => $q->where('assigned_user_id', (int) $assigned))
            ->when($data['search'] ?? null, function ($q, $search) {
                $like = '%' . addcslashes($search, '%_\\') . '%';
                $q->where(fn ($inner) => $inner->where('reference', 'like', $like)
                    ->orWhere('subject', 'like', $like)
                    ->orWhere('senior_name', 'like', $like)
                    ->orWhere('description', 'like', $like));
            })
            // Open cases first, then urgent ones, then newest.
            ->orderByRaw("CASE status WHEN 'Pending' THEN 0 WHEN 'Working on it' THEN 1 WHEN 'Resolved' THEN 2 ELSE 3 END")
            ->orderByRaw("CASE priority WHEN 'Urgent' THEN 0 WHEN 'High' THEN 1 WHEN 'Normal' THEN 2 ELSE 3 END")
            ->orderByDesc('submitted_at')
            ->orderByDesc('id')
            ->get();

        $counts = HelpRequest::query()->selectRaw('status, count(*) as total')->groupBy('status')->pluck('total', 'status');

        return response()->json([
            'requests' => $requests->map(fn ($r) => $this->transform($r))->values(),
            'counts' => collect(HelpRequest::STATUSES)->mapWithKeys(fn ($status) => [$status => (int) ($counts[$status] ?? 0)]),
            'mine_open' => HelpRequest::where('assigned_user_id', $request->user()->id)
                ->whereIn('status', ['Pending', 'Working on it'])
                ->count(),
        ]);
    }

    /** Values for forms and filters, including the staff who can be assigned. */
    public function options(): JsonResponse
    {
        return response()->json([
            'categories' => HelpRequest::CATEGORIES,
            'statuses' => HelpRequest::STATUSES,
            'priorities' => HelpRequest::PRIORITIES,
            'channels' => HelpRequest::CHANNELS,
            'staff' => User::query()
                ->where(fn ($q) => $q->whereNull('status')->orWhere('status', 'Active'))
                ->orderBy('name')
                ->get(['id', 'name', 'role']),
        ]);
    }

    public function show(HelpRequest $helpRequest): JsonResponse
    {
        return response()->json($this->detail($helpRequest));
    }

    /** Senior Help History: every request from one senior, newest first. */
    public function forSenior(SeniorCitizen $seniorCitizen): JsonResponse
    {
        return response()->json(
            HelpRequest::with('assignee')
                ->where('senior_citizen_id', $seniorCitizen->id)
                ->orderByDesc('submitted_at')
                ->orderByDesc('id')
                ->get()
                ->map(fn ($r) => $this->transform($r))
                ->values()
        );
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate($this->detailRules() + [
            'senior_citizen_id' => 'required|integer|exists:senior_citizens,id',
            'submitted_at' => 'required|date|before_or_equal:today',
            'assigned_user_id' => ['nullable', 'integer', $this->activeUserRule()],
        ]);

        $helpRequest = DB::transaction(function () use ($data, $request) {
            $senior = SeniorCitizen::findOrFail($data['senior_citizen_id']);
            $assigned = ! empty($data['assigned_user_id']);

            // Staff can only record walk-ins; app cases arrive through the app API.
            $helpRequest = HelpRequest::create($data + [
                'source' => 'Walk-in',
                'reference' => $this->nextReference(),
                'senior_name' => $senior->name,
                'priority' => $data['priority'] ?? 'Normal',
                // Assigning straight away means someone is already on it.
                'status' => $assigned ? 'Working on it' : 'Pending',
                'created_by' => $request->user()?->name,
            ]);

            $this->timeline($helpRequest, $request, 'Created', null, 'Pending', "Recorded via " . ($helpRequest->channel ?: 'an unspecified channel') . '.');
            ActivityLogger::record('Help Desk', 'Request created', "{$helpRequest->category}: {$helpRequest->subject}", $helpRequest, $this->label($helpRequest));

            if ($assigned) {
                $helpRequest->load('assignee');
                $this->timeline($helpRequest, $request, 'Assigned', 'Pending', 'Working on it', "Assigned to {$helpRequest->assignee->name}.");
                ActivityLogger::record('Help Desk', 'Assigned', "Assigned to {$helpRequest->assignee->name}.", $helpRequest, $this->label($helpRequest));
            }

            return $helpRequest;
        });

        return response()->json($this->detail($helpRequest), 201);
    }

    /** Edit the case details (not its status). */
    public function update(Request $request, HelpRequest $helpRequest): JsonResponse
    {
        $this->requireNotClosed($helpRequest);

        $data = $request->validate($this->detailRules());

        $helpRequest->update($data);
        $changes = ActivityLogger::changes($helpRequest);

        if ($changes) {
            $this->timeline($helpRequest, $request, 'Edited', null, null, 'Updated ' . ActivityLogger::fieldList($changes) . '.');
            ActivityLogger::record('Help Desk', 'Updated', 'Updated ' . ActivityLogger::fieldList($changes) . '.', $helpRequest, $this->label($helpRequest), $changes);
        }

        return response()->json($this->detail($helpRequest));
    }

    public function assign(Request $request, HelpRequest $helpRequest): JsonResponse
    {
        $this->requireNotClosed($helpRequest);

        $data = $request->validate([
            'assigned_user_id' => ['nullable', 'integer', $this->activeUserRule()],
            'note' => 'nullable|string|max:2000',
        ]);

        $newId = isset($data['assigned_user_id']) ? (int) $data['assigned_user_id'] : null;
        $currentId = $helpRequest->assigned_user_id !== null ? (int) $helpRequest->assigned_user_id : null;
        abort_if($newId === $currentId, 422, $newId ? 'The case is already assigned to that person.' : 'The case is already unassigned.');

        DB::transaction(function () use ($helpRequest, $newId, $data, $request) {
            $from = $helpRequest->status;
            $helpRequest->assigned_user_id = $newId;

            // Flow from the spec: once someone is assigned, the case is being worked on.
            if ($newId && $from === 'Pending') {
                $helpRequest->status = 'Working on it';
            }

            $helpRequest->save();
            $helpRequest->load('assignee');

            $text = $newId ? "Assigned to {$helpRequest->assignee->name}." : 'Unassigned.';
            $note = trim($text . ' ' . ($data['note'] ?? ''));

            $this->timeline($helpRequest, $request, $newId ? 'Assigned' : 'Unassigned', $from, $helpRequest->status === $from ? null : $helpRequest->status, $note);
            ActivityLogger::record('Help Desk', $newId ? 'Assigned' : 'Unassigned', $note, $helpRequest, $this->label($helpRequest));
        });

        return response()->json($this->detail($helpRequest));
    }

    /**
     * Move the case forward: Working on it, Resolved (needs the action taken)
     * or Closed (needs a reason unless it was resolved first).
     */
    public function changeStatus(Request $request, HelpRequest $helpRequest): JsonResponse
    {
        $data = $request->validate([
            'status' => ['required', Rule::in(['Working on it', 'Resolved', 'Closed'])],
            'note' => 'nullable|string|max:2000',
            'resolution' => 'nullable|required_if:status,Resolved|string|max:2000',
            'resolved_at' => 'nullable|date|before_or_equal:today',
        ]);

        $from = $helpRequest->status;
        $to = $data['status'];

        $allowed = [
            'Working on it' => ['Pending'],
            'Resolved' => ['Pending', 'Working on it'],
            'Closed' => ['Pending', 'Working on it', 'Resolved'],
        ][$to];

        abort_unless(in_array($from, $allowed, true), 422, "A case that is {$from} can't be moved to {$to}." . ($from === 'Closed' || $from === 'Resolved' ? ' Reopen it first.' : ''));
        abort_if($to === 'Closed' && $from !== 'Resolved' && empty(trim($data['note'] ?? '')), 422,
            'Give a reason for closing a case that was not resolved (for example, a duplicate or withdrawn request).');

        if ($to === 'Resolved') {
            $resolvedAt = Carbon::parse($data['resolved_at'] ?? now()->toDateString());
            abort_if($resolvedAt->lt($helpRequest->submitted_at), 422, 'The resolved date cannot be before the date submitted.');
        }

        DB::transaction(function () use ($helpRequest, $data, $from, $to, $request) {
            $helpRequest->status = $to;

            if ($to === 'Resolved') {
                $helpRequest->resolution = $data['resolution'];
                $helpRequest->resolved_at = $data['resolved_at'] ?? now()->toDateString();
            }

            if ($to === 'Closed') {
                $helpRequest->closed_at = now();
            }

            $helpRequest->save();

            $note = $to === 'Resolved'
                ? trim("Action taken: {$data['resolution']} " . ($data['note'] ?? ''))
                : ($data['note'] ?? null);

            $type = ['Working on it' => 'Started', 'Resolved' => 'Resolved', 'Closed' => 'Closed'][$to];
            $this->timeline($helpRequest, $request, $type, $from, $to, $note);

            $action = $to === 'Resolved' ? 'Resolved' : ($to === 'Closed' ? 'Case closed' : 'Status changed');
            ActivityLogger::record('Help Desk', $action, "Status changed from {$from} to {$to}." . ($note ? " {$note}" : ''), $helpRequest, $this->label($helpRequest),
                ['status' => ['from' => $from, 'to' => $to]]);
        });

        return response()->json($this->detail($helpRequest));
    }

    public function reopen(Request $request, HelpRequest $helpRequest): JsonResponse
    {
        abort_unless(in_array($helpRequest->status, ['Resolved', 'Closed'], true), 422, 'Only resolved or closed cases can be reopened.');

        $data = $request->validate(['note' => 'required|string|max:2000']);
        $from = $helpRequest->status;

        DB::transaction(function () use ($helpRequest, $data, $from, $request) {
            $helpRequest->update([
                'status' => 'Working on it',
                'resolution' => null,
                'resolved_at' => null,
                'closed_at' => null,
            ]);

            $this->timeline($helpRequest, $request, 'Reopened', $from, 'Working on it', $data['note']);
            ActivityLogger::record('Help Desk', 'Reopened', $data['note'], $helpRequest, $this->label($helpRequest),
                ['status' => ['from' => $from, 'to' => 'Working on it']]);
        });

        return response()->json($this->detail($helpRequest));
    }

    /** Add an action or follow-up note without changing the status. */
    public function addNote(Request $request, HelpRequest $helpRequest): JsonResponse
    {
        $data = $request->validate(['note' => 'required|string|max:2000']);

        $this->timeline($helpRequest, $request, 'Note', null, null, $data['note']);
        ActivityLogger::record('Help Desk', 'Note added', $data['note'], $helpRequest, $this->label($helpRequest));

        return response()->json($this->detail($helpRequest), 201);
    }

    private function detailRules(): array
    {
        return [
            'category' => ['required', Rule::in(HelpRequest::CATEGORIES)],
            'subject' => 'required|string|max:255',
            'description' => 'required|string|max:5000',
            'channel' => ['nullable', Rule::in(HelpRequest::CHANNELS)],
            'priority' => ['nullable', Rule::in(HelpRequest::PRIORITIES)],
            'remarks' => 'nullable|string|max:2000',
        ];
    }

    private function activeUserRule()
    {
        return Rule::exists('users', 'id')->where(fn ($q) => $q->whereNull('status')->orWhere('status', 'Active'));
    }

    private function requireNotClosed(HelpRequest $helpRequest): void
    {
        abort_if($helpRequest->status === 'Closed', 422, 'This case is closed. Reopen it before making changes.');
    }

    /** Next reference in the form HLP-2026-0001 (resets every year). */
    private function nextReference(): string
    {
        $prefix = 'HLP-' . now()->year . '-';

        $last = HelpRequest::where('reference', 'like', $prefix . '%')
            ->lockForUpdate()
            ->pluck('reference')
            ->map(fn ($reference) => (int) substr($reference, strlen($prefix)))
            ->max() ?? 0;

        return $prefix . str_pad($last + 1, 4, '0', STR_PAD_LEFT);
    }

    private function timeline(HelpRequest $helpRequest, Request $request, string $type, ?string $from, ?string $to, ?string $note): void
    {
        $helpRequest->updates()->create([
            'type' => $type,
            'from_status' => $from,
            'to_status' => $to,
            'note' => $note,
            'user_name' => $request->user()?->name,
        ]);
    }

    private function label(HelpRequest $helpRequest): string
    {
        return "{$helpRequest->reference} · {$helpRequest->senior_name}";
    }

    private function transform(HelpRequest $r): array
    {
        return [
            'id' => $r->id,
            'reference' => $r->reference,
            'source' => $r->source,
            'senior_citizen_id' => $r->senior_citizen_id,
            'senior_name' => $r->senior_name,
            'senior_record_id' => $r->seniorCitizen?->senior_id,
            'senior_purok' => $r->seniorCitizen?->purok,
            'category' => $r->category,
            'subject' => $r->subject,
            'description' => $r->description,
            'channel' => $r->channel,
            'priority' => $r->priority,
            'status' => $r->status,
            'assigned_user_id' => $r->assigned_user_id,
            'assigned_name' => $r->assignee?->name,
            'submitted_at' => $r->submitted_at?->toDateString(),
            'resolution' => $r->resolution,
            'resolved_at' => $r->resolved_at?->toDateString(),
            'days_to_resolve' => $r->daysToResolve(),
            'closed_at' => $r->closed_at?->toIso8601String(),
            'remarks' => $r->remarks,
            'created_by' => $r->created_by,
            'created_at' => $r->created_at?->toIso8601String(),
        ];
    }

    private function detail(HelpRequest $helpRequest): array
    {
        $helpRequest->refresh()->load('assignee', 'seniorCitizen', 'updates');

        $history = $helpRequest->senior_citizen_id
            ? HelpRequest::with('assignee')
                ->where('senior_citizen_id', $helpRequest->senior_citizen_id)
                ->whereKeyNot($helpRequest->id)
                ->orderByDesc('submitted_at')
                ->get()
                ->map(fn ($r) => $this->transform($r))
                ->values()
            : collect();

        return $this->transform($helpRequest) + [
            'updates' => $helpRequest->updates->map(fn ($u) => [
                'id' => $u->id,
                'type' => $u->type,
                'from_status' => $u->from_status,
                'to_status' => $u->to_status,
                'note' => $u->note,
                'user_name' => $u->user_name,
                'created_at' => $u->created_at?->toIso8601String(),
            ])->values(),
            'senior_history' => $history,
        ];
    }
}
