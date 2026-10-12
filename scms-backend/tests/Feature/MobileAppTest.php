<?php

use App\Models\ActivityLog;
use App\Models\AppAccount;
use App\Models\Application;
use App\Models\PhoneVerification;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

uses(RefreshDatabase::class);

/**
 * Sends a code and returns it (read from the "log" SMS driver). Every code
 * is tied to what it is for: "register" is the only purpose that works on a
 * number with no account yet, so it is the default here.
 */
function requestCode($test, string $phone = '9171234567', string $purpose = 'register'): string
{
    $code = null;
    Log::spy();
    $test->postJson('/api/mobile/auth/code', ['phone' => $phone, 'purpose' => $purpose])->assertOk();
    Log::shouldHaveReceived('info')->withArgs(function ($message) use (&$code) {
        if (preg_match('/code is (\d{4})/', $message, $match)) {
            $code = $match[1];
        }

        return true;
    });

    return $code;
}

/** An MPIN the rules accept: not all one digit, not a run, not the code. */
function testMpin(string $code): string
{
    return $code === '2847' ? '5193' : '2847';
}

/**
 * A signed-in account, the way the app gets one: a texted code proves the
 * phone, the code is traded for a short-lived verification ticket, and that
 * ticket plus a name and a new MPIN creates the account and its session.
 */
function signIn($test, string $phone = '9171234567'): string
{
    $code = requestCode($test, $phone);

    $ticket = $test->postJson('/api/mobile/auth/verify', [
        'phone' => $phone, 'purpose' => 'register', 'code' => $code,
    ])->assertOk()->json('verificationToken');

    return $test->postJson('/api/mobile/auth/register', [
        'phone' => $phone,
        'verificationToken' => $ticket,
        'firstName' => 'Ana',
        'middleName' => 'Santos',
        'lastName' => 'Dela Cruz',
        'mpin' => testMpin($code),
    ])->assertCreated()->json('token');
}

function withToken($test, string $token)
{
    // Reset the resolved user so each request authenticates with its own token.
    app('auth')->forgetGuards();

    return $test->withHeader('Authorization', "Bearer {$token}");
}

it('signs in with a texted code and rejects wrong or reused codes', function () {
    $this->postJson('/api/mobile/auth/code', ['phone' => '12345', 'purpose' => 'register'])->assertStatus(422);

    // A code is always for something; the app says which.
    $this->postJson('/api/mobile/auth/code', ['phone' => '9171234567'])
        ->assertStatus(422)->assertJsonPath('code', 'invalid_purpose');

    $code = requestCode($this);

    // A new code can't be requested again straight away.
    $this->postJson('/api/mobile/auth/code', ['phone' => '9171234567', 'purpose' => 'register'])
        ->assertStatus(429);

    $wrong = $code === '1111' ? '2222' : '1111';
    $this->postJson('/api/mobile/auth/verify', ['phone' => '9171234567', 'purpose' => 'register', 'code' => $wrong])
        ->assertStatus(422)->assertJsonPath('code', 'wrong_code');

    // The right code buys a short-lived ticket, not a session.
    $ticket = $this->postJson('/api/mobile/auth/verify', ['phone' => '9171234567', 'purpose' => 'register', 'code' => $code])
        ->assertOk()
        ->assertJsonStructure(['verificationToken', 'expiresIn'])
        ->json('verificationToken');

    // Used codes don't work twice.
    $this->postJson('/api/mobile/auth/verify', ['phone' => '9171234567', 'purpose' => 'register', 'code' => $code])
        ->assertStatus(422)->assertJsonPath('code', 'expired');

    // The ticket, a name and a new MPIN make the account.
    $deviceKey = $this->postJson('/api/mobile/auth/register', [
        'phone' => '9171234567',
        'verificationToken' => $ticket,
        'firstName' => 'Ana',
        'middleName' => 'Santos',
        'lastName' => 'Dela Cruz',
        'mpin' => testMpin($code),
    ])->assertCreated()
        ->assertJsonStructure(['token', 'deviceKey', 'account' => ['phone', 'fullName', 'role']])
        ->assertJsonPath('account.phone', '9171234567')
        ->json('deviceKey');

    expect(AppAccount::count())->toBe(1)
        ->and(ActivityLog::where('action', 'Account created')->sole()->user_id)->toBeNull();

    // The phone is trusted now, so the MPIN alone signs in again.
    $this->postJson('/api/mobile/auth/login', [
        'phone' => '9171234567', 'mpin' => testMpin($code), 'deviceKey' => $deviceKey,
    ])->assertOk()->assertJsonStructure(['token']);

    expect(ActivityLog::where('action', 'Signed in')->sole()->user_id)->toBeNull();
});

