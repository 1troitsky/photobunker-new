<?php
declare(strict_types=1);
namespace App\Http\Controllers;

use App\Identity\Protocol as P;
use App\Photo\PhotoSync;
use App\Photo\RecipientGrantAccess;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Storage;

/** Only one explicitly approved ciphertext thumbnail per grant/photo/asset. */
final class PhotoRecipientController extends Controller {
    public function __construct(private readonly PhotoSync $sync,
        private readonly RecipientGrantAccess $access){}

    public function publish(Request $request,string $grantId,string $photoId,string $assetId){
        $this->sync->origin($request);[$account,$device]=$this->sync->actor($request);
        P::uuid($grantId);P::uuid($photoId);P::uuid($assetId);
        $body=P::exact($request->json()->all(),['contract','signature','deviceId','deviceSpki','rootSignature']);
        abort_unless(is_string($body['contract'])&&is_string($body['signature'])&&
            strlen($body['contract'])>=300&&strlen($body['contract'])<=8000,422);
        try{$c=json_decode($body['contract'],true,32,JSON_THROW_ON_ERROR);}
        catch(\Throwable){abort(422);}
        abort_unless(is_array($c)&&!array_is_list($c),422);
        P::exact($c,['v','operationId','grantId','generation','assignmentId',
            'ownerAccountId','recipientAccountId','photoId','assetId','kind',
            'assetRevision','expiresAt','cipherDigest','envelope']);
        abort_unless($c['v']===1&&$c['grantId']===$grantId&&$c['photoId']===$photoId&&
            $c['assetId']===$assetId&&$c['ownerAccountId']===$account->id&&
            $c['kind']==='thumbnail'&&is_int($c['generation'])&&$c['generation']>=2&&
            is_int($c['assetRevision'])&&$c['assetRevision']>=1&&
            is_int($c['expiresAt'])&&$c['expiresAt']>PhotoSync::nowMs()&&
            is_string($c['cipherDigest'])&&preg_match('/^[a-f0-9]{64}$/D',$c['cipherDigest'])===1,422);
        foreach(['operationId','assignmentId','recipientAccountId'] as $key){
            abort_unless(is_string($c[$key]),422);P::uuid($c[$key]);
        }
        P::uuid($c['operationId']);
        $e=$c['envelope'];
        abort_unless(is_array($e)&&!array_is_list($e),422);
        P::exact($e,['v','context','iv','ciphertext']);
        abort_unless($e['v']===1&&is_array($e['context'])&&!array_is_list($e['context']),422);
        P::exact($e['context'],['grantId','generation','assignmentId','ownerAccountId',
            'recipientAccountId','photoId','assetId','kind','revision','expiresAt','cipherDigest']);
        abort_unless($e['context']===[
            'grantId'=>$c['grantId'],'generation'=>$c['generation'],
            'assignmentId'=>$c['assignmentId'],'ownerAccountId'=>$c['ownerAccountId'],
            'recipientAccountId'=>$c['recipientAccountId'],'photoId'=>$c['photoId'],
            'assetId'=>$c['assetId'],'kind'=>$c['kind'],'revision'=>$c['assetRevision'],
            'expiresAt'=>$c['expiresAt'],'cipherDigest'=>$c['cipherDigest'],
        ],422);
        abort_unless(is_string($e['iv'])&&is_string($e['ciphertext']),422);
        P::b64($e['iv'],12);P::b64($e['ciphertext'],48);
        abort_unless(json_encode($c,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)===$body['contract'],422);
        abort_unless(P::verify($device->signing_spki,
            "photobunker.photo-recipient.v1\n".$body['contract'],$body['signature']),401);
        abort_unless(is_string($body['deviceId'])&&is_string($body['deviceSpki'])&&
            is_string($body['rootSignature']),422);
        P::uuid($body['deviceId']);P::spki($body['deviceSpki']);
        abort_unless($device->id===$body['deviceId']&&
            hash_equals($device->signing_spki,$body['deviceSpki']),401);
        $accountRoot=DB::table('identity_accounts')->where('id',$account->id)
            ->where('status','ready')->value('account_spki');
        abort_unless(is_string($accountRoot),401);
        $proofMessage="photobunker.photo-recipient-root.v1\n".$device->id.
            "\n".$device->signing_spki."\n".$body['contract'];
        abort_unless(P::verify($accountRoot,$proofMessage,$body['rootSignature']),401);
        $hash=hash('sha256',$body['contract']);
        return DB::transaction(function()use($c,$account,$device,$hash,$body,$grantId,$photoId,$assetId){
            $grant=DB::table('assignment_grants_v1')->where('id',$grantId)->lockForUpdate()->first();
            abort_unless($grant&&$grant->owner_account_id===$account->id&&
                $grant->recipient_account_id===$c['recipientAccountId']&&
                $grant->assignment_id===$c['assignmentId']&&
                $grant->state==='accepted'&&$grant->revoked_at===null&&$grant->accepted_at!==null&&
                (int)$grant->generation===$c['generation'],404);
            // Publish only while the relationship is currently valid. An accepted
            // invitation is not sufficient after a contact block/removal.
            $owner=$grant->owner_account_id;$recipient=$grant->recipient_account_id;
            $blocked=DB::table('contact_blocks_v1')->where(fn($q)=>$q
                ->where('account_id',$owner)->where('blocked_account_id',$recipient))
                ->orWhere(fn($q)=>$q->where('account_id',$recipient)
                    ->where('blocked_account_id',$owner))->exists();
            abort_if($blocked,404);
            [$left,$right]=strcmp($owner,$recipient)<0?[$owner,$recipient]:[$recipient,$owner];
            abort_unless(DB::table('contact_links_v1')->where('left_account_id',$left)
                ->where('right_account_id',$right)->where('state','accepted')->exists(),404);
            $p=$this->sync->requirePhoto($photoId,$account->id,true);
            abort_unless((int)$p->expires_at===$c['expiresAt'],404);
            $binding=DB::table('assignment_photo_bindings_v1')->where('photo_id',$photoId)
                ->where('assignment_id',$grant->assignment_id)
                ->where('author_account_id',$account->id)->first();
            abort_unless($binding,404);
            $asset=DB::table('photo_objects')->where('id',$assetId)->where('photo_id',$photoId)
                ->where('kind','thumbnail')->where('state','active')->first();
            abort_unless($asset&&(int)$asset->revision===$c['assetRevision'],404);
            $manifest=json_decode($asset->manifest_json,true,32,JSON_THROW_ON_ERROR);
            abort_unless($manifest['cipherDigest']===$c['cipherDigest']&&
                $manifest['accountId']===$account->id&&$manifest['expiresAt']===$c['expiresAt'],404);
            $old=DB::table('photo_recipient_keys_v1')->where('grant_id',$grantId)
                ->where('photo_id',$photoId)->where('asset_id',$assetId)
                ->where('generation',$c['generation'])->first();
            if($old){
                abort_unless($old->operation_id===$c['operationId']&&
                    hash_equals($old->contract_hash,$hash),409);
                return $this->sync->json(['accepted'=>true,'replayed'=>true,'operationId'=>$old->operation_id]);
            }
            abort_if(DB::table('photo_recipient_keys_v1')->where('operation_id',$c['operationId'])->exists(),409);
            DB::table('photo_recipient_keys_v1')->insert([
                'grant_id'=>$grantId,'generation'=>$c['generation'],'photo_id'=>$photoId,
                'asset_id'=>$assetId,'owner_account_id'=>$account->id,
                'recipient_account_id'=>$c['recipientAccountId'],
                'operation_id'=>$c['operationId'],'contract_hash'=>$hash,
                'contract_json'=>$body['contract'],'signature'=>$body['signature'],
                'signer_spki'=>$device->signing_spki,
                'publisher_device_id'=>$device->id,
                'owner_root_signature'=>$body['rootSignature'],'created_at'=>now(),
            ]);
            return $this->sync->json(['accepted'=>true,'operationId'=>$c['operationId']]);
        },3);
    }


