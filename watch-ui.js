// Keep each watch's controls alive while its status changes. Button handlers
// read the latest watch, not the snapshot that originally created the row.
function createWatchList({container,run,send,intervalValue,confirm,returnToProduct}) {
  const rows=new Map();
  const element=(tag,text='')=>{const e=document.createElement(tag);e.textContent=text;return e;};
  function controls(r) {
    const w=r.watch;
    r.toggle.textContent=w.userPaused||(w.paused&&!w.pending)?'Resume':'Pause';
    r.toggle.disabled=r.busy;
    r.remove.disabled=r.busy||!!w.pending;
    r.open.disabled=r.busy||!!w.pending;
    r.fulfillment.disabled=r.busy||!!w.pending;
    r.save.disabled=r.busy;
  }
  async function action(r,fn) {
    if(r.busy)return;r.busy=true;controls(r);
    try{await run(fn);}finally{r.busy=false;r.fulfillment.value=r.watch.fulfillment||(new URL(r.watch.url).hostname==='www.bestbuy.com'?'pickup':'shipping');controls(r);}
  }
  function create(w) {
    const r={watch:w,busy:false,dirty:false,interval:undefined};
    r.row=element('article');r.title=element('strong');r.status=element('p');
    r.checked=element('small');r.refreshed=element('small');
    r.details=element('details');r.details.append(element('summary','Settings & details'));
    r.saved=element('p');r.observed=element('p');r.open=element('button','Return to product page');r.open.className='secondary';
    r.history=element('div');r.flags=element('p');
    r.recovery=element('p');r.recovery.hidden=true;
    r.details.append(r.recovery,r.saved,r.observed,r.open,r.history,r.flags);
    r.toggle=element('button');r.remove=element('button','Remove');r.toggle.className=r.remove.className='secondary';
    r.toggle.onclick=()=>action(r,async()=>{
      const current=r.watch,type=current.userPaused||(current.paused&&!current.pending)?'resume':'pause';
      if(type==='resume'&&current.autoCart&&(current.found||(current.attention&&(!current.amazonVerification||current.amazonVerificationReview)))&&!confirm('Check your cart first. Resuming can attempt another addition. Continue?'))return;
      await send({type,id:current.id});
    });
    r.remove.onclick=()=>action(r,()=>send({type:'remove',id:r.watch.id}));
    r.open.onclick=()=>action(r,()=>returnToProduct(r.watch));
    r.editor=element('div');r.editor.className='interval';r.amount=element('input');r.amount.type='number';r.amount.min='0';r.amount.step='any';
    r.unit=element('select');
    for(const [name,value] of [['Seconds',1],['Minutes',60]]){const o=element('option',name);o.value=value;r.unit.append(o);}
    r.amount.oninput=r.unit.onchange=()=>{r.dirty=true;};
    r.save=element('button','Save');r.save.onclick=()=>action(r,async()=>{
      await send({type:'interval',id:r.watch.id,interval:intervalValue(r.amount.value,r.unit.value)});r.dirty=false;
    });
    r.editor.append(r.amount,r.unit,r.save);
    r.fulfillment=element('select');
    for(const [name,value] of [['Pickup at saved store','pickup'],['Shipping','shipping']]){const o=element('option',name);o.value=value;r.fulfillment.append(o);}
    r.delivery=element('option','Delivery');r.delivery.value='delivery';r.fulfillment.append(r.delivery);
    r.fulfillment.onchange=()=>action(r,()=>send({type:'fulfillment',id:r.watch.id,fulfillment:r.fulfillment.value}));
    r.details.append(r.editor,r.fulfillment);
    r.row.append(r.title,r.status,r.checked,r.refreshed,r.toggle,r.remove,r.details);
    return r;
  }
  function update(watches) {
    for(const [id,r] of rows)if(!watches.some(w=>w.id===id)){r.row.remove();rows.delete(id);}
    if(!watches.length){container.textContent='No products watched yet. Open a product tab, then click Watch this page above.';return;}
    if(!rows.size)container.replaceChildren();
    for(const w of watches) {
      let r=rows.get(w.id);if(!r){r=create(w);rows.set(w.id,r);container.append(r.row);}
      r.watch=w;r.title.textContent=w.title;r.status.textContent=w.status;
      if(w.amazonVerification&&!r.verification)r.details.open=true;
      r.verification=!!w.amazonVerification;r.recovery.hidden=!r.verification;
      r.recovery.textContent=w.amazonVerificationReview?'Amazon interrupted a cart attempt. Resolve its verification, open the saved product, then Resume. The existing cart will be checked before another addition.':'Complete Amazon’s Continue shopping check in its tab. If it keeps looping, leave this watch paused. Once Amazon works, open the saved product below and click Resume.';
      r.open.textContent=r.verification?'Open saved Amazon product':'Return to product page';
      let host='';try{host=new URL(w.url).hostname;}catch{}
      r.checked.textContent=`${host} · ${w.autoCart?(w.rule?.store==='Nintendo'&&w.rule?.mode==='cart'?'Open secure checkout':'Add to cart'):'Notify only'} · ${w.checked?'Checked '+new Date(w.checked).toLocaleTimeString():'Not checked yet'}`;
      r.refreshed.textContent=w.lastReload?`Reloaded ${new Date(w.lastReload).toLocaleTimeString()} · ${w.reloadCount||0} reloads`:'No automatic reload yet';
      r.saved.textContent='Saved product page: '+w.url;
      r.observed.textContent=w.currentUrl?'Last observed page: '+w.currentUrl:'';
      r.flags.textContent=`Manual pause: ${w.userPaused?'yes':'no'} · Alert pause: ${w.alertPaused?'yes':'no'} · Cart check pending: ${w.pending?'yes':'no'}`;
      r.history.replaceChildren(...(w.history||[]).map(event=>element('p',new Date(event.time).toLocaleTimeString()+' — '+event.status)));
      r.amount.setAttribute('aria-label','Refresh amount for '+w.title);r.unit.setAttribute('aria-label','Refresh unit for '+w.title);
      if(!r.dirty&&r.interval!==w.interval){r.unit.value=w.interval%60===0?'60':'1';r.amount.value=w.interval/Number(r.unit.value);r.interval=w.interval;}
      r.fulfillment.setAttribute('aria-label','Fulfillment for '+w.title);
      r.delivery.hidden=r.delivery.disabled=host.replace(/^www\./,'')!=='walmart.com';
      if(!r.busy)r.fulfillment.value=w.fulfillment||(host==='www.bestbuy.com'?'pickup':'shipping');
      controls(r);
    }
  }
  return {update};
}
if(typeof module!=='undefined')module.exports={createWatchList};
