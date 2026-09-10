import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** Real Git transport and objects, deterministic GitHub REST/CLI; no accounts or network. */
export async function githubFixture() {
  const folder=mkdtempSync(join(tmpdir(),'nibbi-github-'));
  process.env.NODE_ENV='test';process.env.NIBBI_STATE_DIR=join(folder,'state');process.env.NIBBI_VAULT_DIR=join(folder,'vault');process.env.NIBBI_WORK_DIR=join(folder,'work');process.env.NIBBI_PROJECTS_DIR=join(folder,'projects');process.env.NIBBI_GITHUB_POLL='0';
  mkdirSync(join(folder,'vault'),{recursive:true});
  const {execute,git}=await import('../../src/processes.js');const {runtime,closeRuntime}=await import('../../src/store.js');const {createProject,updateProject}=await import('../../src/projects.js');
  const cli=await import('../../src/github-cli.js'),repos=await import('../../src/github-repositories.js'),engine=await import('../../src/github-builds.js');
  const project=await createProject('fixture');updateProject('fixture',{check:'test -f README.md'});const bare=join(folder,'remote.git');await git(folder,'init','--bare',bare);await git(project.repo,'push',bare,'HEAD:refs/heads/main');await git(project.repo,'remote','add','origin','git@github.com:owner/fixture.git');
  const remote='git@github.com:owner/fixture.git';let number=0;
  const state={account:'owner',repositoryId:11,checks:'success',checkHead:undefined as string|undefined,workflowId:22,workflows:[{id:22,path:'.github/workflows/verify.yml',state:'active'}],failAfterPush:false,mergeFailure:false,queueMerge:false,reviewDecision:'',reviews:[] as any[],requests:[] as string[][],prs:[] as any[],permission:true};
  const repository=()=>({id:state.repositoryId,node_id:'R_fixture',full_name:'owner/fixture',html_url:'https://github.com/owner/fixture',private:true,default_branch:'main',permissions:{push:state.permission,admin:false,maintain:false},allow_merge_commit:true,allow_squash_merge:true,allow_rebase_merge:true});
  const ref=async(branch:string)=>git(bare,'rev-parse','refs/heads/'+branch);
  const prView=async(pr:any)=>({...pr,head:{...pr.head,sha:await ref(pr.head.ref)},base:{...pr.base,sha:await ref(pr.base.ref)}});
  const result=(value:any)=>({code:0,stdout:typeof value==='string'?value:JSON.stringify(value),stderr:'',signal:null,durationMs:0});
  const restore=cli.replaceGithubRunnerForTest(async(command,args,cwd,options)=>{
    state.requests.push([command,...args]);
    if(command==='git'){
      const mapped=args.map(arg=>arg===remote?bare:arg);const response=await execute(cwd,'git',['-c','core.hooksPath=/dev/null','-c','user.name=Fixture','-c','user.email=fixture@example.test','-c','commit.gpgsign=false',...mapped]);
      if(args[0]==='push'&&state.failAfterPush){state.failAfterPush=false;throw new Error('Fixture transport disconnected after successful push');}return response;
    }
    if(args[0]==='api'){
      const endpoint=args.find(arg=>arg==='user'||arg.startsWith('repos/'))!,path=endpoint.split('?')[0];
      if(path==='user')return result({login:state.account});
      if(path==='repos/owner/fixture')return result(repository());
      if(path.endsWith('/protection'))throw new cli.GithubError('FORBIDDEN','Private protections unavailable');
      if(path.includes('/rules/branches/'))throw new cli.GithubError('FORBIDDEN','Private rules unavailable');
      if(path.endsWith('/pulls'))return result(await Promise.all(state.prs.map(prView)));
      const match=path.match(/\/pulls\/(\d+)$/);if(match){const pr=state.prs.find(item=>item.number===Number(match[1]));if(!pr)throw new cli.GithubError('NOT_FOUND','Missing PR');return result(await prView(pr));}
      if(path.endsWith('/reviews'))return result(state.reviews);
      if(path.endsWith('/comments')||path.endsWith('/statuses')||path.endsWith('/deployments')||path.endsWith('/files'))return result([]);
      if(path.endsWith('/check-runs')){const sha=path.split('/')[4];return result({check_runs:[{id:77,name:'project-checks',app:{id:15368},head_sha:state.checkHead??sha,status:state.checks==='pending'?'in_progress':'completed',conclusion:state.checks==='pending'?null:state.checks,html_url:'https://github.com/check/77'}]});}
      if(path.endsWith('/actions/workflows'))return result({workflows:state.workflows});
      if(path.endsWith('/actions/runs')){const sha=new URL('https://fixture/'+endpoint).searchParams.get('head_sha');return result({workflow_runs:[{id:88,workflow_id:state.workflowId,path:'.github/workflows/verify.yml',head_sha:sha}]});}
      if(path.endsWith('/jobs'))return result({jobs:[{id:99,name:'project-checks',check_run_url:'https://api.github.com/repos/owner/fixture/check-runs/77'}]});
      throw new Error('Unexpected fixture API '+endpoint);
    }
    if(args[0]==='pr'){
      const arg=(name:string)=>args[args.indexOf(name)+1];
      if(args[1]==='create'){
        const {readFileSync}=await import('node:fs');const head=arg('--head'),base=arg('--base');const pr={number:++number,node_id:'PR_'+number,html_url:'https://github.com/owner/fixture/pull/'+number,state:'open',draft:true,merged:false,mergeable:true,title:arg('--title'),body:readFileSync(arg('--body-file'),'utf8'),head:{ref:head,sha:await ref(head),repo:repository()},base:{ref:base,sha:await ref(base),repo:repository()}};state.prs.push(pr);return result(pr.html_url);
      }
      const pr=state.prs.find(item=>item.number===Number(args[2]));if(!pr)throw new Error('Missing fixture PR');
      if(args[1]==='view'){const current=await prView(pr);return result({headRefOid:current.head.sha,baseRefOid:current.base.sha,reviewDecision:state.reviewDecision,mergeStateStatus:'CLEAN'});}
      if(args[1]==='ready'){pr.draft=args.includes('--undo');return result('Ready');}
      if(args[1]==='merge'){
        if(state.mergeFailure)throw new Error('Fixture merge rejected');if(state.queueMerge)return result('Queued for merge');const sha=await ref(pr.head.ref);if(arg('--match-head-commit')!==sha)throw new Error('Head changed');
        await git(bare,'update-ref','refs/heads/'+pr.base.ref,sha);pr.merged=true;pr.state='closed';pr.merge_commit_sha=sha;pr.merged_at=new Date().toISOString();return result('Merged');
      }
    }
    throw new Error('Unexpected fixture CLI '+args.join(' '));
  });
  const connection=await repos.inspectGithubConnection('fixture',{account:'owner',repository:'owner/fixture',integrationBranch:'main',requiredChecks:[{name:'project-checks',appId:15368,workflowId:22,workflowPath:'.github/workflows/verify.yml',acceptedConclusions:['success']}]});repos.saveGithubConnection(connection);
  const restoreVerifier=engine.replaceGithubVerifierForTest(async(_connection,headSha)=>({testedSha:headSha,detail:'Fixture check passed'}));
  async function build(id='build-fixture'){
    const branch='nibbi/'+id;await git(project.repo,'branch',branch,'main');const worktree=join(folder,'work',id);await git(project.repo,'worktree','add',worktree,branch);writeFileSync(join(worktree,'feature.txt'),id+'\n');await git(worktree,'add','feature.txt');await git(worktree,'commit','-m','Fixture change');const headSha=await git(worktree,'rev-parse','HEAD');
    const run={id,game:'fixture',project:'fixture',branch,worktree,commitSha:headSha,lastVerifiedSha:headSha,workflowMode:'github',issue:'Fixture feature',title:'Fixture feature',status:'staged',startedAt:new Date().toISOString(),endedAt:new Date().toISOString(),verification:{status:'passed',checks:[{command:'test',code:0}]}};
    runtime().put('fixers',id,run);engine.reserveBuildBinding('fixture',id,branch);return run;
  }
  async function prepare(operation:string,args:Record<string,any>={}){return engine.executeGithubCommand('github.prepare','fixture',{operation,...args});}
  async function perform(operation:string,args:Record<string,any>={}){const review=await prepare(operation,args);return engine.executeGithubCommand(operation,'fixture',{operationId:review.operationId});}
  return {folder,project,bare,remote,state,git,runtime,cli,repos,engine,connection,build,prepare,perform,ref,cleanup:async()=>{restoreVerifier();restore();closeRuntime();rmSync(folder,{recursive:true,force:true});}};
}
