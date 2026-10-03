<?php

use App\Models\ActivityLog;
use App\Models\Fund;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->admin = User::factory()->create(['name' => 'Admin Ana', 'role' => 'Administrator']);
    $this->staff = User::factory()->create(['name' => 'Staff Ben', 'role' => 'User']);
});

function createFund($test, array $overrides = [])
{
    return $test->actingAs($test->admin)->postJson('/api/funds', $overrides + [
        'name' => 'Social Pension 2026',
        'source' => 'DSWD',
        'category' => 'Pension',
        'fiscal_year' => 2026,
        'initial_allocation' => '100000.00',
        'allocation_date' => now()->toDateString(),
    ]);
}

function addTransaction($test, $user, int $fundId, array $data)
{
    return $test->actingAs($user)->postJson("/api/funds/{$fundId}/transactions", $data + [
        'program' => 'Pension',
        'transaction_date' => now()->toDateString(),
    ]);
}

it('creates a fund with an initial allocation and a reference number', function () {
    $response = createFund($this)->assertCreated();

    $response->assertJsonPath('reference', 'FND-' . now()->year . '-0001')
        ->assertJsonPath('status', 'Active')
        ->assertJsonPath('totals.allocated', 100000)
        ->assertJsonPath('totals.remaining', 100000)
        ->assertJsonPath('transactions.0.type', 'Allocation');

    expect(ActivityLog::where('module', 'Funds')->orderBy('id')->pluck('action')->all())
        ->toBe(['Fund created', 'Funds allocated']);
});

it('only lets administrators create funds and allocate', function () {
    $this->actingAs($this->staff)->postJson('/api/funds', [
        'name' => 'X', 'source' => 'Y', 'category' => 'Pension', 'fiscal_year' => 2026,
    ])->assertForbidden();

    $fundId = createFund($this)->json('id');
    addTransaction($this, $this->staff, $fundId, ['type' => 'Allocation', 'amount' => 10])->assertForbidden();
});

it('moves money through allocation, release and disbursement with exact centavos', function () {
    $fundId = createFund($this, ['initial_allocation' => '0.30'])->json('id');

    addTransaction($this, $this->staff, $fundId, ['type' => 'Release', 'amount' => '0.10'])->assertCreated();
    addTransaction($this, $this->staff, $fundId, ['type' => 'Release', 'amount' => '0.20'])->assertCreated();
    $response = addTransaction($this, $this->staff, $fundId, ['type' => 'Disbursement', 'amount' => '0.30', 'recipient' => 'Ana'])->assertCreated();

    // 0.1 + 0.2 is exactly 0.3 here (no floating-point drift).
    $response->assertJsonPath('totals.released', 0.3)
        ->assertJsonPath('totals.disbursed', 0.3)
        ->assertJsonPath('totals.remaining', 0)
        ->assertJsonPath('totals.on_hand', 0);
});

it('refuses to release more than allocated or disburse more than released', function () {
    $fundId = createFund($this)->json('id');

    addTransaction($this, $this->staff, $fundId, ['type' => 'Release', 'amount' => '100000.01'])
        ->assertStatus(422)
        ->assertJsonPath('message', 'Only ₱100,000.00 is allocated to Pension and not yet released in this fund.');

    addTransaction($this, $this->staff, $fundId, ['type' => 'Release', 'amount' => 40000])->assertCreated();
    addTransaction($this, $this->staff, $fundId, ['type' => 'Disbursement', 'amount' => 40000.01])->assertStatus(422);

    // Money allocated to Pension can't be released for another program.
    addTransaction($this, $this->staff, $fundId, ['type' => 'Release', 'amount' => 1, 'program' => 'Medical Assistance'])->assertStatus(422);
});

it('rejects amounts with more than two decimals or zero', function () {
    $fundId = createFund($this)->json('id');

    addTransaction($this, $this->admin, $fundId, ['type' => 'Allocation', 'amount' => '10.555'])->assertStatus(422);
    addTransaction($this, $this->admin, $fundId, ['type' => 'Allocation', 'amount' => '0'])->assertStatus(422);
});

