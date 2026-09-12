const assert=require('node:assert/strict');const {harness}=require('./control-audit-test.cjs');
const {inspectNintendoCheckoutError,clickNintendoAutofilledPassword}=require('./nintendo.js');
const node=(text='')=>({innerText:text,getClientRects:()=>[{}],getAttribute:()=>null,matches:()=>false,closest:()=>null});
global.location={origin:'https://www.nintendo.com',pathname:'/us/checkout/error/',href:'https://www.nintendo.com/us/checkout/error/'};
let dom={'p,div,span,h1,h2':[node('Remove this item from your cart to continue:')],'a,button':[node('Back to cart')]};
global.document={querySelectorAll:s=>dom[s]||[]};global.getComputedStyle=()=>({visibility:'visible',display:'block'});
assert.equal(inspectNintendoCheckoutError(),true);
dom['p,div,span,h1,h2'][0].innerText='Remove this item from your cart to continue:\nNintendo Switch™ 2 - The Legend of Zelda™ – 40th Anniversary Edition';
assert.equal(inspectNintendoCheckoutError(),true,'live paragraph includes the product name as a nested generic element');
location.pathname='/us/checkout/';assert.equal(inspectNintendoCheckoutError(),false);
location.origin='https://accounts.nintendo.com';location.pathname='/reauthenticate';location.href=location.origin+location.pathname;
let clicks=0,autofilled=true;const password=node();Object.defineProperty(password,'value',{get(){throw Error('Password must never be read');}});password.matches=()=>autofilled;
const ok=node('OK');ok.click=()=>clicks++;password.form={getAttribute:()=>'/reauthenticate',querySelectorAll:()=>[ok]};
dom={'h1,h2':[node('Re-enter Password')],'input[type="password"]':[password]};
assert.equal(clickNintendoAutofilledPassword('one').clicked,true);assert.equal(clickNintendoAutofilledPassword('one').clicked,false);assert.equal(clicks,1);
autofilled=false;assert.equal(clickNintendoAutofilledPassword('two').clicked,false);autofilled=true;
dom['input[autocomplete="one-time-code"],iframe[title*="challenge" i],iframe[title*="captcha" i],[role="alert"]']=[node('Verification')];assert.equal(clickNintendoAutofilledPassword('three').clicked,false);
delete dom['input[autocomplete="one-time-code"],iframe[title*="challenge" i],iframe[title*="captcha" i],[role="alert"]'];password.form.getAttribute=()=> 'https://example.com/reauthenticate';assert.equal(clickNintendoAutofilledPassword('four').clicked,false);
delete global.document;delete global.location;delete global.getComputedStyle;
(async()=>{
 const url='https://www.nintendo.com/us/cart/';
 for(const manual of [false,true]){
  const h=await harness();h.add(1,url,{autoCart:true,paused:true,pending:false,nintendoRecoveryArmed:true,userPaused:manual,alertBatch:'own',alertPauseOwner:'own',alertPaused:true,alertResumeIds:[1]});
  h.tabs[1].url='https://www.nintendo.com/us/checkout/error/';const original=h.chrome.scripting.executeScript;
  h.chrome.scripting.executeScript=async req=>req.func?.name==='inspectNintendoCheckoutError'?[{result:true}]:original(req);
  await h.scan(1);assert.equal(h.tabs[1].url,manual?'https://www.nintendo.com/us/checkout/error/':url);
  assert.equal(h.db['watch:1'].paused,manual);assert.equal(h.events.filter(e=>e[0]==='action').length,0,'recovery navigates to cart without deleting items or authentication actions');
  await h.call({type:'pause',id:1});
 }
 console.log('PASS: exact Wario recovery, manual pause, single autofill confirmation without reading password, OTP/challenge and foreign-form safeguards');
})().catch(e=>{console.error(e);process.exitCode=1;});
