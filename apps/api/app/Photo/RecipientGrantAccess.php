<?php
declare(strict_types=1);
namespace App\Photo;

use App\Identity\Protocol as P;
use Illuminate\Support\Facades\DB;

/**
 * Read-only recipient authorization gate. Separate from owner PhotoSync routes.
 * A Team membership, invitation alone or client-side UI state is NEVER permission.
 */
final class RecipientGrantAccess {
    public function resolved(string $grantId,string $photoId,string $assetId,string $recipient):array {
        P::uuid($grantId);P::uuid($photoId);P::uuid($assetId);
        $grant=DB::table('assignment_grants_v1')->where('id',$grantId)
            ->where('recipient_account_id',$recipient)->where('state','accepted')
            ->whereNull('revoked_at')->whereNotNull('accepted_at')->first();
        abort_unless($grant&&in_array($grant->role,['viewer','curator','contributor'],true),404);
        $owner=$grant->owner_account_id;
        abort_unless(DB::table('identity_accounts')->where('id',$owner)
            ->where('status','ready')->exists(),404);
        $blocked=DB::table('contact_blocks_v1')
            ->where(fn($q)=>$q->where('account_id',$owner)->where('blocked_account_id',$recipient))
            ->orWhere(fn($q)=>$q->where('account_id',$recipient)->where('blocked_account_id',$owner))
            ->exists();
        abort_if($blocked,404);
        [$left,$right]=strcmp($owner,$recipient)<0?[$owner,$recipient]:[$recipient,$owner];
        abort_unless(DB::table('contact_links_v1')->where('left_account_id',$left)
            ->where('right_account_id',$right)->where('state','accepted')->exists(),404);
        $assignment=DB::table('assignments')->where('id',$grant->assignment_id)
            ->where('account_id',$owner)->first();
        abort_unless($assignment&&$assignment->status!=='completed',404);
        $photo=DB::table('photo_records')->where('id',$photoId)
            ->where('account_id',$owner)->where('state','active')
            ->where('expires_at','>',PhotoSync::nowMs())->first();
        abort_unless($photo,404);
        $capture=DB::table('assignment_photo_bindings_v1')->where('photo_id',$photoId)
            ->where('assignment_id',$grant->assignment_id)
            ->where('author_account_id',$owner)
            ->where('expires_at','>',PhotoSync::nowMs())->first();
        abort_unless($capture&&(int)$capture->expires_at===(int)$photo->expires_at,404);
        $asset=DB::table('photo_objects')->where('id',$assetId)->where('photo_id',$photoId)
            ->where('kind','thumbnail')->where('state','active')->first();
        abort_unless($asset,404);
        $envelope=DB::table('photo_recipient_keys_v1')->where('grant_id',$grantId)
            ->where('photo_id',$photoId)->where('asset_id',$assetId)
            ->where('generation',$grant->generation)->first();
        abort_unless($envelope&&$envelope->contract_hash===hash('sha256',$envelope->contract_json),404);
        abort_unless($envelope->owner_account_id===$owner&&
            $envelope->recipient_account_id===$recipient,404);
        $contract=json_decode($envelope->contract_json,true,32,JSON_THROW_ON_ERROR);
        $manifest=json_decode($asset->manifest_json,true,32,JSON_THROW_ON_ERROR);
        abort_unless($contract['kind']==='thumbnail'&&$contract['assetId']===$asset->id&&
            $contract['photoId']===$photoId&&$contract['assignmentId']===$grant->assignment_id&&
            $contract['generation']===(int)$grant->generation&&
            $contract['assetRevision']===(int)$asset->revision&&
            $contract['expiresAt']===(int)$photo->expires_at&&
            $contract['cipherDigest']===$manifest['cipherDigest']&&
            $manifest['accountId']===$owner&&$manifest['photoId']===$photoId&&
            $manifest['assetId']===$assetId&&$manifest['kind']==='thumbnail'&&
            $manifest['expiresAt']===(int)$photo->expires_at,404);
        // The signer must still be an enrolled, non-revoked device of the
        // original photo owner, not just an arbitrary SPKI returned by storage.
        abort_unless(DB::table('identity_devices')->where('account_id',$owner)
            ->where('signing_spki',$envelope->signer_spki)
            ->whereNull('revoked_at')->exists(),404);
        abort_unless(P::verify($envelope->signer_spki,
            "photobunker.photo-recipient.v1\n".$envelope->contract_json,
            $envelope->signature),404);
        return [$grant,$photo,$asset,$envelope,$manifest];
    }
}
