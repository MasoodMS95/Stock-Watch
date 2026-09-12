/* Also exported for local checks. This function is self-contained for injection. */
function inspectStock(selector = '', rule = null) {
  const roots = [document];
  const candidates = [];
  for (let i = 0; i < roots.length; i++) {
    const root = roots[i];
    if(!selector)for (const el of root.querySelectorAll('*')) if (el.shadowRoot) roots.push(el.shadowRoot);
    candidates.push(...root.querySelectorAll(selector || 'button, [role="button"], input[type="submit"], input[type="button"], a'));
  }
  let found = null;
  for (const el of candidates) {
    const style = getComputedStyle(el);
    if (!el.getClientRects().length || style.visibility !== 'visible' || style.display === 'none' || Number(style.opacity) === 0) continue;
    if (el.matches(':disabled') || el.closest('[inert], [aria-disabled="true"], [hidden]') || el.getAttribute('aria-disabled') === 'true' || /(^|[\s_-])(disabled|unavailable|sold-out)([\s_-]|$)/i.test(el.className || '')) continue;
    const label = (el.innerText || el.value || el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>document.getElementById(id)?.textContent||'').join(' ')).replace(/\s+/g, ' ').trim();
    const physicalNintendo = rule?.store==='Nintendo' && /^pre-purchase$/i.test(label) && el.tagName==='BUTTON' && !!el.querySelector('svg[data-testid="ShoppingCartIcon"]');
    if (physicalNintendo || /^(add to (cart|bag|basket)|pre[ -]?order(?: now|:\s*add to cart)?)(?:\s*[!+])?$/i.test(label)) {
      if (found) return {found: false, ambiguous: true};
      found = {found: true, label};
    }
  }
  return found || {found: false};
}
if (typeof module !== 'undefined') module.exports = {inspectStock};
