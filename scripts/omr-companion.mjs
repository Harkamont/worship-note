import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { accessSync, constants, statSync } from 'node:fs';

const MAX_IMAGE = 10 * 1024 * 1024;
const MAX_XML = 2 * 1024 * 1024;
const workspace = fileURLToPath(new URL('../../', import.meta.url));
const failure = (status) => Object.assign(new Error('OMR request failed'), { status });
const digest = (value) => createHash('sha256').update(value).digest();

function imageExtension(bytes, mime) {
  const png = [137,80,78,71,13,10,26,10].every((byte, index) => bytes[index] === byte);
  const jpeg = bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === 'image/png' && png) return 'png';
  if (mime === 'image/jpeg' && jpeg) return 'jpg';
  throw failure(400);
}

async function readImage(request, signal) {
  if (Number(request.headers['content-length']) > MAX_IMAGE) throw failure(413);
  const chunks = []; let length = 0;
  for await (const chunk of request) {
    if (signal.aborted) throw failure(499);
    length += chunk.length;
    if (length > MAX_IMAGE) throw failure(413);
    chunks.push(chunk);
  }
  if (signal.aborted || !length) throw failure(400);
  return Buffer.concat(chunks, length);
}

function runPython(python, source, args, job, signal, timeoutMs) {
  return new Promise((resolveJob, reject) => {
    const child = spawn(python, args, {
      cwd: job, shell: false, detached: process.platform !== 'win32', stdio: 'ignore',
      env: { PATH: process.env.PATH, HOME: process.env.HOME, SYSTEMROOT: process.env.SYSTEMROOT, WINDIR: process.env.WINDIR, USERPROFILE: process.env.USERPROFILE, LANG: 'en_US.UTF-8', PYTHONPATH: source, TMPDIR: job, TEMP: job, TMP: job, OMP_NUM_THREADS: '1', PYINSTALLER_RESET_ENVIRONMENT: '1' },
    });
    let stopped = 0;
    const stop = (status) => {
      stopped ||= status;
      try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); }
      catch { child.kill('SIGKILL'); }
    };
    const onAbort = () => stop(499);
    const timer = setTimeout(() => stop(504), timeoutMs);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', onAbort); };
    child.once('error', () => { cleanup(); reject(failure(502)); });
    child.once('close', (code) => { cleanup(); if (stopped || code !== 0) reject(failure(stopped || 502)); else resolveJob(); });
  });
}

export async function probeRuntime({python,source,executable,signal}={}) {
  const command=executable || python;
  const script="import pathlib; import cv2, onnxruntime, homr.main; from homr.segmentation.config import segnet_path_onnx; from homr.transformer.configs import default_config; assert all(pathlib.Path(p).is_file() for p in [segnet_path_onnx,default_config.filepaths.encoder_path,default_config.filepaths.decoder_path])";
  return new Promise(resolveProbe=>{
    const child=spawn(command,executable?['--runtime-check']:['-c',script],{stdio:'ignore',shell:false,env:{...process.env,PYTHONPATH:source,PYINSTALLER_RESET_ENVIRONMENT:'1'}});
    const stop=()=>{child.kill('SIGKILL');resolveProbe(false);};
    const timer=setTimeout(stop,90_000);
    signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();
    child.once('error',()=>{clearTimeout(timer);signal?.removeEventListener('abort',stop);resolveProbe(false);});
    child.once('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',stop);resolveProbe(code===0);});
  });
}

