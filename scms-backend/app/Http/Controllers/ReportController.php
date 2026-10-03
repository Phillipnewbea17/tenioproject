<?php

namespace App\Http\Controllers;

use App\Models\ActivityLog;
use App\Models\Application;
use App\Models\BurialRequest;
use App\Models\Fund;
use App\Models\HelpRequest;
use App\Models\MedicalRequest;
use App\Models\PensionRelease;
use App\Models\SeniorCitizen;
use App\Models\SeniorId;
use App\Support\ActivityLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

/**
 * Reports: read-only summaries built from the records already in the system.
 *
 * Every report returns the same shape so the frontend can render any of them:
 *   summary: [{label, value, hint?}]
 *   charts:  [{id, title, type: bar|line, unit, data: [{label, value}]}]
 *   tables:  [{id, title, note?, columns: [{key, label, align?}], rows: [...]}]
 *
 * Data volumes are small (one barangay), so filtering is done on collections,
 * which keeps the logic identical on MySQL and on SQLite in tests.
 */
class ReportController extends Controller
{
    private const AGE_GROUPS = [
        [60, 64], [65, 69], [70, 74], [75, 79], [80, 84], [85, 89], [90, null],
    ];

    private const PROGRAMS = ['Pension', 'Medical', 'Burial'];

    /** Values for the filter dropdowns. */
    public function options(): JsonResponse
    {
        $puroks = SeniorCitizen::query()->pluck('purok')
            ->merge(Application::query()->pluck('purok'))
            ->filter()
            ->map(fn ($purok) => trim($purok))
            ->unique()
            ->sort(SORT_NATURAL | SORT_FLAG_CASE)
            ->values();

        return response()->json([
            'puroks' => $puroks,
            'programs' => self::PROGRAMS,
            'fund_programs' => Fund::CATEGORIES,
            'help_categories' => HelpRequest::CATEGORIES,
            'statuses' => [
                'seniors' => ['Active', 'Needs follow-up', 'Needs attention', 'Archived', 'Inactive', 'Deceased'],
                'verification' => ['Pending', 'Verified', 'Rejected'],
                'programs' => ['Pending', 'Approved', 'Released', 'Completed', 'On Hold'],
                'senior-ids' => SeniorId::STATUSES,
                'funds' => Fund::STATUSES,
                'help' => HelpRequest::STATUSES,
            ],
        ]);
    }

    /** Registration and Senior Reports. Date range = date registered. */
    public function seniors(Request $request): JsonResponse
    {
        $filters = $this->filters($request);

        $seniors = SeniorCitizen::query()->orderBy('name')->get()
            ->filter(fn ($s) => $this->inRange($s->created_at, $filters))
            ->filter(fn ($s) => $this->matchesPurok($s->purok, $filters))
            ->filter(fn ($s) => ! $filters['status'] || $s->status === $filters['status'])
            ->values();

        // Registrations still in Document Verification, same range and purok.
        $applications = Application::query()->get()
            ->filter(fn ($a) => $this->inRange($a->submitted_at, $filters))
            ->filter(fn ($a) => $this->matchesPurok($a->purok, $filters));

        $ageGroups = collect(self::AGE_GROUPS)->map(function ($group) use ($seniors) {
            [$min, $max] = $group;

            return [
                'label' => $max ? "{$min}–{$max}" : "{$min}+",
                'value' => $seniors->filter(fn ($s) => $s->age >= $min && ($max === null || $s->age <= $max))->count(),
            ];
        });

        return response()->json([
            'summary' => [
                ['label' => 'Total registered seniors', 'value' => $seniors->count()],
                ['label' => 'Active records', 'value' => $seniors->where('status', 'Active')->count()],
                ['label' => 'Verified registrations', 'value' => $applications->where('status', 'Verified')->count(), 'hint' => 'Approved in Document Verification'],
                ['label' => 'Pending registrations', 'value' => $applications->where('status', 'Pending')->count(), 'hint' => 'Waiting in Document Verification'],
            ],
            'charts' => [
                ['id' => 'by-purok', 'title' => 'Seniors by purok', 'type' => 'bar', 'unit' => 'seniors', 'data' => $this->countBy($seniors, 'purok')],
                ['id' => 'by-age', 'title' => 'Seniors by age group', 'type' => 'bar', 'unit' => 'seniors', 'data' => $ageGroups->values()],
                ['id' => 'trend', 'title' => 'Registrations over time', 'type' => 'line', 'unit' => 'registrations', 'data' => $this->trend($seniors->pluck('created_at'), $filters)],
            ],
            'tables' => [
                $this->table('by-purok-table', 'Seniors by purok', [
                    ['key' => 'purok', 'label' => 'Purok'],
                    ['key' => 'total', 'label' => 'Total', 'align' => 'right'],
                    ['key' => 'female', 'label' => 'Female', 'align' => 'right'],
                    ['key' => 'male', 'label' => 'Male', 'align' => 'right'],
                    ['key' => 'active', 'label' => 'Active', 'align' => 'right'],
                ], $seniors->groupBy(fn ($s) => $s->purok ?: 'Not recorded')->map(fn ($group, $purok) => [
                    'purok' => $purok,
                    'total' => $group->count(),
                    'female' => $group->filter(fn ($s) => strcasecmp((string) $s->gender, 'Female') === 0)->count(),
                    'male' => $group->filter(fn ($s) => strcasecmp((string) $s->gender, 'Male') === 0)->count(),
                    'active' => $group->where('status', 'Active')->count(),
                ])->sortKeys(SORT_NATURAL)->values()),
                $this->table('seniors', 'Registered seniors', [
                    ['key' => 'senior_id', 'label' => 'Record ID'],
                    ['key' => 'name', 'label' => 'Name'],
                    ['key' => 'age', 'label' => 'Age', 'align' => 'right'],
                    ['key' => 'gender', 'label' => 'Gender'],
                    ['key' => 'purok', 'label' => 'Purok'],
                    ['key' => 'status', 'label' => 'Status'],
                    ['key' => 'registered', 'label' => 'Date registered'],
                ], $seniors->map(fn ($s) => [
                    'senior_id' => $s->senior_id,
                    'name' => $s->name,
                    'age' => $s->age,
                    'gender' => $s->gender,
                    'purok' => $s->purok,
                    'status' => $s->status,
                    'registered' => $this->day($s->created_at),
                ])),
            ],
        ]);
    }

