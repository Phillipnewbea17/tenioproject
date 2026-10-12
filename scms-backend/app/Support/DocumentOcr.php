<?php

namespace App\Support;

use App\Models\ApplicationDocument;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use thiagoalessio\TesseractOCR\TesseractOCR;

/**
 * Reads the text off a photo of a paper with Tesseract, the free OCR program
 * (see config/ocr.php for installing it).
 *
 * Nothing here ever throws: a missing photo, a missing Tesseract or an
 * unreadable scan all come back as an empty string, so approving an
 * application never fails because of OCR.
 */
class DocumentOcr
{
    /** Text read from the document's stored photo, or '' when it can't be read. */
    public function read(?ApplicationDocument $document): string
    {
        if (! $document || ! Storage::disk('local')->exists($document->path)) {
            return '';
        }

        $file = Storage::disk('local')->path($document->path);

        try {
            $reader = (new TesseractOCR($file))
                ->lang(...explode('+', (string) config('ocr.language', 'eng')))
                ->timeout((int) config('ocr.timeout', 30));

            if ($binary = config('ocr.tesseract')) {
                $reader->executable($binary);
            }

            return trim($reader->run());
        } catch (\Throwable $exception) {
            // Most often: Tesseract is not installed yet on this machine.
            Log::warning('Could not read document photo with OCR.', [
                'document_id' => $document->id,
                'type' => $document->type,
                'error' => $exception->getMessage(),
            ]);

            return '';
        }
    }
}
