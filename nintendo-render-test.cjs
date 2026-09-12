const assert=require('node:assert/strict');const {harness}=require('./control-audit-test.cjs');
(async()=>{
 const h=await harness();h.add(1,'https://www.nintendo.com/us/cart/',{autoCart:true});let state='loading',race=false,calls=0;
 const original=h.chrome.scripting.executeScript;
 h.chrome.scripting.executeScript=async req=>{
  if(req.func?.name==='inspectNintendoCart'){calls++;if(race&&calls===2)state='ready';return [{result:{state,product:'console'}}];}
  return original(req);
 };
 await h.scan(1);h.advance(1000);await h.chrome.alarms.onAlarm.fn({name:'refresh:1'});
 assert.equal(h.events.filter(e=>e[0]==='reload').length,0,'complete document with incomplete cart is not refreshed');
 state='unavailable';await h.scan(1);h.advance(500);await h.chrome.alarms.onAlarm.fn({name:'refresh:1'});
 assert.equal(h.events.filter(e=>e[0]==='reload').length,0,'stock rejection gets a short settling window');
 state='ready';await h.scan(1);assert.equal(h.db['watch:1'].pending,true,'ready button immediately interrupts settling');
 assert.equal(h.events.filter(e=>e[0]==='action'&&e[2]==='nintendoCheckout').length,1);
 await h.call({type:'pause',id:1});
 const k=await harness();k.add(1,'https://www.nintendo.com/us/cart/',{autoCart:true});let phase='blocked';const originalK=k.chrome.scripting.executeScript;
 k.chrome.scripting.executeScript=async req=>req.func?.name==='inspectNintendoCart'?[{result:{state:phase,product:'console'}}]:originalK(req);
 await k.scan(1);k.advance(1000);await k.chrome.alarms.onAlarm.fn({name:'refresh:1'});assert.equal(k.events.filter(e=>e[0]==='reload').length,0,'disabled without stock response receives longer settling');
 k.advance(1001);await k.chrome.alarms.onAlarm.fn({name:'refresh:1'});assert.equal(k.events.filter(e=>e[0]==='reload').length,1);
 phase='unavailable';await k.scan(1);k.advance(751);let reads=0;
 k.chrome.scripting.executeScript=async req=>{if(req.func?.name==='inspectNintendoCart'){reads++;if(reads===2)phase='ready';return [{result:{state:phase,product:'console'}}];}return originalK(req);};
 await k.chrome.alarms.onAlarm.fn({name:'refresh:1'});
 assert.equal(k.events.filter(e=>e[0]==='reload').length,1,'enabled-at-final-check race cancels reload');
 assert.equal(k.db['watch:1'].pending,true);
 await k.call({type:'pause',id:1});
 console.log('PASS: hydration wait, 750ms rejection settle, 2s disabled settle, immediate ready handling and pre-reload race guard');
})().catch(e=>{console.error(e);process.exitCode=1;});
