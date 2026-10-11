<?php

namespace App\Http\Controllers\Mobile;

use App\Http\Controllers\Controller;
use App\Models\AppAccount;
use App\Models\AppDevice;
use App\Models\LoginLog;
use App\Models\PhoneVerification;
use App\Support\ActivityLogger;
use App\Support\Sms;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * Senior app sign-in. The 4-digit code proves the phone; the 4-digit MPIN
 * proves the account owner. They are separate steps:
 *
 *   POST /auth/code    phone, purpose (register | login | reset_mpin)
 *   POST /auth/verify  phone, code, purpose -> verificationToken
 *   POST /auth/register    phone, verificationToken, mpin -> token, deviceKey
 *   POST /auth/login       phone, verificationToken, mpin -> token, deviceKey
 *                          phone, deviceKey, mpin -> token (trusted phone)
 *   POST /auth/mpin/reset  phone, verificationToken, mpin -> ok, deviceKey (no token)
 *   POST /auth/mpin/change currentMpin, mpin (signed in)
 *
 * The verification token is single-use, short-lived, only good for the
 * purpose its code was sent for, and stored as a sha256 hash. Codes and
 * MPINs are stored as bcrypt hashes, never logged and never returned.
 *
 * A verified code also makes the phone a trusted device: its deviceKey plus
 * the MPIN logs in again without a texted code. Forgot MPIN forgets every
 * other trusted phone. Device keys are stored as sha256 hashes.
 *
 * Errors are {"message", "code"} so the app can show its own wording:
 * invalid_phone, already_registered, account_not_found, too_many_requests,
 * sms_failed, expired, wrong_code, too_many_attempts, verification_expired,
 * device_not_trusted, weak_mpin, wrong_mpin, mpin_locked.
 */
class AuthController extends Controller
{
    private const CODE_MINUTES = 5;
    private const RESEND_SECONDS = 60;
    private const CODES_PER_HOUR = 5;
    private const TICKET_MINUTES = 10;

    public function sendCode(Request $request): JsonResponse
    {
        $phone = $this->validPhone($request);
        $purpose = $this->purpose($request);

        $registered = AppAccount::where('phone', $phone)->first()?->isRegistered() ?? false;
        if ($purpose === 'register' && $registered) {
            return $this->fail(409, 'already_registered', 'This mobile number is already registered. Please log in instead.');
        }
        if ($purpose !== 'register' && ! $registered) {
            return $this->fail(404, 'account_not_found', 'Account not found. Please create an account first.');
        }

        $last = PhoneVerification::where('phone', $phone)->latest('id')->first();
        $since = $last ? (int) abs(now()->diffInSeconds($last->created_at)) : PHP_INT_MAX;
        if ($since < self::RESEND_SECONDS) {
            return $this->fail(429, 'too_many_requests', 'Please wait a moment before asking for a new code.',
                ['retryAfter' => self::RESEND_SECONDS - $since]);
        }
        if (PhoneVerification::where('phone', $phone)->where('created_at', '>', now()->subHour())->count() >= self::CODES_PER_HOUR) {
            return $this->fail(429, 'too_many_requests', 'Too many codes were asked for. Please try again in an hour.',
                ['retryAfter' => 3600]);
        }

        // A new code replaces any older one that was not used.
        PhoneVerification::where('phone', $phone)->whereNull('consumed_at')->update(['consumed_at' => now()]);

        $code = str_pad((string) random_int(0, 9999), 4, '0', STR_PAD_LEFT);
        $verification = PhoneVerification::create([
            'phone' => $phone,
            'purpose' => $purpose,
            'code_hash' => Hash::make($code),
            'expires_at' => now()->addMinutes(self::CODE_MINUTES),
        ]);

        try {
            Sms::send($phone, "Your SCMS code is {$code}. It expires in " . self::CODE_MINUTES
                . ' minutes. Do not share it with anyone. OSCA will never ask for it.');
        } catch (\Throwable $error) {
            $verification->delete();
            report($error);

            return $this->fail(503, 'sms_failed', 'We could not send the code right now. Please try again later.');
        }

        return response()->json([
            'message' => 'We sent a code to your phone.',
            'expiresIn' => self::CODE_MINUTES * 60,
            'resendIn' => self::RESEND_SECONDS,
        ]);
    }

