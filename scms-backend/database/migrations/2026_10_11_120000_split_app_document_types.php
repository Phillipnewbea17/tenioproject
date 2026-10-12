<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * The senior app used to send one "proofOfAge" photo for two Document
 * Verification rows (Valid ID and Birth certificate), plus free-form "other"
 * papers that had no row at all. The app now sends the same four types the
 * office checks, so old photos are moved onto the matching row.
 */
return new class extends Migration
{
    public function up(): void
    {
        // The old combined photo is a valid ID at least as often as a birth
        // certificate; staff can see it and ask for the missing one.
        DB::table('application_documents')->where('type', 'proofOfAge')->update(['type' => 'validId']);

        // "Other paper" has no row in the checklist: drop the files with it.
        $others = DB::table('application_documents')->where('type', 'other')->get();
        foreach ($others as $document) {
            Storage::disk('local')->delete($document->path);
        }
        DB::table('application_documents')->where('type', 'other')->delete();

        // Those applications were marked as having a birth certificate only
        // because the combined photo counted twice.
        DB::table('applications')
            ->where('source', 'App')
            ->whereNotIn('id', fn ($query) => $query->select('application_id')
                ->from('application_documents')
                ->whereNotNull('application_id')
                ->where('type', 'birthCertificate'))
            ->update(['birth_certificate_uploaded' => false]);
    }

    public function down(): void
    {
        DB::table('application_documents')->where('type', 'validId')->update(['type' => 'proofOfAge']);
        DB::table('application_documents')->where('type', 'birthCertificate')->update(['type' => 'proofOfAge']);
    }
};
