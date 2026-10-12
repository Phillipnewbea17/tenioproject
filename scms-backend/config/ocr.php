<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Tesseract OCR
    |--------------------------------------------------------------------------
    |
    | Tesseract is the free OCR program used to read the personal details off
    | the birth certificate and barangay certificate photos a senior uploads
    | (see App\Support\DocumentOcr). Install it once on the server:
    |
    |   Windows: https://github.com/UB-Mannheim/tesseract/wiki
    |            then set TESSERACT_PATH in .env, for example
    |            TESSERACT_PATH="C:\Program Files\Tesseract-OCR\tesseract.exe"
    |   Linux:   sudo apt install tesseract-ocr
    |   macOS:   brew install tesseract
    |
    | Leave TESSERACT_PATH empty when "tesseract" is on the system PATH.
    | Without Tesseract nothing breaks: the record is still created, with the
    | fields left empty for staff to fill in (status "Needs attention").
    |
    */

    'tesseract' => env('TESSERACT_PATH'),

    // Trained language data to read the papers with. "eng" ships with
    // Tesseract; add "+fil" only if the Filipino data file is installed.
    'language' => env('TESSERACT_LANGUAGE', 'eng'),

    // Seconds to wait for one photo before giving up on it.
    'timeout' => (int) env('TESSERACT_TIMEOUT', 30),

];
