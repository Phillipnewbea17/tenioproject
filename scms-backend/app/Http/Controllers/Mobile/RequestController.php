<?php

namespace App\Http\Controllers\Mobile;

use App\Http\Controllers\Controller;
use App\Models\AppAccount;
use App\Models\BurialRequest;
use App\Models\HelpRequest;
use App\Models\HelpRequestUpdate;
use App\Models\MedicalRequest;
use App\Models\SeniorCitizen;
use App\Models\SeniorId;
use App\Support\ActivityLogger;
use App\Support\ProgramPayout;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * Requests from the senior app into the web modules (Medical Requests,
 * Burial Requests, Help & Complaint Desk, Senior ID Management). They are
 * stored in the same tables staff use, with source "App", so staff handle
 * them in the admin web app like any other request.
 *
 * For each kind (see routes/api.php):
 *   GET  /{kind}                             the account's own requests
 *   POST /{kind}                             send one -> {ok, reference, status}
 *   POST /{kind}/{reference}/attachments     a photo (multipart "file")
 *
 * The app only gets what is meant for the senior: the status, the dates
 * and the office's answer. Staff notes, assignments and payment details
 * are never sent.
 */
class RequestController extends Controller
{
    // ---------------------------------------------------------------------
    // Medical assistance
    // ---------------------------------------------------------------------

    public function medicalIndex(Request $request): JsonResponse
    {
        $items = MedicalRequest::where('app_account_id', $request->user()->id)->latest('id')->get()
            ->map(fn (MedicalRequest $r) => $this->present($r, $r->assistance_type, [
                ['label' => 'Type of help', 'value' => $r->assistance_type],
                ['label' => 'Hospital or clinic', 'value' => $r->facility ?? ''],
                ['label' => 'Date requested', 'value' => $r->request_date?->toFormattedDateString() ?? ''],
            ], $this->programAnswer($r, 'Completed', 'Your medical assistance was released.')));

        return response()->json($items);
    }

    public function medicalStore(Request $request): JsonResponse
    {
        $data = $request->validate([
            'clientId' => 'required|string|max:100',
            'assistanceType' => 'required|string|max:255',
            'details' => 'nullable|string|max:2000',
            'facility' => 'nullable|string|max:255',
            'contact' => 'nullable|string|max:255',
        ]);

        [$account, $senior] = $this->who($request);
        if ($existing = MedicalRequest::where('app_account_id', $account->id)->where('client_id', $data['clientId'])->first()) {
            return $this->sent($existing);
        }

        $medical = DB::transaction(function () use ($data, $account, $senior) {
            $next = (MedicalRequest::lockForUpdate()->max('id') ?? 0) + 1;

            $medical = MedicalRequest::create([
                'source' => 'App',
                'app_account_id' => $account->id,
                'client_id' => $data['clientId'],
                'reference' => 'MED-' . now()->year . '-' . str_pad($next, 4, '0', STR_PAD_LEFT),
                'senior_name' => $senior->name,
                'senior_id' => $senior->senior_id,
                'purok' => $senior->purok,
                'contact' => ($data['contact'] ?? null) ?: '0' . $account->phone,
                'assistance_type' => $data['assistanceType'],
                'request_date' => now()->toDateString(),
                'facility' => $data['facility'] ?? null,
                'status' => 'Pending',
                'remarks' => filled($data['details'] ?? null) ? "From the senior: {$data['details']}" : null,
            ]);

            ActivityLogger::record('Programs', 'Created', 'Medical assistance request sent from the senior app.',
                $medical, ProgramPayout::label($medical));

            return $medical;
        });

        return $this->sent($medical, 201);
    }

    // ---------------------------------------------------------------------
    // Burial assistance
    // ---------------------------------------------------------------------

