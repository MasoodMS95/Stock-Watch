// Separate from watch settings so frequent watch reads never load the log.
function createDiagnosticStore(name='stock-watch-diagnostics') {
  let opening;
  function open() {
    if(opening)return opening;
    opening=new Promise((resolve,reject)=>{
      const request=indexedDB.open(name,1);
      request.onupgradeneeded=()=>{
        const db=request.result;
        for(const store of ['events','incidents'])db.createObjectStore(store,{keyPath:'id',autoIncrement:true});
        db.createObjectStore('meta');
      };
      request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();opening=null;};resolve(request.result);};
      request.onerror=()=>{opening=null;reject(request.error);};
      request.onblocked=()=>{opening=null;reject(Error('Diagnostic database is blocked by another extension page'));};
    });return opening;
  }
  async function transaction(names,mode,fn) {
    const db=await open();return new Promise((resolve,reject)=>{
      const tx=db.transaction(names,mode);let value;
      tx.oncomplete=()=>resolve(typeof value==='function'?value():value);
      tx.onerror=tx.onabort=()=>reject(tx.error||Error('Diagnostic storage transaction failed'));
      try{value=fn(tx);}catch(e){tx.abort();reject(e);}
    });
  }
  return {
    async append(event,important) {
      const name=important?'incidents':'events',limit=important?500:6000;
      return transaction([name],'readwrite',tx=>{
        const store=tx.objectStore(name),added=store.add(event),count=store.count();
        count.onsuccess=()=>{
          let excess=Math.max(0,count.result-limit);
          store.openCursor().onsuccess=e=>{const cursor=e.target.result;if(!cursor)return;
            if(excess>0||cursor.value.time<event.time-48*3600000){cursor.delete();excess=Math.max(0,excess-1);cursor.continue();}
          };
        };return ()=>({store:name,id:added.result});
      });
    },
    async attach(ref,snapshot) {return transaction([ref.store],'readwrite',tx=>{const store=tx.objectStore(ref.store),get=store.get(ref.id);get.onsuccess=()=>{if(get.result)store.put({...get.result,snapshot});};});},
    async getMeta(key) {return transaction(['meta'],'readonly',tx=>{const request=tx.objectStore('meta').get(key);return ()=>request.result;});},
    async setMeta(key,value) {return transaction(['meta'],'readwrite',tx=>{tx.objectStore('meta').put(value,key);});},
    async read() {return transaction(['events','incidents'],'readonly',tx=>{const a=tx.objectStore('events').getAll(),b=tx.objectStore('incidents').getAll();return ()=>[...a.result,...b.result].sort((x,y)=>x.time-y.time);});},
    async clear() {return transaction(['events','incidents','meta'],'readwrite',tx=>{for(const n of ['events','incidents','meta'])tx.objectStore(n).clear();});}
  };
}
if(typeof module!=='undefined')module.exports={createDiagnosticStore};
