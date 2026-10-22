import assert from 'node:assert/strict';
// Isolated, nonnetwork harness regressions. No built app/Worker imports.
// Run: node --test scripts/feature-expansion-lifecycle.test.mjs
import test from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { EventEmitter, once } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { runInNewContext } from 'node:vm';
import { integrationFlags, assertUnchangedInventoryDiff, assertFixtureIdentity } from './feature-expansion-fixtures.mjs';
const artifacts = mkdtempSync(join(tmpdir(), 'agfs-lifecycle-probes-'));
console.log('Isolated lifecycle evidence: ' + artifacts);
const helper = new URL('./feature-expansion-fixtures.mjs', import.meta.url).href;
const repo = fileURLToPath(new URL('../', import.meta.url));
const python = join(repo, 'scripts/feature-expansion-python-smoke.py');
const baseEnv = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }; delete baseEnv.PYTHONOPTIMIZE;

test('explicit KEEP and FIXTURE flags: unset/0/false are false; only 1 retains', () => {
  for (const keep of [undefined, '', '0', 'false', 'true', '1']) {
    for (const fixture of [undefined, '', '0', 'false', 'true', '1']) {
      const env = { AGFS_KEEP_TEST_SERVER: keep, AGFS_FIXTURE_ONLY: fixture };
      if (fixture === '1' && keep !== '1') assert.throws(() => integrationFlags(env), /explicit/);
      else assert.deepEqual(integrationFlags(env), { keepServer: keep === '1', fixtureOnly: fixture === '1' });
    }
  }
});
test('identity helper rejects actor, namespace and authentication-source mismatch', () => {
  const identity = { user: { id: 'viewer' }, workspaceId: 'team', authSource: 'session' };
  assertFixtureIdentity(identity, 'viewer', 'team', 'session');
  for (const expected of [['owner', 'team', 'session'], ['viewer', null, 'session'], ['viewer', 'team', 'api-token']])
    assert.throws(() => assertFixtureIdentity(identity, ...expected));
  const source = readFileSync(join(repo, 'scripts/feature-expansion-browser-fixture.mjs'), 'utf8');
  assert.match(source, /const viewer = f\.token\(f\.other, \{ permissions: \["read"\] \}\)/);
  assert(!source.includes('const viewer = f.token(f.id'));
});
test('exact diff accepts two rows in either order and rejects omissions, duplicates, extras and bad metadata', () => {
  const entries = [{ path: '/a.txt', kind: 'file', etag: 'a', size: 1 }, { path: '/b.txt', kind: 'file', etag: 'b', size: 2 }];
  const rows = entries.map(e => ({ path: e.path, status: 'unchanged', before: { ...e }, after: { ...e } }));
  assertUnchangedInventoryDiff(rows, entries); assertUnchangedInventoryDiff([...rows].reverse(), entries);
  const wrong = [[], rows.slice(0, 1), [rows[0], rows[0]], [...rows, rows[0]], [rows[0], { ...rows[1], path: '/unexpected' }],
    [rows[0], { ...rows[1], status: 'changed' }], [rows[0], { ...rows[1], before: undefined }], [rows[0], { ...rows[1], after: { ...entries[1], size: 999 } }]];
  for (const value of wrong) assert.throws(() => assertUnchangedInventoryDiff(value, entries));
});
const sentinel = join(artifacts, 'python-import-sentinel');
writeFileSync(join(artifacts, 'agfs_sdk.py'), `from pathlib import Path\nPath(${JSON.stringify(sentinel)}).write_text('UNEXPECTED IMPORT')\nraise RuntimeError('SDK must not import during optimization refusal')\n`);
for (const [name, args, optimize] of [['environment 1', [], '1'], ['environment 2', [], '2'], ['-O', ['-O'], undefined], ['-OO', ['-OO'], undefined]]) {
  test('Python refuses optimization ' + name + ' before SDK import or pass records', () => {
    const env = { ...baseEnv, PYTHONPATH: artifacts }; if (optimize !== undefined) env.PYTHONOPTIMIZE = optimize;
    const result = spawnSync('python3', [...args, python], { env, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.error, undefined); assert.notEqual(result.status, 0); assert.equal(result.stdout, '');
    assert.match(result.stderr, /refuses optimized Python/); assert(!existsSync(sentinel));
  });
}
test('runner rejects inherited optimization and permits normal assertion mode', () => {
  const code = `import { requirePythonAssertions } from ${JSON.stringify(helper)}; requirePythonAssertions(); console.log('guard passed');`;
  for (const optimize of ['1', '2']) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...baseEnv, PYTHONOPTIMIZE: optimize }, encoding: 'utf8', timeout: 5000 });
    assert.notEqual(result.status, 0); assert.equal(result.stdout, ''); assert.match(result.stderr, /refuses optimized Python/);
  }
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: baseEnv, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), 'guard passed');
});
const childFile = join(artifacts, 'controlled-child.mjs');
writeFileSync(childFile, `import { spawn } from 'node:child_process';
const mode = process.argv[2];
if (['descendant','pipe-crash','parent-first','ignore-tree','escaped-tree','owner-killed-tree','owner-exit-tree'].includes(mode)) {
  const grand = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)"], { detached: mode === 'escaped-tree', stdio: ['ignore','pipe','inherit'] });
  grand.stdout.once('data', () => { console.log(JSON.stringify({ child: process.pid, grandchild: grand.pid })); if (mode === 'pipe-crash') setTimeout(() => process.exit(7), 50); });
  if (mode === 'parent-first' || mode === 'escaped-tree') process.on('SIGTERM', () => process.exit(0));
  else if (['ignore-tree','owner-killed-tree','owner-exit-tree'].includes(mode)) process.on('SIGTERM', () => {});
  else process.on('SIGTERM', () => { grand.kill('SIGKILL'); });
  process.on('SIGINT', () => grand.kill('SIGKILL'));
  grand.once('close', () => process.exit(0));
} else {
  if (mode === 'ignore') process.on('SIGTERM', () => {});
  console.log(JSON.stringify({ child: process.pid }));
  if (mode === 'service-exit') setTimeout(() => process.exit(7), 100);
  setInterval(() => {}, 1000);
}
`);
const parentFile = join(artifacts, 'controlled-owner.mjs');
writeFileSync(parentFile, `import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createOwnedRuntime, integrationFlags } from ${JSON.stringify(helper)};
let guardian;
const runtime = createOwnedRuntime({ graceMs: 150, killMs: 1500, spawnGuardian: (...args) => { guardian = spawn(...args); return guardian; } });
const [mode, output] = process.argv.slice(2); let child, record = { mode, owner: process.pid };
try {
  await runtime.guard((async () => {
    if (mode === 'before-startup') { const pendingStartup = setTimeout(() => {}, 10000); console.log(JSON.stringify({ ready: true, mode })); try { await runtime.wait(); } finally { clearTimeout(pendingStartup); } }
    if (mode === 'spawn-failure') { await runtime.run('/absent-controlled-integration-executable', [], { stdio: 'ignore' }); return; }
    child = runtime.launch(process.execPath, [${JSON.stringify(childFile)}, mode], { stdio: ['ignore','pipe','inherit'] }, { service: ['service-exit', 'pipe-crash', 'ipc-loss'].includes(mode), label: 'controlled child' });
    record.child = child.pid; record.guardian = child.guardianPid;
    const data = await runtime.guard(new Promise((accept, reject) => { child.stdout.once('data', accept); child.once('error', reject); }));
    Object.assign(record, JSON.parse(data.toString()));
    console.log(JSON.stringify({ ...record, ready: true }));
    if (mode === 'seeding-failure') throw new Error('controlled seeding failure');
    if (mode === 'ipc-loss') guardian.stdin.destroy();
    if (mode === 'telemetry-loss') guardian.stdio[3].destroy();
    if (mode.startsWith('owner-exit')) process.exit(0);
    if (mode === 'pipe-crash') child.once('exit', (code) => { record.observedCommandExit = code; record.abortedAtExit = runtime.signal.aborted; try { runtime.check(); record.allowedWorkAfterExit = true; } catch { record.allowedWorkAfterExit = false; } try { runtime.launch(process.execPath, ['-e','']); record.allowedLaunchAfterExit = true; } catch { record.allowedLaunchAfterExit = false; } });
    if (mode === 'success' && !integrationFlags(process.env).keepServer) return;
    await runtime.wait();
  })());
} catch (error) {
  record.error = error.message;
  process.exitCode = runtime.signalName === 'SIGTERM' ? 143 : runtime.signalName === 'SIGINT' ? 130 : 1;
} finally {
  try {
    const stopped = runtime.shutdown(); assert.equal(runtime.shutdown(), stopped); await stopped;
    assert.throws(() => runtime.launch(process.execPath, ['-e',''], { stdio:'ignore' }));
    record.stopped = true; record.signal = runtime.signalName ?? null; record.pids = runtime.pids; record.childSignal = child?.signalCode;
  } catch (error) { record.cleanupError = error.message; process.exitCode = 1; }
  record.stopped = runtime.cleanupComplete; record.pids = runtime.pids; record.signal = runtime.signalName ?? null; record.childSignal = child?.signalCode;
  runtime.dispose(); writeFileSync(output, JSON.stringify(record));
}
`);
function alive(pid) { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } }
async function finishControlledOwner(owner, closed, timeout) {
  clearTimeout(timeout);
  // This is the ChildProcess created by this test, with Node retaining its
  // direct-child lifecycle. Descendant numbers are observations, never cleanup
  // authority. Owner exit closes guardian IPC; missing reaping proof fails the
  // test explicitly instead of signaling an unverifiable saved descendant PID.
  if (owner.exitCode === null && owner.signalCode === null) {
    owner.kill('SIGKILL');
    await closed;
  }
}
let sequence = 0;
async function exercise(mode, signal, keep) {
  const output = join(artifacts, `lifecycle-${++sequence}.json`);
  const env = { ...baseEnv }; delete env.AGFS_KEEP_TEST_SERVER; delete env.AGFS_FIXTURE_ONLY;
  if (keep !== undefined) env.AGFS_KEEP_TEST_SERVER = keep;
  const owner = spawn(process.execPath, [parentFile, mode, output], { env, stdio: ['ignore','pipe','pipe'] });
  let stderr = '', ready;
  owner.stderr.on('data', b => stderr += b);
  const closed = once(owner, 'close');
  const timeout = setTimeout(() => owner.kill('SIGKILL'), 6000);
  try {
    if (signal || keep === '1') {
      const [data] = await once(owner.stdout, 'data'); ready = JSON.parse(data.toString()); assert(ready.ready);
      if (keep === '1') { await delay(150); assert.equal(owner.exitCode, null); assert(alive(ready.child)); }
      owner.kill(signal ?? 'SIGTERM');
    }
    const [code] = await closed;
    assert(existsSync(output), `Missing shutdown record: ${stderr}`);
    const result = JSON.parse(readFileSync(output, 'utf8'));
    if (['service-exit','pipe-crash','spawn-failure','ipc-loss'].includes(mode)) assert.match(result.cleanupError, /unexpectedly|ENOENT/);
    else if (mode === 'telemetry-loss') assert.match(result.cleanupError, /unproved/);
    else assert.equal(result.cleanupError, undefined);
    assert.equal(result.stopped, mode !== 'telemetry-loss');
    for (const pid of [...result.pids, result.grandchild].filter(Boolean)) assert.equal(alive(pid), false, `Owned PID ${pid} survived`);
    return { code, result, stderr };
  } finally {
    await finishControlledOwner(owner, closed, timeout);
  }
}
for (const phase of ['startup', 'seeding']) for (const signal of ['SIGINT','SIGTERM']) {
  test(`owned runtime reaps child on ${signal} during ${phase}`, async () => {
    const { code, result } = await exercise(phase, signal);
    assert.equal(code, signal === 'SIGINT' ? 130 : 143); assert.equal(result.signal, signal);
  });
}
test('cancellation before startup prevents late launch without children', async () => {
  const { code, result } = await exercise('before-startup', 'SIGTERM'); assert.equal(code, 143); assert.deepEqual(result.pids, []);
});
test('seeding failure awaits cleanup before failure exit', async () => {
  const { code, result } = await exercise('seeding-failure'); assert.equal(code, 1); assert.match(result.error, /controlled seeding failure/);
});
test('spawn failure is handled without unhandled child error', async () => {
  const { code, result, stderr } = await exercise('spawn-failure'); assert.equal(code, 1); assert.match(result.error, /ENOENT/); assert.equal(stderr, '');
});
test('unexpected service exit remains failure after successful descendant cleanup', async () => {
  const { code, result } = await exercise('service-exit'); assert.equal(code, 1); assert.match(result.error, /exited unexpectedly/);
});
test('SIGTERM escalation reaps a child that ignores graceful termination', async () => {
  const { code, result } = await exercise('ignore', 'SIGTERM'); assert.equal(code, 143); assert.equal(result.childSignal, 'SIGKILL');
});
test('owned descendant process group is stopped and unrelated child remains alive', async () => {
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  const closed = once(unrelated, 'close');
  try { const { code, result } = await exercise('descendant', 'SIGTERM'); assert.equal(code, 143); assert(result.grandchild); assert(alive(unrelated.pid)); }
  finally { unrelated.kill('SIGTERM'); await closed; }
});
test('normal success with unset/0/false KEEP closes children', async () => {
  for (const keep of [undefined, '0', 'false']) assert.equal((await exercise('success', undefined, keep)).code, 0);
});
test('explicit KEEP=1 retains successful fixture until signal then awaits shutdown', async () => {
  const { code, result } = await exercise('success', undefined, '1'); assert.equal(code, 143); assert.equal(result.signal, 'SIGTERM');
});