    /** Document Verification Reports. Date range = date submitted. */
    public function verification(Request $request): JsonResponse
    {
        $filters = $this->filters($request);

        $applications = Application::query()->orderByDesc('submitted_at')->get()
            ->filter(fn ($a) => $this->inRange($a->submitted_at, $filters))
            ->filter(fn ($a) => $this->matchesPurok($a->purok, $filters))
            ->filter(fn ($a) => ! $filters['status'] || $a->status === $filters['status'])
            ->values();

        $incomplete = $applications->filter(fn ($a) => ! (
            $a->valid_id_uploaded && $a->birth_certificate_uploaded
            && $a->proof_residence_uploaded && $a->photo_uploaded
        ));

        // Results by the date the decision was made.
        $decided = $applications->whereIn('status', ['Verified', 'Rejected'])
            ->map(fn ($a) => ['status' => $a->status, 'date' => $this->decisionDate($a)]);

        $resultsByDate = $decided
            ->groupBy(fn ($d) => $this->bucket($d['date'], $filters))
            ->map(fn ($group, $period) => [
                'period' => $period,
                'verified' => $group->where('status', 'Verified')->count(),
                'rejected' => $group->where('status', 'Rejected')->count(),
                'total' => $group->count(),
            ])
            ->sortKeys()
            ->values();

        return response()->json([
            'summary' => [
                ['label' => 'Applications', 'value' => $applications->count()],
                ['label' => 'Pending', 'value' => $applications->where('status', 'Pending')->count()],
                ['label' => 'Verified', 'value' => $applications->where('status', 'Verified')->count()],
                ['label' => 'Rejected / needs re-upload', 'value' => $applications->where('status', 'Rejected')->count()],
            ],
            'charts' => [
                ['id' => 'by-status', 'title' => 'Applications by status', 'type' => 'bar', 'unit' => 'applications', 'data' => collect(['Pending', 'Verified', 'Rejected'])->map(fn ($status) => [
                    'label' => $status,
                    'value' => $applications->where('status', $status)->count(),
                ])],
                ['id' => 'submissions', 'title' => 'Applications submitted over time', 'type' => 'line', 'unit' => 'applications', 'data' => $this->trend($applications->pluck('submitted_at'), $filters)],
            ],
            'tables' => [
                $this->table('results-by-date', 'Verification results by date', [
                    ['key' => 'period', 'label' => 'Period'],
                    ['key' => 'verified', 'label' => 'Verified', 'align' => 'right'],
                    ['key' => 'rejected', 'label' => 'Rejected', 'align' => 'right'],
                    ['key' => 'total', 'label' => 'Total decided', 'align' => 'right'],
                ], $resultsByDate, 'Grouped by the date of the latest decision in each application’s history.'),
                $this->table('documents', 'Document completeness', [
                    ['key' => 'document', 'label' => 'Document'],
                    ['key' => 'uploaded', 'label' => 'Uploaded', 'align' => 'right'],
                    ['key' => 'missing', 'label' => 'Missing', 'align' => 'right'],
                ], collect([
                    'valid_id_uploaded' => 'Valid ID',
                    'birth_certificate_uploaded' => 'Birth certificate',
                    'proof_residence_uploaded' => 'Proof of residence',
                    'photo_uploaded' => 'Photo',
                ])->map(fn ($label, $field) => [
                    'document' => $label,
                    'uploaded' => $applications->filter(fn ($a) => $a->{$field})->count(),
                    'missing' => $applications->reject(fn ($a) => $a->{$field})->count(),
                ])->values(), "{$incomplete->count()} of {$applications->count()} applications are missing at least one document."),
                $this->table('applications', 'Applications', [
                    ['key' => 'application_id', 'label' => 'Application ID'],
                    ['key' => 'name', 'label' => 'Name'],
                    ['key' => 'purok', 'label' => 'Purok'],
                    ['key' => 'submitted', 'label' => 'Submitted'],
                    ['key' => 'status', 'label' => 'Status'],
                    ['key' => 'decided', 'label' => 'Decision date'],
                ], $applications->map(fn ($a) => [
                    'application_id' => $a->application_id,
                    'name' => $a->name,
                    'purok' => $a->purok,
                    'submitted' => $this->day($a->submitted_at),
                    'status' => $a->status,
                    'decided' => in_array($a->status, ['Verified', 'Rejected'], true)
                        ? $this->day($this->decisionDate($a))
                        : '',
                ])),
                $this->staffActivity($filters),
            ],
        ]);
    }

