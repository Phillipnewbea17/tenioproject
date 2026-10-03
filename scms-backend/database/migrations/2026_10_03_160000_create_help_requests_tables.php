<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('help_requests', function (Blueprint $table) {
            $table->id();

            $table->string('reference')->unique();

            // The name is copied so the case still reads correctly if the
            // senior record is later deleted.
            $table->foreignId('senior_citizen_id')->nullable()->constrained('senior_citizens')->nullOnDelete();
            $table->string('senior_name');

            $table->string('category');
            $table->string('subject');
            $table->text('description');
            $table->string('channel')->nullable();
            $table->enum('priority', ['Low', 'Normal', 'High', 'Urgent'])->default('Normal');
            $table->enum('status', ['Pending', 'Working on it', 'Resolved', 'Closed'])->default('Pending');
            $table->foreignId('assigned_user_id')->nullable()->constrained('users')->nullOnDelete();

            $table->date('submitted_at');
            $table->text('resolution')->nullable();
            $table->date('resolved_at')->nullable();
            $table->timestamp('closed_at')->nullable();
            $table->text('remarks')->nullable();
            $table->string('created_by')->nullable();

            $table->timestamps();

            $table->index(['status', 'submitted_at']);
        });

        // Timeline of each case: assignments, status changes and notes.
        Schema::create('help_request_updates', function (Blueprint $table) {
            $table->id();

            $table->foreignId('help_request_id')->constrained('help_requests')->cascadeOnDelete();
            $table->string('type');
            $table->string('from_status')->nullable();
            $table->string('to_status')->nullable();
            $table->text('note')->nullable();
            $table->string('user_name')->nullable();

            $table->timestamp('created_at')->useCurrent();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('help_request_updates');
        Schema::dropIfExists('help_requests');
    }
};