    public function burialIndex(Request $request): JsonResponse
    {
        $items = BurialRequest::where('app_account_id', $request->user()->id)->latest('id')->get()
            ->map(fn (BurialRequest $r) => $this->present($r, 'Burial assistance', [
                ['label' => 'Senior citizen', 'value' => $r->senior_name],
                ['label' => 'Claimant', 'value' => $r->claimant_name],
                ['label' => 'Date of death', 'value' => $r->death_date?->toFormattedDateString() ?? ''],
            ], $this->programAnswer($r, 'Released', 'The burial assistance was released.')));

        return response()->json($items);
    }

    public function burialStore(Request $request): JsonResponse
    {
        $data = $request->validate([
            'clientId' => 'required|string|max:100',
            'claimantName' => 'required|string|max:255',
            'relationship' => 'nullable|string|max:255',
            'deathDate' => 'required|date|before_or_equal:today',
            'contact' => 'nullable|string|max:255',
            'funeralHome' => 'nullable|string|max:255',
        ], ['deathDate.required' => 'Please enter the date of death.']);

        [$account, $senior] = $this->who($request);
        if ($existing = BurialRequest::where('app_account_id', $account->id)->where('client_id', $data['clientId'])->first()) {
            return $this->sent($existing);
        }

        $burial = DB::transaction(function () use ($data, $account, $senior) {
            $next = (BurialRequest::lockForUpdate()->max('id') ?? 0) + 1;

            $burial = BurialRequest::create([
                'source' => 'App',
                'app_account_id' => $account->id,
                'client_id' => $data['clientId'],
                'reference' => 'BUR-' . now()->year . '-' . str_pad($next, 4, '0', STR_PAD_LEFT),
                'senior_name' => $senior->name,
                'senior_id' => $senior->senior_id,
                'claimant_name' => $data['claimantName'],
                'relationship' => $data['relationship'] ?? null,
                'death_date' => $data['deathDate'],
                'purok' => $senior->purok,
                'contact' => ($data['contact'] ?? null) ?: '0' . $account->phone,
                'funeral_home' => $data['funeralHome'] ?? null,
                'request_date' => now()->toDateString(),
                'status' => 'Pending',
            ]);

            ActivityLogger::record('Programs', 'Created', 'Burial assistance request sent from the senior app.',
                $burial, ProgramPayout::label($burial));

            return $burial;
        });

        return $this->sent($burial, 201);
    }

    // ---------------------------------------------------------------------
    // Help & Complaint Desk
    // ---------------------------------------------------------------------

    /** Timeline entries the senior may see (not notes or assignments). */
    private const PUBLIC_UPDATES = [
        'Created' => 'The OSCA office received your concern.',
        'Started' => 'The OSCA office is working on your concern.',
        'Resolved' => 'The OSCA office resolved your concern.',
        'Closed' => 'Your concern was closed.',
        'Reopened' => 'Your concern was opened again.',
    ];

    public function helpIndex(Request $request): JsonResponse
    {
        $items = HelpRequest::with('updates')->where('app_account_id', $request->user()->id)->latest('id')->get()
            ->map(function (HelpRequest $r) {
                $history = $r->updates
                    ->filter(fn (HelpRequestUpdate $u) => isset(self::PUBLIC_UPDATES[$u->type]))
                    ->sortBy('id')
                    ->map(fn (HelpRequestUpdate $u) => [
                        'date' => $u->created_at?->toIso8601String(),
                        'note' => self::PUBLIC_UPDATES[$u->type],
                    ])->values()->all();

                return $this->present($r, $r->subject, [
                    ['label' => 'Concern', 'value' => $r->category],
                    ['label' => 'What happened', 'value' => $r->description],
                ], in_array($r->status, ['Resolved', 'Closed'], true) ? (string) $r->resolution : '', $history);
            });

        return response()->json($items);
    }

