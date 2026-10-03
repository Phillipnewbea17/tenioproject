<?php

use App\Http\Controllers\AuthController;
use App\Http\Controllers\ApplicationController;
use App\Http\Controllers\Mobile;
use App\Http\Controllers\AnnouncementController;
use App\Http\Controllers\SeniorCitizenController;
use App\Http\Controllers\SeniorIdController;
use App\Http\Controllers\ReportController;
use App\Http\Controllers\ActivityLogController;
use App\Http\Controllers\FundController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\HelpRequestController;
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
    
    // User Management
    Route::get('/users', [UserController::class, 'index']);
    Route::post('/users', [UserController::class, 'store']);
    Route::match(['put', 'patch'], '/users/{user}', [UserController::class, 'update']);
    Route::post('/users/{user}/reset-password', [UserController::class, 'resetPassword']);

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
    Route::post('/auth/code', [Mobile\AuthController::class, 'sendCode'])->middleware('throttle:6,1');
    Route::post('/auth/verify', [Mobile\AuthController::class, 'verifyCode'])->middleware('throttle:15,1');

    Route::middleware(['auth:sanctum', 'app.account'])->group(function () {
        Route::post('/auth/sign-out', [Mobile\AuthController::class, 'signOut']);
        Route::get('/profile', [Mobile\ProfileController::class, 'show']);
        Route::post('/profile', [Mobile\ProfileController::class, 'update']);
        Route::post('/documents', [Mobile\ApplicationController::class, 'uploadDocument']);
        Route::post('/application/submit', [Mobile\ApplicationController::class, 'submit']);
        Route::get('/application', [Mobile\ApplicationController::class, 'status']);
    });
});

Route::post('/forgot-password', [PasswordResetController::class, 'sendLink'])
    ->middleware('throttle:5,1');

Route::post('/reset-password', [PasswordResetController::class, 'reset'])
    ->middleware('throttle:5,1');