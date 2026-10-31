<?php
declare(strict_types=1);

namespace App\Http\Controllers;

use App\Identity\Protocol as P;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * An independently enrolled device ATTESTS that it decrypted bytes fetched
 * via the authenticated cloud read API. This is NOT a zero-knowledge proof of
 * decryption and MUST NEVER authorize client-side or server-side deletion.
 */
final class PhotoRecoveryCheckController extends Controller
{
    private function receipt(object $row):JsonResponse {
        return response()->json([
            'operationId'=>$row->operation_id,
            'photoId'=>$row->photo_id,'assetId'=>$row->asset_id,
            'originDeviceId'=>$row->origin_device_id,
            'verifiedDeviceId'=>$row->verifier_device_id,
            'cipherSha256'=>$row->cipher_sha256,
            'decryption'=>$row->decryption,
            'payloadHash'=>$row->payload_hash,
            'state'=>'device-attested',
            'verifiedAt'=>\Carbon\Carbon::parse($row->verified_at)->utc()->format('Y-m-d\TH:i:s.v\Z'),
        ])->header('Cache-Control','no-store');
    }
    private function actor(Request $r):array {
        $account=$r->session()->get('identity_account');
        $device=$r->session()->get('identity_device');
        $issued=$r->session()->get('identity_issued',0);
        abort_unless(is_string($account)&&is_string($device)&&is_int($issued)&&
            $issued+86400>time(),401);
        $identity=DB::table('identity_devices')->where('id',$device)
            ->where('account_id',$account)->whereNull('revoked_at')->first();
        abort_unless($identity&&DB::table('identity_accounts')->where('id',$account)
            ->where('status','ready')->exists(),401);
        return [$account,$identity];
    }
    /** Read only current verifier's receipts for still-active cloud objects. */
    public function index(Request $request,string $photoId):JsonResponse {
        P::uuid($photoId);
        [$account,$device]=$this->actor($request);
        $photo=DB::table('photo_records')->where('id',$photoId)
            ->where('account_id',$account)->where('state','active')->first();
        abort_unless($photo,404);
        $objects=DB::table('photo_objects')->where('photo_id',$photoId)
            ->where('state','active')->pluck('id');
        $rows=DB::table('photo_recovery_checks')->where('account_id',$account)
            ->where('photo_id',$photoId)->where('verifier_device_id',$device->id)
            ->whereIn('asset_id',$objects)->orderBy('asset_id')->limit(32)->get();
        return response()->json(['checks'=>$rows->map(fn($row)=>
            $this->receipt($row)->getData(true))->all()])
            ->header('Cache-Control','no-store');
    }
    public function store(Request $request,string $photoId,string $assetId):JsonResponse {
        $origin=$request->headers->get('Origin');
        abort_unless(is_string($origin)&&hash_equals(rtrim(config('app.url'),'/'),$origin),403);
        P::uuid($photoId);P::uuid($assetId);
        [$account,$device]=$this->actor($request);
        $input=$request->json()->all();
        abort_unless(is_array($input),422);
        P::exact($input,['assetId','cipherSha256','decryption','operationId','originDeviceId',
            'photoId','signature','verifiedDeviceId']);
        foreach(['photoId','assetId','originDeviceId','verifiedDeviceId','operationId'] as $field){
            abort_unless(is_string($input[$field]),422);P::uuid($input[$field]);
        }
        foreach(['cipherSha256'] as $field)
            abort_unless(is_string($input[$field])&&
                preg_match('/^[a-f0-9]{64}$/D',$input[$field])===1,422);
        abort_unless($input['decryption']==='aead-verified'&&is_string($input['signature']),422);
        abort_unless($photoId===$input['photoId']&&$assetId===$input['assetId']&&
            $input['verifiedDeviceId']===$device->id&&
            $input['originDeviceId']!==$device->id,422);
        $body=$input;unset($body['signature']);
        $canonical=P::canonical($body);
        $payloadHash=hash('sha256',$canonical);
        $signatureHash=hash('sha256',$input['signature']);
        abort_unless(P::verify($device->signing_spki,
            "photobunker.recovery-check.v1\n".$canonical,$input['signature']),401);
        $row=DB::transaction(function()use($account,$device,$body,$payloadHash,$signatureHash) {
            $photo=DB::table('photo_records')->where('id',$body['photoId'])
                ->where('account_id',$account)->where('state','active')->first();
            abort_unless($photo && $photo->device_id===$body['originDeviceId']&&
                (int)$photo->expires_at>=(int)floor(microtime(true)*1000),409);
            $object=DB::table('photo_objects')->where('id',$body['assetId'])
                ->where('photo_id',$photo->id)->where('state','active')->first();
            abort_unless($object&&
                in_array($object->kind,['master','original','edit','metadata'],true)&&
                hash_equals($object->sha256,$body['cipherSha256']),409);
            $previous=DB::table('photo_recovery_checks')
                ->where('asset_id',$object->id)->where('verifier_device_id',$device->id)
                ->lockForUpdate()->first();
            if($previous){
                abort_unless($previous->operation_id===$body['operationId']&&
                    hash_equals($previous->payload_hash,$payloadHash)&&
                    hash_equals($previous->signature_hash,$signatureHash),409);
                return $previous;
            }
            $now=now();
            DB::table('photo_recovery_checks')->insert([
                'operation_id'=>$body['operationId'],'account_id'=>$account,
                'photo_id'=>$photo->id,'asset_id'=>$object->id,
                'origin_device_id'=>$photo->device_id,'verifier_device_id'=>$device->id,
                'cipher_sha256'=>$object->sha256,'decryption'=>$body['decryption'],
                'payload_hash'=>$payloadHash,'signature_hash'=>$signatureHash,
                'verified_at'=>$now,'created_at'=>$now,'updated_at'=>$now,
            ]);
            return DB::table('photo_recovery_checks')->where('operation_id',$body['operationId'])->first();
        });
        return $this->receipt($row);
    }
}
