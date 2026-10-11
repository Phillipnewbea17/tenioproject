<?php

namespace App\Http\Controllers\Mobile;

use App\Http\Controllers\Controller;
use App\Models\BurialRequest;
use App\Models\HelpRequest;
use App\Models\MedicalRequest;
use App\Models\PensionRelease;
use App\Models\SeniorId;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Read-only senior data for the app, always from the linked senior citizen
 * record: the digital Senior ID (web: Senior ID Management), pension
 * releases (web: Pension Releases) and the bell notifications.
 */
class SeniorServicesController extends Controller
{
    /** GET /wallet: the current Senior ID, or null when none is issued. */
    public function wallet(Request $request): JsonResponse
    {
        $senior = $request->user()->seniorCitizen;
        $id = $senior->currentOscaId;

        return response()->json(['seniorId' => $id ? [
            'idNumber' => $id->id_number,
            'fullName' => $senior->name,
            'birthDate' => $senior->birth_date ? substr((string) $senior->birth_date, 0, 10) : null,
            'address' => $senior->purok ?? '',
            'issuedBy' => $id->issued_by ?? 'OSCA',
            'issuedAt' => $id->date_issued?->toDateString(),
            'status' => $id->status,
            'photoUrl' => '',
        ] : null]);
    }

    /** GET /pension: the senior's own releases, newest first. */
    public function pension(Request $request): JsonResponse
    {
        $senior = $request->user()->seniorCitizen;

        $items = PensionRelease::where('senior_id', $senior->senior_id)->latest('id')->get()
            ->map(fn (PensionRelease $p) => [
                'period' => $p->period,
                'status' => $p->status,
                'releaseDate' => $p->release_date?->toDateString(),
                'reference' => $p->reference ?? '',
            ]);

        return response()->json($items);
    }

    /**
     * GET /notifications: what changed on the account's own records. Built
     * from the records themselves (there is no separate notifications
     * table), so every item is something the office really did.
     */
    public function notifications(Request $request): JsonResponse
    {
        $account = $request->user();
        $items = collect();

        $application = $account->applications()->latest('id')->first();
        if ($application && in_array($application->status, ['Verified', 'Rejected'], true)) {
            $approved = $application->status === 'Verified';
            $items->push($this->item("application-{$application->id}-{$application->status}",
                $approved ? 'Application approved' : 'Please fix your papers',
                $approved ? 'Congratulations! Your Senior Citizen ID application was approved.'
                    : 'The OSCA office needs you to send some papers again. Open your application to see what to do.',
                $application->updated_at));
        }

        if ($account->linked_at) {
            $items->push($this->item("linked-{$account->id}", 'Account verified',
                'Your account is now linked to your senior citizen record.', $account->linked_at));
        }

        $rejected = $account->identityVerifications()->where('status', 'Rejected')->latest('id')->first();
        if ($rejected && ! $account->isLinked()) {
            $items->push($this->item("identity-{$rejected->id}", 'Please verify your account again',
                $rejected->remarks ?: 'The OSCA office could not confirm your selfie. Please try again.', $rejected->reviewed_at));
        }

        if ($senior = $account->seniorCitizen) {
            foreach ([MedicalRequest::class => 'Medical assistance', BurialRequest::class => 'Burial assistance'] as $class => $what) {
                $class::where('app_account_id', $account->id)->where('status', '!=', 'Pending')->latest('updated_at')->limit(10)->get()
                    ->each(fn ($r) => $items->push($this->item(class_basename($class) . "-{$r->id}-{$r->status}",
                        "{$what}: {$r->status}", "Your request {$r->reference} is now {$r->status}.", $r->updated_at)));
            }

            HelpRequest::where('app_account_id', $account->id)->whereIn('status', ['Working on it', 'Resolved', 'Closed'])
                ->latest('updated_at')->limit(10)->get()
                ->each(fn (HelpRequest $r) => $items->push($this->item("help-{$r->id}-{$r->status}",
                    "Your concern: {$r->status}", "{$r->reference}: {$r->subject}", $r->updated_at)));

            $id = $senior->currentOscaId;
            if ($id && $id->status === 'Active' && $id->date_issued) {
                $items->push($this->item("senior-id-{$id->id}-active", 'Your Senior ID is ready',
                    "Your Senior Citizen ID {$id->id_number} is active. Open My ID to see it.", $id->updated_at));
            }

            PensionRelease::where('senior_id', $senior->senior_id)->where('status', 'Released')->latest('id')->limit(5)->get()
                ->each(fn (PensionRelease $p) => $items->push($this->item("pension-{$p->id}", 'Pension released',
                    "Your pension for {$p->period} was released.", $p->updated_at)));
        }

        return response()->json($items->filter(fn ($n) => $n['date'])->sortByDesc('date')->values());
    }

    private function item(string $id, string $title, string $body, $date): array
    {
        return ['id' => $id, 'title' => $title, 'body' => $body, 'date' => $date?->toIso8601String()];
    }
}