    public function helpStore(Request $request): JsonResponse
    {
        $data = $request->validate([
            'clientId' => 'required|string|max:100',
            'category' => ['required', Rule::in(HelpRequest::CATEGORIES)],
            'subject' => 'required|string|max:255',
            'description' => 'required|string|max:5000',
        ]);

        [$account, $senior] = $this->who($request);
        if ($existing = HelpRequest::where('app_account_id', $account->id)->where('client_id', $data['clientId'])->first()) {
            return $this->sent($existing);
        }

        $help = DB::transaction(function () use ($data, $account, $senior) {
            $prefix = 'HLP-' . now()->year . '-';
            $last = HelpRequest::where('reference', 'like', $prefix . '%')->lockForUpdate()->pluck('reference')
                ->map(fn ($reference) => (int) substr($reference, strlen($prefix)))->max() ?? 0;
            $by = ($senior->name ?: $account->displayPhone()) . ' (app)';

            $help = HelpRequest::create([
                'source' => 'App',
                'app_account_id' => $account->id,
                'client_id' => $data['clientId'],
                'reference' => $prefix . str_pad($last + 1, 4, '0', STR_PAD_LEFT),
                'senior_citizen_id' => $senior->id,
                'senior_name' => $senior->name,
                'category' => $data['category'],
                'subject' => $data['subject'],
                'description' => $data['description'],
                'priority' => 'Normal',
                'status' => 'Pending',
                'submitted_at' => now()->toDateString(),
                'created_by' => $by,
            ]);

            $help->updates()->create([
                'type' => 'Created',
                'to_status' => 'Pending',
                'note' => 'Sent from the senior app.',
                'user_name' => $by,
            ]);

            ActivityLogger::record('Help Desk', 'Request created', "{$help->category}: {$help->subject}",
                $help, "{$help->reference} · {$help->senior_name}");

            return $help;
        });

        return $this->sent($help, 201);
    }

    // ---------------------------------------------------------------------
    // Senior ID replacement
    // ---------------------------------------------------------------------

    public function idReplacementIndex(Request $request): JsonResponse
    {
        [, $senior] = $this->who($request);

        $items = SeniorId::with('replacedBy')->where('senior_citizen_id', $senior->id)
            ->whereNotNull('replacement_requested_at')->latest('id')->get()
            ->map(function (SeniorId $id) {
                $done = $id->replaced_by_id !== null;

                return [
                    'reference' => 'IDR-' . $id->id,
                    'status' => $done ? 'Completed' : ($id->status === 'For Replacement' ? 'Pending' : $id->status),
                    'title' => 'Replace ID: ' . ($id->replacement_reason ?? ''),
                    'submittedAt' => $id->replacement_requested_at?->toIso8601String(),
                    'updatedAt' => $id->updated_at?->toIso8601String(),
                    'latestResponse' => $done ? "Your new ID number is {$id->replacedBy?->id_number}." : '',
                    'details' => [
                        ['label' => 'ID number', 'value' => $id->id_number],
                        ['label' => 'Reason', 'value' => $id->replacement_reason ?? ''],
                    ],
                    'history' => [],
                ];
            });

        return response()->json($items);
    }

    public function idReplacementStore(Request $request): JsonResponse
    {
        $data = $request->validate([
            'clientId' => 'required|string|max:100',
            'reason' => ['required', Rule::in(SeniorId::REPLACEMENT_REASONS)],
            'details' => 'nullable|string|max:1000',
        ]);

        [$account, $senior] = $this->who($request);
        $current = $senior->currentOscaId;

        abort_unless($current, 422, 'You do not have a Senior Citizen ID to replace yet.');
        if ($current->status === 'For Replacement') {
            return response()->json(['ok' => true, 'reference' => 'IDR-' . $current->id, 'status' => 'Pending']);
        }
        abort_unless($current->status === 'Active', 422, 'Your Senior Citizen ID is not active yet, so it cannot be replaced.');

        DB::transaction(function () use ($current, $data, $account, $senior) {
            $current->update([
                'status' => 'For Replacement',
                'replacement_reason' => $data['reason'],
                'replacement_requested_at' => now()->toDateString(),
                'replacement_source' => 'App',
            ]);

            $current->histories()->create([
                'action' => 'Replacement Requested',
                'details' => filled($data['details'] ?? null) ? "From the senior: {$data['details']}" : null,
                'reason' => $data['reason'],
                'previous_id_number' => $current->id_number,
                'date_requested' => now()->toDateString(),
                'performed_by' => ($senior->name ?: $account->displayPhone()) . ' (app)',
            ]);

            ActivityLogger::record('OSCA IDs', 'Replacement Requested', "Reason: {$data['reason']}. Sent from the senior app.",
                $current, "{$current->id_number} · {$senior->name}");
        });

        return response()->json(['ok' => true, 'reference' => 'IDR-' . $current->id, 'status' => 'Pending'], 201);
    }

