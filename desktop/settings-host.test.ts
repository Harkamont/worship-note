import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSettingsHandler } from './settings-host.ts';

const url = 'http://127.0.0.1:3210/api/local-settings';
const request = (data?: unknown, extra: Record<string,string> = {}) => new Request(url, {
  method: data === undefined ? 'GET' : 'POST',
  headers: { host:'127.0.0.1:3210', ...(data === undefined ? {} : {'content-type':'application/json',origin:'http://127.0.0.1:3210'}), ...extra },
  ...(data === undefined ? {} : {body:JSON.stringify(data)}),
});

test('desktop settings preserve blank keys, redact responses, use private storage and update environment', async()=>{
  const directory=await mkdtemp(join(tmpdir(),'score-settings-'));const environment: NodeJS.ProcessEnv={} as NodeJS.ProcessEnv;
  const handle=createSettingsHandler({directory,environment});
  try {
    const initial=await (await handle(request())).json() as {desktop:boolean;keyConfigured:boolean}; assert.equal(initial.desktop,true); assert.equal(initial.keyConfigured,false);
    const response=await handle(request({provider:'openrouter',model:'openai/gpt-6-sol',apiKey:'secret-example-123'})); assert.equal(response.status,200);
    const text=await response.text();assert.ok(!text.includes('secret-example-123'));assert.equal(JSON.parse(text).keyConfigured,true);
    assert.equal(environment.AI_PROVIDER,'openai-compatible');assert.equal(environment.AI_BASE_URL,'https://openrouter.ai/api/v1');assert.equal(environment.AI_API_KEY,'secret-example-123');
    // Windows privacy is controlled by ACLs, not the POSIX bits stat exposes.
    if (process.platform!=='win32') assert.equal((await stat(join(directory,'settings.json'))).mode&0o777,0o600);
    await handle(request({provider:'openrouter',model:'new-model',apiKey:''}));assert.equal(environment.AI_API_KEY,'secret-example-123');assert.equal(environment.AI_MUSICXML_MODEL,'new-model');
    assert.equal(JSON.parse(await readFile(join(directory,'settings.json'),'utf8')).apiKey,'secret-example-123');
    await handle(request({provider:'openai',model:'gpt-6-sol'}));assert.equal(environment.AI_API_KEY,'');
    await handle(request({provider:'openai',model:'gpt-6-sol',apiKey:'different-key'}));
    await handle(request({provider:'openai',model:'gpt-6-sol',clearKey:true}));assert.equal(environment.AI_API_KEY,'');
  } finally { await rm(directory,{recursive:true,force:true}); }
});

test('desktop settings reject hostile host, origin, provider, model, oversized payload and symlink storage',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'score-settings-'));const handle=createSettingsHandler({directory,environment:{} as NodeJS.ProcessEnv});
  try {
    assert.equal((await handle(request(undefined,{host:'evil.example'}))).status,403);
    assert.equal((await handle(request({provider:'openai',model:'ok'},{origin:'https://evil.example'}))).status,403);
    assert.equal((await handle(request({provider:'evil',model:'ok'}))).status,400);
    assert.equal((await handle(request({provider:'openai',model:'bad\nmodel'}))).status,400);
    assert.equal((await handle(request({provider:'openai',model:'ok',apiKey:'x'.repeat(17000)}))).status,413);
    const {symlink}=await import('node:fs/promises');await symlink(join(directory,'elsewhere'),join(directory,'settings.json'));
    assert.equal((await handle(request({provider:'openai',model:'ok'}))).status,500);
  } finally { await rm(directory,{recursive:true,force:true}); }
});
