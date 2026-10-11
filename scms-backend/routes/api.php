<?php

use App\Http\Controllers\AuthController;
use App\Http\Controllers\ApplicationController;
use App\Http\Controllers\Mobile;
use App\Http\Controllers\AnnouncementController;
use App\Http\Controllers\AppAccountController;
use App\Http\Controllers\SeniorCitizenController;
use App\Http\Controllers\SeniorIdController;
use App\Http\Controllers\ReportController;
use App\Http\Controllers\ActivityLogController;
use App\Http\Controllers\FundController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\HelpRequestController;
use App\Http\Controllers\RequestAttachmentController;
use App\Http\Controllers\PasswordResetController;
use App\Http\Controllers\PensionReleaseController;
use App\Http\Controllers\UserController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\MedicalRequestController;
use App\Http\Controllers\BurialRequestController;


// Admin web app: staff accounts only (senior-app tokens are refused).
Route::middleware(['auth:sanctum', 'staff'])->group(function () {
    Route::get('/dashboard', DashboardController::class);

    // Photos uploaded from the senior app.
    Route::get('/applications/{application}/documents', [ApplicationController::class, 'documents']);
    Route::get('/application-documents/{document}/file', [ApplicationController::class, 'documentFile']);

    // Senior records are never deleted (archive them instead), so there is no DELETE route.
    Route::apiResource('senior-citizens', SeniorCitizenController::class)->except(['destroy']);
    Route::apiResource('announcements', AnnouncementController::class);
    Route::apiResource('applications', ApplicationController::class);
    Route::apiResource('medical-requests', MedicalRequestController::class);
    Route::apiResource('burial-requests', BurialRequestController::class);
    
    // User Management (staff + app users, merged)
    Route::get('/users', [UserController::class, 'index']);
    Route::get('/users/recent-logins', [UserController::class, 'recentLogins']);
    Route::post('/users', [UserController::class, 'store']);
    Route::match(['put', 'patch'], '/users/{user}', [UserController::class, 'update']);
    Route::post('/users/{user}/reset-password', [UserController::class, 'resetPassword']);
    // App users can only be activated/deactivated (no role or password edits).
    Route::post('/app-accounts/{appAccount}/status', [AppAccountController::class, 'setStatus']);
    // The senior's app-profile photo (private file, staff only), by app
    // account or by the senior citizen record it is linked to.
    Route::get('/app-accounts/{appAccount}/photo', [AppAccountController::class, 'photo']);
    Route::get('/senior-citizens/{seniorCitizen}/photo', [AppAccountController::class, 'seniorPhoto']);

    // Senior ID Management
    Route::get('/senior-ids', [SeniorIdController::class, 'index']);
    Route::post('/senior-ids', [SeniorIdController::class, 'store']);
    Route::get('/senior-ids/{seniorId}', [SeniorIdController::class, 'show']);
    Route::get('/senior-citizens/{seniorCitizen}/senior-ids', [SeniorIdController::class, 'forSenior']);
    Route::match(['put', 'patch'], '/senior-ids/{seniorId}', [SeniorIdController::class, 'update']);
    Route::post('/senior-ids/{seniorId}/activate', [SeniorIdController::class, 'activate']);
    Route::post('/senior-ids/{seniorId}/request-replacement', [SeniorIdController::class, 'requestReplacement']);
    Route::post('/senior-ids/{seniorId}/replace', [SeniorIdController::class, 'replace']);
    Route::post('/senior-ids/{seniorId}/deactivate', [SeniorIdController::class, 'deactivate']);

    // Reports
    Route::get('/reports/options', [ReportController::class, 'options']);
    Route::get('/reports/seniors', [ReportController::class, 'seniors']);
    Route::get('/reports/verification', [ReportController::class, 'verification']);
    Route::get('/reports/programs', [ReportController::class, 'programs']);
    Route::get('/reports/senior-ids', [ReportController::class, 'seniorIds']);
    Route::post('/reports/log', [ReportController::class, 'log']);

    Route::get('/reports/funds', [ReportController::class, 'funds']);

    // Fund Management
    Route::get('/funds', [FundController::class, 'index']);
    Route::post('/funds', [FundController::class, 'store']);
    Route::get('/funds/available', [FundController::class, 'available']);
    Route::get('/funds/program-summary', [FundController::class, 'programSummary']);
    Route::get('/funds/{fund}', [FundController::class, 'show']);
    Route::match(['put', 'patch'], '/funds/{fund}', [FundController::class, 'update']);
    Route::post('/funds/{fund}/transactions', [FundController::class, 'addTransaction']);
    Route::post('/funds/{fund}/transactions/{transaction}/void', [FundController::class, 'voidTransaction']);
    Route::post('/funds/{fund}/close', [FundController::class, 'close']);
    Route::post('/funds/{fund}/reopen', [FundController::class, 'reopen']);

    Route::get('/reports/help', [ReportController::class, 'help']);

    // Help & Complaint Desk (cases are closed, never deleted)
    Route::get('/help-requests/options', [HelpRequestController::class, 'options']);
    Route::get('/help-requests', [HelpRequestController::class, 'index']);
    Route::post('/help-requests', [HelpRequestController::class, 'store']);
    Route::get('/help-requests/{helpRequest}', [HelpRequestController::class, 'show']);
    Route::match(['put', 'patch'], '/help-requests/{helpRequest}', [HelpRequestController::class, 'update']);
    Route::post('/help-requests/{helpRequest}/assign', [HelpRequestController::class, 'assign']);
    Route::post('/help-requests/{helpRequest}/status', [HelpRequestController::class, 'changeStatus']);
    Route::post('/help-requests/{helpRequest}/reopen', [HelpRequestController::class, 'reopen']);
    Route::post('/help-requests/{helpRequest}/notes', [HelpRequestController::class, 'addNote']);
    Route::get('/senior-citizens/{seniorCitizen}/help-requests', [HelpRequestController::class, 'forSenior']);

    // User Management > App Users (read-only).
    Route::get('/app-accounts', [AppAccountController::class, 'index']);

    // Photos the senior app sent with Medical, Burial, Help or ID requests
    Route::get('/request-attachments', [RequestAttachmentController::class, 'index']);
    Route::get('/request-attachments/{requestAttachment}/file', [RequestAttachmentController::class, 'file']);

    // Activity Log / Audit Trail (read-only)
    Route::get('/activity-logs/options', [ActivityLogController::class, 'options']);
    Route::get('/activity-logs', [ActivityLogController::class, 'index']);
    Route::get('/activity-logs/{activityLog}', [ActivityLogController::class, 'show']);

    // Pension releases (previously outside the login check)
    Route::get('/pension-releases', [PensionReleaseController::class, 'index']);
    Route::post('/pension-releases', [PensionReleaseController::class, 'store']);
    Route::match(['put', 'patch'], '/pension-releases/{pensionRelease}', [PensionReleaseController::class, 'update']);
});

