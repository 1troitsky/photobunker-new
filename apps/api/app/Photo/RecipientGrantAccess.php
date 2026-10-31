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
    public function __construct(private readonly RecipientGrantPolicy $policy){}
    public function resolved(string $grantId,string $photoId,string $assetId,string $recipient):array {
        P::uuid($grantId);P::uuid($photoId);P::uuid($assetId);
        $grant=DB::table('assignment_grants_v1')->where('id',$grantId)
            ->where('recipient_account_id',$recipient)->where('state','accepted')
            ->whereNull('revoked_at')->whereNotNull('accepted_at')->first();
        abort_unless($grant,404);
        $this->policy->assertActive($grant);
        $owner=$grant->owner_account_id;
        $photo=DB::table('photo_records')->where('id',$photoId)
            ->where('account_id',$owner)->where('state','active')
            ->where('expires_at','>',PhotoSync::nowMs())->first();
        abort_unless($photo,404);
        $this->policy->assertPhotoBinding($grant,$photoId,(int)$photo->expires_at);
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
        abort_unless(DB::table('identity_devices')->where('id',$envelope->publisher_device_id)
            ->where('account_id',$owner)->where('signing_spki',$envelope->signer_spki)
            ->whereNull('revoked_at')->exists(),404);
        $ownerRoot=DB::table('identity_accounts')->where('id',$owner)
            ->where('status','ready')->value('account_spki');
        abort_unless(is_string($ownerRoot)&&P::verify($ownerRoot,
            "photobunker.photo-recipient-root.v1\n".$envelope->publisher_device_id.
            "\n".$envelope->signer_spki."\n".$envelope->contract_json,
            $envelope->owner_root_signature),404);
        abort_unless(P::verify($envelope->signer_spki,
            "photobunker.photo-recipient.v1\n".$envelope->contract_json,
            $envelope->signature),404);
        return [$grant,$photo,$asset,$envelope,$manifest];
    }
}
