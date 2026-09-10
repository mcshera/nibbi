import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectSummaryStore,describeProjectSection,buildGroup,verificationLabel,projectBuildCounts,buildMatchesFilter} from '../public/lib/project-summary.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const summary=project=>({project,builds:{status:'ready',counts:{total:3,active:1,review:1,failed:1,history:0}},issues:{status:'empty',counts:{total:0,open:0,done:0}},plans:{status:'ready',counts:{total:4,done:2},currentMilestone:{name:'Polish'}}});
test('badges explain actionable state and never equate staged work with verification',()=>{
 const s=summary('alpha');assert.equal(describeProjectSection('builds',s.builds).badge,'1 review');assert.match(describeProjectSection('builds',s.builds).detail,/1 active.*1 failed/);
 assert.equal(describeProjectSection('issues',s.issues).badge,'No issues');assert.equal(describeProjectSection('plans',s.plans).badge,'2/4 tasks');assert.equal(describeProjectSection('plans',s.plans).detail,'Polish');
 assert.equal(buildGroup('verifying'),'active');assert.equal(buildGroup('superseded'),'history');assert.equal(verificationLabel({status:'unverified'}),'Not verified');assert.equal(verificationLabel(undefined),'Unavailable');
});
test('loading, errors, prose-only documents and stale counts remain honest',()=>{
 assert.equal(describeProjectSection('issues').badge,'Loading…');assert.equal(describeProjectSection('issues',{status:'error'}).badge,'Unavailable');
 assert.equal(describeProjectSection('issues',{status:'ready',hasNotes:true,counts:null}).badge,'Notes');assert.equal(describeProjectSection('plans',{status:'ready',hasNotes:true,counts:null}).badge,'Written plan');
 assert.equal(describeProjectSection('plans',{status:'partial',counts:null}).badge,'Unavailable');
 const old=describeProjectSection('plans',{...summary('a').plans,stale:true});assert.equal(old.badge,'2/4 tasks');assert.equal(old.stale,true);assert.match(old.detail,/last read/);
});
test('summary reads are demand-driven, bounded, deduplicated and cached',async()=>{
 let current=0,max=0,calls=[];const releases=[];
 const store=createProjectSummaryStore({batchSize:2,concurrency:2,load:({projects})=>{calls.push(projects);current++;max=Math.max(max,current);return new Promise(resolve=>releases.push(()=>{current--;resolve(Object.fromEntries(projects.map(id=>[id,summary(id)])));}));}});
 store.watch(['a','b','c','d','e']);store.watch(['a','b','c','d','e']);await tick();assert.equal(calls.length,2);assert.equal(max,2);releases.splice(0).forEach(f=>f());await tick();assert.equal(calls.length,3);releases.splice(0).forEach(f=>f());await tick();store.watch(['a']);await tick();assert.equal(calls.length,3);assert.equal(store.get('e').project,'e');store.destroy();
});
test('late summary cannot overwrite a newer section read',async()=>{
 let release;const store=createProjectSummaryStore({load:()=>new Promise(resolve=>{release=resolve;})});store.watch(['alpha']);await tick();const oldRelease=release;
 store.accept('alpha','plans',{status:'ready',revision:'new',counts:{total:5,done:4}});oldRelease({alpha:summary('alpha')});await tick();assert.equal(store.get('alpha').plans.revision,'new');store.destroy();
});
test('failed refresh retains counts and marks them stale rather than empty',async()=>{
 let fails=false;const store=createProjectSummaryStore({load:async({projects})=>{if(fails)throw new Error('Offline');return Object.fromEntries(projects.map(id=>[id,summary(id)]));}});store.watch(['alpha']);await tick();fails=true;store.invalidate();await tick();assert.equal(store.get('alpha').plans.counts.total,4);assert.equal(store.get('alpha').plans.stale,true);store.destroy();
});

test('published open PRs remain actionable with shared overlapping filters and no false history badge',()=>{
 const runs=[{id:'one',status:'staged',github:{mode:'github',toPush:false,pullRequest:true}},{id:'two',status:'merged',github:{mode:'github',toPush:true,pullRequest:false}},{id:'three',status:'failed',github:{mode:'github',toPush:true,pullRequest:true,needsAttention:true}}];
 const counts=projectBuildCounts(runs);assert.equal(counts.history,0);assert.equal(counts.pullRequests,2);assert.equal(counts.toPush,2);assert.equal(counts.attention,1);assert.equal(counts.review,0);assert.equal(buildMatchesFilter(runs[1],'toPush'),true);assert.equal(buildMatchesFilter(runs[1],'history'),false);
 assert.equal(describeProjectSection('builds',{status:'ready',runs:[runs[0]]}).badge,'1 pull request');
});
