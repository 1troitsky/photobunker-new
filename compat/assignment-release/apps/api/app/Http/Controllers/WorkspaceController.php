<?php

namespace App\Http\Controllers;

use App\Identity\Accounts;
use App\Prototype\Retention;
use App\Workspace\Discussions;
use App\Workspace\Workspace;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class WorkspaceController extends Controller
{
    public function __construct(private readonly Accounts $accounts, private readonly Workspace $workspace) {}

    private function actor(Request $request): string
    {
        return $this->accounts->current($request)->id;
    }

    public function index(Request $request)
    {
        $actor = $this->actor($request);
        $this->workspace->personal($actor);
        $rows = DB::table('workspace_records')->whereNull('deleted_at')->where(fn ($q) => $q->where('owner_id', $actor)->orWhereIn('id', DB::table('workspace_members')->where('account_id', $actor)->where('state', 'accepted')->select('record_id')))->get();
        $category = $rows->firstWhere('kind', 'categories');

        return response()->json(['teams' => $rows->where('kind', 'team')->map(fn ($row) => $this->workspace->serialize($row, $actor))->values(),
            'tasks' => $rows->where('kind', 'task')->map(fn ($row) => $this->workspace->serialize($row, $actor))->values(),
            'presets' => $rows->where('kind', 'preset')->map(fn ($row) => $this->workspace->serialize($row, $actor))->values(),
            'categories' => ['names' => $category ? $this->workspace->payload($category)['names'] : [], 'revision' => (int) ($category?->revision ?? 0)],
            'invitations' => $this->invitations($actor)]);
    }

    private function invitations(string $actor): array
    {
        return DB::table('workspace_members')->where('account_id', $actor)->where('state', 'invited')->get()->map(function ($member) {
            $row = DB::table('workspace_records')->where('id', $member->record_id)->whereNull('deleted_at')->first();
            if (! $row) {
                return null;
            }

            return ['id' => $member->id, 'recordId' => $row->id, 'kind' => $row->kind, 'name' => $this->workspace->payload($row)['name'],
                'ownerPublicId' => DB::table('identity_accounts')->where('id', $row->owner_id)->value('public_id'), 'role' => $member->role, 'photoScope' => $member->photo_scope, 'expiresAt' => (int) $member->expires_at];
        })->filter()->values()->all();
    }

    public function save(Request $request, string $kind, string $id)
    {
        $actor = $this->actor($request);
        $data = $this->workspace->validate($kind, [...$request->all(), 'id' => $id]);
        $result = $this->workspace->save($actor, $kind, $id, $data);

        return response()->json($result);
    }

    public function show(Request $request, string $kind, string $id)
    {
        $actor = $this->actor($request);

        return response()->json($this->workspace->serialize($this->workspace->record($actor, $id, $kind), $actor));
    }

    public function remove(Request $request, string $kind, string $id)
    {
        $actor = $this->actor($request);
        $data = $request->validate(['revision' => 'required|integer|min:1']);
        DB::transaction(function () use ($actor, $kind, $id, $data) {
            $row = DB::table('workspace_records')->where('id', $id)->lockForUpdate()->first();
            abort_unless($row && $row->kind === $kind && $row->owner_id === $actor, 404);
            abort_unless((int) $row->revision === $data['revision'], 409);
            DB::table('workspace_records')->where('id', $id)->update(['deleted_at' => now(), 'revision' => $row->revision + 1, 'room_state' => $row->room_id ? 'pending' : 'none', 'room_retry_at' => null]);
            DB::table('workspace_members')->where('record_id', $id)->update(['state' => 'revoked']);
        });

        return response()->json(['removed' => true]);
    }

    public function respond(Request $request, string $id)
    {
        $actor = $this->actor($request);
        $data = $request->validate(['accept' => 'required|boolean']);
        $record = DB::transaction(function () use ($actor, $id, $data) {
            $found = DB::table('workspace_members')->where('id', $id)->where('account_id', $actor)->first();
            abort_unless($found, 404);
            $row = DB::table('workspace_records')->where('id', $found->record_id)->lockForUpdate()->first();
            $member = DB::table('workspace_members')->where('id', $id)->where('account_id', $actor)->first();
            abort_unless($row && ! $row->deleted_at && $member && in_array($member->state, ['invited', 'accepted', 'declined'], true), 404);
            if ($data['accept']) {
                abort_if($member->state === 'declined', 409);
                abort_if($member->state === 'invited' && $member->expires_at <= Retention::milliseconds(), 410);
                abort_if($this->accounts->blocked($actor, $row->owner_id), 403);
            }
            if ($member->state === ($data['accept'] ? 'accepted' : 'declined')) {
                return $row->id;
            }
            DB::table('workspace_members')->where('id', $id)->update(['state' => $data['accept'] ? 'accepted' : 'declined']);
            DB::table('workspace_records')->where('id', $row->id)->update(['revision' => $row->revision + 1, 'room_state' => $row->room_id || $row->room_state !== 'none' ? 'pending' : 'none', 'room_retry_at' => null]);
            DB::table('workspace_record_versions')->insert(['record_id' => $row->id, 'revision' => $row->revision + 1, 'payload' => $row->payload]);

            return $row->id;
        });

        return response()->json(['recordId' => $record, 'accepted' => $data['accept']]);
    }

    public function categories(Request $request)
    {
        $actor = $this->actor($request);
        $data = $request->validate(['revision' => 'required|integer|min:0', 'names' => 'present|array|max:100', 'names.*' => 'required|string|max:80|distinct']);

        return response()->json(DB::transaction(function () use ($actor, $data) {
            DB::table('identity_accounts')->where('id', $actor)->lockForUpdate()->firstOrFail();
            $row = DB::table('workspace_records')->where('owner_id', $actor)->where('kind', 'categories')->first();
            abort_unless((int) ($row?->revision ?? 0) === $data['revision'], 409);
            $value = ['owner_id' => $actor, 'kind' => 'categories', 'revision' => $data['revision'] + 1, 'payload' => Crypt::encryptString(json_encode(['names' => array_values(array_unique(array_map('trim', $data['names'])))])), 'updated_at' => now()];
            if ($row) {
                DB::table('workspace_records')->where('id', $row->id)->update($value);
            } else {
                DB::table('workspace_records')->insert(['id' => (string) Str::uuid(), 'created_at' => now(), ...$value]);
            }

            return ['names' => $data['names'], 'revision' => $value['revision']];
        }));
    }

    public function discussion(Request $request, string $id, Discussions $discussions)
    {
        $actor = $this->actor($request);
        $row = $this->workspace->record($actor, $id, 'task');
        abort_if($this->accounts->blocked($actor, $row->owner_id), 403);
        if ($request->isMethod('POST')) {
            DB::table('workspace_records')->where('id', $id)->update(['room_state' => 'pending', 'room_retry_at' => null]);
            try {
                $discussions->reconcile($id);
            } catch (\Throwable) { /* Durable pending state is the retry contract. */
            }
            $row = DB::table('workspace_records')->find($id);
            $this->workspace->record($actor, $id, 'task');
        }

        return response()->json(['assignmentId' => $id, 'roomId' => $row->room_id, 'state' => $row->room_state], $row->room_state === 'ready' ? 200 : 202);
    }

    public function clock(Request $request)
    {
        $actor = $this->actor($request);
        $id = (string) Str::uuid();
        $issued = Retention::milliseconds();
        DB::table('workspace_clock_anchors')->insert(['id' => $id, 'account_id' => $actor, 'issued_at' => $issued]);

        return response()->json(['id' => $id, 'issuedAt' => $issued]);
    }
}
