<?php

namespace App\Encrypted;

use App\Identity\Accounts;
use App\Prototype\Retention;
use App\Workspace\Workspace;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class Keys
{
    public function document(string $account): array
    {
        $row = DB::table('photo_keys')->where('account_id', $account)->first();
        abort_unless($row, 409);

        return Protocol::decode($row->document);
    }

    public function enabled(string $account): bool
    {
        return DB::table('photo_keys')->where('account_id', $account)->exists();
    }

    public function read(Request $request): object
    {
        $identity = $request->attributes->get('identity');
        abort_unless($identity, 401);
        $hash = hash('sha256', (string) $request->header('X-PhotoBunker-Read'));
        $session = DB::table('photo_read_sessions')->where('token_hash', $hash)->where('account_id', $identity->account_id)->where('device_id', $identity->device_id)->where('session_hash', hash('sha256', $request->cookie('pb_identity', '')))->where('expires_at', '>', now())->first();
        abort_unless($session && $session->key_revision === DB::table('photo_keys')->where('account_id', $identity->account_id)->value('revision'), 423);

        return $session;
    }

    public function certificate(Request $request, array $certificate): array
    {
        $identity = $request->attributes->get('identity');
        abort_unless($identity, 401);
        $stored = DB::table('photo_devices')->where('device_id', $identity->device_id)->where('account_id', $identity->account_id)->where('expires_at', '>', now())->first();
        abort_unless($stored && hash_equals($stored->certificate, Protocol::canonical($certificate)), 403);
        $key = $this->document($identity->account_id);
        abort_unless($certificate['statement']['authorityKey'] === $key['record']['authorityKey'], 403);

        return $certificate['statement'];
    }

    public function context(string $actor, ?string $assignment): array
    {
        return DB::transaction(function () use ($actor, $assignment): array {
            $workspace = app(Workspace::class);
            $vault = $assignment ? DB::table('workspace_vaults')->where('assignment_id', $assignment)->first() : $workspace->personal($actor);
            abort_unless($vault, 404);
            // Build and commit the public epoch from one locked membership snapshot.
            // A delayed GET must not overwrite a newer policy with a stale draft.
            DB::table('identity_accounts')->where('id', $vault->owner_id)->lockForUpdate()->firstOrFail();
            DB::table('workspace_vaults')->where('id', $vault->id)->lockForUpdate()->firstOrFail();
            if ($assignment && DB::transactionLevel() > 0) {
                DB::table('workspace_records')->where('id', $assignment)->lockForUpdate()->first();
            }
            $task = $assignment ? $workspace->record($actor, $assignment, 'task') : null;
            $config = $task ? $workspace->payload($task) : null;
            if ($task) {
                abort_if(app(Accounts::class)->blocked($actor, $task->owner_id), 404);
            }
            $members = [['accountId' => $vault->owner_id, 'role' => 'owner', 'scope' => 'all']];
            if ($task) {
                foreach (DB::table('workspace_members')->where('record_id', $assignment)->where('state', 'accepted')->get() as $member) {
                    if (app(Accounts::class)->blocked($member->account_id, $vault->owner_id)) {
                        continue;
                    }
                    $scope = $member->photo_scope === 'default' ? ($member->role === 'contributor' ? ($config['rules']['galleryAllowed'] ? ($config['rules']['thumbnailsOnly'] ? 'thumbnails' : 'all') : 'none') : 'all') : $member->photo_scope;
                    $members[] = ['accountId' => $member->account_id, 'role' => $member->role, 'scope' => $scope];
                }
            }
            usort($members, fn ($a, $b) => strcmp($a['accountId'], $b['accountId']));
            foreach ($members as &$member) {
                $account = DB::table('identity_accounts')->find($member['accountId']);
                $member['publicId'] = $account->public_id;
                $keyQuery = DB::table('photo_keys')->where('account_id', $member['accountId']);
                if (DB::transactionLevel() > 0) {
                    $keyQuery->sharedLock();
                }$row = $keyQuery->first();
                $member['key'] = $row ? Protocol::decode($row->document) : null;
            }
            unset($member);
            $rules = $config['rules'] ?? ['changesAllowed' => true, 'deletionAllowed' => true, 'sharingAllowed' => true, 'participantsOnly' => false];
            $retention = $config['preset']['options']['retention'] ?? 1209600;
            if ($retention === 'custom') {
                $retention = $config['preset']['options']['customHours'] * 3600;
            }
            // The local cloud boundary remains 1 hour–14 days. Zero means local-only,
            // never an implicit unlimited encrypted cloud promise.
            $retention = $retention ? min(1209600, (int) $retention) : 0;
            $base = ['version' => 1, 'vaultId' => $vault->id, 'ownerId' => $vault->owner_id, 'assignmentId' => $assignment, 'taskRevision' => $task ? (int) $task->revision : 0, 'members' => $members,
                'changesAllowed' => $rules['changesAllowed'], 'deletionAllowed' => $rules['deletionAllowed'], 'sharingAllowed' => $rules['sharingAllowed'], 'participantsOnly' => $rules['participantsOnly'], 'retentionSeconds' => $retention, 'startsAt' => $config['startsAt'] ?? null, 'finishesAt' => $config['finishesAt'] ?? null, 'completed' => $config['completed'] ?? false];
            $membershipHash = Protocol::digest($base);

            return DB::transaction(function () use ($vault, $base, $membershipHash): array {
                $current = DB::table('workspace_vaults')->where('id', $vault->id)->lockForUpdate()->firstOrFail();
                $context = $current->crypto_context ? Protocol::decode($current->crypto_context) : null;
                if (! $context || $context['membershipHash'] !== $membershipHash || $context['validUntil'] <= Retention::milliseconds()) {
                    $context = [...$base, 'membershipHash' => $membershipHash, 'epoch' => $current->crypto_epoch + 1, 'validUntil' => Retention::milliseconds() + 1209600000];
                    DB::table('workspace_vaults')->where('id', $vault->id)->update(['crypto_epoch' => $context['epoch'], 'crypto_context' => Protocol::canonical($context), 'capture_plan' => null]);
                }

                return ['draft' => $context, 'plan' => $current->capture_plan && $context['epoch'] === $current->crypto_epoch ? Protocol::decode($current->capture_plan) : null,
                    'missing' => array_values(array_map(fn ($m) => $m['publicId'], array_filter($context['members'], fn ($m) => $m['key'] === null)))];
            });
        });
    }

    public function plan(string $actor, ?string $assignment, array $plan): array
    {
        $context = $this->context($actor, $assignment);
        abort_unless($context['missing'] === [] && Protocol::canonical($plan['statement'] ?? []) === Protocol::canonical($context['draft']), 409);
        $ownerKey = $this->document($context['draft']['ownerId']);
        abort_unless(Protocol::canonical($plan['authority'] ?? []) === Protocol::canonical($ownerKey), 409);
        Protocol::ed('capture-plan', $plan['statement'], $plan['signature'] ?? '', $ownerKey['record']['authorityKey']);

        return $context['draft'];
    }

    public function recipients(array $plan, string $creator, string $kind): array
    {
        $members = array_filter($plan['members'], function ($member) use ($creator, $kind): bool {
            if (in_array($kind, ['review', 'response'], true)) {
                return $member['accountId'] === $creator || in_array($member['role'], ['owner', 'curator'], true);
            }
            if ($member['role'] === 'contributor' && $member['accountId'] !== $creator) {
                return false;
            }

            return in_array($kind, ['thumbnail', 'restricted-metadata'], true) ? $member['scope'] !== 'none' : $member['scope'] === 'all';
        });

        return array_values(array_map(fn ($m) => ['accountId' => $m['accountId'], 'fingerprint' => Protocol::digest(Protocol::bytes($m['key']['record']['recipientKey'], 32))], $members));
    }
}
