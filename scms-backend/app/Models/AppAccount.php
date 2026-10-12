<?php

namespace App\Models;

use Illuminate\Auth\Authenticatable;
use Illuminate\Contracts\Auth\Authenticatable as AuthenticatableContract;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Laravel\Sanctum\HasApiTokens;

/**
 * A senior-app account: a verified phone number plus a 4-digit MPIN, stored
 * only as a hash. Separate from staff Users: app tokens only work on
 * /api/mobile routes, staff tokens only on the admin routes (see the staff /
 * app middleware).
 *
 * An account is linked to at most one senior citizen record, and a record to
 * at most one account (senior_citizen_id is unique).
 */
class AppAccount extends Model implements AuthenticatableContract
{
    // Authenticatable: per-account rate limits (throttle) need an identifier.
    // There is no password; getAuthPassword() is never used to sign in.
    use Authenticatable, HasApiTokens;

    public const ROLES = ['senior', 'familyRelative'];

    /** Wrong MPINs in a row before the account is locked, and for how long. */
    public const MAX_MPIN_ATTEMPTS = 5;

    public const MPIN_LOCK_MINUTES = 15;

    protected $fillable = [
        'phone',
        'full_name',
        'first_name',
        'middle_name',
        'last_name',
        'suffix',
        'no_middle_name',
        'role',
        'status',
        'photo_path',
        'birth_date',
        'barangay',
        'municipality',
        'province',
        'last_login_at',
    ];

    protected $hidden = ['mpin_hash', 'photo_path'];

    protected $casts = [
        'birth_date' => 'date:Y-m-d',
        'last_login_at' => 'datetime',
        'mpin_locked_until' => 'datetime',
        'no_middle_name' => 'boolean',
        'linked_at' => 'datetime',
        'deactivated_at' => 'datetime',
    ];

    public function applications(): HasMany
    {
        return $this->hasMany(Application::class);
    }

    public function documents(): HasMany
    {
        return $this->hasMany(ApplicationDocument::class);
    }

    public function seniorCitizen(): BelongsTo
    {
        return $this->belongsTo(SeniorCitizen::class);
    }

    public function identityVerifications(): HasMany
    {
        return $this->hasMany(IdentityVerification::class);
    }

    /** Phones that proved the number with a code (MPIN-only login). */
    public function devices(): HasMany
    {
        return $this->hasMany(AppDevice::class);
    }

    /**
     * The senior's registration application, as shown on Document
     * Verification. The newest one is the one staff are working on.
     */
    public function latestApplication(): HasOne
    {
        return $this->hasOne(Application::class)->latestOfMany();
    }

    /** The staff user who deactivated this account, if it is deactivated. */
    public function deactivatedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'deactivated_by');
    }

    /** The staff user who linked this account to its senior record. */
    public function linkedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'linked_by');
    }

    /**
     * Everything App\Support\UserRow reads, in one go: use it wherever a list
     * of accounts is turned into User Management rows.
     */
    public function scopeWithRowRelations(Builder $query): Builder
    {
        return $query
            ->with([
                'seniorCitizen:id,senior_id,name,status',
                'deactivatedBy:id,name',
                'linkedBy:id,name',
                // No column list: latestOfMany() joins the table to itself,
                // so unqualified columns would be ambiguous.
                'latestApplication',
            ])
            ->withCount([
                'documents as id_photo_count' => fn (Builder $documents) => $documents->where('type', 'idPhoto'),
            ]);
    }

    /** The 2x2 photo uploaded with the registration documents, if any. */
    public function idPhotoDocument(): ?ApplicationDocument
    {
        return $this->documents()->where('type', 'idPhoto')->latest('id')->first();
    }

    /** Does the account have an ID photo among its uploaded documents? */
    public function hasIdPhoto(): bool
    {
        return (int) ($this->id_photo_count ?? $this->documents()->where('type', 'idPhoto')->count()) > 0;
    }

    /**
     * Where the avatar photo comes from: the photo the senior set in the app
     * ("profile"), the 2x2 photo they uploaded with their documents
     * ("id_photo"), or nothing at all.
     */
    public function photoSource(): ?string
    {
        if ($this->photo_path) {
            return 'profile';
        }

        return $this->hasIdPhoto() ? 'id_photo' : null;
    }

    /** App accounts have no "remember me" column. */
    public function getRememberTokenName()
    {
        return '';
    }

    /** True once Create Account finished with an MPIN. */
    public function isRegistered(): bool
    {
        return filled($this->mpin_hash);
    }

    /** Deactivated accounts (status "Inactive") can't log in to the app. */
    public function isActive(): bool
    {
        return ($this->status ?? 'Active') !== 'Inactive';
    }

    public function isLinked(): bool
    {
        return $this->senior_citizen_id !== null;
    }

    /** "+63 917 123 4567" */
    public function displayPhone(): string
    {
        return '+63 ' . substr($this->phone, 0, 3) . ' ' . substr($this->phone, 3, 3) . ' ' . substr($this->phone, 6);
    }
}
