<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class SeniorCitizen extends Model
{
    /** The puroks of Los Angeles, Ubay, Bohol (same list as Records). */
    public const PUROKS = [
        'Purok 1', 'Purok 2', 'Purok 3', 'Purok 4', 'Purok 5', 'Purok 6', 'Purok 7',
    ];

    public const GENDERS = ['Male', 'Female'];

    /** Where the OSCA office serves (printed on the ID card). */
    public const LOCALITY = 'Los Angeles, Ubay, Bohol';

    /**
     * A record created from an approved application whose birth date, sex or
     * purok could not be read off the papers. It waits in Records for staff
     * to complete it, and cannot be issued an OSCA ID until they do.
     */
    public const NEEDS_ATTENTION = 'Needs attention';

    /** The three details an OSCA ID is printed from. */
    public const REQUIRED_FOR_ID = ['birth_date', 'gender', 'purok'];

    protected $fillable = [
        'senior_id',
        'application_id',
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

    /** The approved registration this record was created from, if any. */
    public function application(): BelongsTo
    {
        return $this->belongsTo(Application::class);
    }

    /**
     * The 2x2 photo printed on the OSCA ID card: the one submitted with this
     * record's application, or - for records staff added by hand - the one
     * from the senior app account linked to the record.
     */
    public function idPhotoDocument(): ?ApplicationDocument
    {
        if ($this->application_id) {
            $submitted = ApplicationDocument::where('application_id', $this->application_id)
                ->where('type', 'idPhoto')
                ->latest('id')
                ->first();

            if ($submitted) {
                return $submitted;
            }
        }

        return $this->appAccount?->idPhotoDocument();
    }

    /** "Purok 2, Los Angeles, Ubay, Bohol" - as printed on the ID card. */
    public function address(): string
    {
        return collect([$this->purok, self::LOCALITY])->filter()->implode(', ');
    }

    /** Are the details an OSCA ID needs all filled in? */
    public function isCompleteForId(): bool
    {
        foreach (self::REQUIRED_FOR_ID as $column) {
            if (blank($this->getAttribute($column))) {
                return false;
            }
        }

        return true;
    }

    /** The senior app account linked to this record, if any (at most one). */
    public function appAccount(): HasOne
    {
        return $this->hasOne(AppAccount::class);
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