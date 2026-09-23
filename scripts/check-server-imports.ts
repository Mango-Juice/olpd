/** Compile the actual API import graph, then boot it in native Node ESM (no tsx loader). */
import ts from 'typescript';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const root=process.cwd();
const output=await mkdtemp(path.join(tmpdir(),'olpd-api-smoke-'));
const visited=new Set<string>();
async function compile(file:string):Promise<void>{
 if(visited.has(file))return;visited.add(file);
 const source=await readFile(file,'utf8');
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 const dest=path.join(output,path.relative(root,file).replace(/\.tsx?$/,'.js'));
 await mkdir(path.dirname(dest),{recursive:true});await writeFile(dest,js);
 for(const {fileName:specifier} of ts.preProcessFile(js).importedFiles){
  if(!specifier.startsWith('.'))continue;
  if(!specifier.endsWith('.js'))throw new Error(`Native ESM requires explicit .js imports: ${path.relative(root,file)} → ${specifier}`);
  const base=path.resolve(path.dirname(file),specifier).replace(/\.js$/,'');
  const target=[base+'.ts',base+'.tsx'].find(existsSync);
  if(!target)throw new Error(`Missing runtime module: ${specifier} from ${file}`);
  await compile(target);
 }
}
try{
 await writeFile(path.join(output,'package.json'),JSON.stringify({type:'module'}));
 for(const entry of ['status','interpret','campaign-interpret'])await compile(path.join(root,`api/${entry}.ts`));
 execFileSync(process.execPath,['--input-type=module','-e',`
  import assert from 'node:assert/strict';
  import {EventEmitter} from 'node:events';
  globalThis.fetch=async()=>{throw new Error('Provider calls are forbidden in this smoke check');};
  for(const name of ['status','interpret','campaign-interpret']){
   const {default:handler}=await import('./api/'+name+'.js');
   let body=''; const res=Object.assign(new EventEmitter(),{statusCode:0,setHeader(){},end(value){body=value;}});
   await handler(Object.assign(new EventEmitter(),{method:name==='status'?'GET':'POST',headers:{},body:{},socket:{remoteAddress:'127.0.0.1'}}),res);
   assert.equal(res.statusCode,name==='status'?200:400,name+': '+body);
   assert.doesNotThrow(()=>JSON.parse(body));
  }
 `],{cwd:output,stdio:'pipe',env:{...process.env,AI_ENABLED:'true',TYPESAFE_API_KEY:'',DEEPSEEK_API_KEY:''}});
 console.log(`PASS ${visited.size} native ESM modules; status 200, both input guards 400; no provider calls`);
}finally{await rm(output,{recursive:true,force:true});}
