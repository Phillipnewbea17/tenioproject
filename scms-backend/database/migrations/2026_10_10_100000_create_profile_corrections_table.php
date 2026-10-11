<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Senior app: "Request a correction" on Personal Information. A linked
 * senior cannot edit the record's official details (name, birthday, ID
 * number...) themselves; they ask OSCA, optionally with a photo of a
 * supporting document, and staff approve or reject the request.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('profile_corrections', function (Blueprint $table) {
            $table->id();
            $table->foreignId('app_account_id')->constrained('app_accounts')->cascadeOnDelete();
            $table->foreignId('senior_citizen_id')->nullable()->constrained('senior_citizens')->nullOnDelete();
            // The app's field name: firstName, birthDate, barangay...
            $table->string('field', 30);
            $table->text('current_value')->nullable();
            $table->text('requested_value');
            $table->text('reason');
            $table->string('attachment_path')->nullable();
            // Pending, Approved, Rejected.
            $table->string('status', 20)->default('Pending');
            $table->string('reviewed_by')->nullable();
            $table->timestamp('reviewed_at')->nullable();
            // Shown to the senior in the app ("officeNote").
            $table->text('remarks')->nullable();
            $table->timestamps();

            $table->index(['status', 'created_at']);
            $table->index(['app_account_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('profile_corrections');
    }
};
