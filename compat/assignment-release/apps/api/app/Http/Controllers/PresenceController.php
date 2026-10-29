<?php

namespace App\Http\Controllers;

use App\Identity\AccountLifecycle;
use App\Identity\Accounts;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Private PhotoBunker presence gateway.
 *
 * Matrix/Tuwunel native presence is deliberately disabled: it cannot enforce
 * the PhotoBunker all/mutual-contacts/nobody policy for Matrix room members.
 * Only coarse, ACL-filtered states ever leave this controller; raw activity
 * and device leases are server-private, and no messaging content is stored.
 */
final class PresenceController extends Controller
{
    private const LEASE_SECONDS = 85;

    private const RECENT_HOURS = 24;

    public function __construct(private readonly Accounts $accounts) {}

    public function privacy(Request $request)
    {
        $me = $this->accounts->current($request);
        $row = DB::table('identity_presence_preferences')->where('account_id', $me->id)->first();

        return response()->json([
            'visibility' => $row?->visibility ?? 'contacts',
            'revision' => (int) ($row?->revision ?? 0),
        ]);
    }

    public function savePrivacy(Request $request)
    {
        $me = $this->accounts->current($request);
        $input = $request->validate([
            'visibility' => 'required|in:all,contacts,nobody',
            'expectedRevision' => 'required|integer|min:0',
            'operationId' => 'required|uuid',
        ]);
        $result = DB::transaction(function () use ($me, $input) {
            DB::table('identity_presence_preferences')->insertOrIgnore([
                'account_id' => $me->id, 'visibility' => 'contacts', 'revision' => 0,
            ]);
            $row = DB::table('identity_presence_preferences')->where('account_id', $me->id)
                ->lockForUpdate()->first();
            if ($row->operation_id === $input['operationId']) {
                abort_unless($row->visibility === $input['visibility'] &&
                    (int) $row->revision === $input['expectedRevision'] + 1, 409);
            } else {
                abort_unless((int) $row->revision === $input['expectedRevision'], 409);
                DB::table('identity_presence_preferences')->where('account_id', $me->id)->update([
                    'visibility' => $input['visibility'],
                    'operation_id' => $input['operationId'],
                    'revision' => $row->revision + 1,
                ]);
            }

            return [
                'visibility' => $input['visibility'],
                'revision' => $input['expectedRevision'] + 1,
            ];
        }, 3);

        return response()->json($result);
    }

    public function pulse(Request $request)
    {
        $me = $this->accounts->current($request);
        $device = $request->attributes->get('identity')->device_id;
        $data = $request->validate([
            'instanceId' => 'required|uuid',
            'sequence' => 'required|integer|min:1|max:2147483647',
            'active' => 'required|boolean',
        ]);
        // Device and session validity were independently checked in
        // IdentityBoundary. Do not accept a device/account ID from the client.
        DB::transaction(function () use ($me, $device, $data): void {
            DB::table('identity_presence_preferences')->insertOrIgnore([
                'account_id' => $me->id, 'visibility' => 'contacts', 'revision' => 0,
            ]);
            $key = ['device_id' => $device, 'instance_id' => $data['instanceId']];
            $inserted = DB::table('identity_presence_leases')->insertOrIgnore($key + [
                'sequence' => $data['sequence'], 'last_pulse_at' => now(),
                'closed_at' => $data['active'] ? null : now(),
            ]);
            $lease = DB::table('identity_presence_leases')->where($key)->lockForUpdate()->first();
            // An inactive first request creates a permanently closed tab lease.
            // Neither a late heartbeat nor an out-of-order request can reopen it.
            if ($inserted && $data['active']) {
                DB::table('identity_presence_preferences')->where('account_id', $me->id)
                    ->update(['last_active_at' => now()]);
            } elseif (! $inserted && $data['sequence'] > $lease->sequence && ! $lease->closed_at) {
                DB::table('identity_presence_leases')->where($key)->update([
                    'sequence' => $data['sequence'], 'last_pulse_at' => now(),
                    'closed_at' => $data['active'] ? null : now(),
                ]);
                if ($data['active']) {
                    DB::table('identity_presence_preferences')->where('account_id', $me->id)
                        ->update(['last_active_at' => now()]);
                }
            }
            // No user activity history or old device IDs survive indefinitely.
            DB::table('identity_presence_leases')->where('device_id', $device)
                ->where('last_pulse_at', '<', now()->subDay())->delete();
        }, 3);

        return response()->json(['accepted' => true]);
    }

    public function show(Request $request, string $handle)
    {
        $viewer = $this->accounts->current($request);
        $other = $this->accounts->byHandle($handle);
        if (! $other || AccountLifecycle::unavailable($other) ||
            $this->accounts->blocked($viewer->id, $other->id)) {
            return response()->json(['state' => 'hidden']);
        }
        $visibility = DB::table('identity_presence_preferences')
            ->where('account_id', $other->id)->value('visibility') ?? 'contacts';
        if ($viewer->id !== $other->id) {
            if ($visibility === 'nobody') {
                return response()->json(['state' => 'hidden']);
            }
            if ($visibility === 'contacts') {
                // Only *mutual* confirmed address-book entries count.
                // Pending and a unilateral "add contact" are insufficient.
                $mutual = DB::table('identity_address_book')->where('account_id', $viewer->id)
                    ->where('contact_id', $other->id)->exists()
                    && DB::table('identity_address_book')->where('account_id', $other->id)
                        ->where('contact_id', $viewer->id)->exists();
                if (! $mutual) {
                    return response()->json(['state' => 'hidden']);
                }
            }
        }
        $online = DB::table('identity_presence_leases as lease')
            ->join('identity_devices as device', 'device.id', '=', 'lease.device_id')
            ->where('device.account_id', $other->id)->whereNull('device.revoked_at')
            ->whereNull('lease.closed_at')
            ->where('lease.last_pulse_at', '>', now()->subSeconds(self::LEASE_SECONDS))
            ->whereExists(function ($q): void {
                $q->selectRaw('1')->from('identity_sessions as session')
                    ->whereColumn('session.device_id', 'device.id')
                    ->where(fn ($q) => $q->whereNull('session.expires_at')
                        ->orWhere('session.expires_at', '>', now()));
            })->exists();
        if ($online) {
            return response()->json(['state' => 'online']);
        }

        $activity = DB::table('identity_presence_preferences')
            ->where('account_id', $other->id)->value('last_active_at');
        $state = ! $activity
            ? 'unknown'
            : (Carbon::parse($activity)->gte(now()->subHours(self::RECENT_HOURS))
                ? 'recent'
                : 'longAgo');

        return response()->json(['state' => $state]);
    }
}
