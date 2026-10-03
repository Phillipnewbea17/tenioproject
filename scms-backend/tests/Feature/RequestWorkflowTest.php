<?php

use App\Models\ActivityLog;
use App\Models\BurialRequest;
use App\Models\Fund;
use App\Models\SeniorCitizen;
use App\Models\SeniorId;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->admin = User::factory()->create(['name' => 'Admin Ana', 'role' => 'Administrator']);
    $this->staff = User::factory()->create(['name' => 'Staff Ben', 'role' => 'User']);
});

/** A fund with ₱10,000 allocated and ₱5,000 released for Burial Assistance. */
function burialFund($test): Fund
{
    $fund = $test->actingAs($test->admin)->postJson('/api/funds', [
        'name' => 'Burial Fund 2026', 'source' => 'Municipal LGU', 'category' => 'Burial Assistance', 'fiscal_year' => 2026,
        'initial_allocation' => 10000, 'allocation_date' => now()->toDateString(),
    ])->json();

    $test->actingAs($test->staff)->postJson("/api/funds/{$fund['id']}/transactions", [
        'type' => 'Release', 'program' => 'Burial Assistance', 'amount' => 5000, 'transaction_date' => now()->toDateString(),
    ])->assertCreated();

    return Fund::find($fund['id']);
}

function burialPayload(array $overrides = []): array
{
    return $overrides + [
        'senior_name' => 'Lolo Dan', 'claimant_name' => 'Ella Dan', 'relationship' => 'Daughter',
        'death_date' => now()->subDays(5)->toDateString(), 'request_date' => now()->subDays(3)->toDateString(),
        'status' => 'Approved',
    ];
}

it('records staff-created requests as walk-ins, whatever the client sends', function () {
    $this->actingAs($this->staff)->postJson('/api/medical-requests', [
        'source' => 'App', 'senior_name' => 'Ana', 'senior_id' => 'SC-1', 'assistance_type' => 'Medicine',
        'request_date' => now()->toDateString(), 'status' => 'Pending',
    ])->assertCreated()->assertJsonPath('source', 'Walk-in');

    $this->actingAs($this->staff)->postJson('/api/burial-requests', burialPayload(['source' => 'App']))
        ->assertCreated()->assertJsonPath('source', 'Walk-in');

    $senior = SeniorCitizen::create(['senior_id' => 'SC-1', 'name' => 'Ana', 'age' => 70, 'gender' => 'Female', 'purok' => 'Purok 1', 'status' => 'Active']);
    $this->actingAs($this->staff)->postJson('/api/help-requests', [
        'senior_citizen_id' => $senior->id, 'category' => 'General inquiry', 'subject' => 'Schedule',
        'description' => 'When is the payout?', 'submitted_at' => now()->toDateString(),
    ])->assertCreated()->assertJsonPath('source', 'Walk-in');

    $this->actingAs($this->staff)->getJson('/api/help-requests?source=App')->assertJsonCount(0, 'requests');
    $this->actingAs($this->staff)->getJson('/api/help-requests?source=Walk-in')->assertJsonCount(1, 'requests');

    // "Online" is no longer a staff channel: app cases come through the app.
    $this->actingAs($this->staff)->postJson('/api/help-requests', [
        'senior_citizen_id' => $senior->id, 'category' => 'Other', 'subject' => 'x', 'description' => 'y',
        'channel' => 'Online', 'submitted_at' => now()->toDateString(),
    ])->assertStatus(422);
});

it('marks staff-recorded ID replacement requests as walk-ins', function () {
    $senior = SeniorCitizen::create(['senior_id' => 'SC-1', 'name' => 'Ana', 'age' => 70, 'gender' => 'Female', 'purok' => 'Purok 1', 'status' => 'Active']);
    $id = SeniorId::create(['id_number' => 'X-1', 'senior_citizen_id' => $senior->id, 'status' => 'Active', 'date_issued' => '2026-01-01']);

    $this->actingAs($this->staff)->postJson("/api/senior-ids/{$id->id}/request-replacement", [
        'reason' => 'Lost', 'date_requested' => now()->toDateString(),
    ])->assertOk()->assertJsonPath('replacement_source', 'Walk-in');

    $this->actingAs($this->staff)->getJson("/api/senior-citizens/{$senior->id}/senior-ids")
        ->assertOk()
        ->assertJsonPath('eligible', true)
        ->assertJsonPath('ids.0.id_number', 'X-1');
});

