<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A senior-app account asking to be linked to its senior citizen record.
 * The backend checks the record match; OSCA staff check the selfie and
 * approve (links the account) or reject.
 */
class IdentityVerification extends Model
{
    public const STATUSES = ['Pending', 'Approved', 'Rejected', 'Failed'];

    protected $fillable = [
        'app_account_id',
        'senior_citizen_id',
        'method',
        'submitted',
        'selfie_path',
        'status',
        'failure',
        'reviewed_by',
        'reviewed_at',
        'remarks',
    ];

    protected $hidden = ['selfie_path'];

    protected $casts = [
        'submitted' => 'array',
        'reviewed_at' => 'datetime',
    ];

    public function appAccount(): BelongsTo
    {
        return $this->belongsTo(AppAccount::class);
    }

    public function seniorCitizen(): BelongsTo
    {
        return $this->belongsTo(SeniorCitizen::class);
    }
}
