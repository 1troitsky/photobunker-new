<?php
use App\Http\Controllers\IdentityController;
use App\Http\Controllers\PhotoSyncController;
use App\Photo\Finalization;
use App\Photo\Lifecycle;
use App\Http\Controllers\GalleryController;
use App\Http\Controllers\PhotoMetadataController;
use App\Http\Controllers\PhotoNamesController;
use Illuminate\Support\Facades\Route;

// Keep identity and photo traffic in independent limiter buckets. A photo
// upload must never consume the recovery/login budget for the same client IP.
Route::prefix('identity/v2')->middleware('throttle:40,1,identity')->group(function () {
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


// Same-origin authenticated account/device sessions, CSRF and no public S3 URLs.
Route::prefix('photos/v1')->middleware('throttle:100,1,photos')->group(function () {
    Route::get('/list', [GalleryController::class,'index']);
    Route::post('/names/reserve', [PhotoNamesController::class,'reserve']);
    Route::post('/names/claim', [PhotoNamesController::class,'claim']);
    Route::post('/{photoId}/metadata/reserve', [PhotoMetadataController::class,'reserve']);
    Route::put('/{photoId}/metadata/{assetId}', [PhotoMetadataController::class,'upload']);
    Route::post('/{photoId}/metadata/finalize', [PhotoMetadataController::class,'finalize']);
    Route::post('/reserve', [PhotoSyncController::class,'reserve']);
    Route::put('/{photoId}/objects/{assetId}', [PhotoSyncController::class,'upload']);
    Route::post('/{photoId}/finalize', function (\Illuminate\Http\Request $r,string $photoId,Finalization $f) {
        return response()->json($f->finalize($r,$photoId))->header('Cache-Control','no-store');
    });
    Route::get('/{photoId}/receipt', [PhotoSyncController::class,'receipt']);
    Route::get('/{photoId}/manifests', [PhotoSyncController::class,'manifests']);
    Route::get('/{photoId}/objects/{assetId}', [PhotoSyncController::class,'read']);
    Route::delete('/{photoId}',function(\Illuminate\Http\Request $r,string $photoId,Lifecycle $life,\App\Photo\PhotoSync $sync) {
        $sync->origin($r);[$a]=$sync->actor($r);
        $p=$sync->requirePhoto($photoId,$a->id);
        $life->mark($p->id,'revoked');
        \App\Jobs\PhotoCleanupJob::dispatch($p->id);
        return $sync->json(['state'=>'deleting'],202);
    });
});
