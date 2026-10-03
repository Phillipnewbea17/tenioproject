<?php

namespace App\Http\Controllers;

use App\Models\Fund;
use App\Models\FundTransaction;
use App\Support\ActivityLogger;
use App\Support\FundLedger;
use App\Support\ProgramPayout;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Fund Management. Who can do what:
 *   any logged-in staff   view funds, record releases and disbursements
 *   administrators only   create/edit funds, allocate, void transactions, close/reopen
 */
class FundController extends Controller
{
    private const AMOUNT_RULES = ['required', 'numeric', 'min:0.01', 'max:999999999999.99', 'regex:/^\d+(\.\d{1,2})?$/'];

    /** Fund list plus the monitoring dashboard. */
    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'fiscal_year' => 'nullable|integer|min:2000|max:2100',
            'status' => ['nullable', Rule::in(Fund::STATUSES)],
            'category' => ['nullable', Rule::in(Fund::CATEGORIES)],
            'search' => 'nullable|string|max:255',
        ]);

        $funds = Fund::with('transactions')
            ->when($data['fiscal_year'] ?? null, fn ($q, $year) => $q->where('fiscal_year', $year))
            ->when($data['status'] ?? null, fn ($q, $status) => $q->where('status', $status))
            ->when($data['category'] ?? null, fn ($q, $category) => $q->where('category', $category))
            ->when($data['search'] ?? null, function ($q, $search) {
                $like = '%' . addcslashes($search, '%_\\') . '%';
                $q->where(fn ($inner) => $inner->where('name', 'like', $like)
                    ->orWhere('reference', 'like', $like)
                    ->orWhere('source', 'like', $like));
            })
            ->orderByDesc('fiscal_year')
            ->orderByDesc('id')
            ->get();

        $transactions = $funds->flatMap->transactions;
        $recent = $transactions->sortByDesc(fn ($t) => [$t->transaction_date->toDateString(), $t->id])->take(8);
        $recentLinks = ProgramPayout::linkedRecords($recent->pluck('id')->all());

        return response()->json([
            'funds' => $funds->map(fn (Fund $fund) => $this->summary($fund))->values(),
            'dashboard' => [
                'totals' => $this->pesos(Fund::totals($transactions)),
                'by_program' => $this->byProgram($transactions),
                'by_year' => $funds->groupBy('fiscal_year')
                    ->map(fn ($group, $year) => ['fiscal_year' => (int) $year, 'funds' => $group->count()]
                        + $this->pesos(Fund::totals($group->flatMap->transactions)))
                    ->sortKeysDesc()
                    ->values(),
                'recent' => $recent
                    ->map(fn ($t) => $this->transaction($t, $funds->firstWhere('id', $t->fund_id), $recentLinks))
                    ->values(),
            ],
            'years' => Fund::query()->distinct()->orderByDesc('fiscal_year')->pluck('fiscal_year'),
            'categories' => Fund::CATEGORIES,
        ]);
    }

    /**
     * Active funds that have released money for a program and not yet paid
     * it out, e.g. ?program=Burial Assistance for the Burial release form.
     */
    public function available(Request $request): JsonResponse
    {
        $data = $request->validate(['program' => ['required', Rule::in(Fund::CATEGORIES)]]);

        $funds = Fund::with('transactions')->where('status', 'Active')->orderByDesc('fiscal_year')->get()
            ->map(fn (Fund $fund) => [
                'id' => $fund->id,
                'reference' => $fund->reference,
                'name' => $fund->name,
                'fiscal_year' => $fund->fiscal_year,
                'on_hand' => round(Fund::totals($fund->transactions->where('program', $data['program']))['on_hand'] / 100, 2),
            ])
            ->filter(fn ($fund) => $fund['on_hand'] > 0)
            ->values();

        return response()->json($funds);
    }

    /**
     * Money for one program across all active funds, for the program pages:
     * totals plus the funds that can still pay out (on hand).
     */
    public function programSummary(Request $request): JsonResponse
    {
        $data = $request->validate(['program' => ['required', Rule::in(Fund::CATEGORIES)]]);

        $funds = Fund::with('transactions')->where('status', 'Active')->get();
        $transactions = $funds->flatMap->transactions->where('program', $data['program']);

        return response()->json([
            'program' => $data['program'],
            'totals' => $this->pesos(Fund::totals($transactions)),
            'funds' => $funds
                ->map(fn (Fund $fund) => ['id' => $fund->id, 'reference' => $fund->reference, 'name' => $fund->name]
                    + $this->pesos(Fund::totals($fund->transactions->where('program', $data['program']))))
                ->filter(fn ($fund) => $fund['allocated'] > 0)
                ->values(),
        ]);
    }

    public function show(Fund $fund): JsonResponse
    {
        return response()->json($this->detail($fund));
    }

    public function store(Request $request): JsonResponse
    {
        $this->requireAdministrator($request, 'Only administrators can create funds.');

        $data = $request->validate($this->fundRules() + [
            'initial_allocation' => ['nullable', ...array_slice(self::AMOUNT_RULES, 1)],
            'allocation_date' => 'nullable|required_with:initial_allocation|date|before_or_equal:today',
        ]);

        $fund = DB::transaction(function () use ($data, $request) {
            $fund = Fund::create([
                'reference' => $this->nextReference(),
                'name' => $data['name'],
                'source' => $data['source'],
                'category' => $data['category'],
                'fiscal_year' => $data['fiscal_year'],
                'remarks' => $data['remarks'] ?? null,
                'status' => 'Active',
                'created_by' => $request->user()?->name,
            ]);

            ActivityLogger::record('Funds', 'Fund created', "{$fund->category} fund from {$fund->source} for FY {$fund->fiscal_year}.", $fund, $this->label($fund));

            if (! empty($data['initial_allocation'])) {
                FundLedger::record($fund, [
                    'type' => 'Allocation',
                    'program' => $fund->category,
                    'amount' => $data['initial_allocation'],
                    'transaction_date' => $data['allocation_date'],
                    'description' => 'Initial allocation.',
                ], $request->user()?->name);
            }

            return $fund;
        });

        return response()->json($this->detail($fund), 201);
    }

    public function update(Request $request, Fund $fund): JsonResponse
    {
        $this->requireAdministrator($request, 'Only administrators can edit funds.');
        $this->requireActive($fund);

        $data = $request->validate($this->fundRules());

        $fund->update($data);
        $changes = ActivityLogger::changes($fund);

        if ($changes) {
            ActivityLogger::record('Funds', 'Fund updated', 'Updated ' . ActivityLogger::fieldList($changes) . '.', $fund, $this->label($fund), $changes);
        }

        return response()->json($this->detail($fund));
    }

    /** Allocate, release or disburse. */
    public function addTransaction(Request $request, Fund $fund): JsonResponse
    {
        $data = $request->validate([
            'type' => ['required', Rule::in(FundTransaction::TYPES)],
            'program' => ['required', Rule::in(Fund::CATEGORIES)],
            'amount' => self::AMOUNT_RULES,
            'transaction_date' => 'required|date|before_or_equal:today',
            'reference_no' => 'nullable|string|max:255',
            'recipient' => 'nullable|string|max:255',
            'description' => 'nullable|string|max:1000',
        ]);

        if ($data['type'] === 'Allocation') {
            $this->requireAdministrator($request, 'Only administrators can allocate funds.');
        }

        DB::transaction(fn () => FundLedger::record($fund, $data, $request->user()?->name));

        return response()->json($this->detail($fund), 201);
    }

    /** Cancel a mistaken transaction. It stays visible, marked as voided. */
    public function voidTransaction(Request $request, Fund $fund, FundTransaction $transaction): JsonResponse
    {
        $this->requireAdministrator($request, 'Only administrators can void transactions.');
        abort_unless((int) $transaction->fund_id === (int) $fund->id, 404);
        abort_if($transaction->voided_at !== null, 422, 'This transaction is already voided.');

        $data = $request->validate(['reason' => 'required|string|max:1000']);

        DB::transaction(function () use ($fund, $transaction, $data, $request) {
            Fund::whereKey($fund->id)->lockForUpdate()->firstOrFail();

            // Voiding must not leave more released than allocated, or more
            // disbursed than released, for that program.
            $after = Fund::totals(
                $fund->transactions()->where('program', $transaction->program)->whereKeyNot($transaction->id)->get()
            );
            abort_if($after['unreleased'] < 0 || $after['on_hand'] < 0, 422,
                $transaction->type === 'Allocation'
                    ? 'This allocation has already been released. Void the later releases first.'
                    : 'This release has already been disbursed. Void the later disbursements first.');

            $transaction->update([
                'voided_at' => now(),
                'voided_by' => $request->user()?->name,
                'void_reason' => $data['reason'],
            ]);

            ActivityLogger::record('Funds', 'Transaction voided',
                "Voided {$transaction->type} of {$this->peso($transaction->centavos())} for {$transaction->program}. Reason: {$data['reason']}",
                $fund, $this->label($fund));

            // A voided payout means the program record wasn't actually paid.
            ProgramPayout::reverse($transaction, $data['reason']);
        });

        return response()->json($this->detail($fund));
    }

    public function close(Request $request, Fund $fund): JsonResponse
    {
        $this->requireAdministrator($request, 'Only administrators can close funds.');
        $this->requireActive($fund);

        $data = $request->validate(['remarks' => 'nullable|string|max:1000']);

        $fund->update(['status' => 'Closed', 'closed_at' => now()]);

        $remaining = Fund::totals($fund->transactions)['remaining'];
        ActivityLogger::record('Funds', 'Fund closed',
            "Closed with {$this->peso($remaining)} remaining." . (empty($data['remarks']) ? '' : " {$data['remarks']}"),
            $fund, $this->label($fund));

        return response()->json($this->detail($fund));
    }

    public function reopen(Request $request, Fund $fund): JsonResponse
    {
        $this->requireAdministrator($request, 'Only administrators can reopen funds.');
        abort_unless($fund->status === 'Closed', 422, 'This fund is not closed.');

        $data = $request->validate(['remarks' => 'required|string|max:1000']);

        $fund->update(['status' => 'Active', 'closed_at' => null]);
        ActivityLogger::record('Funds', 'Fund reopened', $data['remarks'], $fund, $this->label($fund));

        return response()->json($this->detail($fund));
    }

    private function fundRules(): array
    {
        return [
            'name' => 'required|string|max:255',
            'source' => 'required|string|max:255',
            'category' => ['required', Rule::in(Fund::CATEGORIES)],
            'fiscal_year' => 'required|integer|min:2000|max:2100',
            'remarks' => 'nullable|string|max:1000',
        ];
    }

    /** Next reference in the form FND-2026-0001 (resets every year). */
    private function nextReference(): string
    {
        $prefix = 'FND-' . now()->year . '-';

        $last = Fund::where('reference', 'like', $prefix . '%')
            ->lockForUpdate()
            ->pluck('reference')
            ->map(fn ($reference) => (int) substr($reference, strlen($prefix)))
            ->max() ?? 0;

        return $prefix . str_pad($last + 1, 4, '0', STR_PAD_LEFT);
    }

    private function requireActive(Fund $fund): void
    {
        abort_if($fund->status === 'Closed', 422, 'This fund is closed. Reopen it before making changes.');
    }

    private function requireAdministrator(Request $request, string $message): void
    {
        abort_if(optional($request->user())->role !== 'Administrator', 403, $message);
    }

    private function label(Fund $fund): string
    {
        return "{$fund->reference} · {$fund->name}";
    }

    private function peso(int $centavos): string
    {
        return '₱' . number_format($centavos / 100, 2);
    }

    /** Centavo totals → peso numbers for JSON. */
    private function pesos(array $totals): array
    {
        return array_map(fn ($centavos) => round($centavos / 100, 2), $totals);
    }

    private function byProgram(Collection $transactions): Collection
    {
        return Fund::totalsByProgram($transactions)
            ->map(fn ($totals, $program) => ['program' => $program] + $this->pesos($totals))
            ->values();
    }

    private function summary(Fund $fund): array
    {
        return [
            'id' => $fund->id,
            'reference' => $fund->reference,
            'name' => $fund->name,
            'source' => $fund->source,
            'category' => $fund->category,
            'fiscal_year' => $fund->fiscal_year,
            'status' => $fund->status,
            'remarks' => $fund->remarks,
            'created_by' => $fund->created_by,
            'created_at' => $fund->created_at?->toIso8601String(),
            'closed_at' => $fund->closed_at?->toIso8601String(),
            'totals' => $this->pesos(Fund::totals($fund->transactions)),
        ];
    }

    private function detail(Fund $fund): array
    {
        $fund->load('transactions');
        $links = ProgramPayout::linkedRecords($fund->transactions->pluck('id')->all());

        return $this->summary($fund) + [
            'by_program' => $this->byProgram($fund->transactions),
            'transactions' => $fund->transactions
                ->sortByDesc(fn ($t) => [$t->transaction_date->toDateString(), $t->id])
                ->map(fn ($t) => $this->transaction($t, $fund, $links))
                ->values(),
        ];
    }

    private function transaction(FundTransaction $t, ?Fund $fund = null, array $links = []): array
    {
        return [
            'id' => $t->id,
            'fund_id' => $t->fund_id,
            'fund_reference' => $fund?->reference,
            'fund_name' => $fund?->name,
            'type' => $t->type,
            'program' => $t->program,
            'amount' => round($t->centavos() / 100, 2),
            'transaction_date' => $t->transaction_date?->toDateString(),
            'reference_no' => $t->reference_no,
            'recipient' => $t->recipient,
            'description' => $t->description,
            'recorded_by' => $t->recorded_by,
            'linked_record' => $links[$t->id] ?? null,
            'created_at' => $t->created_at?->toIso8601String(),
            'voided_at' => $t->voided_at?->toIso8601String(),
            'voided_by' => $t->voided_by,
            'void_reason' => $t->void_reason,
        ];
    }
}
