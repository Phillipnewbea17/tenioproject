<?php

namespace App\Http\Controllers\Mobile;

use App\Http\Controllers\Controller;
use App\Models\Benefit;
use Illuminate\Http\JsonResponse;

/**
 * Read-only "Benefits & services" for the SeniorCompanion app. Public (no
 * login), like announcements: what the law gives a senior citizen is not
 * private, and the Benefits tab opens before anyone signs in.
 *
 * The JSON shape matches Benefit.fromJson in the Flutter app, which keeps
 * assets/data/benefits.json as its offline fallback.
 */
class BenefitController extends Controller
{
    public function index(): JsonResponse
    {
        $benefits = Benefit::where('status', 'Active')
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get()
            ->map(fn (Benefit $b) => $b->toAppJson());

        return response()->json($benefits);
    }
}
