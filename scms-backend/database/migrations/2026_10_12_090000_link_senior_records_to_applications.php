<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * An approved application now creates the senior citizen record, so the
 * record points back at the application it came from (one record per
 * application), and the personal details read from the submitted papers are
 * allowed to be empty: a record with gaps is saved as "Needs attention" for
 * staff to complete in Records > Edit record.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('senior_citizens', function (Blueprint $table) {
            $table->foreignId('application_id')->nullable()->after('senior_id')
                ->unique()->constrained('applications')->nullOnDelete();
        });

        Schema::table('senior_citizens', function (Blueprint $table) {
            $table->unsignedInteger('age')->nullable()->change();
            $table->string('gender')->nullable()->change();
            $table->string('purok')->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('senior_citizens', function (Blueprint $table) {
            $table->dropConstrainedForeignId('application_id');
        });

        // Columns the records table was created with are filled in first, so
        // making them required again cannot fail.
        Schema::table('senior_citizens', function (Blueprint $table) {
            $table->unsignedInteger('age')->default(60)->nullable(false)->change();
            $table->string('gender')->default('')->nullable(false)->change();
            $table->string('purok')->default('')->nullable(false)->change();
        });
    }
};
