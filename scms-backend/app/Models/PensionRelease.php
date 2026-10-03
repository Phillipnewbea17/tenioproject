<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use App\Models\Concerns\PaidFromFund;
use Illuminate\Database\Eloquent\Model;

class PensionRelease extends Model
{
    use HasFactory, PaidFromFund;

    protected $fillable = [
        'senior_id',
        'name',
        'period',
        'release_date',
        'received_by',
        'status',
        'reference',
        'remarks',
    ];

    protected $casts = [
        'release_date' => 'date',
    ];
}