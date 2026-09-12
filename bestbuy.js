// Only the observed product-specific rejection modal may be dismissed.
function bestBuySoldOut(rule, expectedUrl, dismiss = false) {
  if(rule?.store!=='Best Buy'||!/^\d+$/.test(rule.productId)||location.hostname!=='www.bestbuy.com'||location.href.split('#')[0]!==expectedUrl.split('#')[0])return {unavailable:false};
  const visible=e=>!!e&&e.getClientRects().length&&getComputedStyle(e).visibility==='visible';
  const id=rule.productId;
  const modal=document.querySelector(`[data-testid="pdp-gated-purchase-failure-modal-container-${id}"]`);
  const rejection=t=>/not added to your cart/i.test(t)&&/no longer available|currently unavailable for online purchase/i.test(t);
  if(visible(modal)) {
    const heading=modal.querySelector(`[data-testid="pdp-gated-purchase-failure-modal-header-${id}"]`);
    if(!visible(heading)||!/^sold out$/i.test(heading.innerText.trim())||!rejection(modal.innerText))return {unavailable:false};
    if(dismiss) {
      const close=modal.querySelector(`[data-testid="pdp-gated-purchase-failure-modal-primary-button-${id}"]`);
      if(!visible(close)||close.matches(':disabled')||close.getAttribute('aria-disabled')==='true'||close.innerText.trim()!=='Close')return {unavailable:true,modal:true,error:'The sold-out popup has no usable Close button'};
      close.click();
    }
    return {unavailable:true,modal:true};
  }
  const error=document.querySelector('[data-testid="limit-error-alert"]');
  return {unavailable:visible(error)&&rejection(error.innerText),modal:false};
}
if(typeof module!=='undefined')module.exports={bestBuySoldOut};
