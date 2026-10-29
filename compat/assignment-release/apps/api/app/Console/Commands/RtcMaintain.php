<?php

namespace App\Console\Commands;

use App\Rtc\Admissions;
use Illuminate\Console\Command;

final class RtcMaintain extends Command
{
    protected $signature = 'photobunker:rtc-maintain';

    protected $description = 'Reconcile RTC admissions and retry participant removal without media logging';

    public function handle(Admissions $rtc): int
    {
        $rtc->maintain();
        $this->line('RTC admissions reconciled.');

        return self::SUCCESS;
    }
}
