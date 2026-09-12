// Local DOM checks only: this timer does not reload or make store requests.
// It catches controls that appear after a site's client-side rendering finishes.
function observeAvailability(expectedUrl, rule, selector) {
  clearInterval(globalThis.__stockAvailabilityTimer);
  let previous='';
  let currentRule=rule;
  globalThis.__stockAvailabilityTimer=setInterval(()=>{
    if(location.href.split('#')[0]!==expectedUrl.split('#')[0]) {
      clearInterval(globalThis.__stockAvailabilityTimer);return;
    }
    try {
      if(currentRule?.needsSku)currentRule=resolveBestBuyRule(currentRule);
      const control=selector || resolveProductButton(currentRule).selector;
      const stock=control ? inspectStock(control,currentRule) : null;
      const gate=pageAttention();
      const rejected=currentRule?.store==='Best Buy'?bestBuySoldOut(currentRule,expectedUrl):null;
      const nintendoCart=currentRule?.store==='Nintendo'&&currentRule?.mode==='cart'?inspectNintendoCart():null;
      const state=nintendoCart?'Nintendo cart '+nintendoCart.state+' '+(nintendoCart.product||''):rejected?.unavailable?'Best Buy sold out '+!!rejected.modal:gate ? JSON.stringify(gate) : stock?.found ? stock.label : '';
      if(state && state!==previous)chrome.runtime.sendMessage({type:'scanDue'}).catch(()=>clearInterval(globalThis.__stockAvailabilityTimer));
      previous=state;
    }catch {clearInterval(globalThis.__stockAvailabilityTimer);}
  },rule?.store==='Nintendo'&&rule?.mode==='cart'?250:1000);
}
