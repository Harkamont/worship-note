import { pathToFileURL } from 'node:url';
import { resolve,join } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';

// Vinext's Node-to-Web adapter does not pass HTTP disconnects to Request.signal.
// Keep its adapter and native Request semantics, adding only the active HTTP
// request's cancellation signal. The constructor Proxy retains native prototypes
// and static properties; requests outside this async context are unchanged.
const requestSignals=new AsyncLocalStorage();
const NativeRequest=globalThis.Request;
globalThis.Request=new Proxy(NativeRequest,{
  construct(target,args,newTarget){
    const transportSignal=requestSignals.getStore();
    if(!transportSignal)return Reflect.construct(target,args,newTarget);
    const [input,init]=args;
    const source=init??{};
    if(typeof source!=='object'&&typeof source!=='function')return Reflect.construct(target,args,newTarget);
    // RequestInit uses inherited getters (App Router even passes a Request).
    // Forward reads with their original receiver rather than spreading fields.
    // A fresh target also permits overriding a frozen dictionary's signal.
    const forwarded=new Proxy({},{get(_target,key){
      const value=Reflect.get(source,key,source);
      if(key!=='signal')return value;
      const callerSignal=value===undefined&&input instanceof NativeRequest ? input.signal : value;
      return callerSignal==null ? transportSignal : AbortSignal.any([transportSignal,callerSignal]);
    }});
    return Reflect.construct(target,[input,forwarded],newTarget);
  },
});

const app=resolve(process.argv[2]);
const {startProdServer}=await import(pathToFileURL(join(app,'node_modules','vinext','dist','server','prod-server.js')).href);
const port=Number(process.env.CHANYANG_PORT || 3210);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid desktop port');
const authority=`127.0.0.1:${port}`;
const {server}=await startProdServer({host:'127.0.0.1',port,outDir:join(app,'dist'),silent:true});
const listeners=server.listeners('request');server.removeAllListeners('request');
server.on('request',(request,response)=>{
  if(request.headers.host!==authority || (request.headers.origin && request.headers.origin!==`http://${authority}`)) {
    response.writeHead(403,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'});response.end('이 컴퓨터의 앱에서만 사용할 수 있습니다.');request.resume();return;
  }
  const controller=new AbortController();
  const abort=()=>controller.abort();
  const cleanup=()=>{
    request.removeListener('aborted',abort);
    response.removeListener('finish',cleanup);
    response.removeListener('close',close);
  };
  const close=()=>{if(!response.writableEnded)abort();cleanup();};
  request.once('aborted',abort);
  response.once('finish',cleanup);
  response.once('close',close);
  if(request.aborted)abort();
  requestSignals.run(controller.signal,()=>{
    for(const listener of listeners)listener.call(server,request,response);
  });
});
const shutdown=()=>server.close(()=>process.exit(0));
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
console.log(`워십노트: http://${authority}`);
