<?php

use App\Models\SeniorCitizen;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

it('never deletes a senior record', function () {
    $senior = SeniorCitizen::create([
        'senior_id' => 'SC-1', 'name' => 'Ana', 'age' => 70, 'gender' => 'Female', 'purok' => 'Purok 1', 'status' => 'Active',
    ]);
    $admin = User::factory()->create(['role' => 'Administrator']);

    $this->actingAs($admin)->deleteJson("/api/senior-citizens/{$senior->id}")->assertStatus(405);

    expect(SeniorCitizen::find($senior->id))->not->toBeNull();

    // Archiving is the supported way to retire a record.
    $this->actingAs($admin)->patchJson("/api/senior-citizens/{$senior->id}", ['status' => 'Archived'])
        ->assertOk()->assertJsonPath('status', 'Archived');
});

it('shows the issued ID as the OSCA ID in Records', function () {
    $senior = SeniorCitizen::create([
        'senior_id' => 'SC-1', 'name' => 'Ana', 'age' => 70, 'gender' => 'Female', 'purok' => 'Purok 1', 'status' => 'Active',
    ]);
    $user = User::factory()->create();

    $this->actingAs($user)->getJson('/api/senior-citizens')
        ->assertJsonPath('0.osca', null)
        ->assertJsonMissingPath('0.osca_id');

    $issued = $this->actingAs($user)->postJson('/api/senior-ids', [
        'senior_citizen_id' => $senior->id, 'status' => 'Active', 'date_issued' => now()->toDateString(),
    ])->json('id_number');

    $this->actingAs($user)->getJson('/api/senior-citizens')
        ->assertJsonPath('0.osca.id_number', $issued)
        ->assertJsonPath('0.osca.status', 'Active');

    // Editing the record keeps the OSCA ID in the response.
    $this->actingAs($user)->patchJson("/api/senior-citizens/{$senior->id}", ['contact' => '09171234567'])
        ->assertJsonPath('osca.id_number', $issued);
});
