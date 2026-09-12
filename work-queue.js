// One page operation at a time; user controls interrupt checks and run first.
function createWorkQueue() {
  const controls=[],checks=[],waiting=new Map(),idleWaiters=[];
  let active=null,pumping=false;
  const cancelled=()=>!!active?.abort.signal.aborted;
  const cancellation=()=>Object.assign(Error('Interrupted by a watch control'),{name:'WatchInterrupted'});
  async function pump() {
    if(pumping)return;pumping=true;
    while(controls.length||checks.length) {
      const task=controls.shift()||checks.shift();
      if(task.key)waiting.delete(task.key);
      active={...task,started:Date.now(),abort:new AbortController()};
      try {task.resolve(await task.fn());}
      catch(e){if(e.name!=='WatchInterrupted')console.error(e);task.resolve();}
      active=null;
    }
    pumping=false;for(const resolve of idleWaiters.splice(0))resolve();
  }
  function enqueue(fn,{control=false,key=''}={}) {
    if(control&&active&&!active.control)active.abort.abort();
    if(key&&waiting.has(key)){waiting.get(key).fn=fn;return waiting.get(key).promise;}
    let resolve;const promise=new Promise(r=>{resolve=r;});
    const task={fn,control,key,promise,resolve};
    (control?controls:checks).push(task);if(key)waiting.set(key,task);
    void pump();return promise;
  }
  function guard(promise,ms=5000) {
    const signal=active?.abort.signal;
    if(signal?.aborted){Promise.resolve(promise).catch(()=>{});return Promise.reject(cancellation());}
    return new Promise((resolve,reject)=>{
      let timer;
      const clean=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
      const abort=()=>{clean();reject(cancellation());};
      signal?.addEventListener('abort',abort,{once:true});
      timer=setTimeout(()=>{clean();reject(Object.assign(Error('The page did not respond in time'),{name:'PageTimeout'}));},ms);
      Promise.resolve(promise).then(value=>{clean();resolve(value);},error=>{clean();reject(error);});
    });
  }
  return {enqueue,guard,cancelled,isControl:()=>!!active?.control,snapshot:()=>({active:active?.key||active?.fn?.name||'',control:!!active?.control,started:active?.started||0,waiting:controls.length+checks.length}),idle:()=>pumping?new Promise(r=>idleWaiters.push(r)):Promise.resolve()};
}
if(typeof module!=='undefined')module.exports={createWorkQueue};
