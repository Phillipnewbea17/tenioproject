<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\MorphTo;

/** A photo sent from the senior app with a Medical, Burial or Help request. */
class RequestAttachment extends Model
{
    protected $fillable = [
        'app_account_id',
        'path',
        'original_name',
        'mime_type',
        'size',
    ];

    protected $hidden = ['path'];

    public function attachable(): MorphTo
    {
        return $this->morphTo();
    }
}
