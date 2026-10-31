import {randomBytes} from 'node:crypto'
import {readFileSync,writeFileSync,chmodSync,mkdirSync,existsSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
const root=new URL('../',import.meta.url), paths=['.env','apps/api/.env'].map(p=>new URL(p,root)),sources=paths.map(p=>readFileSync(p,'utf8')),values={}
for(const key of ['RTC_LIVEKIT_KEY','RTC_LIVEKIT_SECRET']){
 const found=sources.map(s=>s.match(new RegExp(`^${key}=(.*)$`,'m'))?.[1]).filter(v=>v!==undefined)
 if(new Set(found).size>1||found.some(v=>!v))throw new Error('RTC environments differ. Restore matching values rather than rotating secrets.')
 values[key]=found[0]??randomBytes(key.endsWith('SECRET')?32:16).toString('hex')
}
for(let i=0;i<paths.length;i++){let s=sources[i];for(const[k,v]of Object.entries(values))if(!new RegExp(`^${k}=`,'m').test(s))s+=`\n${k}=${v}\n`;if(!/^RTC_ENABLED=/m.test(s))s+='\nRTC_ENABLED=true\n';writeFileSync(paths[i],s,{mode:0o600});chmodSync(paths[i],0o600)}
const dir=new URL('infra/rtc/.local/',root);mkdirSync(dir,{recursive:true,mode:0o700})
const file=n=>new URL(n,dir).pathname
const run=args=>execFileSync('openssl',args,{stdio:['ignore','ignore','ignore']})
if(!existsSync(file('server.crt'))){
 run(['req','-x509','-newkey','rsa:3072','-nodes','-days','3650','-subj','/CN=PhotoBunker Local RTC CA','-keyout',file('ca.key'),'-out',file('ca.crt')])
 run(['req','-newkey','rsa:2048','-nodes','-subj','/CN=matrix.photobunker.test','-keyout',file('server.key'),'-out',file('server.csr')])
 writeFileSync(file('extensions.cnf'),'subjectAltName=DNS:matrix.photobunker.test\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n')
 run(['x509','-req','-in',file('server.csr'),'-CA',file('ca.crt'),'-CAkey',file('ca.key'),'-CAcreateserial','-days','825','-extfile',file('extensions.cnf'),'-out',file('server.crt')])
}
for(const name of ['ca.key','server.key'])chmodSync(file(name),0o600)
writeFileSync(file('livekit.yaml'),`port: 7880\nbind_addresses: ["0.0.0.0"]\nrtc:\n  node_ip: 127.0.0.1\n  use_external_ip: false\n  enable_loopback_candidate: true\n  tcp_port: 7881\n  udp_port: 7882\n  stun_servers: []\nkeys:\n  ${values.RTC_LIVEKIT_KEY}: ${values.RTC_LIVEKIT_SECRET}\nroom:\n  auto_create: false\n  empty_timeout: 60\n  departure_timeout: 15\n  max_participants: 16\nlogging:\n  level: error\n  pion_level: error\n`,{mode:0o600});chmodSync(file('livekit.yaml'),0o600)
console.log('Local RTC configuration and private CA prepared. Existing secrets preserved; no secrets printed.')