    /**
     * Cursor scans opaque photo IDs; every returned row must pass the same
     * live, revision-specific ACL as its manifest and ciphertext endpoints.
     * No metadata or raw object paths are exposed in this list.
     */
    public function sharedPhotos(Request $r,string $grantId){
        [$actor]=$this->sync->actor($r);
        P::uuid($grantId);
        abort_unless(config('photo_sync.recipient_thumbnail_reads_enabled',false)===true,404);
        $grant=DB::table('assignment_grants_v1')->where('id',$grantId)
            ->where('recipient_account_id',$actor->id)->where('state','accepted')
            ->whereNotNull('accepted_at')->whereNull('revoked_at')->first();
        abort_unless($grant,404);
        $after=$r->query('after','');
        abort_unless(is_string($after),422);
        $last='';
        if($after!==''){
            abort_unless(strlen($after)>=40&&strlen($after)<=768&&
                preg_match('/^[A-Za-z0-9_-]+$/D',$after)===1,422);
            try{
                $encoded=strtr($after,'-_','+/');
                $encoded.=str_repeat('=',(4-strlen($encoded)%4)%4);
                $cursor=json_decode(Crypt::decryptString($encoded),true,12,JSON_THROW_ON_ERROR);
            }catch(\Throwable){abort(422);}
            abort_unless(is_array($cursor)&&!array_is_list($cursor)&&
                array_keys($cursor)===['v','account','grant','generation','last','until']&&
                $cursor['v']===1&&$cursor['account']===$actor->id&&
                $cursor['grant']===$grantId&&$cursor['generation']===(int)$grant->generation&&
                is_int($cursor['until'])&&$cursor['until']>=time()&&
                is_string($cursor['last']),422);
            P::uuid($cursor['last']);
            $last=$cursor['last'];
        }
        $size=$r->query('limit','30');
        abort_unless(is_string($size)&&ctype_digit($size)&&
            (int)$size>=1&&(int)$size<=50,422);
        $limit=(int)$size;
        // Use the next scanned cursor, not the last visible item: otherwise
        // a long streak of revoked assets can cause pagination to loop.
        $query=DB::table('photo_recipient_keys_v1 as k')
            ->join('photo_objects as o','o.id','=','k.asset_id')
            ->where('k.grant_id',$grantId)->where('k.generation',$grant->generation)
            ->where('o.kind','thumbnail')->where('o.state','active');
        if($last!=='')$query->where('k.photo_id','>',$last);
        $candidates=$query->select('k.photo_id')
            ->selectRaw('MIN(CAST(k.asset_id AS TEXT)) as asset_id')
            ->groupBy('k.photo_id')->orderBy('k.photo_id')
            ->limit($limit+1)->get();
        $results=[];
        foreach($candidates->take($limit) as $candidate){
            try{
                [, $photo,$asset]=$this->access->resolved($grantId,
                    $candidate->photo_id,$candidate->asset_id,$actor->id);
                $results[]=[
                    'photoId'=>$photo->id,'assetId'=>$asset->id,
                    'expiresAt'=>(int)$photo->expires_at,
                ];
            }catch(\Symfony\Component\HttpKernel\Exception\HttpExceptionInterface $e){
                if($e->getStatusCode()!==404&&$e->getStatusCode()!==410)throw $e;
            }
        }
        $scanned=$candidates->take($limit);
        $next=null;
        if($candidates->count()>$limit&&$scanned->isNotEmpty()){
            $opaque=Crypt::encryptString(json_encode([
                'v'=>1,'account'=>$actor->id,'grant'=>$grantId,
                'generation'=>(int)$grant->generation,
                'last'=>$scanned->last()->photo_id,'until'=>time()+1800,
            ],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR));
            $next=rtrim(strtr($opaque,'+/','-_'),'=');
        }
        return $this->sync->json(['photos'=>$results,'nextCursor'=>$next]);
    }

