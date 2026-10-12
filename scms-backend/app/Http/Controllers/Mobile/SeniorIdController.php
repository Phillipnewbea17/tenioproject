<?php

namespace App\Http\Controllers\Mobile;

use App\Http\Controllers\Controller;
use App\Support\AppAccountSeniorLink;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * My ID in the senior app: the OSCA ID an administrator issued on the web
 * (OSCA IDs > Issue ID), with the details printed on the card.
 *
 * Unlike the other senior routes this one is not behind "app.linked": the
 * account may hold its record through its approved application without the
 * link having been written yet, and AppAccountSeniorLink repairs that. An
 * account with no record at all simply has no ID yet.
 */
class SeniorIdController extends Controller
{
    /** GET /my-senior-id */
    public function show(Request $request): JsonResponse
    {
        $record = AppAccountSeniorLink::resolve($request->user());
        $id = $record?->currentOscaId;

        if (! $id) {
            return response()->json(['has_id' => false, 'seniorId' => null]);
        }

        return response()->json([
            'has_id' => true,
            'seniorId' => [
                'idNumber' => $id->id_number,
                'status' => $id->status,
                'issuedAt' => $id->date_issued?->toDateString(),
                'issuedBy' => $id->issued_by ?: 'OSCA ' . $record->address(),

                'recordNo' => $record->senior_id,
                'fullName' => $record->name,
                'address' => $record->address(),
                'birthDate' => $record->birth_date
                    ? substr((string) $record->birth_date, 0, 10)
                    : null,
                'age' => $record->age,
                'sex' => $record->gender,

                // Served by photo() below; the app adds its sign-in token.
                'photoUrl' => $record->idPhotoDocument()
                    ? '/api/mobile/my-senior-id/photo'
                    : '',
            ],
        ]);
    }

    /**
     * GET /my-senior-id/photo
     *
     * The senior's own 2x2 photo, streamed from where their upload put it.
     */
    public function photo(Request $request): StreamedResponse
    {
        $record = AppAccountSeniorLink::resolve($request->user());
        $document = $record?->idPhotoDocument();

        abort_unless(
            $document && Storage::disk('local')->exists($document->path),
            404,
            'No photo was uploaded with your application.'
        );

        return Storage::disk('local')->response($document->path, null, [
            'Content-Type' => $document->mime_type ?: 'image/jpeg',
            'Cache-Control' => 'private, max-age=300',
        ]);
    }
}
