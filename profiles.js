// Conservative starting rules for the five supported retailers. A missing or
// ambiguous purchase control waits for another refresh; it never falls back
// to clicking an arbitrary Add to cart button elsewhere on the page.
function productRule(rawUrl) {
  const u = new URL(rawUrl), host = u.hostname.replace(/^www\./, '');
  let id;
  if (host === 'amazon.com' && (id = u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i)?.[1])) return {store: 'Amazon', productId: id, selectors: ['#add-to-cart-button', '#buy-now-button']};
  if (host === 'bestbuy.com' && (id = u.pathname.match(/\/sku\/(\d+)/)?.[1] || u.pathname.match(/\/(\d+)\.p/)?.[1])) return {store: 'Best Buy', productId: id, selectors: [`button[data-testid="pdp-add-to-cart-${id}"]`, `button[data-testid="pdp-pre-order-${id}"]`, `button[data-testid="pdp-coming-soon-${id}"]`, `button.add-to-cart-button[data-sku-id="${id}"]`, `[data-sku-id="${id}"] button.add-to-cart-button`]};
  if (host === 'bestbuy.com' && /\/product\/[^/]+\/[A-Z0-9]+\/?$/i.test(u.pathname)) return {store: 'Best Buy', productId: u.pathname.split('/').filter(Boolean).pop(), needsSku: true, selectors: ['button[data-testid^="pdp-add-to-cart-"]', 'button[data-testid^="pdp-pre-order-"]', 'button[data-testid^="pdp-coming-soon-"]']};
  if (host === 'nintendo.com' && /^\/us\/cart\/?$/.test(u.pathname)) return {store:'Nintendo',mode:'cart',productId:'cart',selectors:[]};
  if (host === 'nintendo.com' && /\/store\/products\/[^/]+/.test(u.pathname)) return {store: 'Nintendo', productId: u.pathname.split('/').filter(Boolean).pop(), selectors: ['button:has(svg[data-testid="ShoppingCartIcon"])', 'main button[data-testid="add-to-cart-button"]', 'main button[data-test="add-to-cart"]', 'main button[aria-label="Add to cart"]']};
  if (host === 'walmart.com' && (id = u.pathname.match(/\/ip\/(?:[^/]+\/)?(\d+)/)?.[1])) return {store: 'Walmart', productId: id, selectors: ['main [data-testid="atc-buynow-container"] button[data-automation-id="atc"]', 'main [data-testid="add-to-cart-section"] button', 'main button[data-testid="add-to-cart-button"]']};
  if (host === 'gamestop.com' && (id = u.pathname.match(/\/(\d+)\.html/)?.[1])) return {store: 'GameStop', productId: id, selectors: [`button.add-to-cart[data-pid="${id}"]`, `[data-pid="${id}"] button.add-to-cart`, '.product-detail .cart-and-ipay button.add-to-cart', '.product-detail .product-add-to-cart button.add-to-cart']};
  return null;
}
function resolveProductButton(rule) {
  if (!rule) return {selector: '', status: 'No automatic product rule for this store'};
  const excluded = '[data-testid*="recommend" i],[data-test*="recommend" i],[class*="recommend" i],[class*="carousel" i],[data-testid*="sponsor" i]';
  for (const selector of rule.selectors) {
    const matches = [...document.querySelectorAll(selector)].filter(el => !el.closest(excluded) && el.getClientRects().length && getComputedStyle(el).visibility === 'visible');
    if (matches.length > 1) return {selector: '', status: 'Waiting: more than one product control matches; use Advanced setup to choose one'};
    // Return a disabled primary button too; never switch to a recommendation
    // or another fulfillment choice just because the intended button is disabled.
    if (matches.length === 1) return {selector, status: 'Product control located'};
  }
  return {selector: '', status: 'Watching product page — waiting for its purchase button to appear'};
}
function resolveBestBuyRule(rule) {
  if(rule?.store!=='Best Buy'||!rule.needsSku)return rule;
  const ids=new Set();
  for(const el of document.querySelectorAll('button[data-testid^="pdp-"],[data-testid^="pdp-gated-purchase-failure-modal-container-"]')) {
    if(!el.getClientRects().length||getComputedStyle(el).visibility!=='visible')continue;
    const id=el.getAttribute('data-testid')?.match(/^pdp-(?:add-to-cart|pre-order|coming-soon|gated-purchase-failure-modal-container)-(\d+)$/)?.[1];
    if(id)ids.add(id);
  }
  if(ids.size!==1)return rule;
  const [id]=ids;
  return {...rule,needsSku:false,catalogId:rule.productId,productId:id,selectors:[`button[data-testid="pdp-add-to-cart-${id}"]`,`button[data-testid="pdp-pre-order-${id}"]`,`button[data-testid="pdp-coming-soon-${id}"]`,`button.add-to-cart-button[data-sku-id="${id}"]`]};
}
function defaultFulfillment(rule) { return rule?.store==='Best Buy' ? 'pickup' : 'shipping'; }
function resolveFulfillment(rule, desired) {
  if(!desired||desired==='auto')return defaultFulfillment(rule);
  if(desired==='delivery'&&rule?.store!=='Walmart')throw Error('Delivery is supported for Walmart product watches only');
  if(!['pickup','shipping','delivery'].includes(desired))throw Error('Choose pickup, shipping, or Walmart delivery');
  return desired;
}
function ensureFulfillment(rule, desired, select = false) {
  if(desired==='delivery'&&rule?.store!=='Walmart')return {ready:false,detail:'Delivery is supported for Walmart product watches only'};
  if(!['pickup','shipping','delivery'].includes(desired))return {ready:false,detail:'Unknown fulfillment option'};
  if (!rule) return {ready:true};
  if(['Amazon','Nintendo'].includes(rule.store)) return desired==='shipping'?{ready:true}:{ready:false,detail:'This store rule supports shipping/online fulfillment only'};
  const visible = e => e.getClientRects().length && getComputedStyle(e).visibility === 'visible';
  const label = e => [e.getAttribute('aria-label'), ...(e.getAttribute('aria-labelledby') || '').split(/\s+/).map(id=>document.getElementById(id)?.innerText), e.innerText, ...(e.labels || [])].filter(Boolean).map(x=>typeof x==='string'?x:x.innerText).join(' ').replace(/\s+/g,' ').trim();
  let controls = [], selected = false;
  if (rule.store === 'Walmart') {
    controls = [...document.querySelectorAll(`input#fulfillment-${{pickup:'Pickup',shipping:'Shipping',delivery:'Delivery'}[desired]}`)];
    selected = controls.length===1 && controls[0].checked;
  } else if (rule.store === 'GameStop') {
    controls = [...document.querySelectorAll('button')].filter(e=>visible(e) && (desired==='pickup'?/^pick\s*up\s+in.store/i:/^ship\s+to\s+home/i).test(label(e)));
    selected = [...document.querySelectorAll('h6')].some(e=>visible(e)&&(desired==='pickup'?/Delivery:\s*Pick/i:/Delivery:\s*Ship to Home/i).test(e.innerText));
  } else if (rule.store === 'Best Buy') {
    controls = [...document.querySelectorAll('input[type="radio"],[role="radio"]')].filter(e=>visible(e)&&(desired==='pickup'?/^Pickup\b/i:/^Shipping\b/i).test(label(e)));
    selected = controls.length===1 && (controls[0].checked || controls[0].getAttribute('aria-checked')==='true');
  }
  if (controls.length!==1) return {ready:false,detail:`Waiting for a clear ${desired} option at the saved location`};
  const el=controls[0];
  if (el.matches(':disabled') || el.getAttribute('aria-disabled')==='true') return {ready:false,selected,detail:`${desired} selection is disabled on the page`};
  const unavailable=/not available|unavailable|out of stock/i.test(label(el));
  // Walmart's enabled tiles remain selectable while their inventory is empty.
  // Select the requested mode, but never treat that selection as cart readiness.
  if(unavailable && (rule.store!=='Walmart'||selected||!select)) return {ready:false,selected,unavailable:true,detail:selected?`${{pickup:'Pickup',shipping:'Shipping',delivery:'Delivery'}[desired]} selected; out of stock.`:`${desired} is unavailable; no alternate fulfillment will be chosen`};
  if (selected) return {ready:true,selected:true};
  if (!select) return {ready:false,detail:`Waiting for ${desired} selection to be confirmed`};
  // Only change fulfillment type. Never change the saved store/address.
  const target = rule.store==='Walmart' ? document.querySelector(`label[for="${el.id}"]`) : el;
  if (!target) return {ready:false,detail:`Could not select ${desired}`};
  target.click(); return {ready:false,changed:true,detail:`Selecting ${desired}; verifying the page response`};
}
if (typeof module !== 'undefined') module.exports = {productRule, resolveProductButton, resolveBestBuyRule, defaultFulfillment, resolveFulfillment, ensureFulfillment};
