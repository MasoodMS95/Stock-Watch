(()=>{
  const node=id=>document.getElementById(id);let busy=false,enabled=true;
  function render(state={}) {
    enabled=state.enabled!==false;node('diagnostic-toggle').textContent=enabled?'Stop logging':'Enable logging';
    node('diagnostic-state').textContent=state.error?'Logging error: '+state.error:enabled?'Logging on'+(state.lastEvent?' · Last entry '+new Date(state.lastEvent).toLocaleTimeString():''):'Logging off';
  }
  async function command(type,extra={}) {
    if(busy)return;busy=true;for(const id of ['diagnostic-toggle','diagnostic-export','diagnostic-clear'])node(id).disabled=true;
    let timer;node('diagnostic-feedback').textContent='';
    try {
      const result=await Promise.race([chrome.runtime.sendMessage({type,...extra}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('The diagnostic command did not finish. Try again after checking the watch status.')),15000);})]);
      if(!result?.ok)throw Error(result?.error||'Could not reach the watcher.');
      if(type==='diagnosticExport') {
        const blob=new Blob([JSON.stringify(result.report,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
        link.href=url;link.download='stock-watch-log-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
        node('diagnostic-feedback').textContent='Report exported. '+(result.report.analysis?.summary||'');
      }else if(type==='diagnosticClear')node('diagnostic-feedback').textContent='Started a fresh log. Watch settings were preserved.';
      else render({enabled:extra.enabled});
    }catch(e){node('diagnostic-feedback').textContent=e.message;}
    finally{clearTimeout(timer);busy=false;for(const id of ['diagnostic-toggle','diagnostic-export','diagnostic-clear'])node(id).disabled=false;}
  }
  node('diagnostic-toggle').onclick=()=>command('diagnosticConfigure',{enabled:!enabled});
  node('diagnostic-export').onclick=()=>command('diagnosticExport');
  node('diagnostic-clear').onclick=()=>command('diagnosticClear');
  chrome.storage.local.get('diagnosticStatus').then(data=>render(data.diagnosticStatus));
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.diagnosticStatus)render(changes.diagnosticStatus.newValue);});
})();