    private function authorized(Request $request,string $grantId,string $photoId,string $assetId):array {
        [$account]=$this->sync->actor($request);
        // Deployed without independent review? Keep this entire recipient surface closed.
        abort_unless(config('photo_sync.recipient_thumbnail_reads_enabled',false)===true,404);
        return $this->access->resolved($grantId,$photoId,$assetId,$account->id);
    }
    public function manifest(Request $r,string $grantId,string $photoId,string $assetId){
        [, $photo,$asset,$key,$manifest]=$this->authorized($r,$grantId,$photoId,$assetId);
        return $this->sync->json([
            'photoId'=>$photo->id,'assetId'=>$asset->id,
            'bytes'=>(int)$asset->bytes,'sha256'=>$asset->sha256,
            'manifest'=>$manifest,'contract'=>$key->contract_json,
            'signature'=>$key->signature,'signerSpki'=>$key->signer_spki,
            'publisherDeviceId'=>$key->publisher_device_id,
            'ownerRootSignature'=>$key->owner_root_signature,
            'ownerAccountSpki'=>DB::table('identity_accounts')
                ->where('id',$photo->account_id)->value('account_spki'),
        ]);
    }
    public function ciphertext(Request $r,string $grantId,string $photoId,string $assetId){
        [,,$asset]=$this->authorized($r,$grantId,$photoId,$assetId);
        $stream=Storage::disk(config('photo_sync.disk'))->readStream($asset->object_key);
        abort_unless(is_resource($stream),503);
        return response()->stream(function()use($stream,$grantId,$photoId,$assetId,$r){
            try{
                while(!feof($stream)){
                    // Revocation/expiry checks even between network chunks. Bytes already
                    // received before revoke cannot be remotely erased.
                    $this->authorized($r,$grantId,$photoId,$assetId);
                    $bytes=fread($stream,65536);
                    if($bytes===false)break;
                    echo $bytes;flush();
                }
            }finally{fclose($stream);}
        },200,['Content-Type'=>'application/octet-stream','Cache-Control'=>'no-store, private',
            'X-Content-Type-Options'=>'nosniff','X-Cipher-SHA256'=>$asset->sha256]);
    }
}
