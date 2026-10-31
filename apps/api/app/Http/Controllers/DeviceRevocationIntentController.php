<?php
declare(strict_types=1);

namespace App\Http\Controllers;

use App\Identity\Protocol as P;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Authenticated first commit, device-signed exact replay after session revocation.
 * This endpoint revokes ONLY the signing device. It never deletes photos,
 * OPFS, assignments, recovery keys or another enrolled device.
 */
final class DeviceRevocationIntentController extends Controller
{
    private function receipt(object $row): JsonResponse {
        return response()->json([
            'operationId'=>$row->operation_id,'accountId'=>$row->account_id,
            'deviceId'=>$row->device_id,'intent'=>$row->intent,
            'payloadHash'=>$row->payload_hash,'state'=>'revoked',
            'committedAt'=>\Carbon\Carbon::parse($row->committed_at)->utc()->format('Y-m-d\TH:i:s.v\Z'),
        ])->header('Cache-Control','no-store');
    }

    public function commit(Request $request,string $operationId): JsonResponse {
        $origin=$request->headers->get('Origin');
        abort_unless(is_string($origin)&&hash_equals(rtrim(config('app.url'),'/'),$origin),403);
        P::uuid($operationId);
        $input=$request->json()->all();
        abort_unless(is_array($input),422);
        P::exact($input,['accountId','deviceId','intent','operationId','signature']);
        foreach (['accountId','deviceId','operationId'] as $field) {
            abort_unless(is_string($input[$field]),422);
            P::uuid($input[$field]);
        }
        abort_unless($input['operationId']===$operationId,422);
        abort_unless(in_array($input['intent'],['local-delete','emergency'],true),422);
        abort_unless(is_string($input['signature']),422);
        $body=['accountId'=>$input['accountId'],'deviceId'=>$input['deviceId'],
            'intent'=>$input['intent'],'operationId'=>$operationId];
        $canonical=P::canonical($body);
        $message="photobunker.device-revocation.v1\n".$canonical;
        $digest=hash('sha256',$canonical);
        $signatureHash=hash('sha256',$input['signature']);

        $result=DB::transaction(function () use ($request,$input,$operationId,$digest,$signatureHash,$message) {
            // Existing receipt is checked BEFORE session validation so a lost
            // response can be recovered after the first successful self-revoke.
            $existing=DB::table('identity_device_revocation_intents')
                ->where('operation_id',$operationId)->lockForUpdate()->first();
            if ($existing) {
                abort_unless(hash_equals($existing->account_id,$input['accountId']) &&
                    hash_equals($existing->device_id,$input['deviceId']) &&
                    hash_equals($existing->intent,$input['intent']) &&
                    hash_equals($existing->payload_hash,$digest) &&
                    hash_equals($existing->signature_hash,$signatureHash),409);
                return $existing;
            }
            $account=DB::table('identity_accounts')->where('id',$input['accountId'])
                ->where('status','ready')->first();
            $device=DB::table('identity_devices')->where('id',$input['deviceId'])
                ->where('account_id',$input['accountId'])->lockForUpdate()->first();
            abort_unless($account&&$device&&!$device->revoked_at,401);
            abort_unless(P::verify($device->signing_spki,$message,$input['signature']),401);
            $sessionAccount=$request->session()->get('identity_account');
            $sessionDevice=$request->session()->get('identity_device');
            $issued=$request->session()->get('identity_issued',0);
            abort_unless($sessionAccount===$input['accountId'] &&
                $sessionDevice===$input['deviceId'] && is_int($issued) &&
                $issued+86400>time(),401);
            $now=now();
            $count=DB::table('identity_devices')->where('id',$device->id)
                ->whereNull('revoked_at')->update(['revoked_at'=>$now,'updated_at'=>$now]);
            abort_unless($count===1,409);
            DB::table('identity_device_revocation_intents')->insert([
                'operation_id'=>$operationId,'account_id'=>$account->id,
                'device_id'=>$device->id,'intent'=>$input['intent'],
                'payload_hash'=>$digest,'signature_hash'=>$signatureHash,
                'committed_at'=>$now,'created_at'=>$now,'updated_at'=>$now,
            ]);
            return DB::table('identity_device_revocation_intents')->where('operation_id',$operationId)->first();
        });
        // A retained receipt can be replayed after invalidation; never recreate a session.
        if($request->session()->get('identity_device')===$input['deviceId']) {
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        }
        return $this->receipt($result);
    }
}