    // ---------------------------------------------------------------------
    // Photos
    // ---------------------------------------------------------------------

    public function attach(Request $request, string $reference): JsonResponse
    {
        $request->validate(['file' => 'required|file|mimes:jpg,jpeg,png,webp,pdf|max:8192'], [
            'file.mimes' => 'Please send a photo (JPG or PNG).',
            'file.max' => 'The photo is too big. Please take it again.',
        ]);

        $account = $request->user();
        $class = [
            'medical-requests' => MedicalRequest::class,
            'burial-requests' => BurialRequest::class,
            'help-requests' => HelpRequest::class,
            'id-replacement' => SeniorId::class,
        ][$request->route('kind')] ?? null;
        abort_unless($class, 404);

        $record = $class === SeniorId::class
            ? SeniorId::where('senior_citizen_id', $account->senior_citizen_id)
                ->whereKey((int) Str::after($reference, 'IDR-'))->first()
            : $class::where('app_account_id', $account->id)->where('reference', $reference)->first();
        abort_unless($record, 404, 'That request was not found.');

        $file = $request->file('file');
        $path = $file->storeAs("request-attachments/{$account->id}", Str::uuid() . '.' . ($file->extension() ?: 'jpg'), 'local');

        $attachment = $record->morphMany(\App\Models\RequestAttachment::class, 'attachable')->create([
            'app_account_id' => $account->id,
            'path' => $path,
            'original_name' => $file->getClientOriginalName(),
            'mime_type' => $file->getMimeType(),
            'size' => $file->getSize(),
        ]);

        return response()->json(['ok' => true, 'id' => $attachment->id], 201);
    }

    // ---------------------------------------------------------------------

    /** The signed-in account and its linked senior record. */
    private function who(Request $request): array
    {
        /** @var AppAccount $account */
        $account = $request->user();
        /** @var SeniorCitizen $senior */
        $senior = $account->seniorCitizen;

        return [$account, $senior];
    }

    private function sent(Model $record, int $status = 200): JsonResponse
    {
        return response()->json(['ok' => true, 'reference' => $record->reference, 'status' => $record->status], $status);
    }

    /** What the office decided, in words for the senior (no amounts or staff remarks). */
    private function programAnswer(Model $record, string $paid, string $paidText): string
    {
        return match ($record->status) {
            $paid => $paidText,
            'Approved' => 'Your request was approved.',
            'On Hold' => 'Your request is on hold. The OSCA office may contact you.',
            default => '',
        };
    }

    private function present(Model $r, string $title, array $details, string $answer, ?array $history = null): array
    {
        $history ??= array_values(array_filter([
            ['date' => $r->created_at?->toIso8601String(), 'note' => 'The OSCA office received your request.'],
            $r->status !== 'Pending' && $r->updated_at
                ? ['date' => $r->updated_at->toIso8601String(), 'note' => "Status: {$r->status}"]
                : null,
        ]));

        return [
            'clientId' => $r->client_id,
            'reference' => $r->reference,
            'status' => $r->status,
            'title' => $title,
            'submittedAt' => ($r->created_at ?? Carbon::now())->toIso8601String(),
            'updatedAt' => $r->updated_at?->toIso8601String(),
            'latestResponse' => $answer,
            'details' => array_values(array_filter($details, fn ($d) => filled($d['value']))),
            'history' => $history,
        ];
    }
}