    /**
     * Verification Activity by Staff, from the Activity Log. Decisions made
     * before the Activity Log existed have no staff name, so they aren't counted.
     */
    private function staffActivity(array $filters): array
    {
        $decisions = ActivityLog::query()
            ->where('module', 'Document Verification')
            ->whereIn('action', ['Document approved', 'Document rejected'])
            ->when($filters['from'], fn ($q, $from) => $q->where('created_at', '>=', $from))
            ->when($filters['to'], fn ($q, $to) => $q->where('created_at', '<=', $to))
            ->get();

        $rows = $decisions->groupBy(fn ($log) => $log->user_name ?: 'Unknown')
            ->map(fn ($group, $staff) => [
                'staff' => $staff,
                'approved' => $group->where('action', 'Document approved')->count(),
                'rejected' => $group->where('action', 'Document rejected')->count(),
                'total' => $group->count(),
                'last' => $this->day($group->max('created_at')),
            ])
            ->sortByDesc('total')
            ->values();

        return $this->table('staff-activity', 'Verification activity by staff', [
            ['key' => 'staff', 'label' => 'Staff'],
            ['key' => 'approved', 'label' => 'Approved', 'align' => 'right'],
            ['key' => 'rejected', 'label' => 'Rejected', 'align' => 'right'],
            ['key' => 'total', 'label' => 'Total decisions', 'align' => 'right'],
            ['key' => 'last', 'label' => 'Last decision'],
        ], $rows, 'From the Activity Log. Decisions made before the Activity Log was added are not included. Purok and status filters do not apply.');
    }

    /** Record in the Activity Log that a report was printed or exported. */
    public function log(Request $request): JsonResponse
    {
        $data = $request->validate([
            'type' => 'required|string|max:50',
            'title' => 'required|string|max:255',
            'format' => 'required|in:Print,CSV',
            'filters' => 'nullable|string|max:500',
        ]);

        ActivityLogger::record(
            'Reports',
            'Report generated',
            "{$data['format']}: {$data['title']}" . (empty($data['filters']) ? '' : " ({$data['filters']})"),
            label: $data['title'],
        );

        return response()->json(['message' => 'Logged.'], 201);
    }

