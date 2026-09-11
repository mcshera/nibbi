#!/usr/bin/env node
import {readFileSync,writeFileSync,appendFileSync,mkdirSync,mkdtempSync,rmSync,existsSync,realpathSync,readdirSync,statSync} from 'node:fs';
import {join,isAbsolute,dirname,resolve} from 'node:path';
import {tmpdir,homedir} from 'node:os';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {fork} from 'node:child_process';
const SELF=fileURLToPath(import.meta.url), ROOT=resolve(dirname(SELF),'..'), EVAL=join(ROOT,'output/continuity-repair/eval');
const sha=x=>createHash('sha256').update(x).digest('hex');
const redact=x=>String(x).replace(/Bearer\s+[^\s"']+/gi,'Bearer [redacted]').replace(/(?:sk-ant-|sk-)[A-Za-z0-9_-]+/g,'[redacted-key]');
const flags={};for(let i=2;i<process.argv.length;i++){let k=process.argv[i];if(!['--cases','--snapshot','--manifest','--out','--variant','--worker','--anchor','--deadline','--validate-only','--isolation-only','--go-baseline','--go-candidate','--budget-ms'].includes(k))throw Error('Unknown flag '+k);flags[k]=['--validate-only','--isolation-only','--go-baseline','--go-candidate'].includes(k)?true:process.argv[++i];}
for(const k of ['--cases','--snapshot','--manifest','--out'])if(!isAbsolute(flags[k]??''))throw Error(k+' requires absolute path');
const fixture=JSON.parse(readFileSync(flags['--cases'],'utf8')), snapshot=realpathSync(flags['--snapshot']), manifest=JSON.parse(readFileSync(flags['--manifest'],'utf8')), OUT=flags['--out'], variant=flags['--variant'];
if(!['baseline','candidate'].includes(variant))throw Error('Variant required');
if(!OUT.startsWith(EVAL+'/') || OUT.includes('/../'))throw Error('Output must be below eval');
for(const [p,h] of Object.entries(manifest.files))if(sha(readFileSync(join(snapshot,p)))!==h)throw Error('Snapshot mismatch '+p);
const replyCount=fixture.sequences.reduce((n,c)=>n+c.users.length,0);
if(replyCount>8 || fixture.limits.perTurnMs>90000 || fixture.limits.totalMs>480000 || fixture.limits.concurrency>2)throw Error('Budget violation');
if(flags['--validate-only']){console.log(JSON.stringify({validated:true,modelCalls:0,authCalls:0,maximumReplies:replyCount}));process.exit(0);}
const isolation=!!flags['--isolation-only'];
if(!isolation && !flags['--go-'+variant])throw Error('Explicit phase GO required');
if(flags['--worker']===undefined){
 if(existsSync(OUT))throw Error('Fresh output required');mkdirSync(OUT,{recursive:true});
 writeFileSync(join(OUT,'executed-script.mjs'),readFileSync(SELF));writeFileSync(join(OUT,'scenarios.json'),readFileSync(flags['--cases']));
 const budget=Number(flags['--budget-ms']??480000);if(!Number.isFinite(budget)||budget<30000||budget>480000)throw Error('Invalid remaining budget');
 const started=Date.now(), deadline=started+budget, anchor=started, children=[];
 const argv=process.argv.slice(2);
 const jobs=fixture.sequences.map((c,i)=>new Promise(resolveJob=>{
   const child=fork(SELF,[...argv,'--worker',String(i),'--anchor',String(anchor),'--deadline',String(deadline)],{cwd:join(ROOT,'daemon'),stdio:['ignore','pipe','pipe','ipc']});children.push(child);
   child.stdout.on('data',b=>appendFileSync(join(OUT,c.id+'.log'),b));child.stderr.on('data',b=>appendFileSync(join(OUT,c.id+'.log'),b));
   child.on('exit',(code,signal)=>resolveJob({id:c.id,code,signal}));child.on('error',e=>resolveJob({id:c.id,error:redact(e.message)}));
 }));
 const hard=setTimeout(()=>children.forEach(c=>c.kill('SIGTERM')),budget-10000);
 const result=await Promise.all(jobs);clearTimeout(hard);
 const records=fixture.sequences.map(c=>{const p=join(OUT,c.id+'.json');return existsSync(p)?JSON.parse(readFileSync(p)):null;});
 const summary={variant,isolationOnly:isolation,startedAt:new Date(started).toISOString(),durationMs:Date.now()-started,workers:result,actualReplies:records.reduce((n,r)=>n+(r?.turns.length??0),0),cleanupComplete:records.every(r=>r?.cleanup?.complete),status:result.every(r=>r.code===0)&&records.every(r=>r?.status==='completed')?'completed':'failed'};
 writeFileSync(join(OUT,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));process.exit(summary.status==='completed'?0:1);
}
const sequence=fixture.sequences[Number(flags['--worker'])], anchor=Number(flags['--anchor']), deadline=Number(flags['--deadline']);
const TEMP=realpathSync(mkdtempSync(join(tmpdir(),'nibbi-continuity-eval-'))), paths={state:join(TEMP,'state'),vault:join(TEMP,'vault'),work:join(TEMP,'work'),projects:join(TEMP,'projects')};
for(const p of Object.values(paths))mkdirSync(p,{recursive:true});
const cliFolder=join(homedir(),'.claude/projects',paths.vault.replace(/[^a-zA-Z0-9]/g,'-'));if(existsSync(cliFolder))throw Error('Owned CLI folder unexpectedly exists');
Object.assign(process.env,{NODE_ENV:'test',NIBBI_STATE_DIR:paths.state,NIBBI_VAULT_DIR:paths.vault,NIBBI_WORK_DIR:paths.work,NIBBI_PROJECTS_DIR:paths.projects,NIBBI_PORT:'0',NIBBI_GATEWAY_PORT:'0',NIBBI_OWNER:'Alex',NIBBI_CLAUDE_AUTH:'signin'});
const record={variant,id:sequence.id,status:'preparing',isolationOnly:isolation,fixtureRoot:TEMP,anchor:new Date(anchor).toISOString(),turns:[],provenance:[],protectedHashes:{},errors:[],cleanup:{complete:false}};
const save=()=>writeFileSync(join(OUT,sequence.id+'.json'),JSON.stringify(record,null,2));
const event=x=>appendFileSync(join(OUT,sequence.id+'.events.jsonl'),JSON.stringify(x)+'\n');
let closeRuntime,closeTools,shutdown,restore,active,store;let cleanupStarted=false;
function clean(){if(cleanupStarted)return;cleanupStarted=true;try{rmSync(cliFolder,{recursive:true,force:true});rmSync(TEMP,{recursive:true,force:true});record.cleanup={complete:!existsSync(TEMP)&&!existsSync(cliFolder),fixtureRemoved:!existsSync(TEMP),cliFolderRemoved:!existsSync(cliFolder)};}catch(e){record.cleanup={complete:false,error:redact(e.message)};}save();}
process.once('SIGTERM',()=>{record.errors.push('Hard deadline signal');active?.abort();clean();process.exit(2);});
const timer=setTimeout(()=>{record.errors.push('Worker hard deadline');active?.abort();clean();process.exit(2);},Math.max(1,deadline-Date.now()-5000));
function tree(p){const result={};function walk(d){for(const n of readdirSync(d)){const f=join(d,n);if(statSync(f).isDirectory())walk(f);else result[f.slice(p.length)]=sha(readFileSync(f));}}walk(p);return result;}
try{
 for(const name of ['SOUL.md','AGENTS.md']){
   const source=readFileSync('/Users/Matty/NibbiVault/'+name,'utf8'), rendered=source.replaceAll('{{OWNER}}','Alex').replaceAll('Matthew Shera','Alex').replaceAll('Matthew','Alex').replaceAll('Matty','Alex');
   writeFileSync(join(paths.vault,name),rendered);record.protectedHashes[name]={original:sha(source),rendered:sha(rendered)};
 }
 writeFileSync(join(paths.vault,'MEMORY.md'),'# Synthetic project memory\nOwner: Alex. Project: Lantern. No personal memory is included.\n');
 writeFileSync(join(paths.vault,'index.md'),'# Synthetic fixture\nLantern project.\n');
 mkdirSync(join(paths.vault,'plans'));writeFileSync(join(paths.vault,'plans/lantern.md'),fixture.seed.roadmap);
 const repo=join(paths.projects,'lantern');mkdirSync(repo);writeFileSync(join(repo,'README.md'),'# Lantern\nA synthetic card layout project.\n');
 const module=n=>import(join(snapshot,'daemon/dist',n+'.js'));
 const storage=await module('store');store=storage.runtime();closeRuntime=storage.closeRuntime;
 const service=await module('tool-service');closeTools=service.closeToolService;
 const session=await module('session');shutdown=session.shutdownSessions;
 const history=await module('history');
 store.put('config','projects',{lantern:{repo,install:'true',check:'true',settings:{lead:{provider:'claude'},fixer:{provider:'claude'}}}});
 store.put('config','auto',{lantern:{on:false,autoMerge:false,mode:'off',maxConcurrent:1}});
 store.put('config','schedules',[]);
 const iso=ms=>new Date(anchor+ms).toISOString();
 function seedActivity(){for(const f of fixture.seed.activity){const value={...f,game:'lantern',project:'lantern',issue:f.title,branch:'fixture/'+f.id,worktree:join(paths.work,f.id),repo,startedAt:iso(f.startedOffsetMs),endedAt:iso(f.endedOffsetMs),verification:{status:f.verification}};store.put('fixers',f.id,value);store.emit({type:'fixer.'+f.status,runId:f.id,projectId:'lantern',at:anchor+f.endedOffsetMs,payload:{status:f.status,summary:f.summary}});record.provenance.push({kind:'synthetic-activity',record:value});}}
 if(sequence.id==='fresh-retained-history'){
  history.logChat({ts:iso(-14400000),project:'lantern',role:'user',channel:'app',text:fixture.sequences[0].users[0]});history.logChat({ts:iso(-14399000),project:'lantern',role:'oracle',channel:'app',text:'We can leave Lantern there for today.'});seedActivity();
 }else{
  const f=fixture.seed.activity[0];store.put('fixers',f.id,{id:f.id,game:'lantern',project:'lantern',issue:f.title,title:f.title,status:'running',branch:'fixture/preview',worktree:join(paths.work,f.id),startedAt:iso(-15000000),verification:{status:'unverified'}});
 }
 history.logChat({ts:iso(-14500000),project:'other-project',role:'user',channel:'app',text:'For the unrelated project, use violet highlights.'});
 record.provenance.push({kind:'initial-history',rows:store.db.prepare('SELECT * FROM messages').all(),hostClockUnchanged:true,providerTranscriptUntouched:true});
 const before={vault:tree(paths.vault),projects:tree(paths.projects)};
 if(isolation){
   if(sequence.id==='resumed-project'){
    history.logChat({ts:iso(-14400000),project:'lantern',role:'user',channel:'app',text:fixture.sequences[0].users[0]});
    history.logChat({ts:iso(-14399000),project:'lantern',role:'oracle',channel:'app',text:'We can leave Lantern there for today.'});
   }
   const continuityPath=variant==='candidate'?join(snapshot,'daemon/dist/continuity.js'):join(ROOT,'daemon/src/continuity.ts');
   const continuity=await import(continuityPath);
   const captured=continuity.continuitySnapshot('lantern',{},store);
   const recent=await continuity.continuityTools('lantern',store).find(t=>t.name==='recent_chat').call({},new AbortController().signal);
   const vaultScope=continuity.continuitySnapshot(undefined,{},store);
   const search=await continuity.continuityTools('lantern',store).find(t=>t.name==='search_chat').call({query:'highlight'},new AbortController().signal);
   if(!captured.previousUser || !captured.messages.some(m=>m.text.includes('amber')) || !recent.messages.some(m=>m.text.includes('amber')) || !search.messages.some(m=>m.text.includes('amber')) || JSON.stringify([captured,recent,search]).includes('violet') || vaultScope.messages.length)throw Error('Seed continuity visibility/scope check failed');
   record.continuitySeedCheck={sourceSha256:sha(readFileSync(continuityPath)),sourcePath:continuityPath,captured,recent,search,vaultScope,actualAppChannel:'app',sourceNote:variant==='candidate'?'Captured candidate dist continuity module with isolated snapshot RuntimeStore.':'Read-only current continuity module explicitly given isolated baseline RuntimeStore; NOT used in baseline model turns.'};
   const abort=new AbortController();const lease=await service.leaseTools(session.leadTools('lantern',false),abort.signal);
   record.isolationChecks={state:store.directory,toolUrl:lease.url,toolNames:lease.names,dispatchAbsent:!lease.names.includes('dispatch_fixer'),portNot4527:new URL(lease.url).port!=='4527',noServerMainImported:true};
   if(!record.isolationChecks.dispatchAbsent||!record.isolationChecks.portNot4527||store.directory!==paths.state)throw Error('Isolation check failed');await lease.close();record.status='completed';
 }else{
  const require=createRequire(join(ROOT,'daemon/package.json'));const {query}=await import(require.resolve('@anthropic-ai/claude-agent-sdk'));
  const provider=await module('providers/claude'),auth=await module('providers/claude-auth'),registry=await module('providers/index');
  const connection=await auth.prepareClaude();if(connection.mode!=='signin')throw Error('Subscription mode required');connection.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY='1';
  let current;
  const forbidden=name=>/(write|edit|dispatch|steer|bash|execute|save|append|delete|remove)/i.test(name);
  const observed=args=>{
    const actual=query(args);return new Proxy(actual,{get(target,key){
     if(key==='accountInfo')return async(...a)=>{const x=await target.accountInfo(...a);current.account={apiProvider:x.apiProvider,apiKeySource:x.apiKeySource??'none',subscriptionType:x.subscriptionType??null};return x;};
     if(key===Symbol.asyncIterator)return async function*(){for await(const msg of target){
       if(msg.type==='system'&&msg.subtype==='init'){current.initSessionHash=sha(msg.session_id);if(msg.model)current.models.push(msg.model);}
       if(msg.type==='assistant'){if(msg.message?.model)current.models.push(msg.message.model);for(const b of msg.message?.content??[])if(b.type==='tool_use'){const t={name:b.name,input:b.input};current.tools.push(t);event({turn:current.index,kind:'tool-use',...t});if(forbidden(b.name))current.safetyFailures.push('Forbidden tool attempt '+b.name);}}
       if(msg.type==='user')for(const b of msg.message?.content??[])if(b.type==='tool_result')event({turn:current.index,kind:'tool-result',isError:b.is_error??false,content:redact(JSON.stringify(b.content))});
       if(msg.type==='result'){current.modelUsageKeys=Object.keys(msg.modelUsage??{});current.resultSessionHash=sha(msg.session_id);current.terminalSubtype=msg.subtype;current.usage=msg.usage;}
       yield msg;
     }};
     const v=Reflect.get(target,key,target);return typeof v==='function'?v.bind(target):v;
    }});
  };
  restore=registry.replaceProviderForTest('claude',{...provider.claude,start(input){current.requestedModel=input.model??null;current.resumeRequestedHash=input.sessionId?sha(input.sessionId):null;current.promptSha256=sha(input.prompt);current.instructionsSha256=sha(input.instructions);current.leasedTools=input.tools.names;current.toolPort=new URL(input.tools.url).port;current.instructions=input.instructions;if(current.toolPort==='4527')throw Error('Live port forbidden');return provider.startClaude(input,observed,async()=>connection);}});
  record.status='running';save();let prior;
  for(let i=0;i<sequence.users.length;i++){
   if(Date.now()>deadline-30000)throw Error('Total budget; refusing new turn');
   current={index:i,user:sequence.users[i],models:[],tools:[],safetyFailures:[],historyBefore:store.db.prepare('SELECT at,role,project_id FROM messages ORDER BY id DESC LIMIT 8').all(),status:'running'};record.turns.push(current);active=new AbortController();const timeout=setTimeout(()=>active.abort(new Error('85 second turn deadline')),85000);const t=Date.now();
   try{const result=await session.runTurn(sequence.users[i],undefined,'app',undefined,undefined,undefined,undefined,undefined,{project:'lantern',provider:'claude',allowDispatch:false,signal:active.signal});current.output=redact(result.text);current.isError=result.isError;current.status=result.isError?'provider-error':'completed';current.returnedSessionHash=result.sessionId?sha(result.sessionId):null;current.resumeMatched=i===0?current.resumeRequestedHash===null:current.resumeRequestedHash===prior&&current.returnedSessionHash===prior;prior=current.returnedSessionHash;}
   catch(e){current.status='failed';current.error=redact(e.message);throw e;}
   finally{clearTimeout(timeout);current.durationMs=Date.now()-t;current.models=[...new Set(current.models)];current.modelQualifiers=current.models.map(raw=>({raw,contextWindowQualifier:raw==='claude-opus-5[1m]'?'1m':null,allowlisted:['claude-opus-5','claude-opus-5[1m]'].includes(raw)}));event({kind:'turn',...current});save();}
   if(current.isError||!current.models.length||current.models.some(m=>!['claude-opus-5','claude-opus-5[1m]'].includes(m))||!current.resumeMatched)throw Error('Invalid provider/model/resume evidence');
   if(current.safetyFailures.length)throw Error('Safety failure: tool attempt');
   if(JSON.stringify(before)!==JSON.stringify({vault:tree(paths.vault),projects:tree(paths.projects)}))throw Error('Unexpected fixture file mutation');
   if(i===0&&sequence.id==='resumed-project'){
     const rows=store.db.prepare("SELECT id,at,role FROM messages WHERE project_id='lantern' ORDER BY id").all();for(const row of rows){const seeded=iso(-14400000+(row.role==='oracle'?1000:0));store.db.prepare('UPDATE messages SET at=? WHERE id=?').run(seeded,row.id);record.provenance.push({kind:'disposable-app-history-retimestamp',id:row.id,role:row.role,original:row.at,synthetic:seeded,providerTranscriptUntouched:true});}seedActivity();save();
   }
  }
  record.status='completed';
 }
}catch(e){record.status='failed';record.errors.push(redact(e.stack??e.message));}
finally{
 try{active?.abort();await shutdown?.();restore?.();await closeTools?.();closeRuntime?.();}catch(e){record.errors.push('Close: '+redact(e.message));}
 clearTimeout(timer);clean();
}
console.log(JSON.stringify({id:sequence.id,status:record.status,turns:record.turns.length,cleanup:record.cleanup}));process.exit(record.status==='completed'&&record.cleanup.complete?0:1);
