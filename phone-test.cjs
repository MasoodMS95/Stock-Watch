const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),{webcrypto}=require('node:crypto');
const source=fs.readFileSync(__dirname+'/phone.js','utf8')+';globalThis.phone=PhoneAlerts;';
let now=Date.now(),db={},alarms={},requests=[],permission=true,replyCode=200,held=null;
class Clock extends Date{static now(){return now;}}
function runtime(){
  const ctx=vm.createContext({Date:Clock,URL,crypto:webcrypto,TextEncoder,AbortController,setTimeout,clearTimeout,
    chrome:{permissions:{contains:async()=>permission},storage:{local:{get:async keys=>structuredClone(Object.fromEntries(keys.filter(k=>k in db).map(k=>[k,db[k]]))),set:async o=>Object.assign(db,structuredClone(o))}},alarms:{create:async(n,v)=>{alarms[n]=v;},clear:async n=>{delete alarms[n];}}},
    fetch:async(url,options)=>{
      requests.push({url,options});
      if(held)await held(options.signal);
      return {ok:replyCode===200,status:replyCode,headers:{get:()=>replyCode===429?'60':null},json:async()=>({id:'receipt',event:'message',topic:JSON.parse(options.body).topic})};
    }});
  vm.runInContext(source,ctx);return ctx.phone;
}
(async()=>{
  let phone=runtime();
  assert.equal(await phone.enqueue('stock:1','Available','Console'),false);assert.equal(requests.length,0,'disabled by default');
  permission=false;await assert.rejects(()=>phone.configure(true),/Allow ntfy/);permission=true;
  await phone.configure(true);assert.match(db.phoneSettings.topic,/^sw-[a-f0-9]{32}$/);
  let release;held=()=>new Promise(r=>{release=r;});
  await phone.enqueue('stock:1','Purchase button detected','Console™','https://www.amazon.com/dp/B0HJ6F8L6V?secret=value#x',false,'event-one');
  await new Promise(r=>setImmediate(r));
  assert.equal(db.phoneQueue.jobs.length,1,'queued durably before network finishes');
  assert.equal(requests.length,1,'sending does not block enqueue/cart work');
  const pending=phone.flush();release();held=null;await pending;
  assert.equal(db.phoneStatus.state,'accepted');assert.equal(db.phoneQueue.jobs.length,0);
  const sent=JSON.parse(requests[0].options.body);assert.equal(sent.click,'https://www.amazon.com/dp/B0HJ6F8L6V');assert.match(sent.message,/Console™/);
  assert.equal(requests[0].url,'https://ntfy.sh/');assert.equal(requests[0].options.credentials,'omit');assert.equal(requests[0].options.redirect,'error');
  assert.equal(await phone.enqueue('stock:1','Purchase button detected','Repeated','https://www.amazon.com/dp/B0HJ6F8L6V?secret=value#x',false,'event-one'),false);
  await phone.enqueue('stock:1','Amazon checkout ready','Console');await phone.flush();assert.equal(requests.length,2,'new alert type is immediate');
  replyCode=503;await phone.enqueue('stock:2','Needs attention','Console');await phone.flush();
  assert.equal(db.phoneStatus.state,'error');assert.equal(db.phoneQueue.jobs.length,1);assert.ok(alarms['phone:send']);
  const beforeRestart=requests.length;now+=31000;replyCode=200;phone=runtime();await phone.flush();
  assert.equal(requests.length,beforeRestart+1,'worker restart delivers persisted job');assert.equal(db.phoneQueue.jobs.length,0);
  replyCode=429;await phone.enqueue('stock:3','Queue detected','Console');await phone.flush();
  assert.ok(db.phoneQueue.jobs[0].next>=now+60000,'rate-limit retry respects server delay');
  now+=121000;replyCode=200;const beforeExpiry=requests.length;await phone.flush();assert.equal(requests.length,beforeExpiry,'expired stock notices are not delivered late');
  replyCode=401;await phone.enqueue('stock:4','Alert','Console');await phone.flush();assert.equal(db.phoneQueue.jobs.length,0,'permanent errors do not repeat');
  replyCode=200;held=signal=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>{const e=Error('abort');e.name='AbortError';reject(e);},{once:true});});
  await phone.enqueue('stock:5','Cart','Console');await new Promise(r=>setImmediate(r));
  const oldTopic=db.phoneSettings.topic;await phone.configure(false);await phone.flush();held=null;
  assert.equal(db.phoneSettings.topic,oldTopic);assert.equal(db.phoneSettings.enabled,false);assert.equal(db.phoneQueue.jobs.length,0);assert.equal(db.phoneStatus.state,'off','late network completion cannot overwrite disabled status');
  assert.equal(alarms['phone:send'],undefined);
  await assert.rejects(()=>phone.enqueue('phone-test','Test','Test','',true),/Enable/);
  await phone.configure(true);await phone.enqueue('phone-test','Test','Test','',true);await phone.flush();assert.equal(db.phoneStatus.state,'accepted');
  const sameTypeStart=requests.length;
  await phone.enqueue('stock:6','Queue detected','Console','',false,'queue-one');await phone.flush();
  await phone.enqueue('stock:6','Queue detected','Console','',false,'queue-two');await phone.flush();
  assert.equal(requests.length,sameTypeStart+2,'distinct desktop events of the same type can send without a time holdoff');
  assert.equal(await phone.enqueue('stock:6','Queue detected','Console','',false,'queue-two'),false,'same event is not delivered again');
  const background=fs.readFileSync(__dirname+'/background.js','utf8');
  let deliveredDesktop=0,queuedPhone=0,failDesktop=true,failPhone=false;
  const notificationContext=vm.createContext({Date,crypto:webcrypto,work:{guard:p=>p,cancelled:()=>false},PhoneAlerts:{enqueue:async()=>{queuedPhone++;if(failPhone)throw Error('phone storage unavailable');}},chrome:{notifications:{clear:async()=>{},create:async()=>{deliveredDesktop++;if(failDesktop)throw Error('desktop disabled');}},storage:{local:{set:async()=>{}}}}});
  vm.runInContext(background.slice(background.indexOf('async function notify('),background.indexOf('async function alertWatch(')),notificationContext);
  await assert.rejects(()=>vm.runInContext("notify('stock:1','Alert','Console')",notificationContext),/desktop disabled/);
  assert.equal(queuedPhone,1,'desktop failure still queues phone delivery');
  failDesktop=false;failPhone=true;await vm.runInContext("notify('stock:2','Alert','Console')",notificationContext);assert.equal(deliveredDesktop,2,'phone failure cannot prevent a desktop alert');
  console.log('PASS: opt-in phone alerts, Unicode, nonblocking delivery, duplicate control, changed alerts, worker recovery, rate limits, expiration, cancellation and test delivery');
})().catch(e=>{console.error(e);process.exitCode=1;});