export function createCompanionServer(config = {}) {
  const token = config.token?.trim();
  if (!token) throw new Error('OMR_AUTH_TOKEN is required');
  const expected = digest(`Bearer ${token}`);
  const python = resolve(config.python || join(workspace, 'work/homr-runtime/bin/python'));
  const source = resolve(config.source || join(workspace, 'work/homr-source'));
  const executable = config.executable ? resolve(config.executable) : undefined;
  let runtime;const runtimeController=new AbortController();
  const runtimeReady=()=>runtime ||= Promise.resolve().then(()=>config.runtimeCheck ? config.runtimeCheck() : probeRuntime({python,source,executable,signal:runtimeController.signal})).then(Boolean).catch(()=>false);
  const jobsDir = resolve(config.jobsDir || join(workspace, 'work/omr-jobs'));
  const textOcrScript = resolve(config.textOcrScript || join(workspace, 'score-studio/scripts/local-text-ocr.py'));
  const visionOcr = resolve(config.visionOcr || join(workspace, 'score-studio/scripts/vision-ocr'));
  const textOcrAvailable = () => {
    try {
      if (!statSync(textOcrScript).isFile() || !statSync(visionOcr).isFile()) return false;
      accessSync(executable || python, constants.X_OK); accessSync(visionOcr, constants.X_OK);
      return true;
    } catch { return false; }
  };
  let active = false;let shuttingDown=false;let activeController;let activeRequest;let activeDone=Promise.resolve();let finishActive;
  const server = createServer(async (request, response) => {
    const reply = (status, body = 'OMR request failed', contentType = 'application/vnd.recordare.musicxml+xml; charset=utf-8') => {
      if (response.destroyed || response.writableEnded) return;
      response.writeHead(status, { 'content-type': status === 200 ? contentType : 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      response.end(body);
    };
    if(shuttingDown){reply(503);request.resume();return;}
    const address=server.address();
    const expectedHost=address && typeof address==='object' ? `127.0.0.1:${address.port}` : undefined;
    if(request.headers.host!==expectedHost){reply(403);request.resume();return;}
    if (!['/recognize','/text-ocr','/capabilities'].includes(request.url)) { reply(404); request.resume(); return; }
    const capabilities = request.url === '/capabilities';
    const textOcr = request.url === '/text-ocr';
    if (request.method !== (capabilities ? 'GET' : 'POST')) { reply(405); request.resume(); return; }
    if (request.headers.origin) { reply(403); request.resume(); return; }
    if (!timingSafeEqual(expected, digest(request.headers.authorization || ''))) { reply(401); request.resume(); return; }
    const ready=await runtimeReady();
    if (capabilities) { reply(200,JSON.stringify({version:1,ready,capabilities:{recognize:ready,textOcr:ready&&textOcrAvailable()}}),'application/json; charset=utf-8'); request.resume(); return; }
    if (!ready) { reply(503); request.resume(); return; }
    if (textOcr && !textOcrAvailable()) { reply(503); request.resume(); return; }
    if (active) { reply(429); request.resume(); return; }
    active = true;
    const controller = new AbortController();activeController=controller;activeRequest=request;activeDone=new Promise(resolveDone=>{finishActive=resolveDone;});
    const disconnect = () => controller.abort();
    const onClose = () => { if (!response.writableEnded) disconnect(); };
    request.once('aborted', disconnect); response.once('close', onClose);
    const uploadTimer = setTimeout(() => { controller.abort(); request.destroy(); }, 30_000);
    let job;
    try {
      const bytes = await readImage(request, controller.signal);
      clearTimeout(uploadTimer);
      const extension = imageExtension(bytes, (request.headers['content-type'] || '').split(';')[0]);
      await mkdir(jobsDir, { recursive: true, mode: 0o700 });
      job = await mkdtemp(join(jobsDir, 'job-'));
      const input = join(job, `input.${extension}`);
      await writeFile(input, bytes, { mode: 0o600 });
      const output = join(job, textOcr ? 'output.json' : 'input.musicxml');
      const args = executable ? (textOcr ? ['--text-ocr',input,output] : ['--omr',input]) : (textOcr ? [textOcrScript,input,output] : ['-m','homr.main','--no-title',input]);
      await runPython(executable || python, source, args, job, controller.signal, config.timeoutMs || 60_000);
      const info = await stat(output);
      if (!info.isFile() || !info.size || info.size > MAX_XML) throw failure(502);
      const xml = await readFile(output);
      if (xml.length > MAX_XML) throw failure(502);
      await rm(job, { recursive: true, force: true }); job = undefined;
      reply(200, xml, textOcr ? 'application/json; charset=utf-8' : 'application/vnd.recordare.musicxml+xml; charset=utf-8');
    } catch (error) {
      if (job) { await rm(job, { recursive: true, force: true }).catch(() => {}); job = undefined; }
      reply(Number.isInteger(error?.status) ? error.status : 502);
      request.resume();
    } finally {
      clearTimeout(uploadTimer);
      if (job) await rm(job, { recursive: true, force: true }).catch(() => {});
      active = false;activeController=undefined;activeRequest=undefined;finishActive?.();
      request.removeListener('aborted', disconnect); response.removeListener('close', onClose);
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  const shutdown=async()=>{
    shuttingDown=true;
    const closed=new Promise(resolveClosed=>server.close(resolveClosed));
    runtimeController.abort();activeController?.abort();activeRequest?.destroy();
    await activeDone;await closed;
  };
  return Object.assign(server,{shutdown});
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if(process.env.CHANYANG_DESKTOP!=='1') { try { process.loadEnvFile('.env.local'); } catch (error) { if (error.code !== 'ENOENT') throw new Error('Could not read local OMR configuration'); } }
  const server = createCompanionServer({ token: process.env.OMR_AUTH_TOKEN, executable:process.env.OMR_EXECUTABLE, textOcrScript:process.env.OMR_TEXT_SCRIPT, visionOcr:process.env.OMR_VISION_BINARY, python: process.env.OMR_PYTHON, source: process.env.OMR_SOURCE, jobsDir: process.env.OMR_JOBS_DIR });
  const port = Number(process.env.OMR_PORT || 3101);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid OMR_PORT');
  const shutdown=()=>server.shutdown().then(()=>process.exit(0));
  process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
  server.listen(port, '127.0.0.1', () => { process.stdout.write(`Local OMR companion listening on 127.0.0.1:${port}\n`); });
}
