<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('funds', function (Blueprint $table) {
            $table->id();

            $table->string('reference')->unique();
            $table->string('name');
            $table->string('source');
            $table->string('category');
            $table->unsignedSmallInteger('fiscal_year');
            $table->enum('status', ['Active', 'Closed'])->default('Active');
            $table->text('remarks')->nullable();
            $table->string('created_by')->nullable();
            $table->timestamp('closed_at')->nullable();

            $table->timestamps();

            $table->index(['fiscal_year', 'status']);
        });

        // Amounts live only here; fund totals are always summed from these
        // rows, so a balance can never drift from its history. Rows are never
        // edited or deleted: a mistake is voided with a reason instead.
        Schema::create('fund_transactions', function (Blueprint $table) {
            $table->id();

            $table->foreignId('fund_id')->constrained('funds')->cascadeOnDelete();
            $table->enum('type', ['Allocation', 'Release', 'Disbursement']);
            $table->string('program');
            $table->decimal('amount', 14, 2);
            $table->date('transaction_date');
            $table->string('reference_no')->nullable();
            $table->string('recipient')->nullable();
            $table->text('description')->nullable();
            $table->string('recorded_by')->nullable();

            $table->timestamp('voided_at')->nullable();
            $table->string('voided_by')->nullable();
            $table->text('void_reason')->nullable();

            $table->timestamps();

            $table->index(['fund_id', 'type']);
            $table->index('transaction_date');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fund_transactions');
        Schema::dropIfExists('funds');
    }
};
