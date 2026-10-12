<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A photo of a paper uploaded from the senior app for an application. */
class ApplicationDocument extends Model
{
    /**
     * The four papers the OSCA office checks, in the order Document
     * Verification lists them. The senior app uploads exactly these types.
     */
    public const TYPES = [
        'validId' => 'Valid ID',
        'birthCertificate' => 'Birth certificate',
        'proofOfResidence' => 'Proof of residence',
        'idPhoto' => '2x2 photo',
    ];

    /** The "uploaded" column on applications each type fills in. */
    public const UPLOADED_FIELDS = [
        'validId' => 'valid_id_uploaded',
        'birthCertificate' => 'birth_certificate_uploaded',
        'proofOfResidence' => 'proof_residence_uploaded',
        'idPhoto' => 'photo_uploaded',
    ];

    /** Every application needs one of each type. */
    public const REQUIRED = ['validId', 'birthCertificate', 'proofOfResidence', 'idPhoto'];

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
