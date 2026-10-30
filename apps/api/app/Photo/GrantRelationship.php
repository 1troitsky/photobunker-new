<?php
declare(strict_types=1);
namespace App\Photo;

use Illuminate\Support\Facades\DB;

/**
 * One fail-closed eligibility boundary for recipient grants.
 *
 * This check is necessary, never sufficient for a read: every photo/asset
 * still passes expiry, ownership, generation, signed provenance and DEK checks.
 */
final class GrantRelationship
{
    public function assertActive(string $owner,string $recipient):void
    {
        abort_if($owner===$recipient,404);
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
            ->where('left_account_id',$left)
            ->where('right_account_id',$right)
            ->where('state','accepted')->exists(),404);
    }
}
