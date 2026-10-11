/**
 * Exercise sound.js against a mock Web Audio API, so "the sounds don't work" is
 * measurable rather than a matter of opinion.
 *
 * The bug this exists to catch: sound.js scheduled its nodes and then played
 * them into a SUSPENDED AudioContext, which is silent. A call that resolves
 * resume() but leaves the context not-running used to be treated as success.
 *
 * Run with: node src/__tests__/sound.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'sound.js');

let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${l}`); };
const section = (t) => console.log(`\n=== ${t} ===`);

// ── the mock: records every node and every scheduled envelope peak ──
const log = { created: 0, resumed: 0, oscillators: 0, sources: 0, peakGains: [] };

function makeParam(initial) {
  return {
    value: initial,
    setValueAtTime(x) { this.value = x; return this; },
    linearRampToValueAtTime(x) { this.value = x; log.peakGains.push(x); return this; },
    exponentialRampToValueAtTime(x) { this.value = x; return this; },
    setTargetAtTime(x) { this.value = x; return this; }
  };
}
function makeNode(kind) {
  return {
    kind,
    gain: makeParam(1), frequency: makeParam(440), Q: makeParam(1),
    threshold: makeParam(-20), knee: makeParam(18), ratio: makeParam(7),
    attack: makeParam(0.003), release: makeParam(0.16),
    type: 'sine', buffer: null, duration: 0.35,
    connect: () => ({}),
    start() { if (kind === 'oscillator') log.oscillators++; else if (kind === 'source') log.sources++; },
    stop() {}
  };
}

// The context does NOT flip to running when resume() resolves. Real browsers
// settle on a later tick, and Chrome reports 'interrupted' when something else
// holds the context. Mocking resume() as instant would hide the exact bug.
const behavior = { ticksToRunning: 1 };

class MockAudioContext {
  constructor() {
    log.created++;
    this.state = 'suspended';
    this.currentTime = 0;
    this.sampleRate = 48000;
    this.destination = makeNode('destination');
  }
  async resume() {
    log.resumed++;
    await new Promise((r) => setTimeout(r, behavior.ticksToRunning * 16));
    this.state = 'running';
  }
  createGain() { return makeNode('gain'); }
  createOscillator() { return makeNode('oscillator'); }
  createBufferSource() { return makeNode('source'); }
  createBiquadFilter() { return makeNode('filter'); }
  createDynamicsCompressor() { return makeNode('compressor'); }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len), duration: len / 48000 }; }
}

// Strip the ES module syntax so the file can be evaluated in a vm.
const body = fs.readFileSync(SRC, 'utf8')
  .replace(/^export const /gm, 'const ')
  .replace(/^export function /gm, 'function ')
  .replace(/export \{[^}]*\};?/g, '');

function makeSandbox(store) {
  const win = {
    AudioContext: MockAudioContext,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v))
    },
    addEventListener() {},
    dispatchEvent() {}
  };
  const sb = {
    console,
    performance: { now: () => Date.now() },
    Float32Array, Promise, setTimeout, clearTimeout,
    document: { addEventListener: () => {}, removeEventListener: () => {} },
    Element: class {},
    CustomEvent: class { constructor(t, o) { this.type = t; Object.assign(this, o || {}); } },
    AudioContext: MockAudioContext,
    window: win
  };
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(
    `${body}\n;globalThis.__api = { playButtonClick, playButtonHover, playCoinflipJoin, playBetPlaced, playCoinflipFlip, playCoinflipLanding, playError, unlockAudio, installGlobalSoundEffects, isSoundEnabled, setSoundEnabled };`,
    sb, { filename: 'sound.js' }
  );
  return sb;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const store = new Map();
  const sb = makeSandbox(store);
  const api = sb.__api;

  section('every export the app imports exists');
  for (const name of ['playButtonClick', 'playButtonHover', 'playCoinflipJoin', 'playBetPlaced',
    'playCoinflipFlip', 'playCoinflipLanding', 'playError', 'unlockAudio',
    'installGlobalSoundEffects', 'isSoundEnabled', 'setSoundEnabled']) {
    ok(typeof api[name] === 'function', `${name} is a function`);
  }

  section('the first sound on a cold context is not lost');
  ok(api.isSoundEnabled() === true, 'sound is on by default');
  log.oscillators = 0; log.sources = 0; log.peakGains = [];
  api.playBetPlaced();
  await wait(400);
  ok(log.created === 1, 'an AudioContext was created');
  ok(log.resumed >= 1, `the suspended context was resumed (${log.resumed} call(s))`);
  ok(log.oscillators > 0, `tones were scheduled AFTER it came up (${log.oscillators} oscillators)`);
  ok(Math.max(0, ...log.peakGains) > 0.01,
    `the loudest envelope peak is audible (${Math.max(0, ...log.peakGains)})`);

  section('every sound actually makes noise');
  for (const name of ['playButtonClick', 'playButtonHover', 'playCoinflipJoin',
    'playCoinflipFlip', 'playCoinflipLanding', 'playError']) {
    log.oscillators = 0; log.sources = 0; log.peakGains = [];
    await wait(300); // clear the per-sound cooldown
    api[name]();
    await wait(150);
    const peak = Math.max(0, ...log.peakGains);
    ok(log.oscillators > 0 || log.sources > 0,
      `${name} schedules audio (${log.oscillators} osc, ${log.sources} noise)`);
    ok(peak > 0.005, `${name} is above the inaudible floor (peak ${peak.toFixed(4)})`);
  }

  section('muting mutes, and unmuting unmutes');
  api.setSoundEnabled(false);
  ok(api.isSoundEnabled() === false, 'setSoundEnabled(false) is reflected in isSoundEnabled');
  log.oscillators = 0; log.sources = 0;
  await wait(300);
  api.playBetPlaced();
  await wait(150);
  ok(log.oscillators === 0 && log.sources === 0, 'nothing is scheduled while muted');

  api.setSoundEnabled(true);
  log.oscillators = 0;
  await wait(400);
  api.playBetPlaced();
  await wait(150);
  ok(log.oscillators > 0, `unmuting brings the sound back (${log.oscillators} oscillators)`);

  section('a stored "off" survives a reload');
  store.set('ampcoin:sound-enabled', 'false');
  const sb2 = makeSandbox(store);
  ok(sb2.__api.isSoundEnabled() === false, 'a stored "off" is honoured on load');
  log.oscillators = 0;
  await wait(150);
  sb2.__api.playBetPlaced();
  await wait(150);
  ok(log.oscillators === 0, 'and nothing plays');

  section('the global click handler is installed and removable');
  const handlers = {};
  const sb3 = makeSandbox(new Map());
  sb3.document.addEventListener = (t, f) => { handlers[t] = f; };
  sb3.window.addEventListener = (t, f) => { handlers[`win:${t}`] = f; };
  const before = Object.keys(handlers).length;
  const dispose = sb3.__api.installGlobalSoundEffects();
  ok(typeof handlers.pointerdown === 'function', 'pointerdown primes the context');
  ok(typeof handlers.touchstart === 'function',
    'touchstart primes it too, so a tap works on browsers without pointer events');
  ok(typeof handlers.click === 'function', 'click plays the click sound');
  ok(typeof handlers.pointerover === 'function', 'pointerover plays the hover sound');
  ok(Object.keys(handlers).length > before, 'it registered listeners');
  ok(typeof dispose === 'function', 'it returns a cleanup function for the effect to return');
  let threw = null;
  try { dispose(); } catch (e) { threw = e; }
  ok(!threw, `calling the cleanup does not throw${threw ? `: ${threw.message}` : ''}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });