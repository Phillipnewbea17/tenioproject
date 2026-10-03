<?php

namespace App\Http\Controllers\Mobile;

use App\Http\Controllers\Controller;
use App\Models\AppAccount;
use App\Models\PhoneVerification;
use App\Support\ActivityLogger;
use App\Support\Sms;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;

/**
 * Senior app sign-in: a 4-digit code is texted to the phone (see Sms) and
 * exchanged for an API token. Errors carry a `code` so the app can react:
 * wrong_code, expired, too_many_attempts.
 */
class AuthController extends Controller
{
    private const CODE_MINUTES = 5;
    private const RESEND_SECONDS = 60;

    public function sendCode(Request $request): JsonResponse
    {
        $phone = $this->validPhone($request);

        abort_if(
            PhoneVerification::where('phone', $phone)->where('created_at', '>', now()->subSeconds(self::RESEND_SECONDS))->exists(),
            429,
            'Please wait a minute before asking for a new code.'
        );

        // A new code replaces any older one that was not used.
        PhoneVerification::where('phone', $phone)->whereNull('consumed_at')->update(['consumed_at' => now()]);

        $code = (string) random_int(1000, 9999);
        PhoneVerification::create([
            'phone' => $phone,
            'code_hash' => Hash::make($code),
            'expires_at' => now()->addMinutes(self::CODE_MINUTES),
        ]);

        Sms::send($phone, "Your SCMS code is {$code}. It expires in " . self::CODE_MINUTES . ' minutes. Do not share it with anyone.');

        return response()->json(['message' => 'We sent a code to your phone.']);
    }

    public function verifyCode(Request $request): JsonResponse
    {
        $phone = $this->validPhone($request);
        $code = $request->validate(['code' => ['required', 'regex:/^\d{4}$/']], ['code.regex' => 'Enter the 4-digit code.'])['code'];

        $verification = PhoneVerification::where('phone', $phone)->whereNull('consumed_at')->latest('id')->first();

        if (! $verification || $verification->expires_at->isPast()) {
            return $this->fail('This code has expired. Please ask for a new one.', 'expired');
        }

        if ($verification->attempts >= PhoneVerification::MAX_ATTEMPTS) {
            return $this->fail('Too many wrong tries. Please ask for a new code.', 'too_many_attempts');
        }

        if (! Hash::check($code, $verification->code_hash)) {
            $verification->increment('attempts');

            return $this->fail('Wrong code. Please check and try again.', 'wrong_code');
        }

        $verification->update(['consumed_at' => now()]);

        $account = AppAccount::firstOrCreate(['phone' => $phone]);
        $account->update(['last_login_at' => now()]);

        ActivityLogger::record('Senior App', 'Signed in', null, $account,
            $account->displayPhone(), userName: ($account->full_name ?: $account->displayPhone()) . ' (app)');

        return response()->json([
            'token' => $account->createToken('senior-app')->plainTextToken,
            'account' => ProfileController::present($account),
        ]);
    }

    public function signOut(Request $request): JsonResponse
    {
        $token = $request->user()->currentAccessToken();
        if ($token && method_exists($token, 'delete')) {
            $token->delete();
        }

        return response()->json(['message' => 'Signed out.']);
    }

    private function validPhone(Request $request): string
    {
        return $request->validate(
            ['phone' => ['required', 'regex:/^9\d{9}$/']],
            ['phone.regex' => 'Please enter a valid mobile number.'],
        )['phone'];
    }

    private function fail(string $message, string $code): JsonResponse
    {
        return response()->json(['message' => $message, 'code' => $code], 422);
    }
}
