const assert=require('node:assert/strict'),vm=require('node:vm');
const {harness}=require('./control-audit-test.cjs');
const url='https://www.amazon.com/dp/B0HJ6F8L6V';
const page={page:'product',state:'pending',title:'Console',cartUrl:'https://www.amazon.com/cart',hasCartItems:true};
(async()=>{
  for(const stage of ['cart','checkout']){
    const h=await harness();h.add(1,url,{autoCart:true,pending:true,paused:true,amazonStage:stage,started:1,amazonStageStarted:1,token:'attempt'});h.state.pages[1]=page;
    await vm.runInContext('get(1).then(w=>readOutcome(w,true))',h.context);
    assert.equal(h.tabs[1].url,page.cartUrl);assert.equal(h.db['watch:1'].pending,true);assert.equal(h.db['watch:1'].amazonStallRecovered,true);
    assert.equal(h.events.filter(e=>e[0]==='action'||e[0]==='notice').length,0,'recovery neither purchases nor sends success alerts');
    // Failed recovery is bounded, rather than creating an endless navigation loop.
    h.tabs[1].url=url;await vm.runInContext('get(1).then(w=>readOutcome(w,true))',h.context);
    assert.equal(h.db['watch:1'].pending,false);assert.match(h.db['watch:1'].status,/unverified/);
  }
  const h=await harness();h.add(1,url,{paused:true,status:'Amazon checkout availability is unverified. This watch is paused',amazonStage:'cart'});h.state.pages[1]=page;
  await vm.runInContext('recoverAmazonNavigationPauses()',h.context);assert.equal(h.tabs[1].url,page.cartUrl,'reload repairs an existing stale pause');
  h.state.pages[1]={page:'cart',state:'unavailable',reason:'missingCartItem'};
  await vm.runInContext('get(1).then(w=>readOutcome(w))',h.context);assert.equal(h.db['watch:1'].paused,false);assert.equal(h.tabs[1].url,url,'empty cart returns to monitoring');
  for(const flags of [{userPaused:true},{alertPaused:true},{found:true},{botActive:true}]){
    const k=await harness();k.add(1,url,{paused:true,status:'Amazon checkout availability is unverified',...flags});k.state.pages[1]=page;
    await vm.runInContext('recoverAmazonNavigationPauses()',k.context);assert.equal(k.tabs[1].url,url);
  }
  const k=await harness();k.add(1,url,{paused:true,status:'Amazon checkout availability is unverified'});k.state.pages[1]={...page,title:''};
  await vm.runInContext('recoverAmazonNavigationPauses()',k.context);assert.equal(k.tabs[1].url,url,'unrecognized product cannot trigger recovery');
  console.log('PASS: bounded Amazon cart reconciliation, old pause migration, rejection recovery and pause protections');
})().catch(e=>{console.error(e);process.exitCode=1;});