Route::post('/login', [AuthController::class, 'login']);
Route::middleware(['auth:sanctum', 'staff'])->post('/logout', [AuthController::class, 'logout']);

// Senior mobile app (my_senior_app). Tokens from these routes only work here.
Route::prefix('mobile')->group(function () {
    // Sign-in: code (proves the phone), then MPIN (proves the owner).
    Route::post('/auth/code', [Mobile\AuthController::class, 'sendCode'])->middleware('throttle:6,1');
    Route::post('/auth/verify', [Mobile\AuthController::class, 'verifyCode'])->middleware('throttle:15,1');
    Route::post('/auth/register', [Mobile\AuthController::class, 'register'])->middleware('throttle:10,1');
    Route::post('/auth/login', [Mobile\AuthController::class, 'login'])->middleware('throttle:10,1');
    Route::post('/auth/mpin/reset', [Mobile\AuthController::class, 'resetMpin'])->middleware('throttle:10,1');

    // Public, read-only: active announcements for everyone.
    Route::get('/announcements', [Mobile\AnnouncementController::class, 'index']);

    Route::middleware(['auth:sanctum', 'app.account'])->group(function () {
        Route::post('/auth/sign-out', [Mobile\AuthController::class, 'signOut']);
        Route::post('/auth/mpin/change', [Mobile\AuthController::class, 'changeMpin'])->middleware('throttle:10,1');
        Route::get('/profile', [Mobile\ProfileController::class, 'show']);
        Route::post('/profile', [Mobile\ProfileController::class, 'update']);
        // App-profile photo (shown beside the senior's name in User Management).
        Route::post('/profile/photo', [Mobile\ProfileController::class, 'uploadPhoto']);
        Route::post('/profile/photo/remove', [Mobile\ProfileController::class, 'removePhoto']);
        Route::get('/notifications', [Mobile\SeniorServicesController::class, 'notifications']);

        // Linking the account to its senior citizen record.
        Route::post('/identity/lookup', [Mobile\IdentityController::class, 'lookup'])->middleware('throttle:10,1');
        Route::post('/identity/verify', [Mobile\IdentityController::class, 'verify'])->middleware('throttle:6,1');

        // Senior citizen registration (Document Verification on the web).
        Route::post('/documents', [Mobile\ApplicationController::class, 'uploadDocument']);
        Route::post('/application/submit', [Mobile\ApplicationController::class, 'submit']);
        Route::get('/application', [Mobile\ApplicationController::class, 'status']);

        // Services for a linked senior citizen record.
        Route::middleware('app.linked')->group(function () {
            Route::get('/wallet', [Mobile\SeniorServicesController::class, 'wallet']);
            Route::get('/pension', [Mobile\SeniorServicesController::class, 'pension']);

            // Personal Information > Request a correction.
            Route::get('/profile/corrections', [Mobile\ProfileCorrectionController::class, 'index']);
            Route::post('/profile/corrections', [Mobile\ProfileCorrectionController::class, 'store'])
                ->middleware('throttle:10,1');

            Route::get('/medical-requests', [Mobile\RequestController::class, 'medicalIndex']);
            Route::post('/medical-requests', [Mobile\RequestController::class, 'medicalStore']);
            Route::get('/burial-requests', [Mobile\RequestController::class, 'burialIndex']);
            Route::post('/burial-requests', [Mobile\RequestController::class, 'burialStore']);
            Route::get('/help-requests', [Mobile\RequestController::class, 'helpIndex']);
            Route::post('/help-requests', [Mobile\RequestController::class, 'helpStore']);
            Route::get('/senior-id/replacement-requests', [Mobile\RequestController::class, 'idReplacementIndex']);
            Route::post('/senior-id/replacement-requests', [Mobile\RequestController::class, 'idReplacementStore']);

            foreach (['medical-requests', 'burial-requests', 'help-requests'] as $kind) {
                Route::post("/{$kind}/{reference}/attachments", [Mobile\RequestController::class, 'attach'])
                    ->defaults('kind', $kind);
            }
            Route::post('/senior-id/replacement-requests/{reference}/attachments', [Mobile\RequestController::class, 'attach'])
                ->defaults('kind', 'id-replacement');
        });
    });
});

Route::post('/forgot-password', [PasswordResetController::class, 'sendLink'])
    ->middleware('throttle:5,1');

Route::post('/reset-password', [PasswordResetController::class, 'reset'])
    ->middleware('throttle:5,1');