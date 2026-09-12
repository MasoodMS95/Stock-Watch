const assert=require('node:assert/strict'),vm=require('node:vm');
const {harness}=require('./control-audit-test.cjs');
const {inspectAmazonPage}=require('./amazon.js');
const rule={store:'Amazon',productId:'B0HJ6F8L6V'};
const visible=(text,attrs={})=>({innerText:text,getClientRects:()=>[{}],getAttribute:k=>attrs[k]??null});
const cases=[];
function test(name,fn){cases.push([name,fn]);}
test('Amazon image-only server error and unstyled h3 inventory rejection',()=>{
  let dom={};global.document={querySelector:s=>(dom[s]||[])[0]||null,querySelectorAll:s=>dom[s]||[]};
  global.location={hostname:'www.amazon.com',pathname:'/checkout/entry/buynow',href:'https://www.amazon.com/checkout/entry/buynow'};
  global.getComputedStyle=()=>({visibility:'visible',display:'block'});
  dom={'img[alt]':[visible('',{alt:"Sorry! Something went wrong on our end. Please go back and try again or go to Amazon's home page."})]};
  assert.equal(inspectAmazonPage(rule).state,'retryableError');
  dom={'h1,h2,h3,h4':[visible("You cannot buy this item because it's out of stock")]};
  assert.equal(inspectAmazonPage(rule).state,'unavailable');
  dom={'img[alt]':[visible('',{alt:'Dogs of Amazon'})]};assert.equal(inspectAmazonPage(rule).state,'pending');
  dom={'img[alt]':[visible('',{alt:'Sorry! Something went wrong on our end. Please go back and try again',hidden:true})]};
  dom['img[alt]'][0].getClientRects=()=>[];assert.equal(inspectAmazonPage(rule).state,'pending');
  global.location.hostname='amazon.com.evil.example';assert.equal(inspectAmazonPage(rule).page,'other');
  delete global.document;delete global.location;delete global.getComputedStyle;
});
test('Amazon server error returns to product silently and verifies existing cart before retry',async()=>{
  const h=await harness();h.add(1,'https://www.amazon.com/dp/B0HJ6F8L6V',{autoCart:true,pending:true,paused:true,cartDispatched:true,token:'entry',started:Date.now()});
  h.tabs[1].url='https://www.amazon.com/checkout/entry/buynow';h.state.pages[1]={page:'checkout',state:'retryableError',reason:'amazonServerError'};
  await h.scan(1);assert.equal(h.db['watch:1'].pending,false);assert.equal(h.db['watch:1'].paused,false);assert.match(h.tabs[1].url,/B0HJ6F8L6V/);
  assert.match(h.db['watch:1'].status,/server error/i);assert.equal(h.db['watch:1'].amazonCheckCartFirst,true);
  h.state.found=false;h.state.pages[1]={page:'product',state:'pending',cartUrl:'https://www.amazon.com/cart',hasCartItems:false};
  await h.scan(1);assert.equal(h.tabs[1].url,'https://www.amazon.com/cart');
  assert.equal(h.events.filter(e=>e[0]==='action'&&e[2]==='purchase').length,0,'unknown server result cannot duplicate an addition');
  assert.equal(h.events.filter(e=>e[0]==='notice').length,0);await h.call({type:'pauseAll'});
});
test('Manual pause survives Amazon error recovery',async()=>{
  const h=await harness();h.add(1,'https://www.amazon.com/dp/B0HJ6F8L6V',{autoCart:true,pending:true,paused:true,userPaused:true,cartDispatched:true,token:'entry',started:Date.now()});
  h.tabs[1].url='https://www.amazon.com/checkout/entry/buynow';h.state.pages[1]={page:'checkout',state:'retryableError',reason:'amazonServerError'};
  await h.scan(1);assert.equal(h.db['watch:1'].pending,false);assert.equal(h.db['watch:1'].userPaused,true);
  assert.equal(h.tabs[1].url,'https://www.amazon.com/checkout/entry/buynow');await h.call({type:'pauseAll'});
});
test('Resume continues a manually paused pending attempt without a new purchase',async()=>{
  const h=await harness();h.add(1,'https://www.amazon.com/dp/B0HJ6F8L6V',{autoCart:true,pending:true,paused:true,userPaused:true,cartDispatched:true,token:'entry',started:Date.now()});
  h.tabs[1].url='https://www.amazon.com/cart';h.state.pages[1]={page:'cart',state:'pending'};
  assert.equal((await h.call({type:'resume',id:1})).ok,true);assert.equal(h.db['watch:1'].userPaused,false);assert.equal(h.db['watch:1'].pending,true);
  assert.equal(h.db['watch:1'].token,'entry');assert.equal(h.events.filter(e=>e[0]==='action'&&e[2]==='purchase').length,0);await h.call({type:'pauseAll'});
});
test('Same retailer attempts serialize even with independent windows',async()=>{
  const h=await harness();h.add(1,'https://www.amazon.com/dp/B0HJ6F8L6V',{autoCart:true,pending:true,paused:true,cartDispatched:true,token:'first',started:Date.now()});
  h.add(2,'https://www.amazon.com/dp/B012345678',{autoCart:true});h.state.found=true;
  await h.scan(2);assert.equal(h.db['watch:2'].pending,undefined);assert.equal(h.db['watch:2'].paused,false);
  assert.equal(h.events.filter(e=>e[0]==='action'&&e[2]==='purchase').length,0);await h.call({type:'pauseAll'});
});
test('Explicit Resume recovers a known Amazon failure, but not a different product',async()=>{
  const h=await harness();h.add(1,'https://www.amazon.com/dp/B0HJ6F8L6V',{autoCart:true,paused:true,userPaused:true});
  h.tabs[1].url='https://www.amazon.com/checkout/entry/buynow';h.state.pages[1]={page:'checkout',state:'retryableError',reason:'amazonServerError'};
  assert.equal((await h.call({type:'resume',id:1})).ok,true);assert.match(h.tabs[1].url,/B0HJ6F8L6V/);assert.equal(h.db['watch:1'].paused,false);
  await h.call({type:'pause',id:1});h.tabs[1].url='https://www.amazon.com/dp/B012345678';h.state.pages[1]={page:'product',state:'pending'};
  assert.equal((await h.call({type:'resume',id:1})).ok,false);assert.equal(h.db['watch:1'].userPaused,true);
});
test('Worker recovery leaves an unverified attempt on the product page paused',async()=>{
  const h=await harness();h.add(1,'https://www.amazon.com/dp/B0HJ6F8L6V',{autoCart:true,paused:true,attention:true,status:'Amazon checkout availability is unverified. Check the tab.'});
  await vm.runInContext('recoverAmazonNavigationPauses()',h.context);assert.equal(h.db['watch:1'].paused,true);
});
test('Alert ownership does not overwrite an earlier independent alert',async()=>{
  const h=await harness();h.add(1,'https://www.bestbuy.com/product/game/J7GSL57HTY/sku/6691841',{alertBatch:'original',alertPauseOwner:'original',alertPaused:true,paused:true,attention:true,alertResumeIds:[1]});
  h.add(2,'https://www.walmart.com/ip/console/123456',{status:'Found button'});h.db.automaticSwitching=true;
  await vm.runInContext("get(2).then(w=>alertWatch(w,'New alert'))",h.context);
  assert.equal(h.db['watch:1'].alertPauseOwner,'original');await h.call({type:'pauseAll'});
});
test('Final cart alert retains the watches eligible for resume after Best Buy rejection',async()=>{
  const h=await harness();h.db.automaticSwitching=true;
  h.add(1,'https://www.bestbuy.com/product/game/J7GSL57HTY/sku/6691841',{pending:true,paused:true,token:'queue',started:Date.now()});
  h.add(2,'https://www.walmart.com/ip/console/123456');
  await vm.runInContext("get(1).then(w=>finish(w,{state:'attention',reason:'queue',detail:'You are in line'}))",h.context);
  assert.ok(h.db['watch:1'].alertResumeIds.includes(2));await h.call({type:'pauseAll'});
});
test('Pending result polling survives checks without a toast or navigation',async()=>{
  const h=await harness();h.add(1,'https://www.gamestop.com/products/game/451607.html',{pending:true,paused:true,cartDispatched:true,token:'first',started:Date.now()});
  delete h.alarms['result:1'];await h.scan(1);assert.ok(h.alarms['result:1']);await h.call({type:'pauseAll'});
});
test('Worker recovery reconstructs missing alarms while preserving pauses',async()=>{
  const h=await harness();h.add(1,'https://www.walmart.com/ip/console/123456',{next:Date.now()+10000});
  h.add(2,'https://www.gamestop.com/products/game/451607.html',{userPaused:true,paused:true});
  h.add(3,'https://www.amazon.com/dp/B0HJ6F8L6V',{pending:true,paused:true,cartDispatched:true,token:'first',started:Date.now()});
  await vm.runInContext('migrateRetryDeadlines()',h.context);
  assert.ok(h.alarms['refresh:1']);assert.equal(h.alarms['refresh:2'],undefined);assert.ok(h.alarms['result:3']);await h.call({type:'pauseAll'});
});
test('A product load that never completes recovers, but a visible queue is protected',async()=>{
  const h=await harness();h.add(1,'https://www.walmart.com/ip/console/123456');h.tabs[1].status='loading';
  await h.chrome.alarms.onAlarm.fn({name:'refresh:1'});assert.equal(h.events.filter(e=>e[0]==='reload').length,0);
  h.advance(31000);await h.chrome.alarms.onAlarm.fn({name:'refresh:1'});assert.equal(h.events.filter(e=>e[0]==='reload').length,1);
  h.state.gates[1]={reason:'queue',detail:'You are in line'};h.advance(31000);
  await h.chrome.alarms.onAlarm.fn({name:'refresh:1'});assert.equal(h.events.filter(e=>e[0]==='reload').length,1);
  assert.equal(h.db['watch:1'].queueDetected,true);await h.call({type:'pauseAll'});
});
test('Walmart availability in the wrong fulfillment mode cannot raise a cart alert',async()=>{
  const h=await harness();h.add(1,'https://www.walmart.com/ip/console/123456',{autoCart:true,fulfillment:'shipping'});h.state.found=true;
  const execute=h.chrome.scripting.executeScript;h.chrome.scripting.executeScript=async o=>o.func?.name==='ensureFulfillment'?[{result:{ready:false,selected:true,unavailable:true,detail:'Shipping selected; out of stock.'}}]:execute(o);
  await h.scan(1);assert.equal(h.db['watch:1'].paused,false);assert.match(h.db['watch:1'].status,/Shipping selected/);
  assert.equal(h.events.filter(e=>e[0]==='notice').length,0);assert.equal(h.events.filter(e=>e[0]==='action'&&e[2]==='purchase').length,0);await h.call({type:'pauseAll'});
});
test('An interrupted attempt that never dispatched a cart click cannot remain frozen',async()=>{
  const h=await harness();h.add(1,'https://www.gamestop.com/products/game/451607.html',{autoCart:true,pending:true,paused:true,cartDispatched:false,token:'not-sent',started:Date.now()});
  h.add(2,'https://www.walmart.com/ip/console/123456');
  await h.call({type:'interval',id:2,interval:5});await h.drain();
  assert.equal(h.db['watch:1'].pending,false);assert.equal(h.db['watch:1'].paused,false);assert.ok(h.alarms['refresh:1']);await h.call({type:'pauseAll'});
});
test('A navigation error during outcome polling schedules another observation',async()=>{
  const h=await harness();h.add(1,'https://www.gamestop.com/products/game/451607.html',{pending:true,paused:true,cartDispatched:true,token:'sent',started:Date.now()});h.state.fail='cartSignals';
  await h.scan(1);assert.ok(h.alarms['result:1']);await h.call({type:'pauseAll'});
});
test('The scan event survives a later status-only update in the queue',async()=>{
  const h=await harness();h.add(1,'https://www.walmart.com/ip/console/123456');
  let release;const held=vm.runInContext('serial',h.context)(()=>new Promise(r=>{release=r;}),{control:true});
  h.tabs[1].url='https://www.walmart.com/search';
  const a=h.chrome.tabs.onUpdated.fn(1,{url:h.tabs[1].url});const b=h.chrome.tabs.onUpdated.fn(1,{status:'complete'});
  release();await held;await a;await b;await h.drain();
  assert.equal(h.db['watch:1'].navigationCandidate,h.tabs[1].url);await h.call({type:'pauseAll'});
});
(async()=>{let failed=0;for(const [name,fn]of cases){try{await fn();console.log('PASS: '+name);}catch(e){failed++;console.error('FAIL: '+name+' — '+e.message);}}if(failed)process.exitCode=1;})().catch(e=>{console.error(e);process.exitCode=1;});
