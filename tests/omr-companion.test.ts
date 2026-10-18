import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const token = 'test-local-omr-token-with-enough-entropy';
const png = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]);
// A .mjs shebang executable cannot be spawned directly on Windows. Exercise
// the same real Python invocation as the companion, using only a fake module.
const pythonExecutable = (() => {
  for (const command of ['python3', 'python']) {
    const result = spawnSync(command, ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  }
  throw new Error('Companion tests require Python 3; CI installs it before running tests.');
})();
async function fakeHomr(root: string, program: string): Promise<string> {
  await mkdir(join(root, 'homr'), { recursive: true });
  await writeFile(join(root, 'homr', '__init__.py'), '');
  await writeFile(join(root, 'homr', 'main.py'), program);
  return pythonExecutable;
}

test('companion refuses missing token and enforces auth, image signature, one job and cleanup', async () => {
  const { createCompanionServer } = await import('../scripts/omr-companion.mjs');
  assert.throws(() => createCompanionServer({ token: '' }), /token/i);
  const root = await mkdtemp(join(tmpdir(), 'omr-test-'));
  const jobsDir = join(root, 'jobs');
  await mkdir(jobsDir);
  const python = await fakeHomr(root, 'from pathlib import Path\nimport sys,time\ntime.sleep(0.12)\nPath(sys.argv[-1]).with_suffix(".musicxml").write_text("<score-partwise/>",encoding="utf-8")\n');
  const server = createCompanionServer({ token, runtimeCheck: async () => true, python, source: root, jobsDir, timeoutMs: 5000 });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/recognize`;
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'image/png' };
  try {
    assert.equal((await fetch(url, { method: 'POST', body: png })).status, 401);
    assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, origin: 'https://evil.example' }, body: png })).status, 403);
    assert.equal((await fetch(url, { method: 'POST', headers, body: 'not png' })).status, 400);
    const first = fetch(url, { method: 'POST', headers, body: png });
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal((await fetch(url, { method: 'POST', headers, body: png })).status, 429);
    const result = await first;
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('access-control-allow-origin'), null);
    assert.match(await result.text(), /score-partwise/);
    assert.deepEqual(await readdir(jobsDir), []);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test('companion kills timed out process, cleans job and releases lock', async () => {
  const { createCompanionServer } = await import('../scripts/omr-companion.mjs');
  const root = await mkdtemp(join(tmpdir(), 'omr-timeout-'));
  const jobsDir = join(root, 'jobs'); await mkdir(jobsDir);
  const python = await fakeHomr(root, 'import time\ntime.sleep(10)\n');
  const server = createCompanionServer({ token, runtimeCheck: async () => true, python, source: root, jobsDir, timeoutMs: 50 });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  try {
    for (let i=0; i<2; i++) {
      const response: Response = await fetch(`http://127.0.0.1:${address.port}/recognize`, { method:'POST', headers:{authorization:`Bearer ${token}`, 'content-type':'image/png'}, body:png });
      assert.equal(response.status, 504);
      assert.deepEqual(await readdir(jobsDir), []);
    }
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await rm(root,{recursive:true,force:true}); }
});

