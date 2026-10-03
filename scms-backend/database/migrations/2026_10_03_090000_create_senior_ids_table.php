<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Local/LGU senior citizen ID records. This is separate from the
        // national OSCA ID status kept on senior_citizens.osca_id.
        Schema::create('senior_ids', function (Blueprint $table) {
            $table->id();

            $table->string('id_number')->unique();
            $table->foreignId('senior_citizen_id')
                ->constrained('senior_citizens')
                ->cascadeOnDelete();

            $table->enum('status', ['Pending Issuance', 'Active', 'For Replacement', 'Inactive'])
                ->default('Pending Issuance');
            $table->date('date_issued')->nullable();
            $table->string('issued_by')->nullable();
            $table->text('remarks')->nullable();

            // Filled in while a replacement is requested, and kept on the old
            // ID after it has been replaced.
            $table->string('replacement_reason')->nullable();
            $table->date('replacement_requested_at')->nullable();
            $table->foreignId('replaced_by_id')
                ->nullable()
                ->constrained('senior_ids')
                ->nullOnDelete();

            $table->timestamps();
        });

        Schema::create('senior_id_histories', function (Blueprint $table) {
            $table->id();

            $table->foreignId('senior_id_id')
                ->constrained('senior_ids')
                ->cascadeOnDelete();

            $table->string('action');
            $table->text('details')->nullable();
            $table->string('reason')->nullable();
            $table->string('previous_id_number')->nullable();
            $table->string('new_id_number')->nullable();
            $table->date('date_requested')->nullable();
            $table->date('date_processed')->nullable();
            $table->string('performed_by')->nullable();

            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('senior_id_histories');
        Schema::dropIfExists('senior_ids');
    }
};
