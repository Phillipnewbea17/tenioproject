<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Collection;

/**
 * A fund for senior citizen programs. Money moves through three stages,
 * each recorded as a FundTransaction:
 *
 *   Allocation   budget assigned to a program
 *   Release      money released for use (cannot exceed what is allocated)
 *   Disbursement money actually paid out (cannot exceed what is released)
 *
 * Remaining balance = allocated − disbursed.
 * All math is done in whole centavos to avoid floating-point errors.
 */
class Fund extends Model
{
    public const CATEGORIES = [
        'Pension',
        'Medical Assistance',
        'Burial Assistance',
        'Food/Relief Assistance',
        'Other Senior Citizen Programs',
    ];

    public const STATUSES = ['Active', 'Closed'];

    protected $fillable = [
        'reference',
        'name',
        'source',
        'category',
        'fiscal_year',
        'status',
        'remarks',
        'created_by',
        'closed_at',
    ];

    protected $casts = [
        'fiscal_year' => 'integer',
        'closed_at' => 'datetime',
    ];

    public function transactions(): HasMany
    {
        return $this->hasMany(FundTransaction::class);
    }

    /**
     * Totals in centavos, overall and per program:
     * ['allocated' => int, 'released' => int, 'disbursed' => int, 'remaining' => int, 'unreleased' => int, 'on_hand' => int]
     */
    public static function totals(Collection $transactions): array
    {
        $sum = fn (string $type) => $transactions
            ->where('type', $type)
            ->whereNull('voided_at')
            ->sum(fn (FundTransaction $t) => $t->centavos());

        $allocated = $sum('Allocation');
        $released = $sum('Release');
        $disbursed = $sum('Disbursement');

        return [
            'allocated' => $allocated,
            'released' => $released,
            'disbursed' => $disbursed,
            'remaining' => $allocated - $disbursed,
            'unreleased' => $allocated - $released,
            'on_hand' => $released - $disbursed,
        ];
    }

    /** Totals per program, for programs that have any transaction. */
    public static function totalsByProgram(Collection $transactions): Collection
    {
        return $transactions->groupBy('program')
            ->map(fn ($group) => self::totals($group))
            ->sortKeys();
    }
}
