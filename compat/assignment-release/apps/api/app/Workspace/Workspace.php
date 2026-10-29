<?php

namespace App\Workspace;

use App\Identity\AccountLifecycle;
use App\Identity\Accounts;
use App\Prototype\Retention;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

final class Workspace
{
    public function payload(object $row): array
    {
        return json_decode(Crypt::decryptString($row->payload), true, flags: JSON_THROW_ON_ERROR);
    }

    public function personal(string $account): object
    {
        return DB::transaction(function () use ($account) {
            DB::table('identity_accounts')->where('id', $account)->lockForUpdate()->firstOrFail();
            $vault = DB::table('workspace_vaults')->where('owner_id', $account)->where('kind', 'personal')->first();
            if (! $vault) {
                $id = (string) Str::uuid();
                DB::table('workspace_vaults')->insert(['id' => $id, 'owner_id' => $account, 'kind' => 'personal']);
                $vault = DB::table('workspace_vaults')->find($id);
            }

            return $vault;
        });
    }

    public function member(string $account, object $record): ?object
    {
        return DB::table('workspace_members')->where('record_id', $record->id)->where('account_id', $account)->where('state', 'accepted')->first();
    }

    public function record(string $account, string $id, ?string $kind = null): object
    {
        $row = DB::table('workspace_records')->where('id', $id)->whereNull('deleted_at')->first();
        abort_unless($row && (! $kind || $row->kind === $kind) && ($row->owner_id === $account || $this->member($account, $row)), 404);

        return $row;
    }

    public function serialize(object $row, string $viewer): array
    {
        $payload = $this->payload($row);
        $members = DB::table('workspace_members')->where('record_id', $row->id)->whereIn('state', ['invited', 'accepted', 'declined'])->get();
        $people = $members->filter(function ($member) {
            $account = DB::table('identity_accounts')->find($member->account_id);

            return $account && ! AccountLifecycle::unavailable($account);
        })->map(function ($member) use ($viewer, $payload) {
            $account = DB::table('identity_accounts')->find($member->account_id);
            $person = app(Accounts::class)->person($account, $viewer);
            $annotation = collect($payload['participants'] ?? [])->firstWhere('id', $person['publicId']);

            return ['id' => $person['publicId'], 'name' => $annotation['name'] ?? ($person['fields']['name'] ?? $person['fields']['username'] ?? ''), 'role' => $member->role, 'photoScope' => $member->photo_scope, 'notify' => true, 'state' => $member->state, 'invitationId' => $member->id, 'expiresAt' => (int) $member->expires_at];
        })->all();

        return [...$payload, 'id' => $row->id, 'revision' => (int) $row->revision, 'participants' => $people,
            'accountId' => $viewer, 'ownerPublicId' => DB::table('identity_accounts')->where('id', $row->owner_id)->value('public_id'),
            'canManage' => $row->owner_id === $viewer, 'role' => $row->owner_id === $viewer ? 'owner' : $this->member($viewer, $row)?->role,
            'discussion' => ['roomId' => $row->room_id, 'state' => $row->room_state]];
    }

