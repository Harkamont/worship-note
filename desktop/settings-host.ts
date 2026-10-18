import { constants } from 'node:fs';
import { open, mkdir, lstat, rename, unlink, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const providers = {
  openrouter: { baseURL:'https://openrouter.ai/api/v1', model:'openai/gpt-6.1-sol' },
  openai: { baseURL:'https://api.openai.com/v1', model:'gpt-6.1-sol' },
  zai: { baseURL:'https://api.z.ai/api/paas/v4', model:'glm-4.6v-flash' },
} as const;
type Provider = keyof typeof providers;
type Settings = { provider:Provider; model:string; apiKey:string };
const limit = 16 * 1024;
export function settingsDirectory() {
  if (process.env.CHANYANG_DATA_DIR) return process.env.CHANYANG_DATA_DIR;
  if (process.platform==='darwin') return join(homedir(),'Library','Application Support','ChanyangScoreStudio');
  if (process.platform==='win32') return join(process.env.LOCALAPPDATA || join(homedir(),'AppData','Local'),'ChanyangScoreStudio');
  return join(process.env.XDG_DATA_HOME || join(homedir(),'.local','share'),'ChanyangScoreStudio');
}
function validProvider(value:unknown): value is Provider { return typeof value==='string' && Object.hasOwn(providers,value); }
function validModel(value:unknown): value is string { return typeof value==='string' && value.length>0 && value.length<=200 && !/[\x00-\x20\x7f]/.test(value); }
function validKey(value:unknown): value is string { return typeof value==='string' && value.length<=4096 && !/[\x00-\x1f\x7f]/.test(value); }
function apply(settings:Settings,environment:NodeJS.ProcessEnv) {
  environment.AI_PROVIDER=settings.provider==='openai'?'openai':'openai-compatible';
  environment.AI_BASE_URL=providers[settings.provider].baseURL;
  environment.AI_API_KEY=settings.apiKey;
  for (const name of ['AI_MODEL','AI_MUSICXML_MODEL','AI_XML_ANNOTATION_MODEL','AI_ANNOTATION_MODEL']) environment[name]=settings.model;
}
async function readSettings(directory:string):Promise<Settings> {
  const path=join(directory,'settings.json');
  try {
    const file=await open(path,constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const info=await file.stat();if(!info.isFile() || info.size>limit) throw new Error('invalid settings');
      const value=JSON.parse(await file.readFile('utf8'));
      if(!validProvider(value.provider)||!validModel(value.model)||!validKey(value.apiKey))throw new Error('invalid settings');
      return {provider:value.provider,model:value.model,apiKey:value.apiKey};
    } finally {await file.close();}
  } catch(error) {
    if((error as NodeJS.ErrnoException).code==='ENOENT')return {provider:'openrouter',model:providers.openrouter.model,apiKey:''};
    throw new Error('저장된 AI 설정을 읽을 수 없습니다.');
  }
}
export function createSettingsHandler({directory=settingsDirectory(),environment=process.env}:{directory?:string;environment?:NodeJS.ProcessEnv}={}) {
  let sequence=Promise.resolve();
  return async function handle(request:Request):Promise<Response> {
    const reply=(status:number,data:unknown)=>Response.json(data,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
    const url=new URL(request.url);const port=environment.CHANYANG_PORT || '3210';const authority=`127.0.0.1:${port}`;
    if(url.protocol!=='http:'||url.host!==authority||request.headers.get('host')!==authority||(request.headers.has('origin')&&request.headers.get('origin')!==`http://${authority}`))return reply(403,{error:'이 컴퓨터의 앱에서만 설정할 수 있습니다.'});
    if(request.method!=='GET'&&request.method!=='POST')return reply(405,{error:'지원하지 않는 요청입니다.'});
    if(request.method==='POST' && (!request.headers.get('content-type')?.startsWith('application/json') || request.headers.get('origin')!==`http://${authority}`))return reply(403,{error:'앱 화면에서 설정을 저장해 주세요.'});
    // Serialise writes so simultaneous saves cannot overwrite a newer key.
    let release!:()=>void;const previous=sequence;sequence=new Promise(resolve=>{release=resolve;});await previous;
    try {
      let settings=await readSettings(directory);
      if(request.method==='POST') {
        if(Number(request.headers.get('content-length'))>limit)return reply(413,{error:'설정 내용이 너무 큽니다.'});
        const reader=request.body?.getReader();const chunks:Uint8Array[]=[];let size=0;
        if(reader){while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>limit){await reader.cancel();return reply(413,{error:'설정 내용이 너무 큽니다.'});}chunks.push(next.value);}}
        let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return reply(400,{error:'설정 내용을 확인해 주세요.'});}
        if(!value||!validProvider(value.provider)||!validModel(value.model)||(value.apiKey!==undefined&&!validKey(value.apiKey))||(value.clearKey!==undefined&&typeof value.clearKey!=='boolean'))return reply(400,{error:'제공자, 모델명, API 키를 확인해 주세요.'});
        settings={provider:value.provider,model:value.model,apiKey:value.clearKey?'':value.apiKey?.trim()||(settings.provider===value.provider?settings.apiKey:'')};
        await mkdir(directory,{recursive:true,mode:0o700});
        const parent=await lstat(directory);if(!parent.isDirectory()||parent.isSymbolicLink())throw new Error('invalid directory');
        await chmod(directory,0o700);
        try{if((await lstat(join(directory,'settings.json'))).isSymbolicLink())throw new Error('invalid file');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
        const temporary=join(directory,`settings-${process.pid}-${crypto.randomUUID()}.tmp`);
        const file=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);
        try{await file.writeFile(JSON.stringify(settings)+'\n');await file.sync();}finally{await file.close();}
        try{await rename(temporary,join(directory,'settings.json'));}finally{await unlink(temporary).catch(()=>{});}
      }
      apply(settings,environment);
      return reply(200,{desktop:true,provider:settings.provider,model:settings.model,baseURL:providers[settings.provider].baseURL,configured:Boolean(settings.apiKey),keyConfigured:Boolean(settings.apiKey)});
    }catch{return reply(500,{error:'AI 설정 파일을 읽거나 저장할 수 없습니다.'});}finally{release();}
  };
}
export const handleLocalSettings=createSettingsHandler();
