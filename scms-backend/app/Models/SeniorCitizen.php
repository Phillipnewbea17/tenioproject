<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class SeniorCitizen extends Model
{
    protected $fillable = [
        'senior_id',
        'name',
        'age',
        'birth_date',
        'gender',
        'purok',
        'contact',
        'status',
        'blood_type',
        'condition',
        'maintenance',
        'last_checkup',
        'civil_status',
        'emergency_contact',
        'relationship',
        'osca_id',
    ];

    protected $casts = [
        'age' => 'integer',
        'last_checkup' => 'date',

    ];

    public function seniorIds(): HasMany
    {
        return $this->hasMany(SeniorId::class);
    }

    /** The senior's current OSCA ID (issued, pending or awaiting replacement). */
    public function currentOscaId(): HasOne
    {
        return $this->hasOne(SeniorId::class)->ofMany(
            ['id' => 'max'],
            fn ($query) => $query->whereIn('status', ['Pending Issuance', 'Active', 'For Replacement'])
        );
    }

    /**
     * API shape for Records: the record plus its OSCA ID. The old manual
     * osca_id status column is replaced by the issued ID's own status.
     */
    public function toRecordArray(): array
    {
        $osca = $this->currentOscaId;

        return collect($this->toArray())->except(['osca_id', 'current_osca_id'])->all() + [
            'osca' => $osca ? [
                'id' => $osca->id,
                'id_number' => $osca->id_number,
                'status' => $osca->status,
                'date_issued' => $osca->date_issued?->toDateString(),
            ] : null,
        ];
    }
}