<?php

use App\Models\ActivityLog;
use App\Models\SeniorCitizen;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->staff = User::factory()->create(['name' => 'Staff Ben', 'role' => 'User']);
    $this->other = User::factory()->create(['name' => 'Staff Cora', 'role' => 'User']);
    $this->senior = SeniorCitizen::create([
        'senior_id' => 'SC-1', 'name' => 'Lola Dina', 'age' => 75, 'gender' => 'Female', 'purok' => 'Purok 3', 'status' => 'Active',
    ]);
});

function newCase($test, array $overrides = [])
{
    return $test->actingAs($test->staff)->postJson('/api/help-requests', $overrides + [
        'senior_citizen_id' => $test->senior->id,
        'category' => 'Delayed pension/assistance',
        'subject' => 'Pension not received',
        'description' => 'Q3 pension has not arrived.',
        'channel' => 'Walk-in',
        'submitted_at' => now()->subDays(3)->toDateString(),
    ]);
}

it('records a request as Pending with a reference and timeline', function () {
    $response = newCase($this)->assertCreated();

    $response->assertJsonPath('reference', 'HLP-' . now()->year . '-0001')
        ->assertJsonPath('status', 'Pending')
        ->assertJsonPath('priority', 'Normal')
        ->assertJsonPath('senior_name', 'Lola Dina')
        ->assertJsonPath('updates.0.type', 'Created');

    expect(ActivityLog::where('module', 'Help Desk')->sole()->action)->toBe('Request created');
});

it('follows the flow Pending → Working on it → Resolved → Closed', function () {
    $id = newCase($this)->json('id');

    // Assigning a pending case means someone is working on it.
    $this->actingAs($this->staff)->postJson("/api/help-requests/{$id}/assign", ['assigned_user_id' => $this->other->id])
        ->assertOk()
        ->assertJsonPath('status', 'Working on it')
        ->assertJsonPath('assigned_name', 'Staff Cora');

    $this->actingAs($this->other)->postJson("/api/help-requests/{$id}/status", ['status' => 'Resolved'])
        ->assertStatus(422); // resolution required

    $this->actingAs($this->other)->postJson("/api/help-requests/{$id}/status", [
        'status' => 'Resolved', 'resolution' => 'Coordinated with MSWDO; pension released.',
    ])->assertOk()
        ->assertJsonPath('status', 'Resolved')
        ->assertJsonPath('resolved_at', now()->toDateString())
        ->assertJsonPath('days_to_resolve', 3);

    $this->actingAs($this->other)->postJson("/api/help-requests/{$id}/status", ['status' => 'Closed'])
        ->assertOk()->assertJsonPath('status', 'Closed');

    // Closed cases can't be edited until reopened.
    $this->actingAs($this->staff)->patchJson("/api/help-requests/{$id}", [
        'category' => 'Other', 'subject' => 'x', 'description' => 'y',
    ])->assertStatus(422);

    $this->actingAs($this->staff)->postJson("/api/help-requests/{$id}/reopen", ['note' => 'Senior says only half was received.'])
        ->assertOk()
        ->assertJsonPath('status', 'Working on it')
        ->assertJsonPath('resolved_at', null);

    expect(ActivityLog::where('module', 'Help Desk')->orderBy('id')->pluck('action')->all())
        ->toBe(['Request created', 'Assigned', 'Resolved', 'Case closed', 'Reopened']);
});

it('needs a reason to close a case that was never resolved', function () {
    $id = newCase($this)->json('id');

    $this->actingAs($this->staff)->postJson("/api/help-requests/{$id}/status", ['status' => 'Closed'])->assertStatus(422);
    $this->actingAs($this->staff)->postJson("/api/help-requests/{$id}/status", ['status' => 'Closed', 'note' => 'Duplicate of HLP-2026-0002'])
        ->assertOk();
});

it('rejects invalid transitions and dates', function () {
    $id = newCase($this)->json('id');

    $this->actingAs($this->staff)->postJson("/api/help-requests/{$id}/reopen", ['note' => 'x'])->assertStatus(422);
    $this->actingAs($this->staff)->postJson("/api/help-requests/{$id}/status", [
        'status' => 'Resolved', 'resolution' => 'Done', 'resolved_at' => now()->subDays(10)->toDateString(),
    ])->assertStatus(422);

    newCase($this, ['submitted_at' => now()->addDay()->toDateString()])->assertStatus(422);
    newCase($this, ['assigned_user_id' => 99999])->assertStatus(422);
});

it('adds notes, filters the list and shows the senior help history', function () {
    $first = newCase($this)->json('id');
    newCase($this, ['category' => 'Lost or damaged OSCA ID', 'subject' => 'Lost ID', 'priority' => 'Urgent', 'assigned_user_id' => $this->staff->id]);

    $this->actingAs($this->staff)->postJson("/api/help-requests/{$first}/notes", ['note' => 'Called the senior back.'])
        ->assertCreated()->assertJsonPath('updates.0.note', 'Called the senior back.');

    $list = $this->actingAs($this->staff)->getJson('/api/help-requests')->assertOk();
    expect($list->json('counts'))->toBe(['Pending' => 1, 'Working on it' => 1, 'Resolved' => 0, 'Closed' => 0])
        ->and($list->json('mine_open'))->toBe(1);

    $this->actingAs($this->staff)->getJson('/api/help-requests?assigned=me')->assertJsonCount(1, 'requests');
    $this->actingAs($this->staff)->getJson('/api/help-requests?assigned=unassigned')->assertJsonCount(1, 'requests');
    $this->actingAs($this->staff)->getJson('/api/help-requests?search=lost')->assertJsonCount(1, 'requests');

    $this->actingAs($this->staff)->getJson("/api/help-requests/{$first}")->assertJsonCount(1, 'senior_history');
    $this->actingAs($this->staff)->getJson("/api/senior-citizens/{$this->senior->id}/help-requests")->assertJsonCount(2);
});

it('produces the help and complaint report', function () {
    $id = newCase($this)->json('id');
    newCase($this, ['category' => 'General inquiry', 'subject' => 'Schedule']);
    $this->actingAs($this->staff)->postJson("/api/help-requests/{$id}/status", ['status' => 'Resolved', 'resolution' => 'Released.']);

    $response = $this->actingAs($this->staff)->getJson('/api/reports/help')->assertOk();

    expect(collect($response->json('summary'))->pluck('value', 'label')->all())->toMatchArray([
        'Total requests / complaints' => 2, 'Pending' => 1, 'Fixed / resolved' => 1, 'Avg. days to resolve' => 3,
    ]);

    $this->actingAs($this->staff)->getJson('/api/reports/help?category=General inquiry')
        ->assertJsonPath('summary.0.value', 1);
    $this->actingAs($this->staff)->getJson('/api/reports/help?purok=Purok 9')
        ->assertJsonPath('summary.0.value', 0);
});
