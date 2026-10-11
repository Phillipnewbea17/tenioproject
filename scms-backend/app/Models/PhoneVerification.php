<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A one-time 4-digit code sent to a phone for one purpose (register, login
 * or reset). Only hashes are stored: the code (bcrypt) and, after the right
 * code, the single-use ticket for the next step (sha256).
 */
class PhoneVerification extends Model
{
    public const UPDATED_AT = null;

    public const MAX_ATTEMPTS = 5;

    /** The app's names for what a code is for -> the stored purpose. */
    public const PURPOSES = ['register' => 'register', 'login' => 'login', 'reset_mpin' => 'reset'];

    protected $fillable = [
        'phone',
        'purpose',
        'code_hash',
        'expires_at',
        'attempts',
        'consumed_at',
        'ticket_hash',
        'ticket_expires_at',
    ];

    protected $hidden = ['code_hash', 'ticket_hash'];

    protected $casts = [
        'expires_at' => 'datetime',
        'consumed_at' => 'datetime',
        'ticket_expires_at' => 'datetime',
        'created_at' => 'datetime',
    ];
}
