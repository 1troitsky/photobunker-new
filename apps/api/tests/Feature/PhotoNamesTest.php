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
 public function test_name_code_is_not_the_photo_primary_key():void {
   $this->assertSame('AAAA',PhotoNames::letters(0));
   $this->assertSame('AAAB',PhotoNames::letters(1));
   $this->assertSame('ZZZZ',PhotoNames::letters(456975));
 }
}
