<?php
declare(strict_types=1);

namespace App\Collaboration;

use App\Assignments\AssignmentContract as A;
use App\Identity\Protocol as P;
use Illuminate\Http\Request;

final class CollaborationContract {
    public const ROLES=['owner','curator','contributor','viewer'];
    public const MUTATIONS=['contact_request','contact_accept','contact_remove','block','unblock',
        'team_create','team_edit','team_delete','invite_create','invite_accept',
        'invite_decline','invite_revoke','member_role','member_revoke','team_leave'];
    public static function actor(Request $r): array { return A::actor($r); }
    public static function origin(Request $r): void { A::origin($r); }
    public static function json(array $v,int $status=200):\Illuminate\Http\JsonResponse {
        return A::json($v,$status);
    }
    public static function input(string $raw,string $signature,string $spki,string $pathId):array {
        abort_unless(strlen($raw)>=100 && strlen($raw)<=80000,422);
        try { $c=json_decode($raw,true,32,JSON_THROW_ON_ERROR); }
        catch(\Throwable) { abort(422); }
        abort_unless(is_array($c)&&!array_is_list($c),422);
        P::exact($c,['v','opId','kind','teamId','targetId','role',
            'expectedRevision','profile','inviteId','codeHash','sealedKey']);
        abort_unless($c['v']===1 && is_string($c['opId']) && $c['opId']===$pathId,422);
        P::uuid($c['opId']);
        abort_unless(is_string($c['kind']) && in_array($c['kind'],self::MUTATIONS,true),422);
        foreach(['teamId','targetId','inviteId'] as $key) {
            abort_unless($c[$key]===null || is_string($c[$key]),422);
            if($c[$key]!==null)P::uuid($c[$key]);
        }
        abort_unless($c['role']===null||in_array($c['role'],self::ROLES,true),422);
        abort_unless($c['expectedRevision']===null ||
            (is_int($c['expectedRevision'])&&$c['expectedRevision']>=0&&$c['expectedRevision']<100000000),422);
        if($c['profile']!==null)self::profile($c['profile']);
        abort_unless($c['codeHash']===null || (is_string($c['codeHash']) &&
            preg_match('/^[a-f0-9]{64}$/D',$c['codeHash'])===1),422);
        if($c['sealedKey']!==null)self::sealed($c['sealedKey']);
        $requires=match($c['kind']) {
            'contact_request','contact_accept','contact_remove','block','unblock'=>['targetId'],
            'team_create'=>['teamId','profile'],
            'team_edit'=>['teamId','profile','expectedRevision'],
            'team_delete','team_leave'=>['teamId'],
            'invite_create'=>['teamId','targetId','role','inviteId','codeHash','sealedKey'],
            'invite_accept','invite_decline','invite_revoke'=>['inviteId'],
            'member_role'=>['teamId','targetId','role'],
            'member_revoke'=>['teamId','targetId'],
            default=>[],
        };
        foreach($requires as $k)abort_unless($c[$k]!==null,422);
        if($c['kind']==='team_create')abort_unless($c['expectedRevision']===0,422);
        if(in_array($c['kind'],['invite_create','member_role'],true))
            abort_unless($c['role']!=='owner',422);
        abort_unless(json_encode($c,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)===$raw,422);
        abort_unless(P::verify($spki,"photobunker.collaboration.v1\n".$raw,$signature),401);
        return $c;
    }
    public static function profile(mixed $profile):void {
        abort_unless(is_array($profile),422);
        P::exact($profile,['v','iv','ciphertext']);
        abort_unless($profile['v']===1&&is_string($profile['iv'])&&is_string($profile['ciphertext'])
            &&strlen($profile['ciphertext'])<=45000,422);
        P::b64($profile['iv'],12);
        self::cipher($profile['ciphertext'],32000);
    }
    public static function sealed(mixed $sealed):void {
        abort_unless(is_array($sealed),422);
        P::exact($sealed,['v','iv','ciphertext']);
        abort_unless($sealed['v']===1&&is_string($sealed['iv'])&&is_string($sealed['ciphertext']),422);
        P::b64($sealed['iv'],12);self::cipher($sealed['ciphertext'],128);
    }
    private static function cipher(string $wire,int $max):void {
        abort_unless(strlen($wire)>=22&&strlen($wire)<=$max*2
            &&preg_match('/^[A-Za-z0-9_-]+$/D',$wire)===1,422);
        $bytes=base64_decode(strtr($wire,'-_','+/').str_repeat('=',(4-strlen($wire)%4)%4),true);
        abort_unless($bytes!==false&&strlen($bytes)>=16&&strlen($bytes)<=$max
            &&P::encode($bytes)===$wire,422);
    }
}