    public function validate(string $kind, array $input): array
    {
        abort_unless(in_array($kind, ['team', 'task', 'preset'], true), 404);
        $rules = ['name' => 'required|string|max:80', 'revision' => 'required|integer|min:0',
            'participants' => 'sometimes|array|max:100', 'participants.*.id' => 'required|string|max:120|distinct',
            'participants.*.name' => 'present|nullable|string|max:80', 'participants.*.role' => 'required|in:curator,contributor,viewer',
            'participants.*.photoScope' => 'sometimes|in:default,none,thumbnails,all', 'participants.*.notify' => 'sometimes|boolean'];
        if ($kind === 'team') {
            $rules['description'] = 'sometimes|nullable|string|max:1000';
        }
        if ($kind === 'task') {
            $rules += ['instructions' => 'present|nullable|string|max:4000', 'startsAt' => 'present|nullable|integer|min:0', 'finishesAt' => 'present|nullable|integer|min:0',
                'targetCount' => 'required|integer|min:1|max:999', 'shots' => 'present|array|max:100', 'shots.*' => 'required|string|max:80|distinct',
                'teamId' => 'present|nullable|string|max:36', 'presetId' => 'present|nullable|string|max:120', 'preset' => 'present|nullable|array',
                'completed' => 'required|boolean', 'rules' => 'required|array', 'rules.categories' => 'present|array|max:30', 'rules.categories.*' => 'required|string|max:80|distinct',
                'rules.minLength' => 'required|integer|min:1|max:2000'];
            foreach (['categoryRequired', 'particularCategory', 'descriptionRequired', 'changesAllowed', 'keepOriginal', 'deletionAllowed', 'galleryAllowed', 'thumbnailsOnly', 'sharingAllowed', 'participantsOnly'] as $field) {
                $rules['rules.'.$field] = 'required|boolean';
            }
        }
        if ($kind === 'task') {
            $rules['rules.useAssignmentPhotoId'] = 'sometimes|boolean';
        }
        if ($kind === 'preset') {
            $rules += ['description' => 'present|nullable|string|max:1000', 'version' => 'required|integer|min:0', 'rules' => 'required|array', 'options' => 'required|array', 'archived' => 'sometimes|boolean', 'hidden' => 'sometimes|boolean'];
        }
        $data = Validator::make($input, $rules)->validate();
        $data['name'] = trim($data['name']);
        abort_unless($data['name'] !== '', 422);
        if ($kind === 'task') {
            abort_if($data['startsAt'] !== null && $data['finishesAt'] !== null && $data['finishesAt'] <= $data['startsAt'], 422);
            abort_if($data['rules']['particularCategory'] && ! $data['rules']['categories'], 422);
            if ($data['preset']) {
                $data['preset'] = $this->preset($data['preset']);
            }
        }
        if ($kind === 'preset') {
            $data = [...$this->preset([...$data, 'id' => $input['id'] ?? (string) Str::uuid()]), 'revision' => $data['revision'], 'archived' => $data['archived'] ?? false, 'hidden' => $data['hidden'] ?? false];
        }

        return $data;
    }

    private function preset(array $data): array
    {
        $validated = Validator::make($data, ['id' => 'required|string|max:120', 'name' => 'required|string|max:80', 'description' => 'present|nullable|string|max:1000', 'version' => 'required|integer|min:0',
            'options' => 'required|array:size,date,time,retention,customHours', 'options.size' => 'required|in:maximum,high,medium,low,custom', 'options.date' => 'required|boolean', 'options.time' => 'required|boolean',
            'options.retention' => 'required', 'options.customHours' => 'required|numeric|min:1|max:8760', 'rules' => 'required|array'])->validate();
        // Presets are configuration, not grants. Categories remain workspace-wide.
        $fields = ['retentionSeconds', 'resolution', 'width', 'height', 'aspect', 'aspectWidth', 'aspectHeight', 'fit', 'quality', 'metadata', 'keepDate', 'keepCamera', 'location', 'accuracy', 'locationWindow', 'descriptionRequired', 'descriptionEditable', 'categoryRequired', 'categories', 'shotList', 'idPrefix', 'curatorDescriptionEditable'];
        abort_if(array_diff(array_keys($validated['rules']), $fields) || strlen(json_encode($validated['rules'])) > 16000, 422);
        $checks = ['resolution' => 'required|in:maximum,fixed', 'width' => 'required|integer|min:64|max:16384', 'height' => 'required|integer|min:64|max:16384',
            'aspect' => 'required|in:native,1:1,4:3,3:2,16:9,custom', 'aspectWidth' => 'required|numeric|min:1|max:100', 'aspectHeight' => 'required|numeric|min:1|max:100',
            'quality' => 'required|numeric|min:0.6|max:1', 'fit' => 'required|in:crop,contain', 'metadata' => 'required|in:all,selected,none', 'location' => 'required|in:off,optional,required',
            'accuracy' => 'required|numeric|min:1|max:1000', 'locationWindow' => 'required|numeric|min:1|max:60', 'categories' => 'present|array|max:100', 'categories.*' => 'required|string|max:80',
            'shotList' => 'present|array|max:100', 'shotList.*' => 'required|string|max:80', 'idPrefix' => 'present|nullable|string|max:8'];
        foreach (['keepDate', 'keepCamera', 'descriptionRequired', 'descriptionEditable', 'categoryRequired'] as $field) {
            $checks[$field] = 'required|boolean';
        }
        $validated['rules'] = Validator::make($validated['rules'], $checks)->validate();
        abort_if($validated['rules']['width'] * $validated['rules']['height'] > 50000000, 422);
        $duration = $validated['options']['retention'] === 'custom' ? $validated['options']['customHours'] * 3600 : $validated['options']['retention'];
        abort_unless(is_numeric($duration) && ($duration == 0 || $duration >= 3600 && $duration <= 31536000), 422);

        return [...$validated, 'uiOnly' => true, 'revision' => 0];
    }

