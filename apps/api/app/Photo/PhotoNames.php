<?php
declare(strict_types=1);
namespace App\Photo;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
final class PhotoNames {
  public static function letters(int $index):string {
    abort_unless($index>=0&&$index<456976,507);
    $s='';for($i=0;$i<4;$i++){$s=chr(65+$index%26).$s;$index=intdiv($index,26);}
    return $s;
  }
  private function allocate(string $account,string $device,string $request,int $count):array {
    $seq=DB::table('photo_name_allocator')->where('id',1)->lockForUpdate()->first();
    $prior=DB::table('photo_name_leases')->where('account_id',$account)
      ->where('device_id',$device)->where('request_id',$request)->first();
    if($prior)return $this->dto($prior);
    $prefix=DB::table('photo_name_prefixes')->where('account_id',$account)
      ->where('next_number','<=',9999)->orderByDesc('sequence')->lockForUpdate()->first();
    if(!$prefix){
      $index=(int)$seq->next_prefix;
      $letters=self::letters($index);
      DB::table('photo_name_allocator')->where('id',1)->update(['next_prefix'=>$index+1]);
      DB::table('photo_name_prefixes')->insert(['prefix'=>$letters,'account_id'=>$account,'sequence'=>$index,'next_number'=>1]);
      $prefix=DB::table('photo_name_prefixes')->where('prefix',$letters)->first();
    }
    $first=(int)$prefix->next_number;$last=min(9999,$first+$count-1);
    DB::table('photo_name_prefixes')->where('prefix',$prefix->prefix)->update(['next_number'=>$last+1]);
    $id=(string)Str::uuid();
    DB::table('photo_name_leases')->insert(['id'=>$id,'account_id'=>$account,'device_id'=>$device,
      'request_id'=>$request,'prefix'=>$prefix->prefix,'first_number'=>$first,'last_number'=>$last,'created_at'=>now()]);
    return ['id'=>$id,'prefix'=>$prefix->prefix,'first'=>$first,'last'=>$last];
  }
  private function dto(object $row):array {return ['id'=>$row->id,'prefix'=>$row->prefix,'first'=>(int)$row->first_number,'last'=>(int)$row->last_number];}
  public function reserve(string $account,string $device,string $request,int $count):array {
    return DB::transaction(fn()=> $this->allocate($account,$device,$request,$count),3);
  }
  public function claim(string $account,string $device,string $photo,?string $leaseId,?int $number):string {
    return DB::transaction(function()use($account,$device,$photo,$leaseId,$number){
      // Global allocator lock serializes automatic allocation and replay.
      DB::table('photo_name_allocator')->where('id',1)->lockForUpdate()->first();
      $row=DB::table('photo_records')->where('id',$photo)->where('account_id',$account)->first();
      if(!$row){abort_if(DB::table('photo_tombstones')->where('photo_id',$photo)->where('account_id',$account)->exists(),410);abort(404);}
      abort_if($row->state==='deleting'||$row->expires_at<=PhotoSync::nowMs(),410);
      $existing=DB::table('photo_name_codes')->where('photo_id',$photo)->first();
      if($existing){abort_unless($existing->account_id===$account,403);return $existing->code;}
      if($leaseId!==null){
        $lease=DB::table('photo_name_leases')->where('id',$leaseId)->first();
        abort_unless($lease&&$lease->account_id===$account&&$lease->device_id===$device,403);
        abort_unless($number!==null&&$number>=$lease->first_number&&$number<=$lease->last_number,422);
        $code=$lease->prefix.sprintf('%04d',$number);
      }else{
        abort_unless($number===null,422);
        $range=$this->allocate($account,$device,$photo,1);
        $leaseId=$range['id'];$code=$range['prefix'].sprintf('%04d',$range['first']);
      }
      abort_if(DB::table('photo_name_codes')->where('code',$code)->exists(),409);
      DB::table('photo_name_codes')->insert(['photo_id'=>$photo,'code'=>$code,'account_id'=>$account,
        'device_id'=>$device,'lease_id'=>$leaseId,'created_at'=>now()]);
      return $code;
    },3);
  }
}