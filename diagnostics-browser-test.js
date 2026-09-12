(async()=>{
  const check=(test,message)=>{if(!test)throw Error(message);};
  const name='stock-watch-qa-'+Date.now(),db=createDiagnosticStore(name),now=Date.now();
  await db.setMeta('enabled',true);
  for(let i=0;i<6005;i++)await db.append({time:now+i,type:'sample'},false);
  for(let i=0;i<505;i++)await db.append({time:now+i,type:'pause'},true);
  let entries=await db.read();check(entries.filter(e=>e.type==='sample').length===6000,'routine cap');check(entries.filter(e=>e.type==='pause').length===500,'incident cap');
  const second=createDiagnosticStore(name);check((await second.read()).length===6500,'persistent storage reopened');
  await second.clear();check((await db.read()).length===0,'clear shared database');
  const ref=await db.append({time:now,type:'pause'},true);await db.attach(ref,{signals:['inventory_rejection']});
  check((await second.read())[0].snapshot.signals[0]==='inventory_rejection','snapshot attached');
  await db.append({time:now+49*3600000,type:'new'},true);check((await db.read()).length===1,'48-hour retention');
  const page=captureWatchPage({store:'Amazon',productId:'B0HJ6F8L6V',selectors:['#purchase']});
  check(page.controls[0].buttons[0].disabled,'disabled preorder recorded');check(page.signals.includes('inventory_rejection'),'rejection evidence recorded');
  check(!JSON.stringify(page).includes('private-password')&&!JSON.stringify(page).includes('Private Street'),'customer fields excluded');
  await db.clear();
  document.getElementById('result').textContent='PASS: native IndexedDB capacity, persistence, snapshot attachment, clearing, retention and real DOM privacy checks';
})().catch(e=>{document.getElementById('result').textContent='FAIL: '+e.message;});
