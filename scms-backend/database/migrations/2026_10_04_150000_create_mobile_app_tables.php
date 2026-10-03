<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Tables for the senior mobile app (Flutter, my_senior_app).
 *
 * app_accounts are separate from staff users: a senior (or a family member
 * helping them) signs in with their phone number and a one-time code.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('app_accounts', function (Blueprint $table) {
            $table->id();
            // 10 digits without the country code, e.g. 9171234567.
            $table->string('phone', 10)->unique();
            $table->string('full_name')->nullable();
            $table->string('role')->nullable(); // senior | familyRelative
            $table->date('birth_date')->nullable();
            $table->string('barangay')->nullable();
            $table->string('municipality')->nullable();
            $table->string('province')->nullable();
            $table->timestamp('last_login_at')->nullable();
            $table->timestamps();
        });

        Schema::create('phone_verifications', function (Blueprint $table) {
            $table->id();
            $table->string('phone', 10)->index();
            $table->string('code_hash');
            $table->timestamp('expires_at');
            $table->unsignedTinyInteger('attempts')->default(0);
            $table->timestamp('consumed_at')->nullable();
            $table->timestamp('created_at')->useCurrent();
        });

        Schema::table('applications', function (Blueprint $table) {
            $table->string('source')->default('Walk-in')->after('id');
            $table->foreignId('app_account_id')->nullable()->after('source')
                ->constrained('app_accounts')->nullOnDelete();
        });

        // Photos of papers uploaded from the app. Stored on the private disk,
        // so they are only reachable through the staff API.
        Schema::create('application_documents', function (Blueprint $table) {
            $table->id();
            $table->foreignId('application_id')->nullable()->constrained('applications')->cascadeOnDelete();
            $table->foreignId('app_account_id')->nullable()->constrained('app_accounts')->nullOnDelete();
            $table->string('type'); // proofOfAge | proofOfResidence | idPhoto | other
            $table->string('client_id')->nullable(); // the app's own id for the photo
            $table->string('path');
            $table->string('original_name')->nullable();
            $table->string('mime_type')->nullable();
            $table->unsignedInteger('size')->default(0);
            $table->timestamps();

            $table->index(['app_account_id', 'client_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('application_documents');

        Schema::table('applications', function (Blueprint $table) {
            $table->dropConstrainedForeignId('app_account_id');
            $table->dropColumn('source');
        });

        Schema::dropIfExists('phone_verifications');
        Schema::dropIfExists('app_accounts');
    }
};
