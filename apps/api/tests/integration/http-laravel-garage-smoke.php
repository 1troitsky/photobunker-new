<?php
declare(strict_types=1);

/**
 * Network HTTP → real Laravel Identity v2 session → PostgreSQL → Garage.
 * CI only: disposable PG db, isolated bucket, loopback HTTP transport.
 * No bypass/test-only authentication route is installed.
 */
use App\Identity\Protocol as P;
use App\Photo\Lifecycle;
use App\Photo\PhotoSync;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

require dirname(__DIR__,2).'/vendor/autoload.php';
$app=require dirname(__DIR__,2).'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
$origin='http://127.0.0.1:8099';
function expectG1(bool $condition,string $reason):void{
    if(!$condition)throw new RuntimeException('G1_HTTP_INTEGRATION_FAILURE: '.$reason);
}
expectG1(config('database.default')==='pgsql','requires live PostgreSQL');
expectG1(DB::connection()->getDriverName()==='pgsql','requires PostgreSQL driver');
expectG1(config('app.url')==='http://127.0.0.1:8099','requires isolated loopback HTTP origin');
expectG1(config('filesystems.disks.photo-ciphertext.endpoint')==='http://127.0.0.1:3900','requires local Garage');
expectG1(config('filesystems.disks.photo-ciphertext.bucket')==='pb2-ci-g1','requires isolated Garage bucket');
expectG1(config('session.secure')===false,'loopback CI requires nonsecure dev session cookie');
expectG1(config('session.driver')==='file','requires real server-side session persistence');

