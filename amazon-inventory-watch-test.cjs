const assert=require('node:assert/strict'),vm=require('node:vm');
const {harness}=require('./control-audit-test.cjs');
(async()=>{
 const h=await harness();const product='https://www.amazon.com/dp/B0HJ6F8L6V',checkout='https://www.amazon.com/checkout/p/session/itemselect';
 h.add(1,product,{autoCart:true,pending:true,paused:true,token:'attempt',started:Date.now(),amazonTitle:'Console'});h.tabs[1].url=checkout;
 h.state.pages[1]={page:'checkout',cartItem:true,state:'unavailable',reason:'zeroQuantity',inventoryWatch:true};
 await h.scan(1);assert.equal(h.db['watch:1'].amazonInventoryWatch,true);assert.equal(h.tabs[1].url,checkout);
 for(let i=0;i<10;i++){h.advance(5000);await h.scan(1);assert.equal(h.tabs[1].url,checkout);}
 assert.equal(h.events.filter(e=>e[0]==='reload').length,10,'checkout is reloaded at saved interval beyond the old timeout');
 assert.equal(h.events.filter(e=>e[0]==='notice').length,0);
 h.state.pages[1]={page:'checkout',cartItem:true,state:'confirmationReady',quantityRestored:true};await h.scan(1);
 assert.equal(h.db['watch:1'].pending,false);assert.equal(h.db['watch:1'].paused,true);assert.match(h.db['watch:1'].status,/restored this item to quantity 1/);
 assert.equal(h.events.filter(e=>e[0]==='notice').length,1);assert.equal(h.events.filter(e=>e[0]==='action').length,0,'restored quantity hands off without clicking Continue');
 h.advance(5000);await h.scan(1);assert.equal(h.events.filter(e=>e[0]==='reload').length,10);
 const k=await harness();k.add(1,product,{autoCart:true,pending:true,paused:true,token:'attempt',started:Date.now()});k.tabs[1].url=checkout;k.state.pages[1]={page:'checkout',cartItem:true,state:'unavailable',inventoryWatch:true};
 await k.scan(1);await k.call({type:'pause',id:1});k.advance(5000);await k.scan(1);assert.equal(k.events.filter(e=>e[0]==='reload').length,0);
 console.log('PASS: checkout stays in place, saved refresh interval, extended inventory wait, one restoration alert, no confirmation clicks and manual pause');
})().catch(e=>{console.error(e);process.exitCode=1;});
