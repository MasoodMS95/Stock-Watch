// Called inside the worker's serialized refresh queue: one foreground tab at a time.
async function foregroundForRefresh(id, stopped = () => false, waitMs = 750) {
  const tabs=typeof browserTabs==='undefined'?chrome.tabs:browserTabs;
  const {automaticSwitching = true} = await chrome.storage.local.get('automaticSwitching');
  if (!automaticSwitching) return false;
  // Let the user finish verification without switching away underneath them.
  const active = await tabs.query({active:true});
  const watches = await all();
  if(stopped())return false;
  const activeBestBuy=active.find(tab=>watches.some(w=>w.id===tab.id&&w.rule?.store==='Best Buy'));
  if(activeBestBuy&&typeof protectBestBuyQueues==='function'&&await protectBestBuyQueues(activeBestBuy.id))return false;
  if (active.some(tab => watches.some(w => w.id === tab.id && w.botActive))) return false;
  if(stopped())return false;
  const tab = await tabs.update(id, {active:true});
  if(stopped())return false;
  const focus=chrome.windows.update(tab.windowId, {focused:true});
  await (typeof work==='undefined'?focus:work.guard(focus,2000));
  await foregroundWait(waitMs,stopped);
  return !stopped();
}
async function foregroundWait(ms,stopped) {
  for(let elapsed=0;elapsed<ms;elapsed+=250) {
    if(stopped())return;
    await new Promise(resolve=>setTimeout(resolve,Math.min(250,ms-elapsed)));
  }
}
async function settleForeground(id, stopped = () => false) {
  const tabs=typeof browserTabs==='undefined'?chrome.tabs:browserTabs;
  // Allow client-side rendering after the document load, with a bounded wait.
  for (let step=0; step<5; step++) {
    await foregroundWait(1500,stopped);
    if(stopped())return;
    const tab = await tabs.get(id);
    if (!tab.active) return;
    if (tab.status === 'complete') {
      await foregroundWait(1000,stopped);
      return;
    }
  }
}
