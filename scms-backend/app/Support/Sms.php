<?php

namespace App\Support;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;

/**
 * Sends text messages. Set SMS_DRIVER in .env:
 *   android    sends from an Android phone with a prepaid SIM, running
 *              "SMS Gateway for Android" (https://sms-gate.app); needs
 *              SMS_GATEWAY_USERNAME and SMS_GATEWAY_PASSWORD, and
 *              SMS_GATEWAY_URL for the app's Local Server mode
 *   semaphore  sends through Semaphore (https://semaphore.co); needs
 *              SEMAPHORE_API_KEY and optionally SMS_SENDER_NAME
 *   log        (default) writes the message to storage/logs/laravel.log.
 *              Local development only: refused when APP_ENV=production,
 *              so a code is never reported as sent without reaching a phone.
 */
class Sms
{
    /** $phone: 10 digits without the country code, e.g. 9171234567. */
    public static function send(string $phone, string $message): void
    {
        $driver = config('services.sms.driver', 'log');

        if ($driver === 'android') {
            $username = config('services.sms.gateway_username');
            $password = config('services.sms.gateway_password');
            if (blank($username) || blank($password)) {
                throw new RuntimeException('SMS_DRIVER=android needs SMS_GATEWAY_USERNAME and SMS_GATEWAY_PASSWORD.');
            }

            $response = Http::withBasicAuth($username, $password)->timeout(15)
                ->post(config('services.sms.gateway_url'), [
                    'textMessage' => ['text' => $message],
                    'phoneNumbers' => ['+63' . $phone],
                ]);

            if ($response->failed()) {
                throw new RuntimeException('The text message could not be sent.');
            }

            return;
        }

        if ($driver === 'semaphore') {
            $key = config('services.sms.semaphore_key');
            if (blank($key)) {
                throw new RuntimeException('SMS_DRIVER=semaphore needs SEMAPHORE_API_KEY.');
            }

            $response = Http::asForm()->timeout(15)->post('https://api.semaphore.co/api/v4/messages', array_filter([
                'apikey' => $key,
                'number' => '0' . $phone,
                'message' => $message,
                'sendername' => config('services.sms.sender'),
            ]));

            if ($response->failed()) {
                throw new RuntimeException('The text message could not be sent.');
            }

            return;
        }

        if ($driver === 'log' && ! app()->isProduction()) {
            Log::info("[SMS to +63{$phone}] {$message}");

            return;
        }

        throw new RuntimeException("SMS_DRIVER \"{$driver}\" cannot send text messages here. Set SMS_DRIVER=android or semaphore.");
    }
}