    public function verifyCode(Request $request): JsonResponse
    {
        $phone = $this->validPhone($request);
        $purpose = $this->purpose($request);
        $code = $request->validate(['code' => ['required', 'regex:/^\d{4}$/']], ['code.regex' => 'Enter the 4-digit code.'])['code'];

        $verification = PhoneVerification::where('phone', $phone)
            ->where('purpose', $purpose)
            ->whereNull('consumed_at')
            ->latest('id')
            ->first();

        if (! $verification || $verification->expires_at->isPast()) {
            return $this->fail(422, 'expired', 'This code has expired. Please request a new code.');
        }

        if ($verification->attempts >= PhoneVerification::MAX_ATTEMPTS) {
            return $this->fail(429, 'too_many_attempts', 'Too many attempts. Please request a new code.');
        }

        if (! Hash::check($code, $verification->code_hash)) {
            $verification->increment('attempts');
            $left = PhoneVerification::MAX_ATTEMPTS - $verification->attempts;

            return $left <= 0
                ? $this->fail(429, 'too_many_attempts', 'Too many attempts. Please request a new code.')
                : $this->fail(422, 'wrong_code', 'That code is incorrect. Please try again.', ['attemptsLeft' => $left]);
        }

        $ticket = Str::random(64);
        $verification->update([
            'consumed_at' => now(),
            'ticket_hash' => hash('sha256', $ticket),
            'ticket_expires_at' => now()->addMinutes(self::TICKET_MINUTES),
        ]);

        return response()->json([
            'verificationToken' => $ticket,
            'expiresIn' => self::TICKET_MINUTES * 60,
        ]);
    }

    /**
     * Create Account: the name, the verified phone and the new MPIN make the
     * account, and it gets a session.
     */
    public function register(Request $request): JsonResponse
    {
        $phone = $this->validPhone($request);
        $name = $this->validName($request);
        $mpin = $this->validMpin($request, 'mpin');
        $verification = $this->redeem($request, $phone, 'register');
        $this->rejectWeakMpin($mpin, $verification);

        $account = DB::transaction(function () use ($phone, $name, $mpin, $verification) {
            $account = AppAccount::where('phone', $phone)->lockForUpdate()->first() ?? new AppAccount(['phone' => $phone]);
            if ($account->isRegistered()) {
                throw new HttpResponseException($this->fail(409, 'already_registered',
                    'This mobile number is already registered. Please log in instead.'));
            }

            $account->fill($name + [
                'full_name' => collect([$name['first_name'], $name['middle_name'], $name['last_name'], $name['suffix']])
                    ->filter()->implode(' '),
            ]);
            $account->mpin_hash = Hash::make($mpin);
            $account->mpin_attempts = 0;
            $account->mpin_locked_until = null;
            $account->last_login_at = now();
            $account->save();
            $verification->update(['ticket_hash' => null]);

            return $account;
        });

        ActivityLogger::record('Senior App', 'Account created', null, $account,
            $account->displayPhone(), userName: "{$account->full_name} (app)");
        LoginLog::record($account->id, LoginLog::TYPE_APP_USER, $request);

        return response()->json([
            'token' => $account->createToken('senior-app')->plainTextToken,
            'deviceKey' => $this->trustDevice($account),
            'account' => ProfileController::present($account),
        ], 201);
    }

    /**
     * Login: the right MPIN gets a session, on a phone proved either by a
     * verified code just now or by its deviceKey from an earlier code.
     */
    public function login(Request $request): JsonResponse
    {
        $phone = $this->validPhone($request);
        $mpin = $this->validMpin($request, 'mpin');
        $deviceKey = (string) $request->input('deviceKey', '');

        if ($deviceKey !== '') {
            $account = $this->registeredAccount($phone);
            $device = $account->devices()->where('key_hash', hash('sha256', $deviceKey))->first();
            if (! $device) {
                return $this->fail(422, 'device_not_trusted',
                    'Please confirm this phone with a code first.');
            }
            $this->checkMpin($account, $mpin);
            $device->update(['last_used_at' => now()]);
            $newDeviceKey = null;
        } else {
            $verification = $this->redeem($request, $phone, 'login');
            $account = $this->registeredAccount($phone);
            $this->checkMpin($account, $mpin);
            $verification->update(['ticket_hash' => null]);
            $newDeviceKey = $this->trustDevice($account);
        }

        // Deactivated accounts can't sign in. Checked after the MPIN so a
        // deactivated account is not revealed to someone guessing MPINs.
        if (! $account->isActive()) {
            ActivityLogger::record('Senior App', 'Login blocked', 'A deactivated account tried to log in.', $account,
                $account->displayPhone(), userName: ($account->full_name ?: $account->displayPhone()) . ' (app)');

            return $this->fail(403, 'account_deactivated',
                'This account has been deactivated. Please contact OSCA.');
        }

        $account->last_login_at = now();
        $account->save();
        LoginLog::record($account->id, LoginLog::TYPE_APP_USER, $request);

        ActivityLogger::record('Senior App', 'Signed in', null, $account,
            $account->displayPhone(), userName: ($account->full_name ?: $account->displayPhone()) . ' (app)');

        return response()->json(array_filter([
            'token' => $account->createToken('senior-app')->plainTextToken,
            'deviceKey' => $newDeviceKey,
            'account' => ProfileController::present($account),
        ], fn ($value) => $value !== null));
    }

