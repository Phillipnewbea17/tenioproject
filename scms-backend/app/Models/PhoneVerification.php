<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** A one-time sign-in code sent to a phone (only its hash is stored). */
class PhoneVerification extends Model
{
    public const UPDATED_AT = null;

    public const MAX_ATTEMPTS = 5;

    protected $fillable = ['phone', 'code_hash', 'expires_at', 'attempts', 'consumed_at'];

    protected $casts = [
        'expires_at' => 'datetime',
        'consumed_at' => 'datetime',
        'created_at' => 'datetime',
    ];
}
