<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Senior app, part 2:
 *
 * - identity_verifications: an app account asking to be linked to its
 *   senior citizen record. The record match (ID number, name, birthday) is
 *   checked by the backend; the live selfie is checked by OSCA staff, who
 *   approve or reject it. Failed tries are kept to limit guessing.
 * - app_account_id / client_id on Medical, Burial and Help Desk requests,
 *   so the app only ever sees the account's own requests, and a request
 *   sent twice (bad connection) is stored once.
 * - request_attachments: photos sent with those requests (private disk).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('identity_verifications', function (Blueprint $table) {
            $table->id();
            $table->foreignId('app_account_id')->constrained('app_accounts')->cascadeOnDelete();
            $table->foreignId('senior_citizen_id')->nullable()->constrained('senior_citizens')->nullOnDelete();
            // qr | idPhoto | manual: how the senior filled in the form.
            $table->string('method', 20)->default('manual');
            // What the senior typed (name, birthday, ID number...).
            $table->json('submitted');
            $table->string('selfie_path')->nullable();
            // Pending (match found, selfie waiting for staff), Approved,
            // Rejected (by staff), Failed (no match: not_found / info_mismatch).
            $table->string('status', 20)->default('Pending');
            $table->string('failure', 30)->nullable();
            $table->string('reviewed_by')->nullable();
            $table->timestamp('reviewed_at')->nullable();
            $table->text('remarks')->nullable();
            $table->timestamps();

            $table->index(['status', 'created_at']);
            $table->index(['app_account_id', 'status']);
        });

        foreach (['medical_requests', 'burial_requests', 'help_requests'] as $name) {
            Schema::table($name, function (Blueprint $table) {
                $table->foreignId('app_account_id')->nullable()->after('source')
                    ->constrained('app_accounts')->nullOnDelete();
                $table->string('client_id', 100)->nullable()->after('app_account_id');
                $table->unique(['app_account_id', 'client_id']);
            });
        }

        Schema::create('request_attachments', function (Blueprint $table) {
            $table->id();
            $table->morphs('attachable');
            $table->foreignId('app_account_id')->nullable()->constrained('app_accounts')->nullOnDelete();
            $table->string('path');
            $table->string('original_name')->nullable();
            $table->string('mime_type')->nullable();
            $table->unsignedInteger('size')->default(0);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('request_attachments');

        foreach (['medical_requests', 'burial_requests', 'help_requests'] as $name) {
            Schema::table($name, function (Blueprint $table) {
                $table->dropUnique(['app_account_id', 'client_id']);
                $table->dropConstrainedForeignId('app_account_id');
                $table->dropColumn('client_id');
            });
        }

        Schema::dropIfExists('identity_verifications');
    }
};
