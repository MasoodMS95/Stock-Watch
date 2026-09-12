const $ = id => document.getElementById(id);
$('loaded-version').textContent='Loaded version '+chrome.runtime.getManifest().version;
let bulkBusy=false;
$('pause-all').onclick = () => act(async () => {
  if(bulkBusy)return;
  const watches=Object.values(await chrome.storage.local.get(null)).filter(w=>w?.kind==='watch');
  const resume=watches.some(w=>w.userPaused||(w.paused&&!w.pending));
  if(resume&&watches.some(w=>w.autoCart&&(w.found||(w.attention&&(!w.amazonVerification||w.amazonVerificationReview))))&&!confirm('Check your carts first. Resuming can attempt another addition. Continue?'))return;
  bulkBusy=true;$('pause-all').disabled=true;$('message').textContent=resume?'Resuming paused watches…':'Pausing watches…';
  try {await send({type:resume?'resumeAll':'pauseAll'});}finally{bulkBusy=false;}
});
$('pause-running').onclick=()=>act(async()=>{
  if(bulkBusy)return;bulkBusy=true;
  try{await send({type:'pauseAll'});}finally{bulkBusy=false;}
});
function updateBulkControls(watches) {
  const paused=watches.filter(w=>w.userPaused||(w.paused&&!w.pending)).length,running=watches.length-paused;
  $('pause-all').textContent=paused?(running?`Resume paused watches (${paused})`:'Resume all watches'):'Pause all watches';
  $('pause-all').disabled=bulkBusy||!watches.length;
  $('pause-running').hidden=!(paused&&running);
  $('pause-running').disabled=bulkBusy;
  $('watch-counts').textContent=watches.length?`${running} running · ${paused} paused`:'No watches';
}
chrome.storage.local.get('automaticSwitching').then(({automaticSwitching=true}) => { $('automatic-switching').checked=automaticSwitching; });
$('automatic-switching').onchange = () => act(async () => {
  await chrome.storage.local.set({automaticSwitching:$('automatic-switching').checked});
});
async function send(message) {
  let timer;
  const result = await Promise.race([chrome.runtime.sendMessage(message),new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(Error('The watcher has not confirmed this command. Check the watch status before trying again.')),15000);
  })]).finally(()=>clearTimeout(timer));
  if (!result?.ok) throw Error(result?.error || 'Could not reach the stock watcher.');
  if(result.message)$('message').textContent=result.message;
}
async function act(fn) {
  $('message').textContent = '';
  try { await fn(); }
  catch (e) { $('message').textContent = e.message; }
  finally { await render(); }
}
function intervalValue(amount = $('amount').value, unit = $('unit').value) {
  const value = Number(amount) * Number(unit);
  if (!Number.isFinite(value) || value <= 0 || value*1000>Number.MAX_SAFE_INTEGER-Date.now()) throw Error('Enter a positive interval in seconds or minutes.');
  return value;
}
$('save-default').onclick = () => act(async () => {
  await chrome.storage.local.set({defaultInterval: intervalValue()}); $('message').textContent = 'Default interval saved.';
});
async function configure(pick) {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  if (!tab?.url || !/^https?:/.test(tab.url)) throw Error('Open a store product page first.');
  if($('fulfillment').value==='delivery'&&new URL(tab.url).hostname.replace(/^www\./,'')!=='walmart.com')throw Error('Delivery is supported for Walmart product watches only');
  const selector = $('selector').value.trim();
  if (selector) { try { document.querySelector(selector); } catch { throw Error('That CSS selector is invalid.'); } }
  const origin = new URL(tab.url).origin + '/*';
  if (!(await chrome.permissions.request({origins: [origin]}))) throw Error('Site access is needed to check this tab.');
  const interval = intervalValue();
  const nintendoAutoPassword=$('nintendo-auto-password')?.checked===true&&new URL(tab.url).hostname==='www.nintendo.com'&&/^\/us\/cart\/?$/.test(new URL(tab.url).pathname);
  if(nintendoAutoPassword&&!(await chrome.permissions.request({origins:['https://accounts.nintendo.com/*']})))throw Error('Nintendo password confirmation needs account-page access. Leave that option off to enter it manually.');
  await send({type: pick ? 'pick' : 'add', id: tab.id, interval, selector, autoCart: $('auto-cart').checked, fulfillment:$('fulfillment').value,nintendoAutoPassword});
  if(!pick)$('message').textContent='Watch added. Its current status appears below.';
  if (pick) window.close();
}
$('add').onclick = () => act(() => configure(false));
$('pick').onclick = () => act(() => configure(true));
for (const [name, url] of STORES) {
  const a = document.createElement('a'); a.textContent = name; a.href = url; a.target = '_blank'; a.rel = 'noreferrer'; $('stores').append(a);
}
$('open-all').onclick = () => act(async () => {
  const tabs = await chrome.tabs.query({});
  for (const [, url] of STORES) if (!tabs.some(t => t.url === url)) await chrome.tabs.create({url, active: false});
});
$('test').onclick = () => act(() => send({type: 'test'}));
const watchList=createWatchList({container:$('list'),run:act,send,intervalValue,confirm,returnToProduct:async w=>{
  await send({type:'pause',id:w.id});
  await chrome.tabs.update(w.id,{url:w.url,active:true});
}});
let renderGeneration=0;
async function render() {
  const generation=++renderGeneration;
  const data=await chrome.storage.local.get(null);
  if(generation!==renderGeneration)return;
  const watches=Object.values(data).filter(w=>w?.kind==='watch');
  updateBulkControls(watches);watchList.update(watches);
}
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area&&area!=='local')return;
  if(changes?.automaticSwitching)$('automatic-switching').checked=changes.automaticSwitching.newValue!==false;
  void render();
});
chrome.storage.local.get('defaultInterval').then(({defaultInterval = 120}) => {
  $('unit').value = defaultInterval % 60 === 0 ? '60' : '1'; $('amount').value = defaultInterval / Number($('unit').value); render();
});