it('locks a code after too many wrong tries', function () {
    $code = requestCode($this);
    $wrong = $code === '1111' ? '2222' : '1111';
    $verify = fn (string $c) => ['phone' => '9171234567', 'purpose' => 'register', 'code' => $c];

    // Four wrong tries still say "wrong code" and count down.
    for ($i = 0; $i < PhoneVerification::MAX_ATTEMPTS - 1; $i++) {
        $this->postJson('/api/mobile/auth/verify', $verify($wrong))
            ->assertStatus(422)->assertJsonPath('code', 'wrong_code');
    }

    // The last one uses the code up.
    $this->postJson('/api/mobile/auth/verify', $verify($wrong))
        ->assertStatus(429)->assertJsonPath('code', 'too_many_attempts');

    // Even the right code is refused now; a new one has to be requested.
    $this->postJson('/api/mobile/auth/verify', $verify($code))
        ->assertStatus(429)->assertJsonPath('code', 'too_many_attempts');
});

it('keeps app tokens and staff tokens apart', function () {
    $appToken = signIn($this);
    $staffToken = User::factory()->create(['role' => 'Administrator'])->createToken('web')->plainTextToken;

    withToken($this, $appToken)->getJson('/api/mobile/profile')->assertOk();
    withToken($this, $appToken)->getJson('/api/dashboard')->assertForbidden();
    withToken($this, $appToken)->getJson('/api/senior-citizens')->assertForbidden();
    withToken($this, $appToken)->getJson('/api/applications')->assertForbidden();

    withToken($this, $staffToken)->getJson('/api/dashboard')->assertOk();
    withToken($this, $staffToken)->getJson('/api/mobile/profile')->assertForbidden();
});

