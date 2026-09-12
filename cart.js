// Self-contained functions run only in the selected product tab.
function inspectNintendoRejection(expectedUrl) {
  if(location.hostname!=='www.nintendo.com'||location.href.split('#')[0]!==expectedUrl.split('#')[0])return false;
  const visible=e=>e&&e.getClientRects().length&&getComputedStyle(e).visibility==='visible'&&getComputedStyle(e).display!=='none';
  const buttons=[...document.querySelectorAll('button')].filter(e=>visible(e)&&/^Pre-purchase$/i.test((e.innerText||'').trim())&&e.querySelector('svg[data-testid="ShoppingCartIcon"]'));
  if(buttons.length!==1)return false;
  const button=buttons[0];
  if(button.matches(':disabled')||button.closest('[aria-busy="true"],[aria-disabled="true"],[inert]'))return false;
  for(let row=button.parentElement,depth=0;row&&row!==document.body&&depth<5;row=row.parentElement,depth++){
    const error=[...row.querySelectorAll('p,span,div,[role="alert"]')].some(e=>visible(e)&&/^The requested quantity is not available[.!]?$/i.test((e.innerText||'').trim()));
    if(error)return true;
  }
  return false;
}
function pageAttention() {
  // Customer answers/reviews quote purchase UI; they are not live store state.
  const community = e => {for(let n=e;n;n=n.parentElement)if(/(?:questions?|answers?|reviews?|ugc|bazaarvoice|\bbv[-_])/i.test([n.id,n.className,n.getAttribute?.('data-testid'),n.getAttribute?.('data-test')].join(' ')))return true;return false;};
  const elements=[...document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,span,div,button,iframe,[role="dialog"],[role="alert"]')].filter(e=>e.getClientRects().length && getComputedStyle(e).visibility!=='hidden');
  for(const e of elements){if(community(e))continue;const t=(e.innerText||'').replace(/\s+/g,' ').trim();if(t.length>1500)continue;
    if(/^(?:you(?:'|’)?re in (?:line|(?:a |the )?queue)|you are in (?:line|(?:a |the )?queue)|waiting room|your (?:place|position) in (?:line|(?:the )?queue)|it(?:'|’)s your turn|do not (?:refresh|close)(?: this (?:page|window|tab))?|don(?:'|’)t (?:refresh|close)(?: this (?:page|window|tab))?)(?:[.!:]|$)/i.test(t))return {reason:'queue',detail:t};
    if(/press(?:\s+|[-–])(?:and|&)(?:\s+|[-–])hold|(?:confirm|verify|prove).{0,35}(?:human|not a (?:bot|robot))|(?:complete|pass).{0,20}(?:captcha|security check)|quick verification/i.test(t+' '+(e.getAttribute('title')||'')+' '+(e.getAttribute('aria-label')||'')))return {reason:'bot',detail:'Complete human verification in this tab before resuming.'};
    if(/sign in to add to cart|confirm (?:your|the|this) (?:pickup )?store|verify your account/i.test(t))return 'Sign-in or store confirmation is required. Monitoring paused; complete it in this tab, then Resume.';
  } return '';
}
function cartSignals(rule = null) {
  const community = e => {for(let n=e;n;n=n.parentElement)if(/(?:questions?|answers?|reviews?|ugc|bazaarvoice|\bbv[-_])/i.test([n.id,n.className,n.getAttribute?.('data-testid'),n.getAttribute?.('data-test')].join(' ')))return true;return false;};
  const visible = el => el.getClientRects().length && getComputedStyle(el).visibility === 'visible' && getComputedStyle(el).display !== 'none';
  const text = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,span,div,button,iframe,[role="alert"],[role="status"]')]
    .filter(el=>visible(el)&&!community(el)).map(el => (el.innerText || el.getAttribute('title') || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim())
    .filter(t => t && t.length < 350);
  // Some stores navigate straight to cart without an "Added" toast. Only
  // accept a product-specific cart row with its own quantity and remove control.
  if(rule && /(?:\/cart(?:\/|$)|\/gp\/cart\/)/i.test(location.pathname)) {
    const productLinks=[...document.querySelectorAll('a[href]')].filter(a=>a.getAttribute('href').includes(rule.productId));
    for(const link of productLinks) {
      let row=link.parentElement;
      for(let depth=0;row&&depth<8;depth++,row=row.parentElement) {
        if(row===document.body || row.querySelector('h1'))break;
        const quantity=row.querySelector('select[id*="quantity"],select[name*="quantity"],input[name*="quantity"]');
        const remove=[...row.querySelectorAll('button,a')].some(e=>visible(e)&&/^remove$/i.test((e.innerText||'').trim()));
        const otherProducts=[...row.querySelectorAll('a[href]')].some(a=>/\/product\/|\/products\/|\/dp\/|\/-\/A-|\/ip\//.test(a.getAttribute('href'))&&!a.getAttribute('href').includes(rule.productId));
        if(quantity && Number(quantity.value)===1 && remove && !otherProducts) {text.push('Added to cart — verified product row and quantity 1');break;}
      }
    }
  }
  return [...new Set(text)];
}
function classifyCart(signals, baseline = []) {
  // A visible verification gate always needs the user, even alongside a
  // stock error/success message or when it was already present before clicking.
  const bot = signals.find(t => /press(?:\s+|[-–])(?:and|&)(?:\s+|[-–])hold|(?:confirm|verify|prove).{0,35}(?:human|not a (?:bot|robot))|(?:complete|solve|pass|enter).{0,30}captcha|captcha (?:challenge|verification)|robot check|(?:complete|pass).{0,20}security check|quick verification|unusual traffic|automated (?:access|activity).{0,25}(?:blocked|detected)/i.test(t));
  if (bot) return {state: 'attention', reason: 'bot', detail: `Complete the check in this tab and inspect your cart. ${bot}`};
  const queue=signals.find(t=>/^(?:you(?:'|’)?re in (?:line|(?:a |the )?queue)|you are in (?:line|(?:a |the )?queue)|waiting room|your (?:place|position) in (?:line|(?:the )?queue)|it(?:'|’)s your turn|do not (?:refresh|close)(?: this (?:page|window|tab))?|don(?:'|’)t (?:refresh|close)(?: this (?:page|window|tab))?)(?:[.!:]|$)/i.test(t));
  if(queue)return {state:'attention',reason:'queue',detail:queue};
  const fresh = signals.filter(t => !baseline.includes(t));
  if(fresh.some(t=>/^(?:Your )?(?:Amazon )?(?:shopping )?cart is empty[.!]?$/i.test(t)||/^Quantity:\s*0$/i.test(t)))return {state:'unavailable',reason:'emptyCart',detail:'The result shows an empty cart or zero quantity.'};
  if(fresh.some(t=>/^This Item is currently unavailable$/i.test(t)) && signals.some(t=>/item\(s\) you selected are not available from your selected seller\(s\)/i.test(t)))return {state:'unavailable',reason:'amazonUnavailable',detail:'Amazon says this item is currently unavailable from the selected seller.'};
  const failure = fresh.find(t => /(?:sorry[,!]?\s*)?(?:the )?quantity you requested is (?:no longer|not) available|(?:unable|failed) to add.{0,90}(?:out of stock|unavailable)|(?:item|product).{0,70}(?:could not|couldn't|cannot|can't) be added|(?:sorry|unfortunately).{0,100}(?:out of stock|no longer available)/i.test(t));
  const success = fresh.find(t => /^(?:(?:success|successfully)[!:,]?\s*)?(?:(?:1|one|item|product|this item|your item)\s+)?(?:successfully\s+)?added to (?:(?:your|the) )?(?:cart|bag|basket)(?:\b|!)/i.test(t) && !/not added|could not|unable|failed/i.test(t));
  const attention = fresh.find(t => /verify your (?:account|identity)|confirm (?:you are|you're) (?:a )?human|press (?:and|&) hold|sign in to (?:continue|purchase|add to cart)|confirm (?:your|the|this) (?:pickup )?store|complete the security check/i.test(t));
  if (failure && success) return {state: 'attention', detail: 'Conflicting store messages. Check the cart manually.'};
  if (failure) return {state: 'unavailable', detail: failure};
  if (success) return {state: 'confirmed', detail: success};
  if (attention) return {state: 'attention', detail: attention};
  return {state: 'pending', detail: 'No new cart confirmation yet'};
}
function clickPurchase(selector, expectedUrl, token, rule = null, fulfillment = 'shipping') {
  if (location.href.split('#')[0] !== expectedUrl.split('#')[0]) return {clicked: false, reason: 'Product page changed'};
  if (globalThis.__stockWatchAttempt === token) return {clicked: false, reason: 'Attempt already made'};
  const matches = [...document.querySelectorAll(selector)].filter(el => el.getClientRects().length && getComputedStyle(el).visibility === 'visible');
  if (matches.length !== 1) return {clicked: false, reason: 'The chosen button is missing or no longer unique'};
  const el = matches[0];
  const label = (el.innerText || el.value || el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>document.getElementById(id)?.textContent||'').join(' ')).replace(/\s+/g, ' ').trim();
  // Best Buy's preorder starts its queue before fulfillment is offered.
  const bestBuyQueueEntry=rule?.store==='Best Buy'&&location.hostname==='www.bestbuy.com'&&/^pre[ -]?order(?: now)?$/i.test(label);
  if(rule&&!bestBuyQueueEntry&&!ensureFulfillment(rule,fulfillment,false).ready)return {clicked:false,retry:true,reason:'Fulfillment changed; waiting for the requested selection'};
  // The observed console preorder opens checkout ENTRY, not an order submission.
  // Keep this exception restricted to this product, control, label and endpoint.
  const amazonPreorder = rule?.store==='Amazon' && rule.productId==='B0HJ6F8L6V' && location.hostname==='www.amazon.com' && el.id==='buy-now-button' && el.name==='submit.buy-now' && /^pre-order now$/i.test(label) && el.getAttribute('formaction')==='/checkout/entry/buynow' && el.form?.getAttribute('action')?.startsWith('/gp/product/handle-buy-box/');
  const actionIdentity = [el.id, el.name, el.getAttribute('aria-label'), el.getAttribute('aria-description'), el.getAttribute('title'), el.getAttribute('data-action'), el.getAttribute('formaction'), el.getAttribute('href')].filter(Boolean).join(' ');
  if (!amazonPreorder && /buy[\s_-]*now|one[\s_-]*click|place[\s_-]*(?:your[\s_-]*)?order|checkout/i.test(actionIdentity)) return {clicked: false, reason: 'This control is identified as Buy Now or checkout, even if it says Pre-order. Please handle it manually.'};
  const physicalNintendo=rule?.store==='Nintendo' && location.hostname==='www.nintendo.com' && /^pre-purchase$/i.test(label) && el.tagName==='BUTTON' && !!el.querySelector('svg[data-testid="ShoppingCartIcon"]') && !el.form;
  if (!physicalNintendo && !/^(add to (cart|bag|basket)|pre[ -]?order(?: now|:\s*add to cart)?)(?:\s*[!+])?$/i.test(label)) return {clicked: false, reason: 'Chosen button is not an Add to cart or Pre-order button'};
  if (el.matches(':disabled') || el.closest('[aria-disabled="true"],[inert],[hidden]') || /(^|[\s_-])(disabled|unavailable|sold-out)([\s_-]|$)/i.test(el.className || '')) return {clicked: false, retry: true, reason: 'Button became unavailable'};
  // Refuse an observable quantity above one; never change quantity or checkout controls.
  const quantityControls = document.querySelectorAll('select[name*="quantity" i],input[name*="quantity" i],select[id*="quantity" i],input[id*="quantity" i],[role="spinbutton"]');
  for (const q of quantityControls) {
    const value = q.value ?? q.getAttribute('aria-valuenow');
    if (value && Number(value) !== 1) return {clicked: false, reason: 'Set the product quantity to 1 before resuming'};
  }
  if(rule?.store==='Nintendo') {
    const counters=[...document.querySelectorAll('button[aria-label="Subtract item"]')].filter(e=>e.getClientRects().length);
    const quantity=counters.length===1 ? counters[0].parentElement?.querySelector('[aria-live="polite"]')?.textContent?.trim() : '';
    if(quantity!=='1')return {clicked:false,reason:'Set the Nintendo product quantity to 1 before resuming'};
  }
  globalThis.__stockWatchAttempt = token;
  el.click();
  return {clicked: true};
}
function pickButton() {
  if (globalThis.__stockWatchPicker) return;
  globalThis.__stockWatchPicker = true;
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(15,50,70,.05)';
  const note = document.createElement('div');
  note.style.cssText = 'position:absolute;top:12px;left:12px;right:12px;padding:16px;background:#155e75;color:white;font:16px system-ui;border-radius:8px;pointer-events:none';
  note.textContent = 'Stock Watch: click the console purchase button (disabled is OK) to select it. This selection will not press it. Press Escape to cancel.';
  overlay.append(note); document.documentElement.append(overlay);
  function cleanup() { overlay.remove(); document.removeEventListener('keydown', escape, true); globalThis.__stockWatchPicker = false; }
  function escape(e) { if (e.key === 'Escape') { e.preventDefault(); cleanup(); } }
  document.addEventListener('keydown', escape, true);
  overlay.addEventListener('click', async e => {
    e.preventDefault(); e.stopImmediatePropagation();
    overlay.style.pointerEvents = 'none';
    const element = document.elementFromPoint(e.clientX, e.clientY);
    overlay.style.pointerEvents = 'auto';
    const button = element?.closest('button,input[type="submit"],input[type="button"],[role="button"],a');
    if (!button || button.getRootNode() !== document) { note.textContent = 'Select the product purchase button. Embedded frames and shadow buttons require manual setup. Escape cancels.'; return; }
    let selector = '';
    if (button.id && document.querySelectorAll('#' + CSS.escape(button.id)).length === 1) selector = '#' + CSS.escape(button.id);
    for (const attr of ['data-testid', 'data-test', 'data-test-id']) {
      if (selector || !button.getAttribute(attr)) continue;
      const candidate = button.tagName.toLowerCase() + '[' + attr + '=' + JSON.stringify(button.getAttribute(attr)) + ']';
      if (document.querySelectorAll(candidate).length === 1) selector = candidate;
    }
    if (!selector) for (const cls of button.classList) {
      if (!/add[-_]?to[-_]?cart|pre[-_]?order|purchase/i.test(cls)) continue;
      const candidate = button.tagName.toLowerCase() + '.' + CSS.escape(cls);
      if (document.querySelectorAll(candidate).length === 1) { selector = candidate; break; }
    }
    if (!selector) { note.textContent = 'This button has no stable unique identifier. Use the optional CSS selector in Stock Watch, or notification-only mode. Escape cancels.'; return; }
    const label = (button.innerText || button.value || button.getAttribute('aria-label') || '').trim();
    if (!/^(add to (cart|bag|basket)|pre[ -]?order(?: now)?|sold out|out of stock|unavailable|coming soon|currently unavailable)$/i.test(label)) { note.textContent = 'That does not look like a purchase or sold-out button. Choose the console purchase button. Escape cancels.'; return; }
    const result = await chrome.runtime.sendMessage({type: 'picked', selector});
    note.textContent = result?.ok ? 'Selected. Monitoring has started. Open Stock Watch to see its status.' : (result?.error || 'Could not save selection');
    setTimeout(cleanup, 2000);
  }, true);
}
function observeCart(token, baseline, rule = null) {
  let ticks = 0;
  const timer = setInterval(() => {
    const signals = cartSignals(rule), outcome = classifyCart(signals, baseline);
    if (outcome.state !== 'pending') { clearInterval(timer); chrome.runtime.sendMessage({type: 'cartResult', token, signals}).catch(() => {}); }
    else if (++ticks >= 25) clearInterval(timer);
  }, 1000);
}
if (typeof module !== 'undefined') module.exports = {classifyCart, clickPurchase, cartSignals};
