<?php

namespace App\Http\Controllers;

use App\Prototype\Collaboration;
use App\Prototype\Library;
use App\Prototype\ProfileRules;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class PrototypeProfileController extends Controller
{
    public function index(Request $request)
    {
        $library = $request->attributes->get('prototype_library');
        $profiles = DB::table('prototype_profiles')->where('library_id', $library)->orWhereIn('space_id', array_column(Collaboration::spaces($library), 'id'))
            ->get()->map(fn ($row) => Collaboration::profileData($row, $library));

        return response()->json(['profiles' => $profiles, 'libraryId' => $library]);
    }

    public function save(Request $request, string $id)
    {
        $data = $request->validate([
            'name' => 'required|string|max:80', 'description' => 'present|nullable|string|max:1000',
            'version' => 'required|integer|min:0', 'rules' => 'required|array', 'archived' => 'required|boolean',
        ]);
        $rules = ProfileRules::validate($data['rules']);
        $library = $request->attributes->get('prototype_library');
        $actor = $library;
        if ($data['version'] > 0) {
            $library = Collaboration::profile($actor, $id)->library_id;
        }
        $profile = DB::transaction(function () use ($library, $actor, $id, $data, $rules): array {
            Library::lock($library);
            $query = DB::table('prototype_profiles')->where('library_id', $library)->where('id', $id);
            $existing = $query->first();
            $access = Collaboration::access($actor, $existing->space_id ?? null);
            abort_unless($access['manageProfiles'], 403);
            abort_unless((int) ($existing->version ?? 0) === $data['version'], 409);
            abort_if(! $existing && DB::table('prototype_profiles')->where('library_id', $library)->count() >= 100, 413);
            $snapshot = ['id' => $id, 'name' => trim($data['name']), 'description' => trim($data['description'] ?? ''),
                'version' => $data['version'] + 1, 'rules' => $rules];
            if ($existing?->space_id) {
                $snapshot['spaceId'] = $existing->space_id;
            }
            $record = ['name' => $snapshot['name'], 'description' => $snapshot['description'], 'version' => $snapshot['version'], 'archived' => $data['archived']];
            if ($existing) {
                $query->update($record);
            } else {
                DB::table('prototype_profiles')->insert(['library_id' => $library, 'id' => $id, ...$record]);
            }
            DB::table('prototype_profile_versions')->insert(['library_id' => $library, 'profile_id' => $id, 'version' => $snapshot['version'], 'snapshot' => json_encode($snapshot)]);

            return [...$snapshot, 'archived' => $data['archived'], 'access' => $access];
        });

        return response()->json(['profile' => $profile]);
    }
}