    /** Program Reports (Pension, Medical, Burial). Date range = request/release date. */
    public function programs(Request $request): JsonResponse
    {
        $filters = $this->filters($request);
        $program = in_array($request->query('program'), self::PROGRAMS, true) ? $request->query('program') : null;

        $records = $this->programRecords()
            ->filter(fn ($r) => ! $program || $r['program'] === $program)
            ->filter(fn ($r) => $this->inRange($r['date'], $filters))
            ->filter(fn ($r) => $this->matchesPurok($r['purok'], $filters))
            ->filter(fn ($r) => ! $filters['status'] || $r['status'] === $filters['status'])
            ->sortByDesc(fn ($r) => $r['date']?->timestamp ?? 0)
            ->values();

        $beneficiaryKey = fn ($r) => $r['senior_id'] ?: mb_strtolower(trim($r['senior_name']));
        $done = fn ($r) => in_array($r['status'], ['Released', 'Completed'], true);

        $programs = $program ? [$program] : self::PROGRAMS;

        $summaryRows = collect($programs)->map(function ($name) use ($records, $beneficiaryKey, $done) {
            $group = $records->where('program', $name);

            return [
                'program' => $name,
                'records' => $group->count(),
                'beneficiaries' => $group->map($beneficiaryKey)->unique()->count(),
                'pending' => $group->where('status', 'Pending')->count(),
                'approved' => $group->where('status', 'Approved')->count(),
                'released' => $group->filter($done)->count(),
                'on_hold' => $group->where('status', 'On Hold')->count(),
                'paid' => round($group->sum('paid') / 100, 2),
            ];
        });

        $byPurok = $records->groupBy(fn ($r) => $r['purok'] ?: 'Not recorded')
            ->map(fn ($group, $purok) => ['purok' => $purok] + collect($programs)->mapWithKeys(fn ($name) => [
                strtolower($name) => $group->where('program', $name)->map($beneficiaryKey)->unique()->count(),
            ])->all() + ['total' => $group->map($beneficiaryKey)->unique()->count()])
            ->sortKeys(SORT_NATURAL)
            ->values();

        return response()->json([
            'summary' => [
                ['label' => 'Assistance records', 'value' => $records->count()],
                ['label' => 'Unique beneficiaries', 'value' => $records->map($beneficiaryKey)->unique()->count()],
                ['label' => 'Released / completed', 'value' => $records->filter($done)->count()],
                ['label' => 'Pending or on hold', 'value' => $records->whereIn('status', ['Pending', 'On Hold'])->count()],
                ['label' => 'Paid from funds', 'value' => round($records->sum('paid') / 100, 2), 'format' => 'currency', 'hint' => 'Disbursements recorded in Fund Management'],
            ],
            'charts' => [
                ['id' => 'beneficiaries', 'title' => 'Beneficiaries per program', 'type' => 'bar', 'unit' => 'beneficiaries', 'data' => $summaryRows->map(fn ($row) => ['label' => $row['program'], 'value' => $row['beneficiaries']])],
                ['id' => 'by-purok', 'title' => 'Program participation by purok', 'type' => 'bar', 'unit' => 'beneficiaries', 'data' => $byPurok->map(fn ($row) => ['label' => $row['purok'], 'value' => $row['total']])],
                ['id' => 'trend', 'title' => 'Assistance records over time', 'type' => 'line', 'unit' => 'records', 'data' => $this->trend($records->pluck('date'), $filters)],
            ],
            'tables' => [
                $this->table('program-status', 'Program status summary', [
                    ['key' => 'program', 'label' => 'Program'],
                    ['key' => 'records', 'label' => 'Records', 'align' => 'right'],
                    ['key' => 'beneficiaries', 'label' => 'Beneficiaries', 'align' => 'right'],
                    ['key' => 'pending', 'label' => 'Pending', 'align' => 'right'],
                    ['key' => 'approved', 'label' => 'Approved', 'align' => 'right'],
                    ['key' => 'released', 'label' => 'Released / completed', 'align' => 'right'],
                    ['key' => 'on_hold', 'label' => 'On hold', 'align' => 'right'],
                    ['key' => 'paid', 'label' => 'Paid from funds', 'align' => 'right', 'format' => 'currency'],
                ], $summaryRows),
                $this->table('participation', 'Participation by purok', array_merge(
                    [['key' => 'purok', 'label' => 'Purok']],
                    collect($programs)->map(fn ($name) => ['key' => strtolower($name), 'label' => $name, 'align' => 'right'])->all(),
                    [['key' => 'total', 'label' => 'Unique beneficiaries', 'align' => 'right']],
                ), $byPurok, 'Counts unique seniors; a senior in two programs counts once in the total.'),
                $this->table('history', 'Assistance / benefit distribution history', [
                    ['key' => 'date', 'label' => 'Date'],
                    ['key' => 'program', 'label' => 'Program'],
                    ['key' => 'reference', 'label' => 'Reference'],
                    ['key' => 'senior_name', 'label' => 'Senior'],
                    ['key' => 'purok', 'label' => 'Purok'],
                    ['key' => 'detail', 'label' => 'Details'],
                    ['key' => 'status', 'label' => 'Status'],
                ], $records->map(fn ($r) => [
                    'date' => $this->day($r['date']),
                    'program' => $r['program'],
                    'reference' => $r['reference'],
                    'senior_name' => $r['senior_name'],
                    'purok' => $r['purok'],
                    'detail' => $r['detail'],
                    'status' => $r['status'],
                ])),
            ],
        ]);
    }

