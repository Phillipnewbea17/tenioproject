<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class SeniorId extends Model
{
    public const STATUSES = ['Pending Issuance', 'Active', 'For Replacement', 'Inactive'];

    public const REPLACEMENT_REASONS = ['Lost', 'Damaged', 'Incorrect Information', 'Other'];

    protected $fillable = [
        'id_number',
        'senior_citizen_id',
        'status',
        'date_issued',
        'issued_by',
        'remarks',
        'replacement_reason',
        'replacement_requested_at',
        'replacement_source',
        'replaced_by_id',
    ];

    protected $casts = [
        'date_issued' => 'date:Y-m-d',
        'replacement_requested_at' => 'date:Y-m-d',
    ];

    public function seniorCitizen(): BelongsTo
    {
        return $this->belongsTo(SeniorCitizen::class);
    }

    public function replacedBy(): BelongsTo
    {
        return $this->belongsTo(self::class, 'replaced_by_id');
    }

    public function histories(): HasMany
    {
        return $this->hasMany(SeniorIdHistory::class)->latest('id');
    }
}
