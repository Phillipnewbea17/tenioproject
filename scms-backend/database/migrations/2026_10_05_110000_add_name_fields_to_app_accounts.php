<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Create Account in the senior app asks for the name before the mobile
 * number. It is kept on the account (full_name stays the joined name) and
 * fills Personal Information until the account is linked to a senior
 * record, whose name then takes over.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('app_accounts', function (Blueprint $table) {
            $table->string('first_name', 100)->nullable()->after('full_name');
            $table->string('middle_name', 100)->nullable()->after('first_name');
            $table->string('last_name', 100)->nullable()->after('middle_name');
            $table->string('suffix', 10)->nullable()->after('last_name');
            // "I have no middle name" was ticked (middle_name is empty on purpose).
            $table->boolean('no_middle_name')->default(false)->after('suffix');
        });
    }

    public function down(): void
    {
        Schema::table('app_accounts', function (Blueprint $table) {
            $table->dropColumn(['first_name', 'middle_name', 'last_name', 'suffix', 'no_middle_name']);
        });
    }
};
