<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;

/**
 * One row per successful login, shown in User Management > Recent logins.
 * Writing a log entry must never block signing in, so record() swallows its
 * own errors (like ActivityLogger).
 */
class LoginLog extends Model
{
    public const TYPE_STAFF = 'staff';
    public const TYPE_APP_USER = 'app_user';

    public $timestamps = false;

    protected $fillable = ['user_id', 'type', 'logged_in_at', 'ip', 'device'];

    protected $casts = [
        'logged_in_at' => 'datetime',
    ];

    public static function record(int $userId, string $type, ?Request $request = null): void
    {
        try {
            $request ??= request();

            self::create([
                'user_id' => $userId,
                'type' => $type,
                'logged_in_at' => now(),
                'ip' => $request?->ip(),
                'device' => $request ? substr((string) $request->userAgent(), 0, 255) : null,
            ]);
        } catch (\Throwable $error) {
            report($error);
        }
    }
}
