importScripts('detector.js', 'cart.js', 'profiles.js', 'page-timers.js', 'foreground.js', 'availability.js', 'bestbuy.js', 'amazon.js', 'nintendo.js', 'phone.js', 'work-queue.js', 'actions.js','diagnostic-store.js','diagnostics.js','diagnostic-page.js','diagnostics-runtime.js');
const key = id => `watch:${id}`;
const work=createWorkQueue();
const browserTabs=Object.fromEntries(['get','query','update','reload'].map(method=>[method,(...args)=>{
  if(work.cancelled())throw Object.assign(Error('Interrupted by a watch control'),{name:'WatchInterrupted'});
  return work.guard(chrome.tabs[method](...args),2000);
}]));
let queue = Promise.resolve();
const userPauses = new Set();
const refreshTimers = new Map();
const resultTimers = new Map();
async function armResultCheck(w,delay=1000) {
  await chrome.alarms.create(`result:${w.id}`,{when:Date.now()+delay});
  clearTimeout(resultTimers.get(w.id));
  const token=w.token;
  const timer=setTimeout(function resultDeadline(){
    resultTimers.delete(w.id);
    serial(async()=>{const current=await get(w.id);if(current?.pending&&current.token===token)await readOutcome(current,current.rule?.store==='Amazon'?false:Date.now()-current.started>=30000);},{key:`result:${w.id}`});
  },delay);
  timer.unref?.();resultTimers.set(w.id,timer);
}
function armWorkerRefresh(w) {
  clearTimeout(refreshTimers.get(w.id));refreshTimers.delete(w.id);
  if(w.paused||w.pending||!Number.isFinite(w.next)||w.next-Date.now()>=30000)return;
  const deadline=w.next;
  const timer=setTimeout(function refreshDeadline(){
    refreshTimers.delete(w.id);
    serial(async()=>{const current=await get(w.id);if(current&&!current.paused&&current.next===deadline&&Date.now()>=deadline)await refresh(current);},{key:`refreshDue:${w.id}`});
  },Math.max(1,deadline-Date.now()));
  timer.unref?.();refreshTimers.set(w.id,timer);
}
let stoppingAll = false;
const isUserPaused = id => work.cancelled() || stoppingAll || userPauses.has(id);
const serial = (fn,options) => { const result=work.enqueue(fn,options);queue=work.idle();return result; };
async function runPageScript(options) {
  if(work.cancelled())throw Object.assign(Error('Interrupted by a watch control'),{name:'WatchInterrupted'});
  try{return await work.guard(chrome.scripting.executeScript({...options,injectImmediately:true}));}
  catch(e){if(e.name!=='WatchInterrupted')diagnosticEvent('page_error',{id:options.target.tabId},{operation:options.func?.name||'load helpers',message:e.message},true,true);throw e;}
}
async function runPageAction(w,action,args) {
  if(isUserPaused(w.id))throw Object.assign(Error('Interrupted by a watch control'),{name:'WatchInterrupted'});
  await runPageScript({target:{tabId:w.id},files:['cart.js','profiles.js','amazon.js','nintendo.js','bestbuy.js','actions.js']});
  if(isUserPaused(w.id))throw Object.assign(Error('Interrupted by a watch control'),{name:'WatchInterrupted'});
  const permit={id:w.id,version:w.controlVersion||0,token:w.pending?w.token:null,url:w.url,deadline:Date.now()+4000};
  // Sold-out dismissal can follow a completed, alert-paused attempt.
  if(action==='bestBuyClose')permit.allowRejection=true;
  diagnosticEvent('action_started',w,{action},true);
  const result=await runPageScript({target:{tabId:w.id},func:performPageAction,args:[action,args,permit]});
  diagnosticEvent('action_result',w,{action,result:result?.[0]?.result},true);
  return result;
}
function samePage(a,b) {
  if(typeof a!=='string'||typeof b!=='string'||!a||!b)return false;
  if(a?.split('#')[0]===b?.split('#')[0])return true;
  try {
    const left=new URL(a),right=new URL(b);
    if(!/^https?:$/.test(left.protocol)||!/^https?:$/.test(right.protocol))return false;
    const host=u=>u.hostname.replace(/^www\./,'');
    if(host(left)===host(right)) {
      const x=productRule(a),y=productRule(b);
      if(x&&y&&x.store!=='Amazon') {
        if(x.productId===y.productId)return true;
        if(x.store==='Best Buy') {
          const catalog=u=>u.pathname.match(/^\/product\/[^/]+\/([A-Z0-9]+)(?:\/|$)/i)?.[1];
          if(catalog(left)&&catalog(left)===catalog(right))return true;
        }
      }
    }
    if(!['amazon.com','www.amazon.com'].includes(left.hostname)||!['amazon.com','www.amazon.com'].includes(right.hostname))return false;
    const asin=u=>u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i)?.[1]?.toUpperCase();
    const x=asin(left),y=asin(right);
    const sellerX=left.searchParams.get('smid'),sellerY=right.searchParams.get('smid');
    return !!x&&x===y&&!(sellerX&&sellerY&&sellerX!==sellerY);
  }catch{return false;}
}
async function recoverAmazonNavigationPauses() {
  for(const w of await all()) {
    const rule=productRule(w.url)||w.rule;
    if(rule?.store!=='Amazon'||!(/^(?:Paused: tab navigated away|Amazon checkout availability is unverified)/.test(w.status||''))||w.pending||w.userPaused||w.alertPaused)continue;
    try {
      const tab=await browserTabs.get(w.id);
      w.rule=rule;
      if(await checkAmazonVerification(w,tab))continue;
      if(!samePage(tab.url,w.url)){await recoverAmazonRejection(w,tab);continue;}
      if(!w.status.startsWith('Paused: tab navigated away')) {
        const [{result:page}]=await runPageScript({target:{tabId:w.id},func:inspectAmazonPage,args:[w.rule,w.amazonTitle||'']});
        await recoverAmazonProductStall(w,tab,page);continue;
      }
      w.rule=rule;w.url=tab.url;w.paused=false;w.status='Monitoring — Amazon product URL recognized';await schedule(w);
    }catch{}
  }
}
function removedStore(url) {try {const host=new URL(url).hostname;return host==='target.com'||host.endsWith('.target.com');}catch{return false;}}
async function all() { return Object.values(await chrome.storage.local.get(null)).filter(v => v?.kind === 'watch'&&!removedStore(v.url)); }
async function get(id) { const w=(await chrome.storage.local.get(key(id)))[key(id)];if(w&&removedStore(w.url))return undefined;if(w?.userPaused)userPauses.add(id);return w; }
async function removeTargetWatches() {
  const data=await chrome.storage.local.get(null);
  for(const [storageKey,w] of Object.entries(data)) {
    if(!removedStore(w?.url))continue;
    if(w.kind==='watch') {
      for(const prefix of ['refresh:','scan:','result:'])await chrome.alarms.clear(`${prefix}${w.id}`);
      try {await runPageScript({target:{tabId:w.id},func:()=>{clearTimeout(globalThis.__stockRefreshTimer);clearTimeout(globalThis.__stockScanTimer);}});}catch{}
    }
    await chrome.storage.local.remove(storageKey);
  }
  await badge();
}
async function save(w) {
  if(work.cancelled())return;
  if(w.alertPaused)w.paused=true;
  if(isUserPaused(w.id) || w.userPaused) {w.userPaused=true;w.paused=true;w.status=w.pending?'Paused by you; checking the existing cart attempt only':'Paused by you';}
  w.pauseReason=!w.paused?'':w.userPaused?'manual':w.pending?'checking cart':w.alertPaused?'alert':/navigated away|left the watched product/i.test(w.status)?'navigation':/unverified/i.test(w.status)?'unverified cart':'page error';
  const history=w.history||[];
  if(history.at(-1)?.status!==w.status)history.push({time:Date.now(),status:w.status});
  w.history=history.slice(-20);
  await chrome.storage.local.set({[key(w.id)]: w});
  if(w.paused||w.pending){clearTimeout(refreshTimers.get(w.id));refreshTimers.delete(w.id);}
  if(!w.pending){clearTimeout(resultTimers.get(w.id));resultTimers.delete(w.id);}
  void Diagnostics.observe(w).catch(()=>{});
}
function seconds(msg) { const n = Number(msg.interval); if (!Number.isFinite(n) || n <= 0 || n * 1000 > Number.MAX_SAFE_INTEGER-Date.now()) throw Error('Enter a positive interval in seconds or minutes.'); return n; }
async function armShortTimer(w) {
  if (!w || w.paused || w.next-Date.now()>=30000) return;
  try { await runPageScript({target:{tabId:w.id},func:armPageTimer,args:[w.url,w.next,'refreshDue']}); } catch {}
}
async function schedule(w, delay = w.interval) {
  return scheduleAt(w,Date.now()+delay*1000);
}
async function scheduleAt(w, deadline) {
  if(w.paused || w.alertPaused || isUserPaused(w.id)) {
    await save(w);
    await chrome.alarms.clear(`refresh:${w.id}`);await chrome.alarms.clear(`scan:${w.id}`);
    return;
  }
  w.next = deadline; await save(w);
  armWorkerRefresh(w);
  if(isUserPaused(w.id))return;
  await chrome.alarms.create(`refresh:${w.id}`, {when: Math.max(w.next,Date.now()+30000)});
  if(w.next-Date.now()<30000) {
    if(work.isControl())serial(async()=>{const current=await get(w.id);await armShortTimer(current);},{key:`timer:${w.id}`});
    else await armShortTimer(w);
  }
}
async function persistPause(id) {
  const w=await get(id);if(!w)return;
  w.controlVersion=(w.controlVersion||0)+1;
  if(w.pending&&w.cartDispatched===false){w.pending=false;await chrome.alarms.clear(`result:${id}`);}
  userPauses.add(id);await schedule(w);
  // Page timers only request work. Paused state rejects those requests; the
  // user control must not wait for a loading/frozen tab to clear its timers.
}
async function armAvailability(w) {
  if(!w||w.paused||isUserPaused(w.id))return;
  try {
    const tab=await browserTabs.get(w.id);if(!samePage(tab.url,w.url))return;
    await runPageScript({target:{tabId:w.id},files:['detector.js','profiles.js','cart.js','bestbuy.js','nintendo.js']});
    await runPageScript({target:{tabId:w.id},func:observeAvailability,args:[tab.url,w.rule,w.selector]});
  }catch(e){w.status=`Page observer unavailable: ${e.message}`;await save(w);}
}
async function badge() {
  const count = (await all()).filter(w => w.found || w.attention).length;
  await chrome.action.setBadgeText({text: count ? String(count) : ''});
  await chrome.action.setBadgeBackgroundColor({color: '#16804a'});
}
async function ensureAlarm() {
  if (!(await chrome.alarms.get('tick'))) await chrome.alarms.create('tick', {periodInMinutes: 0.5});
  if (!(await chrome.alarms.get('diagnostic:heartbeat'))) await chrome.alarms.create('diagnostic:heartbeat', {periodInMinutes: 1});
}
async function notify(id, title, message, url='', eventId=crypto.randomUUID()) {
  if(id!=='test') {
    try {await PhoneAlerts.enqueue(id,title,message,url,false,eventId);}
    catch {await chrome.storage.local.set({phoneStatus:{state:'error',message:'Could not queue a phone alert. Check Phone alerts and send a test.',time:Date.now()}}).catch(()=>{});}
  }
  // Reusing an existing notification can update it silently; create a fresh one.
  await work.guard(chrome.notifications.clear?.(id),2000);
  if(work.cancelled())return;
  await work.guard(chrome.notifications.create(id, {type: 'basic', iconUrl: 'icon.png', title, message, priority: 2, requireInteraction: true}),2000);
}
async function alertWatch(w, title) {
  const {automaticSwitching=true}=await chrome.storage.local.get('automaticSwitching');
  const watches=await all();
  if(!w.alertBatch) {
    w.alertBatch=crypto.randomUUID();
    w.alertResumeIds=watches.filter(o=>(automaticSwitching||o.id===w.id)&&!o.paused&&!o.userPaused&&!isUserPaused(o.id)).map(o=>o.id);
    if(!w.userPaused&&!w.alertPaused&&!isUserPaused(w.id)&&!w.alertResumeIds.includes(w.id))w.alertResumeIds.push(w.id);
  }
  w.alertScope=automaticSwitching?'all':'watch';
  if(!automaticSwitching) {
    w.status=w.status.replace(/All watches paused/gi,'This watch paused; other windows continue');
    title=title.replace(/all watches paused/gi,'this watch paused');
  }
  w.alertPauseOwner=w.alertBatch;
  // Freeze refresh/navigation, but allow the one already-authorized cart attempt.
  w.alertPaused=true;w.paused=true;await save(w);await schedule(w);
  for(const other of watches)if(automaticSwitching&&other.id!==w.id&&!other.paused) {
    other.alertPauseOwner=w.alertBatch;
    other.alertPaused=true;other.paused=true;other.status='Paused: another store alerted you';await schedule(other);
  }
  if(automaticSwitching)try {const tab=await browserTabs.update(w.id,{active:true});await work.guard(chrome.windows.update(tab.windowId,{focused:true}),2000);}catch{}
  await badge();
  diagnosticEvent('alert',w,{title},true,true);
  try { await notify(`stock:${w.id}`, title, `${w.title}\n${w.status}`,w.url,`${w.alertBatch}:${title}`);diagnosticEvent('alert_accepted',w,{title},true); }
  catch (e) { diagnosticEvent('notification_error',w,{message:e.message},true);w.status += `; notification failed: ${e.message}`; await save(w); }
}
async function pauseOthers(id) {
  const {automaticSwitching=true}=await chrome.storage.local.get('automaticSwitching');if(!automaticSwitching)return;
  for(const o of await all())if(o.id!==id&&!o.paused){o.paused=true;o.status='Paused: another store needs your attention';await schedule(o);}
}
async function otherAttemptBlocks(id) {
  const {automaticSwitching=true}=await chrome.storage.local.get('automaticSwitching');
  const current=await get(id);
  return (await all()).some(w=>w.id!==id&&((automaticSwitching&&w.pending)||
    (current?.rule?.store&&w.rule?.store===current.rule.store&&(w.pending||w.queueDetected||w.found))));
}
async function botAlert(w, detail, afterClick = false) {
  const first = !w.botActive;
  w.botActive = true; w.botReview = w.botReview || afterClick;
  w.pending = false; w.paused = false; w.attention = true;
  w.status = `Bot verification required. All watches paused. Complete the check in this tab.${w.botReview ? ' Check the existing cart attempt before resuming; no duplicate click.' : ''} ${detail}`;
  await schedule(w);
  if (first || !w.alertPaused) await alertWatch(w, 'Bot verification — your action is needed');
}
async function readAmazonVerification(w,tab) {
  if(w.rule?.store!=='Amazon'||tab.status!=='complete'||tab.pendingUrl)return null;
  let url;try{url=new URL(tab.url);}catch{return null;}
  if(url.origin!=='https://www.amazon.com')return null;
  const [{result}]=await runPageScript({target:{tabId:w.id},func:inspectAmazonVerification,args:[w.rule.productId]});
  return result;
}
async function holdAmazonVerification(w,tab) {
  const first=!w.amazonVerification;
  w.amazonVerificationReview=!!(w.amazonVerificationReview||(w.pending&&w.cartDispatched!==false));
  if(w.amazonVerificationReview)w.amazonCheckCartFirst=true;
  w.amazonVerification='required';w.amazonRetryNow=false;
  w.pending=false;w.paused=true;w.attention=true;w.found=false;
  w.currentUrl=diagnosticUrl(tab.url);w.checked=Date.now();
  w.status='Amazon needs verification. All watches paused. Complete “Continue shopping” in Amazon, open the saved product, then Resume.';
  if(w.alertScope==='watch')w.status=w.status.replace('All watches paused','This watch paused; other windows continue');
  await chrome.alarms.clear(`result:${w.id}`);await schedule(w);
  if(first) {
    diagnosticEvent('amazon_verification',w,{state:'required',afterCart:w.amazonVerificationReview},true,true);
    await alertWatch(w,'Amazon needs verification — check this tab');
  }
}
async function checkAmazonVerification(w,tab) {
  if(w.userPaused||isUserPaused(w.id))return false;
  const page=await readAmazonVerification(w,tab);
  if(page?.blocked){await holdAmazonVerification(w,tab);return true;}
  if(!w.amazonVerification)return false;
  // Loading, errors and a missing challenge are not proof of recovery.
  const state=page?.productReady?'ready':'required';
  const status=page?.productReady?'Amazon product page restored. Click Resume to continue watching.':page?.homepageReady?'Amazon is reachable. Open the saved product below, then Resume.':'Amazon verification is unresolved. Finish the check in Amazon; if it loops, leave this watch paused and try again later.';
  if(w.amazonVerification!==state||w.status!==status) {
    w.amazonVerification=state;w.status=status;w.currentUrl=diagnosticUrl(tab.url);
    await save(w);diagnosticEvent('amazon_verification',w,{state,homepageReady:!!page?.homepageReady},true);
  }
  return true;
}
async function protectBestBuyQueues(onlyId=null) {
  for(const w of await all()) {
    if(w.rule?.store!=='Best Buy'||(onlyId!==null&&w.id!==onlyId))continue;
    try {
      if(await recoverBestBuySoldOut(w))return true;
      if(w.queueDetected)continue;
      const tab=await browserTabs.get(w.id);
      if(new URL(tab.url).hostname!=='www.bestbuy.com')continue;
      const [{result:gate}]=await runPageScript({target:{tabId:w.id},func:pageAttention});
      if(gate?.reason==='queue') {
        w.pending=false;await chrome.alarms.clear(`result:${w.id}`);
        w.queueDetected=true;w.attention=true;w.status=`Best Buy queue detected. All watches paused; leave this tab open. ${gate.detail}`;
        await alertWatch(w,'Best Buy queue — all watches paused');return true;
      }
    }catch{}
  }
  return false;
}
async function recoverBestBuySoldOut(w) {
  if(w.rule?.store!=='Best Buy'||w.bestBuyRejected||w.found||isUserPaused(w.id)||w.userPaused||w.botActive)return false;
  if(w.paused&&!w.pending&&!w.alertBatch)return false;
  const tab=await browserTabs.get(w.id);
  if(!samePage(tab.url,w.url)||(tab.pendingUrl&&!samePage(tab.pendingUrl,w.url)))return false;
  if(w.rule.needsSku) {
    const [{result:rule}]=await runPageScript({target:{tabId:w.id},func:resolveBestBuyRule,args:[w.rule]});
    if(rule&&!rule.needsSku){w.rule=rule;await save(w);}
  }
  const [{result:gate}]=await runPageScript({target:{tabId:w.id},func:pageAttention});
  if(gate?.reason==='bot')return false;
  const [{result:rejection}]=await runPageScript({target:{tabId:w.id},func:bestBuySoldOut,args:[w.rule,tab.url,false]});
  if(!rejection?.unavailable)return false;
  if(gate?.reason==='queue'&&!rejection.modal)return false;
  const [{result:signals}]=await runPageScript({target:{tabId:w.id},func:cartSignals,args:[w.rule]});
  const result=classifyCart(signals||[],w.baseline||[]);
  if(result.state==='confirmed'||result.reason==='bot'||(result.state==='attention'&&!result.reason))return false;
  if(rejection.modal) {
    if(isUserPaused(w.id))return true;
    const [{result:closed}]=await runPageAction(w,'bestBuyClose',[w.rule,tab.url,true]);
    let remains=closed;
    for(let step=0;remains?.modal&&!closed?.error&&step<4;step++) {
      await new Promise(resolve=>setTimeout(resolve,250));
      [{result:remains}]=await runPageScript({target:{tabId:w.id},func:bestBuySoldOut,args:[w.rule,tab.url,false]});
    }
    if(closed?.error||remains?.modal) {
      w.pending=false;await chrome.alarms.clear(`result:${w.id}`);
      w.attention=true;w.status='Best Buy is sold out, but its popup could not be closed. Close it, then Resume.';
      await alertWatch(w,'Best Buy popup needs attention');return true;
    }
  }
  const batch=w.alertBatch,resumable=new Set(batch?(w.alertResumeIds||[]):(!w.paused?[w.id]:[]));
  Object.assign(w,{pending:false,found:false,attention:false,queueDetected:false,buttonAlerted:false,bestBuyRejected:true,retryAt:Date.now()+w.interval*1000});
  await chrome.alarms.clear(`result:${w.id}`);
  await save(w);
  // Release only this alert's pauses. Another alert or a manual pause wins.
  for(const current of await all()) {
    const o=current.id===w.id?w:current;
    if(!resumable.has(o.id)||(batch&&o.alertPauseOwner!==batch)||o.pending||o.userPaused||isUserPaused(o.id)||o.botActive||o.queueDetected||(o.id!==w.id&&(o.found||o.attention)))continue;
    try {
      const currentTab=await browserTabs.get(o.id);
      if(!samePage(currentTab.url,o.url)||(currentTab.pendingUrl&&!samePage(currentTab.pendingUrl,o.url)))continue;
      o.paused=false;o.alertPaused=false;o.alertPauseOwner=null;o.alertBatch=null;o.alertResumeIds=[];
      o.status=o.id===w.id?'Best Buy sold out; popup cleared. Monitoring continues after the next refresh.':'Monitoring — Best Buy rejected the cart attempt';
      await schedule(o,Math.max(o.interval,((o.retryAt||0)-Date.now())/1000));await armAvailability(o);
    }catch{}
  }
  if(w.paused||isUserPaused(w.id))await save(w);
  try {await chrome.notifications.clear?.(`stock:${w.id}`);}catch{}
  await badge();return true;
}
async function checkBot(w) {
  const [{result: signals}] = await runPageScript({target:{tabId:w.id},func:cartSignals,args:[w.rule]});
  const outcome = classifyCart(signals || [], w.botReview ? w.baseline || [] : []);
  if (outcome.reason === 'bot') { await botAlert(w, outcome.detail); return true; }
  if (w.botReview) {
    if (outcome.state === 'confirmed' || outcome.state === 'unavailable') {
      w.botActive=false;w.botReview=false;w.attention=false;w.pending=true;
      await finish(w,outcome);
    } else {
      w.paused=true;w.attention=true;w.status='Check the previous cart attempt before resuming. Its result is still unverified.';
      await alertWatch(w,'Previous cart attempt needs review');
    }
    return true;
  }
  w.botActive=false;w.attention=false;await save(w);await badge();return false;
}
async function finish(w, outcome) {
  if (!w.pending || outcome.state === 'pending') return;
  if(w.rule?.store==='Amazon'&&outcome.state==='confirmed'&&outcome.reason!=='amazonCheckoutVerified')return readOutcome(w);
  w.pending = false; await chrome.alarms.clear(`result:${w.id}`);
  if (outcome.reason === 'bot') return botAlert(w, outcome.detail, true);
  if(w.rule?.store==='Amazon' && outcome.state==='unavailable')return returnAmazonProduct(w);
  if (outcome.state === 'unavailable') {
    w.paused = false; w.status = w.alertPaused ? `Store rejected the addition as unavailable. ${w.alertScope==='watch'?'This watch remains':'All watches remain'} paused until you resume.` : `Store rejected the addition as unavailable. Retrying at your ${w.interval}-second interval.`;
    w.retryAt = Date.now() + w.interval * 1000;
    await schedule(w, w.interval);
    const tab = await browserTabs.get(w.id);
    if (!samePage(tab.url, w.url)) {
      w.paused = true; w.attention = true; w.status = 'Store rejected the addition. Return to the product page and Resume.'; await save(w); await alertWatch(w, 'Stock Watch needs attention');
    }
    return;
  }
  w.paused = true; w.found = outcome.state === 'confirmed'; w.attention = !w.found;w.queueDetected=outcome.reason==='queue';
  w.status = w.found ? `${outcome.reason==='amazonCheckoutVerified'?'Amazon checkout shows this item at quantity 1. Finish checkout yourself.':'Store reports added to cart.'} All watches paused. ${outcome.detail}` : `Check this tab. All watches paused. ${outcome.detail}`;
  await save(w); await alertWatch(w, w.found ? (outcome.reason==='amazonCheckoutVerified'?'Amazon checkout ready — finish your order':'Store reports: added to cart') : outcome.reason === 'bot' ? 'Bot verification — your action is needed' : 'Stock Watch needs attention');
}
async function pauseAmazonUnverified(w) {
  diagnosticEvent('amazon_unverified',w,{stage:w.amazonStage||'entry'},true,true);
  w.pending=false;w.paused=true;w.attention=true;w.status='Amazon checkout availability is unverified. This watch is paused to avoid a duplicate attempt. Check the tab before resuming.';
  await chrome.alarms.clear(`result:${w.id}`);await schedule(w);await badge();
}
async function recoverAmazonProductStall(w,tab,page) {
  // A stale cart/checkout stage can survive a redirect back to the product.
  // Reconcile the cart once without pressing preorder or trusting its badge.
  if(w.rule?.store!=='Amazon'||w.userPaused||isUserPaused(w.id)||w.alertPaused||w.found||w.botActive||w.amazonVerification||w.amazonStallRecovered||tab.status==='loading'||tab.pendingUrl||!samePage(tab.url,w.url)||page?.page!=='product'||!page.title||!page.cartUrl)return false;
  try {const u=new URL(page.cartUrl);if(u.origin!=='https://www.amazon.com'||!/^\/(?:cart\/?|gp\/cart\/view\.html)$/.test(u.pathname))return false;}catch{return false;}
  w.amazonStallRecovered=true;w.pending=true;w.paused=true;w.attention=false;w.cartDispatched=true;
  w.token=w.token||crypto.randomUUID();w.amazonCheckCartFirst=true;w.amazonTitle=page.title;
  w.amazonStage='cart';w.amazonStageStarted=Date.now();w.started=Date.now();w.amazonReadyAt=0;
  w.status='Amazon returned to the product before verification. Rechecking the existing cart; no new addition attempted.';
  diagnosticEvent('amazon_product_stall_recovery',w,{previousResult:'unverified'},true,true);
  await save(w);await armResultCheck(w);
  if(isUserPaused(w.id))return true;
  await browserTabs.update(w.id,{url:page.cartUrl});return true;
}
async function readAmazonOutcome(w, signals, expired) {
  const generic=classifyCart(signals||[]);
  if(generic.reason==='bot'||generic.reason==='queue')return finish(w,generic);
  const tab=await browserTabs.get(w.id);
  expired=expired||Date.now()-(w.amazonStageStarted||w.started)>30000;
  if(tab.status==='loading'||tab.pendingUrl) {if(expired)return pauseAmazonUnverified(w);await armResultCheck(w);return;}
  const [{result:page}]=await runPageScript({target:{tabId:w.id},func:inspectAmazonPage,args:[w.rule,w.amazonTitle||'']});
  diagnosticEvent('amazon_result',w,{page:page?.page,state:page?.state,reason:page?.reason,cartItem:page?.cartItem,hasCartItems:page?.hasCartItems},true,page?.state==='unavailable');
  if(page?.state==='staleCart')return recoverAmazonSideCart(w);
  if(w.amazonInventoryWatch&&page?.page==='checkout'&&page.quantityRestored) {
    w.amazonInventoryWatch=false;
    return finish(w,{state:'attention',detail:'Amazon restored this item to quantity 1 with no detected inventory error. Refreshing stopped; continue checkout manually.'});
  }
  if(page?.inventoryWatch) {
    if(isUserPaused(w.id)||w.userPaused)return;
    if(!w.amazonInventoryWatch){w.amazonInventoryWatch=true;w.amazonInventoryUrl=tab.url;w.amazonInventoryNext=Date.now()+w.interval*1000;}
    if(tab.url!==w.amazonInventoryUrl)return pauseAmazonUnverified(w);
    w.amazonStageStarted=Date.now();w.status=`Amazon checkout quantity is 0. Refreshing this page every ${w.interval} seconds until inventory returns.`;
    await save(w);
    if(Date.now()>=w.amazonInventoryNext) {
      w.amazonInventoryNext=Date.now()+w.interval*1000;w.lastReload=Date.now();w.reloadCount=(w.reloadCount||0)+1;await save(w);
      await browserTabs.reload(w.id);
    }
    await armResultCheck(w,Math.max(1,Math.min(1000,w.amazonInventoryNext-Date.now())));return;
  }
  if(page?.state==='retryableError')return returnAmazonProduct(w,'amazonServerError');
  if(page?.cartItem){w.amazonCheckCartFirst=true;if(page.title)w.amazonTitle=page.title;await save(w);}
  if(page?.state==='unavailable') {
    if(['emptyCart','missingCartItem'].includes(page.reason)) {
      w.amazonCheckCartFirst=false;w.amazonIgnoreCartBadge=true;
      return returnAmazonProduct(w,'emptyCart');
    }
    return returnAmazonProduct(w);
  }
  if(page?.state==='attention')return finish(w,{state:'attention',detail:page.detail});
  if(page?.state==='checkoutReady') {
    if(!w.amazonReadyAt){w.amazonReadyAt=Date.now();await save(w);}
    if(Date.now()-w.amazonReadyAt>=1500)return finish(w,{state:'confirmed',reason:'amazonCheckoutVerified',detail:'The review page has no detected inventory rejection. Availability can still change before you place the order.'});
  } else {
    w.amazonReadyAt=0;
    if(page?.state==='confirmationReady') {
      const steps=w.amazonConfirmations||[];
      if(!steps.includes(page.step)&&steps.length<2) {
        if(isUserPaused(w.id)){if(!work.cancelled())await pauseAmazonUnverified(w);return;}
        w.amazonConfirmations=[...steps,page.step];w.amazonStage='checkout';w.amazonStageStarted=Date.now();
        w.status=`Amazon: continuing confirmation ${w.amazonConfirmations.length} of 2; checking inventory`;
        await save(w);await armResultCheck(w);
        await runPageAction(w,'amazonCheckout',[w.rule,w.amazonTitle||'','confirm',w.token]);return;
      }
    }
    if(page?.state==='cartReady'&&w.amazonStage!=='checkout') {
      if(isUserPaused(w.id)){if(!work.cancelled())await pauseAmazonUnverified(w);return;}
      // Persist before entering checkout; subsequent confirmations are separately
      // validated and bounded. Place your order is never an action target.
      w.amazonStage='checkout';w.amazonStageStarted=Date.now();w.status='Amazon cart found; checking checkout for inventory rejection';await save(w);
      await armResultCheck(w);
      await runPageAction(w,'amazonCheckout',[w.rule,w.amazonTitle||'','proceed',w.token]);return;
    }
    if(page?.page==='product'&&page.cartUrl&&w.amazonStage!=='cart'&&w.amazonStage!=='checkout'&&(page.hasCartItems||generic.state==='confirmed')) {
      if(isUserPaused(w.id)){if(!work.cancelled())await pauseAmazonUnverified(w);return;}
      w.amazonStage='cart';w.amazonStageStarted=Date.now();w.status='Amazon cart signal detected; verifying the full cart';await save(w);
      await armResultCheck(w);
      await browserTabs.update(w.id,{url:page.cartUrl});return;
    }
  }
  if(expired){if(await recoverAmazonProductStall(w,tab,page))return;return pauseAmazonUnverified(w);}
  await save(w);await armResultCheck(w);
}
async function readOutcome(w, expired = false) {
  try {
    if(w.rule?.store==='Nintendo'&&w.rule?.mode==='cart')return await readNintendoCartOutcome(w,expired);
    if(w.rule?.store==='Amazon'&&await checkAmazonVerification(w,await browserTabs.get(w.id)))return;
    if(await recoverBestBuySoldOut(w))return;
    const [{result: signals}] = await runPageScript({target: {tabId: w.id}, func: cartSignals,args:[w.rule]});
    if(w.rule?.store==='Amazon')return await readAmazonOutcome(w,signals,expired);
    let result = classifyCart(signals || [], w.baseline || []);
    if(w.rule?.store==='Nintendo'&&result.state==='pending'&&!w.userPaused&&!isUserPaused(w.id)&&!w.alertPaused) {
      const tab=await browserTabs.get(w.id);
      if(!samePage(tab.url,w.url)||(tab.pendingUrl&&!samePage(tab.pendingUrl,w.url))) {
        w.nintendoRetry=false;
        return finish(w,{state:'attention',detail:'Nintendo advanced beyond the product page. Continue manually; automatic Pre-purchase retries have stopped.'});
      }
      if(tab.status==='complete'&&!tab.pendingUrl&&samePage(tab.url,w.url)) {
        const [{result:rejected}]=await runPageScript({target:{tabId:w.id},func:inspectNintendoRejection,args:[w.url]});
        if(rejected) {
          w.pending=false;w.paused=false;w.attention=false;w.nintendoRetry=true;w.retryAt=Date.now();
          w.status='Nintendo rejected the quantity. Retrying the initial Pre-purchase step.';
          await chrome.alarms.clear(`result:${w.id}`);await schedule(w,0.001);return;
        }
      }
    }
    if (result.state === 'pending' && expired) result = {state: 'attention', detail: 'No clear confirmation. Check the cart before resuming; no second click was made.'};
    await finish(w, result);
    if(w.pending&&!work.cancelled())await armResultCheck(w);
  } catch {
    if(work.cancelled())return;
    if(w.rule?.store==='Amazon') {
      if(expired||Date.now()-(w.amazonStageStarted||w.started)>=30000)await pauseAmazonUnverified(w);
      else await armResultCheck(w);
    } else if (expired) await finish(w, {state: 'attention', detail: 'Could not verify the result after navigation. Check the cart before resuming.'});
    else await armResultCheck(w);
  }
}
function amazonOosUrl(url) {try{const u=new URL(url);return u.hostname==='www.amazon.com'&&u.pathname==='/checkout/entry/oos';}catch{return false;}}
async function recoverAmazonSideCart(w) {
  if(w.userPaused||isUserPaused(w.id))return;
  w.amazonIgnoreCartBadge=true;w.amazonCheckCartFirst=false;
  w.pending=false;w.paused=false;w.attention=false;w.amazonStage=null;
  w.amazonRetryNow=false;w.amazonReturning=false;w.buttonAlerted=false;
  w.retryAt=Date.now()+w.interval*1000;
  w.status=`Amazon shows an empty side cart despite its badge. Refreshing at your ${w.interval}-second interval.`;
  await chrome.alarms.clear(`result:${w.id}`);
  await schedule(w,w.interval);
}
async function returnAmazonProduct(w,reason='unavailable') {
  const serverError=reason==='amazonServerError';
  const emptyCart=reason==='emptyCart';
  diagnosticEvent('amazon_return',w,{reason,retry:'when the product page is ready',attemptStarted:w.started},true,serverError);
  w.pending=false;w.paused=false;await chrome.alarms.clear(`result:${w.id}`);
  w.amazonReturning=true;w.buttonAlerted=false;w.amazonStage=null;w.amazonReadyAt=0;w.found=false;w.attention=false;
  w.amazonInventoryWatch=false;
  w.retryAt=emptyCart?Date.now()+w.interval*1000:0;w.amazonRetryNow=!serverError&&!emptyCart;w.amazonCheckCartFirst=serverError;
  w.status=serverError?'Amazon server error at purchase entry. Returning to the product; checking the existing cart before another attempt.':`Amazon reports unavailable. Returning to try again when preorder is available; otherwise refreshing every ${w.interval} seconds.`;
  if(emptyCart)w.status=`Amazon cart is empty despite its badge. Reloading the product; continuing at your ${w.interval}-second interval.`;
  await save(w);
  if(isUserPaused(w.id)||w.userPaused){w.amazonReturning=false;await save(w);return;}
  try {await browserTabs.update(w.id,{url:w.url});}
  catch(e) {w.attention=true;w.status=`Amazon is unavailable, but returning to the product page failed: ${e.message}`;await alertWatch(w,'Stock Watch needs attention');return;}
  await schedule(w,w.interval);
}
async function startCart(w, purchaseSelector = w.selector, label = '') {
  if(isUserPaused(w.id))return;
  if (await otherAttemptBlocks(w.id)) return;
  const [{result: baseline}] = await runPageScript({target: {tabId: w.id}, func: cartSignals,args:[w.rule]});
  if(isUserPaused(w.id))return;
  w.baseline = baseline; w.token = crypto.randomUUID(); w.pending = true; w.cartDispatched=false; w.paused = true; w.started = Date.now(); w.status = 'Attempting one addition; waiting for store confirmation';
  w.nintendoRetry=false;
  w.amazonInventoryWatch=false;
  const retryAmazon=w.amazonRetryNow===true;
  w.amazonRetryNow=false;w.amazonStage=null;w.amazonReadyAt=0;w.amazonStageStarted=w.started;w.amazonConfirmations=[];w.amazonStallRecovered=false;
  await save(w); // Persist before clicking; navigation or worker restarts must never repeat it.
  await armResultCheck(w);
  try {
    // Amazon has no button-only alert to bring it forward. Its result page still
    // needs foreground rendering while the persisted pending flag stops cycling.
    if(w.rule?.store==='Amazon') {
      await foregroundForRefresh(w.id,()=>isUserPaused(w.id));
      if(await checkAmazonVerification(w,await browserTabs.get(w.id)))return;
      const [{result:page}]=await runPageScript({target:{tabId:w.id},func:inspectAmazonPage,args:[w.rule]});
      if(page?.title){w.amazonTitle=page.title;await save(w);}
      if(page?.state==='staleCart')return recoverAmazonSideCart(w);
      if(!retryAmazon&&page?.cartUrl&&(w.amazonCheckCartFirst||(page.hasCartItems&&!w.amazonIgnoreCartBadge&&!(w.amazonIgnoreCartBadgeUntil>Date.now())))&&!isUserPaused(w.id)) {
        w.cartDispatched=true;w.amazonStage='cart';w.status='Checking the existing Amazon cart before another addition';await save(w);
        await browserTabs.update(w.id,{url:page.cartUrl});return;
      }
    }
    // Fulfillment belongs to the single reserved attempt. An availability alert
    // has already paused refreshes, so scheduling another normal scan would stall.
    if(w.rule && !(w.rule.store==='Best Buy' && /^pre[ -]?order(?: now)?$/i.test(label))) {
      let fulfillment;
      for(let step=0;step<4;step++) {
        if(isUserPaused(w.id))break;
        const [{result}]=step===0?await runPageAction(w,'fulfillment',[w.rule,w.fulfillment,true]):await runPageScript({target:{tabId:w.id},func:ensureFulfillment,args:[w.rule,w.fulfillment,false]});
        fulfillment=result;
        if(result?.ready || (!result?.changed && step===0))break;
        if(step<3)await new Promise(resolve=>setTimeout(resolve,1000));
      }
      if(!isUserPaused(w.id)&&!fulfillment?.ready) {
        return finish(w,{state:'attention',detail:fulfillment?.detail || 'Could not confirm the requested fulfillment. No cart click was made.'});
      }
    }
    await runPageScript({target: {tabId: w.id}, files: ['cart.js','profiles.js']});
    await runPageScript({target: {tabId: w.id}, func: observeCart, args: [w.token, baseline,w.rule]});
    if(isUserPaused(w.id)) {w.pending=false;await chrome.alarms.clear(`result:${w.id}`);await save(w);return;}
    w.cartDispatched=true;await save(w);
    const [{result}] = await runPageAction(w,'purchase',[purchaseSelector, w.url, w.token, w.rule, w.fulfillment]);
    if(w.rule?.store==='Amazon'&&result?.clicked){w.amazonIgnoreCartBadge=false;await save(w);}
    if (!result?.clicked) {
      if(result?.reason==='amazonVerification')return holdAmazonVerification(w,await browserTabs.get(w.id));
      if (result?.retry) { w.pending = false; w.paused = false; w.status = result.reason; await schedule(w); await chrome.alarms.clear(`result:${w.id}`); }
      else await finish(w, {state: 'attention', detail: result?.reason || 'Could not activate the chosen button'});
    }
  } catch { /* A navigation can destroy the script after clicking. Verify; never click again. */ }
}
async function scanNintendoCart(w,tab) {
  if(isUserPaused(w.id))return;
  if(tab.status!=='complete'||tab.pendingUrl){w.pageReady=false;w.nintendoStableSince=0;w.nintendoFingerprint='';await save(w);return;}
  const [{result:page}]=await runPageScript({target:{tabId:w.id},func:inspectNintendoCart,args:[w.nintendoCartItem||'']});
  w.checked=Date.now();w.pageReady=false;
  if(page?.product&&!w.nintendoCartItem)w.nintendoCartItem=page.product;
  if(page?.state==='review') {w.paused=true;w.attention=true;w.status=page.detail;await save(w);await alertWatch(w,'Nintendo cart needs review');return;}
  if(page?.state!=='ready') {
    const fingerprint=page?.product+':'+page?.state;
    if(!page||page.state==='loading'){w.nintendoStableSince=0;w.nintendoFingerprint='';}
    else if(w.nintendoFingerprint!==fingerprint){w.nintendoFingerprint=fingerprint;w.nintendoStableSince=Date.now();}
    // An explicit stock rejection can settle faster than a merely disabled
    // control, which may still be waiting for Nintendo's inventory response.
    const grace=page?.state==='unavailable'?750:2000;
    w.pageReady=!!w.nintendoStableSince&&Date.now()-w.nintendoStableSince>=grace;
    w.status=page?.state==='loading'?'Nintendo cart is still rendering; waiting for its item and checkout control.':w.pageReady?'Nintendo checkout is still unavailable; preparing another refresh.':'Nintendo cart rendered; checking for checkout availability before refreshing.';
    await save(w);await schedule(w,w.pageReady?0.001:Math.max(0.001,Math.min(250,grace-(Date.now()-(w.nintendoStableSince||Date.now()))))/1000);return;
  }
  w.nintendoStableSince=0;w.nintendoFingerprint='';
  if(!w.autoCart){w.paused=true;w.attention=true;w.status='Nintendo secure checkout is enabled. Continue manually.';await save(w);await alertWatch(w,'Nintendo checkout available');return;}
  if(await otherAttemptBlocks(w.id))return;
  w.pending=true;w.paused=true;w.token=crypto.randomUUID();w.started=Date.now();w.status='Nintendo: opening secure checkout';
  w.nintendoRecoveryArmed=true;
  w.nintendoAuthSubmitted=false;
  await save(w);await armResultCheck(w);
  const [{result}]=await runPageAction(w,'nintendoCheckout',[w.nintendoCartItem,'click',w.token]);
  if(!result?.clicked&&!result?.cancelled&&['unavailable','blocked','loading'].includes(result?.state)) {
    w.pending=false;w.paused=false;w.status='Nintendo checkout became unavailable. Continuing cart refreshes.';await chrome.alarms.clear(`result:${w.id}`);await schedule(w,0.001);
  }
}
async function readNintendoCartOutcome(w,expired) {
  if(isUserPaused(w.id)||w.userPaused)return;
  const tab=await browserTabs.get(w.id);
  if(await recoverNintendoCheckoutError(w,tab))return;
  if(tab.status==='loading'||tab.pendingUrl){if(expired)return finish(w,{state:'attention',detail:'Nintendo checkout is still loading. Automatic retries stopped; inspect this tab.'});await armResultCheck(w);return;}
  if(w.nintendoAutoPassword&&new URL(tab.url).origin==='https://accounts.nintendo.com'&&new URL(tab.url).pathname==='/reauthenticate'&&!expired) {
    if(!w.nintendoAuthSubmitted) {
      const [{result}]=await runPageAction(w,'nintendoPassword',[w.token]);
      if(result?.clicked){w.nintendoAuthSubmitted=true;w.status='Nintendo: confirmed the browser-autofilled password; waiting for the result.';await save(w);}
    }
    await armResultCheck(w,250);return;
  }
  if(!samePage(tab.url,w.url)) {
    let checkout=false;try{const u=new URL(tab.url);checkout=u.origin==='https://www.nintendo.com'&&/^\/(?:us\/)?checkout(?:\/|$)/.test(u.pathname);}catch{}
    const password=new URL(tab.url).hostname==='accounts.nintendo.com';
    return finish(w,{state:'attention',detail:password?'Nintendo needs your password. Enter it yourself. The recognized Wario error can return to cart automatically; password and checkout controls remain yours.':checkout?'Nintendo checkout opened. Continue manually; only the recognized Wario error will restart the cart loop.':'Nintendo left the cart. Inspect this page and continue manually; automatic actions have stopped.'});
  }
  const [{result:gate}]=await runPageScript({target:{tabId:w.id},func:pageAttention});
  if(gate)return finish(w,{state:'attention',reason:gate.reason,detail:gate.detail||gate});
  const [{result:page}]=await runPageScript({target:{tabId:w.id},func:inspectNintendoCart,args:[w.nintendoCartItem]});
  if(page?.state==='unavailable') {
    w.pending=false;w.paused=false;w.attention=false;w.status='Nintendo rejected checkout as out of stock. Continuing cart refreshes.';
    await chrome.alarms.clear(`result:${w.id}`);await schedule(w,0.001);return;
  }
  if(page?.state==='review'||expired)return finish(w,{state:'attention',detail:page?.detail||'Nintendo checkout entry is unverified. Check this tab before resuming.'});
  await armResultCheck(w);
}
async function recoverNintendoCheckoutError(w,tab) {
  if(w.rule?.store!=='Nintendo'||w.rule?.mode!=='cart'||!w.nintendoRecoveryArmed||w.userPaused||isUserPaused(w.id)||w.botActive||w.found||tab.status!=='complete'||tab.pendingUrl)return false;
  let u;try{u=new URL(tab.url);}catch{return false;}
  if(u.origin!=='https://www.nintendo.com'||!/^\/us\/checkout\/error\/?$/.test(u.pathname))return false;
  if(w.alertPaused&&w.alertPauseOwner!==w.alertBatch)return false;
  const [{result:error}]=await runPageScript({target:{tabId:w.id},func:inspectNintendoCheckoutError});
  if(!error) {
    await runPageScript({target:{tabId:w.id},files:['nintendo.js']});
    await runPageScript({target:{tabId:w.id},func:observeNintendoCheckoutError});return false;
  }
  // Return to the saved cart, never remove its item or submit authentication.
  const batch=w.alertBatch,resumable=new Set(w.alertResumeIds||[]);
  w.nintendoRecoveryArmed=false;w.pending=false;w.paused=false;w.attention=false;w.alertPaused=false;w.alertBatch=null;w.alertPauseOwner=null;w.alertResumeIds=[];
  w.pageReady=false;w.nintendoStableSince=0;w.nintendoFingerprint='';
  w.status='Nintendo rejected checkout (Wario page). Returning to the existing cart and retrying.';
  await chrome.alarms.clear(`result:${w.id}`);await save(w);
  await browserTabs.update(w.id,{url:w.url});await schedule(w,0.001);
  for(const o of await all()) {
    if(o.id===w.id||!batch||!resumable.has(o.id)||o.alertPauseOwner!==batch||o.userPaused||isUserPaused(o.id)||o.pending||o.found||o.botActive||o.queueDetected)continue;
    const current=await browserTabs.get(o.id);if(!samePage(current.url,o.url)||current.pendingUrl)continue;
    o.paused=false;o.alertPaused=false;o.alertPauseOwner=null;o.status='Monitoring — Nintendo rejected checkout';await schedule(o);await armAvailability(o);
  }
  await badge();return true;
}
async function scan(id) {
  const w = await get(id);
  if (!w) return;
  if(w.nintendoRecoveryArmed&&await recoverNintendoCheckoutError(w,await browserTabs.get(id)))return;
  if (w.pending) return readOutcome(w);
  if (w.paused || isUserPaused(id) || w.retryAt > Date.now() || w.bestBuyRejected) return;
  try {
    if(await recoverBestBuySoldOut(w))return;
    const tab = await browserTabs.get(id);
    if (w.botActive && await checkBot(w)) return;
    if(await checkNavigation(w,tab))return;
    if(tab.url!==w.url){w.url=tab.url;await save(w);}
    const [{result: gate}] = await runPageScript({target:{tabId:id},func:pageAttention});
    w.checkFailures=0;w.lastError='';
    if(gate) {
      if(gate.reason==='bot')return botAlert(w,gate.detail);
      w.paused=true;w.attention=true;w.queueDetected=gate.reason==='queue';w.status=gate.detail||gate;await save(w);await alertWatch(w,gate.reason==='queue'?'Queue detected — all watches paused':'Stock Watch needs attention');return;
    }
    if(w.rule?.store==='Nintendo'&&w.rule?.mode==='cart')return scanNintendoCart(w,tab);
    const currentRule=productRule(w.url);
    w.rule = currentRule?.needsSku && w.rule?.store==='Best Buy' ? w.rule : currentRule || w.rule;
    w.fulfillment = w.fulfillment || defaultFulfillment(w.rule);
    if(isUserPaused(id))return;
    if(w.rule?.store==='Amazon') {
      const [{result:page}]=await runPageScript({target:{tabId:id},func:inspectAmazonPage,args:[w.rule,w.amazonTitle||'']});
      if(page?.state==='staleCart')return recoverAmazonSideCart(w);
      if(page?.state==='retryableError') {
        w.checked=Date.now();w.status='Amazon server error; retrying at your refresh interval';await save(w);return;
      }
      if(w.autoCart&&w.amazonCheckCartFirst&&page?.page==='product'&&page.cartUrl)return startCart(w);
    }
    let purchaseSelector = w.selector;
    if(w.rule && purchaseSelector) {
      const [{result:exists}]=await runPageScript({target:{tabId:id},func:selectorExists,args:[purchaseSelector]});
      if(exists===false){purchaseSelector='';w.selector='';w.status='Saved button no longer exists; using this store’s product rule';await save(w);}
    }
    if (w.rule && !purchaseSelector) {
      const [{result: resolved}] = await runPageScript({target: {tabId: id}, func: resolveProductButton, args: [w.rule]});
      purchaseSelector = resolved?.selector;
      if (!purchaseSelector) {
        w.pageReady=false;w.checked = Date.now(); w.status = resolved?.status || 'Waiting for the product purchase button';
        await prepareMonitoringFulfillment(w);await save(w);return;
      }
    }
    const [{result}] = await runPageScript({target: {tabId: id}, func: inspectStock, args: [purchaseSelector,w.rule]});
    w.pageReady=true;
    w.checked = Date.now(); w.status = result?.ambiguous ? 'Multiple matching buttons. Choose a specific product button.' : 'No enabled matching button found';
    if(!result?.found){w.buttonAlerted=false;await prepareMonitoringFulfillment(w);}
    await save(w);
    if (result?.found && !isUserPaused(id)) {
      if (w.autoCart) {
        if(w.rule?.store==='Walmart') {
          const fulfillment=await prepareMonitoringFulfillment(w);
          if(!fulfillment?.ready){await save(w);return;}
        }
        if(await otherAttemptBlocks(id)){w.status='Waiting for the existing cart attempt or queue before trying this item';await save(w);return;}
        if(!w.buttonAlerted && !['Amazon','Nintendo'].includes(w.rule?.store)) {
          w.buttonAlerted=true;w.status=`Found “${result.label}”. Stock not verified; attempting to add one item to cart.`;
          await save(w);await alertWatch(w,'Purchase button detected — trying cart');
        }
        return startCart(w, purchaseSelector,result.label);
      }
      w.paused = true; w.found = true; w.status = `Found “${result.label}”. Stock not verified; refreshing paused.`; await save(w); await alertWatch(w, 'Purchase button detected');
    }
  } catch (e) { await retryPageCheck(w,e); }
}
async function checkNavigation(w,tab) {
  if(w.rule?.store==='Amazon'&&await checkAmazonVerification(w,tab))return true;
  if(samePage(tab.url,w.url)&&(!tab.pendingUrl||samePage(tab.pendingUrl,w.url))){w.navigationSince=0;w.navigationCandidate='';w.navigationObservedAt=0;w.currentUrl=tab.url;return false;}
  if(await recoverAmazonRejection(w,tab))return true;
  if(tab.status==='loading'||tab.pendingUrl) {
    w.navigationSince=w.navigationSince||Date.now();
    if(Date.now()-w.navigationSince<30000){w.status='Waiting for this tab’s navigation to finish';await schedule(w,2);return true;}
  }
  // Require two observations of the same settled destination. Redirect and
  // history events can arrive before Chrome reports the final product URL.
  const destination=tab.pendingUrl||tab.url||'';
  if(w.navigationCandidate!==destination){w.navigationCandidate=destination;w.navigationObservedAt=Date.now();w.status='Confirming where this tab navigated';await schedule(w,2);return true;}
  if(Date.now()-w.navigationObservedAt<1500){await schedule(w,2);return true;}
  w.paused=true;w.currentUrl=destination;w.status='Paused: tab navigated away. Use Return to product page, then Resume.';await schedule(w);return true;
}
async function recoverAmazonRejection(w,tab) {
  if(w.rule?.store!=='Amazon'||!w.autoCart||w.pending||w.userPaused||isUserPaused(w.id)||w.alertPaused||tab.status!=='complete'||tab.pendingUrl)return false;
  let u;try{u=new URL(tab.url);}catch{return false;}
  if(u.hostname!=='www.amazon.com'||!/^\/(?:checkout(?:\/|$)|gp\/buy(?:\/|$)|gp\/cart(?:\/|$)|cart(?:\/|$))/.test(u.pathname))return false;
  const [{result:page}]=await runPageScript({target:{tabId:w.id},func:inspectAmazonPage,args:[w.rule,w.amazonTitle||'']});
  if((page?.state==='unavailable'&&!page.inventoryWatch)||page?.state==='retryableError'){w.currentUrl=tab.url;await returnAmazonProduct(w,page.state==='retryableError'?'amazonServerError':'unavailable');return true;}
  if((w.paused&&!page?.inventoryWatch)||!page?.cartItem)return false;
  w.pending=true;w.paused=true;w.cartDispatched=true;w.token=crypto.randomUUID();w.started=Date.now();w.amazonStageStarted=w.started;
  w.amazonStage=page.page==='cart'?'cart':'checkout';w.amazonConfirmations=[];w.amazonReadyAt=0;
  if(page.title)w.amazonTitle=page.title;
  w.status='Following your Amazon cart attempt; verifying checkout';await save(w);
  diagnosticEvent('amazon_manual_attempt',w,{},true);
  await readAmazonOutcome(w,[],false);return true;
}
function bestBuyNetworkError(error) {
  // Chrome does not allow script injection into its network-error document.
  // This is distinct from an unreadable retailer document that may hold a queue.
  const message=String(error?.message||error||'');
  return /chrome-error:\/\/chromewebdata\//i.test(message)||/^Frame with ID 0 is showing error page\.?$/i.test(message.trim());
}
async function retryPageCheck(w,error,refreshFailed=false) {
  if(work.cancelled()||!w)return;
  diagnosticEvent('page_error',w,{operation:'check or refresh',message:error?.message||String(error)},true,true);
  if(w.pending){await armResultCheck(w);return;}
  w.checkFailures=(w.checkFailures||0)+1;
  w.lastError=String(error?.message||error);
  if(/No tab with id|Invalid tab ID/i.test(w.lastError)){w.paused=true;w.status='Paused: the watched tab is no longer open';await schedule(w);return;}
  if(w.rule?.store==='Best Buy') {
    w.status=`Best Buy page check interrupted; keeping your ${w.interval}-second interval. ${w.lastError}`;
    // Load-complete/scan errors must not push back an already armed reload.
    // A failed refresh itself gets one future retry, never an overdue busy loop.
    await scheduleAt(w,!refreshFailed&&Number.isFinite(w.next)?w.next:Date.now()+w.interval*1000);
    return;
  }
  const delay=Math.max(w.interval||1,Math.min(60,5*2**Math.min(w.checkFailures-1,4)));
  w.status=`Page check interrupted; retrying in ${delay} seconds. ${w.lastError}`;
  await schedule(w,delay);
}
function selectorExists(selector) {try{return !!document.querySelector(selector);}catch{return false;}}
async function prepareMonitoringFulfillment(w) {
  if(!w.autoCart||!w.rule||isUserPaused(w.id))return;
  const [{result:ready}]=await runPageScript({target:{tabId:w.id},func:ensureFulfillment,args:[w.rule,w.fulfillment,false]});
  const record=result=>{
    if(w.rule.store==='Walmart'&&result&&!result.cancelled)diagnosticEvent('fulfillment_result',w,{requested:w.fulfillment,selected:!!result.selected,ready:!!result.ready,unavailable:!!result.unavailable,changed:!!result.changed,detail:result.detail||''});
  };
  if(ready?.ready){record(ready);return ready;}
  if(w.rule.store==='Walmart'&&ready?.selected&&ready?.unavailable) {
    w.status=`${ready.detail} Continuing to watch ${w.fulfillment}.`;record(ready);return ready;
  }
  const [{result}]=await runPageAction(w,'fulfillment',[w.rule,w.fulfillment,true]);
  record(result);
  if(result?.changed) {
    w.selectionUntil=Date.now()+4000;w.status=result.detail;
    await runPageScript({target:{tabId:w.id},func:armPageTimer,args:[w.url,Date.now()+1000,'scanDue']});
  } else if(w.rule.store==='Walmart'&&result?.detail&&!result.cancelled)w.status=result.detail;
  return result;
}
async function addWatch(tab, msg) {
  if(removedStore(tab.url))throw Error('Target has been removed from this stock watcher.');
  const url = new URL(tab.url);
  if (!['http:', 'https:'].includes(url.protocol)) throw Error('Open a store product page first.');
  if ((await get(tab.id))?.pending) throw Error('A cart attempt is still being checked. Wait for its result.');
  const selector = String(msg.selector || '').trim();
  const rule = productRule(tab.url);
  if (msg.autoCart && !selector && !rule) throw Error('Open a product page at one of the five supported stores, or use Advanced setup to select its button.');
  const fulfillment=resolveFulfillment(rule,msg.fulfillment);
  const w = {kind: 'watch', id: tab.id, created:Date.now(), controlVersion:Date.now(), url: tab.url, title: tab.title || url.hostname, selector, rule, fulfillment, autoCart: !!msg.autoCart, interval: seconds(msg), paused: false, found: false, status: 'Waiting for first check'};
  w.nintendoAutoPassword=rule?.store==='Nintendo'&&rule?.mode==='cart'&&msg.nintendoAutoPassword===true;
  userPauses.delete(tab.id);
  await schedule(w); await ensureAlarm(); await armAvailability(w);await scan(tab.id); await badge();
}
async function resumeWatch(w) {
  const tab=await browserTabs.get(w.id);
  if(w.rule?.store==='Amazon') {
    const verification=await readAmazonVerification(w,tab);
    if(verification?.blocked) {
      await holdAmazonVerification(w,tab);
      throw Error('Amazon still needs verification. Complete its check, open the saved product, then Resume.');
    }
    if(w.amazonVerification&&!verification?.productReady)throw Error('Open the saved Amazon product and wait for its title to load before resuming.');
    if(w.amazonVerificationReview)w.amazonCheckCartFirst=true;
  }
  if(w.pending) {
    if(!w.userPaused)return;
    if(new URL(tab.url).origin!==new URL(w.url).origin)throw Error('Return to this store before continuing the existing cart check');
    userPauses.delete(w.id);w.userPaused=false;w.controlVersion=(w.controlVersion||0)+1;
    w.status='Resumed — checking the existing cart attempt; no new purchase entry';await save(w);await armResultCheck(w);
    return;
  }
  if(!samePage(tab.url,w.url)||(tab.pendingUrl&&!samePage(tab.pendingUrl,w.url))) {
    let failure;
    if(w.rule?.store==='Amazon'&&w.autoCart&&tab.status==='complete'&&!tab.pendingUrl&&new URL(tab.url).origin===new URL(w.url).origin) {
      const [{result:page}]=await runPageScript({target:{tabId:w.id},func:inspectAmazonPage,args:[w.rule,w.amazonTitle||'']});
      if(page?.page==='checkout'&&['unavailable','retryableError'].includes(page.state))failure=page;
    }
    if(!failure)throw Error('Return to the saved product page first');
    userPauses.delete(w.id);w.userPaused=false;w.alertPaused=false;w.alertBatch=null;w.alertPauseOwner=null;w.alertResumeIds=[];
    w.controlVersion=(w.controlVersion||0)+1;
    await returnAmazonProduct(w,failure.state==='retryableError'?'amazonServerError':'unavailable');return;
  }
  userPauses.delete(w.id);
  w.controlVersion=(w.controlVersion||0)+1;
  Object.assign(w,{userPaused:false,alertPaused:false,alertBatch:null,alertPauseOwner:null,alertResumeIds:[],paused:false,found:false,attention:false,retryAt:0,buttonAlerted:false,queueDetected:false,botReview:false,botActive:false,amazonReturning:false,amazonVerification:'',amazonVerificationReview:false,status:'Resumed — first check is due now'});
  w.next=Date.now()+100;await save(w);
  armWorkerRefresh(w);
  await chrome.alarms.create(`refresh:${w.id}`,{when:Date.now()+100});
  serial(async()=>{const current=await get(w.id);if(!current||current.paused)return;await armShortTimer(current);await armAvailability(current);},{key:`resume:${w.id}`});
}
async function recoverUndispatchedAttempts() {
  for(const w of await all()) {
    if(!w.pending||w.cartDispatched!==false)continue;
    w.pending=false;w.controlVersion=(w.controlVersion||0)+1;
    w.paused=!!(w.userPaused||w.alertPaused);
    w.status=w.paused?'Cart attempt interrupted before clicking. Resume to try again.':'Check interrupted before clicking; monitoring continues';
    await chrome.alarms.clear(`result:${w.id}`);await schedule(w);
    diagnosticEvent('attempt_cancelled_before_click',w,{},true);
  }
}
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  // Stop signals bypass the work queue so rendering waits cannot delay them.
  const trustedUI=sender.url?.split(/[?#]/)[0]===chrome.runtime.getURL('popup.html');
  if(trustedUI&&['diagnosticExport','diagnosticConfigure','diagnosticClear'].includes(msg.type)) {
    (async()=>{try{
      if(msg.type==='diagnosticConfigure')await Diagnostics.configure(msg.enabled===true);
      else if(msg.type==='diagnosticClear')await Diagnostics.clear();
      else {await diagnosticHeartbeat();const currentWatches=(await all()).map(diagnosticWatch);const {automaticSwitching=true}=await chrome.storage.local.get('automaticSwitching');reply({ok:true,report:await Diagnostics.report({currentWatches,automaticSwitching,queue:work.snapshot()})});return;}
      reply({ok:true});
    }catch(e){reply({ok:false,error:e.message});}})();return true;
  }
  if(trustedUI)diagnosticEvent('control_requested',{id:msg.id},{operation:msg.type},true);
  if(trustedUI&&['phoneConfigure','phoneTest'].includes(msg.type)) {
    (async()=>{
      try {
        if(msg.type==='phoneConfigure')await PhoneAlerts.configure(msg.enabled===true);
        else await PhoneAlerts.enqueue('phone-test','Stock Watch phone test','This is a test notification. Keep Chrome open and your PC awake.','',true);
        reply({ok:true});
      }catch(e){diagnosticEvent('control_error',{id:msg.id},{operation:msg.type,message:e.message},true);reply({ok:false,error:e.message});}
    })();return true;
  }
  if(trustedUI && (msg.type==='pause' || msg.type==='pauseAll')) {
    if(msg.type==='pauseAll')stoppingAll=true;else userPauses.add(msg.id);
    serial(async()=>{
      try {
        if(msg.type==='pauseAll') {
          const watches=await all();for(const w of watches)userPauses.add(w.id);
          for(const w of watches)await persistPause(w.id);
        }
        else await persistPause(msg.id);
        await badge();reply({ok:true});
      }catch(e){reply({ok:false,error:e.message});}
      finally {if(msg.type==='pauseAll')stoppingAll=false;await recoverUndispatchedAttempts();}
    },{control:true});
    return true;
  }
  if(!trustedUI&&sender.tab&&['refreshDue','scanDue'].includes(msg.type)) {
    serial(async()=>{
      const w=await get(sender.tab.id);
      if(!w||!samePage(sender.url,w.url))return;
      if(msg.type==='scanDue'&&w.rule?.store==='Best Buy'&&await protectBestBuyQueues(w.id))return;
      if(w.paused)return;
      if(msg.type==='scanDue')await scan(w.id);
      else if(msg.deadline===w.next&&Date.now()>=w.next)await refresh(w);
    },{key:`${msg.type}:${sender.tab.id}`}).then(()=>reply({ok:true}));return true;
  }
  serial(async () => {
    try {
      // An options page opened in a browser tab also has sender.tab.
      // Trust our exact UI URL, rather than using tab presence as page identity.
      const isExtensionUI = sender.url?.split(/[?#]/)[0] === chrome.runtime.getURL('popup.html');
      if (!isExtensionUI && !sender.tab) throw Error('Unknown message sender');
      if (!isExtensionUI && sender.tab) {
        if (msg.type === 'picked') {
          const id = sender.tab.id, setting = (await chrome.storage.local.get(`pick:${id}`))[`pick:${id}`];
          if (!setting || !samePage(sender.url, setting.url)) throw Error('Product page changed. Start button selection again from the extension.');
          await chrome.storage.local.remove(`pick:${id}`); await addWatch(await browserTabs.get(id), {...setting, selector: msg.selector});
        } else if (msg.type === 'cartResult') {
          const w = await get(sender.tab.id);
          if(w?.pending&&msg.token===w.token) {
            if(['Best Buy','Amazon'].includes(w.rule?.store))await readOutcome(w);
            else await finish(w,classifyCart(msg.signals,w.baseline));
          }
        } else throw Error('Unknown page message');
      } else if (msg.type === 'add') await addWatch(await browserTabs.get(msg.id), msg);
      else if (msg.type === 'pick') {
        const tab = await browserTabs.get(msg.id); seconds(msg);
        if(removedStore(tab.url))throw Error('Target has been removed from this stock watcher.');
        resolveFulfillment(productRule(tab.url),msg.fulfillment);
        if ((await get(msg.id))?.pending) throw Error('Wait for the current cart attempt to finish.');
        await chrome.storage.local.set({[`pick:${msg.id}`]: {...msg, url: tab.url, created: Date.now()}});
        await runPageScript({target: {tabId: msg.id}, func: pickButton});
      } else if (msg.type === 'interval') {
        const w = await get(msg.id); if (!w) throw Error('Watch no longer exists');
        w.interval = seconds(msg); await schedule(w, Math.max(w.interval, ((w.retryAt || 0) - Date.now()) / 1000));
      } else if(msg.type==='fulfillment') {
        const w=await get(msg.id);if(!w)throw Error('Watch no longer exists');
        if(w.pending)throw Error('Wait for the cart attempt to finish');
        if(!['pickup','shipping','delivery'].includes(msg.fulfillment))throw Error('Choose pickup, shipping, or Walmart delivery');
        const fulfillment=resolveFulfillment(productRule(w.url)||w.rule,msg.fulfillment);
        w.fulfillment=fulfillment;w.controlVersion=(w.controlVersion||0)+1;w.selectionUntil=0;
        await save(w);if(!w.paused)await chrome.alarms.create(`scan:${w.id}`,{when:Date.now()+100});
      } else if (msg.type === 'remove') {
        if ((await get(msg.id))?.pending) throw Error('Wait for the cart result before removing this watch.');
        await chrome.storage.local.remove(key(msg.id)); await chrome.alarms.clear(`refresh:${msg.id}`); await badge();
      } else if (msg.type === 'resumeAll') {
        const watches=(await all()).filter(w=>w.userPaused||(w.paused&&!w.pending));
        let resumed=0;const skipped=[];
        for(const w of watches) {
          try {await resumeWatch(w);resumed++;}
          catch(e){skipped.push(`${w.rule?.store || w.title}: ${e.message}`);}
        }
        await badge();reply({ok:true,message:`Resumed ${resumed} watch${resumed===1?'':'es'}.${skipped.length?' Still paused: '+skipped.join('; '):''}`});return;
      } else if (msg.type === 'toggle' || msg.type === 'resume') {
        const w = await get(msg.id);
        if (w) {
          if(msg.type==='resume'&&!w.paused){reply({ok:true});return;}
          if(w.paused)await resumeWatch(w);
          else await persistPause(w.id);
          await badge();
        }
      } else if (msg.type === 'test') await notify('test', 'Stock Watch is ready', 'Notifications work. Keep your browser open and your computer awake.');
      reply({ok: true});
    } catch (e) { diagnosticEvent('control_error',{id:msg.id},{operation:msg.type,message:e.message},true);reply({ok: false, error: e.message}); }
    finally {if(work.isControl())await recoverUndispatchedAttempts();}
  },{control:trustedUI&&['resumeAll','resume','toggle','remove','interval','fulfillment'].includes(msg.type)}); return true;
});
async function refresh(w) {
  if (!w || w.paused || isUserPaused(w.id)) return;
  if(w.rule?.store==='Nintendo'&&w.rule?.mode==='cart'&&!w.botActive) {
    if(await otherAttemptBlocks(w.id))return schedule(w,1);
    const tab=await browserTabs.get(w.id);
    if(await checkNavigation(w,tab))return;
    if(tab.status==='loading'||tab.pendingUrl){w.pageReady=false;w.nintendoStableSince=0;w.nintendoFingerprint='';return schedule(w,1);}
    await scan(w.id);w=await get(w.id);
    if(!w||w.paused||w.pending||isUserPaused(w.id))return;
    if(!w.pageReady)return;
    // Re-read immediately before reload: an enabled control cancels reload.
    const [{result:latest}]=await runPageScript({target:{tabId:w.id},func:inspectNintendoCart,args:[w.nintendoCartItem||'']});
    if(!['unavailable','blocked'].includes(latest?.state)||latest.product+':'+latest.state!==w.nintendoFingerprint)return scan(w.id);
    w.lastReload=Date.now();w.reloadCount=(w.reloadCount||0)+1;w.pageReady=false;w.nintendoStableSince=0;w.nintendoFingerprint='';await save(w);
    await browserTabs.reload(w.id);await schedule(w,1);return;
  }
  const bestBuy=w.rule?.store==='Best Buy';
  if(w.rule?.store==='Best Buy'&&await protectBestBuyQueues())return;
  if(w.botActive) {
    try { await scan(w.id); } finally {const current=await get(w.id);if(current&&!current.paused)await schedule(current);}
    return;
  }
  if (await otherAttemptBlocks(w.id)) {w.status='Waiting for the existing cart attempt or queue before trying this item';return schedule(w,w.interval);}
  if (w.retryAt > Date.now()) return schedule(w, Math.max(0.001, (w.retryAt - Date.now()) / 1000));
  if(w.rule?.store==='Nintendo'&&w.nintendoRetry) {
    w.nintendoRetry=false;await save(w);await scan(w.id);
    const current=await get(w.id);if(current&&!current.paused)await schedule(current,current.interval);
    return;
  }
  try {
    let tab = await browserTabs.get(w.id);
    if(await checkNavigation(w,tab))return;
    const foreground = await foregroundForRefresh(w.id,()=>isUserPaused(w.id),bestBuy?0:750);
    if(isUserPaused(w.id))return;
    w=await get(w.id);if(!w||w.paused)return;
    tab = await browserTabs.get(w.id);
    if (!samePage(tab.url,w.url) || (tab.pendingUrl&&!samePage(tab.pendingUrl,w.url))) {await schedule(w);return;}
    if((tab.status!=='loading'||bestBuy)&&!w.bestBuyRejected) {
      await scan(w.id);w=await get(w.id);if(!w || w.paused)return;
      if(bestBuy&&w.checkFailures&&!bestBuyNetworkError(w.lastError))throw Error(w.lastError);
      if(w.botActive)return schedule(w);
      if(w.selectionUntil>Date.now())return schedule(w,Math.max(1,(w.selectionUntil-Date.now())/1000));
    }
    if(tab.status!=='loading')w.loadingSince=0;
    else w.loadingSince=w.loadingSince||Date.now();
    if(!bestBuy&&tab.status==='loading'&&Date.now()-w.loadingSince<30000) {
      w.status='Page is still loading; checking again in one second';
      diagnosticEvent('refresh_delayed',w,{reason:'page loading',lateMs:Math.max(0,Date.now()-w.next)},false);
      return schedule(w,1);
    }
    if(!bestBuy&&tab.status==='loading') {
      // A hung product load must not stall forever, or destroy a visible queue.
      const [{result:gate}]=await runPageScript({target:{tabId:w.id},func:pageAttention});
      if(gate){
        if(gate.reason==='bot')return botAlert(w,gate.detail);
        w.attention=true;w.queueDetected=gate.reason==='queue';w.status=gate.detail||gate;
        await alertWatch(w,'Stock Watch needs attention');return;
      }
      diagnosticEvent('loading_recovery',w,{loadingMs:Date.now()-w.loadingSince},true,true);
    }
    if(!bestBuy)await schedule(w);
    if(isUserPaused(w.id))return;
    {
      w.status = foreground ? 'Refreshing in the active tab…' : 'Refreshing…'; await save(w);
      const reloadStarted=Date.now();
      await browserTabs.reload(w.id);
      w.loadingSince=reloadStarted;
      const previousReload=w.lastReload;
      w.bestBuyRejected=false;w.pageReady=false;w.lastReload=bestBuy?reloadStarted:Date.now();w.reloadCount=(w.reloadCount||0)+1;
      diagnosticEvent('refresh',w,{elapsedMs:previousReload?w.lastReload-previousReload:null,requestedMs:w.interval*1000},false);
      if(bestBuy)await scheduleAt(w,reloadStarted+w.interval*1000);
      else await schedule(w);
    }
    // Best Buy is inspected by load events and its DOM observer. Waiting here
    // would block the shared queue and add rendering time to its interval.
    if(foreground&&!bestBuy) {
      await settleForeground(w.id,()=>isUserPaused(w.id));
      if(isUserPaused(w.id))return;
      await scan(w.id);
      w=await get(w.id);
      if(w&&!w.paused){armWorkerRefresh(w);await armShortTimer(w);}
    }
  } catch (e) { await retryPageCheck(w,e,true); }
}
chrome.alarms.onAlarm.addListener(alarm => {
  if(alarm.name==='diagnostic:heartbeat')return diagnosticHeartbeat();
  if(alarm.name===PhoneAlerts.alarm)return PhoneAlerts.flush();
  if(alarm.name==='tick')PhoneAlerts.wake();
  return serial(async () => {
  if (alarm.name.startsWith('result:')) { const w = await get(Number(alarm.name.slice(7))); if (w?.pending) await readOutcome(w, Date.now()-(w.rule?.store==='Amazon'?(w.amazonStageStarted||w.started):w.started)>=30000); }
  else if (alarm.name.startsWith('refresh:')) {
    const w=await get(Number(alarm.name.slice(8)));
    if(alarm.scheduledTime && w?.next>Date.now())return;
    await refresh(w);
  }
  else if (alarm.name.startsWith('scan:')) await scan(Number(alarm.name.slice(5)));
  else if (alarm.name === 'tick') {
    if(await protectBestBuyQueues())return;
    for (const w of await all()) {
      if (w.pending && Date.now() - w.started > 45000) await readOutcome(w, true);
      else if (!w.paused && !(await chrome.alarms.get(`refresh:${w.id}`))) await schedule(w);
    }
  }
});});
chrome.tabs.onUpdated.addListener((id, change) => {
  if(!change.url && change.status!=='complete')return;
  return serial(async () => {
    const w=await get(id);if(!w)return;
    try {
      // Read the tab now, after queued work. Event snapshots may be obsolete.
      const tab=await browserTabs.get(id);
      if(w.nintendoRecoveryArmed&&await recoverNintendoCheckoutError(w,tab))return;
      if(change.url)diagnosticEvent('navigation',w,{observedUrl:diagnosticUrl(tab.url),pendingUrl:diagnosticUrl(tab.pendingUrl),loading:tab.status==='loading'},true);
      if(w.rule?.store==='Best Buy'&&await protectBestBuyQueues(id))return;
      if(w.amazonVerification||(w.paused&&!w.pending&&(w.pauseReason==='navigation'||w.status?.startsWith('Paused: tab navigated away')))) {
        if(await checkAmazonVerification(w,tab))return;
      }
      if(w.pending){if(tab.status==='complete')await readOutcome(w);return;}
      if(w.paused){if(w.pauseReason==='navigation'||w.status?.startsWith('Paused: tab navigated away'))await recoverAmazonRejection(w,tab);return;}
      if(change.url&&!samePage(change.url,tab.url))return;
      if(w.rule?.store==='Amazon'&&amazonOosUrl(tab.url)&&tab.status==='complete') {
        const [{result:signals}]=await runPageScript({target:{tabId:id},func:cartSignals,args:[w.rule]});
        if(classifyCart(signals||[]).reason==='amazonUnavailable')await returnAmazonProduct(w);
        else await checkNavigation(w,tab);
        return;
      }
      if(w.amazonReturning&&samePage(tab.url,w.url)) {
        w.amazonReturning=false;await save(w);
      }
      if(await checkNavigation(w,tab))return;
      if(tab.status==='complete') {
        await armAvailability(w);await scan(id);await armShortTimer(await get(id));
        if(!(await get(id))?.paused)await chrome.alarms.create(`scan:${id}`,{when:Date.now()+30000});
      }
    }catch(e){await retryPageCheck(w,e);}
  },{key:`updated:${id}`});
});
chrome.tabs.onRemoved.addListener(id => serial(async () => {
  const w = await get(id);
  if(w)diagnosticEvent('tab_closed',w,{},true);
  if (w?.pending) { await pauseOthers(id); try { await notify('closed', 'Cart attempt interrupted', 'A tab closed during a cart attempt. Other watches paused. Check that store’s cart before resuming.'); } catch {} }
  await chrome.storage.local.remove([key(id), `pick:${id}`]);
  for (const prefix of ['scan:', 'result:', 'refresh:']) await chrome.alarms.clear(`${prefix}${id}`); await badge();
}));
chrome.notifications.onClicked.addListener(async id => {
  if (!id.startsWith('stock:')) return;
  try { const tab = await browserTabs.update(Number(id.slice(6)), {active: true}); await chrome.windows.update(tab.windowId, {focused: true}); } catch {}
});
chrome.runtime.onStartup.addListener(() => serial(async () => {
  const watches = await all();
  diagnosticEvent('browser_startup',null,{watches:watches.map(diagnosticWatch)},true);
  if (watches.some(w => w.pending || w.found || w.attention)) { try { await notify('restart', 'Check your carts before restarting watches', 'Stock Watch stopped after the browser restarted. A previous cart attempt may have succeeded.'); } catch {} }
  for (const w of watches) await chrome.storage.local.remove(key(w.id));
  await ensureAlarm(); await badge();
}));
chrome.runtime.onInstalled.addListener(details => {diagnosticEvent('extension_loaded',null,{reason:details?.reason||'reload'},true);return serial(ensureAlarm);});
if(typeof addEventListener==='function') {
  addEventListener('error',event=>diagnosticEvent('worker_error',null,{message:event.message},true));
  addEventListener('unhandledrejection',event=>diagnosticEvent('worker_error',null,{message:event.reason?.message||String(event.reason)},true));
}
void Diagnostics.boot().catch(()=>{});
serial(ensureAlarm);
serial(removeTargetWatches);
serial(recoverAmazonNavigationPauses);
serial(async()=>{
  for(const w of await all())if(w.nintendoRecoveryArmed) {
    try{await recoverNintendoCheckoutError(w,await browserTabs.get(w.id));}catch{}
  }
});
serial(migrateRetryDeadlines);
