<?php
declare(strict_types=1);
namespace App\Console\Commands;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

final class StorageCheck extends Command
{
    protected $signature='photobunker:storage-check {--disk=photo-ciphertext}';
    protected $description='Synthetic encrypted-object PUT/HEAD/GET/DELETE with cleanup; no signed URLs';
    public function handle():int {
        $key='diagnostics/'.Str::uuid();
        $bytes=random_bytes(64);$disk=null;$failure=false;
        try {
            $disk=Storage::disk((string)$this->option('disk'));
            if(!$disk->put($key,$bytes)||!$disk->exists($key)||
                $disk->size($key)!==strlen($bytes)||
                !hash_equals(hash('sha256',$bytes),hash('sha256',$disk->get($key))))
                throw new \RuntimeException('photo.storage_probe_failed');
        }catch(\Throwable){
            // Provider exceptions can contain credential-bearing URLs: never echo them.
            $this->error('Private storage verification failed. Check provider configuration.');
            $failure=true;
        }finally{
            if($disk!==null)try{
                if(!$disk->delete($key)||$disk->exists($key))throw new \RuntimeException('photo.cleanup_failed');
            }catch(\Throwable){
                $this->error('Synthetic object cleanup requires operator attention: '.$key);
                $failure=true;
            }
        }
        if($failure)return self::FAILURE;
        $this->info('Private storage PUT/HEAD/GET/DELETE and cleanup verified. Anonymous access must be checked at Garage endpoint.');
        return self::SUCCESS;
    }
}