$cookie=tempnam(sys_get_temp_dir(),'pb2-ci-http-');
expectG1($cookie!==false,'cannot allocate temporary cookie jar');
$token='';
function requestG1(string $method,string $path,array|string|null $body=null):array {
    global $origin,$cookie,$token;
    $ch=curl_init($origin.$path);
    $headers=['Accept: application/json','Origin: '.$origin];
    if($token!=='')$headers[]='X-CSRF-TOKEN: '.$token;
    if(is_array($body)){
        $body=json_encode($body,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        $headers[]='Content-Type: application/json';
    }elseif($body!==null)$headers[]='Content-Type: application/octet-stream';
    curl_setopt_array($ch,[
        CURLOPT_CUSTOMREQUEST=>$method,CURLOPT_RETURNTRANSFER=>true,
        CURLOPT_HTTPHEADER=>$headers,CURLOPT_CONNECTTIMEOUT=>4,CURLOPT_TIMEOUT=>20,
        CURLOPT_COOKIEFILE=>$cookie,CURLOPT_COOKIEJAR=>$cookie,
        CURLOPT_HEADER=>false,
    ]);
    if($body!==null)curl_setopt($ch,CURLOPT_POSTFIELDS,$body);
    $raw=curl_exec($ch);
    $status=curl_getinfo($ch,CURLINFO_HTTP_CODE);
    $error=curl_error($ch);
    curl_close($ch);
    expectG1(is_string($raw),'HTTP transport error: '.$error);
    $parsed=json_decode($raw,true);
    return [$status,is_array($parsed)?$parsed:[], $raw];
}
/**
 * Two independent HTTP connections attempt the same immutable object key.
 * Server must never create two operations or acknowledge a corrupt object.
 */
function parallelPutG1(string $path,string $body):array{
    global $origin,$cookie,$token;
    $mh=curl_multi_init();$handles=[];
    foreach([0,1] as $_){
        $ch=curl_init($origin.$path);
        curl_setopt_array($ch,[
            CURLOPT_CUSTOMREQUEST=>'PUT',CURLOPT_RETURNTRANSFER=>true,
            CURLOPT_HTTPHEADER=>[
                'Accept: application/json','Origin: '.$origin,
                'X-CSRF-TOKEN: '.$token,'Content-Type: application/octet-stream',
            ],
            CURLOPT_COOKIEFILE=>$cookie,CURLOPT_CONNECTTIMEOUT=>4,
            CURLOPT_TIMEOUT=>20,CURLOPT_POSTFIELDS=>$body,
        ]);
        curl_multi_add_handle($mh,$ch);$handles[]=$ch;
    }
    do {
        $code=curl_multi_exec($mh,$running);
        if($running)curl_multi_select($mh,0.2);
    }while($running&&$code===CURLM_OK);
    $statuses=[];
    foreach($handles as $ch){
        $statuses[]=(int)curl_getinfo($ch,CURLINFO_HTTP_CODE);
        expectG1(curl_errno($ch)===0,'parallel PUT transport error');
        curl_multi_remove_handle($mh,$ch);curl_close($ch);
    }
    curl_multi_close($mh);
    return $statuses;
}
function statusG1(array $result,int $status,string $label):array {
    expectG1($result[0]===$status,$label.' expected HTTP '.$status.' got '.$result[0]);
    return $result[1];
}
function pubPair():array {
    $key=openssl_pkey_new(['private_key_type'=>OPENSSL_KEYTYPE_EC,'curve_name'=>'prime256v1']);
    expectG1($key!==false,'EC P-256 generation failed');
    $pem=openssl_pkey_get_details($key)['key'];
    return [$key,P::encode(base64_decode(preg_replace('/-----[^-]+-----|\s+/','',$pem)))];
}
function signG1(string $message,$key):string {
    expectG1(openssl_sign($message,$der,$key,OPENSSL_ALGO_SHA256),'signature failed');
    $index=2;$ints=[];
    foreach([0,1] as $_){
        expectG1(ord($der[$index++])===2,'invalid DER integer');
        $len=ord($der[$index++]);
        $part=substr($der,$index,$len);
        $index+=$len;
        $ints[]=str_pad(ltrim($part,"\0"),32,"\0",STR_PAD_LEFT);
    }
    return P::encode(implode('',$ints));
}
/** Real signed assignment invitation, acceptance and revocation over HTTP. */
function grantCommandG1(string $kind,string $grant,string $assignment,string $target,
    int $generation, $signer):array{
    $op=(string)Str::uuid();$invite=$kind==='invite';
    $body=[
        'v'=>1,'opId'=>$op,'kind'=>$kind,'grantId'=>$grant,
        'assignmentId'=>$assignment,'targetId'=>$invite?$target:null,
        'role'=>$invite?'viewer':null,'expectedGeneration'=>$generation,
        'expiresAt'=>$invite?now()->getTimestampMs()+3600000:null,
        'codeHash'=>$invite?hash('sha256',random_bytes(32)):null,
        'sealedKey'=>$invite?['v'=>1,'iv'=>P::encode(random_bytes(12)),
            'ciphertext'=>P::encode(random_bytes(48))]:null,
    ];
    $raw=json_encode($body,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
    return ['/assignments/v1/grants/operations/'.$op,
        ['contract'=>$raw,'signature'=>signG1("photobunker.assignment-grant.v1\n".$raw,$signer)]];
}
function assetG1(string $account,string $photo,int $expires,string $kind,int $size):array {
    $id=(string)Str::uuid();
    $bytes=random_bytes($size);
    $manifest=[
       'version'=>1,'algorithm'=>'AES-256-GCM','chunkBytes'=>262144,
       'accountId'=>$account,'photoId'=>$photo,'assetId'=>$id,'kind'=>$kind,
       'revision'=>1,'expiresAt'=>$expires,'plainBytes'=>$size-16,
       'cipherBytes'=>$size,'frames'=>[[
          'index'=>0,'offset'=>0,'bytes'=>$size,'plainBytes'=>$size-16,
          'iv'=>P::encode(random_bytes(12)),'digest'=>hash('sha256',$bytes),
       ]],
       'cipherDigest'=>hash('sha256',$bytes),
       'wrappedDEK'=>['iv'=>P::encode(random_bytes(12)),
         'ciphertext'=>P::encode(random_bytes(48))],
    ];
    return [['assetId'=>$id,'kind'=>$kind,'revision'=>1,'bytes'=>$size,
      'sha256'=>hash('sha256',$bytes),'manifest'=>$manifest],$bytes];
}

$ids=[];$keys=[];$assignmentIds=[];$grantIds=[];$guestCookie=null;
try {
    $csrf=statusG1(requestG1('GET','/identity/v2/csrf'),200,'csrf');
    $token=$csrf['csrfToken']??'';
    expectG1(strlen($token)>20,'CSRF token unavailable');
    [$accountPrivate,$accountSpki]=pubPair();
    [$devicePrivate,$deviceSpki]=pubPair();
    $operation=(string)Str::uuid();
    $created=statusG1(requestG1('POST','/identity/v2/prepare',[
        'operationId'=>$operation,'reservationProof'=>P::encode(random_bytes(32)),
    ]),200,'prepare');
    $account=$created['accountId'];$ids[]=$account;
    $device=(string)Str::uuid();
    $locator=P::encode(random_bytes(16));
    $envelope=[
       'v'=>2,'alg'=>'A256GCM','accountId'=>$account,'locator'=>$locator,
       'keyId'=>P::encode(random_bytes(16)),'purpose'=>'recovery','revision'=>1,
       'iv'=>P::encode(random_bytes(12)),'ciphertext'=>P::encode(random_bytes(48)),
    ];
    $payload=[
        'accountId'=>$account,'accountSpki'=>$accountSpki,'deviceId'=>$device,
        'deviceSpki'=>$deviceSpki,'envelopeHash'=>hash('sha256',P::envelope($envelope,$account,$locator,'recovery',1)),
        'locator'=>$locator,'operationId'=>$operation,'purpose'=>'register',
    ];
    $challenge=statusG1(requestG1('POST','/identity/v2/challenges',['payload'=>$payload]),200,'challenge');
    statusG1(requestG1('POST','/identity/v2/proof',[
        'challengeId'=>$challenge['id'],
        'signature'=>signG1($challenge['message'],$accountPrivate),
        'deviceSignature'=>signG1($challenge['message'],$devicePrivate),
        'envelope'=>$envelope,
    ]),200,'proof');
    $identity=statusG1(requestG1('GET','/identity/v2/session'),200,'session persisted');
    expectG1($identity['accountId']===$account&&$identity['deviceId']===$device,'wrong identity session');
    // Identity proof regenerates the session and CSRF token: use the new token.
    $newCsrf=statusG1(requestG1('GET','/identity/v2/csrf'),200,'post-proof csrf');
    $token=$newCsrf['csrfToken']??'';
    expectG1(strlen($token)>20,'post-proof CSRF token unavailable');

    $photo=(string)Str::uuid();$op=(string)Str::uuid();
    $expires=now()->addDay()->getTimestampMs();
    [$master,$masterBytes]=assetG1($account,$photo,$expires,'master',4096);
    [$meta,$metaBytes]=assetG1($account,$photo,$expires,'metadata',128);
    [$thumbnail,$thumbnailBytes]=assetG1($account,$photo,$expires,'thumbnail',512);
    $assets=[$master,$meta,$thumbnail];
    usort($assets,fn($a,$b)=>strcmp($a['assetId'],$b['assetId']));
    foreach($assets as $asset)$keys[]=app(PhotoSync::class)->objectKey($account,$photo,$asset['assetId']);
    $contract=json_encode([
        'version'=>1,'photoId'=>$photo,'operationId'=>$op,'expiresAt'=>$expires,
        'assets'=>$assets,
    ],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
    $reservation=['contract'=>$contract,
        'signature'=>signG1("photobunker.photo-sync.v1\n".$contract,$devicePrivate)];
    statusG1(requestG1('POST','/photos/v1/reserve',$reservation),200,'reserve');
    statusG1(requestG1('POST','/photos/v1/reserve',$reservation),200,'reserve replay');
    $masterPath='/photos/v1/'.$photo.'/objects/'.$master['assetId'];
    $concurrent=parallelPutG1($masterPath,$masterBytes);
    expectG1(in_array(200,$concurrent,true),'parallel upload yielded no success');
    foreach($concurrent as $status)
        expectG1(in_array($status,[200,409],true),'unsafe parallel PUT response '.$status);
    statusG1(requestG1('PUT',$masterPath,$masterBytes),200,'master lost PUT ACK retry');
    $metaPath='/photos/v1/'.$photo.'/objects/'.$meta['assetId'];
    statusG1(requestG1('PUT',$metaPath,$metaBytes),200,'metadata PUT');
    statusG1(requestG1('PUT',$metaPath,$metaBytes),200,'metadata PUT idempotent retry');
    $thumbnailPath='/photos/v1/'.$photo.'/objects/'.$thumbnail['assetId'];
    statusG1(requestG1('PUT',$thumbnailPath,$thumbnailBytes),200,'thumbnail PUT');
    expectG1(DB::table('photo_records')->where('id',$photo)->count()===1,
        'parallel PUT created duplicate photo');
    $final=statusG1(requestG1('POST','/photos/v1/'.$photo.'/finalize',
        ['operationId'=>$op]),200,'finalize');
    expectG1(($final['receipt']['photoId']??null)===$photo,'invalid finalize receipt');
    $retry=statusG1(requestG1('POST','/photos/v1/'.$photo.'/finalize',
        ['operationId'=>$op]),200,'lost finalize ACK');
    expectG1($final['receipt']===$retry['receipt'],'finalize retry changed receipt');
    $read=requestG1('GET','/photos/v1/'.$photo.'/objects/'.$master['assetId']);
    expectG1($read[0]===200,'ciphertext HTTP GET denied');
    expectG1(hash_equals(hash('sha256',$masterBytes),hash('sha256',$read[2])),
        'HTTP body ciphertext digest mismatch');

    // G2: real two-account HTTP sessions + live Postgres + Garage object bytes.
    // Assignment/contact/binding are isolated database fixtures: identity,
    // signed invitations and signed photo access use the production endpoints.
    $assignment=(string)Str::uuid();$assignmentIds[]=$assignment;
    DB::table('assignments')->insert([
        'id'=>$assignment,'account_id'=>$account,'status'=>'in_progress',
        'revision'=>2,'policy_revision'=>1,'mode'=>3,'retention_days'=>1,
        'cipher_envelope'=>'{}','last_operation_id'=>(string)Str::uuid(),
        'created_at'=>now(),'updated_at'=>now(),
    ]);
    DB::table('assignment_photo_bindings_v1')->insert([
        'photo_id'=>$photo,'assignment_id'=>$assignment,
        'author_account_id'=>$account,'assignment_revision'=>2,'policy_revision'=>1,
        'mode'=>3,'retention_days'=>1,'captured_at'=>$expires-86400000,
        'expires_at'=>$expires,'created_at'=>now(),'updated_at'=>now(),
    ]);
    $ownerCookie=$cookie;$ownerToken=$token;
    $guestCookie=tempnam(sys_get_temp_dir(),'pb2-ci-guest-');
    expectG1($guestCookie!==false,'guest cookie jar');
    $cookie=$guestCookie;$token='';
    $guestCsrf=statusG1(requestG1('GET','/identity/v2/csrf'),200,'guest csrf');
    $token=$guestCsrf['csrfToken'];
    [$guestAccountPrivate,$guestAccountSpki]=pubPair();
    [$guestDevicePrivate,$guestDeviceSpki]=pubPair();
    $guestOperation=(string)Str::uuid();
    $guestPrepared=statusG1(requestG1('POST','/identity/v2/prepare',[
        'operationId'=>$guestOperation,'reservationProof'=>P::encode(random_bytes(32)),
    ]),200,'guest prepare');
    $guest=$guestPrepared['accountId'];$ids[]=$guest;
    $guestDevice=(string)Str::uuid();$guestLocator=P::encode(random_bytes(16));
    $guestEnvelope=['v'=>2,'alg'=>'A256GCM','accountId'=>$guest,
        'locator'=>$guestLocator,'keyId'=>P::encode(random_bytes(16)),
        'purpose'=>'recovery','revision'=>1,'iv'=>P::encode(random_bytes(12)),
        'ciphertext'=>P::encode(random_bytes(48))];
    $guestPayload=['accountId'=>$guest,'accountSpki'=>$guestAccountSpki,
        'deviceId'=>$guestDevice,'deviceSpki'=>$guestDeviceSpki,
        'envelopeHash'=>hash('sha256',P::envelope($guestEnvelope,$guest,$guestLocator,'recovery',1)),
        'locator'=>$guestLocator,'operationId'=>$guestOperation,'purpose'=>'register'];
    $guestChallenge=statusG1(requestG1('POST','/identity/v2/challenges',
        ['payload'=>$guestPayload]),200,'guest challenge');
    statusG1(requestG1('POST','/identity/v2/proof',[
        'challengeId'=>$guestChallenge['id'],
        'signature'=>signG1($guestChallenge['message'],$guestAccountPrivate),
        'deviceSignature'=>signG1($guestChallenge['message'],$guestDevicePrivate),
        'envelope'=>$guestEnvelope,
    ]),200,'guest identity proof');
    $token=statusG1(requestG1('GET','/identity/v2/csrf'),200,'guest post-proof csrf')['csrfToken'];
    expectG1(statusG1(requestG1('GET','/identity/v2/session'),200,'guest session')['accountId']===$guest,
        'guest session not distinct from owner');

    [$left,$right]=strcmp($account,$guest)<0?[$account,$guest]:[$guest,$account];
    DB::table('contact_links_v1')->insert([
        'left_account_id'=>$left,'right_account_id'=>$right,
        'requester_id'=>$account,'state'=>'accepted',
        'created_at'=>now(),'updated_at'=>now(),
    ]);
    $cookie=$ownerCookie;$token=$ownerToken;
    $grant=(string)Str::uuid();$grantIds[]=$grant;
    [$invitePath,$inviteBody]=grantCommandG1('invite',$grant,$assignment,$guest,0,$devicePrivate);
    statusG1(requestG1('PUT',$invitePath,$inviteBody),200,'owner signed invitation');
    $cookie=$guestCookie;
    $guestCsrf=statusG1(requestG1('GET','/identity/v2/csrf'),200,'guest csrf after invite');
    $token=$guestCsrf['csrfToken'];
    [$acceptPath,$acceptBody]=grantCommandG1('accept',$grant,$assignment,$guest,1,$guestDevicePrivate);
    statusG1(requestG1('PUT',$acceptPath,$acceptBody),200,'recipient accepts invitation');

    $cookie=$ownerCookie;$token=$ownerToken;
    $sharePath="/photos/v1/shared/grants/$grant/photos/$photo/assets/".$thumbnail['assetId'];
    $context=['grantId'=>$grant,'generation'=>2,'assignmentId'=>$assignment,
        'ownerAccountId'=>$account,'recipientAccountId'=>$guest,
        'photoId'=>$photo,'assetId'=>$thumbnail['assetId'],'kind'=>'thumbnail',
        'revision'=>1,'expiresAt'=>$expires,
        'cipherDigest'=>$thumbnail['manifest']['cipherDigest']];
    $statement=['v'=>1,'operationId'=>(string)Str::uuid(),
        'grantId'=>$grant,'generation'=>2,'assignmentId'=>$assignment,
        'ownerAccountId'=>$account,'recipientAccountId'=>$guest,'photoId'=>$photo,
        'assetId'=>$thumbnail['assetId'],'kind'=>'thumbnail','assetRevision'=>1,
        'expiresAt'=>$expires,'cipherDigest'=>$context['cipherDigest'],
        'envelope'=>['v'=>1,'context'=>$context,
            'iv'=>P::encode(random_bytes(12)),
            'ciphertext'=>P::encode(random_bytes(48))]];
    $wire=json_encode($statement,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
    $publication=['contract'=>$wire,
        'signature'=>signG1("photobunker.photo-recipient.v1\n".$wire,$devicePrivate),
        'deviceId'=>$device,'deviceSpki'=>$deviceSpki,
        'rootSignature'=>signG1("photobunker.photo-recipient-root.v1\n".
            $device."\n".$deviceSpki."\n".$wire,$accountPrivate)];
    statusG1(requestG1('PUT',$sharePath,$publication),200,'signed thumbnail publish');
    statusG1(requestG1('PUT',$sharePath,$publication),200,'signed publish lost ACK');

    $cookie=$guestCookie;$token=$guestCsrf['csrfToken'];
    $listPath="/photos/v1/shared/grants/$grant/photos";
    $received=statusG1(requestG1('GET',$listPath),200,'recipient grant photo list');
    expectG1(count($received['photos']??[])===1 &&
        $received['photos'][0]['assetId']===$thumbnail['assetId'],
        'wrong recipient list');
    $manifest=statusG1(requestG1('GET',$sharePath),200,'recipient encrypted thumbnail manifest');
    expectG1($manifest['manifest']['accountId']===$account,
        'recipient asset AAD is not owner scoped');
    $receivedBody=requestG1('GET',$sharePath.'/ciphertext');
    expectG1($receivedBody[0]===200&&
        hash_equals(hash('sha256',$thumbnailBytes),hash('sha256',$receivedBody[2])),
        'recipient received different encrypted S3 bytes');
    statusG1(requestG1('GET',$masterPath),404,'guest cannot access original');
    DB::table('contact_blocks_v1')->insert([
        'account_id'=>$guest,'blocked_account_id'=>$account,'created_at'=>now(),
    ]);
    statusG1(requestG1('GET',$sharePath),404,'blocked recipient manifest');
    statusG1(requestG1('GET',$sharePath.'/ciphertext'),404,'blocked recipient ciphertext');
    statusG1(requestG1('GET',$listPath),404,'blocked recipient list');
    DB::table('contact_blocks_v1')->where('account_id',$guest)
        ->where('blocked_account_id',$account)->delete();
    $cookie=$ownerCookie;$token=$ownerToken;
    [$revokePath,$revokeBody]=grantCommandG1('revoke',$grant,$assignment,$guest,2,$devicePrivate);
    statusG1(requestG1('PUT',$revokePath,$revokeBody),200,'owner revokes recipient');
    $cookie=$guestCookie;$token=$guestCsrf['csrfToken'];
    statusG1(requestG1('GET',$sharePath.'/ciphertext'),404,'recipient after revoke');
    statusG1(requestG1('GET',$listPath),404,'recipient list after revoke');
    $cookie=$ownerCookie;$token=$ownerToken;
    fwrite(STDOUT,"G2_HTTP_TWO_ACCOUNT_ACL_S3_PASS\n");

    DB::table('photo_records')->where('id',$photo)
       ->update(['expires_at'=>now()->subMinute()->getTimestampMs()]);
    statusG1(requestG1('GET','/photos/v1/'.$photo.'/receipt'),410,'expired receipt');
    statusG1(requestG1('GET','/photos/v1/'.$photo.'/objects/'.$master['assetId']),410,'expired GET');
    statusG1(requestG1('POST','/photos/v1/reserve',$reservation),410,'expired reservation replay');
    app(Lifecycle::class)->mark($photo);
    app(Lifecycle::class)->cleanup($photo);
    foreach($keys as $key)expectG1(!Storage::disk('photo-ciphertext')->exists($key),
       'Garage orphan after HTTP lifecycle');
    statusG1(requestG1('POST','/photos/v1/reserve',$reservation),410,'tombstone replay');
    fwrite(STDOUT,"G1_HTTP_LARAVEL_PG_GARAGE_PASS\n");
} finally {
    foreach($keys as $key){
      if(Storage::disk('photo-ciphertext')->exists($key))
         Storage::disk('photo-ciphertext')->delete($key);
    }
    // Delete dependent grants and assignments before the registered identities.
    foreach($grantIds as $grant){
      DB::table('photo_recipient_keys_v1')->where('grant_id',$grant)->delete();
      DB::table('assignment_grants_v1')->where('id',$grant)->delete();
    }
    foreach($assignmentIds as $id){
      DB::table('assignment_photo_bindings_v1')->where('assignment_id',$id)->delete();
      DB::table('assignment_history')->where('assignment_id',$id)->delete();
      DB::table('assignment_capture_policies_v1')->where('assignment_id',$id)->delete();
      DB::table('assignments')->where('id',$id)->delete();
    }
    foreach($ids as $id){
      DB::table('assignment_grant_operations_v1')->where('actor_account_id',$id)->delete();
      DB::table('contact_links_v1')->where('left_account_id',$id)
        ->orWhere('right_account_id',$id)->delete();
      DB::table('contact_blocks_v1')->where('account_id',$id)
        ->orWhere('blocked_account_id',$id)->delete();
    }
    if(is_string($guestCookie)&&is_file($guestCookie))unlink($guestCookie);
    // Drop only our isolated CI identities, never modify real user data.
    foreach($ids as $id){
      DB::table('photo_records')->where('account_id',$id)->delete();
      DB::table('identity_challenges')->where('account_id',$id)->delete();
      DB::table('identity_devices')->where('account_id',$id)->delete();
      DB::table('identity_accounts')->where('id',$id)->delete();
    }
    if(is_file($cookie))unlink($cookie);
}
