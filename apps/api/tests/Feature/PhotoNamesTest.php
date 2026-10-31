<?php
declare(strict_types=1);
namespace Tests\Feature;
use App\Photo\PhotoNames;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;
final class PhotoNamesTest extends TestCase {
 use RefreshDatabase;
 public function test_nonoverlapping_ranges_replay_rollover_and_no_reuse():void {
   $a=(string)Str::uuid();$d=(string)Str::uuid();
   $names=app(PhotoNames::class);
   $request=(string)Str::uuid();
   $first=$names->reserve($a,$d,$request,64);
   $again=$names->reserve($a,$d,$request,64);
   $this->assertSame($first,$again);
   $second=$names->reserve($a,$d,(string)Str::uuid(),64);
   $this->assertSame(1,$first['first']);$this->assertSame(64,$first['last']);
   $this->assertSame(65,$second['first']);$this->assertSame($first['prefix'],$second['prefix']);
   DB::table('photo_name_prefixes')->where('prefix',$first['prefix'])->update(['next_number'=>9999]);
   $last=$names->reserve($a,$d,(string)Str::uuid(),64);
   $this->assertSame(9999,$last['first']);$this->assertSame(9999,$last['last']);
   $roll=$names->reserve($a,$d,(string)Str::uuid(),1);
   $this->assertNotSame($last['prefix'],$roll['prefix']);
   $this->assertSame('AAAB',$roll['prefix']);
 }
 public function test_assignment_ranges_are_isolated_and_replay_is_scope_bound():void {
   $account=(string)Str::uuid();$device=(string)Str::uuid();
   $other=(string)Str::uuid();$one=(string)Str::uuid();$two=(string)Str::uuid();
   DB::table('identity_accounts')->insert(['id'=>$account,'operation_id'=>(string)Str::uuid(),
     'prepare_hash'=>str_repeat('a',64),'status'=>'ready','reserved_until'=>now()->addDay(),
     'created_at'=>now(),'updated_at'=>now()]);
   DB::table('identity_accounts')->insert(['id'=>$other,'operation_id'=>(string)Str::uuid(),
     'prepare_hash'=>str_repeat('b',64),'status'=>'ready','reserved_until'=>now()->addDay(),
     'created_at'=>now(),'updated_at'=>now()]);
   foreach([$one,$two] as $id)DB::table('assignments')->insert([
     'id'=>$id,'account_id'=>$account,'status'=>'in_progress','revision'=>1,
     'policy_revision'=>1,'mode'=>3,'retention_days'=>7,
     'cipher_envelope'=>'{}','last_operation_id'=>(string)Str::uuid(),
     'created_at'=>now(),'updated_at'=>now()]);
   $names=app(PhotoNames::class);
   $first=$names->reserve($account,$device,(string)Str::uuid(),32,$one);
   $second=$names->reserve($account,$device,(string)Str::uuid(),32,$two);
   $personal=$names->reserve($account,$device,(string)Str::uuid(),32);
   $this->assertNotSame($first['prefix'],$second['prefix']);
   $this->assertNotSame($first['prefix'],$personal['prefix']);
   $this->assertSame($one,$first['assignmentId']);
   $this->assertNull($personal['assignmentId']);
   $request=(string)Str::uuid();
   $scoped=$names->reserve($account,$device,$request,4,$one);
   $this->assertSame($scoped,$names->reserve($account,$device,$request,4,$one));
   try{$names->reserve($account,$device,$request,4,$two);$this->fail('Expected scoped replay conflict');}
   catch(\Symfony\Component\HttpKernel\Exception\HttpException $e){$this->assertSame(409,$e->getStatusCode());}
   try{$names->reserve($other,$device,(string)Str::uuid(),1,$one);$this->fail('Expected inaccessible assignment');}
   catch(\Symfony\Component\HttpKernel\Exception\HttpException $e){$this->assertSame(404,$e->getStatusCode());}
 }
 public function test_name_code_is_not_the_photo_primary_key():void {
   $this->assertSame('AAAA',PhotoNames::letters(0));
   $this->assertSame('AAAB',PhotoNames::letters(1));
   $this->assertSame('ZZZZ',PhotoNames::letters(456975));
 }
}
