function diagnosticUrl(value) {
  try {
    const u=new URL(value);if(!/^https?:$/.test(u.protocol))return u.protocol;
    const amazon=u.hostname.replace(/^www\./,'')==='amazon.com';
    const asin=amazon&&u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i)?.[1];
    if(asin)return u.origin+'/dp/'+asin.toUpperCase();
    if(/\/checkout\/|\/gp\/buy\//i.test(u.pathname)){const step=u.pathname.split('/').filter(Boolean).at(-1);return u.origin+'/checkout/[session]/'+(['itemselect','address','payment','review','spc','oos','cart','buynow'].includes(step)?step:'[step]');}
    if(/cart/i.test(u.pathname))return u.origin+'/cart';
    if(/\/product\/|\/products\/|\/ip\//.test(u.pathname))return u.origin+u.pathname.slice(0,250);
    return u.origin+'/[other page]';
  }catch{return '';}
}
function diagnosticText(value,max=500) {
  return String(value??'').replace(/https?:\/\/[^\s<>"']+/g,diagnosticUrl)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[email]')
    .replace(/\b\d{3}-\d{2}-\d{4}\b|\b(?:\d[ -]?){12,19}\b|\b\d{3}[-. ]\d{3}[-. ]\d{4}\b/g,'[number]')
    .replace(/\b\d{1,6}\s+(?:[A-Z0-9.'-]+\s+){1,5}(?:STREET|ST|ROAD|RD|AVENUE|AVE|LANE|LN|DRIVE|DR|TERRACE|TER|COURT|CT)\b/gi,'[address]')
    .replace(/\b(?:token|session|authorization|password)\s*[=:]\s*\S+/gi,'[credential omitted]').slice(0,max);
}
function diagnosticWatch(w={}) {
  const copy={id:w.id,store:w.rule?.store||'',productId:w.rule?.productId||'',url:diagnosticUrl(w.url),currentUrl:diagnosticUrl(w.currentUrl),status:diagnosticText(w.status),pauseReason:w.pauseReason||'',amazonStage:w.amazonStage||'',amazonVerification:w.amazonVerification||'',fulfillment:w.fulfillment||''};
  for(const name of ['paused','pending','userPaused','alertPaused','found','attention','botActive','queueDetected','pageReady','amazonReturning'])copy[name]=!!w[name];
  for(const name of ['interval','checked','lastReload','reloadCount','next','retryAt','started','created','checkFailures','controlVersion'])if(Number.isFinite(w[name]))copy[name]=w[name];
  return copy;
}
function diagnosticClean(value,depth=0) {
  if(depth>5)return '[truncated]';
  if(value===null||typeof value==='boolean'||typeof value==='number')return value;
  if(typeof value==='string')return diagnosticText(value);
  if(Array.isArray(value))return value.slice(0,50).map(v=>diagnosticClean(v,depth+1));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>! /cookie|password|authorization|token|phoneSettings|phoneQueue|html|stack/i.test(key)).slice(0,50).map(([key,v])=>[key,diagnosticClean(v,depth+1)]));
  return '';
}
function analyzeDiagnostics(report) {
  const events=report.events||[],findings=[],summaries=new Map();
  const add=(kind,e,message)=>findings.push({kind,time:e.time,watchId:e.watch?.id,message});
  for(const e of events) {
    if(e.watch?.id!==undefined){const previous=summaries.get(e.watch.id)||{id:e.watch.id,store:e.watch.store,firstSeen:e.time,reloads:0};summaries.set(e.watch.id,{...previous,store:e.watch.store||previous.store,lastSeen:e.time,lastState:e.watch.url?e.watch:previous.lastState,reloads:Math.max(previous.reloads||0,e.watch.reloadCount||0)});}
    if(e.type==='pause'&&!e.watch?.userPaused)add('pause',e,e.watch?.status||'Watch paused');
    if(['page_error','control_error','worker_error','notification_error'].includes(e.type))add('error',e,`${e.detail?.operation||e.type}: ${e.detail?.message||'Failed'}`);
    if(e.type==='watch_overdue')add('stalled',e,`No recent progress for ${Math.round(e.detail?.lagMs/1000)} seconds; last status: ${e.watch?.status||'unknown'}`);
    if(e.type==='heartbeat_gap')add('gap',e,`No heartbeat for ${Math.round(e.detail?.gapMs/60000)} minutes. Sleep, browser shutdown, or interrupted execution are possible; the gap alone cannot identify which.`);
    if(e.type==='browser_startup')add('restart',e,'Chrome restarted. This version clears watches on browser startup; re-add product tabs.');
    if(e.type==='amazon_result'&&e.detail?.state==='unavailable')add('rejection',e,`Amazon rejected availability (${e.detail.reason||'unavailable'}). Cart price is not stock evidence.`);
    if(e.type==='amazon_result'&&e.detail?.state==='retryableError')add('server error',e,'Amazon displayed its server-error page. Return to the product and inspect the cart before retrying.');
    if(e.type==='amazon_verification')add('verification',e,e.watch?.status||'Amazon verification interrupted this watch.');
    if(e.type==='loading_recovery')add('recovery',e,'The product page was still loading after 30 seconds. No queue or verification was detected; a fresh load was requested.');
    if(e.type==='snapshot_error'||e.snapshot?.captureError)add('capture',e,'Page evidence was unavailable: '+(e.detail?.message||e.snapshot?.captureError||'unknown reason'));
  }
  for(const w of report.currentWatches||[]) {const old=summaries.get(w.id)||{id:w.id,store:w.store};summaries.set(w.id,{...old,lastState:w});}
  const counts={};for(const e of events)counts[e.type]=(counts[e.type]||0)+1;
  return {summary:findings.length?`${findings.length} recorded pauses, rejections, gaps or errors to review.`:'No diagnostic incident recorded in the retained log. This is not proof that every stock opportunity was detected.',counts,watches:[...summaries.values()],findings:findings.slice(-250)};
}
function createDiagnostics({store,now=()=>Date.now(),version=()=>'',capture=null,onStatus=()=>{}}) {
  let enabled=true,tail=Promise.resolve(),failure='',lastStatus=0;
  const states=new Map(),samples=new Map(),dedupe=new Map(),captures=new Map();
  const pendingCaptures=new Set();
  function status(force=false) {if(force||now()-lastStatus>60000){lastStatus=now();try{Promise.resolve(onStatus({enabled,lastEvent:now(),error:failure})).catch(()=>{});}catch{}}}
  function serial(fn) {const result=tail.then(fn);tail=result.catch(e=>{failure=diagnosticText(e.message);status(true);});return result;}
  async function event(type,w=null,detail={},important=false,snapshot=false) {
    if(!enabled)return;
    const record={time:now(),version:version(),type,detail:diagnosticClean(detail)};if(w)record.watch=diagnosticWatch(w);
    const routine=['refresh','refresh_delayed','action_started','action_result','amazon_result','amazon_return','navigation','state','sample'].includes(type);
    if(routine)important=false;
    const id=type+':'+(w?.id??'')+':'+(routine?[record.detail.action,record.detail.state,record.watch?.amazonStage,record.watch?.pending,record.watch?.amazonReturning].join(':'):''),signature=routine?type:JSON.stringify([record.watch?.status,record.detail]);
    if(dedupe.get(id)?.signature===signature&&now()-dedupe.get(id).time<60000)return;
    dedupe.set(id,{signature,time:now()});
    const ref=await serial(()=>store.append(record,important));failure='';status();
    if(snapshot&&capture&&w?.id!==undefined&&now()-(captures.get(w.id)||0)>=60000) {
      captures.set(w.id,now());
      const job=Promise.resolve().then(()=>capture(w)).then(data=>serial(()=>store.attach(ref,diagnosticClean(data))))
        .catch(e=>event('snapshot_error',w,{message:e.message},true)).finally(()=>pendingCaptures.delete(job));
      pendingCaptures.add(job);
    }
  }
  async function observe(w) {
    if(!enabled)return;
    const current=diagnosticWatch(w),prior=states.get(w.id);states.set(w.id,current);
    const fields=['paused','pending','userPaused','alertPaused','found','attention','botActive','queueDetected','amazonStage','amazonReturning','retryAt'];
    const changed=!prior||fields.some(k=>current[k]!==prior[k]);
    const stopped=current.paused&&!current.pending&&(!prior?.paused||prior.pauseReason!==current.pauseReason)&&!current.userPaused;
    if(stopped)await event('pause',w,{previousStatus:prior?.status||'',reason:current.pauseReason},true,true);
    else if(changed)await event('state',w,{},true,false);
    else if(now()-(samples.get(w.id)||0)>=60000){samples.set(w.id,now());await event('sample',w);}
  }
  async function heartbeat(watches,queue={}) {
    if(!enabled)return;
    const previous=await serial(()=>store.getMeta('heartbeat'));
    if(previous?.active&&now()-previous.time>180000)await event('heartbeat_gap',null,{gapMs:now()-previous.time,previousActive:previous.active},true);
    await serial(()=>store.setMeta('heartbeat',{time:now(),active:watches.filter(w=>!w.paused||w.pending).length}));
    await event('heartbeat',null,{watches:watches.length,running:watches.filter(w=>!w.paused).length,pending:watches.filter(w=>w.pending).length,queue});
    for(const w of watches) {
      await observe(w);
      if((w.paused&&!w.pending)||w.retryAt>now())continue;
      const progress=w.pending?(w.amazonStageStarted||w.started):Math.max(w.checked||0,w.lastReload||0,w.created||0);
      const limit=Math.max(90000,(w.interval||0)*3000+15000);
      if(progress&&now()-progress>limit)await event('watch_overdue',w,{lagMs:now()-progress,queue},true,true);
    }
  }
  return {event,observe,heartbeat,
    async configure(value){enabled=!!value;await serial(()=>store.setMeta('enabled',enabled));status(true);},
    async boot(){const setting=await serial(()=>store.getMeta('enabled'));enabled=setting!==false;await event('worker_start',null,{},true);status(true);},
    async clear(){await tail;await Promise.allSettled([...pendingCaptures]);await serial(()=>store.clear());states.clear();samples.clear();dedupe.clear();captures.clear();await serial(()=>store.setMeta('enabled',enabled));await event('log_started',null,{},true);status(true);},
    async report(context={}){await tail;await Promise.allSettled([...pendingCaptures]);await tail;const report={schemaVersion:1,generatedAt:now(),version:version(),retention:'Up to 48 hours, 6000 routine records and 500 incidents; capacity can shorten retention.',logging:{enabled,error:failure},...diagnosticClean(context),events:(await serial(()=>store.read())).filter(e=>now()-e.time<=48*3600000)};report.analysis=analyzeDiagnostics(report);return report;}
  };
}
if(typeof module!=='undefined')module.exports={diagnosticUrl,diagnosticText,diagnosticWatch,diagnosticClean,analyzeDiagnostics,createDiagnostics};
