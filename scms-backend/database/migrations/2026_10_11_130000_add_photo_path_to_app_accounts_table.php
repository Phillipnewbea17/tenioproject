<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The app-profile photo a senior sets in the mobile app, so it can be shown
 * beside their name in User Management. Stored on the private "local" disk
 * (served only through the staff API), like selfies and document photos.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('app_accounts', function (Blueprint $table) {
            if (! Schema::hasColumn('app_accounts', 'photo_path')) {
                $table->string('photo_path')->nullable()->after('status');
            }
        });
    }

    public function down(): void
    {
        Schema::table('app_accounts', function (Blueprint $table) {
            if (Schema::hasColumn('app_accounts', 'photo_path')) {
                $table->dropColumn('photo_path');
            }
        });
    }
};
