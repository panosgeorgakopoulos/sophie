import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as dotenv from 'dotenv';
import { crawlWebsite } from '../lib/ingestion/crawler';
import { canonicalUrl } from '../lib/ingestion/fetch';
import { parseManifest, type SourceManifest } from '../lib/ingestion/manifest';
import { parseDocument } from '../lib/ingestion/parsers';
import { publishSource, quarantineSource, withdrawSource, reconcileSources, type PublisherDependencies } from '../lib/ingestion/publisher';
import type { DocumentFormat, SourceInput } from '../lib/ingestion/types';
import { mapUrlToSection } from '../lib/sectionMapping';

dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ quiet: true });
const DEFAULT_SITEMAP = 'https://www.ifg.gr/sitemap_index.xml';
interface Stats { parsed:number;published:number;unchanged:number;withdrawn:number;failures:{source:string;reason:string}[];dryRun:boolean }
function positive(value: string | undefined, fallback:number):number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed<1 || parsed>50000) throw new Error('Limits must be integers from 1 to 50000');
  return parsed;
}
async function inventory(directory:string):Promise<string[]> {
  const result:string[]=[];
  const walk=async(folder:string)=>{
    for (const entry of await fs.readdir(folder,{withFileTypes:true})) {
      const file=path.join(folder,entry.name);
      if (entry.isSymbolicLink()) throw new Error('Dataset symbolic links are forbidden');
      if (entry.isDirectory()) await walk(file);
      else if (/\.(pdf|docx|xlsx|md)$/i.test(entry.name)) result.push(path.relative(directory,file));
    }
  };
  await walk(directory);
  return result;
}
export async function main(args=process.argv.slice(2)):Promise<number> {
  const flags=new Map(args.filter((arg)=>arg.startsWith('--')).map((arg)=>{const [key,...value]=arg.slice(2).split('=');return [key,value.join('=')||'true'];}));
  const permitted=new Set(['write','reconcile','limit','max-depth','scope','manifest']);
  for(const key of flags.keys())if(!permitted.has(key))throw new Error(`Unknown argument --${key}`);
  const positional=args.filter((arg)=>!arg.startsWith('--'));
  const directory=path.resolve(positional[0]||'datasets');
  const sitemap=canonicalUrl(positional[1]||DEFAULT_SITEMAP);
  const scope=flags.get('scope')||'all';
  if(!['web','local','all'].includes(scope))throw new Error('scope must be web, local or all');
  const maxPages=positive(flags.get('limit'),5000);
  const maxDepth=positive(flags.get('max-depth'),12);
  const write=flags.get('write')==='true';
  if(flags.has('reconcile')&&!write)throw new Error('Reconciliation requires --write');
  const stats:Stats={parsed:0,published:0,unchanged:0,withdrawn:0,failures:[],dryRun:!write};
  let deps:PublisherDependencies|undefined;
  let runId:string|undefined;
  if(write){
    const [{pool},{embedText,EMBEDDING_PROFILE}]=await Promise.all([import('../lib/db'),import('../lib/gemini')]);
    deps={pool,embed:embedText,embeddingProfile:EMBEDDING_PROFILE,concurrency:2};
    runId=(await pool.query<{id:string}>('INSERT INTO ingestion_runs(scope) VALUES($1) RETURNING id',[scope])).rows[0].id;
  }
  const fail=async(source:string,reason:string)=>{
    stats.failures.push({source,reason:reason.slice(0,1000)});
    if(deps&&runId)await quarantineSource(source,reason,runId,deps.pool);
  };
  const processSource=async(input:SourceInput)=>{
    stats.parsed++;
    if(input.document.issues.length)throw new Error(input.document.issues.join('; '));
    if(deps&&runId){
      const result=await publishSource(input,runId,deps);
      if(result.changed)stats.published++;else stats.unchanged++;
    }
  };
  let manifest:SourceManifest={version:1,files:{},requiredUrls:[]};
  let localComplete=true;
  let webComplete=true;
  try {
    const manifestPath=path.resolve(flags.get('manifest')||path.join(directory,'ingestion-manifest.json'));
    try{manifest=parseManifest(JSON.parse(await fs.readFile(manifestPath,'utf8')));}
    catch(error){
      if(scope!=='web'){localComplete=false;await fail('local:manifest',error instanceof Error?error.message:'Invalid source manifest');}
      else if(flags.has('manifest'))throw error;
    }
    if(scope!=='web'&&localComplete){
      const actual=await inventory(directory);
      for(const relative of actual)if(!manifest.files[relative]){localComplete=false;await fail(`local:${relative}`,'Local source lacks explicit category/language/department/audience/validity manifest');}
      for(const [relative,policy] of Object.entries(manifest.files)){
        const key=`local:${relative}`;
        try{
          const file=path.resolve(directory,relative);
          if(!file.startsWith(`${directory}${path.sep}`)||relative.includes('\\'))throw new Error('Manifest path escapes dataset directory');
          const real=await fs.realpath(file);
          if(real!==file)throw new Error('Symbolic link source forbidden');
          const stat=await fs.stat(file);
          if(!stat.isFile()||stat.size>20*1024*1024)throw new Error('Source type/size invalid');
          const format=path.extname(file).slice(1).toLowerCase() as DocumentFormat;
          if(!['pdf','docx','xlsx','md'].includes(format))throw new Error('Unsupported source format');
          const document=await parseDocument(await fs.readFile(file),format,{title:path.basename(file)});
          await processSource({canonicalKey:key,sourceName:relative,sourceType:format,policy,document});
        }catch(error){localComplete=false;await fail(key,error instanceof Error?error.message:'Local source failed');}
      }
    }
    if(scope!=='local'){
      const report=await crawlWebsite({sitemap,maxPages,maxDepth,requiredUrls:manifest.requiredUrls,
        onDocument:async(entry,response,html)=>{
          const key=canonicalUrl(response.url);
          const document=html??await parseDocument(response.body,'pdf',{title:new URL(key).pathname.split('/').pop()||key});
          const section=mapUrlToSection(key)||(entry.parentUrl?mapUrlToSection(entry.parentUrl):undefined);
          // Unmapped pages stay pending/private; operators must assign their policy before review.
          const input:SourceInput={canonicalKey:key,sourceName:key,sourceType:html?'website':'pdf',document,
            policy:{sections:section?[section]:[],language:document.language==='fr'?'fr':document.language==='el'?'el':new URL(key).pathname.startsWith('/fr/')?'fr':'mul',
              departmentId:section||'unclassified',audience:'public',authority:50,effectiveFrom:null,expiresAt:null},
            metadata:{parent_url:entry.parentUrl,source_lastmod:entry.lastmod,page_title:document.title}};
          if(!section)input.policy.audience='private';
          await processSource(input);
          // A canonical redirect withdraws its former identity; immutable history remains.
          if(entry.url!==key&&deps&&runId)await withdrawSource(entry.url,`Canonical redirect to ${key}`,runId,deps.pool);
        },
        onWithdrawal:async(url,reason)=>{if(deps&&runId)await withdrawSource(url,reason,runId,deps.pool);stats.withdrawn++;},
      });
      webComplete=report.complete;
      for(const error of report.failures)await fail(error.url,error.reason);
    }
    if(flags.has('reconcile')&&deps&&runId){
      if(scope!=='web'&&localComplete)stats.withdrawn+=await reconcileSources(runId,'local',true,deps.pool);
      if(scope!=='local'&&webComplete)stats.withdrawn+=await reconcileSources(runId,'web',true,deps.pool);
    }
    const complete=localComplete&&webComplete&&!stats.failures.length;
    if(deps&&runId)await deps.pool.query('UPDATE ingestion_runs SET status=$2,finished_at=now(),stats=$3 WHERE id=$1',[runId,complete?'complete':'partial',stats]);
    console.log(JSON.stringify({event:complete?'ingestion_complete':'ingestion_partial',runId,...stats}));
    return complete?0:1;
  }catch(error){
    if(deps&&runId)await deps.pool.query("UPDATE ingestion_runs SET status='failed',finished_at=now(),stats=$2 WHERE id=$1",[runId,{...stats,error:error instanceof Error?error.message:'Run failed'}]);
    throw error;
  }finally{if(deps)await (deps.pool as import('pg').Pool).end();}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  main().then((code)=>{process.exitCode=code;}).catch((error:unknown)=>{console.error(JSON.stringify({event:'ingestion_failed',reason:error instanceof Error?error.message:'Unknown error'}));process.exitCode=1;});
}
