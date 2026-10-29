<?php

namespace App\Http\Controllers;

use App\Prototype\Collaboration;
use App\Prototype\Library;
use App\Prototype\Retention;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

final class PrototypeAssignmentController extends Controller
{
    public function submissions(Request $request)
    {
        $actor = $request->attributes->get('prototype_library');
        $rows = DB::table('prototype_photos')->where('creator_id', $actor)->where('state', 'active')
            ->whereIn('space_id', array_column(Collaboration::spaces($actor), 'id'))->orderByDesc('captured_at')->get()->reject(Retention::expired(...));

        return response()->json(['submissions' => $rows->map(function ($photo) use ($actor) {
            $access = Collaboration::access($actor, $photo->space_id);

            return ['id' => $photo->id, 'profileId' => $photo->profile_id, 'assignmentId' => $photo->assignment_id,
                'shortId' => $photo->short_id, 'shot' => $photo->shot, 'creatorId' => $actor, 'createdAt' => (int) $photo->captured_at,
                'expiresAt' => $photo->expires_at !== null ? (int) $photo->expires_at : null, 'state' => $photo->review_state,
                'revision' => (int) $photo->review_revision, 'comment' => $photo->review_comment ?? '', 'response' => $photo->response_comment ?? '',
                'replacesId' => $photo->replaces_id, 'canRead' => $access['role'] !== 'contributor' || $access['readOwnPhotos'],
                'canRespond' => $access['role'] !== 'viewer' && in_array($photo->review_state, ['correction', 'reshoot'], true)];
        })->values()]);
    }

    public function index(Request $request)
    {
        $actor = $request->attributes->get('prototype_library');
        $rows = DB::table('prototype_assignments')->whereIn('space_id', array_column(Collaboration::spaces($actor), 'id'))->get();
        $rows = $rows->filter(fn ($row) => Collaboration::access($actor, $row->space_id)['role'] !== 'contributor' || in_array($actor, json_decode($row->assignees, true), true));

        return response()->json(['assignments' => $rows->map(fn ($row) => $this->serialize($row, $actor))->values()]);
    }

    public function show(Request $request, string $id)
    {
        $actor = $request->attributes->get('prototype_library');
        $assignment = Collaboration::assignment($actor, $id);
        $access = Collaboration::access($actor, $assignment->space_id);
        $photos = DB::table('prototype_photos')->where('assignment_id', $id)->where('state', 'active')->get()->reject(Retention::expired(...));
        if ($access['role'] === 'contributor') {
            $photos = $photos->where('creator_id', $actor);
        }
        $submissions = $photos->sortByDesc('captured_at')->map(fn ($photo) => [
            'id' => $photo->id, 'shortId' => $photo->short_id, 'shot' => $photo->shot, 'creatorId' => $photo->creator_id,
            'createdAt' => (int) $photo->captured_at, 'expiresAt' => $photo->expires_at !== null ? (int) $photo->expires_at : null,
            'state' => $photo->review_state, 'revision' => (int) $photo->review_revision, 'comment' => $photo->review_comment ?? '',
            'response' => $photo->response_comment ?? '', 'replacesId' => $photo->replaces_id,
            'canRead' => $access['role'] !== 'contributor' || $access['readOwnPhotos'],
            'canRespond' => $access['role'] !== 'viewer' && $photo->creator_id === $actor && in_array($photo->review_state, ['correction', 'reshoot'], true),
        ])->values();

        return response()->json(['assignment' => $this->serialize($assignment, $actor), 'submissions' => $submissions]);
    }

    public function create(Request $request)
    {
        $data = $request->validate(['profileId' => 'required|uuid', 'name' => 'required|string|max:80', 'instructions' => 'present|nullable|string|max:4000',
            'assignees' => 'required|array|min:1|max:100', 'assignees.*' => 'required|uuid|distinct',
            'shots' => 'present|array|max:30', 'shots.*' => 'required|string|max:80|distinct',
            'dueAt' => 'nullable|integer|min:0|max:9007199254740991']);
        $actor = $request->attributes->get('prototype_library');
        $profile = Collaboration::profile($actor, $data['profileId']);
        abort_unless($profile->space_id !== null, 422);
        $id = DB::transaction(function () use ($actor, $profile, $data) {
            Library::lock($profile->library_id);
            abort_unless(in_array(Collaboration::access($actor, $profile->space_id)['role'], ['owner', 'curator'], true), 403);
            abort_if($profile->archived, 422);
            $allowed = DB::table('prototype_members')->where('space_id', $profile->space_id)->where('active', true)->whereIn('role', ['contributor', 'curator'])->pluck('actor_id')->push($profile->library_id)->all();
            abort_if(array_diff($data['assignees'], $allowed) !== [], 422);
            abort_if(DB::table('prototype_assignments')->where('space_id', $profile->space_id)->count() >= 100, 413);
            $snapshot = Collaboration::profileData(Collaboration::profile($actor, $profile->id), $actor);
            unset($snapshot['access'], $snapshot['archived']);
            $id = (string) Str::uuid();
            DB::table('prototype_assignments')->insert(['id' => $id, 'space_id' => $profile->space_id, 'profile_id' => $profile->id,
                'profile_snapshot' => json_encode($snapshot), 'name' => trim($data['name']), 'instructions' => trim($data['instructions'] ?? ''),
                'assignees' => json_encode($data['assignees']), 'shots' => json_encode($data['shots']), 'due_at' => $data['dueAt'] ?? null]);

            return $id;
        });

        return response()->json(['assignment' => $this->serialize(Collaboration::assignment($actor, $id), $actor)], 201);
    }

