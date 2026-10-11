<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A senior's request, sent from the app, to correct one detail of their
 * record. Staff review it; approving does not edit the record by itself
 * (staff make the change in Senior Citizens, then approve).
 */
class ProfileCorrection extends Model
{
    /** The app's PersonalField names that can be corrected. */
    public const FIELDS = [
        'firstName' => 'First name',
        'middleName' => 'Middle name',
        'lastName' => 'Last name',
        'suffix' => 'Suffix',
        'birthDate' => 'Date of birth',
        'sex' => 'Sex',
        'civilStatus' => 'Civil status',
        'seniorId' => 'Senior Citizen ID number',
        'email' => 'Email',
        'province' => 'Province',
        'municipality' => 'Municipality',
        'barangay' => 'Barangay',
        'purok' => 'Purok',
        'addressLine' => 'Address',
    ];

    protected $fillable = [
        'app_account_id',
        'senior_citizen_id',
        'field',
        'current_value',
        'requested_value',
        'reason',
        'attachment_path',
        'status',
        'reviewed_by',
        'reviewed_at',
        'remarks',
    ];

    protected $hidden = ['attachment_path'];

    protected $casts = [
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

    /** "COR-00012" */
    public function reference(): string
    {
        return 'COR-' . str_pad((string) $this->id, 5, '0', STR_PAD_LEFT);
    }

    public function fieldLabel(): string
    {
        return self::FIELDS[$this->field] ?? $this->field;
    }
}
