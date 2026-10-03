<?php

use App\Models\SeniorCitizen;
use App\Models\SeniorId;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

function makeSenior(array $overrides = []): SeniorCitizen
{
    static $count = 0;
    $count++;

    return SeniorCitizen::create($overrides + [
        'senior_id' => 'SC-2026-' . str_pad($count, 4, '0', STR_PAD_LEFT),
        'name' => "Senior {$count}",
        'age' => 70,
        'gender' => 'Female',
        'purok' => 'Purok 1',
        'status' => 'Active',
    ]);
}

function staff(string $role = 'User'): User
{
    return User::factory()->create(['role' => $role]);
}

beforeEach(function () {
    $this->admin = staff('Administrator');
    $this->user = staff();
    $this->senior = makeSenior();
});

it('requires authentication', function () {
    $this->getJson('/api/senior-ids')->assertUnauthorized();
});

it('issues an active ID with a sequential number and history', function () {
    $response = $this->actingAs($this->user)->postJson('/api/senior-ids', [
        'senior_citizen_id' => $this->senior->id,
        'status' => 'Active',
        'date_issued' => now()->toDateString(),
    ])->assertCreated();

    $year = now()->year;
    $response->assertJsonPath('id_number', "LA-SC-{$year}-0001")
        ->assertJsonPath('status', 'Active')
        ->assertJsonPath('issued_by', $this->user->name)
        ->assertJsonPath('senior.name', $this->senior->name)
        ->assertJsonPath('history.0.action', 'Issued');

    $this->actingAs($this->user)->postJson('/api/senior-ids', [
        'senior_citizen_id' => makeSenior()->id,
        'status' => 'Pending Issuance',
    ])->assertCreated()->assertJsonPath('id_number', "LA-SC-{$year}-0002")
        ->assertJsonPath('date_issued', null);
});

it('refuses a second current ID for the same senior', function () {
    SeniorId::create(['id_number' => 'X-1', 'senior_citizen_id' => $this->senior->id, 'status' => 'Active']);

    $this->actingAs($this->user)->postJson('/api/senior-ids', [
        'senior_citizen_id' => $this->senior->id,
        'status' => 'Pending Issuance',
    ])->assertStatus(422);
});

it('refuses deceased seniors', function () {
    $this->actingAs($this->user)->postJson('/api/senior-ids', [
        'senior_citizen_id' => makeSenior(['status' => 'Deceased'])->id,
        'status' => 'Pending Issuance',
    ])->assertStatus(422);
});

it('activates a pending ID', function () {
    $id = SeniorId::create(['id_number' => 'X-1', 'senior_citizen_id' => $this->senior->id, 'status' => 'Pending Issuance']);

    $this->actingAs($this->user)->postJson("/api/senior-ids/{$id->id}/activate", [
        'date_issued' => now()->toDateString(),
    ])->assertOk()->assertJsonPath('status', 'Active');

    $this->actingAs($this->user)->postJson("/api/senior-ids/{$id->id}/activate", [
        'date_issued' => now()->toDateString(),
    ])->assertStatus(422);
});

it('runs the replacement flow', function () {
    $id = SeniorId::create([
        'id_number' => 'LA-SC-2020-0001',
        'senior_citizen_id' => $this->senior->id,
        'status' => 'Active',
        'date_issued' => '2020-01-01',
    ]);

    $this->actingAs($this->user)->postJson("/api/senior-ids/{$id->id}/request-replacement", [
        'reason' => 'Lost',
        'date_requested' => now()->subDay()->toDateString(),
    ])->assertOk()->assertJsonPath('status', 'For Replacement');

    $response = $this->actingAs($this->user)->postJson("/api/senior-ids/{$id->id}/replace", [
        'reason' => 'Lost',
    ])->assertCreated();

    $response->assertJsonPath('previous.status', 'Inactive')
        ->assertJsonPath('replacement.status', 'Active')
        ->assertJsonPath('previous.replaced_by', $response->json('replacement.id_number'))
        ->assertJsonPath('replacement.history.0.previous_id_number', 'LA-SC-2020-0001')
        ->assertJsonPath('replacement.history.0.date_requested', now()->subDay()->toDateString());

    // The senior can be looked up and the old ID now shows the full history.
    $this->actingAs($this->user)->getJson("/api/senior-ids/{$id->id}")
        ->assertJsonCount(2, 'history')
        ->assertJsonPath('history.0.action', 'Replaced');
});

it('limits update and deactivation to administrators', function () {
    $id = SeniorId::create(['id_number' => 'X-1', 'senior_citizen_id' => $this->senior->id, 'status' => 'Active', 'date_issued' => '2026-01-01']);

    $this->actingAs($this->user)->patchJson("/api/senior-ids/{$id->id}", ['remarks' => 'x'])->assertForbidden();
    $this->actingAs($this->user)->postJson("/api/senior-ids/{$id->id}/deactivate", ['remarks' => 'x'])->assertForbidden();

    $this->actingAs($this->admin)->patchJson("/api/senior-ids/{$id->id}", ['remarks' => 'Corrected'])
        ->assertOk()->assertJsonPath('remarks', 'Corrected')
        ->assertJsonPath('history.0.action', 'Updated');

    $this->actingAs($this->admin)->patchJson("/api/senior-ids/{$id->id}", ['date_issued' => null])
        ->assertStatus(422);

    $this->actingAs($this->admin)->postJson("/api/senior-ids/{$id->id}/deactivate", ['remarks' => 'Senior moved away'])
        ->assertOk()->assertJsonPath('status', 'Inactive');

    // Once inactive, a new ID may be issued again.
    $this->actingAs($this->user)->postJson('/api/senior-ids', [
        'senior_citizen_id' => $this->senior->id,
        'status' => 'Pending Issuance',
    ])->assertCreated();
});
