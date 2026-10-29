<?php

namespace App\Http\Controllers;

use App\Prototype\Collaboration;
use App\Prototype\Library;
use App\Prototype\Retention;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

final class PrototypeTeamController extends Controller
{
    public function share(Request $request, string $id)
    {
        $request->validate(['version' => 'required|integer|min:1']);
        $actor = $request->attributes->get('prototype_library');
        $profile = DB::transaction(function () use ($actor, $id, $request) {
            Library::lock($actor);
            $row = DB::table('prototype_profiles')->where('library_id', $actor)->where('id', $id)->first();
            abort_unless($row, 404);
            if ($row->space_id !== null) {
                return Collaboration::profileData($row, $actor);
            }
            abort_unless((int) $row->version === $request->integer('version'), 409);
            $space = (string) Str::uuid();
            DB::table('prototype_spaces')->insert(['id' => $space, 'owner_id' => $actor, 'name' => $row->name]);
            $snapshot = Collaboration::profileData($row, $actor);
            unset($snapshot['access'], $snapshot['archived']);
            $snapshot['version']++;
            $snapshot['spaceId'] = $space;
            DB::table('prototype_profiles')->where('library_id', $actor)->where('id', $id)->update(['space_id' => $space, 'version' => $snapshot['version']]);
            DB::table('prototype_profile_versions')->insert(['library_id' => $actor, 'profile_id' => $id, 'version' => $snapshot['version'], 'snapshot' => json_encode($snapshot)]);

            return [...$snapshot, 'archived' => (bool) $row->archived, 'access' => Collaboration::access($actor, $space)];
        });

        return response()->json(['profile' => $profile]);
    }

    public function show(Request $request, string $id)
    {
        $actor = $request->attributes->get('prototype_library');
        $access = Collaboration::access($actor, $id);
        $space = DB::table('prototype_spaces')->where('id', $id)->firstOrFail();
        $members = DB::table('prototype_members')->where('space_id', $id);
        if (! in_array($access['role'], ['owner', 'curator'], true)) {
            $members->where('actor_id', $actor);
        }
        $people = $members->get()->map(fn ($member) => ['id' => $member->actor_id, 'role' => $member->role, 'nickname' => $member->nickname,
            'readOwnPhotos' => (bool) $member->read_own, 'manageProfiles' => (bool) $member->manage_profiles, 'active' => (bool) $member->active])->all();
        if (in_array($access['role'], ['owner', 'curator'], true)) {
            array_unshift($people, ['id' => $space->owner_id, 'role' => 'owner', 'nickname' => '', 'readOwnPhotos' => true, 'manageProfiles' => true, 'active' => true]);
        }
        $invitations = $access['role'] === 'owner' ? DB::table('prototype_invitations')->where('space_id', $id)->get()->map(fn ($invite) => [
            'id' => $invite->id, 'role' => $invite->role, 'readOwnPhotos' => (bool) $invite->read_own, 'manageProfiles' => (bool) $invite->manage_profiles,
            'expiresAt' => (int) $invite->expires_at, 'accepted' => $invite->accepted_by !== null, 'revoked' => (bool) $invite->revoked])->all() : [];

        return response()->json(['space' => ['id' => $id, 'name' => $space->name, ...$access], 'members' => $people, 'invitations' => $invitations]);
    }

    public function invite(Request $request, string $id)
    {
        $data = $request->validate(['role' => ['required', Rule::in(['curator', 'contributor', 'viewer'])],
            'readOwnPhotos' => 'required|boolean', 'manageProfiles' => 'required|boolean', 'duration' => 'required|integer|min:300|max:604800']);
        $actor = $request->attributes->get('prototype_library');
        $result = DB::transaction(function () use ($actor, $id, $data) {
            $space = DB::table('prototype_spaces')->where('id', $id)->first();
            abort_unless($space, 404);
            Library::lock($space->owner_id);
            abort_unless(Collaboration::access($actor, $id)['role'] === 'owner', 403);
            abort_if(DB::table('prototype_invitations')->where('space_id', $id)->count() >= 100, 413);
            $token = bin2hex(random_bytes(32));
            $invite = ['id' => (string) Str::uuid(), 'space_id' => $id, 'token_hash' => hash('sha256', $token), 'role' => $data['role'],
                'read_own' => $data['role'] !== 'contributor' || $data['readOwnPhotos'], 'manage_profiles' => $data['role'] === 'curator' && $data['manageProfiles'],
                'expires_at' => Retention::milliseconds() + $data['duration'] * 1000];
            DB::table('prototype_invitations')->insert($invite);

            return ['id' => $invite['id'], 'code' => $token, 'expiresAt' => $invite['expires_at']];
        });

        return response()->json($result, 201);
    }

