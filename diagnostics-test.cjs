const assert=require('node:assert/strict');
const {createDiagnostics,diagnosticText,diagnosticUrl}=require('./diagnostics.js');
function memory(){let records=[],meta={},id=0;return {append:async(e,important)=>{const ref={id:++id,store:important?'incidents':'events'};records.push({...structuredClone(e),...ref});return ref;},attach:async(ref,snapshot)=>{const e=records.find(e=>e.id===ref.id);if(e)e.snapshot=snapshot;},getMeta:async k=>meta[k],setMeta:async(k,v)=>{meta[k]=v;},read:async()=>structuredClone(records),clear:async()=>{records=[];meta={};}};}
(async()=>{
  const store=memory(),statuses=[];let time=Date.now(),captures=0;
  const settings={store,now:()=>time,version:()=> 'test',onStatus:s=>statuses.push(s),capture:async()=>{captures++;return {signals:['zero_quantity'],url:'https://www.amazon.com/checkout/p/private-session/itemselect?token=secret',html:'private page',cookie:'private cookie'};}};
  let log=createDiagnostics(settings);await log.boot();
  const w={id:1,rule:{store:'Amazon',productId:'B0HJ6F8L6V'},url:'https://www.amazon.com/dp/B0HJ6F8L6V?token=secret',interval:5,checked:time,created:time,status:'Monitoring'};
  await log.observe(w);await log.heartbeat([w],{active:'refresh:1'});
  time+=1000;await log.observe({...w,paused:true,pending:true,pauseReason:'checking cart',status:'Attempting'});
  let report=await log.report();assert.equal(report.events.some(e=>e.type==='pause'),false,'normal cart reservation is not an unexpected pause');
  time+=1000;await log.observe({...w,paused:true,pauseReason:'navigation',status:'Paused: tab navigated away'});
  report=await log.report();assert.equal(captures,1);assert.ok(report.events.find(e=>e.type==='pause').snapshot);
  assert.ok(!JSON.stringify(report).includes('private-session'));assert.ok(!JSON.stringify(report).includes('private cookie'));assert.ok(!JSON.stringify(report).includes('private page'));
  assert.ok(report.analysis.findings.some(f=>f.kind==='pause'));
  await log.event('page_error',w,{message:'Failed test@example.com at 123 Main Street. token=secret'},true);
  assert.ok(!JSON.stringify(await log.report()).includes('test@example.com'));assert.ok(!diagnosticText('123 Main Street').includes('Main'));
  assert.equal(diagnosticUrl('https://www.amazon.com/dp/B0HJ6F8L6V?smid=private'),'https://www.amazon.com/dp/B0HJ6F8L6V');
  await log.event('amazon_verification',{...w,amazonVerification:'required',currentUrl:'https://www.amazon.com/errors_page/validateCaptcha?amzn=PRIVATE',status:'Amazon needs verification'},{state:'required'},true);
  const verificationReport=await log.report();assert.ok(verificationReport.analysis.findings.some(f=>f.kind==='verification'));
  assert.ok(!JSON.stringify(verificationReport).includes('PRIVATE'));assert.equal(verificationReport.events.find(e=>e.type==='amazon_verification').watch.amazonVerification,'required');
  time+=240000;log=createDiagnostics(settings);await log.boot();await log.heartbeat([w],{active:'scan:1',waiting:2});
  report=await log.report();assert.ok(report.analysis.findings.some(f=>f.kind==='gap'));assert.ok(report.analysis.findings.some(f=>f.kind==='stalled'));
  assert.ok(report.events.some(e=>e.type==='pause'),'worker restart preserves evidence');
  const count=report.events.length;await log.configure(false);await log.event('worker_error',null,{message:'disabled'},true);assert.equal((await log.report()).events.length,count);
  log=createDiagnostics(settings);await log.boot();assert.equal((await log.report()).logging.enabled,false,'logging preference persists');
  await log.configure(true);await log.clear();report=await log.report();assert.deepEqual(report.events.map(e=>e.type),['log_started']);
  await log.observe({...w,paused:true,userPaused:true,pauseReason:'manual',status:'Paused by you'});assert.equal((await log.report()).events.some(e=>e.type==='pause'),false);
  for(let i=0;i<20;i++){time+=1000;await log.event('refresh',w,{elapsedMs:5000+i},false);}
  assert.equal((await log.report()).events.filter(e=>e.type==='refresh').length,1,'routine refresh samples do not overwhelm overnight incidents');
  const broken=createDiagnostics({...settings,store:{...store,append:async()=>{throw Error('Disk unavailable');}}});
  await assert.rejects(broken.event('worker_error',null,{},true),/Disk unavailable/);assert.match(statuses.at(-1).error,/Disk unavailable/);
  const captureFail=createDiagnostics({...settings,capture:async()=>{throw Error('Tab closed');}});
  await captureFail.event('pause',w,{},true,true);assert.ok((await captureFail.report()).events.some(e=>e.type==='snapshot_error'));
  console.log('PASS: persistent diagnostic state, pause classification, heartbeat gaps, stalled watches, bounded samples, redaction, export, clear, preference and storage/capture failures');
})().catch(e=>{console.error(e);process.exitCode=1;});
