// Read only product controls and categorical page evidence, never whole HTML,
// screenshots, cookies, storage, or customer/address/payment input values.
function captureWatchPage(rule,selector='',expectedTitle='') {
  const visible=e=>!!e&&e.getClientRects().length&&getComputedStyle(e).visibility==='visible';
  const clean=t=>String(t||'').replace(/\s+/g,' ').trim();
  const out={capturedAt:Date.now(),readyState:document.readyState,visibility:document.visibilityState,hasFocus:document.hasFocus(),pathKind:/checkout|\/gp\/buy\//.test(location.pathname)?'checkout':/cart/.test(location.pathname)?'cart':'product/other',controls:[],signals:[]};
  for(const query of [...new Set([selector,...(rule?.selectors||[])].filter(Boolean))].slice(0,8)) {
    try {
      const elements=[...document.querySelectorAll(query)];
      out.controls.push({selector:query,matches:elements.length,buttons:elements.slice(0,5).map(e=>{
        const label=clean(e.innerText||e.value||e.getAttribute('aria-label'));
        return {tag:e.tagName,visible:!!visible(e),disabled:e.matches(':disabled')||e.getAttribute('aria-disabled')==='true',label:/^(?:add to (?:cart|bag)|pre[ -]?(?:order|purchase)|buy now|coming soon|sold out|unavailable)(?:\b|:)/i.test(label)?label.slice(0,100):'[other label]',testId:e.getAttribute('data-testid')?.slice(0,100)||''};
      })});
    }catch{out.controls.push({selector:query,error:'Invalid selector'});}
  }
  const patterns={queue:/you(?:'|’)?re in (?:line|queue)|you are in line|waiting room|your (?:place|position) in (?:line|queue)|do not refresh/i,verification:/press(?:\s+|[-–])(?:and|&)(?:\s+|[-–])hold|verify.{0,25}human|quick verification|captcha challenge/i,inventory_rejection:/quantity you requested is (?:no longer|not) available|not added to your cart|this item is currently unavailable/i,empty_cart:/^(?:your )?(?:amazon )?(?:shopping )?cart is empty/i,zero_quantity:/Quantity:\s*0\b/i,checkout_item_error:/make updates to your items/i,unavailable:/^(?:currently unavailable\.?|sold out|out of stock)$/i};
  const detected=new Set();
  for(const e of [...document.querySelectorAll('h1,h2,h3,h4,p,[role="alert"],.a-alert-content')].slice(0,400)) {
    if(!visible(e)||e.closest('nav,footer,#sc-saved-cart,#sc-saved-cart-container'))continue;
    const text=clean(e.innerText);if(text.length>1500)continue;
    for(const [name,pattern] of Object.entries(patterns))if(pattern.test(text))detected.add(name);
  }
  out.signals=[...detected];
  if(rule?.store==='Amazon'&&[...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].some(e=>visible(e)&&/^Click the button below to continue shopping[.!]?$/i.test(clean(e.innerText))))out.signals.push('amazon_continue_shopping');
  if(rule?.store==='Amazon'&&[...document.querySelectorAll('img[alt]')].some(e=>visible(e)&&/something went wrong on our end/i.test(e.getAttribute('alt')||'')&&/go back and try again/i.test(e.getAttribute('alt')||'')))out.signals.push('amazon_server_error');
  if(rule?.store==='Walmart')out.fulfillment=[...document.querySelectorAll('input[id^="fulfillment-"]')].filter(e=>/^fulfillment-(Shipping|Pickup|Delivery)$/.test(e.id)).slice(0,6).map(e=>({
    mode:e.id.slice('fulfillment-'.length).toLowerCase(),selected:!!e.checked,
    disabled:e.matches(':disabled')||e.getAttribute('aria-disabled')==='true',
    unavailable:/not available|unavailable|out of stock/i.test([e.getAttribute('aria-label'),...(e.labels||[])].map(v=>typeof v==='string'?v:v?.innerText||'').join(' '))
  }));
  if(rule?.store==='Best Buy'&&/^\d+$/.test(rule.productId))out.bestBuySoldOutModal=!!visible(document.querySelector(`[data-testid="pdp-gated-purchase-failure-modal-container-${rule.productId}"]`));
  if(rule?.store==='Amazon') {
    out.cartBadge=Number(clean(document.querySelector('#nav-cart-count')?.innerText))||0;
    out.sideCartVisible=!!visible(document.querySelector('#ewc-content'));
    out.sideCartHasWatchedItem=[...document.querySelectorAll('#ewc-content a[href]')].some(e=>e.getAttribute('href')?.includes(rule.productId));
    const rows=[...document.querySelectorAll('[data-itemtype="active"][data-asin]')].filter(visible);
    out.activeCartRows=rows.length;
    out.watchedCartRows=rows.filter(e=>e.getAttribute('data-asin')?.toUpperCase()===rule.productId.toUpperCase()).map(e=>({quantity:Number(e.getAttribute('data-quantity')),selected:e.getAttribute('data-isselected'),outOfStock:e.getAttribute('data-outofstock')}));
    out.checkoutEntries=[...document.querySelectorAll('input[name="proceedToRetailCheckout"]')].map(e=>({visible:!!visible(e),disabled:e.matches(':disabled'),expectedLabel:clean(e.value)==='Proceed to checkout',expectedEndpoint:(e.getAttribute('formaction')||e.form?.getAttribute('action')||'').includes('/checkout/entry/cart')}));
    out.finalOrderControlPresent=[...document.querySelectorAll('input[name="placeYourOrder1"]')].some(visible);
  }
  return out;
}
if(typeof module!=='undefined')module.exports={captureWatchPage};
