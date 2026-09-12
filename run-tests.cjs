const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const tests = fs.readdirSync(__dirname).filter(name => name.endsWith('-test.cjs')).sort();
let failures = 0;
for (const test of tests) {
  const result = spawnSync(process.execPath, [path.join(__dirname, test)], {stdio: 'inherit', cwd: __dirname});
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) failures++;
}
console.log(`${tests.length - failures}/${tests.length} test suites passed.`);
process.exitCode = failures ? 1 : 0;
