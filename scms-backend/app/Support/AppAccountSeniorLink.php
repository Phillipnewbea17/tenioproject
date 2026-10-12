<?php

namespace App\Support;

use App\Models\AppAccount;
use App\Models\SeniorCitizen;
use Illuminate\Support\Facades\DB;

/**
 * Finds the senior citizen record behind a senior-app account.
 *
 * The chain is account -> application -> record -> OSCA ID. Approving an
 * application creates the record (see SeniorRecordFromApplication), so the
 * account is linked to it there. Accounts whose record was created before
 * that linking existed have the record but not the link, which left the app
 * unable to see an ID the office had already issued - so when the link is
 * missing but the application points at a record, it is repaired here.
 */
class AppAccountSeniorLink
{
    /** The account's record, linking it through its application if needed. */
    public static function resolve(?AppAccount $account): ?SeniorCitizen
    {
        if (! $account) {
            return null;
        }

        if ($record = $account->seniorCitizen) {
            return $record;
        }

        $record = SeniorCitizen::whereIn(
            'application_id',
            $account->applications()->select('id')
        )->latest('id')->first();

        if (! $record) {
            return null;
        }

        return self::attach($account, $record) ? $record : null;
    }

    /**
     * Links the account to the record unless another account already owns it
     * (senior_citizen_id is unique), and approves a verification that was
     * still waiting. Returns whether the account now holds the record.
     */
    public static function attach(AppAccount $account, SeniorCitizen $record, ?string $by = null): bool
    {
        $taken = AppAccount::where('senior_citizen_id', $record->id)
            ->where('id', '!=', $account->id)
            ->exists();

        if ($taken) {
            return false;
        }

        DB::transaction(function () use ($account, $record, $by) {
            $account->senior_citizen_id = $record->id;
            $account->linked_at = $account->linked_at ?? now();
            $account->save();

            $account->identityVerifications()
                ->where('status', 'Pending')
                ->update([
                    'status' => 'Approved',
                    'senior_citizen_id' => $record->id,
                    'reviewed_at' => now(),
                    'remarks' => $by ?: 'Linked automatically when the application was approved.',
                ]);
        });

        ActivityLogger::record(
            'User Management',
            'Linked',
            "App user linked to senior record {$record->senior_id} · {$record->name}.",
            $account,
            ($account->full_name ?: $account->displayPhone()) . ' (app)',
        );

        return true;
    }
}
