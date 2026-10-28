<?php
use App\Http\Controllers\IdentityController;
use Illuminate\Support\Facades\Route;

Route::prefix('identity/v2')->middleware('throttle:40,1')->group(function () {
    Route::get('/csrf', [IdentityController::class,'csrf']);
    Route::post('/prepare', [IdentityController::class,'prepare']);
    Route::post('/challenges', [IdentityController::class,'challenge']);
    Route::post('/proof', [IdentityController::class,'proof']);
    Route::get('/recovery/{locator}', [IdentityController::class,'recovery'])->where('locator','[A-Za-z0-9_-]{22}');
    Route::post('/pairings', [IdentityController::class,'pairStart']);
    Route::post('/pairings/{id}/poll', [IdentityController::class,'pairPoll']);
    Route::post('/pairings/{id}/approve', [IdentityController::class,'pairApprove']);
    Route::get('/pairings', [IdentityController::class,'pairList']);
    Route::get('/session', [IdentityController::class,'me']);
    Route::get('/time', [IdentityController::class,'time']);
    Route::delete('/session', [IdentityController::class,'logout']);
    Route::post('/rotations/status', [IdentityController::class,'rotationStatus']);
    Route::get('/devices', [IdentityController::class,'devices']);
    Route::delete('/devices/{id}', [IdentityController::class,'revoke']);
});
