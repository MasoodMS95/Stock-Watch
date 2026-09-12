const fs=require('node:fs');
const {analyzeDiagnostics}=require('./diagnostics.js');
if(!process.argv[2]){console.error('Usage: node analyze-log.cjs "C:\\path\\stock-watch-log.json"');process.exitCode=1;}
else {
  try {
    const report=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
    if(report.schemaVersion!==1||!Array.isArray(report.events))throw Error('This is not a supported Stock Watch diagnostic report.');
    const analysis=analyzeDiagnostics(report);console.log(analysis.summary);
    for(const w of analysis.watches)console.log(`${w.store||'Watch'} (${w.id}): ${w.lastState?.status||'No final state'}`);
    for(const finding of analysis.findings)console.log(`${new Date(finding.time).toISOString()} [${finding.kind}] ${finding.watchId??''} ${finding.message}`);
  }catch(e){console.error(e.message);process.exitCode=1;}
}