it('pays a burial release out of the chosen fund', function () {
    $fund = burialFund($this);
    $burial = $this->actingAs($this->staff)->postJson('/api/burial-requests', burialPayload())->json();

    // Releasing needs the amount and the fund.
    $this->actingAs($this->staff)->patchJson("/api/burial-requests/{$burial['id']}", ['status' => 'Released', 'release_date' => now()->toDateString(), 'received_by' => 'Ella Dan'])
        ->assertStatus(422);

    // Can't pay more than the fund has released for Burial Assistance.
    $this->actingAs($this->staff)->patchJson("/api/burial-requests/{$burial['id']}", [
        'status' => 'Released', 'amount' => 6000, 'fund_id' => $fund->id, 'release_date' => now()->toDateString(), 'received_by' => 'Ella Dan',
    ])->assertStatus(422);
    expect(BurialRequest::find($burial['id'])->status)->toBe('Approved');

    $released = $this->actingAs($this->staff)->patchJson("/api/burial-requests/{$burial['id']}", [
        'status' => 'Released', 'amount' => 3000, 'fund_id' => $fund->id, 'release_date' => now()->toDateString(), 'received_by' => 'Ella Dan',
    ])->assertOk();

    $released->assertJsonPath('status', 'Released')
        ->assertJsonPath('amount', '3000.00')
        ->assertJsonPath('fund.reference', $fund->reference);

    $totals = $this->actingAs($this->staff)->getJson("/api/funds/{$fund->id}")->json('totals');
    expect($totals)->toMatchArray(['disbursed' => 3000, 'remaining' => 7000, 'on_hand' => 2000]);

    $disbursement = $this->actingAs($this->staff)->getJson("/api/funds/{$fund->id}")->json('transactions.0');
    expect($disbursement)->toMatchArray(['type' => 'Disbursement', 'program' => 'Burial Assistance', 'recipient' => 'Ella Dan', 'reference_no' => $burial['reference']]);

    expect(ActivityLog::where('action', 'Burial paid')->exists())->toBeTrue();

    // Funds the release form can choose from: ₱2,000 still on hand.
    $this->actingAs($this->staff)->getJson('/api/funds/available?program=Burial Assistance')
        ->assertJsonPath('0.on_hand', 2000);
});

it('locks a released burial request until its disbursement is voided', function () {
    $fund = burialFund($this);
    $burial = $this->actingAs($this->staff)->postJson('/api/burial-requests', burialPayload([
        'status' => 'Released', 'amount' => 1500, 'fund_id' => $fund->id, 'release_date' => now()->toDateString(), 'received_by' => 'Ella Dan',
    ]))->assertCreated()->assertJsonPath('status', 'Released')->json();

    // Same values (as the form re-sends them) are fine; other details can change.
    $this->actingAs($this->staff)->patchJson("/api/burial-requests/{$burial['id']}", [
        'status' => 'Released', 'amount' => '1500', 'fund_id' => $fund->id, 'release_date' => now()->toDateString(), 'remarks' => 'Receipt filed.',
    ])->assertOk()->assertJsonPath('remarks', 'Receipt filed.');

    $this->actingAs($this->staff)->patchJson("/api/burial-requests/{$burial['id']}", ['amount' => 2000])->assertStatus(422);
    $this->actingAs($this->staff)->patchJson("/api/burial-requests/{$burial['id']}", ['status' => 'Pending'])->assertStatus(422);
    $this->actingAs($this->staff)->deleteJson("/api/burial-requests/{$burial['id']}")->assertStatus(422);

    // Voiding the payout in Fund Management reverses the release.
    $transactionId = BurialRequest::find($burial['id'])->fund_transaction_id;
    $this->actingAs($this->admin)->postJson("/api/funds/{$fund->id}/transactions/{$transactionId}/void", ['reason' => 'Wrong claimant'])
        ->assertOk()->assertJsonPath('totals.disbursed', 0);

    $reverted = BurialRequest::find($burial['id']);
    expect($reverted->status)->toBe('Approved')
        ->and($reverted->fund_transaction_id)->toBeNull()
        ->and(ActivityLog::where('action', 'Payment reversed')->exists())->toBeTrue();
});

