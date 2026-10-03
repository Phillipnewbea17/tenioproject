<?php

use App\Models\Application;
use App\Models\BurialRequest;
use App\Models\MedicalRequest;
use App\Models\PensionRelease;
use App\Models\SeniorCitizen;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

function reportSenior(string $id, string $name, int $age, string $purok, string $created, array $extra = []): SeniorCitizen
{
    $senior = SeniorCitizen::create($extra + [
        'senior_id' => $id, 'name' => $name, 'age' => $age,
        'gender' => 'Female', 'purok' => $purok, 'status' => 'Active',
    ]);
    $senior->forceFill(['created_at' => $created])->save();

    return $senior;
}

function summaryValue($response, string $label)
{
    return collect($response->json('summary'))->firstWhere('label', $label)['value'] ?? null;
}

beforeEach(function () {
    $this->actingAs(User::factory()->create());

    reportSenior('SC-1', 'Ana', 62, 'Purok 1', '2026-01-15');
    reportSenior('SC-2', 'Ben', 71, 'Purok 2', '2026-02-10', ['gender' => 'Male']);
    reportSenior('SC-3', 'Cora', 88, 'Purok 1', '2026-03-05', ['status' => 'Deceased']);
});

it('requires authentication', function () {
    // beforeEach logs a user in; drop it for this request.
    $this->app['auth']->forgetGuards();
    $this->getJson('/api/reports/seniors')->assertUnauthorized();
});

it('summarizes seniors with purok, age group and date filters', function () {
    $all = $this->getJson('/api/reports/seniors')->assertOk();
    expect(summaryValue($all, 'Total registered seniors'))->toBe(3)
        ->and(summaryValue($all, 'Active records'))->toBe(2);

    $ages = collect($all->json('charts'))->firstWhere('id', 'by-age')['data'];
    expect(collect($ages)->pluck('value', 'label')->all())
        ->toMatchArray(['60–64' => 1, '70–74' => 1, '85–89' => 1]);

    // Trend covers every month between the first and last registration.
    $trend = collect($all->json('charts'))->firstWhere('id', 'trend')['data'];
    expect(collect($trend)->pluck('label')->all())->toBe(['2026-01', '2026-02', '2026-03']);

    $purok = $this->getJson('/api/reports/seniors?purok=purok 1')->assertOk();
    expect(summaryValue($purok, 'Total registered seniors'))->toBe(2);

    $range = $this->getJson('/api/reports/seniors?from=2026-02-01&to=2026-02-28')->assertOk();
    expect(summaryValue($range, 'Total registered seniors'))->toBe(1);
});

it('rejects an inverted date range', function () {
    $this->getJson('/api/reports/seniors?from=2026-03-01&to=2026-01-01')->assertStatus(422);
});

it('reports verification results by decision date', function () {
    Application::create([
        'application_id' => 'APP-1', 'name' => 'Dina', 'submitted_at' => '2026-03-01 09:00', 'status' => 'Verified',
        'purok' => 'Purok 1', 'valid_id_uploaded' => true, 'birth_certificate_uploaded' => true,
        'proof_residence_uploaded' => true, 'photo_uploaded' => true,
        'history' => [['date' => 'March 4, 2026 · 2:15 PM', 'action' => 'Marked as Verified']],
    ]);
    Application::create([
        'application_id' => 'APP-2', 'name' => 'Eli', 'submitted_at' => '2026-03-02 09:00', 'status' => 'Pending',
        'purok' => 'Purok 2',
    ]);

    $response = $this->getJson('/api/reports/verification?from=2026-03-01&to=2026-03-31')->assertOk();

    expect(summaryValue($response, 'Applications'))->toBe(2)
        ->and(summaryValue($response, 'Verified'))->toBe(1);

    $results = collect($response->json('tables'))->firstWhere('id', 'results-by-date')['rows'];
    expect($results)->toBe([['period' => '2026-03-04', 'verified' => 1, 'rejected' => 0, 'total' => 1]]);

    $documents = collect($response->json('tables'))->firstWhere('id', 'documents');
    expect($documents['note'])->toBe('1 of 2 applications are missing at least one document.');
});

it('combines pension, medical and burial into program reports', function () {
    PensionRelease::create(['senior_id' => 'SC-1', 'name' => 'Ana', 'period' => 'Q1 2026', 'release_date' => '2026-03-10', 'received_by' => 'Senior', 'status' => 'Released']);
    MedicalRequest::create(['reference' => 'MED-1', 'senior_name' => 'Ana', 'senior_id' => 'SC-1', 'purok' => 'Purok 1', 'assistance_type' => 'Medicine', 'request_date' => '2026-03-11', 'status' => 'Pending']);
    BurialRequest::create(['reference' => 'BUR-1', 'senior_name' => 'Cora', 'claimant_name' => 'Dan', 'senior_id' => 'SC-3', 'purok' => 'Purok 1', 'request_date' => '2026-03-12', 'status' => 'Approved']);

    $response = $this->getJson('/api/reports/programs')->assertOk();

    expect(summaryValue($response, 'Assistance records'))->toBe(3)
        ->and(summaryValue($response, 'Unique beneficiaries'))->toBe(2)
        ->and(summaryValue($response, 'Released / completed'))->toBe(1);

    // Pension purok comes from the senior record.
    $participation = collect($response->json('tables'))->firstWhere('id', 'participation')['rows'];
    expect($participation)->toBe([['purok' => 'Purok 1', 'pension' => 1, 'medical' => 1, 'burial' => 1, 'total' => 2]]);

    $medicalOnly = $this->getJson('/api/reports/programs?program=Medical')->assertOk();
    expect(summaryValue($medicalOnly, 'Assistance records'))->toBe(1)
        ->and(collect($medicalOnly->json('tables'))->firstWhere('id', 'program-status')['rows'])->toHaveCount(1);
});

it('returns filter options and the senior ID report', function () {
    $this->getJson('/api/reports/options')->assertOk()
        ->assertJsonPath('puroks', ['Purok 1', 'Purok 2']);

    $this->getJson('/api/reports/senior-ids')->assertOk()
        ->assertJsonPath('summary.0.label', 'Pending Issuance');
});
