const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
(async()=>{
  let enabled=true,verification=false,active=true,status='complete',waits=[],events=[];
  const context=vm.createContext({
    all:async()=>verification?[{id:9,botActive:true}]:[],
    setTimeout:(fn,ms)=>{waits.push(ms);fn();},
    chrome:{storage:{local:{get:async()=>({automaticSwitching:enabled})}},
      tabs:{query:async()=>[{id:9}],update:async(id,options)=>{events.push(['activate',id,options.active]);return {windowId:7}},get:async()=>({active,status})},
      windows:{update:async(id,options)=>events.push(['focus',id,options.focused])}}
  });
  vm.runInContext(fs.readFileSync(__dirname+'/foreground.js','utf8'),context);
  assert.equal(await vm.runInContext('foregroundForRefresh(2)',context),true);
  assert.deepEqual(events,[['activate',2,true],['focus',7,true]]);
  waits=[];await vm.runInContext('settleForeground(2)',context);assert.equal(waits.reduce((a,b)=>a+b,0),2500);
  waits=[];status='loading';await vm.runInContext('settleForeground(2)',context);assert.equal(waits.reduce((a,b)=>a+b,0),7500,'loading waits are bounded');
  waits=[];active=false;await vm.runInContext('settleForeground(2)',context);assert.equal(waits.reduce((a,b)=>a+b,0),1500,'user switching away ends dwell');
  waits=[];await vm.runInContext('settleForeground(2,()=>true)',context);assert.equal(waits.length,0,'pause cancels dwell');
  events=[];enabled=false;assert.equal(await vm.runInContext('foregroundForRefresh(2)',context),false);assert.equal(events.length,0);
  enabled=true;verification=true;assert.equal(await vm.runInContext('foregroundForRefresh(2)',context),false);assert.equal(events.length,0);
  console.log('PASS: foreground activation, window focus, render dwell, bounded loading, opt-out, and verification focus protection');
})().catch(e=>{console.error(e);process.exitCode=1;});
