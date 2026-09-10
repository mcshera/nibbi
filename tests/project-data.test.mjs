import test from 'node:test';
import assert from 'node:assert/strict';
import {loadProjectSection,loadProjectSummaries,projectCommand,ProjectDataError,loadGithubProject,loadGithubBuild,loadGithubChanges,githubCommand} from '../public/lib/project-data.js';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const document=(project='alpha',section='plans',extra={})=>({project,section,status:'ready',markdown:'# Plan\nA prose roadmap.',revision:'revision-a',items:[],counts:null,...extra});
test('canonical section read preserves identities, revision, source text and reported counts',async()=>{
 const source=document('alpha','plans',{items:[{id:'pinned-1',text:'A task',done:false}],counts:{total:1,done:0,open:1}});
 const result=await loadProjectSection({project:'alpha',section:'plans',fetcher:async(url,options)=>{assert.equal(url,'/api/project-section?project=alpha&section=plans');assert.equal(options.method,'GET');return json(source);}});
 assert.deepEqual(result,source);
});
test('prose, known empty, partial and failed reads remain distinct',async()=>{
 for(const status of ['ready','empty','partial'])assert.equal((await loadProjectSection({project:'alpha',section:'issues',fetcher:async()=>json(document('alpha','issues',{status}))})).status,status);
 await assert.rejects(loadProjectSection({project:'alpha',section:'issues',fetcher:async()=>json({error:'Could not read issues'},503)}),e=>e instanceof ProjectDataError&&e.status===503);
});
test('wrong project/section and foreign builds never enter a view; global exports are removed',async()=>{
 for(const data of [document('beta'),document('alpha','issues')])await assert.rejects(loadProjectSection({project:'alpha',section:'plans',fetcher:async()=>json(data)}),ProjectDataError);
 const builds={project:'alpha',section:'builds',status:'ready',runs:[{id:'a',game:'alpha',status:'staged',verification:{status:'unverified'}}],files:[{name:'private-export'}]};
 const result=await loadProjectSection({project:'alpha',section:'builds',fetcher:async()=>json(builds)});assert.deepEqual(result.files,[]);assert.equal(result.runs[0].verification.status,'unverified');
 builds.runs[0].game='beta';await assert.rejects(loadProjectSection({project:'alpha',section:'builds',fetcher:async()=>json(builds)}),ProjectDataError);
});
test('summary batches request only named projects and reject missing or foreign identity',async()=>{
 const summaries=await loadProjectSummaries({projects:['alpha','beta'],fetcher:async url=>{assert.equal(url,'/api/project-summaries?projects=alpha%2Cbeta');return json({projects:{alpha:{project:'alpha'},beta:{project:'beta'},other:{project:'other'}}});}});assert.deepEqual(Object.keys(summaries),['alpha','beta']);
 await assert.rejects(loadProjectSummaries({projects:['alpha'],fetcher:async()=>json({projects:{}})}),ProjectDataError);
});
test('revision conflicts retain machine-readable detail and mutations carry fixed project identity',async()=>{
 await assert.rejects(projectCommand('alpha',{action:'issue.edit',project:'wrong',expectedRevision:'old',id:'issue-1'},{idempotencyKey:'test-key',fetcher:async(url,opts)=>{
  assert.equal(url,'/api/project-command');assert.equal(opts.method,'POST');assert.equal(opts.headers['idempotency-key'],'test-key');const body=JSON.parse(opts.body);assert.equal(body.project,'alpha');assert.equal(body.expectedRevision,'old');return json({ok:false,error:{code:'REVISION_CONFLICT',message:'The document changed'},revision:'current'},409);
 }}),e=>e.code==='REVISION_CONFLICT'&&e.revision==='current'&&e.message==='The document changed');
});
test('aborted reads reject even when a fetcher ignores cancellation',async()=>{
 const c=new AbortController();let release;const result=loadProjectSection({project:'alpha',section:'plans',signal:c.signal,fetcher:()=>new Promise(r=>{release=r;})});c.abort();release(json(document()));await assert.rejects(result,{name:'AbortError'});
});
test('invalid project IDs and sections cannot make requests',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return json({});};for(const project of ['', '../alpha','alpha/beta','alpha\\beta','alpha\0','alpha & beta'])await assert.rejects(loadProjectSection({project,section:'plans',fetcher}),TypeError);
 await assert.rejects(loadProjectSection({project:'alpha',section:'other',fetcher}),TypeError);assert.equal(calls,0);
});

test('GitHub reads and reviewed writes retain canonical project and Build identity',async()=>{
 await assert.rejects(loadGithubProject({project:'alpha',fetcher:async()=>json({project:'beta'})}),ProjectDataError);
 await assert.rejects(loadGithubBuild({project:'alpha',buildId:'a',fetcher:async()=>json({project:'beta',buildId:'a'})}),ProjectDataError);
 await assert.rejects(loadGithubChanges({project:'alpha',buildId:'a',fetcher:async()=>json({project:'alpha',buildId:'b',files:[],sourceRevision:'one'})}),ProjectDataError);
 const result=await githubCommand('alpha','build.publish',{operationId:'review-one'},{idempotencyKey:'identity-one',fetcher:async(url,options)=>{assert.equal(url,'/api/commands');assert.deepEqual(JSON.parse(options.body),{name:'build.publish',args:{operationId:'review-one'},projectId:'alpha',idempotencyKey:'identity-one'});return json({ok:true,data:{state:'unknown'}});}});assert.equal(result.state,'unknown');
});
