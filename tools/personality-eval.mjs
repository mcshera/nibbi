#!/usr/bin/env node
// Run from the daemon environment: node --import tsx <repo>/tools/personality-eval.mjs --help
// Real provider observations only. No grading, reference answers, or installation.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, realpathSync, lstatSync } from 'node:fs';
import { join, dirname, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir, homedir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const SCRIPT = fileURLToPath(import.meta.url);
const ROOT = realpathSync(resolve(dirname(SCRIPT),'..'));
const REVIEW = realpathSync(join(ROOT,'output/personality-review'));
const sha = s => createHash('sha256').update(s).digest('hex');
const usage = 'Usage (from daemon): node --import tsx <repo>/tools/personality-eval.mjs --snapshots ABS_DIR --cases ABS_FILE --out ABS_FRESH_DIR --variants candidate|baseline|both [--validate-only]\nCases JSON must contain only [{id, context, users:[...]}]. Maximum 32 actual turns. No provider call or output creation with --validate-only.';
function argumentsFor(argv) {
  const result={};
  for(let i=0;i<argv.length;i++) {
    const key=argv[i];
    if(key==='--help') { console.log(usage);process.exit(0); }
    if(!['--snapshots','--cases','--out','--variants','--validate-only'].includes(key))throw new Error('Unknown argument: '+key);
    if(key in result)throw new Error('Duplicate argument: '+key);
    if(key==='--validate-only'){result[key]=true;continue;}
    const value=argv[++i];if(!value || value.startsWith('--'))throw new Error('Missing value: '+key);
    result[key]=value;
  }
  for(const key of ['--snapshots','--cases','--out','--variants'])if(!result[key])throw new Error('Required argument: '+key);
  for(const key of ['--snapshots','--cases','--out'])if(!isAbsolute(result[key]))throw new Error(key+' must use an absolute path');
  if(!['candidate','baseline','both'].includes(result['--variants']))throw new Error('--variants must be candidate, baseline, or both');
  return result;
}
const pathExists = path => {try{lstatSync(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
function requireFreshOutput(path) {
  const rel=relative(REVIEW,path);
  if(!rel || rel==='..' || rel.startsWith('..'+sep) || isAbsolute(rel))throw new Error('--out must be strictly below repository output/personality-review');
  if(pathExists(path))throw new Error('--out already exists; a fresh directory is required');
  let ancestor=dirname(path);
  while(!pathExists(ancestor))ancestor=dirname(ancestor);
  const canonical=realpathSync(ancestor), ancestorRel=relative(REVIEW,canonical);
  if(ancestorRel==='..' || ancestorRel.startsWith('..'+sep) || isAbsolute(ancestorRel))throw new Error('--out parent symlink escapes repository output/personality-review');
}
let args, SNAP, OUT, CASEFILE, variants, cases, caseBytes, snapshots, expected;
try {
  args=argumentsFor(process.argv.slice(2));
  SNAP=realpathSync(args['--snapshots']);CASEFILE=realpathSync(args['--cases']);OUT=resolve(args['--out']);
  requireFreshOutput(OUT);
  variants=args['--variants']==='both'?['baseline','candidate']:[args['--variants']];
  caseBytes=readFileSync(CASEFILE);
  cases=JSON.parse(caseBytes.toString('utf8'));
  if(!Array.isArray(cases) || !cases.length)throw new Error('Cases must be a nonempty JSON array');
  const ids=new Set();
  for(const c of cases) {
    if(!c || typeof c!=='object' || Array.isArray(c) || Object.keys(c).sort().join(',')!=='context,id,users')throw new Error('Each case must contain exactly id, context, users; reference/rubric fields are forbidden');
    if(typeof c.id!=='string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(c.id) || ids.has(c.id))throw new Error('Each case needs a unique safe lowercase id');
    ids.add(c.id);
    if(typeof c.context!=='string' || c.context.length>20000)throw new Error('Case context must be a string of at most 20000 characters');
    if(!Array.isArray(c.users) || !c.users.length || c.users.some(u=>typeof u!=='string' || !u.trim() || u.length>20000))throw new Error('Case users must be nonempty strings of at most 20000 characters');
  }
  expected={cases:cases.length*variants.length,turns:cases.reduce((n,c)=>n+c.users.length,0)*variants.length,resumes:cases.reduce((n,c)=>n+c.users.length-1,0)*variants.length};
  if(expected.turns>32)throw new Error('Maximum 32 actual turns across all variants; requested '+expected.turns);
  snapshots={};
  for(const variant of variants) {
    snapshots[variant]={};
    for(const name of ['SOUL.md','AGENTS.md'])snapshots[variant][name]=readFileSync(join(SNAP,variant+'-'+name),'utf8');
  }
} catch(e) {console.error('Argument validation failed: '+e.message+'\n'+usage);process.exit(2);}
if(args['--validate-only']) {
  console.log(JSON.stringify({status:'validated',variants,expected,maxActualTurns:32,concurrency:2,perTurnTimeoutMs:85000,totalBudgetMs:570000,hardDeadlineMs:595000,providerCalls:0,outputCreated:false,out:OUT}));
  process.exit(0);
}
// Validate without touching auth/runtime, then atomically claim a fresh output.
mkdirSync(dirname(OUT),{recursive:true});requireFreshOutput(OUT);mkdirSync(OUT);
const executionScript=readFileSync(SCRIPT,'utf8');
writeFileSync(join(OUT,'executed-script.mjs'),executionScript,{flag:'wx'});
writeFileSync(join(OUT,'cases.json'),caseBytes,{flag:'wx'});
const started = Date.now();
const TEMP = realpathSync(mkdtempSync(join(tmpdir(), 'nibbi-personality-eval-')));
const paths = { state: join(TEMP,'state'), vault: join(TEMP,'prompt-vault'), work: join(TEMP,'work'), projects: join(TEMP,'projects'), skills: join(TEMP,'empty-skills') };
for (const p of Object.values(paths)) mkdirSync(p, { recursive: true });
// Set isolation BEFORE importing any project module, including the frozen config.
Object.assign(process.env, { NIBBI_STATE_DIR:paths.state, NIBBI_VAULT_DIR:paths.vault, NIBBI_WORK_DIR:paths.work, NIBBI_PROJECTS_DIR:paths.projects, NIBBI_OWNER:'Alex', NIBBI_CLAUDE_AUTH:'signin', NIBBI_CLAUDE_BIN:join(homedir(),'.local/bin/claude') });
const redact = value => String(value).replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[redacted-address]').replace(/(?:sk-ant-|sk-)[A-Za-z0-9_-]+/g,'[redacted-key]').replace(/Bearer\s+[^\s"']+/gi,'Bearer [redacted]').replace(/((?:access_token|refresh_token|session_token|api_key|password)\s*[=:]\s*)[^\s,"}]+/gi,'$1[redacted]');
const report = { status:'preparing', startedAt:new Date(started).toISOString(), requestedModel:'sonnet', resolvedModels:[], totalBudgetMs:570000, perTurnTimeoutMs:85000, concurrency:2, owner:'Alex (synthetic)', provider:'Nibbi startClaude using real Claude Agent SDK query', auth:{ mode:'signin', apiFallback:false, preparationCount:0 }, policy:'Shared leadExecutionPolicy(undefined, claude, []), as used by session.ts with actual lease names; lead adapter policy; empty governed tool lease; empty skills; settingSources=[]', isolation:{ temporaryRoot:TEMP, privateNibbiStateRead:false, realMemoriesRead:false, fixtureOnly:true, claudeAutoMemoryDisabled:true, note:'Official CLI sign-in stays in its normal credential store. New CLI resume transcripts use unique temporary cwd project folders and are deleted after completion.' }, cases:[], errors:[], cleanup:{ complete:false }, promptHashes:{} };
const save = () => writeFileSync(join(OUT,'results.json'), JSON.stringify(report,null,2)+'\n');
const event = value => appendFileSync(join(OUT,'events.jsonl'),JSON.stringify(value)+'\n');
writeFileSync(join(OUT,'events.jsonl'),''); save();
const totalAbort = new AbortController();
const totalTimer = setTimeout(() => totalAbort.abort(new Error('570-second total budget reached')),570000);
let closeRuntime, closeToolService;
let normalCleanupStarted=false, governedToolsClosed=false;
const activeHandles = new Set(), cliProjectFolders = new Set();
const hardTimer = setTimeout(() => { report.errors.push('Hard 595-second process deadline; emergency cleanup'); finishCleanup(); report.status='failed'; save(); process.exit(2); },595000);
function finishCleanup() {
  const errors=[];
  for(const p of cliProjectFolders) { try { rmSync(p,{recursive:true,force:true}); } catch(e) { errors.push(redact(e.message)); } }
  try { rmSync(TEMP,{recursive:true,force:true}); } catch(e) { errors.push(redact(e.message)); }
  report.cleanup = { complete:!existsSync(TEMP) && ![...cliProjectFolders].some(existsSync) && !errors.length, temporaryVaultAndStateRemoved:!existsSync(TEMP), ownedCliProjectFoldersRemoved:[...cliProjectFolders].every(p=>!existsSync(p)), completionPath:normalCleanupStarted?'normal-finally':'hard-deadline', governedToolsClosed, errors, installedChangesByRunner:false, credentialMutationByRunner:false, officialCliCredentialBookkeeping:'not independently inspected' };
}
try {
  const require = createRequire(join(ROOT,'daemon/package.json'));
  const { query } = await import(require.resolve('@anthropic-ai/claude-agent-sdk'));
  const { startClaude } = await import(join(ROOT,'daemon/src/providers/claude.ts'));
  const { prepareClaude } = await import(join(ROOT,'daemon/src/providers/claude-auth.ts'));
  const toolService = await import(join(ROOT,'daemon/src/tool-service.ts'));
  closeToolService = toolService.closeToolService;
  const vault = await import(join(ROOT,'daemon/src/vault.ts'));
  ({ closeRuntime } = await import(join(ROOT,'daemon/src/store.ts')));
  report.selection=cases.map(c=>c.id);
  report.variants=variants;report.expected=expected;report.actualTurnsStarted=0;
  report.executionScriptSha256=sha(executionScript);report.executionScriptSnapshot='executed-script.mjs';
  report.inputSha256={cases:sha(caseBytes)};
  const instructions={};
  const { leadExecutionPolicy } = await import(join(ROOT,'daemon/src/lead-instructions.ts'));
  const executionPolicy='\n\n'+leadExecutionPolicy(undefined,'claude',[]);
  report.executionPolicySha256=sha(executionPolicy);
  report.executionPolicySourceSha256=sha(readFileSync(join(ROOT,'daemon/src/lead-instructions.ts')));
  for(const variant of variants) {
    report.promptHashes[variant]={};
    for(const name of ['SOUL.md','AGENTS.md']) {
      const original=snapshots[variant][name];
      const rendered=original.replaceAll('{{OWNER}}','Alex');
      writeFileSync(join(paths.vault,name),rendered);
      writeFileSync(join(OUT,variant+'-'+name),rendered);
      report.promptHashes[variant][name]={snapshotSha256:sha(original),renderedSha256:sha(rendered)};
    }
    instructions[variant]=vault.buildSystemPrompt()+executionPolicy;
    report.promptHashes[variant].systemSha256=sha(instructions[variant]);
    writeFileSync(join(OUT,variant+'-system-prompt.txt'),instructions[variant]);
  }
  const connection = await prepareClaude(); report.auth.preparationCount++;
  if(connection.mode!=='signin') throw new Error('Refusing non-subscription connection');
  connection.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY='1';
  report.auth.prepared=true;
  report.status='running';save();
  const jobs = cases.flatMap(c=>variants.map(variant=>({variant,c})));
  let cursor=0;
  async function runCase({variant,c}) {
    const cwd=join(TEMP,variant,c.id); mkdirSync(cwd,{recursive:true});
    for(const name of ['SOUL.md','AGENTS.md']) writeFileSync(join(cwd,name),readFileSync(join(OUT,variant+'-'+name)));
    const cliFolder=join(homedir(),'.claude/projects',cwd.replace(/[^a-zA-Z0-9]/g,'-'));
    // This exact unique path cannot contain pre-existing owner sessions.
    if(existsSync(cliFolder)) throw new Error('Unexpected existing CLI fixture folder');
    cliProjectFolders.add(cliFolder);
    const record={variant,id:c.id,context:c.context,turns:[],status:'running'};report.cases.push(record);save();
    let sessionId;
    for(let i=0;i<c.users.length;i++) {
      if(totalAbort.signal.aborted) { record.status='budget-exhausted';break; }
      const userMessage=c.users[i];
      const prompt=i===0 ? 'SUPPLIED SYNTHETIC FIXTURE FACTS (not real personal data):\nThe owner in this fictional conversation is Alex. No real memories or action tools are available.\n'+c.context+'\nEND FIXTURE FACTS\n\nUSER TURN:\n'+userMessage : userMessage;
      const t0=Date.now();
      const turn={index:i+1,user:userMessage,prompt,promptSha256:sha(prompt),systemPromptSha256:sha(instructions[variant]),requestedModel:'sonnet',resolvedModels:[],resumeRequestedSha256:sessionId?sha(sessionId):null,subscriptionChecks:[],toolEvents:[],providerErrors:[],status:'running'};
      record.turns.push(turn);save();
      const abort=new AbortController();const forward=()=>abort.abort(totalAbort.signal.reason);
      totalAbort.signal.addEventListener('abort',forward,{once:true});
      const timer=setTimeout(()=>abort.abort(new Error('85-second per-turn timeout')),85000);
      let lease,handle;
      try {
        lease=await toolService.leaseTools([],abort.signal);
        // Transparent observation around the real implementation. Policy, prompt,
        // auth options, and model behavior remain owned by the production adapter.
        const observedQuery = args => {
          if(report.actualTurnsStarted>=32)throw new Error('Maximum 32 actual turns reached');
          report.actualTurnsStarted++;
          const actual=query(args);
          return new Proxy(actual,{get(target,key) {
            if(key==='accountInfo') return async(...a)=> { try { const account=await target.accountInfo(...a); turn.subscriptionChecks.push({apiProvider:account.apiProvider,apiKeySource:account.apiKeySource??'none',subscriptionType:account.subscriptionType??null}); return account; } catch(e) { turn.providerErrors.push('Account check: '+redact(e.message));throw e; } };
            if(key===Symbol.asyncIterator) return async function*() { for await(const message of target) {
              if(message.type==='system' && message.subtype==='init') { turn.initSessionSha256=sha(message.session_id);if(message.model) turn.resolvedModels.push(message.model); }
              if(message.type==='assistant') {
                if(message.message?.model) turn.resolvedModels.push(message.message.model);
                for(const b of message.message?.content??[]) if(b.type==='tool_use') turn.toolEvents.push({source:'assistant',name:b.name,idSha256:sha(b.id)});
              }
              if(message.type==='user') for(const b of message.message?.content??[]) if(b.type==='tool_result') turn.toolEvents.push({source:'tool-result',isError:b.is_error??false,toolUseIdSha256:sha(b.tool_use_id),content:redact(typeof b.content==='string'?b.content:JSON.stringify(b.content))});
              if(message.type==='result') { turn.terminalSubtype=message.subtype;turn.resultSessionSha256=sha(message.session_id);turn.usage=message.usage;turn.modelUsageKeys=Object.keys(message.modelUsage??{});if(message.errors) turn.providerErrors.push(...message.errors.map(redact)); }
              yield message;
            } };
            const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
          }});
        };
        handle=startClaude({runId:'personality-eval-'+randomUUID(),role:'lead',provider:'claude',model:'sonnet',cwd,prompt,instructions:instructions[variant],skills:[],nativeSkills:{root:paths.skills,paths:[]},tools:lease,sessionId,signal:abort.signal,onEvent:(type,payload)=>{if(type==='tool.started')turn.toolEvents.push({source:'adapter',name:payload.name});}},observedQuery,async()=>connection);
        activeHandles.add(handle);
        const result=await handle.result;
        turn.output=redact(result.text);turn.isError=result.isError;turn.ctxTokens=result.ctxTokens;
        turn.status=result.isError?'provider-error':'completed';
        turn.resumeMatched=i===0?null:Boolean(sessionId && result.sessionId===sessionId && turn.initSessionSha256===sha(sessionId));
        if(!result.isError && result.sessionId) sessionId=result.sessionId;
        else throw new Error('Provider did not return a successful resumable session');
      } catch(e) {turn.status=abort.signal.aborted?'timeout':'failed';turn.error=redact(e.message);record.status='failed';}
      finally {
        clearTimeout(timer);totalAbort.signal.removeEventListener('abort',forward);
        if(handle){await handle.cancel().catch(e=>turn.providerErrors.push('Cancel: '+redact(e.message)));activeHandles.delete(handle);}
        await lease?.close();
        turn.durationMs=Date.now()-t0;turn.resolvedModels=[...new Set(turn.resolvedModels)];
        if(!turn.resolvedModels.length)turn.resolvedModel='unknown';
        report.resolvedModels=[...new Set([...report.resolvedModels,...turn.resolvedModels])];
        event({variant,caseId:c.id,...turn});save();
      }
      if(turn.status!=='completed')break;
    }
    if(record.status==='running')record.status=record.turns.length===c.users.length && record.turns.every(t=>t.status==='completed')?'completed':'incomplete';
    save();
  }
  await Promise.all([0,1].map(async()=>{while(cursor<jobs.length && !totalAbort.signal.aborted){const job=jobs[cursor++];await runCase(job);}}));
  const turns=report.cases.flatMap(c=>c.turns);
  report.summary={expectedCases:expected.cases,expectedTurns:expected.turns,expectedResumedTurns:expected.resumes,actualTurnsStarted:report.actualTurnsStarted,completedCases:report.cases.filter(c=>c.status==='completed').length,completedTurns:turns.filter(t=>t.status==='completed').length,resumedTurns:turns.filter(t=>t.resumeRequestedSha256).length,resumeMatches:turns.filter(t=>t.resumeMatched).length,toolEventCount:turns.reduce((n,t)=>n+t.toolEvents.length,0),accountChecks:turns.reduce((n,t)=>n+t.subscriptionChecks.length,0)};
  report.status=report.summary.completedCases===expected.cases && report.summary.completedTurns===expected.turns && report.summary.resumeMatches===expected.resumes?'completed':'failed';
} catch(e) { report.status='blocked';report.errors.push(redact(e.message)); }
finally {
  normalCleanupStarted=true;
  clearTimeout(totalTimer);
  await Promise.allSettled([...activeHandles].map(h=>h.cancel()));
  try {await closeToolService?.();governedToolsClosed=true;} catch(e){report.errors.push('Tool cleanup: '+redact(e.message));}
  try {closeRuntime?.();} catch(e){report.errors.push('Runtime cleanup: '+redact(e.message));}
  finishCleanup();
  report.endedAt=new Date().toISOString();report.durationMs=Date.now()-started;
  if(!report.cleanup.complete)report.status='failed';
  save();
  writeFileSync(join(OUT,'README.md'),'# Live personality comparison\n\nStatus: '+report.status+'\n\nReal Nibbi Claude adapter; requested alias `sonnet`; observed models: '+(report.resolvedModels.join(', ')||'unknown')+'.\n\n'+JSON.stringify(report.summary??{},null,2)+'\n\nSee `results.json` for exact prompts, outputs, errors, model observations, hashed session resume evidence, timing, and cleanup. `events.jsonl` is the per-turn record. The variant system prompt files are the exact generated prompts. No referenceReply, landing, or must fields were supplied. Voice examples already inside SOUL snapshots remain unchanged. No personality grading or adoption was performed. This is a bounded smoke comparison; overlap with SOUL anchors and generalization require separate review.\n\nCleanup complete: '+report.cleanup.complete+'. Official sign-in credentials were neither copied nor logged.\n');
  clearTimeout(hardTimer);
  console.log(JSON.stringify({status:report.status,summary:report.summary,errors:report.errors,cleanup:report.cleanup,results:join(OUT,'results.json')}));
  process.exitCode=report.status==='completed'?0:1;
}