test('R2: service exit7 aborts immediately while a descendant holds its pipe; cleanup cannot mask failure', async () => {
  const { code, result } = await exercise('pipe-crash');
  assert.equal(code, 1); assert.equal(result.observedCommandExit, 7);
  assert.equal(result.abortedAtExit, true); assert.equal(result.allowedWorkAfterExit, false);
  assert.equal(result.allowedLaunchAfterExit, false); assert(result.grandchild);
  assert.match(result.error, /exited unexpectedly \(7\)/); assert.equal(result.stopped, true);
});
for (const mode of ['parent-first', 'ignore-tree', 'escaped-tree']) {
  test(`R2: pidfds reap ${mode} descendants without depending on their original process group`, async () => {
    const { code, result } = await exercise(mode, 'SIGTERM');
    assert.equal(code, 143); assert(result.grandchild); assert.equal(result.stopped, true);
    if (mode === 'ignore-tree') assert.equal(result.childSignal, 'SIGKILL');
  });
}
test('R2: owner-side IPC loss triggers bounded autonomous cleanup and service failure', async () => {
  const { code, result } = await exercise('ipc-loss'); assert.equal(code, 1); assert.equal(result.stopped, true);
});
test('R2: lost cleanup telemetry refuses an ownership claim and still asks the guardian to stop', async () => {
  const { code, result } = await exercise('telemetry-loss'); assert.equal(code, 1); assert.equal(result.stopped, false);
  assert.match(result.error, /ownership\/cleanup proof lost/);
});

