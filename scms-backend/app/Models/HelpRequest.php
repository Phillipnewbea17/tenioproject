<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A request or complaint from a senior citizen (Help & Complaint Desk).
 * Status flow: Pending → Working on it → Resolved → Closed (can be reopened).
 */
class HelpRequest extends Model
{
    public const CATEGORIES = [
        'Lost or damaged OSCA ID',
        'Delayed pension/assistance',
        'Program concern',
        'Document concern',
        'Registration concern',
        'Account/login concern',
        'General inquiry',
        'Other',
    ];

    public const STATUSES = ['Pending', 'Working on it', 'Resolved', 'Closed'];

    public const PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'];

    /** How staff received a walk-in case. App cases arrive through the senior app. */
    public const CHANNELS = ['Walk-in', 'Phone call', 'Text message', 'Other'];

    /** Where a case came from: the senior app, or recorded by staff. */
    public const SOURCES = ['App', 'Walk-in'];

    protected $fillable = [
        'source',
        'reference',
        'senior_citizen_id',
        'senior_name',
        'category',
        'subject',
        'description',
        'channel',
        'priority',
        'status',
        'assigned_user_id',
        'submitted_at',
        'resolution',
        'resolved_at',
        'closed_at',
        'remarks',
        'created_by',
    ];

    protected $casts = [
        'submitted_at' => 'date:Y-m-d',
        'resolved_at' => 'date:Y-m-d',
        'closed_at' => 'datetime',
    ];

    public function seniorCitizen(): BelongsTo
    {
        return $this->belongsTo(SeniorCitizen::class);
    }

    public function assignee(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assigned_user_id');
    }

    public function updates(): HasMany
    {
        return $this->hasMany(HelpRequestUpdate::class)->orderByDesc('id');
    }

    /** Whole days from submission to resolution, or null if not resolved. */
    public function daysToResolve(): ?int
    {
        return $this->resolved_at && $this->submitted_at
            ? (int) $this->submitted_at->diffInDays($this->resolved_at)
            : null;
    }
}
