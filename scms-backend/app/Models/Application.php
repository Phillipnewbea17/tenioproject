<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Application extends Model
{
    /** Where it came from: the senior app, or recorded by staff. */
    public const SOURCES = ['App', 'Walk-in'];

    public function appAccount(): BelongsTo
    {
        return $this->belongsTo(AppAccount::class);
    }

    /** Photos of papers uploaded from the app. */
    public function documents(): HasMany
    {
        return $this->hasMany(ApplicationDocument::class);
    }

    protected $fillable = [
        'source',
        'app_account_id',
        'application_id',
        'name',
        'submitted_at',
        'status',
        'priority',
        'contact',
        'purok',
        'age',
        'birth_date',
        'valid_id_uploaded',
        'birth_certificate_uploaded',
        'proof_residence_uploaded',
        'photo_uploaded',
        'notes',
        'history',
    ];

    protected $casts = [
        'submitted_at' => 'datetime',
        'birth_date' => 'date',
        'age' => 'integer',

        'valid_id_uploaded' => 'boolean',
        'birth_certificate_uploaded' => 'boolean',
        'proof_residence_uploaded' => 'boolean',
        'photo_uploaded' => 'boolean',

        'history' => 'array',
    ];
}