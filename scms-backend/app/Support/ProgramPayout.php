<?php

namespace App\Support;

use App\Models\BurialRequest;
use App\Models\Fund;
use App\Models\FundTransaction;
use App\Models\MedicalRequest;
use App\Models\PensionRelease;
use Illuminate\Database\Eloquent\Model;

/**
 * Connects Pension, Medical and Burial records to Fund Management.
 *
 * When a record reaches its "paid" status it must name an amount and a fund;
 * a Disbursement is written to that fund for the program, and the record is
 * locked (status, amount, fund and payment date). Voiding the disbursement in
 * Fund Management sends the record back to its earlier status.
 *
 * Records that were marked paid before this existed have no disbursement and
 * are left as they are.
 */
class ProgramPayout
{
    /** Per record type: the fund program, statuses and payment date field. */
    public const PROGRAMS = [
        PensionRelease::class => [
            'name' => 'Pension',
            'program' => 'Pension',
            'paid' => 'Released',
            'revert' => 'Pending',
            'date' => 'release_date',
        ],
        MedicalRequest::class => [
            'name' => 'Medical',
            'program' => 'Medical Assistance',
            'paid' => 'Completed',
            'revert' => 'Approved',
            'date' => 'completed_date',
        ],
        BurialRequest::class => [
            'name' => 'Burial',
            'program' => 'Burial Assistance',
            'paid' => 'Released',
            'revert' => 'Approved',
            'date' => 'release_date',
        ],
    ];

    public static function config(Model $record): array
    {
        return self::PROGRAMS[$record::class];
    }

    /** Validation rules every program form shares. */
    public static function rules(): array
    {
        return [
            'amount' => ['nullable', 'numeric', 'min:0.01', 'max:999999999999.99', 'regex:/^\d+(\.\d{1,2})?$/'],
            'fund_id' => 'nullable|integer|exists:funds,id',
        ];
    }

    /** True when this update moves the record into its paid status. */
    public static function isPaying(Model $record, array $data): bool
    {
        $paid = self::config($record)['paid'];

        return ($data['status'] ?? $record->status) === $paid
            && ! ($record->exists && $record->getOriginal('status') === $paid);
    }

    /**
     * Once paid from a fund, the money fields must keep matching the
     * disbursement. Re-sending the same values (as forms do) is fine.
     */
    public static function guardLocked(Model $record, array $data): void
    {
        if (! $record->isPaidFromFund()) {
            return;
        }

        $config = self::config($record);
        $locked = [
            'status' => $record->status,
            'amount' => $record->amount,
            'fund_id' => $record->fund_id,
            $config['date'] => $record->{$config['date']}?->toDateString(),
        ];

        foreach ($locked as $field => $current) {
            if (! array_key_exists($field, $data)) {
                continue;
            }

            $same = $field === 'amount'
                ? FundLedger::centavos($data[$field]) === FundLedger::centavos($current)
                : (string) $data[$field] === (string) $current;

            abort_unless($same, 422, "This has already been paid from a fund. To change the status, amount, fund or date, void its disbursement in Fund Management first.");
        }
    }

    /**
     * Pay the record out of the chosen fund and mark it paid. Call inside
     * DB::transaction(), after saving the record's other details.
     */
    public static function pay(Model $record, array $data, string $recipient, string $description, ?string $recordedBy, string $label): FundTransaction
    {
        $config = self::config($record);
        $required = ['amount' => 'the amount paid', 'fund_id' => 'the fund it is paid from', $config['date'] => 'the date it was paid'];

        foreach ($required as $field => $what) {
            abort_if(empty($data[$field]), 422, "To mark this {$config['paid']}, enter {$what}.");
        }

        $fund = Fund::findOrFail($data['fund_id']);

        $transaction = FundLedger::record($fund, [
            'type' => 'Disbursement',
            'program' => $config['program'],
            'amount' => $data['amount'],
            'transaction_date' => $data[$config['date']],
            'reference_no' => $record->reference ?: "{$config['name']}-{$record->id}",
            'recipient' => $recipient,
            'description' => $description,
        ], $recordedBy);

        $record->update([
            'status' => $config['paid'],
            'amount' => $data['amount'],
            'fund_id' => $fund->id,
            'fund_transaction_id' => $transaction->id,
            $config['date'] => $data[$config['date']],
        ]);

        ActivityLogger::record('Programs', "{$config['name']} paid",
            FundLedger::peso($transaction->centavos()) . " paid from {$fund->reference} to {$recipient}.",
            $record, $label);

        return $transaction;
    }

    /** Fields that pay() sets, so controllers don't save them directly. */
    public static function paymentFields(Model $record): array
    {
        return ['status', 'amount', 'fund_id', self::config($record)['date']];
    }

    /** The voided disbursement's record goes back to its earlier status. */
    public static function reverse(FundTransaction $transaction, string $reason): void
    {
        foreach (self::PROGRAMS as $class => $config) {
            $class::where('fund_transaction_id', $transaction->id)->get()
                ->each(function (Model $record) use ($config, $reason) {
                    $record->update([
                        'status' => $config['revert'],
                        $config['date'] => null,
                        'fund_transaction_id' => null,
                    ]);

                    ActivityLogger::record('Programs', 'Payment reversed',
                        "{$config['name']} payment reversed because its fund disbursement was voided; status set back to {$config['revert']}. Reason: {$reason}",
                        $record, self::label($record));
                });
        }
    }

    /** "Burial · BUR-2026-0001 · Name" for any program record. */
    public static function label(Model $record): string
    {
        $config = self::config($record);
        $name = $record->senior_name ?? $record->name;
        $reference = $record->reference ?: $record->senior_id;

        return "{$config['name']} · {$reference} · {$name}";
    }

    /**
     * Which program record each disbursement paid, for Fund Management:
     * [transaction id => "Burial · BUR-2026-0001 · Name"].
     */
    public static function linkedRecords(array $transactionIds): array
    {
        $links = [];

        foreach (array_keys(self::PROGRAMS) as $class) {
            $class::whereIn('fund_transaction_id', $transactionIds)->get()
                ->each(function (Model $record) use (&$links) {
                    $links[$record->fund_transaction_id] = self::label($record);
                });
        }

        return $links;
    }
}
