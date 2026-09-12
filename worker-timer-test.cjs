const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/background.js','utf8');
let now=100000,id=0,calls=[],jobs=[],timers=new Map(),watch={id:1,next:105000,paused:false,pending:false};
class Clock extends Date {static now(){return now;}}
const ctx=vm.createContext({Date:Clock,setTimeout:(fn,ms)=>{const key=++id;timers.set(key,{fn,ms});return key;},clearTimeout:key=>timers.delete(key),chrome:{alarms:{create:async()=>{}}},get:async()=>watch,refresh:async()=>calls.push('refresh'),readOutcome:async()=>calls.push('result'),serial:fn=>{jobs.push(fn());}});
vm.runInContext(source.slice(source.indexOf('const refreshTimers ='),source.indexOf('let stoppingAll =')),ctx);
const run=code=>vm.runInContext(code,ctx);ctx.watch=watch;
(async()=>{
  run('armWorkerRefresh(watch)');let timer=[...timers.values()][0];assert.equal(timer.ms,5000);
  now+=5000;timer.fn();await Promise.all(jobs);assert.deepEqual(calls,['refresh'],'short worker deadline works without a tab timer or Chrome alarm');
  calls=[];jobs=[];watch.next=110000;run('armWorkerRefresh(watch)');timer=[...timers.values()].at(-1);
  watch.next=120000;now=110000;timer.fn();await Promise.all(jobs);assert.equal(calls.length,0,'obsolete deadline ignored');
  watch.paused=true;run('armWorkerRefresh(watch)');assert.equal(run('refreshTimers.size'),0,'pause cancels short timer');
  watch={id:1,pending:true,paused:true,token:'old',rule:{store:'Amazon'},started:now};ctx.watch=watch;
  await run('armResultCheck(watch)');timer=[...timers.values()].at(-1);assert.equal(timer.ms,1000);
  watch.token='new';timer.fn();await Promise.all(jobs);assert.equal(calls.length,0,'obsolete attempt cannot verify a later attempt');
  await run('armResultCheck(watch)');timer=[...timers.values()].at(-1);timer.fn();await Promise.all(jobs);assert.deepEqual(calls,['result']);
  console.log('PASS: short worker deadlines, stale deadlines, pause cancellation and one-second result checks with attempt identity');
})().catch(e=>{console.error(e);process.exitCode=1;});
