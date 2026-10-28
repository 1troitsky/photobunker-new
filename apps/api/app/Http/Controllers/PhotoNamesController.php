<?php
declare(strict_types=1);
namespace App\Http\Controllers;
use App\Identity\Protocol as P;
use App\Photo\PhotoNames;
use App\Photo\PhotoSync;
use Illuminate\Http\Request;
final class PhotoNamesController extends Controller {
  public function __construct(private readonly PhotoSync $sync,private readonly PhotoNames $names){}
  public function reserve(Request $r){
    $this->sync->origin($r);[$a,$d]=$this->sync->actor($r);
    $x=P::exact($r->json()->all(),['requestId','count']);
    P::uuid($x['requestId']);abort_unless(is_int($x['count'])&&$x['count']>=1&&$x['count']<=64,422);
    return $this->sync->json($this->names->reserve($a->id,$d->id,$x['requestId'],$x['count']));
  }
  public function claim(Request $r){
    $this->sync->origin($r);[$a,$d]=$this->sync->actor($r);
    $x=P::exact($r->json()->all(),['photoId','leaseId','number']);
    P::uuid($x['photoId']);
    abort_unless($x['leaseId']===null||is_string($x['leaseId']),422);
    if($x['leaseId']!==null)P::uuid($x['leaseId']);
    abort_unless($x['number']===null||is_int($x['number']),422);
    $code=$this->names->claim($a->id,$d->id,$x['photoId'],$x['leaseId'],$x['number']);
    return $this->sync->json(['photoId'=>$x['photoId'],'nameId'=>$code]);
  }
}