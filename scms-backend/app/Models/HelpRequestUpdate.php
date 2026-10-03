<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class HelpRequestUpdate extends Model
{
    public const UPDATED_AT = null;

    protected $fillable = [
        'help_request_id',
        'type',
        'from_status',
        'to_status',
        'note',
        'user_name',
    ];

    protected $casts = [
        'created_at' => 'datetime',
    ];
}
