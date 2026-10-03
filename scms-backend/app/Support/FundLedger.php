<?php

namespace App\Support;

use App\Models\Fund;
use App\Models\FundTransaction;

/**
 * Writes fund transactions with the balance rules. Used by Fund Management
 * and by modules that pay out money (Burial releases).
 *
 * Call inside DB::transaction(); the fund row is locked so two people can't
 * overspend it at the same time.
 */
class FundLedger
{
    /**
     * $data: type, program, amount, transaction_date, and optionally
     * reference_no, recipient, description.
     */
    public static function record(Fund $fund, array $data, ?string $recordedBy): FundTransaction
    {
        $locked = Fund::whereKey($fund->id)->lockForUpdate()->firstOrFail();

        abort_if($locked->status === 'Closed', 422, "Fund {$locked->reference} is closed. Reopen it before recording transactions.");

        if ($data['type'] !== 'Allocation') {
            $program = Fund::totals($locked->transactions()->where('program', $data['program'])->get());
            $amount = self::centavos($data['amount']);
            $available = $data['type'] === 'Release' ? $program['unreleased'] : $program['on_hand'];

            abort_if($amount > $available, 422, $data['type'] === 'Release'
                ? 'Only ' . self::peso($available) . " is allocated to {$data['program']} and not yet released in this fund."
                : 'Only ' . self::peso($available) . " has been released for {$data['program']} and not yet disbursed in this fund.");
        }

        $transaction = $locked->transactions()->create($data + ['recorded_by' => $recordedBy]);

        $verb = ['Allocation' => 'Funds allocated', 'Release' => 'Funds released', 'Disbursement' => 'Funds disbursed'][$transaction->type];
        $to = $transaction->recipient ? " to {$transaction->recipient}" : '';

        ActivityLogger::record('Funds', $verb,
            self::peso($transaction->centavos()) . " for {$transaction->program}{$to}." .
                ($transaction->reference_no ? " Ref: {$transaction->reference_no}." : ''),
            $locked, "{$locked->reference} · {$locked->name}");

        return $transaction;
    }

    /** Money still released and not yet paid out, per program, in centavos. */
    public static function onHand(Fund $fund, string $program): int
    {
        return Fund::totals($fund->transactions()->where('program', $program)->get())['on_hand'];
    }

    public static function centavos($amount): int
    {
        return (int) round(((float) $amount) * 100);
    }

    public static function peso(int $centavos): string
    {
        return '₱' . number_format($centavos / 100, 2);
    }
}
