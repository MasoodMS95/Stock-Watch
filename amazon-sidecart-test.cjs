const assert=require('node:assert/strict'),vm=require('node:vm');
const {inspectAmazonPage}=require('./amazon.js');
const {harness}=require('./control-audit-test.cjs');
(async()=>{
  const node=text=>({innerText:text,getClientRects:()=>[{}]});
  const panel=node('Subtotal\n$0.00\nGo to Cart'),title=node('Console'),badge=node('1');
  global.location={hostname:'www.amazon.com',pathname:'/dp/B0HJ6F8L6V',href:'https://www.amazon.com/dp/B0HJ6F8L6V'};
  global.getComputedStyle=()=>({visibility:'visible',display:'block'});
  global.document={querySelector:s=>({'#productTitle':title,'#nav-flyout-ewc':panel,'#nav-cart-count':badge}[s]||null),querySelectorAll:()=>[]};
  const rule={store:'Amazon',productId:'B0HJ6F8L6V'};
  assert.equal(inspectAmazonPage(rule).state,'staleCart');
  panel.innerText='Subtotal $519.99 Go to Cart';assert.notEqual(inspectAmazonPage(rule).state,'staleCart');
  panel.innerText='Subtotal $0.00 Console Go to Cart';assert.notEqual(inspectAmazonPage(rule).state,'staleCart');
  panel.innerText='Subtotal $0.00 Go to Cart';badge.innerText='0';assert.notEqual(inspectAmazonPage(rule).state,'staleCart');
  badge.innerText='1';panel.getClientRects=()=>[];assert.notEqual(inspectAmazonPage(rule).state,'staleCart');
  for(const pending of [false,true]) {
    const h=await harness();h.add(1,location.href,{autoCart:true,pending,paused:pending,token:'test',started:Date.now()});
    h.state.pages[1]={page:'product',state:'staleCart',reason:'emptySideCart'};h.state.found=true;
    await h.scan(1);
    assert.equal(h.db['watch:1'].paused,false);assert.equal(h.db['watch:1'].pending,false);
    assert.equal(h.db['watch:1'].amazonIgnoreCartBadge,true);
    assert.equal(h.events.filter(e=>e[0]==='notice'||e[0]==='action').length,0);
    h.advance(5000);
    await vm.runInContext('get(1).then(w=>refresh(w))',h.context);
    assert.ok(h.events.some(e=>e[0]==='reload'),'stale panel must not indefinitely postpone reload');
    await h.call({type:'pause',id:1});h.advance(5000);
    const count=h.events.filter(e=>e[0]==='reload').length;
    await h.scan(1);await vm.runInContext('get(1).then(w=>refresh(w))',h.context);
    assert.equal(h.events.filter(e=>e[0]==='reload').length,count,'manual pause stays protected');
  }
  console.log('PASS: observed empty side-cart mismatch recovers without cart clicks or alerts, refreshes and respects manual pause');
})().catch(e=>{console.error(e);process.exitCode=1;});
