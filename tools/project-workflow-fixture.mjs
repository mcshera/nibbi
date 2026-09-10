// Real backend routes and Git lifecycle, isolated state and deterministic local providers.
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
export async function projectWorkflowFixture({daemon,ui}) {
 const directory=mkdtempSync(join(tmpdir(),'nibbi-project-workflow-'));
 process.env.NODE_ENV='test';process.env.NIBBI_SCHEDULER='0';process.env.NIBBI_REMOTE='0';process.env.NIBBI_LEGACY_API='0';
 for(const [key,sub]of Object.entries({NIBBI_STATE_DIR:'state',NIBBI_VAULT_DIR:'vault',NIBBI_WORK_DIR:'work',NIBBI_PROJECTS_DIR:'projects'})){process.env[key]=join(directory,sub);mkdirSync(process.env[key],{recursive:true});}
 const mod=name=>import(pathToFileURL(join(daemon,name+'.js')).href);
 const {runtime,closeRuntime}=await mod('store');const {api}=await mod('api');const {createProject,updateProject}=await mod('projects');const {replaceProviderForTest}=await mod('providers/index');const fixer=await mod('fixer');const {closeToolService}=await mod('tool-service');const {stopProcesses}=await mod('processes');
 let serial=0;const restores=[];
 for(const id of ['claude','codex'])restores.push(replaceProviderForTest(id,{id,capabilities:{streaming:true,steering:true,cancellation:true,skills:true,tools:true,images:true},start:input=>({
  result:Promise.resolve().then(()=>{if(input.role==='fixer')writeFileSync(join(input.cwd,'fixture-change-'+(++serial)+'.txt'),input.prompt);return {text:'Fixture change is ready for review.',isError:false};}),cancel:async()=>{},steer:async()=>{}
 })}));
 for(const project of ['paper-garden','observatory','weekend-notes']){await createProject(project);updateProject(project,{check:'test -n "$(ls fixture-change-*.txt)"',install:'true'});}
 const vault=process.env.NIBBI_VAULT_DIR;mkdirSync(join(vault,'plans'),{recursive:true});mkdirSync(join(vault,'games/paper-garden'),{recursive:true});
 writeFileSync(join(vault,'plans/paper-garden.md'),'# A garden to return to\n\nMake the garden quiet and welcoming.\n\n## First shoots <!-- nibbi-milestone:first-shoots -->\nA useful first visit.\n\n- [x] Remember visitors <!-- nibbi-task:remember-visitors -->\n- [ ] Space the seedlings <!-- nibbi-task:space-seedlings -->\n  Keep room near the edges.\n\n## Evening garden <!-- nibbi-milestone:evening -->\n- [ ] Dim the lights <!-- nibbi-task:dim-lights -->\n\n```md\n- [ ] This is an example, not a task\n```\n');
 writeFileSync(join(vault,'games/paper-garden/issues.md'),'# Garden issues\n\nKeep reproduction notes intact.\n\n## Growing\n- [ ] Seedlings overlap <!-- nibbi-issue:seedling-overlap -->\n  Reproduce with a full garden.\n- [x] Remember visitors <!-- nibbi-issue:visitor-history -->\n- [ ] Keyboard focus disappears <!-- nibbi-issue:keyboard-focus -->\n');
 writeFileSync(join(vault,'plans/observatory.md'),'# Observatory direction\nA prose-only roadmap still counts as a plan.\n');
 const calls=[],errors=[];const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.webmanifest':'application/manifest+json'};
 const server=createServer((req,res)=>{void(async()=>{
  const url=new URL(req.url,'http://'+req.headers.host);calls.push({method:req.method,path:url.pathname,search:url.search});
  // Provider account discovery is unrelated to these fixture workflows.
  if(url.pathname==='/api/providers'){res.setHeader('content-type','application/json');res.end('{}');return;}
  if(await api(req,res,url))return;
  const file=resolve(ui,'.'+(url.pathname==='/'?'/index.html':url.pathname));if(!file.startsWith(resolve(ui)+'/')||!existsSync(file)){res.writeHead(404);res.end();return;}
  res.setHeader('content-type',mime[extname(file)]||'application/octet-stream');res.end(readFileSync(file));
 })().catch(error=>{errors.push(error.message);if(!res.headersSent){res.writeHead(error.status||400,{'content-type':'application/json'});res.end(JSON.stringify({error:error.message}));}else res.end();});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 return {directory,vault,base,calls,errors,runtime:runtime(),fixer,section:async(project,section)=>fetch(base+'/api/project-section?project='+project+'&section='+section).then(r=>r.json()),
  close:async()=>{await fixer.shutdownFixers();await closeToolService();await stopProcesses();for(const restore of restores)restore();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));closeRuntime();rmSync(directory,{recursive:true,force:true});}};
}
