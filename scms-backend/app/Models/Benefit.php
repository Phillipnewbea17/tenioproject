<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * One card in "Benefits & services" in the senior app. Mostly national law
 * (RA 9994, RA 10645, RA 11916, RA 11982), plus whatever local benefit the
 * OSCA office wants seniors to know about.
 */
class Benefit extends Model
{
    /** Matches BenefitCategory in the Flutter app. */
    public const CATEGORIES = ['discount', 'health', 'pension', 'assistance'];

    public const STATUSES = ['Active', 'Hidden'];

    protected $fillable = [
        'slug',
        'title',
        'category',
        'summary',
        'details',
        'how_to_get',
        'status',
        'sort_order',
    ];

    protected $casts = [
        'how_to_get' => 'array',
        'sort_order' => 'integer',
    ];

    /** The shape Benefit.fromJson expects in the app. */
    public function toAppJson(): array
    {
        return [
            'id' => $this->slug,
            'title' => $this->title,
            'category' => $this->category,
            'summary' => $this->summary,
            'details' => $this->details ?? '',
            'howToGet' => array_values(array_filter(
                $this->how_to_get ?? [],
                fn ($step) => is_string($step) && trim($step) !== '',
            )),
        ];
    }
}