// A deterministic recycled-ID model, with no actual process signal/PID churn.
// The parent must use a live control channel or refuse cleanup; existence of a
// numeric PID/group cannot cause it to signal the modeled unrelated incarnation.
for (const lost of [false, true]) {
  test(`R2: recycled numeric group is never signaled after guardian ${lost ? 'proof loss' : 'retirement'}`, async () => {
    const guardian = new EventEmitter(), commands = [], attemptedSignals = [];
    guardian.pid = 424242;
    guardian.stdout = new PassThrough(); guardian.stderr = new PassThrough();
    guardian.stdin = new Writable({ write(chunk, _encoding, next) { commands.push(chunk.toString()); next(); } });
    guardian.stdio = [guardian.stdin, guardian.stdout, guardian.stderr, new PassThrough()];
    const { createOwnedRuntime } = await import(helper);
    const runtime = createOwnedRuntime({ graceMs: 10, killMs: 100, spawnGuardian: () => guardian });
    const realKill = process.kill;
    process.kill = (pid, sig) => { attemptedSignals.push({ pid, sig, incarnation: 2 }); throw new Error('Refuse real signal in kernel model'); };
    try {
      const child = runtime.launch('controlled', [], {}, { label: 'modeled command' });
      guardian.stdio[3].write('{"type":"spawn","pid":424243}\n');
      guardian.stdio[3].write('{"type":"exit","code":0,"signal":null}\n');
      if (!lost) guardian.stdio[3].write('{"type":"stopped","childrenReaped":true}\n');
      guardian.emit('exit', lost ? 7 : 0, null);
      guardian.stdio[3].end();
      guardian.emit('close', lost ? 7 : 0, null);
      // The owned tree is gone; group424242 now belongs to another incarnation.
      if (lost) { await assert.rejects(runtime.shutdown(), /unproved/); assert.equal(runtime.cleanupComplete, false); }
      else { await runtime.shutdown(); assert.equal(runtime.cleanupComplete, true); }
      assert.deepEqual(attemptedSignals, []); assert.equal(child.exitCode, 0);
      assert.equal(commands.length, 1, 'No stale control write after guardian exit');
    } finally { process.kill = realKill; runtime.dispose(); }
  });
}

