<?php

namespace App\Http\Controllers;

use App\Models\ActivityLog;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

/**
 * Activity Log / Audit Trail viewer. Read-only on purpose: there are no
 * routes to change or delete entries, and the model refuses both.
 */
class ActivityLogController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'search' => 'nullable|string|max:255',
            'user' => 'nullable|string|max:255',
            'module' => 'nullable|string|max:255',
            'action' => 'nullable|string|max:255',
            'from' => 'nullable|date',
            'to' => 'nullable|date|after_or_equal:from',
            'per_page' => 'nullable|integer|min:10|max:100',
        ]);

        $query = ActivityLog::query()
            ->when($data['user'] ?? null, fn ($q, $user) => $q->where('user_name', $user))
            ->when($data['module'] ?? null, fn ($q, $module) => $q->where('module', $module))
            ->when($data['action'] ?? null, fn ($q, $action) => $q->where('action', $action))
            ->when($data['from'] ?? null, fn ($q, $from) => $q->where('created_at', '>=', Carbon::parse($from)->startOfDay()))
            ->when($data['to'] ?? null, fn ($q, $to) => $q->where('created_at', '<=', Carbon::parse($to)->endOfDay()))
            ->when($data['search'] ?? null, function ($q, $search) {
                $like = '%' . addcslashes($search, '%_\\') . '%';
                $q->where(fn ($inner) => $inner
                    ->where('user_name', 'like', $like)
                    ->orWhere('record_label', 'like', $like)
                    ->orWhere('description', 'like', $like));
            })
            ->orderByDesc('created_at')
            ->orderByDesc('id');

        $page = $query->paginate($data['per_page'] ?? 25);

        return response()->json([
            'data' => collect($page->items())->map(fn (ActivityLog $log) => $this->transform($log)),
            'meta' => [
                'current_page' => $page->currentPage(),
                'last_page' => $page->lastPage(),
                'per_page' => $page->perPage(),
                'total' => $page->total(),
            ],
        ]);
    }

    public function show(ActivityLog $activityLog): JsonResponse
    {
        return response()->json($this->transform($activityLog));
    }

    /** Values for the filter dropdowns, taken from what has been logged. */
    public function options(): JsonResponse
    {
        $distinct = fn (string $column) => ActivityLog::query()
            ->whereNotNull($column)
            ->distinct()
            ->orderBy($column)
            ->pluck($column);

        return response()->json([
            'modules' => $distinct('module'),
            'actions' => $distinct('action'),
            'users' => $distinct('user_name'),
        ]);
    }

    private function transform(ActivityLog $log): array
    {
        return [
            'id' => $log->id,
            'created_at' => $log->created_at?->toIso8601String(),
            'user_name' => $log->user_name,
            'role' => $log->role,
            'module' => $log->module,
            'action' => $log->action,
            'record_type' => $log->record_type,
            'record_id' => $log->record_id,
            'record_label' => $log->record_label,
            'description' => $log->description,
            'changes' => $log->changes ?? [],
            'ip_address' => $log->ip_address,
        ];
    }
}
