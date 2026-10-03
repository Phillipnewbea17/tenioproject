<?php

namespace App\Models;

use App\Models\Concerns\PaidFromFund;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class BurialRequest extends Model
{
    use HasFactory, PaidFromFund;

    /** Where a request came from: the senior app, or recorded by staff. */
    public const SOURCES = ['App', 'Walk-in'];

    protected $fillable = [
        'source',
        'reference',
        'senior_name',
        'claimant_name',
        'senior_id',
        'purok',
        'contact',
        'request_date',
        'status',
        'relationship',
        'release_date',
        'received_by',
        'remarks',
        'death_date',
        'funeral_home',
    ];

    protected $casts = [
        'request_date' => 'date',
        'release_date' => 'date',
        'death_date' => 'date',
    ];
}
