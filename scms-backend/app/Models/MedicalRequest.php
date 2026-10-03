<?php

namespace App\Models;

use App\Models\Concerns\PaidFromFund;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class MedicalRequest extends Model
{
    use HasFactory, PaidFromFund;

    /** Where a request came from: the senior app, or recorded by staff. */
    public const SOURCES = ['App', 'Walk-in'];

    protected $fillable = [
    'source',
    'reference',
    'senior_name',
    'senior_id',
    'purok',
    'contact',
    'assistance_type',
    'request_date',
    'facility',
    'status',
    'completed_date',
    'received_by',
    'remarks',
];

    protected $casts = [
        'request_date' => 'date',
        'completed_date' => 'date',
    ];
}