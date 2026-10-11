<?php

namespace App\Http\Controllers\Mobile;

use App\Http\Controllers\Controller;
use App\Models\ProfileCorrection;
use App\Support\ActivityLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * Personal Information > Request a correction.
 *
 *   GET  /profile/corrections  the account's own requests, newest first
 *   POST /profile/corrections  field, currentValue, requestedValue, reason
 *                              (+ optional multipart "file": a photo of a
 *                              supporting document) -> {ok, reference}
 *
 * OSCA staff approve or reject it in the admin web app; their remarks come
 * back to the app as officeNote.
 */
class ProfileCorrectionController extends Controller
{
    /** Open requests allowed per account, so the queue is not flooded. */
    private const MAX_PENDING = 5;

    public function index(Request $request): JsonResponse
    {
        $items = ProfileCorrection::where('app_account_id', $request->user()->id)
            ->latest('id')
            ->limit(50)
            ->get()
            ->map(fn (ProfileCorrection $c) => self::present($c));

        return response()->json($items);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'field' => ['required', Rule::in(array_keys(ProfileCorrection::FIELDS))],
            'currentValue' => 'nullable|string|max:255',
            'requestedValue' => 'required|string|max:255',
            'reason' => 'required|string|max:1000',
            'file' => 'nullable|image|max:8192',
        ], [
            'field.in' => 'Please update the app and try again.',
            'requestedValue.required' => 'Please enter the correct information.',
            'reason.required' => 'Please tell us why it should be changed.',
            'file.image' => 'Please send a photo.',
        ]);

        $account = $request->user();
        $pending = ProfileCorrection::where('app_account_id', $account->id)->where('status', 'Pending');
        if ((clone $pending)->count() >= self::MAX_PENDING) {
            return response()->json(['message' => 'You already have several requests waiting. '
                . 'Please wait for the OSCA office to check them.', 'code' => 'too_many_pending'], 429);
        }
        // Sent twice (bad connection, double tap): keep the first one.
        $same = (clone $pending)->where('field', $data['field'])
            ->where('requested_value', $data['requestedValue'])->first();
        if ($same) {
            return response()->json(['ok' => true, 'reference' => $same->reference()]);
        }

        $path = null;
        if ($file = $request->file('file')) {
            $path = $file->storeAs("profile-corrections/{$account->id}",
                Str::uuid() . '.' . ($file->extension() ?: 'jpg'), 'local');
        }

        $correction = ProfileCorrection::create([
            'app_account_id' => $account->id,
            'senior_citizen_id' => $account->senior_citizen_id,
            'field' => $data['field'],
            'current_value' => $data['currentValue'] ?? null,
            'requested_value' => $data['requestedValue'],
            'reason' => $data['reason'],
            'attachment_path' => $path,
        ]);

        ActivityLogger::record('Senior App', 'Correction requested',
            "{$correction->fieldLabel()}: \"{$correction->current_value}\" → \"{$correction->requested_value}\"",
            $correction, $correction->reference() . ' · ' . ($account->full_name ?: $account->displayPhone()),
            userName: ($account->full_name ?: $account->displayPhone()) . ' (app)');

        return response()->json(['ok' => true, 'reference' => $correction->reference()], 201);
    }

    /** The app's CorrectionRequest. */
    public static function present(ProfileCorrection $c): array
    {
        return [
            'reference' => $c->reference(),
            'field' => $c->field,
            'currentValue' => $c->current_value ?? '',
            'requestedValue' => $c->requested_value,
            'reason' => $c->reason,
            'status' => strtolower($c->status),
            'officeNote' => $c->remarks ?? '',
            'submittedAt' => $c->created_at?->toIso8601String(),
        ];
    }
}
