const assert=require('node:assert/strict');
const {inspectAmazonPage}=require('./amazon.js');
const rule={store:'Amazon',productId:'B0HJ6F8L6V'};
const title='Nintendo Switch™ 2 –The Legend of Zelda™ – 40th Anniversary Edition';
function node(text='',attrs={},children={}) {
  return {innerText:text,value:'',checked:false,id:attrs.id||'',href:attrs.href,
    getClientRects:()=>[{}],getAttribute:k=>attrs[k]??null,matches:()=>false,closest:()=>null,
    querySelector:s=>(children[s]||[])[0]||null,querySelectorAll:s=>children[s]||[]};
}
let dom={},clicks=0;
global.document={querySelector:s=>(dom[s]||[])[0]||null,querySelectorAll:s=>dom[s]||[]};
global.getComputedStyle=()=>({visibility:'visible',display:'block'});
global.location={hostname:'www.amazon.com',pathname:'/gp/cart/view.html',href:'https://www.amazon.com/gp/cart/view.html'};
function cart(price) {
  const attrs={'data-asin':rule.productId,'data-producttitle':title,'data-quantity':'1','data-isselected':'1','data-outofstock':'0','data-price':price};
  const row=node(title+' $'+price,attrs);
  const proceed=node();proceed.value='Proceed to checkout';proceed.form={getAttribute:()=>'/checkout/entry/cart'};proceed.click=()=>clicks++;
  dom={'[data-itemtype="active"][data-asin]':[row],'#sc-active-cart':[node()], 'input[name="proceedToRetailCheckout"]':[proceed]};
  return {row,attrs,proceed};
}
for(const price of ['0.00','519.99']) {
  cart(price);
  assert.equal(inspectAmazonPage(rule,title).state,'cartReady','neither subtotal proves stock');
  const token='cart-'+price;
  assert.equal(inspectAmazonPage(rule,title,'proceed',token).clicked,true);
  assert.equal(inspectAmazonPage(rule,title,'proceed',token).clicked,false,'one checkout entry per token');
}
assert.equal(clicks,2);
let fixture=cart('519.99');fixture.attrs['data-outofstock']='1';
assert.equal(inspectAmazonPage(rule,title).state,'unavailable');
fixture=cart('519.99');fixture.attrs['data-quantity']='0';assert.equal(inspectAmazonPage(rule,title).state,'unavailable');
fixture=cart('519.99');fixture.attrs['data-quantity']='2';assert.equal(inspectAmazonPage(rule,title,'proceed','two').state,'attention');
fixture=cart('519.99');fixture.attrs['data-isselected']='0';assert.equal(inspectAmazonPage(rule,title,'proceed','unchecked').state,'attention');
fixture=cart('519.99');dom['[data-itemtype="active"][data-asin]'].push(node('Other',{'data-asin':'OTHER12345','data-isselected':'1'}));
assert.equal(inspectAmazonPage(rule,title,'proceed','mixed').state,'attention','other selected items cannot enter checkout');
fixture=cart('519.99');fixture.proceed.form.getAttribute=()=>'/checkout/place-order';
assert.equal(inspectAmazonPage(rule,title,'proceed','unsafe').state,'pending');assert.equal(clicks,2,'no order submission');
fixture=cart('519.99');dom['[data-itemtype="active"][data-asin]']=[];
assert.equal(inspectAmazonPage(rule,title).reason,'missingCartItem','saved-for-later rows do not count');
dom={'h1,h2,h3,h4':[node('Your Amazon Cart is empty')]};assert.equal(inspectAmazonPage(rule,title).reason,'emptyCart');
function checkout(quantity,total,error='') {
  global.location.pathname='/checkout/p/example';
  const row=node(title+' Quantity: '+quantity+' $'+total,{}, {'.lineitem-title-text':[node(title)]});
  const place=node();place.value='Place your order';place.click=()=>{throw Error('Must never be clicked');};
  dom={'.lineitem-container':[row],'input[name="placeYourOrder1"]':[place], '[role="alert"],.a-alert-content,p,h4':error?[node(error)]:[]};
  return row;
}
for(const total of ['0.00','573.29']) {
  checkout(0,total,"Sorry, the quantity you requested is no longer available. We updated your quantity to the maximum available.");
  assert.equal(inspectAmazonPage(rule,title).state,'unavailable','zero and nonzero checkout totals both reject inventory error');
  checkout(0,total);assert.equal(inspectAmazonPage(rule,title).reason,'zeroQuantity','zero alone in identified row rejects');
}
checkout(1,'573.29');assert.equal(inspectAmazonPage(rule,title).state,'checkoutReady');
const different=checkout(1,'573.29');different.getAttribute=k=>k==='data-asin'?'B012345678':null;
assert.equal(inspectAmazonPage(rule,title).state,'pending','an explicit different ASIN cannot be rescued by a matching title');
checkout(1,'573.29');
assert.equal(inspectAmazonPage(rule,'Different console').state,'pending','must identify this exact product');
dom['input[name="placeYourOrder1"]']=[];assert.equal(inspectAmazonPage(rule,title).state,'pending','quantity alone cannot verify a checkout shell');
checkout(1,'573.29','This item is currently unavailable');assert.equal(inspectAmazonPage(rule,title).state,'unavailable','error wins over stale positive controls');
checkout(1,'573.29');dom['h1,h2,h3,h4']=[node('Make updates to your items')];assert.equal(inspectAmazonPage(rule,title).quantityRestored,true,'section heading alone is not a remaining inventory error');
function confirmation(step='itemselect',endpoint='shipoptionselect') {
  checkout(1,'573.29');location.pathname='/checkout/p/session/'+step;location.href='https://www.amazon.com'+location.pathname;
  dom['input[name="placeYourOrder1"]']=[];
  const control=node('',{name:'continue-bottom'});control.value='Continue';control.name='continue-bottom';
  control.form={getAttribute:()=>'/checkout/p/session/'+endpoint,querySelectorAll:()=>[]};control.click=()=>clicks++;
  dom['input[type="submit"],button[type="submit"]']=[control];return control;
}
let control=confirmation();assert.equal(inspectAmazonPage(rule,title).state,'confirmationReady');
let before=clicks;assert.equal(inspectAmazonPage(rule,title,'confirm','flow').clicked,true);
assert.equal(inspectAmazonPage(rule,title,'confirm','flow').clicked,false);assert.equal(clicks,before+1);
confirmation('shipoptionselect','spc');assert.equal(inspectAmazonPage(rule,title,'confirm','flow').clicked,true);
control=confirmation();control.form.getAttribute=()=>'/checkout/p/other-session/spc';assert.equal(inspectAmazonPage(rule,title,'confirm','wrong-session').state,'pending');
control=confirmation();control.form.getAttribute=()=>'/checkout/place-order';assert.equal(inspectAmazonPage(rule,title,'confirm','unsafe').state,'pending');
control=confirmation();control.form.querySelectorAll=()=>[{name:'placeYourOrder',value:'1'}];assert.equal(inspectAmazonPage(rule,title,'confirm','hidden-order').state,'pending');
control=confirmation();control.value='Place your order';assert.equal(inspectAmazonPage(rule,title,'confirm','order').state,'pending');
confirmation();dom['[role="alert"],.a-alert-content,p,h4']=[node('Sorry, the quantity you requested is no longer available.')];
before=clicks;assert.equal(inspectAmazonPage(rule,title,'confirm','rejected').state,'unavailable');assert.equal(clicks,before);
confirmation();dom['.lineitem-container'].push(node('Other product Quantity: 1'));assert.equal(inspectAmazonPage(rule,title,'confirm','other-product').state,'pending');
global.location.pathname='/gp/product/B0HJ6F8L6V';dom={'#nav-cart-count':[node('1')]};
assert.equal(inspectAmazonPage(rule,title).state,'pending','cart badge is only a hint');
// The first screenshot's small cart panel can display either subtotal.
// Both must take the same verification route, even if the full cart is priced.
for(const miniSubtotal of ['0.00','519.99']) {
  global.location.pathname='/gp/product/B0HJ6F8L6V';
  global.location.href='https://www.amazon.com/gp/product/B0HJ6F8L6V';
  const goToCart=node('Go to Cart',{href:'https://www.amazon.com/cart'});
  dom={'#nav-cart-count':[node('1')],'a[href]':[goToCart],
    '#ewc-content a[href*="/cart"]':[goToCart],
    'h1,h2,h3,h4':[node('Subtotal'),node('$'+miniSubtotal)]};
  const productResult=inspectAmazonPage(rule,title);
  assert.equal(productResult.state,'pending','mini-cart subtotal '+miniSubtotal+' cannot confirm stock');
  assert.equal(productResult.hasCartItems,true);
  assert.equal(productResult.cartUrl,'https://www.amazon.com/cart','both mini-cart subtotals lead to full-cart inspection');
  global.location.pathname='/gp/cart/view.html';cart('519.99');
  assert.equal(inspectAmazonPage(rule,title).state,'cartReady','priced full cart still requires checkout verification');
  checkout(0,'573.29','Sorry, the quantity you requested is no longer available.');
  assert.equal(inspectAmazonPage(rule,title).state,'unavailable','inventory rejection wins after either mini-cart subtotal');
}
global.location.hostname='www.amazon.com.evil.example';assert.equal(inspectAmazonPage(rule,title,'proceed','foreign').page,'other');
console.log('PASS: Amazon zero/nonzero mini-cart → priced full cart → inventory rejection; scoped quantity, saved rows, checkout entry, and valid review-page proof');