    /** Senior ID Reports. Date range = date the ID record was created. */
    public function seniorIds(Request $request): JsonResponse
    {
        $filters = $this->filters($request);

        $ids = SeniorId::with('seniorCitizen', 'replacedBy')->latest('id')->get()
            ->filter(fn ($id) => $this->inRange($id->created_at, $filters))
            ->filter(fn ($id) => $this->matchesPurok($id->seniorCitizen?->purok, $filters))
            ->filter(fn ($id) => ! $filters['status'] || $id->status === $filters['status'])
            ->values();

        $replaced = $ids->filter(fn ($id) => $id->replacement_reason);

        return response()->json([
            'summary' => collect(SeniorId::STATUSES)->map(fn ($status) => [
                'label' => $status,
                'value' => $ids->where('status', $status)->count(),
            ])->values(),
            'charts' => [
                ['id' => 'issued', 'title' => 'IDs issued over time', 'type' => 'line', 'unit' => 'IDs', 'data' => $this->trend($ids->pluck('created_at'), $filters)],
                ['id' => 'reasons', 'title' => 'Replacements by reason', 'type' => 'bar', 'unit' => 'replacements', 'data' => collect(SeniorId::REPLACEMENT_REASONS)->map(fn ($reason) => [
                    'label' => $reason,
                    'value' => $replaced->where('replacement_reason', $reason)->count(),
                ])],
            ],
            'tables' => [
                $this->table('ids', 'OSCA IDs', [
                    ['key' => 'id_number', 'label' => 'ID number'],
                    ['key' => 'name', 'label' => 'Senior'],
                    ['key' => 'purok', 'label' => 'Purok'],
                    ['key' => 'date_issued', 'label' => 'Date issued'],
                    ['key' => 'status', 'label' => 'Status'],
                    ['key' => 'replacement', 'label' => 'Replacement'],
                ], $ids->map(fn ($id) => [
                    'id_number' => $id->id_number,
                    'name' => $id->seniorCitizen?->name,
                    'purok' => $id->seniorCitizen?->purok,
                    'date_issued' => $this->day($id->date_issued),
                    'status' => $id->status,
                    'replacement' => $id->replacement_reason
                        ? $id->replacement_reason . ($id->replacedBy?->id_number ? " → {$id->replacedBy->id_number}" : '')
                        : '',
                ])),
            ],
        ]);
    }

    /**
     * Fund and Financial Reports. Date range = transaction date; status =
     * fund status; program = the program a transaction belongs to.
     * Amounts are pesos; voided transactions are excluded.
     */
    public function funds(Request $request): JsonResponse
    {
        $filters = $this->filters($request);
        $program = in_array($request->query('program'), Fund::CATEGORIES, true) ? $request->query('program') : null;

        $funds = Fund::with('transactions')
            ->when($filters['status'], fn ($q, $status) => $q->where('status', $status))
            ->get()
            ->keyBy('id');

        $transactions = $funds->flatMap->transactions
            ->whereNull('voided_at')
            ->filter(fn ($t) => ! $program || $t->program === $program)
            ->filter(fn ($t) => $this->inRange($t->transaction_date, $filters))
            ->sortByDesc(fn ($t) => [$t->transaction_date->toDateString(), $t->id])
            ->values();

        $pesos = fn (array $totals) => array_map(fn ($centavos) => round($centavos / 100, 2), $totals);
        $totals = $pesos(Fund::totals($transactions));
        $money = fn (string $key, string $label) => ['key' => $key, 'label' => $label, 'align' => 'right', 'format' => 'currency'];
        $moneyColumns = [
            $money('allocated', 'Allocated'),
            $money('released', 'Released'),
            $money('disbursed', 'Disbursed'),
            $money('remaining', 'Remaining'),
        ];

        $byProgram = Fund::totalsByProgram($transactions)
            ->map(fn ($t, $name) => ['program' => $name] + $pesos($t))
            ->values();

        // Disbursed pesos per period, with empty periods filled in.
        $disbursements = $transactions->where('type', 'Disbursement');
        $spentByPeriod = $disbursements
            ->groupBy(fn ($t) => $this->bucket($t->transaction_date, $filters))
            ->map(fn ($group) => $group->sum(fn ($t) => $t->centavos()));
        $spending = $this->trend($disbursements->pluck('transaction_date'), $filters)
            ->map(fn ($point) => ['label' => $point['label'], 'value' => round(($spentByPeriod[$point['label']] ?? 0) / 100, 2)]);

        return response()->json([
            'summary' => [
                ['label' => 'Funds allocated', 'value' => $totals['allocated'], 'format' => 'currency'],
                ['label' => 'Funds released', 'value' => $totals['released'], 'format' => 'currency'],
                ['label' => 'Funds used / disbursed', 'value' => $totals['disbursed'], 'format' => 'currency'],
                ['label' => 'Remaining balance', 'value' => $totals['remaining'], 'format' => 'currency', 'hint' => 'Allocated minus disbursed'],
            ],
            'charts' => [
                ['id' => 'allocated-by-program', 'title' => 'Allocated by program', 'type' => 'bar', 'unit' => 'pesos', 'format' => 'currency', 'data' => $byProgram->map(fn ($row) => ['label' => $row['program'], 'value' => $row['allocated']])],
                ['id' => 'spending', 'title' => 'Disbursements over time', 'type' => 'line', 'unit' => 'pesos', 'format' => 'currency', 'data' => $spending],
            ],
            'tables' => [
                $this->table('by-program', 'Fund summary by program', array_merge([['key' => 'program', 'label' => 'Program']], $moneyColumns), $byProgram),
                $this->table('by-year', 'Fund summary by fiscal year', array_merge([['key' => 'fiscal_year', 'label' => 'Fiscal year']], $moneyColumns),
                    $transactions->groupBy(fn ($t) => $funds[$t->fund_id]->fiscal_year)
                        ->map(fn ($group, $year) => ['fiscal_year' => (string) $year] + $pesos(Fund::totals($group)))
                        ->sortKeysDesc()
                        ->values()),
                $this->table('by-fund', 'Fund summary by fund', array_merge([
                    ['key' => 'reference', 'label' => 'Reference'],
                    ['key' => 'name', 'label' => 'Fund'],
                    ['key' => 'source', 'label' => 'Source'],
                    ['key' => 'status', 'label' => 'Status'],
                ], $moneyColumns), $transactions->groupBy('fund_id')
                    ->map(fn ($group, $fundId) => [
                        'reference' => $funds[$fundId]->reference,
                        'name' => $funds[$fundId]->name,
                        'source' => $funds[$fundId]->source,
                        'status' => $funds[$fundId]->status,
                    ] + $pesos(Fund::totals($group)))
                    ->sortBy('reference')
                    ->values()),
                $this->table('transactions', 'Fund transactions by date', [
                    ['key' => 'date', 'label' => 'Date'],
                    ['key' => 'fund', 'label' => 'Fund'],
                    ['key' => 'type', 'label' => 'Type'],
                    ['key' => 'program', 'label' => 'Program'],
                    ['key' => 'recipient', 'label' => 'Recipient'],
                    ['key' => 'reference_no', 'label' => 'Ref. no.'],
                    $money('amount', 'Amount'),
                    ['key' => 'recorded_by', 'label' => 'Recorded by'],
                ], $transactions->map(fn ($t) => [
                    'date' => $t->transaction_date->toDateString(),
                    'fund' => $funds[$t->fund_id]->reference,
                    'type' => $t->type,
                    'program' => $t->program,
                    'recipient' => $t->recipient,
                    'reference_no' => $t->reference_no,
                    'amount' => round($t->centavos() / 100, 2),
                    'recorded_by' => $t->recorded_by,
                ]), 'Amounts count only transactions dated within the selected period. Voided transactions are excluded.'),
            ],
        ]);
    }