test('companion exposes authenticated text capability and shares the recognition lock with text OCR',async()=>{
  const {createCompanionServer}=await import('../scripts/omr-companion.mjs');
  const root=await mkdtemp(join(tmpdir(),'text-ocr-companion-'));const jobsDir=join(root,'jobs');await mkdir(jobsDir);
  const python=pythonExecutable;
  const payload={version:1,engine:'test',elapsedMs:1,cost:0,image:{width:10,height:10},systems:[],warnings:[]};
  const textOcrScript=join(root,'local-text-ocr.py');await writeFile(textOcrScript,'from pathlib import Path\nimport sys,time\ntime.sleep(0.12)\nPath(sys.argv[-1]).write_text('+JSON.stringify(JSON.stringify(payload))+',encoding="utf-8")\n');
  const visionOcr=pythonExecutable;
  const server=createCompanionServer({token,runtimeCheck:async()=>true,python,source:root,jobsDir,textOcrScript,visionOcr,timeoutMs:5000});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
  const headers={authorization:`Bearer ${token}`,'content-type':'image/png'};
  try{
    assert.equal((await fetch(base+'/capabilities')).status,401);
    const capability=await fetch(base+'/capabilities',{headers:{authorization:`Bearer ${token}`}});assert.equal(capability.status,200);assert.deepEqual(await capability.json(),{version:1,ready:true,capabilities:{recognize:true,textOcr:true}});
    assert.equal((await fetch(base+'/text-ocr',{method:'POST',body:png})).status,401);
    assert.equal((await fetch(base+'/text-ocr',{method:'POST',headers:{...headers,origin:'https://evil.example'},body:png})).status,403);
    assert.equal((await fetch(base+'/text-ocr',{method:'POST',headers,body:'bad'})).status,400);
    const first=fetch(base+'/text-ocr',{method:'POST',headers,body:png});await new Promise(r=>setTimeout(r,30));
    assert.equal((await fetch(base+'/recognize',{method:'POST',headers,body:png})).status,429);
    const response=await first;assert.equal(response.status,200);assert.match(response.headers.get('content-type')||'',/application\/json/);assert.deepEqual(await response.json(),payload);assert.deepEqual(await readdir(jobsDir),[]);
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
});

test('text companion kills timed out process and rejects output above 2MiB without leaving jobs',async()=>{
  const {createCompanionServer}=await import('../scripts/omr-companion.mjs');
  const root=await mkdtemp(join(tmpdir(),'text-ocr-timeout-'));const jobsDir=join(root,'jobs');await mkdir(jobsDir);
  const python=pythonExecutable;const textOcrScript=join(root,'local-text-ocr.py');const visionOcr=pythonExecutable;
  await writeFile(textOcrScript,'import time\ntime.sleep(10)\n');
  const configuration={token,runtimeCheck:async()=>true,python,source:root,jobsDir,textOcrScript,visionOcr,timeoutMs:150};
  const server=createCompanionServer(configuration);
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');const url=`http://127.0.0.1:${address.port}/text-ocr`;
  const headers={authorization:`Bearer ${token}`,'content-type':'image/png'};
  try{
    assert.equal((await fetch(url,{method:'POST',headers,body:png})).status,504);assert.deepEqual(await readdir(jobsDir),[]);
    configuration.timeoutMs=5000;
    await writeFile(textOcrScript,'from pathlib import Path\nimport sys\nPath(sys.argv[-1]).write_bytes(bytes(2*1024*1024+1))\n');
    assert.equal((await fetch(url,{method:'POST',headers,body:png})).status,502);assert.deepEqual(await readdir(jobsDir),[]);
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
});


test('companion rejects a hostile Host and reports missing runtime as unready',async()=>{
  const {createCompanionServer}=await import('../scripts/omr-companion.mjs');
  const server=createCompanionServer({token,runtimeCheck:async()=>false});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();assert.ok(address&&typeof address!=='string');
  try{
    const url=`http://127.0.0.1:${address.port}`;
    const result=await fetch(url+'/capabilities',{headers:{authorization:`Bearer ${token}`}});
    assert.equal(result.status,200);const body=await result.json() as {capabilities:{recognize:boolean};ready:boolean};assert.equal(body.capabilities.recognize,false);assert.equal(body.ready,false);
    assert.equal((await fetch(url+'/recognize',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'image/png'},body:png})).status,503);
    const {get}=await import('node:http');
    const hostileStatus=await new Promise<number>(resolve=>{get(url+'/capabilities',{headers:{authorization:`Bearer ${token}`,host:'evil.example'}},response=>{response.resume();resolve(response.statusCode || 0);});});
    assert.equal(hostileStatus,403);
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('companion shutdown kills its active child and removes the in-flight job',async()=>{
  const {createCompanionServer}=await import('../scripts/omr-companion.mjs');
  const root=await mkdtemp(join(tmpdir(),'omr-shutdown-'));const jobsDir=join(root,'jobs');await mkdir(jobsDir);
  const pidFile=join(root,'child.pid');
  const python=await fakeHomr(root,'from pathlib import Path\nimport os,time\nPath('+JSON.stringify(pidFile)+').write_text(str(os.getpid()),encoding="utf-8")\ntime.sleep(60)\n');
  const server=createCompanionServer({token,python,source:root,jobsDir,runtimeCheck:async()=>true});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
  const pending=fetch(`http://127.0.0.1:${address.port}/recognize`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'image/png'},body:png}).catch(()=>undefined);
  try{
    const {readFile}=await import('node:fs/promises');let pid=0;
    for(let i=0;i<500&&!pid;i++){try{pid=Number(await readFile(pidFile,'utf8'));}catch{await new Promise(resolve=>setTimeout(resolve,10));}}
    assert.ok(pid>0);assert.equal(typeof server.shutdown,'function');await server.shutdown();await pending;
    assert.throws(()=>process.kill(pid,0));assert.deepEqual(await readdir(jobsDir),[]);
  }finally{server.close();await rm(root,{recursive:true,force:true});}
});
