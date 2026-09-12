const assert=require('node:assert/strict');
const {inspectStock}=require('./detector.js');
const {clickPurchase,classifyCart}=require('./cart.js');
let presses=0,label='Pre-order now',endpoint='/checkout/entry/buynow';
const button={id:'buy-now-button',name:'submit.buy-now',innerText:'',value:'',className:'',
  getAttribute:n=>({'aria-labelledby':'submit.buy-now-announce',formaction:endpoint,title:'Buy Now'}[n]||null),
  form:{getAttribute:()=>'/gp/product/handle-buy-box/ref=dp_start-bbf_1_glance'},
  matches:()=>false,closest:()=>null,getClientRects:()=>[{}],click:()=>{presses++;}};
global.document={getElementById:()=>({textContent:label}),querySelectorAll:s=>s==='*'?[]:s==='#buy-now-button'?[button]:[]};
global.getComputedStyle=()=>({visibility:'visible',display:'block',opacity:'1'});
global.location={href:'https://www.amazon.com/gp/product/B0HJ6F8L6V/',hostname:'www.amazon.com'};
global.ensureFulfillment=()=>({ready:true});
const rule={store:'Amazon',productId:'B0HJ6F8L6V'};
assert.equal(inspectStock('#buy-now-button').found,true,'empty input value resolves visible labelled-by text');
assert.equal(clickPurchase('#buy-now-button',location.href,'entry',rule).clicked,true);
assert.equal(presses,1);
endpoint='/checkout/place-order';
assert.equal(clickPurchase('#buy-now-button',location.href,'submit',rule).clicked,false,'order submission endpoint is forbidden');
endpoint='/checkout/entry/buynow';label='Buy Now';
assert.equal(clickPurchase('#buy-now-button',location.href,'buy',rule).clicked,false,'ordinary Buy Now stays blocked');
label='Pre-order now';
assert.equal(clickPurchase('#buy-now-button',location.href,'other',{store:'Amazon',productId:'OTHER'}).clicked,false);
const error=['This Item is currently unavailable','Sorry, the item(s) you selected are not available from your selected seller(s). Please check the product page(s) for other sellers or try again later'];
assert.equal(classifyCart(error).reason,'amazonUnavailable');
assert.equal(classifyCart(['This Item is currently unavailable']).state,'pending','require both observed error messages');
assert.equal(classifyCart(error,error).state,'pending','old error is not a new result');
assert.equal(classifyCart(['Quantity: 0',"Sorry, the quantity you requested is no longer available. We updated your quantity to the maximum available."]).state,'unavailable','checkout quantity rejection is not stock availability');
console.log('PASS: Amazon accessible label, exact preorder entry, unsafe controls blocked, and unavailable result recognition');
global.location={href:'https://www.bestbuy.com/product/console/TEST/sku/6691841',hostname:'www.bestbuy.com'};
global.ensureFulfillment=()=>({ready:false});button.id='preorder';button.name='';label='Pre-order';endpoint=null;
button.getAttribute=n=>n==='aria-labelledby'?'label':null;
const beforeBest=presses;
assert.equal(clickPurchase('#buy-now-button',location.href,'bestbuy-queue',{store:'Best Buy'}).clicked,true);
assert.equal(presses,beforeBest+1);
label='Add to cart';assert.equal(clickPurchase('#buy-now-button',location.href,'bestbuy-cart',{store:'Best Buy'}).clicked,false,'actual cart addition still requires desired fulfillment');
for(const text of ["You're in line","You’re in the queue",'Your position in line','Do not refresh this page'])assert.equal(classifyCart([text],[text]).reason,'queue');
