try{fetch("/api/beacon?stage=appjs-start")}catch(e){}
const $=s=>document.querySelector(s);
window.addEventListener("error",e=>{const s=$("#stattext");if(s)s.textContent="js: "+e.message.slice(0,140)});
window.addEventListener("unhandledrejection",e=>{const s=$("#stattext");if(s)s.textContent="err: "+String(e.reason).slice(0,140)});
const IS_APP_EARLY=new URLSearchParams(location.search).get("app")==="1";
const inTauri=!!(window.__TAURI__&&window.__TAURI__.core&&window.__TAURI__.core.invoke);
if(IS_APP_EARLY){document.querySelector("#hleft").style.paddingLeft="84px";if(localStorage.getItem("vibrancy")!=="off")document.body.classList.add("vibrant");} // room for macOS traffic lights (Overlay titlebar)
if(localStorage.getItem("reduceMotion")==="on")document.body.classList.add("reducemotion");
const BASE=location.protocol.startsWith("http")?"":"http://127.0.0.1:4519";
let transport="http"; // daemon serves over http; __TAURI__ is only used for events (⌥space)
const raceMs=(p,ms)=>Promise.race([p,new Promise((_,rj)=>setTimeout(()=>rj(new Error("ipc timeout")),ms))]);
async function viaFetch(p,opts){const r=await fetch(BASE+p,opts);return r.json()}
async function apiGet(p){
  if(transport==="ipc"){try{return JSON.parse(await raceMs(window.__TAURI__.core.invoke("api_get",{path:p}),8000));}
    catch(e){transport="http";console.warn("ipc→http:",e);}}
  return viaFetch(p); }
async function apiPost(p,b){
  const body=JSON.stringify(b);
  if(transport==="ipc"){try{return JSON.parse(await raceMs(window.__TAURI__.core.invoke("api_post",{path:p,body}),900000));}
    catch(e){transport="http";console.warn("ipc→http:",e);}}
  return viaFetch(p,{method:"POST",headers:{"content-type":"application/json"},body}); }

