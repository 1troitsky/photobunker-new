<?php
declare(strict_types=1);
namespace App\Http\Controllers;
use App\Photo\PhotoSync;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
final class GalleryController extends Controller{
  public function __construct(private readonly PhotoSync $sync){}
  public function index(Request $r){
    [$account]=$this->sync->actor($r);
    $cursor=$r->query('after','');
    abort_unless(is_string($cursor)&&($cursor===''||preg_match('/^[a-f0-9-]{36}$/D',$cursor)),422);
    $limit=$r->query('limit','30');
    abort_unless(is_string($limit)&&ctype_digit($limit)&&intval($limit)>=1&&intval($limit)<=50,422);
    $query=DB::table('photo_records as p')
      ->leftJoin('photo_name_codes as n','n.photo_id','=','p.id')
      ->where('p.account_id',$account->id)->where('p.state','active')
      ->where('p.expires_at','>',PhotoSync::nowMs())
      ->select('p.id','p.expires_at','p.metadata_asset_id','p.metadata_revision','p.edit_revision','p.edit_asset_id','n.code')
      ->orderBy('p.id')->limit(intval($limit)+1);
    if($cursor!=='')$query->where('p.id','>',$cursor);
    $rows=$query->get();
    $hasMore=$rows->count()>intval($limit);
    $items=$rows->take(intval($limit))->map(fn($p)=>[
      'photoId'=>$p->id,'expiresAt'=>(int)$p->expires_at,
      'metadataAssetId'=>$p->metadata_asset_id,'metadataRevision'=>(int)$p->metadata_revision,
      'editRevision'=>(int)$p->edit_revision,'editAssetId'=>$p->edit_asset_id,
      'nameId'=>$p->code,
    ])->all();
    return $this->sync->json(['photos'=>$items,'nextCursor'=>$hasMore?end($items)['photoId']:null]);
  }
}
