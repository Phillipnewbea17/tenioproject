<?php

use App\Models\Announcement;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

it('lists active announcements for the senior app without signing in', function () {
    Announcement::create(['title' => 'Older', 'date' => '2026-09-01', 'description' => 'Old news', 'status' => 'Active']);
    Announcement::create(['title' => 'Newer', 'date' => '2026-10-01', 'description' => null, 'status' => 'Active']);
    Announcement::create(['title' => 'Pinned', 'date' => '2026-08-01', 'status' => 'Active', 'pinned' => true]);
    Announcement::create(['title' => 'Hidden', 'date' => '2026-10-02', 'status' => 'Inactive']);

    $response = $this->getJson('/api/mobile/announcements')->assertOk();

    // Pinned first, then newest first; inactive ones are left out.
    expect($response->json('*.title'))->toBe(['Pinned', 'Newer', 'Older']);

    // The shape the app reads: string id, body (never null), date with time.
    $newer = $response->json('1');
    expect($newer['id'])->toBeString()
        ->and($newer['body'])->toBe('')
        ->and($newer['date'])->toBe('2026-10-01T08:00:00');
});
