const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const {createWorkQueue}=require('./work-queue.js');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function within(promise,ms=1000){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Operation did not finish promptly')),ms);})]);}finally{clearTimeout(timer);}}
async function harness() {
  const db={automaticSwitching:false},tabs={},alarms={},events=[],state={found:false,pages:{},verifications:{},gates:{},rejections:{},block:null,fail:null};
  let now=Date.now();class Clock extends Date {static now(){return now;}}
  const event=()=>({addListener(fn){this.fn=fn;}});
  const chrome={runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onMessage:event(),onStartup:event(),onInstalled:event()},
    storage:{local:{get:async keys=>structuredClone(keys===null?db:Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in db).map(k=>[k,db[k]]))),set:async values=>Object.assign(db,structuredClone(values)),remove:async keys=>(Array.isArray(keys)?keys:[keys]).forEach(k=>delete db[k])}},
    tabs:{get:async id=>{if(!tabs[id])throw Error('No tab with id '+id);return {...tabs[id]};},query:async()=>Object.values(tabs).filter(t=>t.active),update:async(id,options)=>{events.push(['update',id,options]);return Object.assign(tabs[id],options);},reload:async id=>events.push(['reload',id]),onUpdated:event(),onRemoved:event()},
    windows:{update:async id=>events.push(['focus',id])},action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},
    notifications:{clear:async()=>{},create:async(id,options)=>events.push(['notice',id,options]),onClicked:event()},
    alarms:{get:async name=>alarms[name],create:async(name,options)=>{alarms[name]=options;},clear:async name=>{delete alarms[name];},onAlarm:event()},
    scripting:{executeScript:async options=>{
      assert.equal(options.injectImmediately,true,'page checks must not wait for document_idle');
      if(options.files)return [];
      const name=options.func.name,id=options.target.tabId;
      if(state.block?.name===name){const block=state.block;state.block=null;block.entered.resolve();return block.release.promise;}
      if(state.fail===name)throw Error('Frame was removed during navigation');
      if(name==='performPageAction'){events.push(['action',id,options.args[0]]);if(options.args[0]==='bestBuyClose')state.rejections[id]={unavailable:true,modal:false};return [{result:{ready:true,clicked:true}}];}
      if(name==='resolveBestBuyRule')return [{result:{...options.args[0],needsSku:false,productId:'6691841'}}];
      if(name==='inspectAmazonVerification')return [{result:state.verifications[id]||{blocked:false,productReady:false,homepageReady:false}}];
      const result=name==='resolveProductButton'?(state.resolved||{selector:'#primary'}):name==='inspectStock'?{found:state.found,label:'Pre-order'}:name==='ensureFulfillment'?{ready:true}:name==='pageAttention'?(state.gates[id]||''):name==='cartSignals'?[]:name==='inspectAmazonPage'?(state.pages[id]||{page:'product',state:'pending'}):name==='bestBuySoldOut'?(state.rejections[id]||{unavailable:false}):null;
      return [{result}];
    }}
  };
  const context=vm.createContext({chrome,crypto:webcrypto,console,URL,Date:Clock,AbortController,setTimeout,clearTimeout});
  context.importScripts=(...names)=>names.forEach(n=>vm.runInContext(fs.readFileSync(__dirname+'/'+n,'utf8'),context));
  vm.runInContext(fs.readFileSync(__dirname+'/background.js','utf8'),context);
  const drain=()=>vm.runInContext('queue',context);await drain();
  function add(id,url,extra={}) {tabs[id]={id,url,title:'Console',status:'complete',active:true,windowId:id};db['watch:'+id]={kind:'watch',id,url,title:'Console',interval:5,selector:'#primary',rule:vm.runInContext('productRule('+JSON.stringify(url)+')',context),paused:false,autoCart:false,status:'Monitoring',...extra};return db['watch:'+id];}
  const call=msg=>new Promise(resolve=>chrome.runtime.onMessage.fn(msg,{id:'test',url:'chrome-extension://test/popup.html'},resolve));
  const scan=id=>chrome.alarms.onAlarm.fn({name:'scan:'+id});
  return {db,tabs,alarms,events,state,context,chrome,drain,add,call,scan,advance:ms=>{now+=ms;}};
}
module.exports={harness};
if(require.main===module)(async()=>{
  // Queue controls interrupt a hung injection, then stale completion is ignored.
  const q=createWorkQueue(),hold=deferred(),started=deferred(),order=[];
  q.enqueue(async()=>{started.resolve();await q.guard(hold.promise);order.push('stale');});await started.promise;
  q.enqueue(()=>order.push('old check'),{key:'scan:1'});q.enqueue(()=>order.push('latest check'),{key:'scan:1'});
  await within(q.enqueue(()=>order.push('pause'),{control:true}));hold.resolve();await q.idle();
  assert.deepEqual(order,['pause','latest check']);
  await assert.rejects(q.guard(new Promise(()=>{}),20),/did not respond/);
  const h=await harness();h.add(1,'https://www.amazon.com/gp/product/B0HJ6F8L6V/');h.add(2,'https://www.gamestop.com/products/game/451607.html',{paused:true,userPaused:true});
  const stall={name:'inspectStock',entered:deferred(),release:deferred()};h.state.block=stall;
  const scan=h.scan(1);await stall.entered.promise;
  assert.equal((await within(h.call({type:'pause',id:1}))).ok,true);
  assert.equal(h.db['watch:1'].userPaused,true);assert.equal(h.alarms['refresh:1'],undefined);
  stall.release.resolve([{result:{found:true,label:'Pre-order'}}]);await scan;await h.drain();
  assert.equal(h.events.filter(e=>e[0]==='action').length,0,'late stock result after Pause cannot click');
  assert.equal(h.db['watch:1'].status,'Paused by you');
  await h.call({type:'resume',id:1});await h.drain();
  const stall2={name:'inspectStock',entered:deferred(),release:deferred()};h.state.block=stall2;
  const scan2=h.scan(1);await stall2.entered.promise;
  assert.equal((await within(h.call({type:'resume',id:2}))).ok,true,'Resume interrupts another frozen page');
  assert.equal(h.db['watch:2'].paused,false);stall2.release.resolve([{result:{found:false}}]);await scan2;await h.drain();
  h.state.fail='inspectStock';await h.scan(1);await h.drain();
  assert.equal(h.db['watch:1'].paused,false);assert.match(h.db['watch:1'].status,/retrying/);assert.ok(h.alarms['refresh:1']);h.state.fail=null;
  await h.scan(1);assert.equal(h.db['watch:1'].checkFailures,0,'a successful check clears retry failures');
  // Separate active windows with switching off: refresh the requested tab only.
  const before=h.events.length;await h.chrome.alarms.onAlarm.fn({name:'refresh:2'});await h.drain();
  assert.ok(h.events.slice(before).some(e=>e[0]==='reload'&&e[1]===2));
  assert.ok(h.events.slice(before).every(e=>!['focus','update'].includes(e[0])));
  assert.equal(h.db['watch:1'].paused,false);assert.equal(h.db['watch:2'].paused,false);
  const original=h.tabs[1].url;
  await h.chrome.tabs.onUpdated.fn(1,{url:'https://www.amazon.com/checkout/entry/oos'});await h.drain();
  assert.equal(h.db['watch:1'].paused,false,'outdated URL event does not pause the current product');
  h.tabs[1].pendingUrl='https://www.amazon.com/redirect';h.tabs[1].status='loading';await h.scan(1);
  assert.equal(h.db['watch:1'].paused,false,'a pending redirect is allowed to finish');
  delete h.tabs[1].pendingUrl;h.tabs[1].status='complete';h.tabs[1].url='https://www.amazon.com/dp/B0HJ6F8L6V?ref=canonical';await h.scan(1);
  assert.equal(h.db['watch:1'].paused,false,'same ASIN canonicalization works across separate windows');
  h.tabs[2].url='https://www.gamestop.com/search-new/?q=Switch+2';await h.scan(2);assert.equal(h.db['watch:2'].paused,false);
  h.advance(2000);await h.scan(2);assert.equal(h.db['watch:2'].paused,true);assert.equal(h.db['watch:2'].pauseReason,'navigation');assert.equal(h.db['watch:2'].currentUrl,h.tabs[2].url);
  assert.equal((await h.call({type:'resume',id:2})).ok,false,'Resume explains that a real destination change needs a return');
  // Inventory rejection with no pending token (including a stale navigation pause).
  h.db['watch:1'].autoCart=true;h.tabs[1].url='https://www.amazon.com/checkout/p/test/itemselect';
  h.state.pages[1]={page:'checkout',state:'unavailable',reason:'checkoutItemError'};
  const notices=h.events.filter(e=>e[0]==='notice').length;await h.scan(1);await h.drain();
  assert.match(h.tabs[1].url,/B0HJ6F8L6V/);assert.equal(h.db['watch:1'].paused,false);assert.equal(h.db['watch:1'].retryAt,0);
  assert.equal(h.events.filter(e=>e[0]==='notice').length,notices,'inventory rejection is not a stock alert');
  h.tabs[1].url='https://www.amazon.com/checkout/p/test/itemselect';Object.assign(h.db['watch:1'],{paused:true,pauseReason:'navigation',status:'Paused: tab navigated away'});
  await h.chrome.tabs.onUpdated.fn(1,{status:'complete'});await h.drain();assert.equal(h.db['watch:1'].paused,false);assert.match(h.tabs[1].url,/B0HJ6F8L6V/);
  await h.call({type:'pause',id:1});h.tabs[1].url='https://www.amazon.com/checkout/p/test/itemselect';
  await h.chrome.tabs.onUpdated.fn(1,{status:'complete'});await h.drain();assert.match(h.tabs[1].url,/itemselect/,'manual pause prevents automatic return');
  Object.assign(h.db['watch:1'],{pending:true,token:'existing',cartDispatched:true,started:Date.now(),amazonStage:null});h.state.pages[1]={page:'cart',state:'cartReady'};
  await h.chrome.alarms.onAlarm.fn({name:'result:1'});await h.drain();assert.equal(h.db['watch:1'].pending,false,'manual pause cannot leave cartReady pending forever');
  assert.equal(h.events.filter(e=>e[0]==='action').length,0);
  // A manual Best Buy queue in an active window protects other watches too.
  const bb=h.add(3,'https://www.bestbuy.com/product/game/J7GSL57HTY/sku/6691841',{paused:true,userPaused:true});h.state.gates[3]={reason:'queue',detail:"You're in line"};
  h.tabs[2].url=h.db['watch:2'].url;await h.call({type:'resume',id:2});await h.drain();h.db.automaticSwitching=true;
  const checkpoint=h.events.length;await h.chrome.alarms.onAlarm.fn({name:'refresh:2'});await h.drain();
  assert.equal(h.db['watch:3'].queueDetected,true);assert.equal(h.db['watch:2'].paused,true);
  assert.ok(h.events.slice(checkpoint).every(e=>e[0]!=='reload'),'queue detection prevents another store refresh');
  assert.ok(h.events.slice(checkpoint).filter(e=>e[0]==='update').every(e=>e[1]===3),'queue keeps the Best Buy window in front');
  // The local queue observer protects only its own watch with switching off.
  h.db.automaticSwitching=false;h.state.gates[3]='';await h.call({type:'resume',id:3});await h.call({type:'pause',id:3});await h.call({type:'resume',id:2});await h.drain();
  h.state.gates[3]={reason:'queue',detail:"You're in line"};
  await new Promise(resolve=>h.chrome.runtime.onMessage.fn({type:'scanDue'},{id:'test',url:h.tabs[3].url,tab:{id:3}},resolve));await h.drain();
  assert.equal(h.db['watch:2'].paused,false,'a queue observer leaves other independent windows running');
  assert.equal(h.db['watch:3'].paused,true);
  const independent=await harness();
  independent.add(1,'https://www.amazon.com/dp/B0HJ6F8L6V',{autoCart:true});independent.add(2,'https://www.gamestop.com/products/game/451607.html',{autoCart:true});independent.add(3,'https://www.walmart.com/ip/console/21002656445');
  independent.state.found=true;await independent.scan(1);await independent.scan(2);await independent.drain();
  assert.equal(independent.db['watch:1'].pending,true);assert.equal(independent.db['watch:2'].pending,true,'different stores can check one cart attempt each');
  assert.equal(independent.db['watch:3'].paused,false);assert.match(independent.db['watch:2'].status,/Attempting/);
  independent.state.found=false;await independent.chrome.alarms.onAlarm.fn({name:'refresh:3'});await independent.drain();
  assert.ok(independent.events.some(e=>e[0]==='reload'&&e[1]===3),'other windows refresh during pending attempts');
  await vm.runInContext("(async()=>finish(await get(2),{state:'confirmed',detail:'Added to cart'}))()",independent.context);
  assert.equal(independent.db['watch:3'].paused,false);assert.match(independent.db['watch:2'].status,/other windows continue/);
  assert.ok(independent.events.every(e=>!['update','focus'].includes(e[0])),'independent alerts never take focus');
  const rejection=await harness();
  rejection.add(6,'https://www.bestbuy.com/product/console/J7GSL57HTY',{autoCart:true});rejection.add(7,'https://www.gamestop.com/products/game/451607.html');rejection.add(8,'https://www.walmart.com/ip/console/21002656445',{paused:true,userPaused:true});
  rejection.state.found=true;await rejection.scan(6);assert.equal(rejection.db['watch:6'].rule.productId,'6691841','short Best Buy URL resolves numeric SKU before queue');
  rejection.state.gates[6]={reason:'queue',detail:"You're in line"};await rejection.chrome.tabs.onUpdated.fn(6,{status:'complete'});await rejection.drain();
  assert.equal(rejection.db['watch:6'].queueDetected,true);assert.equal(rejection.db['watch:7'].paused,false);
  rejection.state.gates[6]='';rejection.state.rejections[6]={unavailable:true,modal:true};
  await new Promise(resolve=>rejection.chrome.runtime.onMessage.fn({type:'scanDue'},{id:'test',url:rejection.tabs[6].url,tab:{id:6}},resolve));await rejection.drain();
  assert.ok(rejection.events.some(e=>e[0]==='action'&&e[2]==='bestBuyClose'));assert.equal(rejection.db['watch:6'].paused,false,'terminal queue rejection resumes its own watch');assert.equal(rejection.db['watch:6'].bestBuyRejected,true);
  assert.equal(rejection.db['watch:7'].paused,false);assert.equal(rejection.db['watch:8'].userPaused,true,'recovery preserves manual pauses');
  console.log('PASS: interrupted checks, priority controls, late results, retries, separate windows, navigation settling, orphaned Amazon rejections, pending pause, Best Buy queue');
})().catch(e=>{console.error(e);process.exitCode=1;});
