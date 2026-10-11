<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Phones a senior already proved with a texted code. Logging in again on the
 * same phone needs only the MPIN, so a code is texted only for Create
 * Account, a new phone and Forgot MPIN. The device key is stored as a sha256
 * hash, like the verification tickets.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('app_devices', function (Blueprint $table) {
            $table->id();
            $table->foreignId('app_account_id')->constrained()->cascadeOnDelete();
            $table->string('key_hash', 64)->unique();
            $table->timestamp('last_used_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('app_devices');
    }
};
