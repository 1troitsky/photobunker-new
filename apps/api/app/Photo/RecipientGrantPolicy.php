<?php
declare(strict_types=1);
namespace App\Photo;

use Illuminate\Support\Facades\DB;

/**
 * Authoritative current grant policy shared by publication, recipient lists,
 * manifest and ciphertext. A signed invitation is NOT a photo permission.
 * All checks fail closed; none can be satisfied by Team membership alone.
 */
final class RecipientGrantPolicy
{
    public function assertActive(object $grant):void
    {
        abort_unless($grant->state==='accepted'&&$grant->revoked_at===null&&
            $grant->accepted_at!==null&&
            in_array($grant->role,['viewer','curator','contributor'],true),404);
        $owner=$grant->owner_account_id;
        $recipient=$grant->recipient_account_id;
        abort_unless($owner!==$recipient&&
            DB::table('identity_accounts')->where('id',$owner)
                ->where('status','ready')->exists(),404);

        // Blocks in either direction revoke both publishing and reading.
        $blocked=DB::table('contact_blocks_v1')
            ->where(fn($q)=>$q->where('account_id',$owner)
                ->where('blocked_account_id',$recipient))
            ->orWhere(fn($q)=>$q->where('account_id',$recipient)
                ->where('blocked_account_id',$owner))
            ->exists();
        abort_if($blocked,404);
        [$left,$right]=strcmp($owner,$recipient)<0
            ?[$owner,$recipient]:[$recipient,$owner];
        abort_unless(DB::table('contact_links_v1')
            ->where('left_account_id',$left)->where('right_account_id',$right)
            ->where('state','accepted')->exists(),404);

        $assignment=DB::table('assignments')->where('id',$grant->assignment_id)
            ->where('account_id',$owner)->first();
        abort_unless($assignment&&$assignment->status!=='completed',404);
    }

    public function assertPhotoBinding(object $grant,string $photoId,int $expiresAt):void
    {
        $binding=DB::table('assignment_photo_bindings_v1')
            ->where('photo_id',$photoId)
            ->where('assignment_id',$grant->assignment_id)
            ->where('author_account_id',$grant->owner_account_id)
            ->where('expires_at','>',PhotoSync::nowMs())->first();
        abort_unless($binding&&(int)$binding->expires_at===$expiresAt,404);
    }
}
