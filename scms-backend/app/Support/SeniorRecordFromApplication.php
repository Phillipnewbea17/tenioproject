<?php

namespace App\Support;

use App\Models\AppAccount;
use App\Models\Application;
use App\Models\ApplicationDocument;
use App\Models\SeniorCitizen;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Turns an approved application into the senior's record in Records.
 *
 * The name and contact number come from the app account the senior signed up
 * with; the middle name, date of birth, sex and purok are read off the birth
 * certificate and barangay certificate photos they uploaded. Whatever OCR
 * could not read is left empty and the record is saved as "Needs attention",
 * so staff complete it in Records > Edit record. No OSCA ID is created here -
 * an administrator issues that afterwards in OSCA IDs > Issue ID.
 */
class SeniorRecordFromApplication
{
    public function __construct(private readonly DocumentOcr $ocr = new DocumentOcr) {}

    /**
     * The record for this application, or null when it already has one.
     *
     * OCR runs before the transaction opens: reading two photos takes a few
     * seconds, and no database row should be locked while it does.
     */
    public function create(Application $application): ?SeniorCitizen
    {
        if ($this->existingRecord($application) !== null) {
            return null;
        }

        $application->loadMissing('appAccount');
        $documents = $application->documents()->get();

        $details = SeniorPaperDetails::read(
            $this->ocr->read($this->document($documents, 'birthCertificate')),
            // The barangay certificate is uploaded as the proof of residence.
            $this->ocr->read($this->document($documents, 'proofOfResidence')),
        );

        return DB::transaction(function () use ($application, $details) {
            // Re-check under a lock: two staff members can approve at once.
            if ($this->existingRecord($application, lock: true) !== null) {
                return null;
            }

            $account = $application->appAccount;

            // Everything an OSCA ID is printed from has to be there before
            // the record counts as ready.
            $complete = collect(SeniorCitizen::REQUIRED_FOR_ID)
                ->every(fn (string $column) => filled($details[$column] ?? null));

            $record = SeniorCitizen::create([
                'senior_id' => $this->nextRecordNumber(),
                'application_id' => $application->id,
                'name' => $this->name($account, $application, $details['middle_name']),
                'birth_date' => $details['birth_date'],
                'age' => $details['birth_date'] ? Carbon::parse($details['birth_date'])->age : null,
                'gender' => $details['gender'],
                'purok' => $details['purok'],
                'contact' => $this->contact($account, $application),
                'status' => $complete ? 'Active' : SeniorCitizen::NEEDS_ATTENTION,
            ]);

            // The senior app reads its ID through this link, so the account
            // that applied owns the record from the moment it exists.
            if ($account) {
                AppAccountSeniorLink::attach($account, $record);
            }

            return $record;
        });
    }

    /** The same list as one phrase: "birth date, sex and purok". */
    public static function missingDetailsSentence(SeniorCitizen $record): string
    {
        $missing = self::missingDetails($record);

        if (count($missing) <= 1) {
            return $missing[0] ?? 'details';
        }

        return implode(', ', array_slice($missing, 0, -1)) . ' and ' . end($missing);
    }

    /** What the senior still has to be asked for, in plain words. */
    public static function missingDetails(SeniorCitizen $record): array
    {
        $labels = ['birth_date' => 'birth date', 'gender' => 'sex', 'purok' => 'purok'];

        return collect(SeniorCitizen::REQUIRED_FOR_ID)
            ->filter(fn (string $column) => blank($record->getAttribute($column)))
            ->map(fn (string $column) => $labels[$column])
            ->values()
            ->all();
    }

    private function existingRecord(Application $application, bool $lock = false): ?SeniorCitizen
    {
        return SeniorCitizen::where('application_id', $application->id)
            ->when($lock, fn ($query) => $query->lockForUpdate())
            ->first();
    }

    private function document($documents, string $type): ?ApplicationDocument
    {
        return $documents->where('type', $type)->sortByDesc('id')->first();
    }

    /**
     * The senior's name as the account spells it, with the middle name the
     * birth certificate gave (it is more reliable than a typed one).
     */
    private function name(?AppAccount $account, Application $application, ?string $middleName): string
    {
        $first = trim((string) $account?->first_name);
        $last = trim((string) $account?->last_name);

        if ($first !== '' && $last !== '') {
            $middle = $account?->no_middle_name
                ? ''
                : trim((string) ($middleName ?: $account?->middle_name));

            return collect([$first, $middle, $last, trim((string) $account?->suffix)])
                ->filter()
                ->implode(' ');
        }

        return trim((string) ($account?->full_name ?: $application->name));
    }

    /** The mobile number the senior uses, written the local way (09...). */
    private function contact(?AppAccount $account, Application $application): ?string
    {
        $contact = trim((string) $application->contact);

        if ($contact !== '') {
            return $contact;
        }

        return $account?->phone ? '0' . $account->phone : null;
    }

    /** Same numbering Records uses when staff add a senior by hand. */
    private function nextRecordNumber(): string
    {
        $next = (SeniorCitizen::max('id') ?? 0) + 1;

        return 'SC-' . now()->year . '-' . str_pad((string) $next, 4, '0', STR_PAD_LEFT);
    }
}