test('R2: normal commands preserve exit0/exit7 and finish without waiting for owner IPC closure', async () => {
  const { createOwnedRuntime } = await import(helper);
  for (const code of [0, 7]) {
    const runtime = createOwnedRuntime({ graceMs: 100, killMs: 500 });
    try {
      const running = runtime.run(process.execPath, ['-e', `process.exit(${code})`], { stdio: 'ignore' });
      if (code === 0) await running; else await assert.rejects(running, /failed \(7\)/);
      await runtime.shutdown(); assert.equal(runtime.cleanupComplete, true);
      for (const pid of runtime.pids) assert.equal(alive(pid), false);
    } finally { runtime.dispose(); }
  }
});
test('R2: cancellation immediately after launch reclaims a starting guardian/command', async () => {
  const { createOwnedRuntime } = await import(helper);
  const runtime = createOwnedRuntime({ graceMs: 100, killMs: 500 });
  try {
    runtime.launch(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
    process.emit('SIGTERM'); await runtime.shutdown(); assert.equal(runtime.cleanupComplete, true);
    assert.throws(() => runtime.check());
    for (const pid of runtime.pids) assert.equal(alive(pid), false);
  } finally { runtime.dispose(); }
});
test('R2: guardian executable spawn failure refuses work without unhandled errors', async () => {
  const { createOwnedRuntime } = await import(helper);
  const runtime = createOwnedRuntime({ graceMs: 100, killMs: 500,
    spawnGuardian: (_command, _args, options) => spawn('/absent-local-guardian-probe', [], options) });
  try {
    await assert.rejects(runtime.run(process.execPath, ['-e', ''], { stdio: 'ignore' }), /ENOENT/);
    await assert.rejects(runtime.shutdown(), /unproved/); assert.throws(() => runtime.check());
  } finally { runtime.dispose(); }
});

// An outer Linux subreaper lets the probe observe/reap the guardian after the
// controlled owner is killed. The production guardian reaps its own descendants;
// no assumption about this host's PID1 reaping behavior is needed for evidence.
const lossProbe = join(artifacts, 'owner-loss.py');
writeFileSync(lossProbe, `import ctypes, json, os, selectors, signal, subprocess, sys, time
from pathlib import Path
assert ctypes.CDLL(None).prctl(36,1,0,0,0)==0
mode=sys.argv[1]
output=Path(sys.argv[2])
owner=subprocess.Popen([${JSON.stringify(process.execPath)},${JSON.stringify(parentFile)},mode,str(output)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
selector=selectors.DefaultSelector(); selector.register(owner.stdout,selectors.EVENT_READ)
assert selector.select(5),'Owner did not publish controlled PIDs'
ready=json.loads(owner.stdout.readline())
pids=[ready['owner'],ready['guardian'],ready['child']]
if ready.get('grandchild'): pids.append(ready['grandchild'])
if not mode.startswith('owner-exit'): owner.kill()
owner.wait(timeout=5)
reaped=[]; deadline=time.monotonic()+5
while time.monotonic()<deadline:
 try:
  pid,status=os.waitpid(-1,os.WNOHANG)
 except ChildProcessError: break
 if pid: reaped.append({'pid':pid,'status':status})
 else: time.sleep(0.02)
for pid in pids:
 try: os.kill(pid,0)
 except ProcessLookupError: continue
 raise AssertionError('Controlled PID remained alive: '+str(pid))
print(json.dumps({'mode':mode,'ownerExit':owner.returncode,'pids':pids,'reaped':reaped,'allAbsent':True}))
`);
for (const mode of ['owner-killed', 'owner-exit', 'owner-killed-tree', 'owner-exit-tree']) {
  test(`R2: ${mode} closes private IPC and guardian autonomously reaps the command`, () => {
    const result = spawnSync('python3', [lossProbe, mode, join(artifacts, mode + '.json')], { env: baseEnv, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    const evidence = JSON.parse(result.stdout); assert.equal(evidence.allAbsent, true);
    assert.equal(evidence.ownerExit, mode.startsWith('owner-exit') ? 0 : -9);
    writeFileSync(join(artifacts, mode + '-evidence.json'), JSON.stringify(evidence));
  });
}


test('R2: nonzero service exit delivered during teardown still rejects successful completion', async () => {
  const guardian = new EventEmitter(); guardian.pid = 424244;
  guardian.stdout = new PassThrough(); guardian.stderr = new PassThrough();
  guardian.stdin = new Writable({ write(_chunk, _encoding, next) { next(); } });
  guardian.stdio = [guardian.stdin, guardian.stdout, guardian.stderr, new PassThrough()];
  const { createOwnedRuntime } = await import(helper);
  const runtime = createOwnedRuntime({ graceMs: 10, killMs: 100, spawnGuardian: () => guardian });
  try {
    runtime.launch('modeled service', [], {}, { service: true });
    const stopped = runtime.shutdown();
    guardian.stdio[3].write('{"type":"spawn","pid":424245}\n');
    guardian.stdio[3].write('{"type":"exit","code":7,"signal":null}\n');
    guardian.stdio[3].write('{"type":"stopped","childrenReaped":true}\n');
    guardian.emit('exit', 0, null); guardian.stdio[3].end(); guardian.emit('close', 0, null);
    await assert.rejects(stopped, /exited unexpectedly \(7\)/);
    assert.equal(runtime.cleanupComplete, true); assert.match(runtime.failure.message, /\(7\)/);
  } finally { runtime.dispose(); }
});

// Exercise the exact finalizer used by the real probes. Saved descendant IDs
// now identify unrelated incarnations in this model; no real signals occur.
for (const failed of [false, true]) {
  test(`R3: probe finally after ${failed ? 'failure' : 'success'} never signals recycled descendant numbers`, async () => {
    const attemptedSignals = [];
    const owner = { exitCode: failed ? 1 : 0, signalCode: null,
      kill: signal => attemptedSignals.push({ kind: 'retired owner', signal }) };
    const ready = { child: 424246, grandchild: 424247 };
    const modeledProcess = { kill: (pid, signal) => { attemptedSignals.push({ pid, signal, incarnation: 2 }); return true; } };
    const finalize = runInNewContext(`(${finishControlledOwner.toString()})`, {
      clearTimeout: () => {}, process: modeledProcess, ready, alive: () => true,
    });
    try { if (failed) throw new Error('controlled regression failure'); }
    catch (error) { assert.match(error.message, /controlled regression failure/); }
    finally { await finalize(owner, Promise.resolve(), undefined); }
    assert.deepEqual(attemptedSignals, []);
  });
}

// Fault injection executes the actual guardian prerequisite path. Popen is a
// recording refusal, so a regression cannot launch even a controlled workload.
// Internal fork probes self-exit and are reaped; no test uses numeric cleanup.
const capabilityProbe = join(artifacts, 'guardian-capabilities.py');
const guardianFile = join(repo, 'scripts/feature-expansion-process-guardian.py');
writeFileSync(capabilityProbe, `import ctypes, errno, json, os, runpy, signal, subprocess, sys
from pathlib import Path
mode, guardian = sys.argv[1:]
original_pid = os.getpid()
real_open, real_send = os.pidfd_open, signal.pidfd_send_signal
real_read, real_cdll, real_wait = Path.read_text, ctypes.CDLL, os.waitpid
calls, command_attempts, reaped = [], [], []
def refuse_command(*args, **kwargs):
 command_attempts.append(args[0]); raise RuntimeError('Test refuses all workload execution')
subprocess.Popen = refuse_command
def open_pidfd(pid, *args):
 calls.append({'operation':'pidfd_open','pid':pid})
 if mode == 'pidfd-enosys': raise OSError(errno.ENOSYS, 'Injected unavailable pidfd syscall')
 if mode == 'pidfd-denied' or (mode == 'child-pidfd-denied' and pid != original_pid): raise PermissionError(errno.EPERM, 'Injected denied pidfd syscall')
 return real_open(pid, *args)
def send_pidfd(fd, sig, *args):
 calls.append({'operation':'pidfd_send_signal','signal':int(sig)})
 if mode == 'signal-enosys': raise OSError(errno.ENOSYS, 'Injected unavailable pidfd signal')
 if mode == 'signal-denied' or (mode == 'term-denied' and sig == signal.SIGTERM) or (mode == 'kill-denied' and sig == signal.SIGKILL): raise PermissionError(errno.EPERM, 'Injected denied pidfd signal')
 if (mode == 'term-undelivered' and sig == signal.SIGTERM) or (mode == 'kill-undelivered' and sig == signal.SIGKILL): return None
 return real_send(fd, sig, *args)
def read_proc(path, *args, **kwargs):
 if str(path).endswith('/children'):
  calls.append({'operation':'proc_children'})
  if mode == 'proc-missing': raise FileNotFoundError(errno.ENOENT, 'Injected unavailable proc children')
  if mode == 'proc-denied': raise PermissionError(errno.EACCES, 'Injected denied proc children')
  value = real_read(path, *args, **kwargs)
  if mode == 'proc-child-denied' and value.split(): raise PermissionError(errno.EACCES, 'Injected denied proc with children')
  return value
 return real_read(path, *args, **kwargs)
class Libc:
 def __init__(self, *args, **kwargs): self.real = real_cdll(*args, **kwargs)
 def prctl(self, option, *args):
  calls.append({'operation':'prctl','option':option})
  if (mode == 'subreaper-set-denied' and option == 36) or (mode == 'subreaper-get-denied' and option == 37): return -1
  if mode == 'subreaper-unconfirmed' and option == 37: return 0
  return self.real.prctl(option, *args)
def wait_child(pid, flags):
 result = real_wait(pid, flags)
 if result[0]: reaped.append({'pid':result[0], 'exitCode':os.waitstatus_to_exitcode(result[1])})
 return result
os.pidfd_open, signal.pidfd_send_signal = open_pidfd, send_pidfd
Path.read_text, ctypes.CDLL, os.waitpid = read_proc, Libc, wait_child
if mode == 'missing-open-api': del os.pidfd_open
if mode == 'missing-signal-api': del signal.pidfd_send_signal
sys.argv = [guardian, '80', '500']
code = runpy.run_path(guardian)['main']()
remaining = real_read(Path('/proc/self/task/'+str(original_pid)+'/children')).split()
print(json.dumps({'mode':mode,'pid':original_pid,'code':code,'calls':calls,'commandAttempts':command_attempts,'reaped':reaped,'remainingChildren':remaining}))
raise SystemExit(code)
`);
const unavailableCapabilities = [
  'missing-open-api', 'missing-signal-api', 'pidfd-enosys', 'pidfd-denied',
  'signal-enosys', 'signal-denied', 'child-pidfd-denied', 'term-denied', 'kill-denied',
  'term-undelivered', 'kill-undelivered', 'proc-missing', 'proc-denied', 'proc-child-denied',
  'subreaper-set-denied', 'subreaper-get-denied', 'subreaper-unconfirmed',
];
for (const mode of ['supported', ...unavailableCapabilities]) {
  test(`R3: guardian prerequisite ${mode} verifies capabilities before readiness or any command`, () => {
    const input = mode === 'supported' ? { type: 'stop' } : { type: 'start', command: 'must-never-execute', args: [] };
    const result = spawnSync('python3', [capabilityProbe, mode, guardianFile], {
      env: baseEnv, encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
      input: JSON.stringify(input) + '\n',
    });
    assert.equal(result.error, undefined); assert.equal(result.stderr, '');
    const evidence = JSON.parse(result.stdout);
    const telemetry = result.output[3].trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    writeFileSync(join(artifacts, 'capability-' + mode + '.json'), JSON.stringify({ ...evidence, telemetry }));
    assert.deepEqual(evidence.commandAttempts, [], 'No workload may be attempted before capabilities pass');
    assert.deepEqual(evidence.remainingChildren, [], 'Internal capability probes must be reaped even on refusal');
    assert(!telemetry.some(record => record.type === 'spawn'));
    if (mode === 'supported') {
      assert.equal(result.status, 0); assert.equal(evidence.code, 0);
      assert.equal(telemetry[0].type, 'guardian'); assert.equal(telemetry[0].ready, true);
      assert.equal(telemetry.at(-1).type, 'stopped');
      assert.deepEqual(evidence.calls.filter(call => call.operation === 'pidfd_send_signal').map(call => call.signal), [0, 15, 9]);
      assert.deepEqual(evidence.reaped.map(child => child.exitCode), [0, -9]);
      assert.equal(evidence.calls.filter(call => call.operation === 'pidfd_open').length, 3);
      assert.deepEqual(evidence.calls.filter(call => call.operation === 'prctl').map(call => call.option), [36, 37]);
    } else {
      assert.equal(result.status, 1); assert.equal(evidence.code, 1);
      assert.equal(telemetry.length, 1); assert.equal(telemetry[0].type, 'failure');
      assert.equal(telemetry[0].code, 'PREREQUISITE');
      assert(!telemetry.some(record => record.type === 'guardian'));
    }
  });
}

for (const exitCode of [143, 7]) {
  test(`TERM wrapper exit${exitCode} ${exitCode === 143 ? 'requires owned signal evidence and complete descendant reaping' : 'remains failure despite owned TERM and complete reaping'}`, async () => {
    const { createOwnedRuntime } = await import(helper);
    const runtime = createOwnedRuntime({ graceMs: 100, killMs: 1000 });
    try {
      const code = `import {spawn} from 'node:child_process';
process.on('SIGTERM',()=>process.exit(${exitCode}));
const grand=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)"],{stdio:['ignore','pipe','inherit']});
grand.stdout.once('data',()=>console.log(JSON.stringify({grandchild:grand.pid})));`;
      const child = runtime.launch(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] }, { service: true, label: 'controlled TERM wrapper' });
      const [data] = await runtime.guard(once(child.stdout, 'data', { signal: AbortSignal.timeout(2000) }));
      const { grandchild } = JSON.parse(data.toString());
      if (exitCode === 143) await runtime.shutdown();
      else await assert.rejects(runtime.shutdown(), /exited unexpectedly \(7\)/);
      assert.equal(child.exitCode, exitCode); assert.deepEqual(child.terminationSignals, ['SIGTERM']);
      assert.equal(runtime.cleanupComplete, true);
      assert.equal(runtime.failure === undefined, exitCode === 143);
      assert(runtime.outcomes.every(record => record.childrenReaped && record.guardianClosed));
      for (const pid of [...runtime.pids, grandchild]) assert.equal(alive(pid), false);
      writeFileSync(join(artifacts, 'term-wrapper-' + exitCode + '.json'), JSON.stringify({ pids: [...runtime.pids, grandchild], outcomes: runtime.outcomes }));
    } finally { await runtime.shutdown().catch(() => {}); runtime.dispose(); }
  });
}
test('unsolicited real service exit143 aborts immediately and remains failure after cleanup', async () => {
  const { createOwnedRuntime } = await import(helper);
  const runtime = createOwnedRuntime({ graceMs: 100, killMs: 500 });
  try {
    const child = runtime.launch(process.execPath, ['-e', 'setTimeout(()=>process.exit(143),30)'], { stdio: 'ignore' }, { service: true, label: 'unsolicited143' });
    const [code] = await once(child, 'exit', { signal: AbortSignal.timeout(2000) });
    assert.equal(code, 143); assert.equal(runtime.signal.aborted, true); assert.throws(() => runtime.check());
    assert.deepEqual(child.terminationSignals, []);
    await assert.rejects(runtime.shutdown(), /exited unexpectedly \(143\)/);
    assert.equal(runtime.cleanupComplete, true);
    for (const pid of runtime.pids) assert.equal(alive(pid), false);
    writeFileSync(join(artifacts, 'unsolicited143.json'), JSON.stringify({ pids: runtime.pids, outcomes: runtime.outcomes }));
  } finally { await runtime.shutdown().catch(() => {}); runtime.dispose(); }
});
test('exit143 delivered after stop request without actual command-signal evidence remains failure', async () => {
  const guardian = new EventEmitter(); guardian.pid = 424248;
  guardian.stdout = new PassThrough(); guardian.stderr = new PassThrough();
  guardian.stdin = new Writable({ write(_chunk, _encoding, next) { next(); } });
  guardian.stdio = [guardian.stdin, guardian.stdout, guardian.stderr, new PassThrough()];
  const { createOwnedRuntime } = await import(helper);
  const runtime = createOwnedRuntime({ graceMs: 10, killMs: 100, spawnGuardian: () => guardian });
  try {
    runtime.launch('modeled late143', [], {}, { service: true });
    const stopped = runtime.shutdown();
    guardian.stdio[3].write('{"type":"spawn","pid":424249}\n');
    guardian.stdio[3].write('{"type":"exit","code":143,"signal":null,"terminationSignals":[]}\n');
    guardian.stdio[3].write('{"type":"stopped","childrenReaped":true}\n');
    guardian.emit('exit', 0, null); guardian.stdio[3].end(); guardian.emit('close', 0, null);
    await assert.rejects(stopped, /exited unexpectedly \(143\)/);
    assert.equal(runtime.cleanupComplete, true); assert.match(runtime.failure.message, /\(143\)/);
  } finally { runtime.dispose(); }
});
