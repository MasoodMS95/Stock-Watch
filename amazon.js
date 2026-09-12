// Read-only and self-contained: safe to inspect after a full-page redirect.
function inspectAmazonVerification(productId = '') {
  const result={blocked:false,productReady:false,homepageReady:false};
  if(location.hostname!=='www.amazon.com')return result;
  const visible=e=>!!e&&e.getClientRects().length&&getComputedStyle(e).visibility==='visible'&&getComputedStyle(e).display!=='none';
  const clean=t=>String(t||'').replace(/\s+/g,' ').trim();
  const isContinue=e=>visible(e)&&/^Continue shopping$/i.test(clean(e.innerText||e.value));
  const form=[...document.querySelectorAll('form[action]')].some(f=>{
    try {
      const target=new URL(f.getAttribute('action'),location.href);
      return target.origin==='https://www.amazon.com'&&target.pathname==='/errors_page/validateCaptcha'&&
        [...f.querySelectorAll('button,input[type="submit"]')].some(isContinue);
    }catch{return false;}
  });
  const heading=[...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].some(e=>visible(e)&&/^Click the button below to continue shopping[.!]?$/i.test(clean(e.innerText)));
  result.blocked=form||(location.pathname==='/errors_page/validateCaptcha'&&heading&&[...document.querySelectorAll('button,input[type="submit"]')].some(isContinue));
  if(result.blocked)return result;
  const title=document.querySelector('#productTitle');
  const asin=location.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i)?.[1];
  result.productReady=!!asin&&asin.toUpperCase()===productId.toUpperCase()&&!!visible(title)&&!!clean(title.innerText);
  result.homepageReady=/^\/(?:ref=[^/]+)?\/?$/.test(location.pathname)&&!!visible(document.querySelector('#nav-logo-sprites'))&&!!visible(document.querySelector('#twotabsearchtextbox'));
  return result;
}
// Runs inside Amazon's page. Cart counts, prices and "Added" messages are
// navigation hints only. Only an identified checkout item can verify stock.
function inspectAmazonPage(rule, expectedTitle = '', action = 'inspect', token = '') {
  if(rule?.store!=='Amazon'||! /^[A-Z0-9]{10}$/i.test(rule.productId)||location.hostname!=='www.amazon.com')return {state:'pending',page:'other'};
  const visible=e=>!!e&&e.getClientRects().length&&getComputedStyle(e).visibility==='visible'&&getComputedStyle(e).display!=='none';
  const clean=t=>String(t||'').replace(/\s+/g,' ').trim();
  const identity=t=>clean(t).toLowerCase().replace(/[™®]/g,'').replace(/[–—-]/g,' ').replace(/\s+/g,' ').trim();
  const asin=rule.productId.toUpperCase();
  const path=location.pathname;
  const page=/^\/(?:gp\/cart(?:\/|$)|cart(?:\/|$))/.test(path)?'cart':/^\/(?:checkout(?:\/|$)|gp\/buy(?:\/|$))/.test(path)?'checkout':'product';
  const links=[...document.querySelectorAll('a[href]')].filter(visible);
  const cartLink=links.find(e=>{try{const u=new URL(e.href,location.href);return u.origin==='https://www.amazon.com'&&/^\/(?:gp\/cart\/view\.html|cart)\/?$/.test(u.pathname)&&(/^(?:Go to Cart|Back to cart)$/i.test(clean(e.innerText))||e.id==='nav-cart');}catch{return false;}});
  const cartUrl=cartLink?.href||'';
  const title=clean(document.querySelector('#productTitle')?.innerText||document.querySelector('h1#title')?.innerText);
  const base={page,cartUrl,title};
  // Observed product-page glitch: a positive header badge with an empty expanded
  // cart. Treat this as inconsistent page state, never as inventory evidence.
  const sideCart=document.querySelector('#nav-flyout-ewc');
  const badgeCount=Number(clean(document.querySelector('#nav-cart-count')?.innerText));
  if(page==='product'&&title&&visible(sideCart)&&badgeCount>0&&
    /^Subtotal\s*\$0\.00\s*Go to Cart$/i.test(clean(sideCart.innerText)))
    return {...base,state:'staleCart',reason:'emptySideCart'};
  // Amazon's checkout-entry failure is an image, not heading/body text.
  // Require the specific server-error wording, including its retry instruction.
  const errorEvidence=[...document.querySelectorAll('img[alt]')].filter(visible).map(e=>clean(e.getAttribute('alt')))
    .concat([...document.querySelectorAll('h1,h2,h3,h4,p,[role="alert"]')].filter(visible).map(e=>clean(e.innerText)));
  if(errorEvidence.some(t=>t.length<1000&&/something went wrong on our end/i.test(t)&&/go back and try again/i.test(t)))
    return {...base,state:'retryableError',reason:'amazonServerError'};
  const rejected=t=>/\bout of stock\b|(?:currently|temporarily) unavailable|(?:quantity you requested|this item|item\(s\) you selected).{0,100}(?:no longer|not) available|no longer available from (?:the|your) (?:selected )?seller/i.test(t);
  const headings=[...document.querySelectorAll('h1,h2,h3,h4')].filter(visible).map(e=>clean(e.innerText));
  const emptyCartText=t=>/^(?:Your )?(?:Amazon )?(?:shopping )?cart (?:is empty|is currently empty|is empty right now)[.!]?$/i.test(t);
  if(page==='cart'&&(headings.some(emptyCartText)||[...document.querySelectorAll('p,div,span')].some(e=>visible(e)&&emptyCartText(clean(e.innerText)))))return {...base,state:'unavailable',reason:'emptyCart'};
  // Error views can show a nonzero total and even a stale "Place" control.
  // Read errors before considering any positive checkout evidence.
  if(page==='checkout') {
    const errors=[...document.querySelectorAll('[role="alert"],.a-alert-content,p,h4')].filter(visible).map(e=>clean(e.innerText)).filter(t=>t.length<1800);
    const inventoryError=errors.some(rejected)||headings.some(rejected);
    const updateHeading=headings.some(t=>/^Make updates to your items$/i.test(t));
    const problem=errors.some(t=>/There was a problem with some of the items in your order/i.test(t));
    const rows=[...document.querySelectorAll('.lineitem-container')].filter(visible);
    const matches=rows.filter(row=>{
      const titles=[...row.querySelectorAll('.lineitem-title-text')].filter(visible);
      const ids=[row.getAttribute('data-asin'),...[...row.querySelectorAll('a[href]')].map(e=>e.getAttribute('href')?.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|[?#]|$)/i)?.[1])].filter(Boolean).map(id=>id.toUpperCase());
      return ids.length?ids.every(id=>id===asin):(!!expectedTitle&&titles.length===1&&identity(titles[0].innerText)===identity(expectedTitle));
    });
    if(matches.length!==1)return {...base,state:inventoryError||updateHeading?'unavailable':'pending',reason:inventoryError?'amazonUnavailable':updateHeading?'checkoutItemError':undefined};
    const rowText=clean(matches[0].innerText),quantities=[...rowText.matchAll(/Quantity:\s*(\d+)\b/gi)].map(m=>Number(m[1]));
    const single=rows.length===1&&quantities.length===1;
    const item={...base,cartItem:true,quantityRestored:single&&quantities[0]===1&&!inventoryError&&!problem&&!rejected(rowText)};
    if(inventoryError||problem||rejected(rowText)||quantities.includes(0))return {...item,state:'unavailable',reason:inventoryError?'amazonUnavailable':'zeroQuantity',inventoryWatch:single&&quantities[0]===0};
    if(updateHeading&&!item.quantityRestored)return {...item,state:'unavailable',reason:'checkoutItemError'};
    const ready=[...document.querySelectorAll('input[name="placeYourOrder1"]')].some(e=>visible(e)&&!e.matches(':disabled')&&clean(e.value)==='Place your order');
    if(rows.length===1&&quantities.length===1&&quantities[0]===1&&ready)return {...item,state:'checkoutReady'};
    // Only advance a known intermediate checkout form with this single item.
    // Final-order controls and inventory errors are never confirmation targets.
    const session=path.match(/^\/checkout\/p\/([^/]+)\/(itemselect|addressselect|shipoptionselect|payselect)\/?$/);
    if(!ready&&session&&rows.length===1&&quantities.length===1&&quantities[0]===1) {
      const candidates=[...document.querySelectorAll('input[type="submit"],button[type="submit"]')].filter(e=>{
        if(!visible(e)||e.matches(':disabled')||e.closest('[aria-disabled="true"],[inert]')||clean(e.value||e.innerText)!=='Continue'||!e.form)return false;
        if(/place|purchase|buy.?now|submit.?order/i.test([e.id,e.name,e.getAttribute('name')].join(' ')))return false;
        if([...e.form.querySelectorAll('input[type="hidden"]')].some(h=>/place.?your.?order|place.?order|submit.?order|buy.?now/i.test([h.name,h.value].join(' '))))return false;
        try {
          const target=new URL(e.getAttribute('formaction')||e.form.getAttribute('action'),location.href);
          const destination=target.pathname.match(/^\/checkout\/p\/([^/]+)\/(itemselect|addressselect|shipoptionselect|payselect|spc|review)\/?$/);
          return target.origin==='https://www.amazon.com'&&destination?.[1]===session[1]&&!/place|submit.?order|buy.?now/i.test(target.search);
        }catch{return false;}
      });
      const endpoints=new Set(candidates.map(e=>new URL(e.getAttribute('formaction')||e.form.getAttribute('action'),location.href).href));
      if(candidates.length&&endpoints.size===1) {
        const step=path;
        if(action!=='confirm')return {...item,state:'confirmationReady',step};
        const stamp=token+':'+step;
        if(!token||globalThis.__stockAmazonConfirmation===stamp)return {...item,state:'pending',clicked:false};
        globalThis.__stockAmazonConfirmation=stamp;candidates[0].click();
        return {...item,state:'pending',clicked:true};
      }
    }
    return {...item,state:'pending'};
  }
  if(page!=='cart')return {...base,state:'pending',hasCartItems:Number(clean(document.querySelector('#nav-cart-count')?.innerText))>0||!!document.querySelector('#ewc-content a[href*="/cart"]')};
  const rows=[...document.querySelectorAll('[data-itemtype="active"][data-asin]')].filter(visible);
  const matches=rows.filter(r=>r.getAttribute('data-asin').toUpperCase()===asin);
  if(!matches.length)return {...base,state:document.querySelector('#sc-active-cart')?'unavailable':'pending',reason:'missingCartItem'};
  if(matches.length!==1)return {...base,state:'attention',detail:'More than one cart row matches this product. Check the cart before resuming.'};
  const row=matches[0],rowText=clean(row.innerText);
  const rowTitle=clean(row.getAttribute('data-producttitle'));
  const item={...base,title:rowTitle||expectedTitle,cartItem:true};
  if(row.getAttribute('data-outofstock')==='1'||rejected(rowText)||row.getAttribute('data-quantity')==='0')return {...item,state:'unavailable',reason:'cartItemUnavailable'};
  const selected=r=>r.getAttribute('data-isselected')==='1'||[...r.querySelectorAll('input[type="checkbox"]')].some(e=>e.checked&&/for checkout/i.test(e.getAttribute('aria-label')||''));
  if(!selected(row)||rows.some(r=>r!==row&&(selected(r)||r.getAttribute('data-isselected')!=='0')))return {...item,state:'attention',detail:'Checkout selection includes other items or excludes this product. Check the cart selection yourself.'};
  const quantities=[row.getAttribute('data-quantity'),...([...row.querySelectorAll('input[name="quantityBox"],select[name*="quantity"]')].map(e=>e.value))].filter(v=>v!==null&&v!=='').map(Number);
  if(!quantities.length||quantities.some(n=>n!==1))return {...item,state:'attention',detail:'The cart quantity is not clearly one. Check it before resuming.'};
  const controls=[...document.querySelectorAll('input[name="proceedToRetailCheckout"]')].filter(e=>{
    if(!visible(e)||e.matches(':disabled')||e.closest('[aria-disabled="true"],[inert]')||clean(e.value)!=='Proceed to checkout'||!e.form)return false;
    try {const target=new URL(e.getAttribute('formaction')||e.form.getAttribute('action'),location.href);return target.origin==='https://www.amazon.com'&&target.pathname==='/checkout/entry/cart';}catch{return false;}
  });
  if(controls.length!==1)return {...item,state:'pending'};
  if(action!=='proceed')return {...item,state:'cartReady'};
  if(!token||globalThis.__stockAmazonCheckout===token)return {...item,state:'pending',clicked:false};
  globalThis.__stockAmazonCheckout=token;
  controls[0].click();
  return {...item,state:'pending',clicked:true};
}
if(typeof module!=='undefined')module.exports={inspectAmazonPage,inspectAmazonVerification};