/** A fund with money allocated and released for one program. */
function programFund($test, string $category, int $released): Fund
{
    $fund = $test->actingAs($test->admin)->postJson('/api/funds', [
        'name' => "{$category} Fund 2026", 'source' => 'DSWD', 'category' => $category, 'fiscal_year' => 2026,
        'initial_allocation' => $released * 2, 'allocation_date' => now()->toDateString(),
    ])->json();

    $test->actingAs($test->staff)->postJson("/api/funds/{$fund['id']}/transactions", [
        'type' => 'Release', 'program' => $category, 'amount' => $released, 'transaction_date' => now()->toDateString(),
    ])->assertCreated();

    return Fund::find($fund['id']);
}

it('pays a pension out of a Pension fund and reverses it when voided', function () {
    $fund = programFund($this, 'Pension', 3000);
    $pension = [
        'senior_id' => 'SC-1', 'name' => 'Ana', 'period' => 'Q4 2026', 'received_by' => 'Representative', 'status' => 'Pending',
    ];
    $release = $this->actingAs($this->staff)->postJson('/api/pension-releases', $pension)->assertCreated()->json();

    // Released needs a date, an amount and a fund.
    $this->actingAs($this->staff)->patchJson("/api/pension-releases/{$release['id']}", ['status' => 'Released'] + $pension)->assertStatus(422);
    $this->actingAs($this->staff)->patchJson("/api/pension-releases/{$release['id']}", ['status' => 'Released', 'release_date' => now()->toDateString()] + $pension)->assertStatus(422);

    $paid = $this->actingAs($this->staff)->patchJson("/api/pension-releases/{$release['id']}", [
        'status' => 'Released', 'release_date' => now()->toDateString(), 'amount' => 1000, 'fund_id' => $fund->id,
    ] + $pension)->assertOk();
    $paid->assertJsonPath('status', 'Released')->assertJsonPath('fund.reference', $fund->reference);

    // The fund shows the disbursement and which record it paid.
    $detail = $this->actingAs($this->staff)->getJson("/api/funds/{$fund->id}")->json();
    expect($detail['totals'])->toMatchArray(['disbursed' => 1000, 'on_hand' => 2000])
        ->and($detail['transactions'][0])->toMatchArray(['type' => 'Disbursement', 'program' => 'Pension', 'recipient' => 'Ana (Representative)'])
        ->and($detail['transactions'][0]['linked_record'])->toBe('Pension · SC-1 · Ana');

    // Locked until the disbursement is voided.
    $this->actingAs($this->staff)->patchJson("/api/pension-releases/{$release['id']}", [
        'status' => 'Released', 'release_date' => now()->toDateString(), 'amount' => 1500, 'fund_id' => $fund->id,
    ] + $pension)->assertStatus(422);

    $transactionId = $detail['transactions'][0]['id'];
    $this->actingAs($this->admin)->postJson("/api/funds/{$fund->id}/transactions/{$transactionId}/void", ['reason' => 'Paid twice'])->assertOk();

    $this->actingAs($this->staff)->getJson('/api/pension-releases')
        ->assertJsonPath('0.status', 'Pending')
        ->assertJsonPath('0.fund_transaction_id', null);
});

it('pays completed medical assistance out of a Medical Assistance fund', function () {
    $fund = programFund($this, 'Medical Assistance', 5000);

    $created = $this->actingAs($this->staff)->postJson('/api/medical-requests', [
        'senior_name' => 'Ana', 'senior_id' => 'SC-1', 'assistance_type' => 'Medicine', 'request_date' => now()->toDateString(),
        'status' => 'Completed', 'completed_date' => now()->toDateString(), 'amount' => 750.5, 'fund_id' => $fund->id,
    ])->assertCreated();

    $created->assertJsonPath('status', 'Completed')->assertJsonPath('amount', '750.50')->assertJsonPath('received_by', 'Ana');

    $this->actingAs($this->staff)->getJson('/api/funds/program-summary?program=Medical Assistance')
        ->assertJsonPath('totals.disbursed', 750.5)
        ->assertJsonPath('totals.on_hand', 4249.5)
        ->assertJsonPath('funds.0.reference', $fund->reference);

    // Paid assistance can't be deleted or changed to a different amount.
    $this->actingAs($this->staff)->deleteJson("/api/medical-requests/{$created['id']}")->assertStatus(422);
    $this->actingAs($this->staff)->patchJson("/api/medical-requests/{$created['id']}", ['amount' => 900])->assertStatus(422);

    // The programs report shows what was paid.
    $report = $this->actingAs($this->staff)->getJson('/api/reports/programs?program=Medical')->json();
    expect(collect($report['summary'])->firstWhere('label', 'Paid from funds')['value'])->toBe(750.5);
});
