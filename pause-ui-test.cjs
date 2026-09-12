const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
(async()=>{
  const source=fs.readFileSync(__dirname+'/popup.js','utf8');
  const elements=new Map();
  const node=id=>{if(!elements.has(id))elements.set(id,{textContent:'',disabled:false,hidden:false});return elements.get(id);};
  let reject=true,calls=0;
  const watches=[{kind:'watch',paused:true,autoCart:false}];
  const context=vm.createContext({document:{getElementById:node},confirm:()=>true,setTimeout,clearTimeout,
    chrome:{runtime:{getManifest:()=>({version:'test'}),sendMessage:async()=>{calls++;if(reject)return {ok:false,error:'A cart attempt is still being checked.'};watches[0].paused=false;return {ok:true};}},storage:{local:{get:async()=>({one:watches[0]})}}},
    render:async()=>vm.runInContext('updateBulkControls(testWatches)',context),testWatches:watches});
  vm.runInContext(source.slice(0,source.indexOf("chrome.storage.local.get('automaticSwitching')"))+
    source.slice(source.indexOf('async function send('),source.indexOf('function intervalValue(')),context);
  await node('pause-all').onclick();
  assert.equal(calls,1);assert.equal(node('pause-all').disabled,false,'failed Resume leaves button usable');
  assert.match(node('message').textContent,/cart attempt/);
  assert.equal(node('pause-all').textContent,'Resume all watches');
  reject=false;await node('pause-all').onclick();
  assert.equal(calls,2);assert.equal(node('pause-all').disabled,false);
  assert.equal(node('pause-all').textContent,'Pause all watches');
  watches[0]={kind:'watch',paused:true,pending:true,userPaused:false};await context.render();
  assert.equal(node('pause-all').textContent,'Pause all watches','a cart check is running even while refresh is protected');
  watches[0].userPaused=true;await context.render();assert.equal(node('pause-all').textContent,'Resume all watches');
  console.log('PASS: rejected bulk resume shows error, re-enables button, and succeeds on retry');
})().catch(e=>{console.error(e);process.exitCode=1;});
