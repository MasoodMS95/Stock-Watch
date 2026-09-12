const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/cart.js','utf8');
const answer=`Is the pre-order over? No, they are being released in waves. Keep refreshing your browser until you see the yellow pre-order button, once the button is live keep pressing it until it says you are in line. It will say "sold out" for a few attempts, but with a little luck you will get through the line and see one in your shopping cart. I've been watching this page for the last 2 days. See more Answered 1 day ago by Anonymous`;
let nodes=[];
const context=vm.createContext({document:{querySelectorAll:()=>nodes},getComputedStyle:()=>({visibility:'visible',display:'block'})});
vm.runInContext(source,context);
function element(text,parent=null,id=''){return {innerText:text,id,className:'',parentElement:parent,getClientRects:()=>[{}],getAttribute:()=>null};}
function check(expected){assert.equal(vm.runInContext('pageAttention()?.reason',context),expected);assert.equal(vm.runInContext('classifyCart(cartSignals()).reason',context),expected);}
nodes=[element(answer)];check(undefined);
// Even a standalone quote nested deep inside customer content must be ignored.
for(const id of ['questions-and-answers','customer-reviews','bv-content']){
  nodes=[element("You're in line",element('',element('',null,id)))];check(undefined);
}
for(const text of ["You're in line","You are in line! Please don't refresh.",'Your position in line','Do not refresh this page']){
  nodes=[element(text)];check('queue');
}
nodes=[element(answer),element("You're in line")];check('queue');
nodes=[element('Keep pressing until you are in line')];check(undefined);
console.log('PASS: customer Q&A and nested queue quotes ignored; live queue messages still protected');
