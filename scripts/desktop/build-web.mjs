import {cp,mkdir,mkdtemp,rm,symlink} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
const project=fileURLToPath(new URL('../../',import.meta.url));
const work=resolve(project,'../work');await mkdir(work,{recursive:true});
const source=await mkdtemp(join(work,'desktop-build-source-'));
// A clean, explicit input list prevents dotenv and developer connector settings
// from entering a desktop build even when Vinext loads dotenv before Vite.
const entries=['app','components','hooks','lib','public','styles','types','desktop','build','scripts','package.json','package-lock.json','tsconfig.json','next-env.d.ts','next.config.ts','vite.config.ts','postcss.config.mjs'];
try{
  for(const entry of entries){const path=join(project,entry);if(existsSync(path))await cp(path,join(source,entry),{recursive:true,filter:p=>!p.includes('__pycache__')&&!p.endsWith('.test.ts')&&!p.endsWith('test_launcher.py')});}
  await symlink(join(project,'node_modules'),join(source,'node_modules'),process.platform==='win32'?'junction':'dir');
  const environment={CHANYANG_DESKTOP:'1',NODE_ENV:'production'};
  for(const key of ['PATH','HOME','USERPROFILE','SYSTEMROOT','WINDIR','TMP','TEMP','LANG'])if(process.env[key])environment[key]=process.env[key];
  await new Promise((done,reject)=>{const child=spawn(process.execPath,[join(project,'node_modules/vinext/dist/cli.js'),'build'],{cwd:source,env:environment,stdio:'inherit'});child.once('error',reject);child.once('close',code=>code===0?done():reject(new Error('Desktop website build failed')));});
  const destination=join(project,'dist','standalone');await mkdir(join(project,'dist'),{recursive:true});await rm(destination,{recursive:true,force:true});await cp(join(source,'dist','standalone'),destination,{recursive:true});
  console.log('Desktop standalone:',destination);
}finally{await rm(source,{recursive:true,force:true});}