    public function save(string $actor, string $kind, string $id, array $data): array
    {
        return DB::transaction(function () use ($actor, $kind, $id, $data) {
            DB::table('identity_accounts')->where('id', $actor)->lockForUpdate()->firstOrFail();
            $row = DB::table('workspace_records')->where('id', $id)->lockForUpdate()->first();
            abort_if($row && ($row->owner_id !== $actor || $row->kind !== $kind || $row->deleted_at), 404);
            abort_unless((int) ($row->revision ?? 0) === $data['revision'], 409);
            abort_if(! $row && DB::table('workspace_records')->where('owner_id', $actor)->where('kind', $kind)->whereNull('deleted_at')->count() >= 100, 413);
            $team = ! empty($data['teamId']) ? $this->record($actor, $data['teamId'], 'team') : null;
            $participants = $data['participants'] ?? [];
            $resolved = [];
            foreach ($participants as $participant) {
                $person = DB::table('identity_accounts')->where('public_id', $participant['id'])->first();
                abort_unless($person && $person->id !== $actor && ! app(Accounts::class)->blocked($actor, $person->id), 422);
                $known = $row ? DB::table('workspace_members')->where('record_id', $id)->where('account_id', $person->id)->whereIn('state', ['accepted', 'invited'])->exists() : false;
                $contact = DB::table('identity_address_book')->where('account_id', $actor)->where('contact_id', $person->id)->exists();
                abort_unless($known || $contact || $team && ($team->owner_id === $person->id || $this->member($person->id, $team)), 422);
                $resolved[] = [$person, $participant];
            }
            $revision = $data['revision'] + 1;
            $payload = [...$data, 'id' => $id, 'createdAt' => $row ? $this->payload($row)['createdAt'] : Retention::milliseconds(), 'revision' => $revision];
            if ($team) {
                $payload['teamName'] = $this->payload($team)['name'];
            }
            $record = ['owner_id' => $actor, 'kind' => $kind, 'revision' => $revision, 'payload' => Crypt::encryptString(json_encode($payload)), 'team_id' => $team?->id, 'updated_at' => now()];
            if ($row) {
                DB::table('workspace_records')->where('id', $id)->update($record);
            } else {
                DB::table('workspace_records')->insert(['id' => $id, 'created_at' => now(), ...$record]);
            }
            DB::table('workspace_record_versions')->insert(['record_id' => $id, 'revision' => $revision, 'payload' => $record['payload']]);
            if ($kind === 'task' && ! $row) {
                DB::table('workspace_vaults')->insert(['id' => (string) Str::uuid(), 'owner_id' => $actor, 'assignment_id' => $id, 'kind' => 'assignment']);
            }
            $ids = array_map(fn ($item) => $item[0]->id, $resolved);
            DB::table('workspace_members')->where('record_id', $id)->whereNotIn('account_id', $ids)->update(['state' => 'revoked']);
            foreach ($resolved as [$person, $participant]) {
                $existing = DB::table('workspace_members')->where('record_id', $id)->where('account_id', $person->id)->first();
                $retain = $existing && in_array($existing->state, ['accepted', 'invited'], true) && ($existing->state === 'accepted' || $existing->expires_at > Retention::milliseconds());
                DB::table('workspace_members')->updateOrInsert(['record_id' => $id, 'account_id' => $person->id], ['id' => $retain ? $existing->id : (string) Str::uuid(),
                    'role' => $participant['role'], 'photo_scope' => $participant['photoScope'] ?? 'default', 'state' => $retain ? $existing->state : 'invited', 'expires_at' => $retain ? $existing->expires_at : Retention::milliseconds() + 604800000]);
            }
            if ($kind === 'task' && ($row?->room_id || $row?->room_state !== 'none' && $row)) {
                DB::table('workspace_records')->where('id', $id)->update(['room_state' => 'pending', 'room_retry_at' => null]);
            }

            return $this->serialize(DB::table('workspace_records')->find($id), $actor);
        });
    }

