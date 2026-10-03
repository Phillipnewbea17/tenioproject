<?php

namespace App\Http\Controllers\Mobile;

use App\Http\Controllers\Controller;
use App\Models\AppAccount;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** The signed-in app account's profile, in the app's UserProfile shape. */
class ProfileController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        return response()->json(self::present($request->user()));
    }

    /** Accepts the app's UserProfile.toJson() (camelCase). */
    public function update(Request $request): JsonResponse
    {
        $data = $request->validate([
            'fullName' => 'sometimes|nullable|string|max:255',
            'role' => ['sometimes', 'nullable', Rule::in(AppAccount::ROLES)],
            'birthDate' => 'sometimes|nullable|date|before:today',
            'barangay' => 'sometimes|nullable|string|max:255',
            'municipality' => 'sometimes|nullable|string|max:255',
            'province' => 'sometimes|nullable|string|max:255',
        ]);

        $fields = ['fullName' => 'full_name', 'role' => 'role', 'birthDate' => 'birth_date',
            'barangay' => 'barangay', 'municipality' => 'municipality', 'province' => 'province'];

        $account = $request->user();
        foreach ($fields as $from => $to) {
            if (array_key_exists($from, $data)) {
                $account->{$to} = $from === 'birthDate' && $data[$from] ? substr($data[$from], 0, 10) : $data[$from];
            }
        }
        $account->save();

        return response()->json(['ok' => true, 'profile' => self::present($account)]);
    }

    public static function present(AppAccount $account): array
    {
        return [
            'phone' => $account->phone,
            'fullName' => $account->full_name ?? '',
            'role' => $account->role ?? 'senior',
            'birthDate' => $account->birth_date?->toDateString(),
            'barangay' => $account->barangay ?? '',
            'municipality' => $account->municipality ?? '',
            'province' => $account->province ?? '',
        ];
    }
}