it('voids transactions only when balances stay consistent', function () {
    $fund = createFund($this)->json();
    $allocationId = $fund['transactions'][0]['id'];

    $release = addTransaction($this, $this->staff, $fund['id'], ['type' => 'Release', 'amount' => 5000])->json('transactions.0');

    $this->actingAs($this->staff)->postJson("/api/funds/{$fund['id']}/transactions/{$release['id']}/void", ['reason' => 'x'])->assertForbidden();

    // The allocation can't be voided while part of it is released.
    $this->actingAs($this->admin)->postJson("/api/funds/{$fund['id']}/transactions/{$allocationId}/void", ['reason' => 'Wrong amount'])
        ->assertStatus(422);

    $this->actingAs($this->admin)->postJson("/api/funds/{$fund['id']}/transactions/{$release['id']}/void", ['reason' => 'Duplicate entry'])
        ->assertOk()
        ->assertJsonPath('totals.released', 0)
        ->assertJsonPath('transactions.0.void_reason', 'Duplicate entry');

    $this->actingAs($this->admin)->postJson("/api/funds/{$fund['id']}/transactions/{$allocationId}/void", ['reason' => 'Wrong amount'])
        ->assertOk()
        ->assertJsonPath('totals.allocated', 0);
});

it('blocks changes to a closed fund until it is reopened', function () {
    $fundId = createFund($this)->json('id');

    $this->actingAs($this->admin)->postJson("/api/funds/{$fundId}/close", ['remarks' => 'End of year'])
        ->assertOk()->assertJsonPath('status', 'Closed');

    addTransaction($this, $this->staff, $fundId, ['type' => 'Release', 'amount' => 1])->assertStatus(422);

    $this->actingAs($this->admin)->postJson("/api/funds/{$fundId}/reopen", ['remarks' => 'Late liquidation'])
        ->assertOk()->assertJsonPath('status', 'Active');

    addTransaction($this, $this->staff, $fundId, ['type' => 'Release', 'amount' => 1])->assertCreated();
});

it('builds the dashboard and filters the list', function () {
    $pensionId = createFund($this)->json('id');
    createFund($this, ['name' => 'Medical 2025', 'category' => 'Medical Assistance', 'fiscal_year' => 2025, 'initial_allocation' => 5000]);
    addTransaction($this, $this->staff, $pensionId, ['type' => 'Release', 'amount' => 1000]);
    addTransaction($this, $this->staff, $pensionId, ['type' => 'Disbursement', 'amount' => 250]);

    $response = $this->actingAs($this->staff)->getJson('/api/funds')->assertOk();

    expect($response->json('dashboard.totals'))->toMatchArray(['allocated' => 105000, 'released' => 1000, 'disbursed' => 250, 'remaining' => 104750])
        ->and(collect($response->json('dashboard.by_program'))->pluck('program')->all())->toBe(['Medical Assistance', 'Pension'])
        ->and($response->json('dashboard.recent'))->toHaveCount(4)
        ->and($response->json('years'))->toBe([2026, 2025]);

    $this->actingAs($this->staff)->getJson('/api/funds?fiscal_year=2025')->assertJsonCount(1, 'funds');
    $this->actingAs($this->staff)->getJson('/api/funds?search=medical')->assertJsonCount(1, 'funds');
});

it('produces the fund report', function () {
    $fundId = createFund($this)->json('id');
    addTransaction($this, $this->staff, $fundId, ['type' => 'Release', 'amount' => 1000]);
    addTransaction($this, $this->staff, $fundId, ['type' => 'Disbursement', 'amount' => 250.5]);

    $response = $this->actingAs($this->staff)->getJson('/api/reports/funds')->assertOk();

    expect(collect($response->json('summary'))->pluck('value', 'label')->all())->toMatchArray([
        'Funds allocated' => 100000, 'Funds released' => 1000, 'Funds used / disbursed' => 250.5, 'Remaining balance' => 99749.5,
    ]);

    $spending = collect($response->json('charts'))->firstWhere('id', 'spending')['data'];
    expect($spending)->toBe([['label' => now()->format('Y-m'), 'value' => 250.5]]);

    expect(collect($response->json('tables'))->firstWhere('id', 'transactions')['rows'])->toHaveCount(3);
});
