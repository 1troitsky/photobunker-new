<?php
use Illuminate\Support\Facades\Schedule;
Schedule::command('photobunker:photo-maintain')->everyMinute()->withoutOverlapping();
