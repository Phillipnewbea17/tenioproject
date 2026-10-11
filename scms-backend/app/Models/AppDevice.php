<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A phone that proved its number with a texted code. Its device key (kept
 * only as a sha256 hash) plus the MPIN signs in without a new code.
 */
class AppDevice extends Model
{
    /** Trusted phones kept per account; the oldest is forgotten first. */
    public const MAX_PER_ACCOUNT = 3;

    protected $fillable = ['app_account_id', 'key_hash', 'last_used_at'];

    protected $hidden = ['key_hash'];

    protected $casts = [
        'last_used_at' => 'datetime',
    ];

    public function account(): BelongsTo
    {
        return $this->belongsTo(AppAccount::class, 'app_account_id');
    }
}
