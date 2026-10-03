<?php

use App\Http\Controllers\AuthController;
use App\Http\Controllers\ApplicationController;
use App\Http\Controllers\AnnouncementController;
use App\Http\Controllers\SeniorCitizenController;
use App\Http\Controllers\PasswordResetController;
use App\Http\Controllers\PensionReleaseController;
use App\Http\Controllers\UserController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\MedicalRequestController;
use App\Http\Controllers\BurialRequestController;
use App\Http\Controllers\Mobile\MobileAnnouncementController;

// SeniorCompanion mobile app (public, read-only)
Route::prefix('mobile')->group(function () {
    Route::get('/announcements', [MobileAnnouncementController::class, 'index']);
});


Route::middleware('auth:sanctum')->group(function () {
    Route::apiResource('senior-citizens', SeniorCitizenController::class);
    Route::apiResource('announcements', AnnouncementController::class);
    Route::apiResource('applications', ApplicationController::class);
    Route::apiResource('medical-requests', MedicalRequestController::class);
    Route::apiResource('burial-requests', BurialRequestController::class);
    
    // User Management
    Route::get('/users', [UserController::class, 'index']);
    Route::post('/users', [UserController::class, 'store']);
    Route::match(['put', 'patch'], '/users/{user}', [UserController::class, 'update']);
    Route::post('/users/{user}/reset-password', [UserController::class, 'resetPassword']);
});

Route::post('/login', [AuthController::class, 'login']);
Route::middleware('auth:sanctum')->post('/logout', [AuthController::class, 'logout']);

Route::post('/forgot-password', [PasswordResetController::class, 'sendLink'])
    ->middleware('throttle:5,1');

Route::post('/reset-password', [PasswordResetController::class, 'reset'])
    ->middleware('throttle:5,1');

Route::get('/pension-releases', [PensionReleaseController::class, 'index']);
Route::post('/pension-releases', [PensionReleaseController::class, 'store']);