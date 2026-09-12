const assert=require('node:assert/strict');
const {ensureFulfillment,resolveFulfillment}=require('./profiles.js');
const {clickPurchase}=require('./cart.js');
const {captureWatchPage}=require('./diagnostic-page.js');
const {harness}=require('./control-audit-test.cjs');
const url='https://www.walmart.com/ip/test-product/21002656445';
const rule={store:'Walmart',productId:'21002656445'};

// Based on the observed live Walmart tile: an enabled native radio inside a
// visible label, with inventory text separate from the radio's disabled state.
let selected=false,disabled=false,ariaDisabled=false,clicks=0,cartClicks=0;
const label={innerText:'Shipping Out of stock',getClientRects:()=>[{}],getAttribute:()=>null,click(){clicks++;selected=true;}};
const radio={id:'fulfillment-Shipping',tagName:'INPUT',labels:[label],innerText:'',get checked(){return selected;},getClientRects:()=>[],matches:()=>disabled,getAttribute:n=>n==='aria-disabled'?(ariaDisabled?'true':null):n==='aria-labelledby'?'fulfillment-Shipping-content':null};
const purchase={id:'add',innerText:'Add to cart',getClientRects:()=>[{}],getAttribute:()=>null,click(){cartClicks++;}};
global.getComputedStyle=()=>({visibility:'visible',display:'block'});
global.location={href:url,hostname:'www.walmart.com',pathname:'/ip/test-product/21002656445'};
global.document={readyState:'complete',visibilityState:'visible',hasFocus:()=>true,
  getElementById:()=>({innerText:label.innerText}),
  querySelector:s=>s==='label[for="fulfillment-Shipping"]'?label:null,
  querySelectorAll:s=>s==='input#fulfillment-Shipping'||s==='input[id^="fulfillment-"]'?[radio]:s==='#add'?[purchase]:[]};
global.ensureFulfillment=ensureFulfillment;

const initial=ensureFulfillment(rule,'shipping',false);
assert.equal(initial.ready,false);assert.equal(clicks,0,'inspection cannot select the tile');
const changed=ensureFulfillment(rule,'shipping',true);
assert.equal(changed.changed,true,'out-of-stock shipping must still be selectable');
assert.equal(changed.ready,false,'selecting a tile is not stock confirmation');
assert.equal(clicks,1);assert.equal(selected,true);
const waiting=ensureFulfillment(rule,'shipping',false);
assert.equal(waiting.selected,true);assert.equal(waiting.unavailable,true);assert.equal(waiting.ready,false);
assert.match(waiting.detail,/Shipping selected.*out of stock/);
ensureFulfillment(rule,'shipping',true);assert.equal(clicks,1,'do not re-click selected out-of-stock shipping');
assert.equal(clickPurchase('#add',url,'test',rule,'shipping').clicked,false);
assert.equal(cartClicks,0,'an enabled Add button cannot override unavailable shipping');

const evidence=captureWatchPage(rule);
assert.deepEqual(evidence.fulfillment,[{mode:'shipping',selected:true,disabled:false,unavailable:true}]);
assert.ok(!JSON.stringify(evidence).includes('Street'),'fulfillment evidence excludes addresses');

selected=false;disabled=true;
assert.equal(ensureFulfillment(rule,'shipping',true).changed,undefined);assert.equal(clicks,1);
disabled=false;ariaDisabled=true;
assert.equal(ensureFulfillment(rule,'shipping',true).changed,undefined);assert.equal(clicks,1);
ariaDisabled=false;label.innerText='Shipping Arrives tomorrow';
assert.equal(ensureFulfillment(rule,'shipping',true).changed,true);
assert.equal(ensureFulfillment(rule,'shipping',false).ready,true);

