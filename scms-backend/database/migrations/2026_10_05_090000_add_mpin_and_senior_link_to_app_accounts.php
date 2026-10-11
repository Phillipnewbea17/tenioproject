<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Senior app sign-in with a 4-digit code (proves the phone) and a 4-digit
 * MPIN (the account's password, stored only as a hash), and the link
 * between an app account and its senior citizen record.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('app_accounts', function (Blueprint $table) {
            // Null until the MPIN is created: the account is not registered yet.
            $table->string('mpin_hash')->nullable()->after('phone');
            $table->unsignedTinyInteger('mpin_attempts')->default(0)->after('mpin_hash');
            $table->timestamp('mpin_locked_until')->nullable()->after('mpin_attempts');
            // One senior record can belong to one app account only.
            $table->foreignId('senior_citizen_id')->nullable()->unique()->after('mpin_locked_until')
                ->constrained('senior_citizens')->nullOnDelete();
            $table->timestamp('linked_at')->nullable()->after('senior_citizen_id');
        });

        Schema::table('phone_verifications', function (Blueprint $table) {
            // register | login | reset: a code only works for what it was sent for.
            $table->string('purpose', 20)->default('login')->after('phone');
            // After the right code: a short-lived, single-use ticket for the
            // next step (create MPIN, log in with MPIN, reset MPIN). Hash only.
            $table->string('ticket_hash', 64)->nullable()->after('consumed_at');
            $table->timestamp('ticket_expires_at')->nullable()->after('ticket_hash');
        });
    }

    public function down(): void
    {
        Schema::table('phone_verifications', function (Blueprint $table) {
            $table->dropColumn(['purpose', 'ticket_hash', 'ticket_expires_at']);
        });

        Schema::table('app_accounts', function (Blueprint $table) {
            $table->dropConstrainedForeignId('senior_citizen_id');
            $table->dropColumn(['mpin_hash', 'mpin_attempts', 'mpin_locked_until', 'linked_at']);
        });
    }
};
