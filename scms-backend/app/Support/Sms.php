<?php

namespace App\Support;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;

/**
 * Sends text messages. Set SMS_DRIVER in .env:
 *   log        (default) writes the message to storage/logs/laravel.log,
 *              for development and testing without an SMS provider
 *   semaphore  sends through Semaphore (https://semaphore.co); needs
 *              SEMAPHORE_API_KEY and optionally SMS_SENDER_NAME
 */
class Sms
{
    /** $phone: 10 digits without the country code, e.g. 9171234567. */
    public static function send(string $phone, string $message): void
    {
        $driver = config('services.sms.driver', 'log');

        if ($driver === 'semaphore') {
            $response = Http::asForm()->timeout(15)->post('https://api.semaphore.co/api/v4/messages', array_filter([
                'apikey' => config('services.sms.semaphore_key'),
                'number' => '0' . $phone,
                'message' => $message,
                'sendername' => config('services.sms.sender'),
            ]));

            if ($response->failed()) {
                throw new RuntimeException('The text message could not be sent.');
            }

            return;
        }

        Log::info("[SMS to +63{$phone}] {$message}");
    }
}
