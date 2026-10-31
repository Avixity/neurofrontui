const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
function declaration(name) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, end < 0 ? source.length : end);
}
const runtime = vm.createContext({});
vm.runInContext([
  declaration('clamp'),
  declaration('computeSignalFeatures'),
  declaration('compositeActivity'),
  declaration('refreshStressState'),
  'function updateStressMeter() {}',
  'function isDeviceConnected() { return true }',
  'var state;',
].join('\n'), runtime);

const baseline = [0, 10, -5, 15, -10, 0, 8, -2];
const cases = [
  { name: 'unchanged nonflat', baseline, capture: baseline },
  { name: 'larger variation', baseline, capture: baseline.map(value => value * 1.5) },
  { name: 'less variation', baseline, capture: baseline.map(value => value * 0.5) },
  { name: 'clamped high', baseline, capture: baseline.map(value => value * 5) },
  { name: 'constant floor', baseline: [100, 100, 100, 100], capture: [100, 100, 100, 100] },
  { name: 'one sample floor', baseline: [4], capture: [8] },
  { name: 'offset preserves variability', baseline, capture: baseline.map(value => value + 1000) },
];
const fixtures = cases.map(test => {
  runtime.input = test;
  return vm.runInContext(`(() => {
    const baselineFeatures = computeSignalFeatures(input.baseline);
    const captureFeatures = computeSignalFeatures(input.capture);
    state = {baseline: {...baselineFeatures, ready: true}, stress: {}};
    refreshStressState(input.capture);
    return {...input, baselineFeatures, captureFeatures, baselineActivity: compositeActivity(baselineFeatures), captureActivity: compositeActivity(captureFeatures), score: state.stress.score, label: state.stress.label};
  })()`, runtime);
});
fs.writeFileSync(path.join(__dirname, 'calculation-fixtures.json'), JSON.stringify({sourceCommit:'e0250c74fc06f043ddf873944e98ddba903316fc',method:'Executed original legacy calculation functions in a Node VM; no device connection.',fixtures}, null, 2) + '\n');
process.stdout.write(`Generated ${fixtures.length} fixtures directly from legacy app.js\n`);
