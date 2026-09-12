const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {harness}=require('./control-audit-test.cjs');
const asin='B0HJ6F8L6V',product='https://www.amazon.com/gp/product/'+asin+'/?smid=ATVPDKIKX0DER';
const challenge='https://www.amazon.com/errors_page/validateCaptcha?amzn=PRIVATE&field-keywords=PRIVATE';
function inspect({url=product,form=false,action='/errors_page/validateCaptcha',heading=false,button='Continue shopping',hidden=false,title='',nav=false}={}) {
  const node=text=>({innerText:text,getClientRects:()=>hidden?[]:[{}]});
  const control=node(button),elements={
    'form[action]':form?[{getAttribute:()=>action,querySelectorAll:()=>[control]}]:[],
    'h1,h2,h3,h4,h5,h6':heading?[node('Click the button below to continue shopping')]:[],
    'button,input[type="submit"]':[control],
    '#productTitle':title?node(title):null,'#nav-logo-sprites':nav?node('Amazon'):null,'#twotabsearchtextbox':nav?node(''):null
  };
  const context=vm.createContext({URL,location:new URL(url),getComputedStyle:()=>({display:'block',visibility:'visible'}),document:{querySelectorAll:s=>elements[s]||[],querySelector:s=>elements[s]||null}});
  vm.runInContext(fs.readFileSync(__dirname+'/amazon.js','utf8'),context);
  return vm.runInContext('inspectAmazonVerification('+JSON.stringify(asin)+')',context);
}
async function update(h,id=1){await h.chrome.tabs.onUpdated.fn(id,{status:'complete'});await h.drain();}
const notices=h=>h.events.filter(e=>e[0]==='notice');
const mutations=h=>h.events.filter(e=>['action','reload','update'].includes(e[0]));
(async()=>{
  assert.equal(inspect({form:true}).blocked,true,'verification can replace the product without changing its URL');
  assert.equal(inspect({url:challenge,heading:true}).blocked,true,'observed verification heading and control match the redirect');
  assert.equal(inspect({form:true,title:'Console'}).productReady,false,'challenge outranks a stale product title');
  for(const sample of [{button:'Continue shopping'},{form:true,hidden:true},{form:true,action:'https://other.example/errors_page/validateCaptcha'},{form:true,button:'Continue'},{form:true,url:'https://example.com/dp/'+asin}])assert.equal(inspect(sample).blocked,false);
  assert.equal(inspect({title:'Console'}).productReady,true);
  assert.equal(inspect({title:'Console',url:'https://www.amazon.com/console-title/dp/'+asin}).productReady,true,'named product URLs use the same ASIN identity');
  assert.equal(inspect({title:'Other',url:'https://www.amazon.com/dp/B000000000'}).productReady,false);
  assert.equal(inspect({title:'Console',hidden:true}).productReady,false);
  assert.equal(inspect({url:'https://www.amazon.com/',nav:true}).homepageReady,true);
  assert.equal(inspect({url:challenge}).productReady,false,'a blank/error redirect is not a recovered product');

  const h=await harness();h.add(1,product,{autoCart:true});h.add(2,'https://www.walmart.com/ip/console/21002656445');
  const phones=[];h.context.verificationPhoneEvents=phones;vm.runInContext('PhoneAlerts.enqueue=async(...args)=>verificationPhoneEvents.push(args)',h.context);
  h.state.verifications[1]={blocked:true};h.tabs[1].url=challenge;
  await h.scan(1);await h.drain();
  assert.equal(h.db['watch:1'].amazonVerification,'required');assert.equal(h.db['watch:1'].paused,true);
  assert.equal(h.db['watch:1'].url,product,'the saved product and seller survive the redirect');
  assert.ok(!h.db['watch:1'].currentUrl.includes('PRIVATE'),'verification tokens are not logged');
  assert.equal(h.db['watch:2'].paused,false,'independent windows continue');
  assert.equal(notices(h).length,1);assert.equal(phones.length,1);assert.equal(mutations(h).length,0);
  for(let i=0;i<3;i++){await update(h);await h.scan(1);await h.chrome.alarms.onAlarm.fn({name:'refresh:1'});await h.chrome.alarms.onAlarm.fn({name:'result:1'});await h.drain();}
  assert.equal((await h.call({type:'resume',id:1})).ok,false);
  assert.match((await h.call({type:'resumeAll'})).message,/Still paused: Amazon/);await h.drain();
  assert.equal(notices(h).length,1,'repeated page events and Resume do not duplicate the alert');assert.equal(phones.length,1);
  assert.equal(h.db['watch:1'].paused,true);assert.equal(mutations(h).filter(e=>e[1]===1).length,0);
  h.state.verifications[1]={homepageReady:true};h.tabs[1].url='https://www.amazon.com/';await update(h);
  assert.match(h.db['watch:1'].status,/Open the saved product/);assert.equal((await h.call({type:'resume',id:1})).ok,false);
  h.state.verifications[1]={productReady:true};h.tabs[1].url=product;await update(h);
  assert.equal(h.db['watch:1'].amazonVerification,'ready');assert.equal(h.db['watch:1'].paused,true,'recovery still needs explicit Resume');
  assert.equal((await h.call({type:'resume',id:1})).ok,true);await h.drain();assert.equal(h.db['watch:1'].paused,false);assert.equal(h.db['watch:1'].amazonVerification,'');

  const pending=await harness();pending.add(1,product,{autoCart:true,pending:true,paused:true,cartDispatched:true,token:'original',started:Date.now()});
  pending.state.verifications[1]={blocked:true};await pending.chrome.alarms.onAlarm.fn({name:'result:1'});await pending.drain();
  assert.equal(pending.db['watch:1'].pending,false);assert.equal(pending.db['watch:1'].amazonCheckCartFirst,true);assert.equal(pending.db['watch:1'].amazonVerificationReview,true);
  assert.equal(pending.alarms['result:1'],undefined);
  pending.state.verifications[1]={productReady:true};assert.equal((await pending.call({type:'resume',id:1})).ok,true);await pending.drain();
  pending.state.found=false;pending.state.pages[1]={page:'product',state:'pending',cartUrl:'https://www.amazon.com/gp/cart/view.html',title:'Console'};
  await pending.scan(1);await pending.drain();assert.equal(pending.tabs[1].url,pending.state.pages[1].cartUrl,'check existing cart even without a preorder button');
  assert.ok(!pending.events.some(e=>e[0]==='action'&&e[2]==='purchase'),'no duplicate purchase entry');

  const all=await harness();all.db.automaticSwitching=true;all.add(1,product);all.add(2,'https://www.walmart.com/ip/console/21002656445');all.add(3,'https://www.gamestop.com/products/game/451607.html',{paused:true,userPaused:true});
  all.state.verifications[1]={blocked:true};await all.scan(1);await all.drain();assert.equal(all.db['watch:2'].alertPaused,true);assert.equal(all.db['watch:3'].userPaused,true);
  const manual=await harness();manual.add(1,product,{paused:true,userPaused:true});manual.state.verifications[1]={blocked:true};await update(manual);await manual.scan(1);assert.equal(notices(manual).length,0);assert.equal(mutations(manual).length,0);
  const legacy=await harness();legacy.add(1,product,{paused:true,status:'Paused: tab navigated away'});legacy.state.verifications[1]={blocked:true};
  await vm.runInContext('recoverAmazonNavigationPauses()',legacy.context);assert.equal(legacy.db['watch:1'].amazonVerification,'required');assert.equal(legacy.db['watch:1'].paused,true);
  console.log('PASS: Amazon verification identity, redirects, one shared alert, stale timers, Resume/Resume all, saved product recovery, existing cart, pause scope and startup migration');
})().catch(e=>{console.error(e);process.exitCode=1;});
