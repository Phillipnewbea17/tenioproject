<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Approving an application creates the senior's record, but the first version
 * of that did not also link the app account to it. Those accounts could not
 * see an OSCA ID the office had already issued ("Not issued yet" in My ID),
 * so the link is filled in here from account -> application -> record.
 *
 * Only accounts with no record yet are touched, and only records no other
 * account already holds (senior_citizens.senior_citizen_id is unique on
 * app_accounts), so an existing link is never moved.
 */
return new class extends Migration
{
    public function up(): void
    {
        $pairs = DB::table('senior_citizens')
            ->join('applications', 'applications.id', '=', 'senior_citizens.application_id')
            ->whereNotNull('applications.app_account_id')
            ->whereNotNull('senior_citizens.application_id')
            ->orderBy('senior_citizens.id')
            ->get([
                'senior_citizens.id as record_id',
                'applications.app_account_id as account_id',
            ]);

        $taken = DB::table('app_accounts')
            ->whereNotNull('senior_citizen_id')
            ->pluck('senior_citizen_id')
            ->all();

        foreach ($pairs as $pair) {
            if (in_array($pair->record_id, $taken, true)) {
                continue;
            }

            $linked = DB::table('app_accounts')
                ->where('id', $pair->account_id)
                ->whereNull('senior_citizen_id')
                ->update([
                    'senior_citizen_id' => $pair->record_id,
                    'linked_at' => now(),
                    'updated_at' => now(),
                ]);

            if ($linked) {
                $taken[] = $pair->record_id;

                DB::table('identity_verifications')
                    ->where('app_account_id', $pair->account_id)
                    ->where('status', 'Pending')
                    ->update([
                        'status' => 'Approved',
                        'senior_citizen_id' => $pair->record_id,
                        'reviewed_at' => now(),
                        'remarks' => 'Linked automatically when the application was approved.',
                        'updated_at' => now(),
                    ]);
            }
        }
    }

    public function down(): void
    {
        // The link is what the app needs to show an issued ID; unlinking
        // accounts again would only break My ID, so this is not reversed.
    }
};