    /**
     * Help and Complaint Reports. Date range = date submitted; purok = the
     * senior's purok; category filter via ?category=.
     */
    public function help(Request $request): JsonResponse
    {
        $filters = $this->filters($request);
        $category = in_array($request->query('category'), HelpRequest::CATEGORIES, true) ? $request->query('category') : null;

        $cases = HelpRequest::with('seniorCitizen', 'assignee')->orderByDesc('submitted_at')->orderByDesc('id')->get()
            ->filter(fn ($r) => $this->inRange($r->submitted_at, $filters))
            ->filter(fn ($r) => $this->matchesPurok($r->seniorCitizen?->purok, $filters))
            ->filter(fn ($r) => ! $filters['status'] || $r->status === $filters['status'])
            ->filter(fn ($r) => ! $category || $r->category === $category)
            ->values();

        $average = function ($group) {
            $days = $group->map(fn ($r) => $r->daysToResolve())->filter(fn ($d) => $d !== null);

            return $days->isEmpty() ? '' : round($days->avg(), 1);
        };

        $countsBy = fn ($group) => [
            'total' => $group->count(),
            'pending' => $group->where('status', 'Pending')->count(),
            'working' => $group->where('status', 'Working on it')->count(),
            'resolved' => $group->where('status', 'Resolved')->count(),
            'closed' => $group->where('status', 'Closed')->count(),
            'avg_days' => $average($group),
        ];

        $statusColumns = [
            ['key' => 'total', 'label' => 'Total', 'align' => 'right'],
            ['key' => 'pending', 'label' => 'Pending', 'align' => 'right'],
            ['key' => 'working', 'label' => 'Working on it', 'align' => 'right'],
            ['key' => 'resolved', 'label' => 'Fixed / resolved', 'align' => 'right'],
            ['key' => 'closed', 'label' => 'Closed', 'align' => 'right'],
            ['key' => 'avg_days', 'label' => 'Avg. days to resolve', 'align' => 'right'],
        ];

        $overallAverage = $average($cases);

        return response()->json([
            'summary' => [
                ['label' => 'Total requests / complaints', 'value' => $cases->count()],
                ['label' => 'Pending', 'value' => $cases->where('status', 'Pending')->count()],
                ['label' => 'Working on it', 'value' => $cases->where('status', 'Working on it')->count()],
                ['label' => 'Fixed / resolved', 'value' => $cases->whereIn('status', ['Resolved', 'Closed'])->whereNotNull('resolved_at')->count(), 'hint' => 'Includes resolved cases that were later closed'],
                ['label' => 'Avg. days to resolve', 'value' => $overallAverage === '' ? 0 : $overallAverage, 'format' => 'decimal', 'hint' => $overallAverage === '' ? 'No resolved cases yet' : 'From date submitted to date resolved'],
            ],
            'charts' => [
                ['id' => 'by-category', 'title' => 'Requests by category', 'type' => 'bar', 'unit' => 'requests', 'data' => collect(HelpRequest::CATEGORIES)
                    ->map(fn ($name) => ['label' => $name, 'value' => $cases->where('category', $name)->count()])
                    ->filter(fn ($point) => $point['value'] > 0)
                    ->values()],
                ['id' => 'by-date', 'title' => 'Requests submitted over time', 'type' => 'line', 'unit' => 'requests', 'data' => $this->trend($cases->pluck('submitted_at'), $filters)],
            ],
            'tables' => [
                $this->table('help-by-category', 'Requests by category', array_merge([['key' => 'category', 'label' => 'Category']], $statusColumns),
                    $cases->groupBy('category')->map(fn ($group, $name) => ['category' => $name] + $countsBy($group))->sortKeys()->values()),
                $this->table('help-by-staff', 'Requests by assigned staff', array_merge([['key' => 'staff', 'label' => 'Assigned staff']], $statusColumns),
                    $cases->groupBy(fn ($r) => $r->assignee?->name ?? 'Unassigned')->map(fn ($group, $name) => ['staff' => $name] + $countsBy($group))->sortKeys()->values()),
                $this->table('help-by-date', 'Requests by date', [
                    ['key' => 'period', 'label' => 'Period'],
                    ['key' => 'total', 'label' => 'Submitted', 'align' => 'right'],
                    ['key' => 'resolved', 'label' => 'Resolved since', 'align' => 'right'],
                ], $cases->groupBy(fn ($r) => $this->bucket($r->submitted_at, $filters))
                    ->map(fn ($group, $period) => [
                        'period' => $period,
                        'total' => $group->count(),
                        'resolved' => $group->whereNotNull('resolved_at')->count(),
                    ])->sortKeys()->values()),
                $this->table('help-cases', 'Requests and complaints', [
                    ['key' => 'reference', 'label' => 'Reference'],
                    ['key' => 'submitted', 'label' => 'Submitted'],
                    ['key' => 'senior', 'label' => 'Senior'],
                    ['key' => 'category', 'label' => 'Category'],
                    ['key' => 'subject', 'label' => 'Subject'],
                    ['key' => 'priority', 'label' => 'Priority'],
                    ['key' => 'assigned', 'label' => 'Assigned to'],
                    ['key' => 'status', 'label' => 'Status'],
                    ['key' => 'resolved', 'label' => 'Resolved'],
                    ['key' => 'days', 'label' => 'Days', 'align' => 'right'],
                ], $cases->map(fn ($r) => [
                    'reference' => $r->reference,
                    'submitted' => $this->day($r->submitted_at),
                    'senior' => $r->senior_name,
                    'category' => $r->category,
                    'subject' => $r->subject,
                    'priority' => $r->priority,
                    'assigned' => $r->assignee?->name ?? 'Unassigned',
                    'status' => $r->status,
                    'resolved' => $this->day($r->resolved_at),
                    'days' => $r->daysToResolve(),
                ])),
            ],
        ]);
    }

