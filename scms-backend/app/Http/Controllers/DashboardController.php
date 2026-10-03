<?php

namespace App\Http\Controllers;

use App\Models\ActivityLog;
use App\Models\Announcement;
use App\Models\Application;
use App\Models\BurialRequest;
use App\Models\Fund;
use App\Models\FundTransaction;
use App\Models\HelpRequest;
use App\Models\MedicalRequest;
use App\Models\PensionRelease;
use App\Models\SeniorCitizen;
use App\Models\SeniorId;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

/**
 * Dashboard: one summary per sidebar module, in a single request.
 * Counts only; each module's own page has the details.
 */
class DashboardController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        $today = Carbon::today();
        $statusCounts = fn (string $model) => $model::query()
            ->selectRaw('status, count(*) as total')
            ->groupBy('status')
            ->pluck('total', 'status')
            ->map(fn ($n) => (int) $n);

        $applications = $statusCounts(Application::class);
        $seniors = $statusCounts(SeniorCitizen::class);
        $seniorIds = $statusCounts(SeniorId::class);
        $help = $statusCounts(HelpRequest::class);
        $pension = $statusCounts(PensionRelease::class);
        $medical = $statusCounts(MedicalRequest::class);
        $burial = $statusCounts(BurialRequest::class);
        $users = $statusCounts(User::class);

        $withCurrentId = SeniorId::whereIn('status', ['Pending Issuance', 'Active', 'For Replacement'])
            ->distinct()
            ->pluck('senior_citizen_id');

        $fundTotals = Fund::totals(FundTransaction::query()->get());

        return response()->json([
            'applications' => [
                'total' => $applications->sum(),
                'pending' => $applications['Pending'] ?? 0,
                'verified' => $applications['Verified'] ?? 0,
                'rejected' => $applications['Rejected'] ?? 0,
                'recent' => Application::orderByDesc('submitted_at')->limit(5)->get()
                    ->map(fn ($a) => [
                        'id' => $a->id,
                        'name' => $a->name,
                        'submitted_at' => $a->submitted_at?->toIso8601String(),
                        'status' => $a->status,
                    ]),
            ],
            'users' => [
                'total' => $users->sum(),
                'active' => $users['Active'] ?? 0,
                'inactive' => $users['Inactive'] ?? 0,
                'administrators' => User::where('role', 'Administrator')->count(),
            ],
            'seniors' => [
                'total' => $seniors->sum(),
                'active' => $seniors['Active'] ?? 0,
                'needs_attention' => ($seniors['Needs follow-up'] ?? 0) + ($seniors['Needs attention'] ?? 0),
                'new_this_month' => SeniorCitizen::where('created_at', '>=', $today->copy()->startOfMonth())->count(),
            ],
            'senior_ids' => [
                'active' => $seniorIds['Active'] ?? 0,
                'pending_issuance' => $seniorIds['Pending Issuance'] ?? 0,
                'for_replacement' => $seniorIds['For Replacement'] ?? 0,
                'without_id' => SeniorCitizen::whereNotIn('status', ['Archived', 'Inactive', 'Deceased'])
                    ->whereNotIn('id', $withCurrentId)
                    ->count(),
            ],
            'announcements' => [
                'active' => Announcement::where(fn ($q) => $q->whereNull('status')->orWhere('status', 'Active'))->count(),
                'pinned' => Announcement::where('pinned', true)->latest('date')->value('title'),
                'latest' => Announcement::where(fn ($q) => $q->whereNull('status')->orWhere('status', 'Active'))
                    ->orderByDesc('date')->limit(3)->get(['id', 'title', 'date'])
                    ->map(fn ($a) => ['id' => $a->id, 'title' => $a->title, 'date' => substr((string) $a->date, 0, 10)]),
            ],
            'birthdays' => $this->birthdays($today),
            'help' => [
                'pending' => $help['Pending'] ?? 0,
                'working' => $help['Working on it'] ?? 0,
                'resolved' => ($help['Resolved'] ?? 0) + ($help['Closed'] ?? 0),
                'urgent_open' => HelpRequest::whereIn('status', ['Pending', 'Working on it'])
                    ->whereIn('priority', ['Urgent', 'High'])->count(),
                'mine_open' => HelpRequest::whereIn('status', ['Pending', 'Working on it'])
                    ->where('assigned_user_id', $request->user()->id)->count(),
            ],
            'pension' => [
                'total' => $pension->sum(),
                'released' => $pension['Released'] ?? 0,
                'pending' => $pension['Pending'] ?? 0,
                'on_hold' => $pension['On Hold'] ?? 0,
            ],
            'medical' => [
                'total' => $medical->sum(),
                'pending' => $medical['Pending'] ?? 0,
                'approved' => $medical['Approved'] ?? 0,
                'completed' => $medical['Completed'] ?? 0,
            ],
            'burial' => [
                'total' => $burial->sum(),
                'pending' => $burial['Pending'] ?? 0,
                'approved' => $burial['Approved'] ?? 0,
                'released' => $burial['Released'] ?? 0,
            ],
            'funds' => [
                'active' => Fund::where('status', 'Active')->count(),
                'allocated' => round($fundTotals['allocated'] / 100, 2),
                'disbursed' => round($fundTotals['disbursed'] / 100, 2),
                'remaining' => round($fundTotals['remaining'] / 100, 2),
            ],
            'activity' => [
                'today' => ActivityLog::where('created_at', '>=', $today)->count(),
                'logins_today' => ActivityLog::where('created_at', '>=', $today)->where('action', 'Logged in')->count(),
                'recent' => ActivityLog::orderByDesc('created_at')->orderByDesc('id')->limit(5)->get()
                    ->map(fn ($log) => [
                        'id' => $log->id,
                        'created_at' => $log->created_at?->toIso8601String(),
                        'user_name' => $log->user_name,
                        'action' => $log->action,
                        'module' => $log->module,
                        'record_label' => $log->record_label,
                    ]),
            ],
        ]);
    }

    /** Birthdays today, in the next 7 days, and the next three celebrants. */
    private function birthdays(Carbon $today): array
    {
        $upcoming = SeniorCitizen::whereNotNull('birth_date')
            ->whereNotIn('status', ['Archived', 'Deceased'])
            ->get(['id', 'name', 'birth_date'])
            ->map(function ($senior) use ($today) {
                $birth = Carbon::parse($senior->birth_date);
                $next = $birth->copy()->year($today->year);
                // Feb 29 birthdays fall on Mar 1 in other years (Carbon rolls over).
                if ($next->lt($today)) {
                    $next = $birth->copy()->year($today->year + 1);
                }

                return [
                    'id' => $senior->id,
                    'name' => $senior->name,
                    'date' => $next->toDateString(),
                    'turning' => $next->year - $birth->year,
                    'days_until' => (int) $today->diffInDays($next),
                ];
            })
            ->sortBy('days_until')
            ->values();

        return [
            'today' => $upcoming->where('days_until', 0)->count(),
            'next_7_days' => $upcoming->where('days_until', '<=', 7)->count(),
            'upcoming' => $upcoming->take(3)->values(),
        ];
    }
}
