<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SeniorIdHistory extends Model
{
    protected $fillable = [
        'senior_id_id',
        'action',
        'details',
        'reason',
        'previous_id_number',
        'new_id_number',
        'date_requested',
        'date_processed',
        'performed_by',
    ];

    protected $casts = [
        'date_requested' => 'date:Y-m-d',
        'date_processed' => 'date:Y-m-d',
    ];

    public function seniorId(): BelongsTo
    {
        return $this->belongsTo(SeniorId::class);
    }
}
