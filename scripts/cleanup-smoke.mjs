// This script only operates on the disposable local database and loopback Workers.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const base='http://localhost:8787',token='agfs_local_test_alice',path=`/cleanup-${Date.now()}/file.txt`;
async function call(route,body,method=body?'POST':'GET') {
 const response=await fetch(`${base}${route}`,{method,headers:{authorization:`Bearer ${token}`,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 assert(response.ok,`${route}: ${await response.clone().text()}`);return response.json();
}
const intent=await call('/api/v1/fs/upload-intents',{path,contentType:'text/plain',size:4});
assert((await fetch(intent.url,{method:'PUT',headers:intent.headers,body:'safe'})).ok);
await call(`/api/v1/fs/uploads/${intent.uploadId}/commit`,{etag:'uploaded'});
const preview=await call('/api/v1/fs/preview',{path});
const folder=path.slice(0,path.lastIndexOf('/'));
await call('/api/v1/fs/delete',{path:folder,recursive:true});
const trash=await call(`/api/v1/recovery?path=${folder}`);
const item=trash.items.find(item=>item.path===folder);assert(item);
await call(`/api/v1/recovery?id=${item.id}`,undefined,'DELETE');
assert.equal((await fetch(preview.url)).status,404);
assert.equal((await call(`/api/v1/recovery?path=${folder}`)).items.length,0);
const abandoned=await call('/api/v1/fs/resumable',{path:`${folder}/abandoned`,size:1,contentType:'text/plain',fingerprint:'cleanup'});
const unused=await call('/api/v1/tokens',{label:'Unused local device'});
assert(/^[a-zA-Z0-9_]+$/.test(abandoned.uploadId)&&/^[a-zA-Z0-9_]+$/.test(unused.record.id));
execFileSync('npx',['--yes','pnpm@10.32.1','--dir','apps/web','exec','wrangler','d1','execute','agfs-db','--local','--env','production','--persist-to','/tmp/agfs-audit-state','--command',`UPDATE uploads SET expires_at=1 WHERE id='${abandoned.uploadId}'; INSERT INTO device_codes(device_code,user_code,owner_id,api_token_id,expires_at) VALUES ('${unused.record.id}','${unused.record.id}','alice','${unused.record.id}',1);`],{stdio:'pipe'});
assert((await fetch(`${base}/cdn-cgi/local/scheduled?cron=17%20*%20*%20*%20*`)).ok);
let cleaned=false;
for(let n=0;n<20;n++) {
 const response=await fetch(`${base}/api/v1/fs/resumable/${abandoned.uploadId}`,{headers:{authorization:`Bearer ${token}`}});
 if(response.status===404){cleaned=true;break;}await new Promise(resolve=>setTimeout(resolve,100));
}
assert(cleaned,'Cron removed expired multipart reservation');
assert.equal((await fetch(`${base}/api/v1/whoami`,{headers:{authorization:`Bearer ${unused.token}`}})).status,401);
console.log('Cleanup checks passed: recursive permanent deletion, R2 collection, expired multipart abort, unused device-token revocation.');
