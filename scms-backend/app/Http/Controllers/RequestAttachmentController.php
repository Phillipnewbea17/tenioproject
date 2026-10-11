<?php

namespace App\Http\Controllers;

use App\Models\BurialRequest;
use App\Models\HelpRequest;
use App\Models\MedicalRequest;
use App\Models\RequestAttachment;
use App\Models\SeniorId;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;

/** Staff: photos the senior app sent with a request (private files). */
class RequestAttachmentController extends Controller
{
    private const MODULES = [
        'medical' => MedicalRequest::class,
        'burial' => BurialRequest::class,
        'help' => HelpRequest::class,
        'senior-id' => SeniorId::class,
    ];

    /** GET /request-attachments?module=medical&record=12 */
    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'module' => ['required', Rule::in(array_keys(self::MODULES))],
            'record' => 'required|integer',
        ]);

        $items = RequestAttachment::where('attachable_type', self::MODULES[$data['module']])
            ->where('attachable_id', $data['record'])
            ->latest('id')
            ->get()
            ->map(fn (RequestAttachment $a) => [
                'id' => $a->id,
                'original_name' => $a->original_name,
                'mime_type' => $a->mime_type,
                'size' => $a->size,
                'created_at' => $a->created_at?->toIso8601String(),
            ]);

        return response()->json($items);
    }

    public function file(RequestAttachment $requestAttachment): StreamedResponse
    {
        abort_unless(Storage::disk('local')->exists($requestAttachment->path), 404, 'The file is missing.');

        return Storage::disk('local')->response($requestAttachment->path);
    }
}
