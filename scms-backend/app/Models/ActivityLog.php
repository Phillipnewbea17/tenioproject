<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use LogicException;

/**
 * One audit-trail entry. Entries are append-only: the model refuses updates
 * and deletes so history cannot be altered through the application.
 */
class ActivityLog extends Model
{
    public const UPDATED_AT = null;

    protected $fillable = [
        'user_id',
        'user_name',
        'role',
        'module',
        'action',
        'record_type',
        'record_id',
        'record_label',
        'description',
        'changes',
        'ip_address',
    ];

    protected $casts = [
        'changes' => 'array',
        'created_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Activity log entries cannot be changed.'));
        static::deleting(fn () => throw new LogicException('Activity log entries cannot be deleted.'));
    }
}
