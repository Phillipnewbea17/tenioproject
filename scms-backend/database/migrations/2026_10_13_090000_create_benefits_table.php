<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * "Benefits & services" in the senior app. Until now the app shipped these
 * cards in assets/data/benefits.json, so OSCA could not touch them without
 * a new release. The seven rows seeded below are that file's contents, so
 * nothing the seniors already see is lost.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('benefits', function (Blueprint $table) {
            $table->id();
            // Stable key the app uses to tell cards apart ("b-discount").
            $table->string('slug')->unique();
            $table->string('title');
            // discount | health | pension | assistance (BenefitCategory).
            $table->string('category')->default('assistance');
            $table->string('summary');
            $table->text('details')->nullable();
            // The "How to get it" steps, in order.
            $table->json('how_to_get')->nullable();
            $table->string('status')->default('Active');
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->timestamps();
        });

        $now = now();
        DB::table('benefits')->insert(array_map(fn (array $row) => $row + [
            'status' => 'Active',
            'created_at' => $now,
            'updated_at' => $now,
        ], [
            [
                'slug' => 'b-discount',
                'title' => '20% discount and no VAT',
                'category' => 'discount',
                'summary' => 'On medicines, restaurants, hotels, movies and public transport.',
                'details' => 'Senior citizens get a 20% discount and do not pay the 12% VAT on many goods and services for their own use, under the Expanded Senior Citizens Act (RA 9994).',
                'how_to_get' => json_encode([
                    'Show your Senior Citizen ID to the cashier.',
                    'For medicines, also bring your purchase booklet and prescription.',
                ]),
                'sort_order' => 1,
            ],
            [
                'slug' => 'b-groceries',
                'title' => '5% off basic groceries',
                'category' => 'discount',
                'summary' => 'On rice, bread, canned goods, coffee and other basic needs.',
                'details' => 'Senior citizens get a 5% discount on basic necessities and prime commodities. Weekly limits apply. Ask the store or the OSCA office for the current limit.',
                'how_to_get' => json_encode([
                    'Show your Senior Citizen ID and purchase booklet at the cashier.',
                ]),
                'sort_order' => 2,
            ],
            [
                'slug' => 'b-philhealth',
                'title' => 'PhilHealth coverage',
                'category' => 'health',
                'summary' => 'All senior citizens are covered by PhilHealth.',
                'details' => 'Every senior citizen is automatically covered by the national health insurance program (RA 10645).',
                'how_to_get' => json_encode([
                    'Bring your Senior Citizen ID when you go to a hospital or clinic.',
                    'Ask the PhilHealth desk to check your membership.',
                ]),
                'sort_order' => 3,
            ],
            [
                'slug' => 'b-vaccines',
                'title' => 'Free flu and pneumonia shots',
                'category' => 'health',
                'summary' => 'Free vaccines at your Rural Health Unit.',
                'details' => 'The Department of Health gives free flu and pneumonia vaccines to senior citizens through local health units, while supplies last.',
                'how_to_get' => json_encode([
                    'Visit your Rural Health Unit and bring your Senior Citizen ID.',
                ]),
                'sort_order' => 4,
            ],
            [
                'slug' => 'b-social-pension',
                'title' => 'Social pension',
                'category' => 'pension',
                'summary' => 'Monthly pension for seniors who need support.',
                'details' => 'Indigent senior citizens can get a monthly social pension from the national government (RA 11916). The OSCA office and DSWD decide who can get it.',
                'how_to_get' => json_encode([
                    'Ask the OSCA office if you can be listed.',
                    'Bring your Senior Citizen ID and a barangay certificate.',
                ]),
                'sort_order' => 5,
            ],
            [
                'slug' => 'b-centenarian',
                'title' => 'Cash gift at 80 and above',
                'category' => 'assistance',
                'summary' => 'Cash gifts at ages 80, 85, 90, 95 and 100.',
                'details' => 'Under the Expanded Centenarians Act (RA 11982), seniors get a cash gift when they turn 80, 85, 90 and 95, and a bigger gift at 100.',
                'how_to_get' => json_encode([
                    'The OSCA office checks the list of birthdays.',
                    'Ask the OSCA office when your cash gift is ready.',
                ]),
                'sort_order' => 6,
            ],
            [
                'slug' => 'b-priority',
                'title' => 'Priority lanes',
                'category' => 'assistance',
                'summary' => 'Express lanes in government offices, banks and stores.',
                'details' => 'Senior citizens must be served in express lanes, or ahead of others when there is no express lane (RA 9994).',
                'how_to_get' => json_encode([
                    'Show your Senior Citizen ID and ask for the priority lane.',
                ]),
                'sort_order' => 7,
            ],
        ]));
    }

    public function down(): void
    {
        Schema::dropIfExists('benefits');
    }
};
