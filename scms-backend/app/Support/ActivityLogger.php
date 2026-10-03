<?php

namespace App\Support;

use App\Models\ActivityLog;
use App\Models\AppAccount;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Writes Activity Log / Audit Trail entries.
 *
 *   ActivityLogger::record('Senior Records', 'Updated', 'Updated senior record.', $senior, 'SC-2026-0001 · Ana',
 *       ActivityLogger::changes($senior));
 *
 * Logging never breaks the action being logged: if writing the entry fails,
 * the error goes to the Laravel log instead.
 */
class ActivityLogger
{
    /** Fields that are never copied into the log. */
    private const HIDDEN = ['password', 'remember_token', 'updated_at', 'created_at', 'history'];

    public static function record(
        string $module,
        string $action,
        ?string $description = null,
        ?Model $record = null,
        ?string $label = null,
        ?array $changes = null,
        ?User $user = null,
        ?string $userName = null,
    ): ?ActivityLog {
        try {
            $request = request();
            $signedIn = $request?->user();

            // Only staff Users go in user_id. A senior-app account is named
            // instead, so its id is never mistaken for a staff user's.
            if (! $user && $signedIn instanceof User) {
                $user = $signedIn;
            } elseif (! $user && $signedIn instanceof AppAccount && ! $userName) {
                $userName = ($signedIn->full_name ?: $signedIn->displayPhone()) . ' (app)';
            }

            return ActivityLog::create([
                'user_id' => $user?->id,
                'user_name' => $user?->name ?? $userName,
                'role' => $user?->role ?? ($signedIn instanceof AppAccount ? 'Senior app' : null),
                'module' => $module,
                'action' => $action,
                'record_type' => $record ? class_basename($record) : null,
                'record_id' => $record?->getKey(),
                'record_label' => $label,
                'description' => $description,
                'changes' => $changes ?: null,
                'ip_address' => $request?->ip(),
            ]);
        } catch (Throwable $error) {
            Log::error('Failed to write activity log entry.', [
                'module' => $module,
                'action' => $action,
                'error' => $error->getMessage(),
            ]);

            return null;
        }
    }

    /**
     * Before/after values from the model's last save, as
     * ['field' => ['from' => old, 'to' => new]].
     */
    public static function changes(Model $model): array
    {
        $previous = $model->getPrevious();

        return collect($model->getChanges())
            ->except(self::HIDDEN)
            ->map(fn ($to, $field) => [
                'from' => self::plain($previous[$field] ?? null),
                'to' => self::plain($to),
            ])
            ->all();
    }

    /** Short human field list for descriptions: "status and remarks". */
    public static function fieldList(array $changes): string
    {
        $fields = array_map(fn ($field) => str_replace('_', ' ', $field), array_keys($changes));

        if (count($fields) <= 1) {
            return $fields[0] ?? 'no fields';
        }

        return implode(', ', array_slice($fields, 0, -1)) . ' and ' . end($fields);
    }

    private static function plain($value)
    {
        if ($value instanceof \DateTimeInterface) {
            return $value->format('Y-m-d H:i:s');
        }

        return is_scalar($value) || $value === null ? $value : json_encode($value);
    }
}
