const STORAGE_KEY = 'ampcoin:sound-enabled';
const LEGACY_STORAGE_KEY = 'ampbet:sound-enabled';
export const SOUND_CHANGE_EVENT = 'ampcoin:soundchange';

let enabled = readEnabled();
let audioContext = null;
let masterGain = null;
let compressor = null;
let noiseBuffer = null;
let resumePromise = null;
let storageListenerAttached = false;
const lastPlayedAt = new Map();

function readEnabled() {
  try {
    const current = window.localStorage.getItem(STORAGE_KEY);
    if (current !== null) return current !== 'false';
    const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy !== null) {
      window.localStorage.setItem(STORAGE_KEY, legacy);
      return legacy !== 'false';
    }
  } catch (_) {
    // Fall through to the default when storage is unavailable.
  }
  return true;
}

function ensureAudio() {
  if (typeof window === 'undefined') return null;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;

  if (!audioContext) {
    try {
      audioContext = new AudioContextClass();
    } catch (_) {
      return null;
    }
    masterGain = audioContext.createGain();
    masterGain.gain.value = enabled ? 0.28 : 0;

    compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.knee.value = 18;
    compressor.ratio.value = 7;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.16;

    masterGain.connect(compressor);
    compressor.connect(audioContext.destination);

    const sampleRate = audioContext.sampleRate;
    noiseBuffer = audioContext.createBuffer(1, Math.floor(sampleRate * 0.35), sampleRate);
    const channel = noiseBuffer.getChannelData(0);
    for (let i = 0; i < channel.length; i += 1) {
      channel[i] = Math.random() * 2 - 1;
    }
  }

  if (!storageListenerAttached) {
    storageListenerAttached = true;
    window.addEventListener('storage', (event) => {
      if (event.key !== STORAGE_KEY && event.key !== LEGACY_STORAGE_KEY) return;
      let nextValue = event.newValue;
      try {
        const current = window.localStorage.getItem(STORAGE_KEY);
        if (current !== null) nextValue = current;
      } catch (_) { /* private browsing can deny storage */ }
      enabled = nextValue !== 'false';
      if (masterGain && audioContext) {
        masterGain.gain.setTargetAtTime(enabled ? 0.28 : 0, audioContext.currentTime, 0.015);
      }
    });
  }

  return audioContext;
}

function resumeAudio() {
  const context = ensureAudio();
  if (!context) return Promise.resolve(false);
  if (context.state === 'running') return Promise.resolve(true);
  if (!resumePromise) {
    resumePromise = context.resume()
      .then(() => true)
      .catch(() => false)
      .finally(() => { resumePromise = null; });
  }
  return resumePromise;
}

function withAudio(callback) {
  if (!enabled) return;
  const context = ensureAudio();
  if (!context || !masterGain) return;
  if (context.state === 'running') {
    callback(context);
    return;
  }
  resumeAudio().then((ready) => {
    if (ready && enabled) callback(context);
  });
}

function scheduleTone(context, {
  frequency,
  endFrequency = frequency,
  type = 'sine',
  delay = 0,
  duration = 0.1,
  gain = 0.06,
  attack = 0.006
}) {
  const start = context.currentTime + Math.max(0, delay);
  const end = start + Math.max(0.025, duration);
  const oscillator = context.createOscillator();
  const envelope = context.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(Math.max(20, frequency), start);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), end);

  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.linearRampToValueAtTime(gain, start + Math.min(attack, duration * 0.3));
  envelope.gain.exponentialRampToValueAtTime(0.0001, end);

  oscillator.connect(envelope);
  envelope.connect(masterGain);
  oscillator.start(start);
  oscillator.stop(end + 0.025);
}

function scheduleNoise(context, {
  delay = 0,
  duration = 0.08,
  gain = 0.03,
  frequency = 1800,
  endFrequency = frequency,
  type = 'bandpass',
  q = 1.2
}) {
  if (!noiseBuffer) return;
  const start = context.currentTime + Math.max(0, delay);
  const end = start + Math.max(0.02, duration);
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const envelope = context.createGain();

  source.buffer = noiseBuffer;
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(Math.max(40, frequency), start);
  filter.frequency.exponentialRampToValueAtTime(Math.max(40, endFrequency), end);

  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.linearRampToValueAtTime(gain, start + 0.008);
  envelope.gain.exponentialRampToValueAtTime(0.0001, end);

  source.connect(filter);
  filter.connect(envelope);
  envelope.connect(masterGain);
  source.start(start, 0, Math.min(duration + 0.03, noiseBuffer.duration));
  source.stop(end + 0.02);
}

function allowSound(key, cooldownMs) {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const previous = lastPlayedAt.get(key) || 0;
  if (now - previous < cooldownMs) return false;
  lastPlayedAt.set(key, now);
  return true;
}

export function isSoundEnabled() {
  return enabled;
}

