<?php

use App\Models\Application;
use App\Models\HelpRequest;
use App\Models\SeniorCitizen;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;

uses(RefreshDatabase::class);

afterEach(fn () => Carbon::setTestNow());

it('requires login', function () {
    $this->getJson('/api/dashboard')->assertUnauthorized();
});

it('summarises every module in one response', function () {
    Carbon::setTestNow('2026-12-30 09:00:00');
    $user = User::factory()->create(['role' => 'User']);

    Application::create(['application_id' => 'APP-1', 'name' => 'Ana', 'submitted_at' => now(), 'status' => 'Pending']);
    Application::create(['application_id' => 'APP-2', 'name' => 'Ben', 'submitted_at' => now(), 'status' => 'Verified']);

    $senior = SeniorCitizen::create([
        'senior_id' => 'SC-1', 'name' => 'Cora', 'age' => 69, 'gender' => 'Female', 'purok' => 'Purok 1',
        'status' => 'Active', 'birth_date' => '1957-01-02',
    ]);
    SeniorCitizen::create([
        'senior_id' => 'SC-2', 'name' => 'Dan', 'age' => 80, 'gender' => 'Male', 'purok' => 'Purok 1',
        'status' => 'Needs follow-up', 'birth_date' => '1946-12-30',
    ]);

    HelpRequest::create([
        'reference' => 'HLP-1', 'senior_citizen_id' => $senior->id, 'senior_name' => 'Cora', 'category' => 'Other',
        'subject' => 'x', 'description' => 'y', 'priority' => 'Urgent', 'status' => 'Working on it',
        'assigned_user_id' => $user->id, 'submitted_at' => now()->toDateString(),
    ]);

    $response = $this->actingAs($user)->getJson('/api/dashboard')->assertOk();

    $response->assertJsonPath('applications.total', 2)
        ->assertJsonPath('applications.pending', 1)
        ->assertJsonPath('applications.verified', 1)
        ->assertJsonPath('applications.recent.0.name', 'Ana')
        ->assertJsonPath('seniors.total', 2)
        ->assertJsonPath('seniors.needs_attention', 1)
        ->assertJsonPath('senior_ids.without_id', 2)
        ->assertJsonPath('help.working', 1)
        ->assertJsonPath('help.urgent_open', 1)
        ->assertJsonPath('help.mine_open', 1)
        ->assertJsonPath('funds.allocated', 0);

    // Birthdays wrap into next year: Dan today, Cora on Jan 2.
    $response->assertJsonPath('birthdays.today', 1)
        ->assertJsonPath('birthdays.next_7_days', 2)
        ->assertJsonPath('birthdays.upcoming.0.name', 'Dan')
        ->assertJsonPath('birthdays.upcoming.0.turning', 80)
        ->assertJsonPath('birthdays.upcoming.1.date', '2027-01-02')
        ->assertJsonPath('birthdays.upcoming.1.days_until', 3);
});