    /**
     * Forgot MPIN: a new MPIN after a verified code. Signs out everywhere and
     * forgets every trusted phone except this one.
     */
    public function resetMpin(Request $request): JsonResponse
    {
        $phone = $this->validPhone($request);
        $mpin = $this->validMpin($request, 'mpin');
        $verification = $this->redeem($request, $phone, 'reset');
        $this->rejectWeakMpin($mpin, $verification);

        $account = $this->registeredAccount($phone);
        $account->mpin_hash = Hash::make($mpin);
        $account->mpin_attempts = 0;
        $account->mpin_locked_until = null;
        $account->save();
        $account->tokens()->delete();
        $account->devices()->delete();
        $verification->update(['ticket_hash' => null]);

        ActivityLogger::record('Senior App', 'MPIN reset', null, $account,
            $account->displayPhone(), userName: ($account->full_name ?: $account->displayPhone()) . ' (app)');

        return response()->json(['ok' => true, 'deviceKey' => $this->trustDevice($account)]);
    }

    /** Account > Change MPIN (signed in). Other sessions are signed out. */
    public function changeMpin(Request $request): JsonResponse
    {
        $current = $this->validMpin($request, 'currentMpin');
        $mpin = $this->validMpin($request, 'mpin');

        $account = $request->user();
        $this->checkMpin($account, $current);
        $this->rejectWeakMpin($mpin);
        if ($mpin === $current) {
            return $this->fail(422, 'weak_mpin', 'Please choose a different MPIN from your current one.');
        }

        $account->mpin_hash = Hash::make($mpin);
        $account->save();
        $account->tokens()->where('id', '!=', $account->currentAccessToken()?->id)->delete();

        ActivityLogger::record('Senior App', 'MPIN changed', null, $account,
            $account->displayPhone(), userName: ($account->full_name ?: $account->displayPhone()) . ' (app)');

        return response()->json(['ok' => true]);
    }

    public function signOut(Request $request): JsonResponse
    {
        $token = $request->user()->currentAccessToken();
        if ($token && method_exists($token, 'delete')) {
            $token->delete();
        }

        return response()->json(['message' => 'Signed out.']);
    }

    // -------------------------------------------------------------------------

    /**
     * The Create Account name. First and last name are required; the middle
     * name is required unless "I have no middle name" (noMiddleName) is
     * ticked, and then it must be empty. Same letters as the app allows.
     *
     * @return array{first_name: string, middle_name: ?string, last_name: string, suffix: ?string, no_middle_name: bool}
     */
    private function validName(Request $request): array
    {
        $tidy = fn ($v) => trim(preg_replace('/\s+/u', ' ', (string) $v));
        $first = $tidy($request->input('firstName'));
        $middle = $tidy($request->input('middleName'));
        $last = $tidy($request->input('lastName'));
        $suffix = $tidy($request->input('suffix'));
        $noMiddle = filter_var($request->input('noMiddleName', false), FILTER_VALIDATE_BOOLEAN);

        $isName = fn (string $v) => mb_strlen($v) <= 100 && preg_match("/^[\\p{L} .'\\-]+$/u", $v);
        $ok = $first !== '' && $isName($first)
            && $last !== '' && $isName($last)
            && ($noMiddle ? $middle === '' : ($middle !== '' && $isName($middle)))
            && ($suffix === '' || (mb_strlen($suffix) <= 10 && preg_match('/^[A-Za-z.]+$/', $suffix)));

        if (! $ok) {
            throw new HttpResponseException($this->fail(422, 'invalid_name',
                'Please check your name. Use letters only.'));
        }

        return [
            'first_name' => $first,
            'middle_name' => $noMiddle ? null : $middle,
            'last_name' => $last,
            'suffix' => $suffix === '' ? null : $suffix,
            'no_middle_name' => $noMiddle,
        ];
    }

    private function validPhone(Request $request): string
    {
        $phone = (string) $request->input('phone', '');
        if (! preg_match('/^9\d{9}$/', $phone)) {
            throw new HttpResponseException($this->fail(422, 'invalid_phone', 'Please enter a valid mobile number.'));
        }

        return $phone;
    }

    private function purpose(Request $request): string
    {
        $purpose = PhoneVerification::PURPOSES[(string) $request->input('purpose', '')] ?? null;
        if (! $purpose) {
            throw new HttpResponseException($this->fail(422, 'invalid_purpose', 'Please update the app and try again.'));
        }

        return $purpose;
    }

