<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class FundTransaction extends Model
{
    public const TYPES = ['Allocation', 'Release', 'Disbursement'];

    protected $fillable = [
        'fund_id',
        'type',
        'program',
        'amount',
        'transaction_date',
        'reference_no',
        'recipient',
        'description',
        'recorded_by',
        'voided_at',
        'voided_by',
        'void_reason',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
        'transaction_date' => 'date:Y-m-d',
        'voided_at' => 'datetime',
    ];

    public function fund(): BelongsTo
    {
        return $this->belongsTo(Fund::class);
    }

    /** Amount in whole centavos. */
    public function centavos(): int
    {
        return (int) round(((float) $this->amount) * 100);
    }
}
