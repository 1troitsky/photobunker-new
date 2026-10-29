<?php

namespace App\Http\Controllers;

use App\Identity\AccountLifecycle;
use App\Identity\Accounts;
use App\Prototype\Retention;
use App\Workspace\Workspace;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;

/**
 * Identity-only collections: the opaque URL is a locator, never a grant.
 * Individual photo reads still use their original Workspace/E2EE ACL.
 */
final class PhotoBrowserController extends Controller
{
    public function __construct(private readonly Accounts $accounts, private readonly Workspace $workspace) {}

    private function actor(Request $request): string
    {
        return $this->accounts->current($request)->id;
    }

    private function permitted(string $actor, string $assignmentId, bool $creator = false): object
    {
        $row = $this->workspace->record($actor, $assignmentId, 'task');
        if ($row->owner_id !== $actor) {
            $member = $this->workspace->member($actor, $row);
            // Invitation expiry is not accepted-membership expiry.
            // Reuse the canonical Workspace state=accepted membership contract.
            abort_unless($member && ! $this->accounts->blocked($actor, $row->owner_id), 403);
            if ($creator) {
                abort_unless($member->role === 'curator', 403);
            }
        }

        return $row;
    }

    private function visible(object $row, string $actor): array
    {
        abort_if($row->revoked_at || $row->expires_at <= Retention::milliseconds(), 410);
        $creator = DB::table('identity_accounts')->find($row->owner_id);
        abort_if(! $creator || AccountLifecycle::unavailable($creator), 410);
        abort_if($this->accounts->blocked($actor, $row->owner_id), 403);
        $ids = json_decode(Crypt::decryptString($row->assignments), true, flags: JSON_THROW_ON_ERROR);
        abort_unless(is_array($ids) && count($ids) > 0 && count($ids) <= 20, 404);
        $assignments = [];
        foreach ($ids as $id) {
            // All-or-nothing: never reveal a partial collection on a revoked membership.
            $record = $this->permitted($actor, $id);
            $assignments[] = ['id' => $record->id, 'name' => $this->workspace->payload($record)['name']];
        }

        return ['id' => $row->id, 'assignments' => $assignments,
            'expiresAt' => (int) $row->expires_at, 'canRevoke' => $row->owner_id === $actor];
    }

    public function save(Request $request, string $id)
    {
        $actor = $this->actor($request);
        $data = $request->validate([
            'assignmentIds' => 'required|array|min:1|max:20',
            'assignmentIds.*' => 'required|uuid|distinct',
            'expiresAt' => 'required|integer|min:1|max:9007199254740991',
        ]);
        $now = Retention::milliseconds();
        abort_unless($data['expiresAt'] > $now && $data['expiresAt'] <= $now + 30 * 86400000, 422);
        // Validate every assignment before writing any collection metadata.
        foreach ($data['assignmentIds'] as $assignmentId) {
            $this->permitted($actor, $assignmentId, true);
        }
        DB::table('workspace_photo_browsers')->insertOrIgnore([
            'id' => $id, 'owner_id' => $actor,
            'assignments' => Crypt::encryptString(json_encode($data['assignmentIds'], JSON_THROW_ON_ERROR)),
            'expires_at' => $data['expiresAt'],
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $row = DB::table('workspace_photo_browsers')->find($id);
        abort_unless($row && $row->owner_id === $actor, 409);
        abort_if($row->revoked_at || $row->expires_at <= $now, 410);
        // Retried writes cannot replace assignment scope or extend TTL.
        $stored = json_decode(Crypt::decryptString($row->assignments), true, flags: JSON_THROW_ON_ERROR);
        abort_unless($stored === $data['assignmentIds'] && (int) $row->expires_at === $data['expiresAt'], 409);

        return response()->json($this->visible($row, $actor));
    }

    public function show(Request $request, string $id)
    {
        $actor = $this->actor($request);
        $row = DB::table('workspace_photo_browsers')->find($id);
        abort_unless($row, 404);

        return response()->json($this->visible($row, $actor));
    }

    public function revoke(Request $request, string $id)
    {
        $actor = $this->actor($request);
        $row = DB::table('workspace_photo_browsers')->find($id);
        abort_unless($row && $row->owner_id === $actor, 404);
        DB::table('workspace_photo_browsers')->where('id', $id)->whereNull('revoked_at')
            ->update(['revoked_at' => now(), 'updated_at' => now()]);

        return response()->json(['revoked' => true]);
    }
}
