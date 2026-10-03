<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A photo of a paper uploaded from the senior app for an application. */
class ApplicationDocument extends Model
{
    /** The app's document types and how staff see them. */
    public const TYPES = [
        'proofOfAge' => 'Birth certificate or valid ID',
        'proofOfResidence' => 'Barangay certificate (proof of residence)',
        'idPhoto' => '1x1 ID photo',
        'other' => 'Other paper',
    ];

    /** Every application needs one of each of these. */
    public const REQUIRED = ['proofOfAge', 'proofOfResidence', 'idPhoto'];

    protected $fillable = [
        'application_id',
        'app_account_id',
        'type',
        'client_id',
        'path',
        'original_name',
        'mime_type',
        'size',
    ];

    public function application(): BelongsTo
    {
        return $this->belongsTo(Application::class);
    }

    public function label(): string
    {
        return self::TYPES[$this->type] ?? 'Document';
    }
}