    public function accept(Request $request)
    {
        $data = $request->validate(['code' => 'required|string|regex:/^[a-f0-9]{64}$/D', 'nickname' => 'required|string|max:80']);
        $actor = $request->attributes->get('prototype_library');
        $invite = DB::table('prototype_invitations')->where('token_hash', hash('sha256', $data['code']))->first();
        abort_unless($invite, 404);
        DB::transaction(function () use ($actor, $invite, $data): void {
            $space = DB::table('prototype_spaces')->where('id', $invite->space_id)->firstOrFail();
            Library::lock($space->owner_id);
            $current = DB::table('prototype_invitations')->where('id', $invite->id)->firstOrFail();
            abort_if($current->revoked || $current->expires_at <= Retention::milliseconds(), 410);
            abort_if($current->accepted_by !== null && $current->accepted_by !== $actor, 409);
            abort_if($space->owner_id === $actor, 422);
            if ($current->accepted_by === $actor) {
                Collaboration::access($actor, $space->id);

                return;
            }
            abort_if(DB::table('prototype_members')->where('space_id', $space->id)->where('actor_id', $actor)->where('active', true)->exists(), 409);
            abort_if(DB::table('prototype_members')->where('space_id', $space->id)->count() >= 100, 413);
            DB::table('prototype_members')->updateOrInsert(['space_id' => $space->id, 'actor_id' => $actor], [
                'role' => $current->role, 'nickname' => trim($data['nickname']), 'read_own' => $current->read_own,
                'manage_profiles' => $current->manage_profiles, 'active' => true, 'invitation_id' => $current->id]);
            DB::table('prototype_invitations')->where('id', $current->id)->update(['accepted_by' => $actor]);
        });

        return response()->json(['spaceId' => $invite->space_id]);
    }

    public function revokeInvite(Request $request, string $id)
    {
        $invite = DB::table('prototype_invitations')->where('id', $id)->first();
        abort_unless($invite, 404);
        $this->ownerWrite($request, $invite->space_id, function () use ($id): void {
            DB::table('prototype_invitations')->where('id', $id)->update(['revoked' => true]);
            DB::table('prototype_members')->where('invitation_id', $id)->update(['active' => false]);
        });

        return response()->json(['revoked' => true]);
    }

    public function member(Request $request, string $id, string $member)
    {
        $data = $request->validate(['active' => 'required|boolean', 'readOwnPhotos' => 'required|boolean', 'manageProfiles' => 'required|boolean']);
        $this->ownerWrite($request, $id, function () use ($id, $member, $data): void {
            $row = DB::table('prototype_members')->where('space_id', $id)->where('actor_id', $member)->first();
            abort_unless($row, 404);
            abort_if($data['active'] && ! $row->active, 422); // Re-entry requires a new invitation.
            DB::table('prototype_members')->where('space_id', $id)->where('actor_id', $member)->update([
                'active' => $data['active'], 'read_own' => $row->role !== 'contributor' || $data['readOwnPhotos'],
                'manage_profiles' => $row->role === 'curator' && $data['manageProfiles']]);
        });

        return response()->json(['updated' => true]);
    }

    private function ownerWrite(Request $request, string $spaceId, callable $work): void
    {
        DB::transaction(function () use ($request, $spaceId, $work): void {
            $space = DB::table('prototype_spaces')->where('id', $spaceId)->first();
            abort_unless($space, 404);
            Library::lock($space->owner_id);
            abort_unless(Collaboration::access($request->attributes->get('prototype_library'), $spaceId)['role'] === 'owner', 403);
            $work();
        });
    }
}
