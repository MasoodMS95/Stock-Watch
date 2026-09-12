// Short intervals run inside the watched tab; Chrome alarms provide recovery.
function armPageTimer(expectedUrl, deadline, type = 'refreshDue') {
  const timerKey = type === 'refreshDue' ? '__stockRefreshTimer' : '__stockScanTimer';
  clearTimeout(globalThis[timerKey]);
  if (location.href.split('#')[0] !== expectedUrl.split('#')[0]) return;
  globalThis[timerKey] = setTimeout(() => {
    if (location.href.split('#')[0] === expectedUrl.split('#')[0]) chrome.runtime.sendMessage({type, deadline}).catch(()=>{});
  }, Math.max(1, deadline-Date.now()));
}