    /** Pension, Medical and Burial rows in one shape. */
    private function programRecords(): Collection
    {
        // Pension releases don't store a purok; take it from the senior record.
        $puroks = SeniorCitizen::query()->pluck('purok', 'senior_id');

        $pension = PensionRelease::query()->get()->map(fn ($r) => [
            'program' => 'Pension',
            'reference' => $r->reference ?: "PEN-{$r->id}",
            'senior_id' => $r->senior_id,
            'senior_name' => $r->name,
            'purok' => $puroks[$r->senior_id] ?? null,
            'date' => $this->date($r->release_date ?? $r->created_at),
            'status' => $r->status,
            'detail' => $r->period,
            'paid' => $r->fund_transaction_id ? (int) round(((float) $r->amount) * 100) : 0,
        ]);

        $medical = MedicalRequest::query()->get()->map(fn ($r) => [
            'program' => 'Medical',
            'reference' => $r->reference,
            'senior_id' => $r->senior_id,
            'senior_name' => $r->senior_name,
            'purok' => $r->purok,
            'date' => $this->date($r->request_date ?? $r->created_at),
            'status' => $r->status,
            'detail' => $r->assistance_type,
            'paid' => $r->fund_transaction_id ? (int) round(((float) $r->amount) * 100) : 0,
        ]);

        $burial = BurialRequest::query()->get()->map(fn ($r) => [
            'program' => 'Burial',
            'reference' => $r->reference,
            'senior_id' => $r->senior_id,
            'senior_name' => $r->senior_name,
            'purok' => $r->purok,
            'date' => $this->date($r->request_date ?? $r->created_at),
            'status' => $r->status,
            'detail' => $r->claimant_name ? "Claimant: {$r->claimant_name}" : '',
            'paid' => $r->fund_transaction_id ? (int) round(((float) $r->amount) * 100) : 0,
        ]);

        return $pension->concat($medical)->concat($burial);
    }

