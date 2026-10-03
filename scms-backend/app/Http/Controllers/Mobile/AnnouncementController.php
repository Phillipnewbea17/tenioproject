<?php

namespace App\Http\Controllers\Mobile;

use App\Http\Controllers\Controller;
use App\Models\Announcement;

/**
 * Read-only announcements for the SeniorCompanion mobile app.
 * Public (no login), and only active announcements are shown.
 * The JSON shape matches Announcement.fromJson in the Flutter app.
 */
class AnnouncementController extends Controller
{
    public function index()
    {
        $announcements = Announcement::where('status', 'Active')
            ->orderByDesc('pinned')
            ->orderByDesc('date')
            ->get()
            ->map(fn (Announcement $a) => [
                // The app reads id as a string.
                'id' => (string) $a->id,
                'title' => $a->title,
                'body' => $a->description ?? '',
                'date' => $a->date?->toDateString() . 'T08:00:00',
            ]);

        return response()->json($announcements);
    }
}