    public function close(Request $request, string $id)
    {
        $data = $request->validate(['closed' => 'required|boolean', 'revision' => 'required|integer|min:1']);
        $actor = $request->attributes->get('prototype_library');
        $assignment = Collaboration::assignment($actor, $id);
        DB::transaction(function () use ($actor, $assignment, $data): void {
            $space = DB::table('prototype_spaces')->where('id', $assignment->space_id)->firstOrFail();
            Library::lock($space->owner_id);
            abort_unless(in_array(Collaboration::access($actor, $space->id)['role'], ['owner', 'curator'], true), 403);
            $row = Collaboration::assignment($actor, $assignment->id);
            abort_unless((int) $row->revision === $data['revision'], 409);
            DB::table('prototype_assignments')->where('id', $row->id)->update(['closed' => $data['closed'], 'revision' => $row->revision + 1]);
        });

        return response()->json(['assignment' => $this->serialize(Collaboration::assignment($actor, $id), $actor)]);
    }

    public function review(Request $request, string $id)
    {
        $data = $request->validate(['state' => ['required', Rule::in(['accepted', 'correction', 'reshoot', 'rejected'])],
            'comment' => 'present|nullable|string|max:2000', 'revision' => 'required|integer|min:1']);
        abort_if(in_array($data['state'], ['correction', 'reshoot', 'rejected'], true) && trim($data['comment'] ?? '') === '', 422);
        $actor = $request->attributes->get('prototype_library');
        $photo = Collaboration::findPhoto($actor, $id);
        abort_unless($photo && $photo->space_id !== null, 404);
        DB::transaction(function () use ($actor, $photo, $data): void {
            Library::lock($photo->library_id);
            abort_unless(in_array(Collaboration::access($actor, $photo->space_id)['role'], ['owner', 'curator'], true), 403);
            $row = Library::photos($photo->library_id)->where('id', $photo->id)->firstOrFail();
            abort_if($row->state !== 'active' || Retention::expired($row), 410);
            abort_unless((int) $row->review_revision === $data['revision'], 409);
            DB::table('prototype_photos')->where('library_id', $row->library_id)->where('id', $row->id)->update([
                'review_state' => $data['state'], 'review_comment' => trim($data['comment'] ?? ''), 'response_comment' => null, 'review_revision' => $row->review_revision + 1]);
        });

        return response()->json(['reviewed' => true]);
    }

    public function respond(Request $request, string $id)
    {
        $data = $request->validate(['comment' => 'required|string|max:2000', 'note' => 'sometimes|nullable|string|max:2000', 'revision' => 'required|integer|min:1']);
        $actor = $request->attributes->get('prototype_library');
        $photo = Collaboration::findPhoto($actor, $id);
        abort_unless($photo && $photo->space_id !== null, 404);
        DB::transaction(function () use ($actor, $photo, $data): void {
            Library::lock($photo->library_id);
            Collaboration::assertPhoto($actor, $photo, 'update');
            $row = Library::photos($photo->library_id)->where('id', $photo->id)->firstOrFail();
            abort_unless($row->creator_id === $actor, 403);
            abort_if($row->state !== 'active' || Retention::expired($row), 410);
            abort_unless((int) $row->review_revision === $data['revision'], 409);
            abort_unless(in_array($row->review_state, ['correction', 'reshoot'], true), 422);
            $profile = json_decode($row->profile_snapshot, true);
            abort_if(isset($data['note']) && ! $profile['rules']['descriptionEditable'] && $row->note !== '' && $row->note !== trim($data['note']), 403);
            Library::photos($row->library_id)->where('id', $row->id)->update(['response_comment' => trim($data['comment']),
                'review_state' => $row->review_state === 'correction' ? 'pending' : 'reshoot', 'review_revision' => $row->review_revision + 1,
                'note' => isset($data['note']) ? trim($data['note']) : $row->note, 'revision' => $row->revision + (isset($data['note']) ? 1 : 0)]);
        });

        return response()->json(['responded' => true]);
    }

    private function serialize(object $row, string $actor): array
    {
        $access = Collaboration::access($actor, $row->space_id);

        return ['id' => $row->id, 'spaceId' => $row->space_id, 'profileId' => $row->profile_id, 'profile' => [...json_decode($row->profile_snapshot, true), 'access' => $access],
            'name' => $row->name, 'instructions' => $row->instructions, 'assignees' => json_decode($row->assignees, true), 'shots' => json_decode($row->shots, true),
            'dueAt' => $row->due_at !== null ? (int) $row->due_at : null, 'closed' => (bool) $row->closed, 'revision' => (int) $row->revision,
            'canManage' => in_array($access['role'], ['owner', 'curator'], true),
            'canCapture' => ! $row->closed && in_array($access['role'], ['owner', 'curator', 'contributor'], true) && in_array($actor, json_decode($row->assignees, true), true)];
    }
}
