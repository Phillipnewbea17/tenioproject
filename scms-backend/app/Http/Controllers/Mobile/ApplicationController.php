<?php

namespace App\Http\Controllers\Mobile;

use App\Http\Controllers\Controller;
use App\Models\Application;
use App\Models\ApplicationDocument;
use App\Support\ActivityLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * Registration from the senior app: upload photos of papers, submit the
 * application (it appears in Document Verification as source "App"), and
 * follow its status.
 */
class ApplicationController extends Controller
{
    /** One photo. Uploading the same clientId again replaces it. */
    public function uploadDocument(Request $request): JsonResponse
    {
        $data = $request->validate([
            'file' => 'required|file|mimes:jpg,jpeg,png,webp|max:8192',
            'type' => ['required', Rule::in(array_keys(ApplicationDocument::TYPES))],
            'clientId' => 'required|string|max:100',
        ], [
            'file.mimes' => 'Please send a photo (JPG or PNG).',
            'file.max' => 'The photo is too big. Please take it again.',
        ]);

        $account = $request->user();
        $file = $request->file('file');
        $path = $file->storeAs("application-documents/{$account->id}", Str::uuid() . '.' . ($file->extension() ?: 'jpg'), 'local');

        // Replace an earlier upload of the same photo that is not yet part of an application.
        $existing = $account->documents()->whereNull('application_id')->where('client_id', $data['clientId'])->first();
        if ($existing) {
            Storage::disk('local')->delete($existing->path);
            $existing->delete();
        }

        $document = $account->documents()->create([
            'type' => $data['type'],
            'client_id' => $data['clientId'],
            'path' => $path,
            'original_name' => $file->getClientOriginalName(),
            'mime_type' => $file->getMimeType(),
            'size' => $file->getSize(),
        ]);

        return response()->json(['ok' => true, 'id' => $document->id], 201);
    }

    /** Submit (or resubmit after "needs action") with the uploaded photos. */
    public function submit(Request $request): JsonResponse
    {
        $data = $request->validate([
            'documents' => 'required|array|min:1',
            'documents.*' => 'string|max:100',
        ]);

        $account = $request->user();
        abort_if(blank($account->full_name), 422, 'Please add your full name in your profile first.');

        $latest = $account->applications()->latest('id')->first();
        abort_if($latest?->status === 'Pending', 422, 'Your application is already being checked by the OSCA office.');
        abort_if($latest?->status === 'Verified', 422, 'Your application was already approved.');

        $documents = $account->documents()->whereNull('application_id')->whereIn('client_id', $data['documents'])->get();
        $missing = array_diff(ApplicationDocument::REQUIRED, $documents->pluck('type')->all());
        abort_if($missing, 422, 'Some papers were not received yet: '
            . collect($missing)->map(fn ($type) => ApplicationDocument::TYPES[$type])->implode(', ') . '. Please send them again.');

        $application = DB::transaction(function () use ($account, $latest, $documents) {
            $types = $documents->pluck('type');
            $now = now();
            $fields = [
                'name' => $account->full_name,
                'contact' => '0' . $account->phone,
                'birth_date' => $account->birth_date,
                'age' => $account->birth_date?->age,
                'status' => 'Pending',
                // One app photo covers "birth certificate or valid ID".
                'valid_id_uploaded' => $types->contains('proofOfAge'),
                'birth_certificate_uploaded' => $types->contains('proofOfAge'),
                'proof_residence_uploaded' => $types->contains('proofOfResidence'),
                'photo_uploaded' => $types->contains('idPhoto'),
            ];

            if ($latest) {
                // Resubmission after the office asked for corrections:
                // the new photos replace the old ones.
                $latest->documents->each(fn ($old) => Storage::disk('local')->delete($old->path));
                $latest->documents()->delete();
                $latest->update($fields + [
                    'submitted_at' => $now,
                    'history' => array_merge($latest->history ?? [], [$this->historyEntry('Resubmitted through the senior app', $now)]),
                ]);
                $application = $latest;
            } else {
                $next = (Application::max('id') ?? 0) + 1;
                $application = Application::create($fields + [
                    'source' => 'App',
                    'app_account_id' => $account->id,
                    'application_id' => 'APP-' . $now->year . '-' . str_pad($next, 4, '0', STR_PAD_LEFT),
                    'submitted_at' => $now,
                    'priority' => 'Low',
                    'history' => [$this->historyEntry('Submitted through the senior app', $now)],
                ]);
            }

            $documents->each->update(['application_id' => $application->id]);

            ActivityLogger::record('Document Verification', $latest ? 'Resubmitted from app' : 'Submitted from app',
                "Registration with {$documents->count()} document photo(s).",
                $application, "{$application->application_id} · {$application->name}");

            return $application;
        });

        return response()->json(['ok' => true, 'reference' => $application->application_id], 201);
    }

    /** The account's application, in the app's ApplicationStatus shape. */
    public function status(Request $request): JsonResponse
    {
        $application = $request->user()->applications()->latest('id')->first();

        if (! $application) {
            return response()->json(['applicationNo' => '', 'stage' => 'notStarted', 'message' => '', 'updatedAt' => null, 'history' => []]);
        }

        [$stage, $message] = match ($application->status) {
            'Verified' => ['approved', 'Your application is approved. Your OSCA ID is being prepared.'],
            'Rejected' => ['needsAction', 'The OSCA office needs you to fix your papers'
                . ($application->notes ? ": {$application->notes}" : '.') . ' Please upload them again.'],
            default => ['submitted', 'We received your papers. The OSCA office will check them soon.'],
        };

        $history = collect($application->history ?? [])
            ->filter(fn ($entry) => is_array($entry))
            ->map(function (array $entry) {
                $action = (string) ($entry['action'] ?? '');

                return [
                    'stage' => match (true) {
                        str_contains($action, 'Verified') => 'approved',
                        str_contains($action, 'Rejected') => 'needsAction',
                        default => 'submitted',
                    },
                    'date' => $this->parseHistoryDate($entry['date'] ?? null)?->toIso8601String(),
                    'note' => match (true) {
                        str_contains($action, 'Verified') => 'The OSCA office approved your application.',
                        str_contains($action, 'Rejected') => 'The OSCA office asked you to fix your papers.',
                        default => 'Application sent from the app.',
                    },
                ];
            })
            ->filter(fn ($event) => $event['date'])
            ->values();

        return response()->json([
            'applicationNo' => $application->application_id,
            'stage' => $stage,
            'message' => $message,
            'updatedAt' => $application->updated_at?->toIso8601String(),
            'history' => $history,
        ]);
    }

    /** Same format the web's Document Verification writes. */
    private function historyEntry(string $action, Carbon $at): array
    {
        return ['date' => $at->format('F j, Y') . ' · ' . $at->format('g:i A'), 'action' => $action];
    }

    private function parseHistoryDate($value): ?Carbon
    {
        try {
            return $value ? Carbon::parse(str_replace(' · ', ' ', (string) $value)) : null;
        } catch (\Throwable) {
            return null;
        }
    }
}
