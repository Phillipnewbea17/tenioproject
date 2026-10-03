<?php

use App\Models\ActivityLog;
use App\Models\Application;
use App\Models\SeniorCitizen;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->admin = User::factory()->create(['name' => 'Admin Ana', 'role' => 'Administrator']);
    $this->staff = User::factory()->create(['name' => 'Staff Ben', 'role' => 'User']);
});

it('logs successful and failed logins without the password', function () {
    $user = User::factory()->create(['name' => 'cora', 'password' => Hash::make('secret123')]);

    $this->postJson('/api/login', ['username' => 'cora', 'password' => 'wrong'])->assertUnauthorized();
    $this->postJson('/api/login', ['username' => 'cora', 'password' => 'secret123'])->assertOk();

    $logs = ActivityLog::orderBy('id')->get();
    expect($logs->pluck('action')->all())->toBe(['Login failed', 'Logged in'])
        ->and($logs[0]->user_name)->toBe('cora')
        ->and($logs[0]->user_id)->toBeNull()
        ->and($logs[1]->user_id)->toBe($user->id)
        ->and(json_encode($logs))->not->toContain('secret123');
});

it('records who approved a registration, with before/after values', function () {
    $application = Application::create([
        'application_id' => 'APP-2026-0001', 'name' => 'Dina', 'submitted_at' => now(), 'status' => 'Pending',
    ]);

    $this->actingAs($this->staff)
        ->patchJson("/api/applications/{$application->id}", ['status' => 'Verified', 'history' => [['action' => 'Marked as Verified']]])
        ->assertOk();

    $log = ActivityLog::where('module', 'Document Verification')->sole();

    expect($log->action)->toBe('Document approved')
        ->and($log->user_name)->toBe('Staff Ben')
        ->and($log->role)->toBe('User')
        ->and($log->record_label)->toBe('APP-2026-0001 · Dina')
        ->and($log->changes)->toBe(['status' => ['from' => 'Pending', 'to' => 'Verified']]);

    // The new staff activity table in the verification report reads these entries.
    $table = collect($this->actingAs($this->admin)->getJson('/api/reports/verification')->json('tables'))
        ->firstWhere('id', 'staff-activity');
    expect($table['rows'][0])->toMatchArray(['staff' => 'Staff Ben', 'approved' => 1, 'total' => 1]);
});

it('does not log an update that changed nothing', function () {
    $senior = SeniorCitizen::create(['senior_id' => 'SC-1', 'name' => 'Eli', 'age' => 70, 'gender' => 'Male', 'purok' => 'Purok 1', 'status' => 'Active']);

    $this->actingAs($this->staff)->patchJson("/api/senior-citizens/{$senior->id}", ['name' => 'Eli'])->assertOk();
    expect(ActivityLog::count())->toBe(0);

    $this->actingAs($this->staff)->patchJson("/api/senior-citizens/{$senior->id}", ['status' => 'Deceased'])->assertOk();
    expect(ActivityLog::sole()->action)->toBe('Status changed');
});

it('logs senior ID actions and user management without passwords', function () {
    $senior = SeniorCitizen::create(['senior_id' => 'SC-1', 'name' => 'Eli', 'age' => 70, 'gender' => 'Male', 'purok' => 'Purok 1', 'status' => 'Active']);

    $this->actingAs($this->staff)->postJson('/api/senior-ids', [
        'senior_citizen_id' => $senior->id, 'status' => 'Active', 'date_issued' => now()->toDateString(),
    ])->assertCreated();

    $this->actingAs($this->admin)->postJson("/api/users/{$this->staff->id}/reset-password", ['password' => 'newpass123'])->assertOk();

    expect(ActivityLog::where('module', 'OSCA IDs')->sole()->action)->toBe('ID issued')
        ->and(ActivityLog::where('module', 'User Management')->sole()->action)->toBe('Password reset')
        ->and(json_encode(ActivityLog::all()))->not->toContain('newpass123');
});

it('lists and filters entries for any logged-in user, newest first', function () {
    $this->actingAs($this->staff)->postJson('/api/announcements', ['title' => 'Payout', 'date' => '2026-10-01'])->assertCreated();
    $this->actingAs($this->admin)->postJson('/api/medical-requests', [
        'senior_name' => 'Eli', 'senior_id' => 'SC-1', 'assistance_type' => 'Medicine', 'request_date' => '2026-10-01', 'status' => 'Pending',
    ])->assertCreated();

    $response = $this->actingAs($this->staff)->getJson('/api/activity-logs')->assertOk();
    expect($response->json('meta.total'))->toBe(2)
        ->and($response->json('data.0.module'))->toBe('Programs');

    $this->actingAs($this->staff)->getJson('/api/activity-logs?module=Announcements')
        ->assertJsonPath('meta.total', 1)
        ->assertJsonPath('data.0.action', 'Published');

    $this->actingAs($this->staff)->getJson('/api/activity-logs?user=Admin Ana')->assertJsonPath('meta.total', 1);
    $this->actingAs($this->staff)->getJson('/api/activity-logs?search=payout')->assertJsonPath('meta.total', 1);

    $this->actingAs($this->staff)->getJson('/api/activity-logs/options')
        ->assertJsonPath('modules', ['Announcements', 'Programs']);
});

it('cannot be changed or deleted', function () {
    $log = ActivityLog::create(['module' => 'Test', 'action' => 'Created']);

    expect(fn () => $log->update(['action' => 'Edited']))->toThrow(LogicException::class)
        ->and(fn () => $log->delete())->toThrow(LogicException::class);

    $this->actingAs($this->admin)->deleteJson("/api/activity-logs/{$log->id}")->assertStatus(405);
    $this->actingAs($this->admin)->patchJson("/api/activity-logs/{$log->id}", ['action' => 'x'])->assertStatus(405);
});

it('requires login for pension releases and logs them', function () {
    $this->getJson('/api/pension-releases')->assertUnauthorized();

    $this->actingAs($this->staff)->postJson('/api/pension-releases', [
        'senior_id' => 'SC-1', 'name' => 'Eli', 'period' => 'Q4 2026', 'received_by' => 'Senior', 'status' => 'Pending',
    ])->assertCreated();

    expect(ActivityLog::sole())->action->toBe('Created')->user_name->toBe('Staff Ben');
});

it('logs printed and exported reports', function () {
    $this->actingAs($this->staff)->postJson('/api/reports/log', [
        'type' => 'seniors', 'title' => 'Registration & seniors report', 'format' => 'CSV', 'filters' => 'All dates',
    ])->assertCreated();

    expect(ActivityLog::sole())->module->toBe('Reports')->action->toBe('Report generated');
});
