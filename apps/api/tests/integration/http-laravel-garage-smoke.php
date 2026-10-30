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

$ids=[];$keys=[];
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

    $photo=(string)Str::uuid();$op=(string)Str::uuid();
    $expires=now()->addDay()->getTimestampMs();
    [$master,$masterBytes]=assetG1($account,$photo,$expires,'master',4096);
    [$meta,$metaBytes]=assetG1($account,$photo,$expires,'metadata',128);
    $assets=[$master,$meta];
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
    $pairs=[[$master,$masterBytes],[$meta,$metaBytes]];
    foreach($pairs as [$asset,$bytes]){
        $path='/photos/v1/'.$photo.'/objects/'.$asset['assetId'];
        statusG1(requestG1('PUT',$path,$bytes),200,'ciphertext PUT');
        statusG1(requestG1('PUT',$path,$bytes),200,'lost PUT ACK retry');
    }
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
    // Drop only our isolated CI identities, never modify real user data.
    foreach($ids as $id){
      DB::table('photo_records')->where('account_id',$id)->delete();
      DB::table('identity_challenges')->where('account_id',$id)->delete();
      DB::table('identity_devices')->where('account_id',$id)->delete();
      DB::table('identity_accounts')->where('id',$id)->delete();
    }
    if(is_file($cookie))unlink($cookie);
}
