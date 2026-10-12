<?php

namespace App\Support;

use App\Models\AppAccount;
use App\Models\User;
use Illuminate\Support\Carbon;

/**
 * One row of User Management, for a staff user or for a senior-app account.
 *
 * Both kinds answer the same keys so the page can show them in one list (see
 * normalizeUser in UserManagement.jsx); anything that only makes sense for
 * one kind is null for the other. Fields are only ever added here, never
 * renamed or removed: the senior app reads nothing from this shape, but the
 * admin page does, and old pages must keep working.
 *
 * Call AppAccount::withRowRelations() when building many rows at once, so
 * appUser() reads what it needs from memory instead of querying per row.
 */
class UserRow
{
    public static function staff(User $user): array
    {
        return [
            'id' => $user->id,
            'uid' => 'staff-' . $user->id,
            'type' => 'staff',
            'name' => $user->name,
            'username' => $user->username ?? $user->name,
            'email' => $user->email,
            'phone' => null,
            'role' => $user->role ?? 'User',
            'status' => $user->status ?? 'Active',
            'has_photo' => false,
            'photo_source' => null,
            'birth_date' => null,
            'linked' => null,
            'senior' => null,
            'verification' => null,
            'registered_at' => self::iso($user->created_at),
            'last_login_at' => self::iso($user->last_login_at),
            // Only app accounts remember who deactivated them (see the
            // app_accounts migration); staff changes live in the Activity Log.
            'deactivated_at' => null,
            'deactivated_by' => null,
            'deactivation_reason' => null,
            'linked_at' => null,
            'linked_by' => null,
        ];
    }

    public static function appUser(AppAccount $account): array
    {
        $senior = $account->seniorCitizen;
        $application = $account->latestApplication;

        return [
            'id' => $account->id,
            'uid' => 'app_user-' . $account->id,
            'type' => 'app_user',
            'name' => $account->full_name ?: $account->displayPhone(),
            'username' => null,
            'email' => null,
            'phone' => $account->displayPhone(),
            // App roles (senior / familyRelative) live in their own column and
            // can never be "Administrator", so an app user can't reach staff.
            'role' => $account->role ?: 'senior',
            'status' => $account->status ?? 'Active',
            'has_photo' => $account->photoSource() !== null,
            'photo_source' => $account->photoSource(),
            'birth_date' => $account->birth_date?->toDateString(),
            'linked' => $account->isLinked(),
            'senior' => $senior ? [
                'id' => $senior->id,
                'senior_id' => $senior->senior_id,
                'name' => $senior->name,
            ] : null,
            // The registration documents, as Document Verification sees them.
            'verification' => $application ? [
                'status' => $application->status ?: 'Pending',
                'application_id' => $application->application_id,
            ] : null,
            'registered_at' => self::iso($account->created_at),
            'last_login_at' => self::iso($account->last_login_at),
            'deactivated_at' => self::iso($account->deactivated_at),
            'deactivated_by' => $account->deactivatedBy?->name,
            'deactivation_reason' => $account->deactivation_reason,
            'linked_at' => self::iso($account->linked_at),
            'linked_by' => $account->linkedBy?->name,
        ];
    }

    private static function iso($value): ?string
    {
        return $value ? Carbon::parse($value)->toIso8601String() : null;
    }
}