// Delivery is its own Walmart radio; it must never fall back to Shipping.
radio.id='fulfillment-Delivery';selected=false;label.innerText='Delivery Out of stock';
document.querySelector=s=>s==='label[for="fulfillment-Delivery"]'?label:null;
document.querySelectorAll=s=>s==='input#fulfillment-Delivery'||s==='input[id^="fulfillment-"]'?[radio]:s==='#add'?[purchase]:[];
assert.equal(ensureFulfillment(rule,'delivery',true).changed,true);
assert.equal(ensureFulfillment(rule,'delivery',false).selected,true);
assert.match(ensureFulfillment(rule,'delivery',false).detail,/Delivery selected/);
assert.equal(clickPurchase('#add',url,'delivery-test',rule,'delivery').clicked,false);
assert.equal(cartClicks,0);
assert.equal(captureWatchPage(rule).fulfillment[0].mode,'delivery');
label.innerText='Delivery Arrives today';assert.equal(ensureFulfillment(rule,'delivery',false).ready,true);
selected=false;disabled=true;
assert.equal(ensureFulfillment(rule,'delivery',true).changed,undefined);
disabled=false;ariaDisabled=true;
assert.equal(ensureFulfillment(rule,'delivery',true).changed,undefined);ariaDisabled=false;
for(const store of ['Amazon','Nintendo','Best Buy','GameStop'])assert.equal(ensureFulfillment({store},'delivery',true).ready,false);
assert.equal(ensureFulfillment(null,'delivery',true).ready,false);
assert.equal(resolveFulfillment(rule,'delivery'),'delivery');
assert.equal(resolveFulfillment(rule,'auto'),'shipping');
assert.throws(()=>resolveFulfillment({store:'Best Buy'},'delivery'),/Walmart/);

delete global.document;delete global.location;delete global.getComputedStyle;delete global.ensureFulfillment;

(async()=>{
  const h=await harness();
  h.add(1,url,{selector:'',autoCart:true,fulfillment:'shipping'});
  h.state.resolved={selector:'',status:'Waiting for product purchase button'};
  const original=h.chrome.scripting.executeScript;
  let selections=0,readySelected=false;
  h.chrome.scripting.executeScript=async options=>{
    if(options.func?.name==='ensureFulfillment')return [{result:readySelected?{ready:false,selected:true,unavailable:true,detail:'Shipping selected; out of stock. Continuing to watch shipping.'}:{ready:false,selected:false,unavailable:true}}];
    if(options.func?.name==='performPageAction'&&options.args[0]==='fulfillment'){
      selections++;readySelected=true;
      return [{result:{ready:false,changed:true,detail:'Selecting shipping; verifying the page response'}}];
    }
    return original(options);
  };
  await h.scan(1);await h.drain();
  assert.equal(selections,1);assert.match(h.db['watch:1'].status,/Selecting shipping/);
  await h.scan(1);await h.drain();
  assert.equal(selections,1);assert.match(h.db['watch:1'].status,/Shipping selected.*out of stock/);
  assert.equal(h.db['watch:1'].paused,false);
  assert.equal(h.events.some(e=>e[0]==='notice'||e[0]==='action'&&e[2]==='purchase'),false);
  const before=h.db['watch:1'].reloadCount||0;
  h.advance(5000);await h.chrome.alarms.onAlarm.fn({name:'refresh:1'});await h.drain();
  assert.equal(h.db['watch:1'].reloadCount,before+1,'shipping out of stock continues normal refresh');
  await h.call({type:'pause',id:1});readySelected=false;
  await h.scan(1);await h.drain();
  assert.equal(selections,1,'manual pause prevents fulfillment selection');
  const oldVersion=h.db['watch:1'].controlVersion||0;
  assert.equal((await h.call({type:'fulfillment',id:1,fulfillment:'delivery'})).ok,true);
  assert.equal(h.db['watch:1'].fulfillment,'delivery');
  assert.ok(h.db['watch:1'].controlVersion>oldVersion,'changing fulfillment invalidates old selection actions');
  assert.equal(h.db['watch:1'].paused,true,'changing mode does not resume a paused watch');
  h.add(2,'https://www.gamestop.com/products/game/451607.html',{paused:true,userPaused:true,fulfillment:'shipping'});
  assert.equal((await h.call({type:'fulfillment',id:2,fulfillment:'delivery'})).ok,false);
  assert.equal(h.db['watch:2'].fulfillment,'shipping');
  assert.equal((await h.call({type:'add',id:2,interval:5,fulfillment:'delivery'})).ok,false);
  assert.equal(h.db['watch:2'].paused,true);
  h.add(3,url,{paused:true});
  assert.equal((await h.call({type:'add',id:3,interval:5,autoCart:false,fulfillment:'delivery'})).ok,true);
  assert.equal(h.db['watch:3'].fulfillment,'delivery','new watches preserve Delivery');
  console.log('PASS: Walmart shipping and delivery selection, disabled guards, stock separation, diagnostics, refresh, pause and saved mode validation');
})().catch(e=>{console.error(e);process.exitCode=1;});
