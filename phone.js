// Optional ntfy delivery. Its network queue is independent of stock/cart work.
const PhoneAlerts=(()=>{
  const alarm='phone:send',settingsKey='phoneSettings',queueKey='phoneQueue',statusKey='phoneStatus';
  const lifetime=120000;
  let edits=Promise.resolve(),sending=null,controller=null;
  const edit=fn=>{const result=edits.then(fn);edits=result.catch(()=>{});return result;};
  const read=()=>chrome.storage.local.get([settingsKey,queueKey]);
  const status=(state,message)=>({[statusKey]:{state,message,time:Date.now()}});
  async function arm(jobs) {
    if(jobs.length)await chrome.alarms.create(alarm,{when:Math.max(Date.now()+1000,Math.min(...jobs.map(j=>j.next)))});
    else await chrome.alarms.clear(alarm);
  }
  async function configure(enabled) {
    return edit(async()=>{
      const data=await read(),old=data[settingsKey]||{};
      if(enabled&&!(await chrome.permissions.contains({origins:['https://ntfy.sh/*']})))throw Error('Allow ntfy.sh access to enable phone alerts.');
      const topic=/^sw-[a-f0-9]{32}$/.test(old.topic||'')?old.topic:'sw-'+crypto.randomUUID().replace(/-/g,'');
      controller?.abort();
      const setting={enabled:!!enabled,topic};
      await chrome.storage.local.set({[settingsKey]:setting,[queueKey]:{jobs:[],recent:{}},...status(enabled?'ready':'off',enabled?'Enabled. Subscribe on your phone, then send a test.':'Phone alerts are off.')});
      await arm([]);return setting;
    });
  }
  function clip(text,max) {
    let result='',bytes=0;
    const encoder=new TextEncoder();
    for(const char of String(text||'')){bytes+=encoder.encode(char).length;if(bytes>max)break;result+=char;}
    return result;
  }
  async function enqueue(id,title,message,url='',test=false,eventId='') {
    const queued=await edit(async()=>{
      const data=await read(),config=data[settingsKey];
      if(!config?.enabled){if(test)throw Error('Enable phone alerts first.');return false;}
      if(!/^sw-[a-f0-9]{32}$/.test(config.topic))throw Error('Phone setup is invalid. Disable and enable phone alerts again.');
      const state=data[queueKey]||{jobs:[],recent:{}};
      // Identity, not a time window: a new desktop event can send immediately.
      const dedupe=eventId||JSON.stringify([id,title,message,url]);
      state.delivered=(state.delivered||[]).slice(-100);delete state.recent;
      if(!test&&(state.jobs.some(j=>j.dedupe===dedupe)||(eventId&&state.delivered.includes(dedupe))))return false;
      let click='';try{const u=new URL(url);if(u.protocol==='https:'&&!u.username&&!u.password){u.search='';u.hash='';if(u.href.length<700)click=u.href;}}catch{}
      const created=Date.now();
      const payload={topic:config.topic,title:clip(title,180),message:clip(message,1800)+'\nDetected '+new Date(created).toLocaleTimeString(),priority:4};
      if(click)payload.click=click;
      state.jobs=state.jobs.filter(j=>created-j.created<lifetime);
      if(state.jobs.length>=20)throw Error('Phone delivery queue is full. Check Phone alerts.');
      state.jobs.push({id:crypto.randomUUID(),dedupe,topic:config.topic,payload,created,next:created,attempts:0});
      await chrome.storage.local.set({[queueKey]:state,...status('queued','Phone alert queued; delivery is not yet confirmed.')});
      await arm(state.jobs);return true;
    });
    if(queued)wake();
    return queued;
  }
  async function flush() {
    if(sending)return sending;
    sending=(async()=>{
      while(true) {
        const job=await edit(async()=>{
          const data=await read(),config=data[settingsKey],state=data[queueKey]||{jobs:[],recent:{}};
          if(!config?.enabled){await arm([]);return null;}
          const before=state.jobs.length;
          state.jobs=state.jobs.filter(j=>j.topic===config.topic&&Date.now()-j.created<lifetime);
          if(state.jobs.length!==before)await chrome.storage.local.set({[queueKey]:state,...status('error','An old phone alert expired before delivery. Check the extension for current status.')});
          const due=state.jobs.find(j=>j.next<=Date.now());
          await arm(state.jobs);return due||null;
        });
        if(!job)break;
        const localController=new AbortController();
        const current=await edit(async()=>{
          const data=await read();
          if(!data[settingsKey]?.enabled||data[settingsKey].topic!==job.topic||!data[queueKey]?.jobs.some(j=>j.id===job.id))return false;
          controller=localController;return true;
        });
        if(!current)continue;
        let accepted=false,retry=true,message='',retryAfter=0;
        try {
          if(!(await chrome.permissions.contains({origins:['https://ntfy.sh/*']}))){retry=false;throw Error('Site access was removed. Enable phone alerts again.');}
          const timer=setTimeout(()=>localController.abort(),8000);
          try {
            const response=await fetch('https://ntfy.sh/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(job.payload),credentials:'omit',redirect:'error',signal:localController.signal});
            retry=response.status===429||response.status>=500;
            retryAfter=Number(response.headers.get('Retry-After'))*1000||0;
            if(!response.ok)throw Error(response.status===429?'ntfy rate limit reached.':`ntfy could not accept the alert (HTTP ${response.status}).`);
            const receipt=await response.json();
            if(receipt.event!=='message'||!receipt.id||receipt.topic!==job.topic){retry=false;throw Error('ntfy returned an unexpected response.');}
            accepted=true;message='ntfy accepted the alert. Confirm it appeared on your phone.';
          }finally{clearTimeout(timer);if(controller===localController)controller=null;}
        }catch(e){message=e.name==='AbortError'?'Phone alert timed out.':(e.message==='Failed to fetch'?'Phone alert could not connect to ntfy.':e.message);}
        await edit(async()=>{
          const data=await read(),config=data[settingsKey],state=data[queueKey]||{jobs:[],recent:{}};
          const index=state.jobs.findIndex(j=>j.id===job.id);
          if(index<0||!config?.enabled||config.topic!==job.topic)return;
          const next=Date.now()+Math.max(job.attempts===0?10000:30000,retryAfter);
          if(accepted)state.delivered=[...(state.delivered||[]),job.dedupe].slice(-100);
          if(accepted||!retry||job.attempts>=2||next-job.created>=lifetime)state.jobs.splice(index,1);
          else {state.jobs[index]={...job,next,attempts:job.attempts+1};message+=' Will retry.';}
          await chrome.storage.local.set({[queueKey]:state,...status(accepted?'accepted':'error',message)});
          await arm(state.jobs);
        });
      }
    })().finally(()=>{sending=null;});
    return sending;
  }
  function wake(){void flush().catch(()=>chrome.storage.local.set(status('error','Phone delivery stopped. Check the connection, then send a test.')).catch(()=>{}));}
  return {configure,enqueue,flush,wake,alarm};
})();
