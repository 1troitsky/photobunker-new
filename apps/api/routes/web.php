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
    Route::put('/device-revocations/{operationId}', [\\App\\Http\\Controllers\\DeviceRevocationIntentController::class,'commit']);
});


// Same-origin authenticated account/device sessions, CSRF and no public S3 URLs.
Route::prefix('photos/v1')->middleware('throttle:100,1,photos')->group(function () {
    // Recipient thumbnail paths are separate from owner-only PhotoSync.
    Route::get('/shared/grants/{grantId}/photos',
        [\App\Http\Controllers\PhotoRecipientController::class,'sharedPhotos']);
    Route::put('/shared/grants/{grantId}/photos/{photoId}/assets/{assetId}',
        [\App\Http\Controllers\PhotoRecipientController::class,'publish']);
    Route::get('/shared/grants/{grantId}/photos/{photoId}/assets/{assetId}',
        [\App\Http\Controllers\PhotoRecipientController::class,'manifest']);
    Route::get('/shared/grants/{grantId}/photos/{photoId}/assets/{assetId}/ciphertext',
        [\App\Http\Controllers\PhotoRecipientController::class,'ciphertext']);
    Route::get('/list', [GalleryController::class,'index']);
    Route::post('/names/reserve', [PhotoNamesController::class,'reserve']);
    Route::post('/names/claim', [PhotoNamesController::class,'claim']);
    Route::post('/{photoId}/metadata/reserve', [PhotoMetadataController::class,'reserve']);
    Route::put('/{photoId}/metadata/{assetId}', [PhotoMetadataController::class,'upload']);
    Route::post('/{photoId}/metadata/finalize', [PhotoMetadataController::class,'finalize']);
    Route::post('/{photoId}/edits/reserve', [\App\Http\Controllers\PhotoEditController::class,'reserve']);
    Route::put('/{photoId}/edits/{assetId}', [\App\Http\Controllers\PhotoEditController::class,'upload']);
    Route::post('/{photoId}/edits/finalize', [\App\Http\Controllers\PhotoEditController::class,'finalize']);
    Route::post('/reserve', [PhotoSyncController::class,'reserve']);
    Route::put('/{photoId}/objects/{assetId}', [PhotoSyncController::class,'upload']);
    Route::post('/{photoId}/finalize', function (\Illuminate\Http\Request $r,string $photoId,Finalization $f) {
        return response()->json($f->finalize($r,$photoId))->header('Cache-Control','no-store');
    });
    Route::get('/{photoId}/review', [\App\Http\Controllers\AssignmentPhotoReviewController::class,'show']);
    Route::put('/{photoId}/review', [\App\Http\Controllers\AssignmentPhotoReviewController::class,'mutate']);
    Route::get('/{photoId}/receipt', [PhotoSyncController::class,'receipt']);
    Route::get('/{photoId}/recovery-checks/summary',
        [\\App\\Http\\Controllers\\PhotoRecoveryCheckController::class,'summary']);
    Route::get('/{photoId}/recovery-checks',
        [\\App\\Http\\Controllers\\PhotoRecoveryCheckController::class,'index']);
    Route::put('/{photoId}/recovery-checks/{assetId}',
        [\\App\\Http\\Controllers\\PhotoRecoveryCheckController::class,'store']);
    Route::get('/{photoId}/manifests', [PhotoSyncController::class,'manifests']);
    Route::get('/{photoId}/objects/{assetId}', [PhotoSyncController::class,'read']);
    Route::delete('/{photoId}',function(\Illuminate\Http\Request $r,string $photoId,Lifecycle $life,\App\Photo\PhotoSync $sync) {
        $sync->origin($r);[$a]=$sync->actor($r);
        // An owner may still delete their photo after an assignment is retired.
        $p=$sync->requirePhoto($photoId,$a->id,false,false);
        $life->mark($p->id,'revoked');
        \App\Jobs\PhotoCleanupJob::dispatch($p->id);
        return $sync->json(['state'=>'deleting'],202);
    });
});


// Owner-only anonymous encrypted Assignment aggregate; separate rate-limit budget.
Route::prefix('assignments/v1')->middleware('throttle:60,1,assignments')->group(function(){
    // Explicit assignment invitation lifecycle only. No PhotoSync read grant.
    Route::get('/grants', [\App\Http\Controllers\AssignmentGrantController::class,'index']);
    Route::put('/grants/operations/{operationId}', [\App\Http\Controllers\AssignmentGrantController::class,'mutate']);
    Route::get('/list',[\App\Http\Controllers\AssignmentController::class,'index']);
    Route::get('/{assignmentId}/history',[\App\Http\Controllers\AssignmentController::class,'history']);
    Route::get('/{assignmentId}/progress',[\App\Http\Controllers\AssignmentController::class,'progress']);
    Route::get('/{assignmentId}',[\App\Http\Controllers\AssignmentController::class,'show']);
    Route::put('/{assignmentId}',[\App\Http\Controllers\AssignmentController::class,'mutate']);
});

// R2-09: PB2 device-signed, account-scoped Team/Contacts operations. Never grants photo ACL.
Route::prefix('collaboration/v1')->middleware('throttle:60,1,collaboration')->group(function(){
    Route::get('/snapshot',[\App\Http\Controllers\CollaborationController::class,'snapshot']);
    Route::put('/operations/{operationId}',[\App\Http\Controllers\CollaborationController::class,'mutate']);
});