it('registers from the app and follows the real status', function () {
    Storage::fake('local');
    $token = signIn($this);
    $staff = User::factory()->create(['name' => 'Staff Ben', 'role' => 'User'])->createToken('web')->plainTextToken;

    // Profile from the app (UserProfile.toJson shape).
    withToken($this, $token)->postJson('/api/mobile/profile', [
        'phone' => '9171234567', 'fullName' => 'Lola Ana Cruz', 'role' => 'senior', 'birthDate' => '1955-03-14T00:00:00.000',
        'barangay' => 'Los Angeles', 'municipality' => 'Ubay', 'province' => 'Bohol',
    ])->assertOk()->assertJsonPath('profile.birthDate', '1955-03-14');

    withToken($this, $token)->getJson('/api/mobile/application')->assertJsonPath('stage', 'notStarted');

    // create() not image(): the endpoint only checks the mime type and the
    // size, and image() would need the GD extension, which this PHP build
    // does not ship.
    $upload = fn (string $type, string $clientId) => withToken($this, $token)->post('/api/mobile/documents', [
        'file' => UploadedFile::fake()->create("{$clientId}.jpg", 40, 'image/jpeg'), 'type' => $type, 'clientId' => $clientId,
    ], ['Accept' => 'application/json']);

    // The same four papers Document Verification lists.
    $upload('validId', 'validId-1')->assertCreated();
    $upload('birthCertificate', 'birthCertificate-1')->assertCreated();
    $upload('proofOfResidence', 'proofOfResidence-1')->assertCreated();

    // Missing the 2x2 photo.
    withToken($this, $token)->postJson('/api/mobile/application/submit', [
        'documents' => ['validId-1', 'birthCertificate-1', 'proofOfResidence-1'],
    ])->assertStatus(422);

    $upload('idPhoto', 'idPhoto-1')->assertCreated();
    $upload('idPhoto', 'idPhoto-1')->assertCreated(); // re-sent: replaces, doesn't duplicate

    $reference = withToken($this, $token)->postJson('/api/mobile/application/submit', [
        'documents' => ['validId-1', 'birthCertificate-1', 'proofOfResidence-1', 'idPhoto-1'],
    ])->assertCreated()->json('reference');

    $application = Application::where('application_id', $reference)->sole();
    expect($application)->source->toBe('App')->status->toBe('Pending')->name->toBe('Lola Ana Cruz')
        ->contact->toBe('09171234567')->valid_id_uploaded->toBeTrue()->birth_certificate_uploaded->toBeTrue()
        ->proof_residence_uploaded->toBeTrue()->photo_uploaded->toBeTrue();

    // Can't submit twice while it's being checked.
    withToken($this, $token)->postJson('/api/mobile/application/submit', ['documents' => ['x']])->assertStatus(422);

    withToken($this, $token)->getJson('/api/mobile/application')
        ->assertJsonPath('applicationNo', $reference)
        ->assertJsonPath('stage', 'submitted')
        ->assertJsonPath('history.0.stage', 'submitted');

    // Staff see the photos in Document Verification.
    $documents = withToken($this, $staff)->getJson("/api/applications/{$application->id}/documents")->assertOk()->json();
    expect($documents)->toHaveCount(4)
        ->and(collect($documents)->pluck('type')->sort()->values()->all())
        ->toBe(['birthCertificate', 'idPhoto', 'proofOfResidence', 'validId']);
    withToken($this, $staff)->get("/api/application-documents/{$documents[0]['id']}/file")->assertOk();
    withToken($this, $token)->get("/api/application-documents/{$documents[0]['id']}/file")->assertForbidden();

    // Staff reject it: the app shows "needs action" with the reason.
    withToken($this, $staff)->patchJson("/api/applications/{$application->id}", [
        'status' => 'Rejected', 'notes' => 'The barangay certificate is blurry.',
        'history' => array_merge($application->history, [['date' => 'October 4, 2026 · 2:15 PM', 'action' => 'Marked as Rejected']]),
    ])->assertOk();

    withToken($this, $token)->getJson('/api/mobile/application')
        ->assertJsonPath('stage', 'needsAction')
        ->assertJsonPath('history.1.stage', 'needsAction')
        ->assertJsonPath('message', 'The OSCA office needs you to fix your papers: The barangay certificate is blurry. Please upload them again.');

    // Resubmit with a new photo: same application, back to Pending, old photos replaced.
    $upload('proofOfResidence', 'proofOfResidence-2')->assertCreated();
    $upload('validId', 'validId-2')->assertCreated();
    $upload('birthCertificate', 'birthCertificate-2')->assertCreated();
    $upload('idPhoto', 'idPhoto-2')->assertCreated();
    withToken($this, $token)->postJson('/api/mobile/application/submit', [
        'documents' => ['validId-2', 'birthCertificate-2', 'proofOfResidence-2', 'idPhoto-2'],
    ])->assertCreated()->assertJsonPath('reference', $reference);

    expect($application->fresh()->status)->toBe('Pending')
        ->and($application->documents()->count())->toBe(4)
        ->and(Storage::disk('local')->allFiles())->toHaveCount(4);

    // Approved.
    withToken($this, $staff)->patchJson("/api/applications/{$application->id}", ['status' => 'Verified'])->assertOk();
    withToken($this, $token)->getJson('/api/mobile/application')->assertJsonPath('stage', 'approved');

    expect(ActivityLog::where('action', 'Submitted from app')->sole()->user_name)->toBe('Lola Ana Cruz (app)');
});

it('needs a name before submitting', function () {
    Storage::fake('local');
    $token = signIn($this);

    // Create Account asks for a name, but Personal Information lets an
    // unlinked account clear it again, and an application cannot be filed
    // without one.
    AppAccount::where('phone', '9171234567')->update(['full_name' => null]);

    withToken($this, $token)->postJson('/api/mobile/application/submit', ['documents' => ['a']])
        ->assertStatus(422)->assertJsonPath('message', 'Please add your full name in your profile first.');
});
