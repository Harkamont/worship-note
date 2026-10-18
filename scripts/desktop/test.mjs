import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const tests=readdirSync('desktop').filter(name=>name.endsWith('.test.ts')).map(name=>`desktop/${name}`);
let result=spawnSync(process.execPath,['--experimental-strip-types','--test',...tests],{stdio:'inherit'});
if(result.error)throw result.error;if(result.status!==0)process.exit(result.status || 1);
result=spawnSync(process.platform==='win32'?'py':'python3',[...(process.platform==='win32'?['-3.12']:[]),'-m','unittest','discover','-s','desktop','-p','test_*.py'],{stdio:'inherit'});
if(result.error)throw result.error;process.exit(result.status ?? 1);
