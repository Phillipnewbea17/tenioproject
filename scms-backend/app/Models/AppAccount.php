<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Laravel\Sanctum\HasApiTokens;

/**
 * A senior-app account (phone number + one-time code). Separate from staff
 * Users: app tokens only work on /api/mobile routes, staff tokens only on
 * the admin routes (see the staff / app middleware).
 */
class AppAccount extends Model
{
    use HasApiTokens;

    public const ROLES = ['senior', 'familyRelative'];

    protected $fillable = [
        'phone',
        'full_name',
        'role',
        'birth_date',
        'barangay',
        'municipality',
        'province',
        'last_login_at',
    ];

    protected $casts = [
        'birth_date' => 'date:Y-m-d',
        'last_login_at' => 'datetime',
    ];

    public function applications(): HasMany
    {
        return $this->hasMany(Application::class);
    }

    public function documents(): HasMany
    {
        return $this->hasMany(ApplicationDocument::class);
    }

    /** "+63 917 123 4567" */
    public function displayPhone(): string
    {
        return '+63 ' . substr($this->phone, 0, 3) . ' ' . substr($this->phone, 3, 3) . ' ' . substr($this->phone, 6);
    }
}
