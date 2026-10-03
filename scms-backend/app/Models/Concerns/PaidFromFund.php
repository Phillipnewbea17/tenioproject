<?php

namespace App\Models\Concerns;

use App\Models\Fund;
use App\Models\FundTransaction;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * For program records paid out of Fund Management (Pension, Medical, Burial).
 * Needs amount, fund_id and fund_transaction_id columns; see ProgramPayout.
 */
trait PaidFromFund
{
    public function initializePaidFromFund(): void
    {
        $this->mergeFillable(['amount', 'fund_id', 'fund_transaction_id']);
        $this->mergeCasts(['amount' => 'decimal:2']);
    }

    public function fund(): BelongsTo
    {
        return $this->belongsTo(Fund::class);
    }

    public function fundTransaction(): BelongsTo
    {
        return $this->belongsTo(FundTransaction::class);
    }

    /** True once the money has been paid out of a fund. */
    public function isPaidFromFund(): bool
    {
        return $this->fund_transaction_id !== null;
    }
}
