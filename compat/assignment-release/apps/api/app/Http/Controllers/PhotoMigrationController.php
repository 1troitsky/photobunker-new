<?php

namespace App\Http\Controllers;

use App\Encrypted\Keys;
use App\Encrypted\Migration;
use App\Encrypted\Objects;
use App\Encrypted\Protocol;
use App\Identity\Accounts;
use App\Prototype\Library;
use App\Prototype\Retention;
use App\Workspace\Photos;
use App\Workspace\Workspace;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpKernel\Exception\HttpException;

final class PhotoMigrationController
{
    public function __construct(private readonly Keys $keys, private readonly Migration $migration, private readonly Objects $objects, private readonly Accounts $accounts) {}

    private function actor(Request $request): string
    {
        $id = $this->accounts->current($request)->id;
        $this->keys->read($request);

        return $id;
    }

    public function index(Request $request)
    {
        $actor = $this->actor($request);
        $rows = [];
        foreach (DB::table('workspace_photos')->where('creator_id', $actor)->where('state', 'active')->get() as $row) {
            if (Retention::expired($row)) {
                continue;
            }$source = ['kind' => 'workspace', 'id' => $row->id, 'revision' => (int) $row->revision, 'reviewRevision' => 1, 'libraryId' => null];
            try {
                $data = $this->migration->source($actor, $source);
                $rows[] = ['source' => $source, 'photo' => $data['photo']];
            } catch (HttpException) {
                continue;
            }
        }
        foreach (DB::table('prototype_photos')->whereIn('library_id', DB::table('identity_legacy_claims')->where('account_id', $actor)->select('library_id'))->where('state', 'active')->get() as $row) {
            if (Retention::expired($row)) {
                continue;
            }$source = ['kind' => 'legacy', 'id' => $row->id, 'revision' => (int) $row->revision, 'reviewRevision' => (int) $row->review_revision, 'libraryId' => $row->library_id];
            $rows[] = ['source' => $source, 'photo' => Library::serialize($row)];
        }
        $verified = DB::table('photo_migration_checks')->where('account_id', $actor)->get()->map(fn ($r) => ['targetId' => $r->target_id, 'statement' => Protocol::decode($r->statement), 'cleaned' => (bool) $r->cleaned_at]);

        return response()->json(['sources' => $rows, 'verified' => $verified]);
    }

    public function target(Request $request)
    {
        $actor = $this->actor($request);
        $input = $request->validate(['source' => 'required|string|max:1000']);

        return response()->json($this->migration->mapping($actor, Protocol::decode($input['source'], 1000)));
    }

    public function content(Request $request)
    {
        $actor = $this->actor($request);
        $input = $request->validate(['source' => 'required|string|max:1000', 'kind' => 'required|in:original,preview']);
        $source = Protocol::decode($input['source'], 1000);
        $data = $this->migration->source($actor, $source);
        abort_unless($data['row'], 422);
        $row = $data['row'];
        $key = $input['kind'] === 'original' ? $row->original_key : ($row->preview_key ?? $row->thumbnail_key);
        try {
            $stream = Storage::disk(config('prototype.disk'))->readStream($key);
        } catch (\Throwable) {
            abort(503);
        }abort_unless(is_resource($stream), 503);

        return response()->stream(function () use ($stream) {
            try {
                fpassthru($stream);
            } finally {
                fclose($stream);
            }
        }, 200, ['Content-Type' => 'application/octet-stream', 'Cache-Control' => 'no-store']);
    }

    public function verified(Request $request, string $id)
    {
        $actor = $this->actor($request);
        $input = $request->validate(['statement' => 'required|string|max:3000', 'signature' => 'required|string|max:100', 'certificate' => 'required|string|max:10000']);
        $s = Protocol::decode($input['statement'], 3000);
        Protocol::fields($s, ['version', 'source', 'targetId', 'submissionHash', 'method']);
        abort_unless($s['version'] === 1 && $s['method'] === 'client-readback' && $s['targetId'] === $id, 422);
        $row = $this->objects->active($actor, $id);
        abort_unless($row->creator_id === $actor && $s['submissionHash'] === $row->submission_hash, 409);
        $submission = Protocol::decode($row->submission);
        abort_unless(Protocol::canonical($submission['migration'] ?? []) === Protocol::canonical($s['source']), 409);
        $this->migration->source($actor, $s['source']);
        $cert = $this->keys->certificate($request, Protocol::decode($input['certificate'], 10000));
        Protocol::p256('migration-check', $s, $input['signature'], $cert['signingKey']);
        DB::table('photo_migration_checks')->updateOrInsert(['target_id' => $id], ['account_id' => $actor, 'statement' => $input['statement'], 'signature' => $input['signature'], 'verified_at' => now()]);

        return response()->json(['verified' => true]);
    }

    public function cleanup(Request $request, string $id)
    {
        $actor = $this->actor($request);
        $input = $request->validate(['confirmed' => 'required|accepted']);
        $check = DB::table('photo_migration_checks')->where('target_id', $id)->where('account_id', $actor)->first();
        abort_unless($check, 409);
        if ($check->cleaned_at) {
            return response()->json(['deletion' => 'verified']);
        }$target = $this->objects->active($actor, $id);
        $s = Protocol::decode($check->statement);
        abort_unless($s['submissionHash'] === $target->submission_hash, 409);
        $source = $s['source'];
        if ($source['kind'] === 'local') {
            DB::table('photo_migration_checks')->where('target_id', $id)->update(['cleaned_at' => now()]);

            return response()->json(['deletion' => 'verified']);
        }
        $data = DB::transaction(function () use ($actor, $source) {
            $table = $source['kind'] === 'workspace' ? 'workspace_photos' : 'prototype_photos';
            DB::table($table)->where('id', $source['id'])->lockForUpdate()->first();
            $data = $this->migration->source($actor, $source, true);
            if ($source['kind'] === 'workspace') {
                abort_unless(app(Workspace::class)->grant($actor, $data['row'])['delete'], 403);
                DB::table($table)->where('id', $source['id'])->update(['state' => 'deleted']);
            } else {
                Library::lock($source['libraryId']);
                Retention::revoke($source['libraryId'], $source['id']);
            }

            return $data;
        });
        $ok = $source['kind'] === 'workspace' ? app(Photos::class)->cleanup($data['row']) : Library::cleanup($source['libraryId'], $source['id']);
        if ($ok) {
            DB::table('photo_migration_checks')->where('target_id', $id)->update(['cleaned_at' => now()]);
        }

        return response()->json(['deletion' => $ok ? 'verified' : 'pending'], $ok ? 200 : 202);
    }
}