export function setSoundEnabled(nextEnabled) {
  enabled = Boolean(nextEnabled);
  try {
    window.localStorage.setItem(STORAGE_KEY, String(enabled));
  } catch (_) { /* storage can be unavailable in private browsing */ }

  if (masterGain && audioContext) {
    masterGain.gain.setTargetAtTime(enabled ? 0.28 : 0, audioContext.currentTime, 0.015);
  }
  window.dispatchEvent(new CustomEvent(SOUND_CHANGE_EVENT, { detail: { enabled } }));
}

export function unlockAudio() {
  return resumeAudio();
}

export function playButtonClick() {
  if (!allowSound('button-click', 24)) return;
  withAudio((context) => {
    scheduleTone(context, {
      frequency: 540,
      endFrequency: 760,
      type: 'triangle',
      duration: 0.055,
      gain: 0.055
    });
    scheduleNoise(context, {
      duration: 0.025,
      gain: 0.012,
      frequency: 2300,
      endFrequency: 1500,
      q: 0.7
    });
  });
}

export function playButtonHover() {
  if (!allowSound('button-hover', 48)) return;
  withAudio((context) => {
    scheduleTone(context, {
      frequency: 980,
      endFrequency: 1320,
      type: 'sine',
      duration: 0.035,
      gain: 0.014,
      attack: 0.003
    });
  });
}

export function playCoinflipJoin() {
  if (!allowSound('coinflip-join', 180)) return;
  withAudio((context) => {
    [330, 440, 554].forEach((frequency, index) => {
      scheduleTone(context, {
        frequency,
        endFrequency: frequency * 1.04,
        type: 'triangle',
        delay: index * 0.055,
        duration: 0.095,
        gain: 0.042
      });
    });
  });
}

export function playBetPlaced() {
  if (!allowSound('bet-placed', 220)) return;
  withAudio((context) => {
    [196, 294, 392].forEach((frequency, index) => {
      scheduleTone(context, {
        frequency,
        endFrequency: frequency * 1.08,
        type: 'triangle',
        delay: index * 0.075,
        duration: 0.13,
        gain: 0.05
      });
    });
    scheduleNoise(context, {
      delay: 0.02,
      duration: 0.12,
      gain: 0.018,
      frequency: 900,
      endFrequency: 2400,
      q: 0.8
    });
  });
}

export function playCoinflipFlip() {
  if (!allowSound('coinflip-flip', 120)) return;
  withAudio((context) => {
    scheduleNoise(context, {
      duration: 0.32,
      gain: 0.038,
      frequency: 620,
      endFrequency: 2600,
      q: 0.7
    });
    scheduleTone(context, {
      frequency: 170,
      endFrequency: 520,
      type: 'sine',
      duration: 0.27,
      gain: 0.035
    });
  });
}

export function playCoinflipLanding(side = 'heads') {
  if (!allowSound('coinflip-landing', 90)) return;
  withAudio((context) => {
    const base = side === 'tails' ? 560 : 690;
    scheduleNoise(context, {
      duration: 0.07,
      gain: 0.05,
      frequency: 3200,
      endFrequency: 1200,
      q: 0.65
    });
    scheduleTone(context, {
      frequency: base,
      endFrequency: base * 0.82,
      type: 'triangle',
      duration: 0.11,
      gain: 0.075
    });
    scheduleTone(context, {
      frequency: base * 1.51,
      endFrequency: base * 1.2,
      type: 'sine',
      delay: 0.012,
      duration: 0.075,
      gain: 0.026
    });
  });
}

export function playError() {
  if (!allowSound('error', 260)) return;
  withAudio((context) => {
    scheduleTone(context, {
      frequency: 250,
      endFrequency: 165,
      type: 'square',
      duration: 0.13,
      gain: 0.035
    });
    scheduleTone(context, {
      frequency: 190,
      endFrequency: 120,
      type: 'square',
      delay: 0.12,
      duration: 0.16,
      gain: 0.03
    });
  });
}

export function installGlobalSoundEffects() {
  const selector = [
    'button:not([disabled])',
    'a[href]',
    '[role="button"]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    'summary'
  ].join(',');

  const getInteractive = (target) => {
    if (!(target instanceof Element)) return null;
    return target.closest(selector);
  };

  const primeAudio = () => { unlockAudio(); };
  const handleClick = (event) => {
    const control = getInteractive(event.target);
    if (!control || control.hasAttribute('data-sound-control')) return;
    playButtonClick();
  };
  const handleHover = (event) => {
    if (event.pointerType === 'touch') return;
    const control = getInteractive(event.target);
    if (!control || control.hasAttribute('data-sound-control')) return;
    if (control.contains(event.relatedTarget)) return;
    playButtonHover();
  };

  document.addEventListener('pointerdown', primeAudio, true);
  document.addEventListener('keydown', primeAudio, true);
  document.addEventListener('click', handleClick, true);
  document.addEventListener('pointerover', handleHover, true);

  return () => {
    document.removeEventListener('pointerdown', primeAudio, true);
    document.removeEventListener('keydown', primeAudio, true);
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('pointerover', handleHover, true);
  };
}
