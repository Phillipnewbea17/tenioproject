<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * App accounts can now be deactivated from User Management, the same as staff
 * users. A deactivated account can't log in to the senior app. Defaults to
 * Active so every existing account keeps working.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('app_accounts', function (Blueprint $table) {
            if (! Schema::hasColumn('app_accounts', 'status')) {
                $table->string('status')->default('Active')->after('role');
            }
        });
    }

    public function down(): void
    {
        Schema::table('app_accounts', function (Blueprint $table) {
            if (Schema::hasColumn('app_accounts', 'status')) {
                $table->dropColumn('status');
            }
        });
    }
};
