import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { projectWorkflowFixture } from './project-workflow-fixture.mjs';

/** Actual HTTP/runtime/command service and local Git; deterministic GitHub CLI transport only. */
export async function githubWorkflowFixture({daemon,ui}) {
  process.env.NIBBI_GITHUB_POLL='0';
  const fixture=await projectWorkflowFixture({daemon,ui});
  const mod=name=>import(pathToFileURL(join(daemon,name+'.js')).href);
  const {execute,git}=await mod('processes'),projects=await mod('projects'),cli=await mod('github-cli'),engine=await mod('github-builds');
  const project='paper-garden',repo=projects.games()[project].repo,bare=join(fixture.directory,'github-remote.git'),remote='git@github.com:owner/paper-garden.git';
  mkdirSync(join(repo,'.github/PULL_REQUEST_TEMPLATE'),{recursive:true});writeFileSync(join(repo,'.github/pull_request_template.md'),'## Fixture review\nDescribe the reviewed change.\n');writeFileSync(join(repo,'.github/PULL_REQUEST_TEMPLATE/release.md'),'## Release checklist\nRecord validation here.\n');await git(repo,'add','.github/pull_request_template.md','.github/PULL_REQUEST_TEMPLATE/release.md');await git(repo,'commit','-m','Add reviewed PR templates');
  await git(fixture.directory,'init','--bare',bare);await git(repo,'push',bare,'HEAD:refs/heads/main');await git(repo,'remote','add','origin',remote);await git(repo,'checkout','-b','staging');
  projects.updateProject(project,{check:'test -f README.md',targetBranch:'staging'});
  writeFileSync(join(repo,'adopted.txt'),'This selected file belongs to the Build.\n');writeFileSync(join(repo,'private-draft.txt'),'This unselected local draft stays here.\n');
  let number=0;const state={account:'owner',repositoryId:11,checks:'success',requests:[],prs:[],holdPush:false,releasePush:null,offline:false};
  const repository=()=>({id:state.repositoryId,node_id:'R_garden',full_name:'owner/paper-garden',html_url:'https://github.com/owner/paper-garden',private:true,default_branch:'main',permissions:{push:true,admin:false,maintain:false},allow_merge_commit:true,allow_squash_merge:true,allow_rebase_merge:true});
  const ref=branch=>git(bare,'rev-parse','refs/heads/'+branch),prView=async pr=>({...pr,head:{...pr.head,sha:await ref(pr.head.ref)},base:{...pr.base,sha:await ref(pr.base.ref)}});
  const result=value=>({code:0,stdout:typeof value==='string'?value:JSON.stringify(value),stderr:'',signal:null,durationMs:0});
  const restore=cli.replaceGithubRunnerForTest(async(command,args,cwd)=>{
    state.requests.push([command,...args]);
    if(command==='git'){
      if(args[0]==='push'&&state.holdPush)await new Promise(resolve=>state.releasePush=resolve);
      const mapped=args.map(arg=>arg===remote?bare:arg);
      return execute(cwd,'git',['-c','core.hooksPath=/dev/null','-c','user.name=Fixture','-c','user.email=fixture@example.test','-c','commit.gpgsign=false',...mapped]);
    }
    if(state.offline)throw new Error('Fixture GitHub connection is offline.');
    if(args[0]==='api'){
      const endpoint=args.find(arg=>arg==='user'||arg.startsWith('repos/'));if(!endpoint)throw new Error('Missing API endpoint');const path=endpoint.split('?')[0];
      if(path==='user')return result({login:state.account});if(path==='repos/owner/paper-garden')return result(repository());
      if(path.endsWith('/protection')||path.includes('/rules/branches/'))throw new cli.GithubError('FORBIDDEN','Private repository protections are unavailable.');
      if(path==='repos/owner/paper-garden/issues/7')return result({number:7,node_id:'ISSUE_seven',html_url:'https://github.com/owner/paper-garden/issues/7',title:'A remote garden issue',state:'open'});
      if(path.endsWith('/pulls'))return result(await Promise.all(state.prs.map(prView)));
      const match=path.match(/\/pulls\/(\d+)$/);if(match){const pr=state.prs.find(item=>item.number===Number(match[1]));if(!pr)throw new cli.GithubError('NOT_FOUND','Missing PR');return result(await prView(pr));}
      if(path.endsWith('/files'))return result([]);
      if(path.endsWith('/reviews')||path.endsWith('/comments')||path.endsWith('/statuses')||path.endsWith('/deployments'))return result([]);
      if(path.endsWith('/check-runs'))return result({check_runs:[{id:77,name:'project-checks',app:{id:15368},head_sha:path.split('/')[4],status:state.checks==='pending'?'in_progress':'completed',conclusion:state.checks==='pending'?null:state.checks,html_url:'https://github.com/check/77'}]});
      if(path.endsWith('/actions/workflows'))return result({workflows:[{id:22,name:'verify',path:'.github/workflows/verify.yml',state:'active'}]});
      if(path.endsWith('/actions/runs'))return result({workflow_runs:[{id:88,workflow_id:22,path:'.github/workflows/verify.yml',head_sha:new URL('https://fixture/'+endpoint).searchParams.get('head_sha')}]});
      if(path.endsWith('/jobs'))return result({jobs:[{id:99,name:'project-checks',check_run_url:'https://api.github.com/repos/owner/paper-garden/check-runs/77'}]});
      throw new Error('Unexpected fixture API '+endpoint);
    }
    if(args[0]==='pr'){
      const arg=name=>args[args.indexOf(name)+1];
      if(args[1]==='create'){const branch=arg('--head'),base=arg('--base'),pr={number:++number,node_id:'PR_'+number,html_url:'https://github.com/owner/paper-garden/pull/'+number,state:'open',draft:true,merged:false,mergeable:true,title:arg('--title'),body:readFileSync(arg('--body-file'),'utf8'),head:{ref:branch,sha:await ref(branch),repo:repository()},base:{ref:base,sha:await ref(base),repo:repository()}};state.prs.push(pr);return result(pr.html_url);}
      const pr=state.prs.find(item=>item.number===Number(args[2]));if(!pr)throw new Error('Missing fixture PR');
      if(args[1]==='view')return result({headRefOid:await ref(pr.head.ref),baseRefOid:await ref(pr.base.ref),reviewDecision:'',mergeStateStatus:'CLEAN'});
      if(args[1]==='ready'){pr.draft=false;return result('Ready');}
      if(args[1]==='merge'){const sha=await ref(pr.head.ref);if(arg('--match-head-commit')!==sha)throw new Error('Head changed');await git(bare,'update-ref','refs/heads/'+pr.base.ref,sha);pr.merged=true;pr.state='closed';pr.merge_commit_sha=sha;pr.merged_at=new Date().toISOString();return result('Merged');}
    }
    throw new Error('Unexpected fixture CLI '+args.join(' '));
  });
  return {...fixture,repo,bare,remote,state,git,ref,engine,projects,close:async()=>{restore();await fixture.close();}};
}
