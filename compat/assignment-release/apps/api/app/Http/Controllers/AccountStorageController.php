<?php

namespace App\Http\Controllers;

use App\Identity\AccountLifecycle;
use App\Identity\Accounts;
use App\Prototype\Retention;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class AccountStorageController extends Controller
{
    private function policy(object $account): array
    {
        return ['inactivityDays' => (int) $account->inactivity_days, 'lastActiveAt' => strtotime($account->last_active_at) * 1000, 'deletesAt' => $account->inactivity_delete_at ? strtotime($account->inactivity_delete_at) * 1000 : null];
    }

    public function show(Request $request, Accounts $accounts, AccountLifecycle $lifecycle): array
    {
        $account = $accounts->current($request);
        $photos = $lifecycle->photos($account->id)->where('state', 'active')->where('expires_at', '>', Retention::milliseconds());

        return [...$this->policy($account), 'ownedPhotos' => $photos->count(), 'encryptedBytes' => (int) DB::table('encrypted_objects')->whereIn('photo_id', $lifecycle->photos($account->id)->whereNull('delete_verified_at')->select('id'))->sum('bytes')];
    }

    public function activity(Request $request, Accounts $accounts, AccountLifecycle $lifecycle): array
    {
        return $this->policy($lifecycle->activity($accounts->current($request)->id));
    }

    public function update(Request $request, Accounts $accounts, AccountLifecycle $lifecycle): array
    {
        $days = $request->validate(['inactivityDays' => 'required|integer|min:30|max:360'])['inactivityDays'];

        return $this->policy($lifecycle->activity($accounts->current($request)->id, (int) $days));
    }

    public function destroy(Request $request, Accounts $accounts, AccountLifecycle $lifecycle): JsonResponse
    {
        $account = $accounts->current($request);
        $data = $request->validate(['accountId' => 'required|uuid', 'confirmation' => 'required|in:DELETE']);
        abort_unless(hash_equals($account->id, $data['accountId']), 409);
        $lifecycle->claim($account->id);

        return response()->json(['state' => 'deletion_queued'], 202)->withoutCookie('pb_identity', '/api/v1/identity');
    }
}
