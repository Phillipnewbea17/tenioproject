<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Requests will come from seniors through the Flutter app ("App"); staff
     * can still record them for walk-ins ("Walk-in"). Everything recorded so
     * far was entered by staff, so existing rows become "Walk-in".
     *
     * Burial releases now record how much was given and which fund paid it.
     */
    public function up(): void
    {
        foreach (['medical_requests', 'burial_requests', 'help_requests'] as $table) {
            Schema::table($table, function (Blueprint $table) {
                $table->string('source')->default('Walk-in')->after('id');
            });
        }

        Schema::table('senior_ids', function (Blueprint $table) {
            $table->string('replacement_source')->nullable()->after('replacement_requested_at');
        });

        Schema::table('burial_requests', function (Blueprint $table) {
            $table->decimal('amount', 14, 2)->nullable()->after('status');
            $table->foreignId('fund_id')->nullable()->after('amount')->constrained('funds')->nullOnDelete();
            $table->foreignId('fund_transaction_id')->nullable()->after('fund_id')->constrained('fund_transactions')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('burial_requests', function (Blueprint $table) {
            $table->dropConstrainedForeignId('fund_transaction_id');
            $table->dropConstrainedForeignId('fund_id');
            $table->dropColumn('amount');
        });

        Schema::table('senior_ids', function (Blueprint $table) {
            $table->dropColumn('replacement_source');
        });

        foreach (['medical_requests', 'burial_requests', 'help_requests'] as $table) {
            Schema::table($table, function (Blueprint $table) {
                $table->dropColumn('source');
            });
        }
    }
};
