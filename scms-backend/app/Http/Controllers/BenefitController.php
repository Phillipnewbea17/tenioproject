<?php

namespace App\Http\Controllers;

use App\Models\Benefit;
use App\Support\ActivityLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * Staff: the cards seniors read in "Benefits & services" in the app.
 * Hiding a card keeps it here but takes it out of the app.
 */
class BenefitController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json([
            'benefits' => Benefit::orderBy('sort_order')->orderBy('id')->get(),
            'categories' => Benefit::CATEGORIES,
            'statuses' => Benefit::STATUSES,
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request);

        // The app tells cards apart by slug, so it has to stay unique and
        // must not change under a card the seniors already read.
        $data['slug'] = $this->uniqueSlug($data['title']);
        $data['sort_order'] ??= (int) Benefit::max('sort_order') + 1;

        $benefit = Benefit::create($data);

        ActivityLogger::record('Benefits', 'Created', 'Benefit added to the app.', $benefit, $benefit->title);

        return response()->json($benefit, 201);
    }

    public function show(Benefit $benefit): JsonResponse
    {
        return response()->json($benefit);
    }

    public function update(Request $request, Benefit $benefit): JsonResponse
    {
        $benefit->update($this->validated($request, $benefit));

        if ($changes = ActivityLogger::changes($benefit)) {
            $action = match ($changes['status']['to'] ?? null) {
                'Hidden' => 'Hidden',
                'Active' => 'Shown',
                default => 'Updated',
            };

            ActivityLogger::record('Benefits', $action,
                'Updated ' . ActivityLogger::fieldList($changes) . '.',
                $benefit, $benefit->title, $changes);
        }

        return response()->json($benefit);
    }

    public function destroy(Benefit $benefit): JsonResponse
    {
        ActivityLogger::record('Benefits', 'Deleted', 'Benefit removed from the app.', $benefit, $benefit->title);

        $benefit->delete();

        return response()->json(['message' => 'Benefit deleted successfully.']);
    }

    private function validated(Request $request, ?Benefit $benefit = null): array
    {
        $required = $benefit ? 'sometimes' : 'required';

        $data = $request->validate([
            'title' => "{$required}|string|max:255",
            'category' => [$required, Rule::in(Benefit::CATEGORIES)],
            'summary' => "{$required}|string|max:255",
            'details' => 'nullable|string|max:5000',
            'how_to_get' => 'nullable|array|max:10',
            'how_to_get.*' => 'string|max:255',
            'status' => ['nullable', Rule::in(Benefit::STATUSES)],
            'sort_order' => 'nullable|integer|min:0|max:9999',
        ]);

        if (array_key_exists('how_to_get', $data)) {
            $data['how_to_get'] = array_values(array_filter(
                array_map('trim', $data['how_to_get'] ?? []),
                fn ($step) => $step !== '',
            ));
        }

        return $data;
    }

    private function uniqueSlug(string $title): string
    {
        $base = Str::slug($title) ?: 'benefit';
        $slug = $base;
        for ($n = 2; Benefit::where('slug', $slug)->exists(); $n++) {
            $slug = "{$base}-{$n}";
        }

        return $slug;
    }
}
