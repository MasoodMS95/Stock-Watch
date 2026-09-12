// Cart entry only. Never runs a control on the checkout page.
function inspectNintendoCart(expectedItem='',action='inspect',token='') {
  if(location.origin!=='https://www.nintendo.com'||!/^\/us\/cart\/?$/.test(location.pathname))return {state:'other'};
  const visible=e=>!!e&&e.getClientRects().length&&getComputedStyle(e).visibility==='visible'&&getComputedStyle(e).display!=='none';
  const clean=t=>String(t||'').replace(/\s+/g,' ').trim();
  const main=document.querySelector('main,#main');if(!visible(main))return {state:'loading'};
  const removes=[...main.querySelectorAll('button')].filter(e=>visible(e)&&clean(e.innerText)==='Remove');
  if(!removes.length)return {state:'loading'};
  if(removes.length>1)return {state:'review',detail:'Nintendo cart watch found multiple cart items. Check your cart.'};
  let product='';
  for(let row=removes[0].parentElement,depth=0;row&&row!==main&&depth<8;row=row.parentElement,depth++) {
    const ids=[...row.querySelectorAll('a[href]')].filter(visible).map(e=>{try{const u=new URL(e.getAttribute('href'),location.href);return u.origin===location.origin?u.pathname.match(/^\/(?:us\/)?store\/products\/([^/]+)\/?$/)?.[1]:null;}catch{return null;}}).filter(Boolean);
    if(ids.length){const unique=[...new Set(ids)];if(unique.length!==1)return {state:'review',detail:'Could not identify one Nintendo cart item.'};product=unique[0];break;}
  }
  if(!product)return {state:'loading'};
  if(expectedItem&&product!==expectedItem)return {state:'review',detail:'Nintendo cart item changed. Review it before restarting.'};
  const buttons=[...main.querySelectorAll('button')].filter(e=>visible(e)&&clean(e.getAttribute('aria-label'))==='Proceed to secure checkout'&&clean(e.innerText)==='To secure checkout');
  const rejected=[...main.querySelectorAll('p,span,div,[role="alert"]')].some(e=>visible(e)&&/^One of the items in your cart is out of stock\. Remove it to continue to checkout\.$/i.test(clean(e.innerText)));
  if(buttons.length!==1)return {state:'loading',product};
  const button=buttons[0];
  if(button.closest('[aria-busy="true"]'))return {state:'loading',product};
  if(rejected)return {state:'unavailable',product};
  if(button.matches(':disabled')||button.closest('[aria-disabled="true"],[inert]'))return {state:'blocked',product};
  if(/place.?order|purchase|pay.?now/i.test([button.id,button.name,button.getAttribute('formaction'),button.form?.getAttribute('action')].join(' ')))return {state:'review',product,detail:'Unrecognized Nintendo checkout control; continue manually.'};
  if(action!=='click')return {state:'ready',product};
  if(!expectedItem||!token||globalThis.__stockNintendoCartToken===token)return {state:'pending',product,clicked:false};
  globalThis.__stockNintendoCartToken=token;button.click();return {state:'pending',product,clicked:true};
}
function inspectNintendoCheckoutError() {
  if(location.origin!=='https://www.nintendo.com'||!/^\/us\/checkout\/error\/?$/.test(location.pathname))return false;
  const visible=e=>e&&e.getClientRects().length&&getComputedStyle(e).visibility==='visible'&&getComputedStyle(e).display!=='none';
  const clean=t=>String(t||'').replace(/\s+/g,' ').trim();
  // Nintendo nests the product name inside the same paragraph after this
  // sentence. Matching the whole paragraph exactly misses the real error.
  const message=[...document.querySelectorAll('p,div,span,h1,h2')].some(e=>visible(e)&&/^Remove this item from your cart to continue:(?:\s|$)/i.test(clean(e.innerText)));
  const back=[...document.querySelectorAll('a,button')].some(e=>visible(e)&&/^Back to cart$/i.test(clean(e.innerText)));
  return message&&back;
}
function clickNintendoAutofilledPassword(token) {
  if(location.origin!=='https://accounts.nintendo.com'||location.pathname!=='/reauthenticate')return {clicked:false};
  const visible=e=>e&&e.getClientRects().length&&getComputedStyle(e).visibility==='visible'&&getComputedStyle(e).display!=='none';
  const clean=t=>String(t||'').replace(/\s+/g,' ').trim();
  if(![...document.querySelectorAll('h1,h2')].some(e=>visible(e)&&clean(e.innerText)==='Re-enter Password'))return {clicked:false};
  if([...document.querySelectorAll('input[autocomplete="one-time-code"],iframe[title*="challenge" i],iframe[title*="captcha" i],[role="alert"]')].some(visible))return {clicked:false};
  const inputs=[...document.querySelectorAll('input[type="password"]')].filter(visible);
  // Test the browser's autofill state, never read or return the password value.
  if(inputs.length!==1||!inputs[0].matches(':-webkit-autofill'))return {clicked:false};
  const form=inputs[0].form;if(!form)return {clicked:false};
  let target;try{target=new URL(form.getAttribute('action')||location.href,location.href);}catch{return {clicked:false};}
  if(target.origin!==location.origin||target.pathname!=='/reauthenticate')return {clicked:false};
  const buttons=[...form.querySelectorAll('button,input[type="submit"]')].filter(e=>visible(e)&&clean(e.innerText||e.getAttribute('value'))==='OK'&&!e.matches(':disabled')&&!e.closest('[aria-disabled="true"],[aria-busy="true"],[inert]'));
  if(buttons.length!==1||!token||globalThis.__stockNintendoPasswordToken===token)return {clicked:false};
  const override=buttons[0].getAttribute('formaction');
  if(override){const u=new URL(override,location.href);if(u.origin!==target.origin||u.pathname!==target.pathname)return {clicked:false};}
  globalThis.__stockNintendoPasswordToken=token;buttons[0].click();return {clicked:true};
}
function observeNintendoCheckoutError() {
  clearInterval(globalThis.__stockNintendoErrorTimer);
  globalThis.__stockNintendoErrorTimer=setInterval(()=>{
    if(location.origin!=='https://www.nintendo.com'||!/^\/us\/checkout\/error\/?$/.test(location.pathname)){clearInterval(globalThis.__stockNintendoErrorTimer);return;}
    if(inspectNintendoCheckoutError()){clearInterval(globalThis.__stockNintendoErrorTimer);chrome.runtime.sendMessage({type:'scanDue'}).catch(()=>{});}
  },250);
}
if(typeof module!=='undefined')module.exports={inspectNintendoCart,inspectNintendoCheckoutError,clickNintendoAutofilledPassword};