    private function filters(Request $request): array
    {
        $request->validate([
            'from' => 'nullable|date',
            'to' => 'nullable|date|after_or_equal:from',
            'purok' => 'nullable|string|max:255',
            'status' => 'nullable|string|max:255',
        ]);

        return [
            'from' => $request->filled('from') ? Carbon::parse($request->query('from'))->startOfDay() : null,
            'to' => $request->filled('to') ? Carbon::parse($request->query('to'))->endOfDay() : null,
            'purok' => $request->filled('purok') ? trim($request->query('purok')) : null,
            'status' => $request->filled('status') ? $request->query('status') : null,
        ];
    }

    private function inRange($value, array $filters): bool
    {
        if (! $filters['from'] && ! $filters['to']) {
            return true;
        }

        $date = $this->date($value);

        return $date
            && (! $filters['from'] || $date->gte($filters['from']))
            && (! $filters['to'] || $date->lte($filters['to']));
    }

    private function matchesPurok(?string $purok, array $filters): bool
    {
        return ! $filters['purok'] || strcasecmp(trim((string) $purok), $filters['purok']) === 0;
    }

    private function date($value): ?Carbon
    {
        if (! $value) {
            return null;
        }

        try {
            return $value instanceof Carbon ? $value : Carbon::parse($value);
        } catch (\Throwable) {
            return null;
        }
    }

    private function day($value): string
    {
        return $this->date($value)?->toDateString() ?? '';
    }

    /**
     * The latest "Marked as …" entry in the application's history. The
     * browser writes these as e.g. "October 3, 2026 · 2:15 PM"; fall back to
     * updated_at when there is none.
     */
    private function decisionDate(Application $application): ?Carbon
    {
        $entry = collect($application->history ?? [])
            ->reverse()
            ->first(fn ($e) => is_array($e) && str_starts_with((string) ($e['action'] ?? ''), 'Marked as'));

        $parsed = $entry ? $this->date(str_replace(' · ', ' ', (string) ($entry['date'] ?? ''))) : null;

        return $parsed ?? $this->date($application->updated_at);
    }

    /** Group by day for ranges up to two months, otherwise by month. */
    private function bucket(?Carbon $date, array $filters): string
    {
        if (! $date) {
            return 'Not recorded';
        }

        return $this->byDay($filters) ? $date->toDateString() : $date->format('Y-m');
    }

    private function byDay(array $filters): bool
    {
        return $filters['from'] && $filters['to'] && $filters['from']->diffInDays($filters['to']) <= 62;
    }

    /** Counts per period, with empty periods filled in so the line is honest. */
    private function trend(Collection $dates, array $filters): Collection
    {
        $dates = $dates->map(fn ($d) => $this->date($d))->filter()->values();

        if ($dates->isEmpty() && ! ($filters['from'] && $filters['to'])) {
            return collect();
        }

        $byDay = $this->byDay($filters);
        $start = ($filters['from'] ?? $dates->min())->copy();
        $end = ($filters['to'] ?? $dates->max())->copy();
        $start = $byDay ? $start->startOfDay() : $start->startOfMonth();

        $counts = $dates->countBy(fn ($d) => $byDay ? $d->toDateString() : $d->format('Y-m'));
        $points = collect();

        for ($cursor = $start; $cursor->lte($end) && $points->count() < 400; $byDay ? $cursor->addDay() : $cursor->addMonth()) {
            $key = $byDay ? $cursor->toDateString() : $cursor->format('Y-m');
            $points->push(['label' => $key, 'value' => $counts[$key] ?? 0]);
        }

        return $points;
    }

    private function countBy(Collection $rows, string $field): Collection
    {
        return $rows->countBy(fn ($row) => $row->{$field} ?: 'Not recorded')
            ->sortKeys(SORT_NATURAL)
            ->map(fn ($count, $label) => ['label' => (string) $label, 'value' => $count])
            ->values();
    }

    private function table(string $id, string $title, array $columns, $rows, ?string $note = null): array
    {
        return array_filter([
            'id' => $id,
            'title' => $title,
            'note' => $note,
            'columns' => $columns,
            'rows' => collect($rows)->values(),
        ], fn ($value) => $value !== null);
    }
}
