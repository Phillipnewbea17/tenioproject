<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * User Management > User details can now deactivate an app account with a
 * reason, and link it to a senior citizen record. Both actions remember who
 * did it and when, so the details modal can show it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('app_accounts', function (Blueprint $table) {
            if (! Schema::hasColumn('app_accounts', 'deactivated_at')) {
                $table->timestamp('deactivated_at')->nullable()->after('status');
            }
            if (! Schema::hasColumn('app_accounts', 'deactivated_by')) {
                $table->foreignId('deactivated_by')->nullable()->after('deactivated_at')
                    ->constrained('users')->nullOnDelete();
            }
            if (! Schema::hasColumn('app_accounts', 'deactivation_reason')) {
                $table->string('deactivation_reason', 500)->nullable()->after('deactivated_by');
            }
            // linked_at is already there; this says who linked the record.
            if (! Schema::hasColumn('app_accounts', 'linked_by')) {
                $table->foreignId('linked_by')->nullable()->after('linked_at')
                    ->constrained('users')->nullOnDelete();
            }
        });
    }

    public function down(): void
    {
        Schema::table('app_accounts', function (Blueprint $table) {
            foreach (['deactivated_by', 'linked_by'] as $column) {
                if (Schema::hasColumn('app_accounts', $column)) {
                    $table->dropConstrainedForeignId($column);
                }
            }

            foreach (['deactivated_at', 'deactivation_reason'] as $column) {
                if (Schema::hasColumn('app_accounts', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