    private function validMpin(Request $request, string $field): string
    {
        $mpin = (string) $request->input($field, '');
        if (! preg_match('/^\d{4}$/', $mpin)) {
            throw new HttpResponseException($this->fail(422, 'invalid_mpin', 'Please enter exactly 4 numbers.'));
        }

        return $mpin;
    }

    /** The verified code's ticket for $purpose, or a verification_expired error. */
    private function redeem(Request $request, string $phone, string $purpose): PhoneVerification
    {
        $ticket = (string) $request->input('verificationToken', '');
        $verification = $ticket === '' ? null : PhoneVerification::where('phone', $phone)
            ->where('purpose', $purpose)
            ->where('ticket_hash', hash('sha256', $ticket))
            ->where('ticket_expires_at', '>', now())
            ->first();

        if (! $verification) {
            throw new HttpResponseException($this->fail(422, 'verification_expired',
                'Your verification has expired. Please start again.'));
        }

        return $verification;
    }

    /**
     * Trusts the phone that just verified a code: returns its new device key
     * (only the hash is kept). Only the newest few phones stay trusted.
     */
    private function trustDevice(AppAccount $account): string
    {
        $key = Str::random(64);
        $account->devices()->create([
            'key_hash' => hash('sha256', $key),
            'last_used_at' => now(),
        ]);

        $keep = $account->devices()->latest('id')->limit(AppDevice::MAX_PER_ACCOUNT)->pluck('id');
        $account->devices()->whereNotIn('id', $keep)->delete();

        return $key;
    }

    private function registeredAccount(string $phone): AppAccount
    {
        $account = AppAccount::where('phone', $phone)->first();
        if (! $account?->isRegistered()) {
            throw new HttpResponseException($this->fail(404, 'account_not_found',
                'Account not found. Please create an account first.'));
        }

        return $account;
    }

    /** Wrong MPINs count up; too many lock the account for a while. */
    private function checkMpin(AppAccount $account, string $mpin): void
    {
        if ($account->mpin_locked_until?->isFuture()) {
            throw new HttpResponseException($this->fail(423, 'mpin_locked',
                'Too many wrong MPIN tries. Please use Forgot MPIN or try again later.',
                ['retryAfter' => (int) abs(now()->diffInSeconds($account->mpin_locked_until))]));
        }

        if (Hash::check($mpin, $account->mpin_hash)) {
            if ($account->mpin_attempts || $account->mpin_locked_until) {
                $account->mpin_attempts = 0;
                $account->mpin_locked_until = null;
                $account->save();
            }

            return;
        }

        $account->mpin_attempts++;
        if ($account->mpin_attempts >= AppAccount::MAX_MPIN_ATTEMPTS) {
            $account->mpin_attempts = 0;
            $account->mpin_locked_until = now()->addMinutes(AppAccount::MPIN_LOCK_MINUTES);
            $account->save();

            ActivityLogger::record('Senior App', 'MPIN locked', 'Too many wrong MPINs.', $account,
                $account->displayPhone(), userName: ($account->full_name ?: $account->displayPhone()) . ' (app)');

            throw new HttpResponseException($this->fail(423, 'mpin_locked',
                'Too many wrong MPIN tries. Please use Forgot MPIN or try again later.',
                ['retryAfter' => AppAccount::MPIN_LOCK_MINUTES * 60]));
        }
        $account->save();

        throw new HttpResponseException($this->fail(422, 'wrong_mpin', 'Your MPIN is incorrect. Please try again.',
            ['attemptsLeft' => AppAccount::MAX_MPIN_ATTEMPTS - $account->mpin_attempts]));
    }

    /** 0000, 1111, 1234, 4321... and the code that was just texted. */
    private function rejectWeakMpin(string $mpin, ?PhoneVerification $verification = null): void
    {
        $digits = array_map('intval', str_split($mpin));
        $same = count(array_unique($digits)) === 1;
        $up = $down = true;
        for ($i = 1; $i < count($digits); $i++) {
            $up = $up && $digits[$i] === $digits[$i - 1] + 1;
            $down = $down && $digits[$i] === $digits[$i - 1] - 1;
        }
        $isCode = $verification && Hash::check($mpin, $verification->code_hash);

        if ($same || $up || $down || $isCode) {
            throw new HttpResponseException($this->fail(422, 'weak_mpin',
                'This MPIN is too easy to guess. Please choose different numbers.'));
        }
    }

    private function fail(int $status, string $code, string $message, array $extra = []): JsonResponse
    {
        return response()->json(['message' => $message, 'code' => $code] + $extra, $status);
    }
}
