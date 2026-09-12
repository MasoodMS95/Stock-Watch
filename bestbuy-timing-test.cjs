const assert=require('node:assert/strict'),vm=require('node:vm');
const {harness}=require('./control-audit-test.cjs');
const url='https://www.bestbuy.com/product/console/J7GSL57HTY/sku/6691841';
const now=h=>vm.runInContext('Date.now()',h.context);
const cases=[];
const test=(name,fn)=>cases.push([name,fn]);
test('Best Buy inspection errors keep the saved reload deadline without exponential delay',async()=>{
  const h=await harness(),start=now(h);h.add(1,url,{lastReload:start,next:start+5000});h.state.fail='pageAttention';
  for(let i=0;i<5;i++){h.advance(500);await h.scan(1);assert.equal(h.db['watch:1'].next,start+5000);}
  assert.match(h.db['watch:1'].status,/5.second interval/);await h.call({type:'pauseAll'});
});
test('Five seconds is measured from reload dispatch, not callback completion',async()=>{
  const h=await harness(),start=now(h);h.add(1,url);
  const reload=h.chrome.tabs.reload;h.chrome.tabs.reload=async id=>{await reload(id);h.advance(1200);};
  await h.chrome.alarms.onAlarm.fn({name:'refresh:1'});
  assert.equal(h.db['watch:1'].lastReload,start);assert.equal(h.db['watch:1'].next,start+5000);
  h.advance(3800);await h.chrome.alarms.onAlarm.fn({name:'refresh:1'});
  assert.equal(h.db['watch:1'].lastReload,start+5000);await h.call({type:'pauseAll'});
});
for(const errorMessage of ['Cannot access contents of url "chrome-error://chromewebdata/".','Frame with ID 0 is showing error page'])test('Repeated Chrome network-error documents still reload: '+errorMessage,async()=>{
  const h=await harness();h.add(1,url);const execute=h.chrome.scripting.executeScript;
  h.chrome.scripting.executeScript=async o=>{if(o.func?.name!=='armPageTimer')throw Error(errorMessage);return execute(o);};
  const start=now(h);
  for(let n=0;n<4;n++){
    await h.chrome.alarms.onAlarm.fn({name:'refresh:1'});assert.equal(h.db['watch:1'].lastReload,start+n*5000);
    assert.equal(h.db['watch:1'].next,start+(n+1)*5000);
    h.advance(600);await h.chrome.tabs.onUpdated.fn(1,{status:'complete'});
    assert.equal(h.db['watch:1'].next,start+(n+1)*5000,'failed load completion cannot move the deadline');h.advance(4400);
  }
  assert.equal(h.events.filter(e=>e[0]==='reload').length,4);await h.call({type:'pauseAll'});
});
test('Loading Best Buy pages use the requested interval while a visible queue is protected',async()=>{
  const h=await harness();h.add(1,url);h.tabs[1].status='loading';
  await h.chrome.alarms.onAlarm.fn({name:'refresh:1'});assert.equal(h.events.filter(e=>e[0]==='reload').length,1);
  h.advance(5000);h.state.gates[1]={reason:'queue',detail:'You are in line'};
  await h.chrome.alarms.onAlarm.fn({name:'refresh:1'});assert.equal(h.events.filter(e=>e[0]==='reload').length,1);assert.equal(h.db['watch:1'].queueDetected,true);
  await h.call({type:'pauseAll'});
});
test('Best Buy foreground refresh skips fixed dwell and post-load settling',async()=>{
  const h=await harness();h.add(1,url);let prewait,settles=0;
  h.context.foregroundForRefresh=async(id,stopped,wait=750)=>{prewait=wait;h.advance(wait);return true;};
  h.context.settleForeground=async()=>{settles++;h.advance(7500);};
  await h.chrome.alarms.onAlarm.fn({name:'refresh:1'});assert.equal(prewait,0);assert.equal(settles,0);await h.call({type:'pauseAll'});
});
test('An unreadable ordinary page is not blindly refreshed over a possible queue',async()=>{
  const h=await harness();h.add(1,url);h.state.fail='pageAttention';const start=now(h);
  await h.chrome.alarms.onAlarm.fn({name:'refresh:1'});assert.equal(h.events.filter(e=>e[0]==='reload').length,0);assert.equal(h.db['watch:1'].next,start+5000);
  await h.call({type:'pauseAll'});
});
test('Legacy Best Buy backoff is removed on worker startup without resuming manual pauses',async()=>{
  const h=await harness(),start=now(h);h.add(1,url,{lastReload:start,next:start+60000,checkFailures:5,status:'Page check interrupted; retrying in 60 seconds'});
  h.add(2,url,{paused:true,userPaused:true,next:start+60000});
  await vm.runInContext('migrateRetryDeadlines()',h.context);assert.equal(h.db['watch:1'].next,start+5000);assert.equal(h.db['watch:2'].userPaused,true);
  await h.call({type:'pauseAll'});
});
test('Fractional seconds, minutes, interval edits, and manual pause retain their meaning',async()=>{
  const h=await harness();h.add(1,url,{interval:0.25});await h.chrome.alarms.onAlarm.fn({name:'refresh:1'});
  assert.equal(h.db['watch:1'].next-h.db['watch:1'].lastReload,250);
  await h.call({type:'interval',id:1,interval:120});assert.equal(h.db['watch:1'].next-now(h),120000);
  h.state.fail='pageAttention';h.advance(1000);await h.scan(1);assert.equal(h.db['watch:1'].next-now(h),119000);
  await h.call({type:'pause',id:1});const count=h.events.filter(e=>e[0]==='reload').length;
  await h.chrome.alarms.onAlarm.fn({name:'refresh:1'});assert.equal(h.events.filter(e=>e[0]==='reload').length,count);
});
test('A recovered product page starts its preorder immediately and protects the attempt',async()=>{
  const h=await harness();h.add(1,url,{autoCart:true});
  await h.chrome.alarms.onAlarm.fn({name:'refresh:1'});h.advance(1200);h.state.found=true;
  await h.chrome.tabs.onUpdated.fn(1,{status:'complete'});
  assert.equal(h.db['watch:1'].pending,true);assert.equal(h.events.filter(e=>e[0]==='action'&&e[2]==='purchase').length,1);
  assert.equal(h.alarms['refresh:1'],undefined);
  const reloads=h.events.filter(e=>e[0]==='reload').length;h.advance(5000);
  await h.chrome.alarms.onAlarm.fn({name:'refresh:1'});assert.equal(h.events.filter(e=>e[0]==='reload').length,reloads);
  await h.call({type:'pauseAll'});
});
(async()=>{let failed=0;for(const [name,fn]of cases){try{await fn();console.log('PASS: '+name);}catch(e){failed++;console.error('FAIL: '+name+' — '+e.message);}}if(failed)process.exitCode=1;})().catch(e=>{console.error(e);process.exitCode=1;});