/* mini markdown */
function esc(s){return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}
function md(src){
  try{
    if(window.marked){
      const localimg=(p)=>{try{p=decodeURIComponent(p)}catch(e){}return BASE+"/api/file?p="+encodeURIComponent(p)};
      src=src.replace(/!\[([^\]]*)\]\((\/[^)]+?\.(?:png|jpe?g|gif|webp))\)/gi,
        (m,alt,p)=>'<img src="'+localimg(p)+'" alt="'+esc(alt)+'">');
      let out=marked.parse(src,{breaks:true,mangle:false,headerIds:false});
      out=out.replace(/<script[\s\S]*?<\/script>/gi,"");
      out=out.replace(/\[\[([^\]]+)\]\]/g,'<span class="wiki">[[$1]]</span>');
      out=out.replace(/<img src="(?!https?:|data:|\/api\/)([^"]+)"/g,(m,p)=>'<img src="'+localimg(p)+'"');
      return out;
    }
  }catch(e){}
  return esc(src).replace(/\*\*([^*]+)\*\*/g,"<b>$1</b>").replace(/`([^`]+)`/g,"<code>$1</code>").replace(/\n/g,"<br>");
}
/* chat */


/* links open in the system browser, never navigate the app away */
document.addEventListener("click",e=>{
  const a=e.target.closest&&e.target.closest("a[href]");
  if(!a)return;
  const href=a.getAttribute("href")||"";
  if(/^https?:\/\//i.test(href)){
    e.preventDefault();e.stopPropagation();
    if(IS_APP_EARLY)fetch(BASE+"/api/open?url="+encodeURIComponent(href)).catch(()=>{});
    else window.open(href,"_blank");
  }
},true);

/* scroll-to-bottom pill when reading history while new text streams */
(function(){
  const chat=$("#chat");if(!chat)return;
  const pill=document.createElement("div");pill.id="scrollpill";pill.textContent="↓ latest";
  pill.onclick=()=>{chat.scrollTop=1e9};
  document.querySelector("#chatcol").appendChild(pill);
  const update=()=>{
    const away=chat.scrollHeight-chat.scrollTop-chat.clientHeight>300;
    pill.classList.toggle("show",away);
  };
  chat.addEventListener("scroll",update);
  new MutationObserver(update).observe(chat,{childList:true,subtree:true});
})();

/* code polish: highlight + hover copy on every rendered md container */
function polishCode(root){
  try{
    root.querySelectorAll("pre code").forEach(b=>{
      if(!b.dataset.hl){b.dataset.hl="1";window.hljs&&hljs.highlightElement(b);}
    });
    root.querySelectorAll("pre").forEach(p=>{
      if(p.querySelector(".codecopy"))return;
      const btn=document.createElement("button");btn.className="codecopy";btn.textContent="COPY";
      btn.onclick=(e)=>{e.stopPropagation();try{navigator.clipboard.writeText(p.querySelector("code").textContent)}catch(err){}
        btn.textContent="COPIED";setTimeout(()=>btn.textContent="COPY",1200);};
      p.appendChild(btn);
    });
  }catch(e){}
}
function bubble(role,text,meta){
  const d=document.createElement("div");
  d.className="msg "+role+(role==="oracle"?" arrive":"");
  if(role==="oracle"&&histLoaded)sfx.reply();
  d.onclick=()=>{try{navigator.clipboard.writeText(text)}catch(e){}};
  setTimeout(()=>d.classList.remove("arrive"),1800);
  d.innerHTML='<span class="meta">'+(role==="oracle"?'<i class="pres"></i>':"")+meta+"</span>"+(role==="oracle"?'<span class="md">'+md(text)+"</span>":esc(text));
  if(role==="oracle")polishCode(d);
  $("#chat").appendChild(d); $("#chat").scrollTop=1e9;
  {const ch=$("#chat"); if(ch.scrollHeight-ch.scrollTop-ch.clientHeight<250){while(ch.children.length>600)ch.removeChild(ch.firstChild);}}
  return d;
}
let histLoaded=false,oldestTs=null,histBusy=false;
function entryMeta(e){const t=new Date(e.ts).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});const via=e.channel&&!/^(app|cli|web|api)$/i.test(e.channel)?" · "+e.channel:"";return (e.role==="user"?"you":"oracle")+" · "+t+via;}
function dayOf(ts){return new Date(ts).toLocaleDateString([], {weekday:"long",month:"short",day:"numeric"})}
function renderEntries(h){
  $("#chat").innerHTML="";
  let lastDay="";
  for(const e of h){
    const day=dayOf(e.ts);
    if(day!==lastDay){lastDay=day;const s=document.createElement("div");s.className="daysep";s.textContent=day;$("#chat").appendChild(s);}
    const d=bubble(e.role==="user"?"user":"oracle",e.text,entryMeta(e));
    d.dataset.ts=e.ts;
  }
  oldestTs=h.length?h[0].ts:null;
}
async function loadHistory(){
  renderEntries(await apiGet("/api/history?n=60"));
  histLoaded=true;
}
/* scroll to top → pull older messages in */
async function loadOlder(){
  if(fixerViewId||histBusy||!oldestTs)return;histBusy=true;
  try{
    const older=await apiGet("/api/history?n=50&before="+encodeURIComponent(oldestTs));
    if(older.length){
      const chat=$("#chat"),keepH=chat.scrollHeight;
      const frag=document.createDocumentFragment();
      let lastDay="";
      for(const e of older){
        const day=dayOf(e.ts);
        if(day!==lastDay){lastDay=day;const s=document.createElement("div");s.className="daysep";s.textContent=day;frag.appendChild(s);}
        const d=document.createElement("div");
        d.className="msg "+(e.role==="user"?"user":"oracle");
        d.dataset.ts=e.ts;
        d.innerHTML='<span class="meta">'+entryMeta(e)+"</span>"+(e.role==="oracle"?'<span class="md">'+md(e.text)+"</span>":esc(e.text));
        if(e.role==="oracle")polishCode(d);
        frag.appendChild(d);
      }
      // drop a duplicate day label at the seam
      const firstOld=chat.querySelector(".daysep");
      if(firstOld&&frag.lastChild&&dayOf(older[older.length-1].ts)===firstOld.textContent)firstOld.remove();
      chat.prepend(frag);
      chat.scrollTop=chat.scrollHeight-keepH;
      oldestTs=older[0].ts;
    }else oldestTs=null;
  }catch(e){}
  histBusy=false;
}
$("#chat").addEventListener("scroll",()=>{if($("#chat").scrollTop<60)void loadOlder()});
let busy=false,t0=0,timer=null;

/* vision: paste or drop images — downscaled client-side, sent as content blocks */
let pendingImgs=[]; // {media_type,data,thumb}
function renderChips(){
  const row=$("#chips");
  row.innerHTML=pendingImgs.map((im,i)=>'<div class="chip"><img src="'+im.thumb+'"><span class="chipx" data-i="'+i+'">×</span></div>').join("");
  row.style.display=pendingImgs.length?"flex":"none";
  row.querySelectorAll(".chipx").forEach(x=>x.onclick=()=>{pendingImgs.splice(+x.dataset.i,1);renderChips()});
}
async function addImage(file){
  if(!file||!/^image\//.test(file.type)||pendingImgs.length>=4)return;
  const bmp=await createImageBitmap(file);
  const MAX=1568,scale=Math.min(1,MAX/Math.max(bmp.width,bmp.height));
  const cv=document.createElement("canvas");
  cv.width=Math.round(bmp.width*scale);cv.height=Math.round(bmp.height*scale);
  cv.getContext("2d").drawImage(bmp,0,0,cv.width,cv.height);
  const url=cv.toDataURL("image/jpeg",0.85);
  pendingImgs.push({media_type:"image/jpeg",data:url.split(",")[1],thumb:url});
  renderChips();sfx.capture();
}
document.addEventListener("paste",e=>{
  for(const it of (e.clipboardData||{}).items||[])
    if(it.kind==="file"&&/^image\//.test(it.type)){e.preventDefault();void addImage(it.getAsFile())}
});
document.addEventListener("dragover",e=>{e.preventDefault()});
document.addEventListener("drop",e=>{
  e.preventDefault();
  for(const f of e.dataTransfer.files)void addImage(f);
});
async function streamSend(message,onDelta,onTool){
  const imgs=pendingImgs.map(i=>({media_type:i.media_type,data:i.data}));
  const thumbs=pendingImgs.map(i=>i.thumb);
  pendingImgs=[];renderChips();
  if(thumbs.length){
    const last=[...document.querySelectorAll(".msg.user")].pop();
    if(last)last.insertAdjacentHTML("beforeend",'<div class="bubimgs">'+thumbs.map(t=>'<img src="'+t+'">').join("")+"</div>");
  }
  const resp=await fetch(BASE+"/api/send",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({message,stream:true,images:imgs})});
  if(!resp.ok||!resp.body||!(resp.headers.get("content-type")||"").includes("event-stream")){
    const r=await resp.json();
    bubble("oracle",r.text||("⚠️ "+(r.error||"no reply")),"oracle · $"+((r.costUsd||0).toFixed(3)));
    return r;
  }
  let liveDiv=null,liveBody=null,acc="",done=null;
  const reader=resp.body.getReader(),dec=new TextDecoder();let buf="";
  const TOOLW={Bash:"running a command",Read:"reading",Write:"writing",Edit:"editing",MultiEdit:"editing",Grep:"searching",Glob:"searching",WebFetch:"browsing",WebSearch:"searching the web",Task:"delegating",TodoWrite:"planning"};
  const friendly=(n)=>n.startsWith("mcp__github")?"on github":(TOOLW[n]||n.toLowerCase());
  const frame=(ev,data)=>{
    if(ev==="tool"&&data.name){
      if(!speaking){$("#livestat").textContent=friendly(data.name)+"…";$("#livestat").classList.add("shimmer");}
      onTool&&onTool(data.name);
      return;
    }
    if(ev==="delta"&&data.t){
      $("#livestat").classList.remove("shimmer");
      acc+=data.t;
      if(!liveDiv){
        liveDiv=document.createElement("div");liveDiv.className="msg oracle arrive";
        liveDiv.innerHTML='<span class="meta">oracle · streaming</span><span class="md"></span>';
        liveBody=liveDiv.querySelector(".md");
        $("#chat").appendChild(liveDiv);
      }
      liveBody.textContent=acc.replace(/»voice:\s*(?:(?!»voice:)[^\n])*\n?/g,"");
      if($("#chat").scrollHeight-$("#chat").scrollTop-$("#chat").clientHeight<160)$("#chat").scrollTop=1e9;
      onDelta&&onDelta(data.t,acc);
    }else if(ev==="done"){done=data;}
  };
  for(;;){
    const {value,done:eof}=await reader.read();
    if(eof)break;
    buf+=dec.decode(value,{stream:true});
    let idx;
    while((idx=buf.indexOf("\n\n"))>=0){
      const chunk=buf.slice(0,idx);buf=buf.slice(idx+2);
      let ev="message",data=null;
      for(const line of chunk.split("\n")){
        if(line.startsWith("event: "))ev=line.slice(7);
        else if(line.startsWith("data: ")){try{data=JSON.parse(line.slice(6))}catch(e){}}
      }
      if(data)frame(ev,data);
    }
  }
  const r=done||{text:acc,costUsd:0};
  const finalText=r.text||acc||"⚠️ no reply";
  if(liveDiv){
    liveDiv.querySelector(".meta").textContent=r.local?"oracle · local (low-usage)":"oracle · $"+((r.costUsd||0).toFixed(3));
    liveBody.innerHTML=md(finalText);
    polishCode(liveDiv);
    liveDiv.onclick=()=>{try{navigator.clipboard.writeText(finalText)}catch(e){}};
    liveDiv.classList.remove("arrive");
    sfx.reply();
    $("#chat").scrollTop=1e9;
  }else{
    bubble("oracle",finalText,"oracle · $"+((r.costUsd||0).toFixed(3)));
  }
  return {...r,text:finalText};
}
async function send(){
  const box=$("#box"),text=box.value.trim();
  if((!text&&!pendingImgs.length)||busy)return;
  if(fixerViewId){fixerViewId=null;clearInterval(fixerPoll);await loadHistory();}
  busy=true;$("#send").disabled=true;box.value="";autosize();
  bubble("user",text||"🖼️","you · now");
  if(!live){setWave("thinking");$("#livestat").textContent="thinking";$("#livestat").classList.add("hot");}
  $("#think").classList.add("on");t0=Date.now();
  timer=setInterval(()=>{$("#elapsed").textContent=Math.round((Date.now()-t0)/1000)+"s"},1000);
  let first=true;
  try{
    await streamSend(text,()=>{if(first&&!live){first=false;setWave("speaking");$("#livestat").textContent="streaming…";}});
  }catch(e){bubble("oracle","⚠️ "+e,"error")}
  clearInterval(timer);$("#think").classList.remove("on");
  if(!live){setWave("standby");$("#livestat").textContent="idle";$("#livestat").classList.remove("hot","shimmer");}
  busy=false;$("#send").disabled=false;box.focus();
  void refreshPane();void refreshStatus();try{setNavActive(cur)}catch(_){}void renderController();
}
$("#send").onclick=send;
const box=$("#box");
function autosize(){box.style.height="auto";box.style.height=Math.min(box.scrollHeight,140)+"px"}
box.addEventListener("input",autosize);
box.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send()}});

/* status */
let remoteBusy=false,lastVaultTs=Date.now();
async function refreshStatus(){
  try{
    const s=await apiGet("/api/status");
    statusCache=s;updateChip(s);
    $("#dot").className="dot ok";
    {const rc=$("#reconnect");if(rc)rc.classList.remove("show");}
    $("#stattext").textContent="session "+(s.sessionShort||"—")+" · "+s.turns+" turns · ~$"+s.costUsdTotal.toFixed(2);
    // living vault: pulse the tab whose file oracle just wrote
    if(s.vaultTouched&&s.vaultTouched.ts>lastVaultTs){
      lastVaultTs=s.vaultTouched.ts;
      const f=s.vaultTouched.file;
      const tab=f.startsWith("journal")?"__journal__":document.querySelector('.nt[data-p="'+f+'"]')?f:null;
      if(tab){
        const el=document.querySelector('.nt[data-p="'+tab+'"]');
        if(el){el.classList.remove("vpulse");void el.offsetWidth;el.classList.add("vpulse");}
        if(cur===tab)void refreshPane();
      }
    }
    // ambient presence: oracle working from telegram/cron makes the room breathe
    if(!busy&&!live&&!speaking){
      if(s.busy&&!remoteBusy){remoteBusy=true;setWave("thinking");$("#livestat").textContent="working elsewhere…";$("#livestat").classList.add("hot");}
      else if(!s.busy&&remoteBusy){remoteBusy=false;setWave("standby");$("#livestat").textContent="idle";$("#livestat").classList.remove("hot");}
    }
  }catch(e){$("#dot").className="dot";$("#stattext").textContent="daemon offline";const rc=$("#reconnect");if(rc)rc.classList.add("show");clearTimeout(window.__recT);window.__recT=setTimeout(refreshStatus,2500);}
}

/* model chip + usage popover */
let statusCache=null;
function fmtK(n){return n>=1000?(n/1000).toFixed(n>=100000?0:1)+"k":String(n||0)}
function rlReset(rl){
  if(!rl||!rl.resetsAt)return null;
  return new Date(rl.resetsAt*(rl.resetsAt<1e12?1000:1)).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"});
}
function rlUtil(rl){
  if(!rl||rl.utilization==null)return null;
  return Math.min(100,Math.round(rl.utilization*(rl.utilization<=1?100:1)));
}
function updateChip(s){
  const c=$("#modelchip");if(!c)return;
  const model=(s.modelOverride||"default"),rl=s.rateLimit,util=rlUtil(rl);
  if(rl&&rl.status==="rejected"){
    c.textContent="LOW-USAGE · local — resets "+(rlReset(rl)||"soon");
    c.classList.add("limit");c.classList.remove("warn");
  }else{
    c.textContent=model+(s.ctxTokens?" · "+fmtK(s.ctxTokens):"")+(util!=null?" · "+util+"%":"");
    c.classList.remove("limit");
    c.classList.toggle("warn",(util!=null&&util>=80)||(rl&&rl.status==="allowed_warning"));
  }
}
let popEl=null;
function popClose(){if(popEl){popEl.remove();popEl=null}}
async function popOpen(){
  popClose();sfx.capture();
  const s=statusCache||{};
  const mi=await apiGet("/api/model");
  const util=rlUtil(s.rateLimit);
  const reset=rlReset(s.rateLimit);
  const limited=s.rateLimit&&s.rateLimit.status==="rejected";
  const ctxPct=s.ctxTokens?Math.min(100,Math.round(s.ctxTokens/2000)):0;
  popEl=document.createElement("div");popEl.id="usagePop";
  const chipR=$("#modelchip").getBoundingClientRect();
  popEl.style.top=(chipR.bottom+10)+"px";popEl.style.right="";popEl.style.left=Math.max(10,chipR.right-270)+"px";
  popEl.innerHTML=
    '<h4>model</h4>'+
    mi.options.map(o=>'<div class="modelopt'+(o===mi.current?" cur":"")+'" data-m="'+o+'"><span>'+o+'</span>'+(o===mi.current?"<span>●</span>":"")+'</div>').join("")+
    '<div class="usect"><h4>context</h4>'+
    '<div>'+fmtK(s.ctxTokens||0)+' / 200k tokens</div><div class="ubar"><div style="width:'+ctxPct+'%" class="'+(ctxPct>=80?"hot":"")+'"></div></div></div>'+
    '<div class="usect"><h4>plan window</h4>'+
    (limited
      ?'<div style="color:var(--bad)">session limit hit'+(s.rateLimit.type?' · '+s.rateLimit.type.replace(/_/g," "):"")+(reset?' · resets '+reset:"")+'</div><div class="ubar"><div style="width:100%;background:var(--bad)"></div></div>'
      :util!=null
      ?'<div>'+util+'% used'+(s.rateLimit.type?' · '+s.rateLimit.type.replace(/_/g," "):"")+(reset?' · resets '+reset:"")+'</div><div class="ubar"><div style="width:'+util+'%" class="'+(util>=80?"hot":"")+'"></div></div>'
      :'<div style="color:var(--faint)">no signal yet — appears after the next turn</div>')+
    '</div>'+
    '<div class="usect"><h4>session</h4><div>'+(s.turns||0)+' turns · ~$'+((s.costUsdTotal||0).toFixed(2))+' est</div></div>';
  document.body.appendChild(popEl);
  popEl.querySelectorAll(".modelopt").forEach(el=>el.onclick=async()=>{
    await apiPost("/api/model",{model:el.dataset.m});
    sfx.sent();popClose();void refreshStatus();
  });
  setTimeout(()=>document.addEventListener("click",function h(e){
    if(popEl&&!popEl.contains(e.target)&&e.target.id!=="modelchip"){popClose();document.removeEventListener("click",h)}
  }),50);
}

/* projects popover — what oracle is working on, and where */
let projEl=null;
function projClose(){if(projEl){projEl.remove();projEl=null}}
async function projOpen(){
  projClose();popClose();sfx.capture();
  const ps=await apiGet("/api/projects");
  projEl=document.createElement("div");projEl.id="projPop";
  projEl.innerHTML='<h4 style="margin:0 0 8px;font:10px var(--mono);letter-spacing:.2em;color:var(--faint)">PROJECTS</h4>'+
    (ps.map(p=>{
      const editable=p.kind==="game";
      return '<div class="proj'+(p.name===planProject?' on':'')+'" data-name="'+esc(p.name)+'" data-repo="'+esc(p.repo)+'" data-editable="'+editable+'">'
      +'<span class="pkind">'+esc(p.kind||"")+'</span><span class="pname">'+esc(p.name)+'</span>'
      +'<div class="ppath">'+esc(p.repo)+'</div>'
      +'<div class="pgit">'+esc(p.branch||"?")+' · '+esc(p.lastCommit||"no commits")
      +(p.dirty?' · <span class="pdirty">'+p.dirty+' dirty</span>':' · clean')+'</div>'
      +'<div class="prow" style="margin-top:8px">'
      +(editable?'<button class="pmini pchange">✎ make a change</button>':'')
      +'<button class="pmini preveal">reveal</button></div>'
      +'<div class="pcompose" style="display:none"><textarea placeholder="describe the change — Oracle stages it on a fresh branch, main stays safe"></textarea>'
      +'<button class="pbtn pstage">stage change on a branch →</button></div>'
      +'</div>';
    }).join("")||'<div style="color:var(--faint)">no projects registered</div>')
    +'<div id="projNew"><button class="pmini" id="projNewBtn">+ new project</button>'
    +'<div class="pnewform" style="display:none">'
    +'<div class="prow"><span class="pmini on" data-mode="new">create fresh</span><span class="pmini" data-mode="existing">existing folder</span></div>'
    +'<input class="pnew-name" placeholder="project name (e.g. cardforge)">'
    +'<input class="pnew-path" placeholder="/absolute/path/to/existing/repo" style="display:none">'
    +'<button class="pbtn" id="projCreate">create project →</button></div></div>';
  document.body.appendChild(projEl);
  projEl.querySelectorAll(".proj").forEach(card=>card.onclick=()=>{ if(card.dataset.name!==planProject) selectProject(card.dataset.name); projClose(); });
  projEl.querySelectorAll(".pcompose").forEach(c=>c.onclick=e=>e.stopPropagation());

  projEl.querySelectorAll(".preveal").forEach(el=>el.onclick=e=>{
    e.stopPropagation();const card=el.closest(".proj");
    fetch(BASE+"/api/reveal?p="+encodeURIComponent(card.dataset.repo)).catch(()=>{});sfx.sent();
  });
  projEl.querySelectorAll(".pchange").forEach(el=>el.onclick=e=>{
    e.stopPropagation();const comp=el.closest(".proj").querySelector(".pcompose");
    comp.style.display=comp.style.display==="none"?"flex":"none";
    if(comp.style.display!=="none")comp.querySelector("textarea").focus();
  });
  projEl.querySelectorAll(".pstage").forEach(el=>el.onclick=async e=>{
    e.stopPropagation();const card=el.closest(".proj");const ta=card.querySelector("textarea");
    const issue=ta.value.trim();if(!issue)return;
    projClose();
    // route through the main chat: Oracle judges difficulty, briefs context, dispatches
    $("#box").value="Make this change to "+card.dataset.name+": "+issue;
    autosize();send();
  });

  // new-project form
  const nf=projEl.querySelector(".pnewform");
  $("#projNewBtn").onclick=e=>{e.stopPropagation();nf.style.display=nf.style.display==="none"?"flex":"none";};
  let pmode="new";
  nf.querySelectorAll("[data-mode]").forEach(el=>el.onclick=e=>{
    e.stopPropagation();pmode=el.dataset.mode;
    nf.querySelectorAll("[data-mode]").forEach(x=>x.classList.toggle("on",x===el));
    nf.querySelector(".pnew-path").style.display=pmode==="existing"?"block":"none";
  });
  $("#projCreate").onclick=async e=>{
    e.stopPropagation();
    const name=nf.querySelector(".pnew-name").value.trim();
    const path=nf.querySelector(".pnew-path").value.trim();
    if(!name)return;
    e.target.disabled=true;e.target.textContent="creating…";
    const r=await apiPost("/api/project-create",{mode:pmode,name,path});
    sfx.reply();projClose();
    if(r.ok)bubble("oracle","✓ Project **"+name+"** ready at `"+r.repo+"` — open PROJECTS → ✎ to make your first change on a branch.","oracle · projects");
    else bubble("oracle","⚠️ "+(r.error||"could not create"),"error");
  };

  setTimeout(()=>document.addEventListener("click",function h2(e){
    if(projEl&&!projEl.contains(e.target)&&e.target.id!=="projbtn"){projClose();document.removeEventListener("click",h2)}
  }),50);
}

const BRAIN=[["__journal__","Journal","\ud83d\udcd3"],["log.md","Log","\ud83d\udcdc"],["MEMORY.md","Memory","\ud83e\udde0"],["__schedules__","Schedules","\u23f0"],["__growth__","Growth","\ud83c\udf31"],["PLAYBOOKS.md","Playbooks","\ud83d\udcd8"]];
let brainEl=null;
function brainClose(){if(brainEl){brainEl.remove();brainEl=null}}
function brainOpen(){
  brainClose();popClose();sfx.capture();
  brainEl=document.createElement("div");brainEl.id="brainPop";
  brainEl.innerHTML='<div class="bph">Brain</div>'+BRAIN.map(x=>'<div class="bpr'+(cur===x[0]?" on":"")+'" data-p="'+x[0]+'"><span class="bpi">'+x[2]+'</span>'+x[1]+'</div>').join("");
  document.body.appendChild(brainEl);
  const r=$("#brainbtn").getBoundingClientRect();brainEl.style.left=Math.min(r.left,window.innerWidth-236)+"px";brainEl.style.top=(r.bottom+6)+"px";
  brainEl.querySelectorAll(".bpr[data-p]").forEach(el=>el.onclick=()=>{setNavActive(null);cur=el.dataset.p;void refreshPane();brainClose();});
  setTimeout(()=>document.addEventListener("click",function h(e){if(brainEl&&!brainEl.contains(e.target)&&e.target.id!=="brainbtn"){brainClose();document.removeEventListener("click",h);}}),50);
}
{const bb=$("#brainbtn");if(bb)bb.onclick=(e)=>{e.stopPropagation();brainEl?brainClose():brainOpen()};}
{const pb=$("#projbtn");if(pb)pb.onclick=async(e)=>{e.stopPropagation();brainClose();if(projEl){projClose();return;}await projOpen();if(projEl){const r=pb.getBoundingClientRect();projEl.style.top=(r.bottom+6)+"px";projEl.style.left=Math.min(r.left,window.innerWidth-352)+"px";}setTimeout(()=>document.addEventListener("click",function h(ev){if(projEl&&!projEl.contains(ev.target)&&ev.target.id!=="projbtn"){projClose();document.removeEventListener("click",h);}}),50);};}
$("#modelchip").onclick=(e)=>{e.stopPropagation();popEl?popClose():void popOpen()};

/* agents rail — who is working right now */
async function refreshAgents(){
  try{
    const rail=$("#agents");if(!rail)return;
    const fx=await apiGet("/api/fixers");
    const live_fx=fx.filter(f=>f.status==="running"||f.status==="installing");
    const chip=$("#agentchip");
    if(chip){
      if(live_fx.length){chip.style.display="inline-flex";chip.textContent=live_fx.length+" building";chip.onclick=()=>{const t=document.querySelector('.nt[data-p="__fixers__"]');if(t)t.click();};}
      else chip.style.display="none";
    }
    const s=statusCache||{};
    const pills=[];
    if(s.busy)pills.push('<div class="agent master"><span class="adot"></span><span class="aid">oracle</span><span>working</span><span class="ameta">master session</span></div>');
    for(const f of live_fx){
      const mins=Math.max(0,Math.round((Date.now()-new Date(f.startedAt).getTime())/60000));
      pills.push('<div class="agent fxa" data-id="'+f.id+'"><span class="adot"></span><span class="aid">'+esc(f.title||f.id)+'</span><span>'+esc(f.game)+'</span><span class="ameta">'+mins+'m</span></div>');
    }
    const head=pills.length?'<div class="agenthead"><span>'+pills.length+' fix'+(pills.length>1?'es':'')+' running</span><button id="stopall">⏹ stop all</button></div>':"";
    rail.innerHTML=head+pills.join("");
    rail.classList.toggle("some",pills.length>0&&cur!=="__fixers__");
    rail.querySelectorAll(".fxa").forEach(el=>el.onclick=()=>{
      const t=document.querySelector('.nt[data-p="__fixers__"]');if(t)t.click();
    });
    const sa=$("#stopall");if(sa)sa.onclick=async()=>{sa.disabled=true;sa.textContent="stopping…";const r=await apiPost("/api/agents-stop-all",{});sfx.standby();bubble("oracle","⏹ Stopped "+(r.stopped||0)+" agent(s) and turned off auto mode.","oracle · stop");void refreshAgents();};
  }catch(e){}
}
setInterval(refreshAgents,5000);
setTimeout(refreshAgents,1200);

/* sidebar */
let cur="__fixers__";
function errorState(msg,retryFn){
  const id="rt"+Math.random().toString(36).slice(2,7);
  setTimeout(()=>{const b=document.getElementById(id);if(b)b.onclick=retryFn;},0);
  return '<div class="empty"><div class="emptyIcon">⚠️</div><div class="emptyTitle">Couldn’t load this</div><div class="emptyHint">'+esc(msg||"")+'</div><button class="emptyCta" id="'+id+'">Retry</button></div>';
}
function skeleton(){return '<div class="skel">'+Array(6).fill('<div class="skrow"></div>').join("")+'</div>';}
function emptyState(icon,title,hint,ctaLabel,ctaAttr){
  return '<div class="empty"><div class="emptyIcon">'+icon+'</div><div class="emptyTitle">'+esc(title)+'</div><div class="emptyHint">'+esc(hint)+'</div>'+(ctaLabel?'<button class="emptyCta" '+(ctaAttr||"")+'>'+esc(ctaLabel)+'</button>':'')+'</div>';
}
let autoAdv=localStorage.getItem("autoAdv")==="1";
async function renderController(){
  const bar=$("#autobar");if(!bar)return;
  if(cur&&/^(log\.md|MEMORY\.md|PLAYBOOKS\.md|__journal__|__growth__|__schedules__|__all__)$/.test(cur)){bar.innerHTML="";return;}
  let a={};try{a=(await apiGet("/api/auto"))[planProject]||{}}catch(e){}
  let mils=[];if(autoAdv){try{mils=await apiGet("/api/milestones?project="+encodeURIComponent(planProject))}catch(e){}}
  const mode=a.mode||(!a.on?"off":(a.autoMerge?"ship":"stage")),on=mode!=="off";
  const infl=a.inflight||0,staged=a.staged||0,todo=a.pending||0,live=infl>0;
  const done=a.done||0,total=a.total||0,pct=total?Math.round(100*done/total):0;
  const spend=+(a.spend||0),cap=a.spendCap||0,threads=a.maxConcurrent||2,model=a.model||"auto",focus=a.focus||"";
  const statusTxt=!on?"off":mode==="suggest"?"suggesting":live?"building":todo?"idle":"clear";
  let needs="";
  if(staged>0)needs+='<div class="acNeeds warn" data-needs="__artifacts__">\u25c6 '+staged+' staged \u2014 review & ship \u2192</div>';
  const failedN=(a.failed||0);if(failedN>0)needs+='<div class="acNeeds bad" data-needs="__fixers__">\u26a0 '+failedN+' failed \u2014 look \u2192</div>';
  let h='<div class="acDeck'+(on?"":" acOff")+'"><div class="acTop"><span class="acLabel">Auto \u00b7 '+esc(planProject)+'</span>'
    +'<span class="acStatus'+(live?" ok":"")+'">'+statusTxt+(on&&(infl||staged)?" \u00b7 "+infl+"\u25b6 "+staged+"\u25c6":"")+'</span>'
    +(live?'<span class="acKill" data-kill="1">\u23f9 kill</span>':'')
    +'<div class="acSA"><span class="'+(autoAdv?"":"on")+'" data-adv="0">Simple</span><span class="'+(autoAdv?"on":"")+'" data-adv="1">Advanced</span></div></div>';
  h+='<div class="acRow"><div class="acMode">'
    +[["off","Off"],["suggest","Suggest"],["stage","Stage"],["ship","Ship"]].map(m=>'<span class="acMo'+(mode===m[0]?" on":"")+'" data-mode="'+m[0]+'">'+m[1]+'</span>').join("")+'</div></div>';
  if(autoAdv){
    h+='<div class="acKnobs"><div class="acK"><span class="acKl">threads</span><div class="acStep"><b data-th="'+Math.max(1,threads-1)+'">\u2039</b><span>'+threads+'</span><b data-th="'+Math.min(4,threads+1)+'">\u203a</b></div>'+(threads>2?'<span class="acWarn" title="8GB machine \u2014 2-3 threads is safe">\u26a0</span>':'')+'</div>';
    h+='<div class="acK"><span class="acKl">model</span><div class="acChips">'+[["auto","auto"],["haiku","cheap"],["sonnet","balanced"],["opus","max"]].map(m=>'<span class="'+(model===m[0]?"on":"")+'" data-model="'+m[0]+'">'+m[1]+'</span>').join("")+'</div></div>';
    h+='<div class="acK"><span class="acKl">cap</span><div class="acChips warn">'+[0,2,5,10,20].map(n=>'<span class="'+(cap===n?"on":"")+'" data-cap="'+n+'">'+(n?"$"+n:"off")+'</span>').join("")+'</div>'+(spend?'<span class="acBurn">$'+spend.toFixed(2)+'</span>':'')+'</div>';
    const mopts='<option value="">whole roadmap</option>'+mils.map(m=>{const mid=(String(m.name).match(/^M\d+/i)||[m.name])[0];return '<option value="'+esc(mid)+'"'+(focus===mid?" selected":"")+'>'+esc(m.name)+'</option>';}).join("");
    h+='<div class="acK"><span class="acKl">focus</span><select class="acFocus">'+mopts+'</select></div><div class="acK"><span class="acKl">runs</span><span class="acSched">\u25f7 schedules \u2192</span></div></div>';
  }
  if(total)h+='<div class="acProg"><div class="acBar"><i style="width:'+pct+'%"></i></div><span class="acPct">'+done+'/'+total+'</span></div>';
  if(!on&&todo)h+='<div class="acNote">'+todo+' tasks in the roadmap \u2014 pick a mode to let Oracle build</div>';
  else if(a.note)h+='<div class="acNote">\u21b3 '+esc(a.note)+'</div>';
  h+='</div>';bar.innerHTML=h+needs;wireController();
}
function wireController(){
  const bar=$("#autobar");if(!bar)return;
  const post=async(patch)=>{await apiPost("/api/auto",{project:planProject,...patch});sfx.capture();void renderController();if(cur==="__fixers__")void renderFixers();};
  bar.querySelectorAll(".acSA span[data-adv]").forEach(el=>el.onclick=()=>{autoAdv=el.dataset.adv==="1";localStorage.setItem("autoAdv",autoAdv?"1":"0");void renderController();});
  bar.querySelectorAll(".acMo[data-mode]").forEach(el=>el.onclick=()=>post({mode:el.dataset.mode}));
  bar.querySelectorAll(".acStep b[data-th]").forEach(el=>el.onclick=()=>post({maxConcurrent:+el.dataset.th}));
  bar.querySelectorAll(".acChips span[data-model]").forEach(el=>el.onclick=()=>post({model:el.dataset.model}));
  bar.querySelectorAll(".acChips span[data-cap]").forEach(el=>el.onclick=()=>post({spendCap:+el.dataset.cap}));
  const foc=bar.querySelector(".acFocus");if(foc)foc.onchange=()=>post({focus:foc.value});
  bar.querySelectorAll(".acNeeds[data-needs]").forEach(el=>el.onclick=()=>goNav(el.dataset.needs));
  const sch=bar.querySelector(".acSched");if(sch)sch.onclick=()=>goNav("__schedules__");
  const kill=bar.querySelector(".acKill");if(kill)kill.onclick=async()=>{if(confirm("Stop all running fixers?")){try{await apiPost("/api/agents-stop-all",{})}catch(e){}void renderController();if(cur==="__fixers__")void renderFixers();}};
}
function autoPanel(project,c,allfx){
  const mode=c.mode||(!c.on?"off":(c.autoMerge?"ship":"stage"));
  const on=mode!=="off";
  const infl=c.inflight||0,staged=c.staged||0,todo=c.pending||0,live=infl>0;
  const spend=c.spend||0,cap=c.spendCap||0;
  const rungs=[["off","Off"],["suggest","Suggest"],["stage","Stage"],["ship","Ship"]];
  const ladder='<div class="apladder" title="Off · Suggest (propose only) · Stage (build, hold for review) · Ship (build + auto-merge)">'+rungs.map(r=>'<span class="aprung'+(mode===r[0]?" on":"")+'" data-apmode="'+r[0]+'" data-app="'+esc(project)+'">'+r[1]+'</span>').join("")+'</div>';
  let h='<div class="autopanel'+(on?"":" off")+'"><div class="aphead"><span class="apspark">\u26a1</span><span class="aptitle">auto \u00b7 '+esc(project)+'</span>'
    +(on?'<span class="apstate '+(live?"live":"")+'">'+(mode==="suggest"?"suggesting":(live?"building":(todo?"idle":"clear")))+'</span>':'<span class="apstate">off</span>')
    +'</div>'+ladder;
  if(!on){h+='<div class="apoffhint">'+todo+' tasks in the roadmap \u00b7 pick a mode to let Oracle build</div></div>';return h;}
  const capChips=[0,2,5,10,20].map(n=>'<span class="apcap'+(cap===n?" on":"")+'" data-apc="'+n+'" data-app="'+esc(project)+'">'+(n?"$"+n:"off")+'</span>').join(" ");
  const conc=[1,2,3,4].map(n=>'<span class="apconc'+(c.maxConcurrent===n?" on":"")+'" data-apn="'+n+'" data-app="'+esc(project)+'">\u00d7'+n+'</span>').join(" ");
  const pct=c.total?Math.round(c.done/c.total*100):0;
  const evs=[];
  allfx.filter(f=>f.game===project).forEach(f=>{
    if(f.status==="merged")evs.push({t:f.endedAt||f.startedAt,i:"\u2713",cls:"ok",x:"merged "+(f.title||f.id)});
    else if(f.status==="failed")evs.push({t:f.endedAt||f.startedAt,i:"\u26a0",cls:"bad",x:"failed "+(f.title||f.id)});
    else if(f.status==="running"||f.status==="installing")evs.push({t:f.startedAt,i:(f.redispatches>0?"\ud83d\udd01":"\u2192"),cls:"",x:((f.redispatches>0?"regenerating ":"building ")+(f.title||f.id))});
    else if(f.status==="done")evs.push({t:f.endedAt||f.startedAt,i:"\ud83c\udf3f",cls:"",x:"staged "+(f.title||f.id)});
  });
  evs.sort((a,b)=>new Date(b.t||0)-new Date(a.t||0));
  const feed=evs.slice(0,3).map(e=>'<div class="apev"><span class="apevi '+e.cls+'">'+e.i+'</span><span class="apet">'+esc(e.x)+'</span><span class="apago">'+timeAgo(e.t)+'</span></div>').join("");
  h+=(c.total?'<div class="apbar"><div style="width:'+pct+'%"></div></div>':'')
    +'<div class="apstats">'+infl+' running \u00b7 '+staged+' staged \u00b7 '+todo+' to do'+(c.total?' \u00b7 '+c.done+'/'+c.total+' roadmap':'')+' &nbsp;\u00b7&nbsp; parallel '+conc+'</div>'
    +'<div class="apspend">\ud83d\udcb0 spent $'+spend.toFixed(2)+(cap?' / $'+cap.toFixed(0):'')+' &nbsp;\u00b7&nbsp; cap '+capChips+'</div>'
    +(cap?'<div class="apbar cap'+(spend/cap>=.85?" hot":"")+'"><div style="width:'+Math.min(100,Math.round(spend/cap*100))+'%"></div></div>':'')
    +(c.note?'<div class="apnow">\u21b3 '+esc(c.note)+(c.at?' <span class="apago">'+timeAgo(c.at)+'</span>':'')+'</div>':'')
    +(feed?'<div class="apfeed">'+feed+'</div>':'')
    +'</div>';
  return h;
}
function wireAuto(){
  document.querySelectorAll(".aprung[data-apmode]").forEach(el=>el.onclick=async(e)=>{e.stopPropagation();await apiPost("/api/auto",{project:el.dataset.app,mode:el.dataset.apmode});sfx.capture();void renderFixers();});
  document.querySelectorAll(".apconc[data-apn]").forEach(el=>el.onclick=async(e)=>{e.stopPropagation();await apiPost("/api/auto",{project:el.dataset.app,maxConcurrent:+el.dataset.apn});sfx.capture();void renderFixers();});
  document.querySelectorAll(".apcap[data-apc]").forEach(el=>el.onclick=async(e)=>{e.stopPropagation();await apiPost("/api/auto",{project:el.dataset.app,spendCap:+el.dataset.apc});sfx.capture();void renderFixers();});
}
async function renderPlay(){
  let s={};try{s=await apiGet("/api/play?project="+encodeURIComponent(planProject)+"&action=status")}catch(e){}
  const open=(u)=>apiGet("/api/open?url="+encodeURIComponent(u)).catch(()=>{});
  const sub=s.starting?"\u25cf starting\u2026":s.running?"\u25cf running":s.kind==="cli"?"terminal game":s.playable?"ready to play":"no play interface yet";
  let html='<div class="playv"><div class="playhead"><span class="playicon">\u25b6</span><div class="playmeta"><div class="playname">'+esc(planProject)+'</div><div class="playsub">'+sub+'</div></div></div>';
  if(s.running&&s.url){
    html+='<div class="playcard"><div class="playurl">'+esc(s.url)+'</div><div class="playrow"><button class="playbtn open" data-url="'+esc(s.url)+'">Open \u2197</button><button class="playbtn stop">\u23f9 stop</button></div></div>';
  }else if(s.starting){
    html+='<div class="playcard"><div class="playspin"></div><div class="playhint">dev server booting \u2014 opens in your browser automatically when ready\u2026</div><div class="playrow"><button class="playbtn stop">\u23f9 cancel</button></div></div>';
  }else if(s.playable){
    html+='<div class="playcard"><button class="playbtn go" id="playGo">\u25b6 Play '+esc(planProject)+'</button><div class="playhint">runs the project\u2019s dev server and opens it in your browser</div></div>';
  }else if(s.kind==="cli"){
    html+='<div class="playcard"><div class="playurl">'+esc(planProject)+' is a terminal game</div><div class="playhint">it runs in a terminal (<code>npm run play</code>), not a browser. Have Oracle build a web UI so you can play it here.</div><div class="playrow"><button class="playbtn go" id="buildPlay2">\u25b6 Build a web UI</button></div></div>';
  }else{
    html+=emptyState("\ud83c\udfae","No play interface yet",esc(planProject)+" has no browser UI to play. Have Oracle build one \u2014 a minimal playable interface.","\u25b6 Build a play UI",'id="buildPlay"');
  }
  html+='</div>';
  $("#pane").innerHTML=html;
  if(s.starting)pollPlay();
  const go=$("#playGo");if(go)go.onclick=async()=>{go.textContent="starting\u2026";go.disabled=true;let r={};try{r=await apiGet("/api/play?project="+encodeURIComponent(planProject)+"&action=start")}catch(e){}if(r.url){open(r.url);setTimeout(renderPlay,900);}else if(r.starting){renderPlay();}else{go.textContent=r.error||"couldn\u2019t start";}};
  const op=$(".playbtn.open");if(op)op.onclick=()=>open(op.dataset.url);
  const sp=$(".playbtn.stop");if(sp)sp.onclick=async()=>{sp.textContent="stopping\u2026";playPoll=false;await apiGet("/api/play?project="+encodeURIComponent(planProject)+"&action=stop");void renderPlay();};
  const buildMsg=()=>{$("#box").value="Build a minimal browser play interface for "+planProject+": an index.html + Vite dev setup wired to the existing engine, so I can play it in a browser.";autosize();send();};
  const bp=$("#buildPlay");if(bp)bp.onclick=buildMsg;
  const bp2=$("#buildPlay2");if(bp2)bp2.onclick=buildMsg;
}
let playPoll=false;
async function pollPlay(){
  playPoll=true;const t0=Date.now();
  while(playPoll&&Date.now()-t0<150000){
    await new Promise(r=>setTimeout(r,1300));
    if(cur!=="__play__"){playPoll=false;return;}
    let s={};try{s=await apiGet("/api/play?project="+encodeURIComponent(planProject)+"&action=status")}catch(e){continue;}
    if(s.url){playPoll=false;apiGet("/api/open?url="+encodeURIComponent(s.url)).catch(()=>{});renderPlay();return;}
    if(!s.running){playPoll=false;renderPlay();return;}
  }
  playPoll=false;
}
async function setIssueStatus(path,line,status,check){
  let content="";try{content=(await apiGet("/api/vault?p="+encodeURIComponent(path))).content||""}catch(e){return;}
  const lines=content.split("\n");
  if(lines[line]!==undefined){
    if(check)lines[line]=lines[line].replace(/^(\s*-\s*)\[ \]/,"$1[x]");
    if(/\u2192\s*[\w -]+\s*$/.test(lines[line]))lines[line]=lines[line].replace(/\u2192\s*[\w -]+\s*$/,"\u2192 "+status);
    else lines[line]=lines[line].replace(/\s*$/,"")+" \u2192 "+status;
    try{await apiPost("/api/vault-write",{path,content:lines.join("\n")})}catch(e){}
  }
}
async function renderIssues(){
  const path="games/"+planProject+"/issues.md";
  let content="";try{content=(await apiGet("/api/vault?p="+encodeURIComponent(path))).content||""}catch(e){}
  if(!content||content==="(missing)"){$("#pane").innerHTML=emptyState("\ud83d\udc1e","No issues logged","Issues for this project appear here as they're filed \u2014 then dispatch a fix straight from one.");return;}
  const lines=content.split("\n"),issues=[];
  lines.forEach((ln,i)=>{
    const m=ln.match(/^\s*-\s*\[([ x])\]\s*#(\d+)\s+(\w+)\s+(\d+)\s+\u2014\s+(.*)$/);
    if(!m)return; let rest=m[5],status="open";
    const sm=rest.match(/\u2192\s*([\w -]+?)\s*$/); if(sm){status=sm[1].trim();rest=rest.slice(0,sm.index).trim();}
    let source=""; const cm=rest.match(/\(([^()]*)\)\s*$/); if(cm){source=cm[1];rest=rest.slice(0,cm.index).trim();}
    issues.push({line:i,n:m[2],type:m[3],sev:m[4],summary:rest,source,status:m[1]==="x"?"resolved":status});
  });
  const filt=window.__issFilter||"open";
  const shown=issues.filter(x=>filt==="all"||(filt==="open"&&x.status!=="resolved")||(filt==="resolved"&&x.status==="resolved"));
  let h='<div class="artsec">'+esc(planProject)+' \u2014 issues \u00b7 '+issues.filter(x=>x.status!=="resolved").length+' open</div>';
  h+='<div class="issfilters">'+["open","all","resolved"].map(f=>'<span class="issf'+(filt===f?" on":"")+'" data-filt="'+f+'">'+f+'</span>').join("")+'</div>';
  h+=shown.map(x=>'<div class="issue" data-status="'+esc(x.status.split(" ")[0])+'">'
    +'<div class="isstop"><span class="issnum">#'+x.n+'</span><span class="isstype '+esc(x.type)+'">'+esc(x.type)+'</span><span class="isssev">S'+x.sev+'</span><span class="issstatus '+esc(x.status.split(" ")[0])+'">'+esc(x.status)+'</span></div>'
    +'<div class="isssum">'+md(x.summary)+'</div>'+(x.source?'<div class="isssrc">'+esc(x.source)+'</div>':'')
    +(x.status!=="resolved"?'<div class="issact"><button class="issfix" data-n="'+x.n+'" data-line="'+x.line+'">\u26a1 Dispatch fix</button><button class="issdone" data-line="'+x.line+'">\u2713 resolve</button></div>':'')
    +'</div>').join("")||'<div style="color:var(--faint);padding:8px">no '+filt+' issues</div>';
  $("#pane").innerHTML=h;
  $("#pane").querySelectorAll(".issf[data-filt]").forEach(el=>el.onclick=()=>{window.__issFilter=el.dataset.filt;void renderIssues();});
  $("#pane").querySelectorAll(".issfix").forEach(el=>el.onclick=async()=>{
    const x=issues.find(v=>v.n===el.dataset.n);el.textContent="dispatching\u2026";el.disabled=true;
    try{await apiPost("/api/fix",{project:planProject,issue:"#"+x.n+" "+x.type+" \u2014 "+x.summary+(x.source?" ("+x.source+")":"")});
      await setIssueStatus(path,+el.dataset.line,"building");
      bubble("oracle","\u26a1 Dispatched a fix for issue #"+x.n+" \u2014 track it in Fixes.","oracle \u00b7 fix");
      void renderIssues();void renderController();
    }catch(e){el.textContent="couldn\u2019t dispatch";}
  });
  $("#pane").querySelectorAll(".issdone").forEach(el=>el.onclick=async()=>{await setIssueStatus(path,+el.dataset.line,"resolved",true);void renderIssues();});
}
async function renderFixers(){
  const _sc=$("#pane")?$("#pane").scrollTop:0;
  const all0=await apiGet("/api/fixers");
  const all=all0.filter(f=>f.game===planProject);
  let autos={};try{autos=await apiGet("/api/auto")}catch(e){}
  let milestones=[];try{milestones=await apiGet("/api/milestones?project="+encodeURIComponent(planProject))}catch(e){}
  const autoHtml=autoPanel(planProject,autos[planProject]||{on:false,maxConcurrent:2,autoMerge:false,mode:"off",inflight:0,staged:0,pending:0,done:0,total:0,spend:0},all0);
  const fx=all.filter(f=>f.status!=="superseded");
  if(!milestones.length&&!fx.length){$("#pane").innerHTML=emptyState("\ud83c\udf3f","No missions yet","Turn on Auto in Plan to let Oracle build the roadmap, or open a Plan task to dispatch one.","Open Plan \u2192",'id="emptyPlan"');wireAuto();const ep=$("#emptyPlan");if(ep)ep.onclick=()=>{const t=document.querySelector('.nt[data-p="__plan__"]');if(t)t.click();};return}
  // JOURNEY — milestones are waypoints; the active milestone's fixes are the mission log
  const nowFx=fx.filter(f=>["running","installing","done","failed","queued"].includes(f.status));
  let activeIdx=-1; const _grp=(nowFx.find(f=>f.group)||{}).group||""; const _mn=_grp.match(/M\s*(\d+)/i);
  if(_mn)activeIdx=milestones.findIndex(m=>new RegExp("^M"+_mn[1]+"\\b","i").test(m.name));
  if(activeIdx<0)for(let k=milestones.length-1;k>=0;k--){if(milestones[k].done<milestones[k].total){activeIdx=k;break;}}
  if(activeIdx<0)activeIdx=Math.max(0,milestones.length-1);
  const recentMerged=fx.filter(f=>f.status==="merged").sort((a,b)=>new Date(b.endedAt||0)-new Date(a.endedAt||0)).slice(0,3);
  const rank={running:0,installing:0,done:1,failed:2,queued:3};
  const activeFx=[...nowFx.sort((a,b)=>(rank[a.status]??9)-(rank[b.status]??9)),...recentMerged].slice(0,7);
  const readyN=fx.filter(f=>f.status==="done").length;
  const logIcon=(f)=>f.status==="done"?"\ud83c\udf3f":f.status==="merged"?"\u2713":f.status==="failed"?"\u26a0":f.status==="queued"?"\u25cb":((f.redispatches||0)>0?"\ud83d\udd01":"\u2699");
  const logRow=(f)=>{const st=f.status==="done"?"staged":f.status==="merged"?(timeAgo(f.endedAt||f.startedAt)||"merged"):f.status==="failed"?"failed":f.status==="queued"?"queued":"building";
    return '<div class="jle'+((f.status==="running"||f.status==="installing")?" b":"")+'" data-fx="'+f.id+'" data-st="'+f.status+'"><span class="jli">'+logIcon(f)+'</span><span class="jlt">'+esc(f.title||f.id)+'</span><span class="jlx">'+st+'</span></div>';};
  let jr='<div class="journey">';
  milestones.forEach((m,idx)=>{
    const state=idx<activeIdx?"done":idx===activeIdx?"here":"up";
    jr+='<div class="jnode '+state+'"><span class="jnd"></span><div class="jnc"><div class="jwp">'+(state==="here"?"\u25c6 ":state==="up"?"\u25c7 ":"")+esc(m.name)+(state==="here"?" \u2014 you are here":"")+'</div>'
      +(state==="here"?'<div class="jsub">'+m.done+' of '+m.total+' complete'+(readyN?' \u00b7 '+readyN+' ready to ship':"")+'</div>':"")+'</div></div>';
    if(state==="here")jr+='<div class="jlog">'+(activeFx.length?activeFx.map(logRow).join(""):'<div class="jle"><span class="jli">\u00b7</span><span class="jlt" style="color:var(--faint);white-space:normal;overflow:visible">no active missions \u2014 dispatch one from Plan</span></div>')
      +(readyN?'<button class="jmerge" data-proj="'+esc(planProject)+'">\ud83c\udf3f review &amp; ship '+readyN+' ready</button>':"")+'</div>';
  });
  jr+='</div>';
  $("#pane").innerHTML=jr;$("#pane").scrollTop=_sc<40?0:_sc;
  $("#pane").querySelectorAll(".jle[data-fx]").forEach(el=>el.onclick=()=>{el.dataset.st==="done"?openMergeModal(el.dataset.fx):openFixerView(el.dataset.fx);});
  const jm=$("#pane").querySelector(".jmerge");if(jm)jm.onclick=()=>{const r=fx.find(f=>f.status==="done");if(r)openMergeModal(r.id);};
}

/* the big deliberate gate: review the diff, then send to main */
function fmtDiff(d){
  return esc(d).split("\n").map(l=>{
    if(l.startsWith("+")&&!l.startsWith("+++"))return '<span class="da">'+l+'</span>';
    if(l.startsWith("-")&&!l.startsWith("---"))return '<span class="dd">'+l+'</span>';
    if(l.startsWith("@@")||l.startsWith("diff ")||l.startsWith("index "))return '<span class="dh">'+l+'</span>';
    if(l.startsWith("+++")||l.startsWith("---"))return '<span class="dm">'+l+'</span>';
    return l;
  }).join("\n");
}
let mergeEl=null;
function mergeClose(){if(mergeEl){mergeEl.remove();mergeEl=null}}
async function openMergeModal(id){
  mergeClose();sfx.capture();
  let d;
  try{d=await apiGet("/api/fixer-diff?id="+id)}catch(e){bubble("oracle","⚠️ diff unavailable","error");return}
  mergeEl=document.createElement("div");mergeEl.id="mergeWrap";
  mergeEl.innerHTML='<div id="mergeCard">'
    +'<div id="mergeHead"><h3>Review change — '+esc(d.game)+'</h3>'
    +'<div class="mroute">🌿 <b>'+esc(d.branch)+'</b> → merging into <b>'+esc(d.target)+'</b></div>'
    +'<div id="mergeSafe">Nothing has touched '+esc(d.target)+' yet. This is your explicit go/no-go.</div></div>'
    +'<div id="mergeDiff">'+(d.diff.trim()?fmtDiff(d.diff):"(no textual diff)")+'</div>'
    +'<div id="mergeFoot"><span id="mergeStat">'+esc(d.diffstat.split("\n").pop()||"")+(d.truncated?" · diff truncated":"")+'</span>'
    +'<button id="mergeCancel">Cancel</button>'
    +'<button id="mergeGo">⚠️ Merge into '+esc(d.target)+'</button></div></div>';
  document.body.appendChild(mergeEl);
  mergeEl.onclick=e=>{if(e.target===mergeEl)mergeClose()};
  $("#mergeCancel").onclick=mergeClose;
  $("#mergeGo").onclick=async()=>{
    const go=$("#mergeGo");go.classList.add("busy");go.textContent="merging…";
    const r=await apiPost("/api/send",{message:"/approve "+id});
    sfx.reply();mergeClose();
    bubble("oracle",r.text||"merged","oracle · merge");
    void renderFixers();void refreshStatus();
  };
  document.addEventListener("keydown",function esc(e){if(e.key==="Escape"){mergeClose();document.removeEventListener("keydown",esc)}});
}
/* click a fixer → watch its full transcript in the main chat area */
let fixerViewId=null,fixerPoll=null;
function fmtTs(ts){try{return new Date(ts).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}catch(e){return""}}
/* group merge — confirm/decline gate over the whole group's ready fixes */
async function openGroupMergeModal(project,group){
  mergeClose();sfx.capture();
  const fx=(await apiGet("/api/fixers")).filter(f=>f.game===project&&f.group===group&&f.status==="done");
  if(!fx.length){bubble("oracle","nothing ready to merge in that group","oracle · group");return;}
  mergeEl=document.createElement("div");mergeEl.id="mergeWrap";
  const rows=fx.map(f=>{
    const dc=(f.diffstat||"").split("\n").pop()||"";
    return '<div class="gmrow"><span class="gmt">'+esc(f.title||f.id)+'</span><span class="gmd">'+esc(dc)+'</span></div>';
  }).join("");
  mergeEl.innerHTML='<div id="mergeCard">'
    +'<div id="mergeHead"><h3>Merge group — '+esc(group)+'</h3>'
    +'<div class="mroute">▨ <b>'+fx.length+'</b> ready fix'+(fx.length>1?'es':'')+' → each rebased onto latest main, checked, then merged in order</div>'
    +'<div id="mergeSafe">Nothing has touched main yet. This is your explicit go/no-go for the whole group.</div></div>'
    +'<div id="mergeDiff" style="white-space:normal">'+rows+'</div>'
    +'<div id="mergeFoot"><span id="mergeStat">'+fx.length+' fix'+(fx.length>1?'es':'')+' · sequential merge queue</span>'
    +'<button id="mergeCancel">Decline</button>'
    +'<button id="mergeGo">⚠️ Merge '+fx.length+' to main</button></div></div>';
  document.body.appendChild(mergeEl);
  mergeEl.onclick=e=>{if(e.target===mergeEl)mergeClose()};
  $("#mergeCancel").onclick=mergeClose;
  $("#mergeGo").onclick=async()=>{
    const go=$("#mergeGo");go.classList.add("busy");go.textContent="merging…";
    const r=await apiPost("/api/group-merge",{project,group});
    sfx.reply();mergeClose();
    bubble("oracle",r.text||"merged","oracle · group");
    void renderFixers();void refreshStatus();
  };
  document.addEventListener("keydown",function esc(e){if(e.key==="Escape"){mergeClose();document.removeEventListener("keydown",esc)}});
}
async function openFixerView(id){
  fixerViewId=id;clearInterval(fixerPoll);
  const render=async()=>{
    if(fixerViewId!==id)return null;
    const d=await apiGet("/api/fixer-log?id="+id);
    const f=d.fixer||{};
    const col=f.status==="done"?"var(--ok)":f.status==="failed"?"var(--bad)":f.status==="merged"?"var(--acc)":"var(--warn)";
    let html='<div class="fxvhead"><button class="fxvback">← conversation</button>'
      +'<span class="fxvtitle">'+esc(f.title||id)+' · '+esc(f.game||"")+'</span>'
      +((f.status==="running"||f.status==="installing")?'<button class="fxvstop" data-stop="'+id+'">⏹ stop</button>':"")
      +'<span class="fxvchip" style="color:'+col+';border-color:'+col+'">'+esc((f.status||"").toUpperCase())+'</span></div>';
    for(const e of d.entries){
      if(e.kind==="assistant")html+='<div class="msg oracle"><span class="meta">'+esc(id)+' · '+fmtTs(e.ts)+'</span><span class="md">'+md(e.text)+'</span></div>';
      else if(e.kind==="tool")html+='<div class="fxvtool">→ '+esc(e.text)+'</div>';
      else if(e.text.startsWith("STEER:"))html+='<div class="msg user fxvsteer"><span class="meta">you · steer</span>'+esc(e.text.slice(6).trim())+'</div>';
      else html+='<div class="fxvsys">'+esc(e.text)+'</div>';
    }
    if(!d.entries.length)html+='<div class="fxvsys">no activity logged yet — the fixer is warming up…</div>';
    if(d.steerable)html+='<div id="fxsteerbar"><input id="fxsteerin" placeholder="steer this fixer — e.g. use the existing helper, wrong file, also update tests…" autocomplete="off"><button id="fxsteergo">steer →</button></div>';
    const chat=$("#chat");const atBottom=chat.scrollHeight-chat.scrollTop-chat.clientHeight<120;
    const keepFocus=document.activeElement&&document.activeElement.id==="fxsteerin";const keepVal=keepFocus?document.activeElement.value:"";
    chat.innerHTML=html;polishCode(chat);
    $(".fxvback").onclick=exitFixerView;
    const vs=$(".fxvstop");if(vs)vs.onclick=async()=>{vs.disabled=true;vs.textContent="stopping…";await apiPost("/api/fixer-stop",{id});sfx.standby();void render();};
    if(d.steerable){
      const inp=$("#fxsteerin");
      if(keepFocus){inp.value=keepVal;inp.focus();}
      const doSteer=async()=>{
        const t=inp.value.trim();if(!t)return;inp.value="";
        await apiPost("/api/fixer-steer",{id,text:t});sfx.sent();
        void render();
      };
      $("#fxsteergo").onclick=doSteer;
      inp.onkeydown=(e)=>{if(e.key==="Enter"){e.preventDefault();doSteer()}};
    }
    if(atBottom&&!keepFocus)chat.scrollTop=1e9;
    return f.status;
  };
  const st=await render();
  if(st==="running"||st==="installing"){
    fixerPoll=setInterval(async()=>{
      const s=await render();
      if(s&&s!=="running"&&s!=="installing")clearInterval(fixerPoll);
    },3000);
  }
}
async function exitFixerView(){
  fixerViewId=null;clearInterval(fixerPoll);
  await loadHistory();
}
function timeAgo(ts){const t=ts?new Date(ts).getTime():NaN;if(!t||isNaN(t))return"";const s=Math.max(0,(Date.now()-t)/1000);return s<60?"just now":s<3600?Math.round(s/60)+"m ago":Math.round(s/3600)+"h ago"}
let planProject=localStorage.getItem("planProject")||"shipless";
async function renderPlan(){
  const ps=(await apiGet("/api/projects")).filter(p=>p.kind==="game");
  if(!ps.some(p=>p.name===planProject))planProject=ps.length?ps[0].name:"shipless";
  const pills=ps.map(p=>'<span class="planpill'+(p.name===planProject?" on":"")+'" data-p="'+esc(p.name)+'">'+esc(p.name)+'</span>').join("");
  const r=await apiGet("/api/vault?p="+encodeURIComponent("plans/"+planProject+".md"));
  const has=r.content&&r.content!=="(missing)"&&r.content.trim();
  let body;
  if(!has){
    body='<div class="planempty">no roadmap for <b>'+esc(planProject)+'</b> yet.<br>ask Oracle to co-build it with you.'
      +'<br><button class="pbtn" id="planstart">plan '+esc(planProject)+' →</button></div>';
  }else{
    const done=(r.content.match(/^\s*[-*]\s*\[x\]/gim)||[]).length;
    const todo=(r.content.match(/^\s*[-*]\s*\[ \]/gim)||[]).length;
    const total=done+todo,pct=total?Math.round(done/total*100):0;
    body='<div id="planprog"><span>'+done+'/'+total+' tasks</span><div class="pbar"><div style="width:'+pct+'%"></div></div><span>'+pct+'%</span></div>'
      +'<div id="planbody" class="md">'+md(r.content)+'</div>';
  }
  let fxs=[],af={};try{fxs=(await apiGet("/api/fixers")).filter(f=>f.game===planProject);af=(await apiGet("/api/auto"))[planProject]||{};}catch(e){}
  $("#pane").innerHTML=body;
  polishCode($("#pane"));
  const st=$("#planstart");if(st)st.onclick=()=>{$("#box").value="Let's plan "+planProject+" \u2014 read plans/"+planProject+".md (create it if missing) and propose a roadmap: 3-6 milestones broken into concrete tasks.";autosize();send();};
  // milestone headings \u2192 focus-auto-here
  $("#pane").querySelectorAll("#planbody h1,#planbody h2,#planbody h3").forEach(h=>{
    const mm=h.textContent.match(/^\s*(M\d+)\b/i);if(!mm)return;
    const mid=mm[1].toUpperCase(),focused=String(af.focus||"").toUpperCase()===mid;
    const btn=document.createElement("button");btn.className="mfocus"+(focused?" on":"");btn.textContent=focused?"\u25ce focused":"\u25ce focus";
    btn.onclick=async(e)=>{e.stopPropagation();await apiPost("/api/auto",{project:planProject,focus:focused?"":mid});sfx.capture();void renderPlan();void renderController();};
    h.appendChild(btn);
  });
  // tasks \u2192 status chip (matched to a fixer) or build-on-click
  $("#pane").querySelectorAll("#planbody li").forEach(li=>{
    const box=li.querySelector('input[type=checkbox]');if(!box)return;
    li.classList.add("taskitem");
    const txt=li.textContent.trim().toLowerCase();
    const f=box.checked?null:fxs.find(f=>{const t=(f.task||f.title||"").toLowerCase();return t&&t.length>10&&(txt.includes(t.slice(0,26))||t.includes(txt.slice(0,26)));});
    if(box.checked){li.classList.add("tdone");}
    else if(f){const s=f.status,chip=document.createElement("span");chip.className="tstat "+s;chip.textContent=s==="done"?"staged":s==="merged"?"merged":s==="failed"?"failed":"building";chip.dataset.fx=f.id;li.appendChild(chip);li.classList.add("tbuilding");}
    else{li.classList.add("todo");li.onclick=()=>{$("#box").value="Let's do this next on "+planProject+": "+li.textContent.trim();autosize();send();};}
  });
}

async function renderGrowth(){
  const items=await apiGet("/api/growth");
  if(!items.length){$("#pane").innerHTML=emptyState("\ud83c\udf31","No self-changes yet","What Oracle learns about itself \u2014 memory, skills, soul \u2014 appears here as it grows.");return;}
  $("#pane").innerHTML='<div class="artsec">Self-improvement \u00b7 '+items.length+' recent changes</div>'+items.map(x=>'<div class="growrow"><span class="growmsg">'+esc(x.msg)+'</span><span class="growago">'+timeAgo(x.at)+'</span></div>').join("");
}
async function renderSchedules(){
  const s=await apiGet("/api/schedules");
  const nx=(iso)=>{if(!iso)return"";const ms=new Date(iso)-Date.now();if(ms<0)return"soon";const h=Math.floor(ms/3600000),m=Math.round((ms%3600000)/60000);return h?"in "+h+"h "+m+"m":"in "+m+"m";};
  $("#pane").innerHTML='<div class="artsec">Oracle\u2019s routines \u00b7 '+s.length+'</div>'+s.map(x=>'<div class="schedcard"><div class="schedtop"><span class="schedname">'+esc(x.name)+'</span><span class="schednext">'+nx(x.next)+'</span></div><div class="schedwhen">\u23f0 '+esc(x.when)+'</div><div class="scheddesc">'+esc(x.desc)+'</div></div>').join("");
}
async function renderArtifacts(){
  const a=await apiGet("/api/artifacts?project="+encodeURIComponent(planProject));
  const changes=a.changes||[],files=a.files||[];
  const fmtDiff=(d)=>{if(!d)return"";const m=d.match(/(\d+) files? changed(?:, (\d+) insertion)?(?:[^,]*, (\d+) deletion)?/);if(!m)return"";const p=[];if(m[2])p.push("+"+m[2]);if(m[3])p.push("\u2212"+m[3]);return m[1]+" file"+(m[1]==="1"?"":"s")+(p.length?" \u00b7 "+p.join(" "):"");};
  const filesN=(d)=>{const m=(d||"").match(/(\d+) files? changed/);return m?+m[1]:0;};
  if(!changes.length&&!files.length){$("#pane").innerHTML=emptyState("\ud83d\udce6","No artifacts yet","Merged fixes, diffs and exports for "+esc(planProject)+" collect here as Oracle builds.");return;}
  const staged=changes.filter(c=>c.status==="done"),merged=changes.filter(c=>c.status==="merged");
  const card=(c,kind)=>{const fn=filesN(c.diffstat),risk=fn>=8?"hi":fn>=4?"md":"",dc=fmtDiff(c.diffstat);
    const act=kind==="stg"?'<div class="artact"><button class="artrevise" data-id="'+c.id+'" data-title="'+esc(c.title)+'">\u270e revise</button></div>':'<div class="artact"><button class="artrevert" data-id="'+c.id+'" data-title="'+esc(c.title)+'">\u21a9 revert</button></div>';
    return '<div class="artcard'+(kind==="stg"?" stg":"")+'" data-id="'+c.id+'" data-status="'+c.status+'"><div class="artop"><span class="artname">'+esc(c.title)+'</span><span class="artchip '+kind+'">'+(kind==="stg"?"review":"merged")+'</span></div><div class="artmeta">'+(dc?'<span class="artrisk '+risk+'">'+dc+'</span> \u00b7 ':"")+(c.costUsd?"~$"+c.costUsd.toFixed(2)+" \u00b7 ":"")+(c.model?esc(c.model)+" \u00b7 ":"")+timeAgo(c.endedAt)+'</div>'+act+'</div>';};
  const spendT=changes.reduce((s,x)=>s+(x.costUsd||0),0),perFix=changes.length?spendT/changes.length:0;
  let html='<div class="artmetrics"><span><b>$'+spendT.toFixed(2)+'</b> spent</span><span><b>$'+perFix.toFixed(2)+'</b>/change</span><span><b>'+merged.length+'</b> merged</span><span><b>'+staged.length+'</b> to review</span></div>';
  if(staged.length){
    const groups={};staged.forEach(c=>{(groups[c.group||"other"]=groups[c.group||"other"]||[]).push(c);});
    html+='<div class="artsec">Review queue \u00b7 '+staged.length+' staged</div>';
    for(const g of Object.keys(groups)){const cs=groups[g];
      html+='<div class="artgrp"><span class="artgl">'+esc(g)+' \u00b7 '+cs.length+'</span><button class="artship" data-grp="'+esc(g)+'">\u26a1 Ship '+cs.length+'</button></div>';
      html+=cs.map(c=>card(c,"stg")).join("");}
  }
  if(merged.length){html+='<div class="artsec">Merged \u00b7 '+merged.length+'</div>'+merged.slice(0,20).map(c=>card(c,"mrg")).join("");}
  if(files.length){html+='<div class="artsec">Files & exports \u00b7 '+files.length+'</div>'+files.map(f=>'<div class="artfile"><span class="artfk">'+esc(f.kind)+'</span><span class="artfn">'+esc(f.name)+'</span><span class="artfm">'+Math.max(1,Math.round(f.size/1024))+'kb \u00b7 '+timeAgo(f.mtime)+'</span></div>').join("");}
  $("#pane").innerHTML=html;
  $("#pane").querySelectorAll('.artcard[data-status="done"]').forEach(c=>c.onclick=()=>openMergeModal(c.dataset.id));
  $("#pane").querySelectorAll('.artcard[data-status="merged"]').forEach(c=>c.onclick=()=>openFixerView(c.dataset.id));
  $("#pane").querySelectorAll('.artrevise').forEach(bt=>bt.onclick=async(e)=>{e.stopPropagation();const c=prompt("What should change about \u201c"+bt.dataset.title+"\u201d?");if(!c)return;try{await apiPost("/api/fix",{project:planProject,issue:"Revise the staged change \u201c"+bt.dataset.title+"\u201d (fixer "+bt.dataset.id+"): "+c+" \u2014 build on that branch's intent but incorporate this feedback."});bubble("oracle","\u270e Revising \u201c"+bt.dataset.title+"\u201d with your note \u2014 track it in Fixes.","oracle \u00b7 revise");}catch(e){}void renderController();});
  $("#pane").querySelectorAll('.artrevert').forEach(bt=>bt.onclick=async(e)=>{e.stopPropagation();if(!confirm("Dispatch a fix to REVERT \u201c"+bt.dataset.title+"\u201d?"))return;try{await apiPost("/api/fix",{project:planProject,issue:"Revert the merged change \u201c"+bt.dataset.title+"\u201d (fixer "+bt.dataset.id+") \u2014 undo it safely (git revert its commits if identifiable, else carefully reverse), keep tests green."});bubble("oracle","\u21a9 Dispatched a revert of \u201c"+bt.dataset.title+"\u201d \u2014 review it in Fixes.","oracle \u00b7 revert");}catch(e){}void renderController();});
  $("#pane").querySelectorAll('.artship').forEach(bt=>bt.onclick=async(e)=>{e.stopPropagation();if(!confirm("Rebase + test + merge all staged in \u201c"+bt.dataset.grp+"\u201d?"))return;bt.textContent="shipping\u2026";bt.disabled=true;try{const r=await apiPost("/api/group-merge",{project:planProject,group:bt.dataset.grp});bubble("oracle","\u26a1 "+(r.text||"shipped "+bt.dataset.grp)+" \u2014 \u25b6 play to verify.","oracle \u00b7 ship");}catch(e){}void renderArtifacts();void renderController();});
}

async function editVault(rel){
  let content="";try{const r=await apiGet("/api/vault?p="+encodeURIComponent(rel));content=(r.content&&r.content!=="(missing)")?r.content:"";}catch(e){}
  $("#pane").innerHTML='<div class="vedit"><div class="vedhead">editing <b>'+esc(rel)+'</b></div><textarea id="vedTa" spellcheck="false"></textarea><div class="vedbar"><button id="vedCancel">cancel</button><button id="vedSave">save</button></div></div>';
  $("#vedTa").value=content;$("#vedTa").focus();
  $("#vedCancel").onclick=()=>void refreshPane();
  $("#vedSave").onclick=async()=>{const s=$("#vedSave");s.disabled=true;s.textContent="saving…";try{await apiPost("/api/vault-write",{path:rel,content:$("#vedTa").value});sfx.sent();}catch(e){}void refreshPane();};
}
async function refreshPane(){
  const _sk=setTimeout(()=>{const pn=$("#pane");if(pn&&!pn.dataset.busy)pn.innerHTML=skeleton();},220);
  void renderController();
  try{
    if(cur==="__all__")return await renderDashboard();
    if(cur==="__plan__")return await renderPlan();
    if(cur==="__fixers__")return await renderFixers();
    if(cur==="__play__")return await renderPlay();
    if(cur==="__artifacts__")return await renderArtifacts();
    if(cur==="__issues__")return await renderIssues();
    if(cur==="__schedules__")return await renderSchedules();
    if(cur==="__growth__")return await renderGrowth();
    const p=cur==="__journal__"?("journal/"+new Date().toLocaleDateString("en-CA")+".md")
      :cur==="__issues__"?("games/"+planProject+"/issues.md"):cur;
    const r=await apiGet("/api/vault?p="+encodeURIComponent(p));
    if(!(r.content&&r.content!=="(missing)")){const nm={"__issues__":["\ud83d\udc1e","No issues logged","Issues for this project appear here as they're filed."],"__journal__":["\ud83d\udcd3","Journal is empty","Daily notes land here; Oracle files durable facts into Memory nightly."],"log.md":["\ud83d\udcdc","No log yet","Oracle's activity log fills as it works."],"MEMORY.md":["\ud83e\udde0","Memory is empty","Durable facts Oracle learns collect here — or add your own with edit."],"PLAYBOOKS.md":["\ud83d\udcd8","No playbooks yet","How-to memory: reusable procedures Oracle (or you) can write here."]};const e2=nm[cur]||["\u2728","Nothing here yet","It fills itself as Oracle works."];$("#pane").innerHTML=emptyState(e2[0],e2[1],e2[2]);polishCode($("#pane"));return}
    let c=r.content;
    if(cur==="log.md")c=c.split("\n").slice(-80).join("\n");
    $("#pane").innerHTML=md(c);
    polishCode($("#pane"));
    if(cur==="MEMORY.md"||cur==="PLAYBOOKS.md"){const eb=document.createElement("button");eb.className="vedbtn";eb.textContent="✎ edit";eb.onclick=()=>void editVault(cur);$("#pane").insertBefore(eb,$("#pane").firstChild);}
    if(cur==="log.md")$("#pane").scrollTop=1e9;
  }catch(e){$("#pane").innerHTML=errorState((e&&e.message)||String(e),()=>void refreshPane());}
  finally{clearTimeout(_sk);}
}

let lastBuildTab=localStorage.getItem("lastBuildTab")||"__fixers__";
function syncNav(p){
  const sec=p==="__play__"?"play":(["__fixers__","__plan__","__issues__","__artifacts__"].includes(p)?"build":null);
  const nb=$("#navBuild"),np=$("#navPlay"),sb=$("#subBuild"),sp=$("#subPlay");
  if(nb)nb.classList.toggle("on",sec==="build");
  if(np)np.classList.toggle("on",sec==="play");
  if(sb)sb.classList.toggle("hide",sec==="play");
  if(sp)sp.classList.toggle("hide",sec!=="play");
}
function setNavActive(p){
  document.querySelectorAll(".nt").forEach(x=>x.classList.toggle("on",x.dataset.p===p));
  syncNav(p);
}
document.querySelectorAll(".nt").forEach(t=>{t.onkeydown=(e)=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();t.click();}};});
function goNav(p){
  setNavActive(p);cur=p;void renderController();
  if(["__fixers__","__plan__","__issues__","__artifacts__"].includes(p)){lastBuildTab=p;localStorage.setItem("lastBuildTab",p);}
  {const pn=$("#projName");if(pn&&pn.textContent==="ALL PROJECTS")pn.textContent=planProject;}
  void refreshPane();
}
document.querySelectorAll(".nt").forEach(t=>t.onclick=()=>goNav(t.dataset.p));
{const nb=$("#navBuild");if(nb)nb.onclick=()=>goNav(lastBuildTab);
 const np=$("#navPlay");if(np)np.onclick=()=>goNav("__play__");}
/* v2 — rail project switcher + all-projects dashboard */
function selectProject(name){planProject=name;localStorage.setItem("planProject",name);void renderController();{const pn=$("#projName");if(pn)pn.textContent=name;}if(cur==="__all__"){cur="__fixers__";setNavActive("__fixers__");}void refreshPane();}
function showAllProjects(){cur="__all__";{const pn=$("#projName");if(pn)pn.textContent="ALL PROJECTS";}document.querySelectorAll(".nt").forEach(x=>x.classList.remove("on"));void refreshPane();}
async function openProjMenu(){
  const ex=$("#projMenu");if(ex){ex.remove();return;}
  const ps=(await apiGet("/api/projects")).filter(p=>p.kind==="game");
  const menu=document.createElement("div");menu.id="projMenu";
  menu.innerHTML=ps.map(p=>'<div class="pmrow'+(p.name===planProject&&cur!=="__all__"?" on":"")+'" data-p="'+esc(p.name)+'"><span class="pmdot"></span>'+esc(p.name)+'</div>').join("")
    +'<div class="pmrow all'+(cur==="__all__"?" on":"")+'" data-all="1"><span class="pmdot"></span>all projects</div>';
  document.body.appendChild(menu);
  const r=$("#projSwitch").getBoundingClientRect();menu.style.left=r.left+"px";menu.style.top=(r.bottom+4)+"px";
  menu.querySelectorAll(".pmrow[data-p]").forEach(el=>el.onclick=()=>{selectProject(el.dataset.p);menu.remove();});
  menu.querySelector(".pmrow.all").onclick=()=>{showAllProjects();menu.remove();};
  const close=(e)=>{if(e.type==="keydown"&&e.key!=="Escape")return;if(e.type==="click"&&(menu.contains(e.target)||e.target.id==="projSwitch"))return;menu.remove();document.removeEventListener("click",close);document.removeEventListener("keydown",close);};
  setTimeout(()=>{document.addEventListener("click",close);document.addEventListener("keydown",close);},0);
}
{const sw=$("#projSwitch");if(sw)sw.onclick=(e)=>{e.stopPropagation();void openProjMenu();};}
async function renderDashboard(){
  const ps=(await apiGet("/api/projects")).filter(p=>p.kind==="game");
  const fx=await apiGet("/api/fixers");let autos={};try{autos=await apiGet("/api/auto")}catch(e){}
  const cards=ps.map(p=>{
    const a=autos[p.name]||{};const pf=fx.filter(f=>f.game===p.name);
    const running=pf.filter(f=>f.status==="running"||f.status==="installing").length;
    const staged=pf.filter(f=>f.status==="done").length;const pct=a.total?Math.round((a.done/a.total)*100):0;
    return '<div class="dashcard" data-p="'+esc(p.name)+'"><div class="dashtop"><span class="dashname">'+esc(p.name)+'</span>'+(a.on?'<span class="dashauto">⚡ auto</span>':'')+'</div>'
      +(a.total?'<div class="apbar"><div style="width:'+pct+'%"></div></div>':'')
      +'<div class="dashmeta">'+(a.total?a.done+'/'+a.total+' roadmap · ':'')+running+' running · '+staged+' staged</div></div>';
  }).join("");
  $("#pane").innerHTML='<div class="dashhead">Portfolio · '+ps.length+' projects</div>'+(cards||'<span style="color:var(--faint)">no projects yet</span>');
  $("#pane").querySelectorAll(".dashcard").forEach(c=>c.onclick=()=>selectProject(c.dataset.p));
}

if($("#projName"))$("#projName").textContent=planProject;
void loadHistory();void refreshStatus();void refreshPane();
setInterval(refreshStatus,8000);setInterval(()=>{if(document.querySelector("#autobar .acDeck")&&!$("#autobar").contains(document.activeElement))void renderController();},7000);
let _fxSig="";
setInterval(async()=>{if(cur!=="__fixers__"||fixerViewId)return;try{const fx=await apiGet("/api/fixers"),a=await apiGet("/api/auto");const sig=fx.map(f=>f.id+f.status).join()+"|"+Object.entries(a).map(([p,c])=>p+c.on+c.inflight+(c.note||"")).join();if(sig!==_fxSig){_fxSig=sig;void renderFixers();}}catch(e){}},5000);
// (fixer live activity now lives in the main chat via the fixer transcript view)
try{fetch("/api/beacon?stage=init-done")}catch(e){}


/* ⌘K command palette */
const PALETTE=[
  {k:"fix",label:"new fix…",hint:"/fix",fill:"/fix ",group:"Act"},
  {k:"golden",label:"run golden gate",hint:"/golden",run:"/golden",group:"Act"},
  {k:"export",label:"export transcript",hint:"/export",run:"/export",group:"Act"},
  {k:"live voice",label:"toggle live voice",hint:"⌥space",fn:()=>{live?liveStop(true):void liveStart()},group:"Act"},
  {k:"settings",label:"settings",hint:"⌘,",fn:()=>{if(typeof openSettings==="function")openSettings()},group:"Act"},
  {k:"copy",label:"copy last reply",fn:()=>{const m=[...document.querySelectorAll(".msg.oracle .md")].pop();if(m){try{navigator.clipboard.writeText(m.textContent)}catch(e){}}},group:"Act"},
  {k:"fixes",label:"Fixes",tab:"__fixers__",hint:"F",group:"Go to"},
  {k:"play",label:"Play",tab:"__play__",group:"Go to"},
  {k:"plan",label:"Plan",tab:"__plan__",hint:"P",group:"Go to"},
  {k:"issues",label:"Issues",tab:"__issues__",hint:"I",group:"Go to"},
  {k:"artifacts",label:"Artifacts",tab:"__artifacts__",hint:"A",group:"Go to"},
  {k:"schedules",label:"Schedules",tab:"__schedules__",hint:"S",group:"Go to"},
  {k:"growth",label:"Growth",tab:"__growth__",hint:"G",group:"Go to"},
  {k:"playbooks",label:"Playbooks",tab:"PLAYBOOKS.md",group:"Go to"},
  {k:"journal",label:"Journal",tab:"__journal__",group:"Go to"},
  {k:"log",label:"Log",tab:"log.md",group:"Go to"},
  {k:"memory",label:"Memory",tab:"MEMORY.md",group:"Go to"},
  {k:"all projects",label:"All Projects",fn:()=>showAllProjects(),group:"Go to"},
];
let palEl=null,palSel=0,palEntries=[];
function palClose(){if(palEl){palEl.remove();palEl=null}}
async function palOpen(){
  palClose();sfx.capture();
  palEntries=[...PALETTE];
  try{(await apiGet("/api/projects")).filter(p=>p.kind==="game").forEach(p=>palEntries.push({k:"project "+p.name.toLowerCase(),label:p.name,hint:"switch",fn:()=>selectProject(p.name),group:"Projects"}));}catch(e){}
  palEl=document.createElement("div");palEl.id="palWrap";
  palEl.innerHTML='<div id="pal"><input id="palIn" placeholder="jump to anything · run a command…" autocomplete="off"><div id="palList"></div></div>';
  document.body.appendChild(palEl);
  const inp=palEl.querySelector("#palIn");
  palEl.onclick=e=>{if(e.target===palEl)palClose()};
  const paintSel=()=>{palEl.querySelectorAll(".palItem[data-i]").forEach(el=>{const s=+el.dataset.i===palSel;el.classList.toggle("sel",s);if(s)el.scrollIntoView({block:"nearest"})})};
  const render=()=>{
    const q=inp.value.trim().toLowerCase();
    const hits=palEntries.filter(a=>!q||a.k.includes(q)||a.label.toLowerCase().includes(q));
    palSel=Math.min(palSel,Math.max(0,hits.length-1));
    let html="",lastG=null;
    hits.forEach((a,i)=>{if(a.group!==lastG){html+='<div class="palGroup">'+a.group+'</div>';lastG=a.group;}
      html+='<div class="palItem'+(i===palSel?" sel":"")+'" data-i="'+i+'">'+esc(a.label)+(a.hint?'<span class="palHint">'+esc(a.hint)+'</span>':"")+'</div>';});
    palEl.querySelector("#palList").innerHTML=html||'<div class="palItem">no match</div>';
    palEl.querySelectorAll(".palItem[data-i]").forEach(el=>{const i=+el.dataset.i;el.onmouseenter=()=>{palSel=i;paintSel()};el.onclick=()=>palRun(hits[i]);});
    return hits;
  };
  let hits=render();
  inp.oninput=()=>{palSel=0;hits=render()};
  inp.onkeydown=e=>{
    if(e.key==="Escape"){palClose()}
    else if(e.key==="ArrowDown"){e.preventDefault();palSel=Math.min(palSel+1,hits.length-1);paintSel()}
    else if(e.key==="ArrowUp"){e.preventDefault();palSel=Math.max(palSel-1,0);paintSel()}
    else if(e.key==="Enter"){e.preventDefault();if(hits[palSel])palRun(hits[palSel])}
  };
  inp.focus();
}
function palRun(a){
  palClose();
  if(a.fill){$("#box").value=a.fill;$("#box").focus();autosize();return}
  if(a.run){$("#box").value=a.run;send();return}
  if(a.tab){const t=document.querySelector('.nt[data-p="'+a.tab+'"]');if(t){t.click();}else{setNavActive(null);cur=a.tab;void refreshPane();}return}
  if(a.fn)a.fn();
}

/* ⌘F — search all of history, jump to any moment */
let findEl=null,findT=null;
function findClose(){if(findEl){findEl.remove();findEl=null}}
function findOpen(){
  palClose();findClose();sfx.capture();
  findEl=document.createElement("div");findEl.id="palWrap";
  findEl.innerHTML='<div id="pal"><input id="palIn" placeholder="search everything oracle has heard or said…" autocomplete="off"><div id="palList"></div></div>';
  document.body.appendChild(findEl);
  const inp=findEl.querySelector("#palIn"),list=findEl.querySelector("#palList");
  findEl.onclick=e=>{if(e.target===findEl)findClose()};
  inp.onkeydown=e=>{if(e.key==="Escape")findClose()};
  inp.oninput=()=>{
    clearTimeout(findT);
    findT=setTimeout(async()=>{
      const q=inp.value.trim();
      if(q.length<2){list.innerHTML="";return}
      const hits=await apiGet("/api/history?q="+encodeURIComponent(q)+"&n=30");
      list.innerHTML=hits.map(h=>{
        const d=new Date(h.ts);
        const when=d.toLocaleDateString([], {month:"short",day:"numeric"})+" "+d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
        const i=h.text.toLowerCase().indexOf(q.toLowerCase());
        const snip=esc(h.text.slice(Math.max(0,i-40),i+90));
        return '<div class="palItem findItem" data-ts="'+h.ts+'"><span>'+snip+'</span><span class="palHint">'+(h.role==="user"?"you":"oracle")+" · "+when+'</span></div>';
      }).join("")||'<div class="palItem">no matches</div>';
      list.querySelectorAll(".findItem").forEach(el=>el.onclick=()=>void findJump(el.dataset.ts));
    },200);
  };
  inp.focus();
}
async function findJump(ts){
  findClose();
  renderEntries(await apiGet("/api/history?around="+encodeURIComponent(ts)+"&n=60"));
  const el=document.querySelector('.msg[data-ts="'+ts+'"]');
  if(el){el.scrollIntoView({block:"center"});el.classList.add("flash");setTimeout(()=>el.classList.remove("flash"),2400);}
}
/* ⌘, settings window */
let setEl=null;
function setClose(){if(setEl){setEl.remove();setEl=null}}
function applyAppearance(){document.body.classList.toggle("vibrant",IS_APP_EARLY&&localStorage.getItem("vibrancy")!=="off");document.body.classList.toggle("reducemotion",localStorage.getItem("reduceMotion")==="on");}
async function openSettings(){
  setClose();sfx.capture();
  let models=[];try{const mi=await apiGet("/api/model");models=(mi.models||mi.available||mi.list||[]).map(x=>typeof x==="string"?x:(x.id||x.name)).filter(Boolean);}catch(e){}
  let curModel="default";try{curModel=(await apiGet("/api/status")).modelOverride||"default";}catch(e){}
  const modelOpts=["default",...models.filter(m=>m&&m!=="default")];
  const rows=[
    {sec:"Voice & Sound"},
    {label:"Voice output",hint:"Oracle speaks replies aloud",get:()=>!localStorage.getItem("voiceOff"),set:v=>v?localStorage.removeItem("voiceOff"):localStorage.setItem("voiceOff","1")},
    {label:"Sound effects",hint:"UI chimes on send/reply",get:()=>!localStorage.getItem("sfxOff"),set:v=>v?localStorage.removeItem("sfxOff"):localStorage.setItem("sfxOff","1")},
    {sec:"Appearance"},
    {label:"Window vibrancy",hint:"translucent smoked-glass background",get:()=>localStorage.getItem("vibrancy")!=="off",set:v=>{v?localStorage.removeItem("vibrancy"):localStorage.setItem("vibrancy","off");applyAppearance();}},
    {label:"Reduce motion",hint:"disable ambient + transition animations",get:()=>localStorage.getItem("reduceMotion")==="on",set:v=>{v?localStorage.setItem("reduceMotion","on"):localStorage.removeItem("reduceMotion");applyAppearance();}},
  ];
  const shortcuts=[["⌘K","command palette"],["⌘F","search history"],["⌘,","settings"],["⌥Space","toggle live voice"],["F · P · I","fixes · plan · issues"]];
  setEl=document.createElement("div");setEl.id="setWrap";
  setEl.innerHTML='<div id="settings"><div id="setHead"><span class="setTitle">Settings</span><input id="setSearch" placeholder="search settings…" autocomplete="off"><button id="setX">esc</button></div><div id="setBody"></div></div>';
  document.body.appendChild(setEl);
  setEl.onclick=e=>{if(e.target===setEl)setClose()};
  const body=setEl.querySelector("#setBody");
  const render=(q="")=>{
    q=q.toLowerCase();let html="";
    for(const r of rows){
      if(r.sec){html+='<div class="setSec">'+r.sec+'</div>';continue;}
      if(q&&!(r.label.toLowerCase().includes(q)||(r.hint||"").toLowerCase().includes(q)))continue;
      html+='<div class="setRow"><div class="setL"><div class="setLabel">'+esc(r.label)+'</div>'+(r.hint?'<div class="setHint">'+esc(r.hint)+'</div>':"")+'</div><button class="setToggle'+(r.get()?" on":"")+'" data-lab="'+esc(r.label)+'"><span class="setKnob"></span></button></div>';
    }
    if(!q||"model default".includes(q))html+='<div class="setSec">Model</div><div class="setRow"><div class="setL"><div class="setLabel">Default model</div><div class="setHint">interactive turns (app · voice · telegram)</div></div><select id="setModel">'+modelOpts.map(m=>'<option'+(m===curModel?" selected":"")+'>'+esc(m)+'</option>').join("")+'</select></div>';
    if(!q||"shortcuts keys".includes(q))html+='<div class="setSec">Shortcuts</div>'+shortcuts.map(s=>'<div class="setRow"><div class="setLabel">'+esc(s[1])+'</div><span class="setKey">'+esc(s[0])+'</span></div>').join("");
    if(!q||"about version paths daemon updates".includes(q))html+='<div class="setSec">About</div><div class="setRow"><div class="setLabel">Updates</div><button class="setKey" id="setUpd" style="cursor:pointer">check</button></div><div class="setAbout">Oracle v2 · daemon 127.0.0.1:4519 · signed auto-update on<br>app ~/Oracle/app · vault ~/OracleVault · state ~/.oracle</div>';
    body.innerHTML=html||'<div class="setAbout">no matching settings</div>';
    body.querySelectorAll(".setToggle[data-lab]").forEach(btn=>btn.onclick=()=>{const r=rows.find(x=>x.label===btn.dataset.lab);r.set(!r.get());sfx.capture();render(setEl.querySelector("#setSearch").value);});
    const ms=body.querySelector("#setModel");if(ms)ms.onchange=async()=>{try{await apiPost("/api/model",{model:ms.value});curModel=ms.value;sfx.sent();}catch(e){}};
    const ub=body.querySelector("#setUpd");if(ub)ub.onclick=async()=>{ub.textContent="checking…";try{const u=await window.__TAURI__.core.invoke("plugin:updater|check");ub.textContent=(u&&u.version)?("update "+u.version+" ↓"):"up to date";}catch(e){ub.textContent="up to date";}};
  };
  render();const s=setEl.querySelector("#setSearch");s.oninput=()=>render(s.value);s.focus();
  setEl.querySelector("#setX").onclick=setClose;
}
document.addEventListener("keydown",e=>{
  if((e.metaKey||e.ctrlKey)&&e.key==="f"){e.preventDefault();findEl?findClose():findOpen()}
  else if((e.metaKey||e.ctrlKey)&&e.key===","){e.preventDefault();setEl?setClose():void openSettings()}
  else if(!e.metaKey&&!e.ctrlKey&&!e.altKey&&!palEl&&!setEl&&!findEl){
    const t=e.target;if(t&&(t.tagName==="INPUT"||t.tagName==="TEXTAREA"||t.isContentEditable))return;
    const map={f:"__fixers__",p:"__plan__",i:"__issues__",a:"__artifacts__",j:"__journal__",l:"log.md",m:"MEMORY.md",s:"__schedules__",g:"__growth__"};
    const p=map[e.key.toLowerCase()];if(p){e.preventDefault();const el=document.querySelector('.nt[data-p="'+p+'"]');if(el){el.click();}else{setNavActive(null);cur=p;void refreshPane();}}
  }
});
document.addEventListener("keydown",e=>{
  if((e.metaKey||e.ctrlKey)&&e.key==="k"){e.preventDefault();palEl?palClose():void palOpen()}
});

/* micro-sounds — subtle WebAudio feedback (flagship feel, no assets) */
let _ac=null;const _vol=0.05;
function tone(freq,dur,type,delay,vol){if(localStorage.getItem("sfxOff"))return;
  try{
    _ac=_ac||new (window.AudioContext||window.webkitAudioContext)();
    const t=_ac.currentTime+(delay||0),o=_ac.createOscillator(),g=_ac.createGain();
    o.type=type||"sine";o.frequency.setValueAtTime(freq,t);
    g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(vol||_vol,t+.012);
    g.gain.exponentialRampToValueAtTime(.0001,t+dur);
    o.connect(g).connect(_ac.destination);o.start(t);o.stop(t+dur+.05);
  }catch(e){}
}
const sfx={
  capture(){tone(880,.09,"sine");},
  sent(){tone(520,.12,"sine");tone(780,.14,"sine",.07);},
  reply(){tone(660,.16,"triangle");tone(990,.22,"triangle",.09,.035);},
  standby(){tone(392,.18,"sine");},
  heard(){tone(560,.06,"sine",0,.03);},
};

let micDrive=0; // live user-voice level, drives the listening wave
/* presence waveform — the AI's pulse (states: standby listen capture think speak) */
const WAVES={standby:{a:3.2,f:.9,s:.3,g:.45},listening:{a:6.5,f:1.1,s:.65,g:.7},capturing:{a:12,f:2.2,s:1.6,g:1},
             thinking:{a:9,f:3.2,s:2.4,g:.95},speaking:{a:13,f:1.5,s:1.2,g:1.1}};
let waveState="standby",wp={a:2,f:.9,s:.25,g:.25},wt=0;
function setWave(s){waveState=WAVES[s]?s:"standby"}
(function waveLoop(){
  if(document.hidden){requestAnimationFrame(waveLoop);return}
  const cv=$("#wave");if(!cv){requestAnimationFrame(waveLoop);return}
  const dpr=window.devicePixelRatio||1,W=cv.clientWidth,H=cv.clientHeight;
  if(cv.width!==W*dpr){cv.width=W*dpr;cv.height=H*dpr}
  const ctx=cv.getContext("2d");ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);
  const t=WAVES[waveState];for(const k in wp)wp[k]+=(t[k]-wp[k])*.05;
  if(waveState==="listening"||waveState==="capturing"){wp.a=Math.max(wp.a,3+micDrive*17);wp.g=Math.max(wp.g,.5+micDrive*.5);} // react to the user's live voice
  wt+=.016*wp.s*60/16;
  for(let layer=0;layer<3;layer++){
    ctx.beginPath();
    const la=wp.a*(1-layer*.32),lo=layer*2.1;
    for(let x=0;x<=W;x+=3){
      const env=Math.sin(Math.PI*x/W);
      const y=H/2+Math.sin(x*.018*wp.f+wt+lo)*la*env+Math.sin(x*.007*wp.f-wt*.7+lo*2)*la*.5*env;
      x?ctx.lineTo(x,y):ctx.moveTo(x,y);
    }
    ctx.strokeStyle=`rgba(170,158,205,${(.6-layer*.16)*wp.g+.1})`;
    ctx.lineWidth=1.7-layer*.4;
    ctx.shadowColor="rgba(154,143,184,.75)";ctx.shadowBlur=9*wp.g;
    ctx.stroke();
  }
  requestAnimationFrame(waveLoop);
})();


/* per-fix pulse — each working fix breathes with a mini Oracle wave */
let _fwt=0;
(function fixWaves(){
  if(document.hidden){requestAnimationFrame(fixWaves);return}
  _fwt+=0.05;
  const cvs=document.querySelectorAll("canvas.fixwave");
  const dpr=window.devicePixelRatio||1;
  cvs.forEach((cv)=>{
    const W=cv.clientWidth||120,H=cv.clientHeight||18;
    if(cv.width!==W*dpr){cv.width=W*dpr;cv.height=H*dpr}
    const ctx=cv.getContext("2d");ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);
    const ph=parseFloat(cv.dataset.ph||"0"),a=H*0.32;
    for(let layer=0;layer<2;layer++){
      ctx.beginPath();
      const la=a*(1-layer*.4);
      for(let x=0;x<=W;x+=2){
        const env=Math.sin(Math.PI*x/W);
        const y=H/2+Math.sin(x*.05+_fwt*1.6+ph+layer*2)*la*env+Math.sin(x*.02-_fwt+ph)*la*.4*env;
        x?ctx.lineTo(x,y):ctx.moveTo(x,y);
      }
      ctx.strokeStyle=`rgba(170,158,205,${.55-layer*.25})`;
      ctx.lineWidth=1.3-layer*.4;
      ctx.shadowColor="rgba(154,143,184,.7)";ctx.shadowBlur=6;
      ctx.stroke();
    }
  });
  requestAnimationFrame(fixWaves);
})();

/* ambient signal field — particle-drift technique (ThreeUI-inspired), monochrome + faint */
(function ambient(){
  const cv=document.querySelector("#ambient");if(!cv)return;
  const ctx=cv.getContext("2d");let W=0,H=0,pts=[];
  function size(){const dpr=window.devicePixelRatio||1;W=innerWidth;H=innerHeight;
    cv.width=W*dpr;cv.height=H*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);
    pts=Array.from({length:Math.round(W*H/26000)}).map(()=>({
      x:Math.random()*W,y:Math.random()*H,r:.6+Math.random()*1.5,
      vy:-(.06+Math.random()*.22),vx:(Math.random()-.5)*.05,tw:Math.random()*6.28}));}
  size();addEventListener("resize",size);
  (function tick(){
    if(document.hidden){requestAnimationFrame(tick);return}
    ctx.clearRect(0,0,W,H);
    const e=(typeof wp==="object"?wp.g:0.4); // wave energy feeds the field
    for(const p of pts){
      p.y+=p.vy;p.x+=p.vx;p.tw+=.01;
      if(p.y<-4){p.y=H+4;p.x=Math.random()*W}
      const a=(.05+.07*Math.abs(Math.sin(p.tw)))*(0.7+e*.6);
      ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,6.283);
      ctx.fillStyle=`rgba(160,150,195,${a})`;ctx.fill();
    }
    requestAnimationFrame(tick);
  })();
})();

/* voice-reactive wordmark — AudioWordmark technique: letters ride the pulse */
(function wordmark(){
  const w=document.querySelector(".word");if(!w)return;
  const text=w.textContent;w.textContent="";
  const spans=[...text].map(ch=>{const s=document.createElement("span");s.textContent=ch;w.appendChild(s);return s});
  let t=0;
  (function bob(){
    if(document.hidden){requestAnimationFrame(bob);return}
    t+=.05;
    const energy=(typeof wp==="object"?Math.max(0,(wp.a-3)/10):0); // 0 idle → ~1 speaking
    spans.forEach((s,i)=>{
      const y=Math.sin(t*2+i*.9)*2.4*energy;
      s.style.transform=`translateY(${y.toFixed(2)}px)`;
      s.style.color=energy>.25?"var(--acc)":"";
    });
    requestAnimationFrame(bob);
  })();
})();

/* ── live conversation engine ─────────────────────────────────────────────
   launch → greeting → open mic → talk; "wait"/"stop"/"freeze" → standby.
   states: standby · listening · capturing · thinking · speaking            */
const IS_APP=new URLSearchParams(location.search).get("app")==="1";
const CONTROL=/^\s*(wait|stop|freeze|standby|pause)\b/i;
let live=false,ac=null,an=null,stream=null,mrec=null,parts=[],floor=0.008,speaking=false,vBarge=null,myvad=null;

function setMic(state,label){
  setWave(state==="standby"?"standby":state);
  $("#livestat").classList.remove("shimmer");
  $("#livestat").classList.toggle("hot",["capturing","thinking","speaking"].includes(state));
  const b=$("#mic");
  b.classList.toggle("live",live);
  $("#livestat").textContent=label||state;
}
async function speak(text){
  if(localStorage.getItem("voiceOff"))return;
  speaking=true; // gate the mic immediately, but only SHOW "speaking" when sound actually starts
  try{
    const a=new Audio(BASE+"/api/say?text="+encodeURIComponent(text.slice(0,700)));
    a.addEventListener("playing",()=>setMic("speaking","speaking"),{once:true});
    await a.play();
    await new Promise(r=>{a.onended=r;a.onerror=r});
  }catch(e){}
  speaking=false;
  if(live)setMic("listening","listening…");
}
function float32ToWav(pcm){ // 16kHz mono float32 → WAV blob (RIFF → whisper fast-lane)
  const rate=16000,wav=new DataView(new ArrayBuffer(44+pcm.length*2));
  const wr=(o,s)=>{for(let i=0;i<s.length;i++)wav.setUint8(o+i,s.charCodeAt(i))};
  wr(0,"RIFF");wav.setUint32(4,36+pcm.length*2,true);wr(8,"WAVEfmt ");
  wav.setUint32(16,16,true);wav.setUint16(20,1,true);wav.setUint16(22,1,true);
  wav.setUint32(24,rate,true);wav.setUint32(28,rate*2,true);wav.setUint16(32,2,true);wav.setUint16(34,16,true);
  wr(36,"data");wav.setUint32(40,pcm.length*2,true);
  for(let i=0;i<pcm.length;i++){const s=Math.max(-1,Math.min(1,pcm[i]));wav.setInt16(44+i*2,s<0?s*32768:s*32767,true)}
  return new Blob([wav],{type:"audio/wav"});
}
async function liveStart(){
  if(live)return;
  try{
    stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
  }catch(e){bubble("oracle","⚠️ mic: "+e,"live");return}
  live=true;localStorage.setItem("liveOn","1");$("#mic").classList.add("live");
  setMic("listening","listening…");
  // Silero neural VAD — detects SPEECH (not just loudness), so it works in a noisy room
  if(window.vad&&window.ort){
    try{
      myvad=await vad.MicVAD.new({
        baseAssetPath:BASE+"/vendor/vad/", onnxWASMBasePath:BASE+"/vendor/vad/",
        model:"v5",
        getStream: async()=>stream,
        positiveSpeechThreshold:0.5, negativeSpeechThreshold:0.35,
        minSpeechFrames:3, redemptionFrames:8, preSpeechPadFrames:4,
        onFrameProcessed:(p)=>{ micDrive=speaking?0:Math.min(1,(p&&p.isSpeech)||0); },
        onSpeechStart:()=>{ if(speaking)return; sfx.capture(); setMic("capturing","hearing you…"); },
        onSpeechEnd:(audio)=>{ if(speaking)return; sfx.heard(); void onUtterance(float32ToWav(audio)); },
        onVADMisfire:()=>{ if(live&&!speaking)setMic("listening","listening…"); },
      });
      await myvad.start();
      return;
    }catch(e){ console.warn("silero vad unavailable → energy fallback",e); myvad=null; }
  }
  // fallback: energy-based VAD
  ac=new (window.AudioContext||window.webkitAudioContext)();
  const src=ac.createMediaStreamSource(stream);
  an=ac.createAnalyser();an.fftSize=2048;src.connect(an);
  voidLoop();
}
function liveStop(say){
  sfx.standby();
  live=false;
  localStorage.setItem("liveOn","0");
  $("#mic").classList.remove("live");
  try{myvad&&myvad.pause()}catch(e){}
  try{myvad&&myvad.destroy&&myvad.destroy()}catch(e){}
  myvad=null;micDrive=0;
  try{mrec&&mrec.state==="recording"&&mrec.stop()}catch(e){}
  try{stream&&stream.getTracks().forEach(t=>t.stop())}catch(e){}
  try{ac&&ac.close()}catch(e){}
  stream=null;ac=null;an=null;
  setMic("standby","standby");
  if(say)void speak("Standing by.");
}
function rms(){
  const d=new Uint8Array(an.fftSize);
  an.getByteTimeDomainData(d);
  let s=0;for(let i=0;i<d.length;i++){const v=(d[i]-128)/128;s+=v*v}
  return Math.sqrt(s/d.length);
}
async function voidLoop(){
  let above=0,below=0,capturing=false,hot=0,capStart=0,peak=0;
  while(live){
    await new Promise(r=>setTimeout(r,50));
    if(!live)continue;
    if(speaking){ // barge-in: sustained loud speech over oracle's voice interrupts it
      const lvl=rms();
      if(vBarge&&lvl>Math.max(0.035,floor*6)){hot++;if(hot>=8){hot=0;vBarge();sfx.capture();}}
      else hot=Math.max(0,hot-1);
      micDrive=0;
      continue;
    }
    const level=rms();
    floor=Math.min(0.02,Math.max(0.004,floor*0.9975+level*0.0025));
    const thr=Math.max(0.012,floor*3);
    // live reactivity: the wave breathes with your actual voice while it listens
    micDrive=Math.min(1,Math.max(micDrive*0.6,(level-floor)/0.05));
    if(!capturing){
      if(level>thr){above++;if(above>=2){capturing=true;below=0;capStart=Date.now();peak=level;startCap()}}
      else above=0;
    }else{
      peak=Math.max(peak*0.98,level);
      if(level<thr){
        below++;
        // contextual endpoint: clear/deep silence after real speech ends FAST; ambiguous quiet gets grace
        const spoke=Date.now()-capStart;
        const deep=level<Math.max(0.008,floor*1.6);        // truly silent, not just quiet
        const trailedOff=peak<thr*2.2;                      // energy was fading, likely done
        let need = deep ? 6 : 9;                            // 0.30s vs 0.45s (was fixed 0.55s)
        if(spoke>1200 && (deep||trailedOff)) need=5;        // long, finished thought → 0.25s
        if(spoke<400) need=10;                              // very short → guard against clipped false starts
        if(below>=need){capturing=false;micDrive=0;stopCap()}
      }else below=0;
    }
  }
}
function startCap(){
  parts=[];
  try{
    mrec=new MediaRecorder(stream,{mimeType:MediaRecorder.isTypeSupported("audio/webm")?"audio/webm":""});
    mrec.ondataavailable=e=>parts.push(e.data);
    mrec.onstop=()=>void onUtterance(new Blob(parts));
    mrec.start();
    sfx.capture();
    setMic("capturing","hearing you…");
  }catch(e){bubble("oracle","⚠️ rec: "+e,"live")}
}
function stopCap(){sfx.heard();try{mrec&&mrec.state==="recording"&&mrec.stop()}catch(e){}}

async function onUtterance(blob){
  if(!live||blob.size<2000){if(live)setMic("listening","listening…");return}
  setMic("thinking","transcribing…");
  let heard="";
  try{
    // send raw audio — the whisper server transcodes (~0.1s) faster than in-browser WAV encode (~0.5s here)
    const r=await fetch(BASE+"/api/transcribe",{method:"POST",body:blob});
    heard=((await r.json()).heard||"").trim();
  }catch(e){}
  if(!heard||heard.length<2){if(live)setMic("listening","listening…");return}
  if(CONTROL.test(heard)){bubble("user",'🎤 "'+heard+'"',"you · voice");liveStop(true);return}
  bubble("user",'🎤 "'+heard+'"',"you · voice");
  sfx.sent();
  setMic("thinking","oracle is thinking…");
  try{
    await voiceTurn(heard);
  }catch(e){bubble("oracle","⚠️ "+e,"live")}
  if(live)setMic("listening","listening…");
  void refreshPane();void refreshStatus();
}

/* sentence-streaming voice: speak each sentence as it arrives; prefetch next while playing */
function speakable(t){return t.replace(/```[\s\S]*?```/g," code block ").replace(/[*_#>`|]/g,"").replace(/\[([^\]]+)\]\([^)]*\)/g,"$1").trim()}
async function voiceTurn(heard){
  const q=[];let playing=false,streamDone=false,aborted=false,cur=null,curDone=null;
  vBarge=()=>{aborted=true;q.length=0;try{cur&&cur.pause()}catch(e){}if(curDone)curDone();};
  async function drain(){
    playing=true;speaking=true; // speaking flag gates the mic; the LABEL waits for real audio
    let announced=false;
    const announce=()=>{if(!announced&&!aborted){announced=true;setMic("speaking","speaking");}};
    while(q.length){
      const a=q.shift();cur=a;
      a.addEventListener("playing",announce,{once:true});
      try{await a.play();await new Promise(r=>{curDone=r;a.onended=r;a.onerror=r});}catch(e){}
      cur=null;curDone=null;
    }
    playing=false;speaking=false;
    if(!streamDone&&!aborted)setMic("thinking","oracle is thinking…");
    else if(!aborted&&live)setMic("listening","listening…"); // stream done + nothing else → back to listening
  }
  const enq=(text)=>{
    if(aborted)return;if(localStorage.getItem("voiceOff"))return;
    const clean=speakable(text);
    if(!clean)return;
    const a=new Audio(BASE+"/api/say?text="+encodeURIComponent(clean.slice(0,600)));
    a.preload="auto";
    q.push(a);
    if(!playing)void drain();
  };
  let pending="",spoken=0,mode="detect"; // detect → jarvis (»voice line only) | legacy (sentence streaming)
  const takeSentences=(force)=>{
    for(;;){
      let m=pending.match(/[.!?…]["')\]]?(\s)/);
      const minLen=spoken===0?12:30;
      if(spoken===0&&(!m||m.index===undefined||m.index>40)){
        const c=pending.match(/[,;:—](\s)/);
        if(c&&c.index!==undefined&&c.index>=14)m=c;
      }
      if(m&&m.index!==undefined&&m.index>=minLen){
        enq(pending.slice(0,m.index+1));pending=pending.slice(m.index+2);spoken++;
      }else if(force&&pending.trim()){
        enq(pending);pending="";spoken++;break;
      }else break;
    }
  };
  const takeVoiceLines=()=>{ // speak each complete »voice: line; a line ends at \n or the next marker
    for(;;){
      const i2=pending.indexOf("»voice:");
      if(i2<0){if(pending.length>400)pending=pending.slice(-200);break}
      const rest=pending.slice(i2+7);
      const nl=rest.indexOf("\n"),nm=rest.indexOf("»voice:");
      let end=-1;
      if(nl>=0&&(nm<0||nl<nm))end=nl;
      else if(nm>=0)end=nm;
      if(end<0){pending=pending.slice(i2);break}
      const line=rest.slice(0,end).trim();
      if(line){enq(line);spoken++;}
      pending=rest.slice(end===nl?end+1:end);
    }
  };
  const onDelta=(t)=>{
    pending+=t;
    if(mode==="jarvis"){takeVoiceLines();return}
    if(mode==="legacy"){takeSentences(false);return}
    const s=pending.trimStart();
    const maybeMarker=s.length<7?"»voice:".startsWith(s):s.startsWith("»voice:");
    if(maybeMarker){
      if(s.startsWith("»voice:")&&pending.indexOf("\n")>=0){mode="jarvis";takeVoiceLines();}
    }else if(s.length>=10){mode="legacy";takeSentences(false);}
  };
  // no spoken filler — the instant "heard you" tone + the "thinking" state acknowledge;
  // the reply (or Claude's »voice narration lines) is the only spoken content. One message → one spoken response.
  const r=await streamSend("(voice) "+heard,onDelta);
  streamDone=true;
  if(mode==="jarvis"){/* spoken line already queued */}
  else if(mode==="detect"&&r.voice){enq(r.voice);spoken++;}
  else{
    if(spoken===0)pending=r.text||"";
    takeSentences(true);
  }
  while(playing||q.length)await new Promise(r2=>setTimeout(r2,150));
  speaking=false;vBarge=null;
}
$("#mic").onclick=()=>{live?liveStop(false):void liveStart()};
document.addEventListener("keydown",e=>{if(e.altKey&&e.code==="Space"){e.preventDefault();live?liveStop(false):void liveStart()}});
try{ if(window.__TAURI__&&window.__TAURI__.event){ window.__TAURI__.event.listen("toggle-live",()=>{ live?liveStop(false):void liveStart(); }); } }catch(e){}

/* launch behavior: greeting + auto-live in the app */
async function launch(){
  setMic("standby","idle");
  if(!IS_APP)return;
  if(localStorage.getItem("liveOn")!=="1")return; // remember last on/off — don't auto-start unless it was live
  const hr=new Date().getHours();
  const sal=hr<5?"Working late, Matty.":hr<12?"Good morning, Matty.":hr<18?"Good afternoon, Matty.":"Good evening, Matty.";
  const greet=async()=>{await speak(sal);await liveStart()};
  try{await greet()}
  catch(e){
    const once=()=>{document.removeEventListener("click",once);void greet()};
    document.addEventListener("click",once);
  }
}
void launch();


/* live-reload: refresh when the daemon signals a public-asset change, or after the daemon restarts (dev convenience — no HMR needed) */
try{
  let _lrUp=false;
  const _lr=new EventSource(BASE+"/api/livereload");
  _lr.onopen=()=>{ if(_lrUp){location.reload();} _lrUp=true; };
  _lr.onmessage=(e)=>{ if(e.data==="reload"){ try{sessionStorage.setItem("__lrbox",(typeof box!=="undefined"&&box&&box.value)||"")}catch(_){}; location.reload(); } };
}catch(_){}
try{const _b=sessionStorage.getItem("__lrbox");if(_b){sessionStorage.removeItem("__lrbox");if(typeof box!=="undefined"&&box){box.value=_b;try{autosize()}catch(_){}}}}catch(_){}
