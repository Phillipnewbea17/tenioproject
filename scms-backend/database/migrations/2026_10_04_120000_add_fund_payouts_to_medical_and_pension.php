<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Medical assistance and pensions are paid out of Fund Management, like
     * burial assistance: the record stores the amount, the fund, and the
     * disbursement written to that fund.
     */
    public function up(): void
    {
        foreach (['medical_requests', 'pension_releases'] as $table) {
            Schema::table($table, function (Blueprint $table) {
                $table->decimal('amount', 14, 2)->nullable()->after('status');
                $table->foreignId('fund_id')->nullable()->after('amount')->constrained('funds')->nullOnDelete();
                $table->foreignId('fund_transaction_id')->nullable()->after('fund_id')->constrained('fund_transactions')->nullOnDelete();
            });
        }
    }

    public function down(): void
    {
        foreach (['medical_requests', 'pension_releases'] as $table) {
            Schema::table($table, function (Blueprint $table) {
                $table->dropConstrainedForeignId('fund_transaction_id');
                $table->dropConstrainedForeignId('fund_id');
                $table->dropColumn('amount');
            });
        }
    }
};