    public function grant(string $actor, object $photo): array
    {
        $vault = DB::table('workspace_vaults')->find($photo->vault_id);
        abort_unless($vault, 404);
        if ($vault->owner_id === $actor) {
            return ['role' => 'owner', 'read' => true, 'thumbnail' => true, 'edit' => true, 'delete' => true, 'share' => true, 'shareExternal' => true];
        }
        abort_unless($photo->assignment_id, 404);
        $record = $this->record($actor, $photo->assignment_id, 'task');
        $member = $this->member($actor, $record);
        abort_unless($member && ! app(Accounts::class)->blocked($actor, $record->owner_id), 404);
        $rules = $this->payload($record)['rules'];
        $own = $photo->creator_id === $actor;
        $contributor = $member->role === 'contributor';
        $scope = $member->photo_scope === 'default' ? ($contributor ? ($rules['galleryAllowed'] ? ($rules['thumbnailsOnly'] ? 'thumbnails' : 'all') : 'none') : 'all') : $member->photo_scope;
        $eligible = ! $contributor || $own;
        $read = $eligible && $scope === 'all';

        return ['role' => $member->role, 'read' => $read, 'thumbnail' => $eligible && $scope !== 'none',
            'edit' => $read && ($member->role === 'curator' || $contributor && $own && $rules['changesAllowed']),
            'delete' => $member->role === 'curator' || $contributor && $own && $rules['deletionAllowed'],
            'share' => $read && ($member->role === 'curator' || $rules['sharingAllowed']),
            'shareExternal' => $read && ($member->role === 'curator' || $rules['sharingAllowed'] && ! $rules['participantsOnly'])];
    }

    public function capture(string $actor, ?string $assignment, bool $committed = false): object
    {
        if (! $assignment) {
            return $this->personal($actor);
        }
        $row = $this->record($actor, $assignment, 'task');
        $data = $this->payload($row);
        $role = $row->owner_id === $actor ? 'owner' : $this->member($actor, $row)?->role;
        abort_unless(in_array($role, ['owner', 'curator', 'contributor'], true) && ($committed || ! $data['completed'] && (! $data['startsAt'] || $data['startsAt'] <= Retention::milliseconds()) && (! $data['finishesAt'] || $data['finishesAt'] > Retention::milliseconds())) && ! app(Accounts::class)->blocked($actor, $row->owner_id), 403);

        return DB::table('workspace_vaults')->where('assignment_id', $assignment)->firstOrFail();
    }
}
