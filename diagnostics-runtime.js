async function diagnosticBound(promise,ms=2000) {
  let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Diagnostic read timed out')),ms);})]);}finally{clearTimeout(timer);}
}
async function diagnosticCapture(w) {
  const saved=(await diagnosticBound(chrome.storage.local.get('watch:'+w.id)))['watch:'+w.id]||w;
  const tab=await diagnosticBound(chrome.tabs.get(w.id));
  const result={capturedAt:Date.now(),url:diagnosticUrl(tab.url),pendingUrl:diagnosticUrl(tab.pendingUrl),status:tab.status,active:!!tab.active,discarded:!!tab.discarded};
  if(new URL(tab.url).origin!==new URL(saved.url).origin)return {...result,skipped:'Tab left the watched store'};
  try {
    const [{result:page}]=await diagnosticBound(chrome.scripting.executeScript({target:{tabId:w.id},func:captureWatchPage,args:[saved.rule,saved.selector||'',saved.amazonTitle||''],injectImmediately:true}));
    return {...result,page};
  }catch(e){return {...result,captureError:diagnosticText(e.message)};}
}
const Diagnostics=typeof indexedDB==='undefined'?{
  event:async()=>{},observe:async()=>{},heartbeat:async()=>{},boot:async()=>{},configure:async()=>{},clear:async()=>{},report:async()=>({events:[],logging:{error:'Diagnostic storage unavailable'}})
}:createDiagnostics({store:createDiagnosticStore(),version:()=>chrome.runtime.getManifest().version,capture:diagnosticCapture,
  onStatus:state=>chrome.storage.local.set({diagnosticStatus:state})});
const diagnosticEvent=(...args)=>{void Diagnostics.event(...args).catch(()=>{});};
async function diagnosticHeartbeat() {
  try{await Diagnostics.heartbeat(await all(),work.snapshot());}catch{}
}
async function migrateRetryDeadlines() {
  await recoverUndispatchedAttempts();
  for(const w of await all()) {
    if(w.rule?.store==='Best Buy'&&!w.paused&&!w.pending&&w.checkFailures&&/page check interrupted/i.test(w.status||'')) {
      const deadline=(w.lastReload||Date.now())+w.interval*1000;
      if(w.next>deadline){w.status=`Best Buy error retry restored to your ${w.interval}-second interval`;await scheduleAt(w,deadline);continue;}
    }
    let changed=false;
    if(w.retryAt>Date.now()+w.interval*1000&&/reports unavailable|rejected the addition/.test(w.status||'')){
      w.retryAt=w.rule?.store==='Amazon'?0:Date.now()+w.interval*1000;
      if(w.rule?.store==='Amazon'){w.amazonRetryNow=true;w.amazonCheckCartFirst=false;}
      w.status=w.rule?.store==='Amazon'?'Amazon retry is ready; checking the next available preorder button':`Store reports unavailable; next check at your ${w.interval}-second interval.`;changed=true;
    }
    if(w.amazonIgnoreCartBadgeUntil>Date.now()+w.interval*1000){w.amazonIgnoreCartBadgeUntil=Date.now()+w.interval*1000;changed=true;}
    if(changed)await schedule(w,w.interval);
    else if(w.pending)await armResultCheck(w);
    else if(!w.paused) {
      if(!Number.isFinite(w.next))await schedule(w);
      else {
        armWorkerRefresh(w);
        await chrome.alarms.create(`refresh:${w.id}`,{when:Math.max(w.next,Date.now()+100)});
        await armShortTimer(w);
      }
    }
  }
}
