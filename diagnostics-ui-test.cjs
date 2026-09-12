const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const nodes=Object.fromEntries(['diagnostic-toggle','diagnostic-export','diagnostic-clear','diagnostic-state','diagnostic-feedback'].map(id=>[id,{disabled:false,textContent:''}]));
let response={ok:true,report:{events:[],analysis:{summary:'No incidents'}}},download,blob,timeout;
const ctx=vm.createContext({Date,Blob,URL:{createObjectURL:b=>{blob=b;return 'blob:test';},revokeObjectURL:()=>{}},setTimeout:(fn,ms)=>{if(ms===15000)timeout=fn;return 1;},clearTimeout:()=>{},document:{getElementById:id=>nodes[id],body:{append:()=>{}},createElement:()=>({click(){download=this.download;},remove(){}})},chrome:{runtime:{sendMessage:()=>response===null?new Promise(()=>{}):Promise.resolve(response)},storage:{local:{get:async()=>({diagnosticStatus:{enabled:true}})},onChanged:{addListener:()=>{}}}}});
vm.runInContext(fs.readFileSync(__dirname+'/diagnostics-ui.js','utf8'),ctx);
(async()=>{
  await nodes['diagnostic-export'].onclick();assert.match(download,/^stock-watch-log-.*\.json$/);assert.deepEqual(JSON.parse(await blob.text()).events,[]);assert.match(nodes['diagnostic-feedback'].textContent,/Report exported/);
  response={ok:false,error:'Storage failure'};await nodes['diagnostic-clear'].onclick();assert.equal(nodes['diagnostic-feedback'].textContent,'Storage failure');assert.equal(nodes['diagnostic-clear'].disabled,false);
  response=null;const pending=nodes['diagnostic-export'].onclick();timeout();await pending;assert.match(nodes['diagnostic-feedback'].textContent,/did not finish/);assert.equal(nodes['diagnostic-export'].disabled,false);
  response={ok:true};await nodes['diagnostic-toggle'].onclick();assert.equal(nodes['diagnostic-toggle'].textContent,'Enable logging');
  console.log('PASS: diagnostic export file, failed commands, timeout recovery and logging toggle');
})().catch(e=>{console.error(e);process.exitCode=1;});
