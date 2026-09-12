const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
class Element {
  constructor(tag){this.tag=tag;this.children=[];this.textContent='';this.value='';this.disabled=false;}
  append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  remove(){this.parent.children=this.parent.children.filter(n=>n!==this);}
  setAttribute(name,value){this[name]=value;}
}
(async()=>{
  global.document={createElement:tag=>new Element(tag)};
  const {createWatchList}=require('./watch-ui.js');
  const container=new Element('div'),calls=[];let w={id:1,url:'https://www.amazon.com/dp/B0HJ6F8L6V',title:'Console',interval:5,paused:true,status:'Paused by you'};
  let pendingResolve;
  const list=createWatchList({container,confirm:()=>true,intervalValue:(amount,unit)=>Number(amount)*Number(unit),returnToProduct:async()=>{},run:async fn=>fn(),send:async msg=>{
    calls.push(msg);if(msg.type==='pause'||msg.type==='resume'){w={...w,paused:msg.type==='pause'};list.update([w]);}
    if(msg.type==='interval')await new Promise(r=>{pendingResolve=r;});
  }});
  list.update([w]);const row=container.children[0],toggle=row.children[4],details=row.children.find(e=>e.tag==='details'),editor=details.children.find(e=>e.className==='interval'),amount=editor.children[0],save=editor.children[2];
  document.activeElement=toggle;details.open=true;
  await toggle.onclick();assert.equal(toggle.textContent,'Pause');await toggle.onclick();assert.equal(toggle.textContent,'Resume');
  assert.deepEqual(calls.map(c=>c.type),['resume','pause'],'focused button uses fresh state');
  list.update([{...w,pending:true,paused:true,userPaused:false}]);assert.equal(toggle.textContent,'Pause');
  list.update([{...w,pending:true,paused:true,userPaused:true}]);assert.equal(toggle.textContent,'Resume','manual pause during a cart check offers Resume');
  list.update([w]);
  amount.value='0.25';amount.oninput();w={...w,status:'New status',checked:Date.now(),interval:60};list.update([w]);
  assert.equal(container.children[0],row);assert.equal(document.activeElement,toggle);assert.equal(details.open,true);assert.equal(amount.value,'0.25');assert.equal(row.children[1].textContent,'New status');
  const saving=save.onclick();assert.equal(save.disabled,true);await save.onclick();assert.equal(calls.filter(c=>c.type==='interval').length,1);pendingResolve();await saving;assert.equal(save.disabled,false);
  // Late reads may not overwrite a newer popup render.
  const source=fs.readFileSync(__dirname+'/popup.js','utf8');const reads=[],rendered=[];
  const context=vm.createContext({chrome:{storage:{local:{get:()=>new Promise(r=>reads.push(r))}}},updateBulkControls:()=>{},watchList:{update:w=>rendered.push(w[0].status)}});
  vm.runInContext(source.slice(source.indexOf('let renderGeneration='),source.indexOf('chrome.storage.onChanged')),context);
  const old=vm.runInContext('render()',context),fresh=vm.runInContext('render()',context);
  reads[1]({one:{kind:'watch',status:'Resumed'}});await fresh;reads[0]({one:{kind:'watch',status:'Paused'}});await old;assert.deepEqual(rendered,['Resumed']);
  const amazonFulfillment=details.children.find(e=>e.tag==='select');
  assert.ok(!amazonFulfillment.children.some(o=>o.value==='delivery'&&!o.hidden&&!o.disabled),'Delivery is not offered for Amazon');
  const walmart={id:2,url:'https://www.walmart.com/ip/example/123456',title:'Walmart item',interval:5,paused:true,fulfillment:'shipping'};
  list.update([w,walmart]);const walmartFulfillment=container.children[1].children.find(e=>e.tag==='details').children.find(e=>e.tag==='select');
  assert.ok(walmartFulfillment.children.some(o=>o.value==='delivery'&&!o.hidden&&!o.disabled),'Walmart offers Delivery');
  walmartFulfillment.value='delivery';await walmartFulfillment.onchange();
  assert.deepEqual(calls.at(-1),{type:'fulfillment',id:2,fulfillment:'delivery'});
  list.update([w,{...walmart,fulfillment:'delivery'}]);assert.equal(walmartFulfillment.value,'delivery','saved Delivery survives status updates');
  const verification={...w,paused:true,amazonVerification:'required',attention:true};
  details.open=false;list.update([verification]);assert.equal(details.open,true,'recovery controls open on the first verification');
  assert.equal(details.children[1].hidden,false);assert.match(details.children[1].textContent,/Continue shopping/);
  assert.equal(details.children[4].textContent,'Open saved Amazon product');
  details.open=false;list.update([verification]);assert.equal(details.open,false,'ongoing updates preserve a user-collapsed details panel');
  list.update([{...verification,amazonVerificationReview:true}]);assert.match(details.children[1].textContent,/existing cart will be checked/);
  list.update([w]);assert.equal(details.children[1].hidden,true);assert.equal(details.children[4].textContent,'Return to product page');
  list.update([]);delete global.document;
  console.log('PASS: focused Pause/Resume, preserved drafts/details, duplicate controls, and out-of-order popup reads');
})().catch(e=>{console.error(e);process.exitCode=1;});
