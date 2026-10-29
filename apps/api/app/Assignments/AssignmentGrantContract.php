<?php
declare(strict_types=1);
namespace App\Assignments;

use App\Identity\Protocol as P;

final class AssignmentGrantContract {
    public const ROLES=['curator','contributor','viewer'];
    public const KINDS=['invite','accept','decline','revoke','leave'];
    public static function validate(string $raw,string $signature,string $spki,string $opId):array {
        abort_unless(strlen($raw)>=90&&strlen($raw)<=12000,422);
        try{$c=json_decode($raw,true,24,JSON_THROW_ON_ERROR);}catch(\Throwable){abort(422);}
        abort_unless(is_array($c)&&!array_is_list($c),422);
        P::exact($c,['v','opId','kind','grantId','assignmentId','targetId',
            'role','expectedGeneration','expiresAt','codeHash','sealedKey']);
        abort_unless($c['v']===1&&is_string($c['opId'])&&$c['opId']===$opId
            &&is_string($c['grantId'])&&is_string($c['assignmentId']),422);
        P::uuid($c['opId']);P::uuid($c['grantId']);P::uuid($c['assignmentId']);
        abort_unless(in_array($c['kind'],self::KINDS,true),422);
        if($c['kind']==='invite'){
            abort_unless(is_string($c['targetId']),422);
            P::uuid($c['targetId']);
            abort_unless(in_array($c['role'],self::ROLES,true)&&$c['expectedGeneration']===0
                &&is_int($c['expiresAt'])&&$c['expiresAt']>0
                &&is_string($c['codeHash'])&&preg_match('/^[a-f0-9]{64}$/D',$c['codeHash'])===1,422);
            $e=$c['sealedKey'];
            abort_unless(is_array($e)&&!array_is_list($e),422);
            P::exact($e,['v','iv','ciphertext']);
            abort_unless(in_array($e['v'],[1,2],true)&&is_string($e['iv'])&&
                is_string($e['ciphertext']),422);
            P::b64($e['iv'],12);
            $plain=P::b64($e['ciphertext']);
            // V2 additionally pins the owner's account SPKI encrypted under the OOB code.
            abort_unless($e['v']===1?strlen($plain)===48:
                (strlen($plain)>=86&&strlen($plain)<=525),422);
        }else{
            abort_unless($c['targetId']===null&&$c['role']===null&&$c['expiresAt']===null
                &&$c['codeHash']===null&&$c['sealedKey']===null
                &&is_int($c['expectedGeneration'])&&$c['expectedGeneration']>=1
                &&$c['expectedGeneration']<100000000,422);
        }
        abort_unless(json_encode($c,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)===$raw,422);
        abort_unless(P::verify($spki,"photobunker.assignment-grant.v1\n".$raw,$signature),401);
        return $c;
    }
}
