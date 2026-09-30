// Tiny synthesized sound set (no audio files): wooden "knock" for moves, sharper for captures.
import { settings } from './store.js';

let ctx = null;
let noise = null;

function audio() {
  if (!settings.value.sound) return null;
  try {
    if (!ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ctx = new C();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch { return null; }
}

function noiseBuffer(c) {
  if (noise && noise.sampleRate === c.sampleRate) return noise;
  const len = Math.floor(c.sampleRate * 0.15);
  noise = c.createBuffer(1, len, c.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  return noise;
}

function knock({ freq = 1000, q = 1.4, decay = 0.08, gain = 0.5, delay = 0 } = {}) {
  const c = audio();
  if (!c) return;
  const t = c.currentTime + delay;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
  src.connect(bp).connect(g).connect(c.destination);
  src.start(t);
  src.stop(t + decay + 0.03);
}

function tone(freq, dur, { type = 'sine', gain = 0.12, delay = 0 } = {}) {
  const c = audio();
  if (!c) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export const sounds = {
  unlock() { audio(); },
  move() { knock({ freq: 1150, decay: 0.07, gain: 0.6 }); knock({ freq: 320, decay: 0.05, gain: 0.3 }); },
  capture() { knock({ freq: 760, q: 0.9, decay: 0.13, gain: 0.9 }); knock({ freq: 2100, decay: 0.035, gain: 0.3, delay: 0.008 }); },
  castle() { knock({ freq: 1150, decay: 0.06, gain: 0.55 }); knock({ freq: 1000, decay: 0.07, gain: 0.5, delay: 0.1 }); },
  check() { knock({ freq: 1150, decay: 0.07, gain: 0.55 }); tone(987, 0.12, { delay: 0.03, gain: 0.07, type: 'triangle' }); },
  promote() { knock({ freq: 1150, decay: 0.07, gain: 0.55 }); tone(1318, 0.14, { delay: 0.04, gain: 0.06 }); },
  end() { tone(523, 0.3, { gain: 0.09 }); tone(659, 0.3, { delay: 0.12, gain: 0.09 }); tone(784, 0.5, { delay: 0.24, gain: 0.09 }); },
  error() { tone(196, 0.2, { type: 'triangle', gain: 0.12 }); tone(147, 0.28, { type: 'triangle', gain: 0.1, delay: 0.12 }); },
  good() { tone(784, 0.1, { gain: 0.08 }); tone(1046, 0.18, { delay: 0.08, gain: 0.08 }); },
  alert() { tone(660, 0.1, { gain: 0.07, type: 'triangle' }); tone(660, 0.1, { delay: 0.14, gain: 0.07, type: 'triangle' }); },
  tick() { tone(1400, 0.04, { gain: 0.05, type: 'square' }); },
  /** Pick the right sound for a tree node (after its move). */
  forNode(node) {
    if (!node || !node.uci) return;
    if (node.check) this.check();
    else if (node.promotion) this.promote();
    else if (node.castle) this.castle();
    else if (node.captured) this.capture();
    else this.move();
  },
};
