// Recheck saved user intent inside the page immediately before a side effect.
// A delayed injection from an older command cannot act after Pause or Resume.
async function performPageAction(action,args,permit) {
  const denied={clicked:false,ready:false,cancelled:true,reason:'Watch control changed before the page action'};
  if(!permit||Date.now()>permit.deadline)return denied;
  const key='watch:'+permit.id;
  const w=(await chrome.storage.local.get(key))[key];
  if(!w||w.userPaused||(w.controlVersion||0)!==permit.version||Date.now()>permit.deadline)return denied;
  if(action==='fulfillment') {
    const current=productRule(location.href),expected=productRule(permit.url);
    if(!current||!expected||current.store!==expected.store||current.productId!==expected.productId)return denied;
  }
  if(permit.token) {if(!w.pending||w.token!==permit.token)return denied;}
  else if(!(action==='bestBuyClose'&&permit.allowRejection&&w.rule?.store==='Best Buy'&&w.alertBatch)&&(w.paused||w.pending||w.alertPaused))return denied;
  if(w.rule?.store==='Amazon'&&['purchase','amazonCheckout'].includes(action)&&inspectAmazonVerification(w.rule.productId).blocked)
    return {clicked:false,ready:false,reason:'amazonVerification'};
  if(action==='purchase')return clickPurchase(...args);
  if(action==='fulfillment')return ensureFulfillment(...args);
  if(action==='amazonCheckout')return inspectAmazonPage(...args);
  if(action==='nintendoCheckout'&&w.rule?.store==='Nintendo'&&w.rule?.mode==='cart')return inspectNintendoCart(...args);
  if(action==='nintendoPassword'&&w.rule?.store==='Nintendo'&&w.rule?.mode==='cart'&&w.nintendoAutoPassword&&w.nintendoRecoveryArmed)return clickNintendoAutofilledPassword(...args);
  // A terminal Best Buy rejection may be dismissed during its alert pause.
  if(action==='bestBuyClose')return bestBuySoldOut(...args);
  return denied;
}
if(typeof module!=='undefined')module.exports={performPageAction};
