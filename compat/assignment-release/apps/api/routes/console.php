<?php

use Illuminate\Support\Facades\Schedule;

Schedule::command('photobunker:account-maintain')->everyMinute()->withoutOverlapping();
Schedule::command('photobunker:prototype-cleanup')->everyMinute()->withoutOverlapping();

Schedule::command('photobunker:identity-maintain')->everyMinute()->withoutOverlapping();

Schedule::command('photobunker:workspace-maintain')->everyMinute()->withoutOverlapping();

Schedule::command('photobunker:rtc-maintain')->everyTenSeconds()->withoutOverlapping();
