<?php
declare(strict_types=1);
namespace App\Assignments;

use App\Identity\Protocol as P;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class AssignmentContract {
    public const STATUS=['waiting','in_progress','submitted','needs_changes','completed'];
    public const MOVES=[
        'waiting'=>['in_progress'],
        'in_progress'=>['submitted'],
        'submitted'=>['needs_changes','completed'],
        'needs_changes'=>['in_progress'],
        'completed'=>[],
    ];
    public static function actor(Request $request):array {
        $aid=$request->session()->get('identity_account');
        $did=$request->session()->get('identity_device');
        $issued=$request->session()->get('identity_issued',0);
        abort_unless(is_string($aid)&&is_string($did)&&is_int($issued)&&$issued+86400>time(),401);
        $account=DB::table('identity_accounts')->where('id',$aid)->where('status','ready')->first();
        $device=DB::table('identity_devices')->where('id',$did)->where('account_id',$aid)->whereNull('revoked_at')->first();
        abort_unless($account && $device,401);
        return [$account,$device];
    }
    public static function origin(Request $r):void{
        if(in_array($r->method(),['GET','HEAD'],true))return;
        abort_unless(is_string($r->header('Origin'))&&hash_equals(rtrim(config('app.url'),'/'),$r->header('Origin')),403);
    }
    public static function json(array $payload,int $status=200):\Illuminate\Http\JsonResponse{
        return response()->json($payload,$status)->header('Cache-Control','no-store')
            ->header('X-Content-Type-Options','nosniff');
    }
    public static function validate(string $raw,string $signature,string $spki,string $pathId,string $account):array{
        abort_unless(strlen($raw)>50&&strlen($raw)<=48000,422);
        try{$c=json_decode($raw,true,32,JSON_THROW_ON_ERROR);}catch(\Throwable){abort(422);}
        abort_unless(is_array($c)&&!array_is_list($c),422);
        P::exact($c,['version','assignmentId','operationId','expectedRevision','revision',
            'action','status','policyRevision','mode','retentionDays','envelope']);
        abort_unless($c['version']===1&&is_string($c['assignmentId'])&&
            is_string($c['operationId'])&&$c['assignmentId']===$pathId,422);
        P::uuid($c['assignmentId']);P::uuid($c['operationId']);
        abort_unless(is_int($c['expectedRevision'])&&$c['expectedRevision']>=0&&
            $c['expectedRevision']<100000000&&$c['revision']===$c['expectedRevision']+1,422);
        abort_unless(in_array($c['action'],['create','edit','transition','delete'],true)&&
            in_array($c['status'],self::STATUS,true)&&is_int($c['policyRevision'])&&
            $c['policyRevision']>=1&&$c['policyRevision']<=100000000,422);
        abort_unless(is_int($c['mode'])&&in_array($c['mode'],[2,3],true)
            &&is_int($c['retentionDays'])&&$c['retentionDays']>=1&&$c['retentionDays']<=45,422);
        if($c['action']==='create')abort_unless($c['expectedRevision']===0&&
            $c['status']==='waiting'&&$c['policyRevision']===1,422);
        if($c['action']!=='create')abort_unless($c['expectedRevision']>0,422);
        $e=$c['envelope'];
        if($c['action']==='delete')abort_unless($e===null,422);
        else {
            abort_unless(is_array($e),422);
            P::exact($e,['version','accountId','assignmentId','operationId','revision',
                'iv','wrappedDEK','ciphertext']);
            abort_unless($e['version']===1&&$e['accountId']===$account&&
                $e['assignmentId']===$c['assignmentId']&&$e['operationId']===$c['operationId']&&
                $e['revision']===$c['revision'],422);
            abort_unless(is_array($e['wrappedDEK'])&&is_string($e['iv'])&&is_string($e['ciphertext']),422);
            P::exact($e['wrappedDEK'],['iv','ciphertext']);
            P::b64($e['iv'],12);P::b64($e['wrappedDEK']['iv'],12);
            P::b64($e['wrappedDEK']['ciphertext']);
            // 4000 Unicode instruction characters may exceed Protocol::b64's 8KiB
            // limit; this field is ciphertext only, strictly bounded/canonical.
            abort_unless(strlen($e['ciphertext'])>=22&&strlen($e['ciphertext'])<=32768
              &&preg_match('/^[A-Za-z0-9_-]+$/D',$e['ciphertext'])===1,422);
            $cipher=base64_decode(strtr($e['ciphertext'],'-_','+/').
              str_repeat('=',(4-strlen($e['ciphertext'])%4)%4),true);
            abort_unless($cipher!==false&&strlen($cipher)>=16&&strlen($cipher)<=24000
              &&P::encode($cipher)===$e['ciphertext'],422);
        }
        abort_unless(json_encode($c,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)===$raw,422);
        abort_unless(P::verify($spki,"photobunker.assignment.v1\n".$raw,$signature),401);
        return $c;
    }
    public static function dto(object $row):array{
        return [
            'assignmentId'=>$row->id,'status'=>$row->status,'revision'=>(int)$row->revision,
            'policyRevision'=>(int)$row->policy_revision,'mode'=>(int)$row->mode,
            'retentionDays'=>(int)$row->retention_days,
            'envelope'=>json_decode($row->cipher_envelope,true,32,JSON_THROW_ON_ERROR),
            'createdAt'=>\Carbon\Carbon::parse($row->created_at)->utc()->format('Y-m-d\TH:i:s.v\Z'),
            'updatedAt'=>\Carbon\Carbon::parse($row->updated_at)->utc()->format('Y-m-d\TH:i:s.v\Z'),
        ];
    }
}
