const phoneElement=id=>document.getElementById(id);
let phoneBusy=false;
async function renderPhone() {
  const {phoneSettings,phoneStatus}=await chrome.storage.local.get(['phoneSettings','phoneStatus']);
  phoneElement('phone-toggle').textContent=phoneSettings?.enabled?'Disable phone alerts':'Enable phone alerts';
  phoneElement('phone-toggle').disabled=phoneBusy;
  phoneElement('phone-test').disabled=phoneBusy||!phoneSettings?.enabled;
  phoneElement('phone-topic').value=phoneSettings?.topic||'';
  phoneElement('phone-copy').disabled=!phoneSettings?.topic;
  phoneElement('phone-state').textContent=phoneStatus?phoneStatus.message+' ('+new Date(phoneStatus.time).toLocaleTimeString()+')':'Phone alerts are off.';
}
async function phoneAction(fn) {
  if(phoneBusy)return;phoneBusy=true;
  try{await fn();}catch(e){phoneElement('phone-feedback').textContent=e.message;}
  finally{phoneBusy=false;await renderPhone();}
}
phoneElement('phone-toggle').onclick=()=>phoneAction(async()=>{
  phoneElement('phone-feedback').textContent='';
  // Request within the click gesture, before any storage round trip.
  const enabling=phoneElement('phone-toggle').textContent==='Enable phone alerts';
  if(enabling&&!(await chrome.permissions.request({origins:['https://ntfy.sh/*']})))throw Error('Allow ntfy.sh access to enable phone alerts.');
  const result=await chrome.runtime.sendMessage({type:'phoneConfigure',enabled:enabling});
  if(!result?.ok)throw Error(result?.error||'Could not change phone settings.');
});
phoneElement('phone-test').onclick=()=>phoneAction(async()=>{
  const result=await chrome.runtime.sendMessage({type:'phoneTest'});
  if(!result?.ok)throw Error(result?.error||'Could not queue the phone test.');
  phoneElement('phone-feedback').textContent='Test queued. Look for “Stock Watch phone test” on your phone.';
});
phoneElement('phone-copy').onclick=async()=>{
  try{await navigator.clipboard.writeText(phoneElement('phone-topic').value);phoneElement('phone-feedback').textContent='Topic copied. Subscribe to this exact topic on your phone.';}
  catch{phoneElement('phone-topic').select();phoneElement('phone-feedback').textContent='Select and copy this topic, then subscribe on your phone.';}
};
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&(changes.phoneSettings||changes.phoneStatus))void renderPhone();});
void renderPhone();
