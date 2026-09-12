const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
(async()=>{
  const url='https://www.walmart.com/ip/console/21002656445';
  let watch={id:4,url,controlVersion:7,pending:true,token:'attempt'},clicks=[];
  const context=vm.createContext({Date,URL,location:{href:url},chrome:{storage:{local:{get:async()=>({'watch:4':structuredClone(watch)})}}},
    clickPurchase:()=>{clicks.push('purchase');return {clicked:true};},inspectAmazonPage:()=>{clicks.push('checkout');return {clicked:true};},bestBuySoldOut:()=>{clicks.push('dismiss');return {clicked:true};}});
  vm.runInContext(fs.readFileSync(__dirname+'/profiles.js','utf8'),context);
  vm.runInContext("ensureFulfillment=()=>{return {ready:true,changed:true}}",context);
  vm.runInContext(fs.readFileSync(__dirname+'/actions.js','utf8'),context);
  const permit={id:4,url,version:7,token:'attempt',deadline:Date.now()+5000};
  const action=(name,p=permit)=>{context.permit=p;return vm.runInContext('performPageAction('+JSON.stringify(name)+',[],permit)',context);};
  assert.equal((await action('purchase')).clicked,true);
  watch.userPaused=true;assert.equal((await action('purchase')).cancelled,true);watch.userPaused=false;
  watch.controlVersion=8;assert.equal((await action('purchase')).cancelled,true);watch.controlVersion=7;
  watch.token='replacement';assert.equal((await action('purchase')).cancelled,true);watch.token='attempt';
  watch.pending=false;assert.equal((await action('purchase')).cancelled,true);watch.pending=true;
  assert.equal((await action('purchase',{...permit,deadline:Date.now()-1})).cancelled,true);
  // Recheck the deadline after delayed storage access, before touching the page.
  context.chrome.storage.local.get=()=>new Promise(r=>setTimeout(()=>r({'watch:4':watch}),25));
  assert.equal((await action('purchase',{...permit,deadline:Date.now()+10})).cancelled,true);
  context.chrome.storage.local.get=async()=>({'watch:4':watch});
  assert.equal((await action('fulfillment')).ready,true);
  context.location.href='https://www.walmart.com/ip/another/123456';assert.equal((await action('fulfillment')).cancelled,true);
  context.location.href=url;Object.assign(watch,{paused:true,alertPaused:true,pending:false,rule:{store:'Best Buy'},alertBatch:'batch'});
  assert.equal((await action('bestBuyClose',{...permit,token:null,allowRejection:true})).clicked,true);
  assert.equal((await action('purchase',{...permit,token:null})).cancelled,true);
  assert.deepEqual(clicks,['purchase','dismiss']);
  // A verification can appear after the worker inspected the purchase page.
  Object.assign(watch,{paused:true,pending:true,token:'attempt',rule:{store:'Amazon',productId:'B0HJ6F8L6V'}});
  context.inspectAmazonVerification=()=>({blocked:true});
  assert.equal((await action('purchase')).reason,'amazonVerification');
  assert.equal((await action('amazonCheckout')).reason,'amazonVerification');
  assert.deepEqual(clicks,['purchase','dismiss'],'a late verification blocks both purchase and checkout actions');
  console.log('PASS: page action guards for pause, control generation, attempt token, expiry, product identity, and terminal popup dismissal');
})().catch(e=>{console.error(e);process.exitCode=1;});
