<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A row per successful login, for the "Recent logins" panel in User
 * Management. Written for both staff (admin web) and app users (senior app).
 *
 * user_id points at either the users or the app_accounts table depending on
 * type, so there is no foreign key here (the two tables share this log).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('login_logs', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('user_id')->nullable();
            // "staff" or "app_user".
            $table->string('type', 20);
            $table->timestamp('logged_in_at')->useCurrent();
            $table->string('ip', 45)->nullable();
            $table->string('device')->nullable();

            $table->index(['type', 'user_id']);
            $table->index('logged_in_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('login_logs');
    }
};
