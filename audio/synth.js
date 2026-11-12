// Web Audio 신스. 엔진이 만든 소리 정보({type:'note', midi} | {type:'perc', name})를 받아 소리만 낸다.
// 샘플 파일 없이 피아노처럼 감쇠하는 엔벨로프를 쓴다.

import { midiToFreq } from '../engine/keymap.js';

const MASTER_GAIN = 0.8;
const NOTE_PEAK = 0.32;        // 음 하나의 최대 음량
const ATTACK = 0.005;          // 초
const RELEASE = 0.08;          // 건반에서 손을 뗀 뒤 사라지는 시간 상수(초)
const LIVE_HOLD = 1.4;         // 길이 없이(직접 연주) 낸 음을 유지하는 시간(초)
const DECAY_AT_C4 = 0.8;       // C4의 감쇠 시간 상수(초). 낮은 음일수록 길다.
const HARMONICS = [0, 1, 0.45, 0.22, 0.1, 0.05, 0.025];

export class Synth {
  #ctx = null;
  #master = null;
  #wave = null;
  #noise = null;
  #voices = new Set();

  /** AudioContext는 처음 필요할 때 만든다(상호작용 전에는 정지 상태). */
  get context() {
    if (!this.#ctx) {
      const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      const ctx = new AudioContextClass({ latencyHint: 'interactive' });
      const compressor = ctx.createDynamicsCompressor();
      this.#master = ctx.createGain();
      this.#master.gain.value = MASTER_GAIN;
      this.#master.connect(compressor).connect(ctx.destination);
      this.#wave = ctx.createPeriodicWave(new Float32Array(HARMONICS.length), new Float32Array(HARMONICS));
      this.#ctx = ctx;
    }
    return this.#ctx;
  }

  get now() {
    return this.context.currentTime;
  }

  /** 사용자 동작(키 입력, 탭, 버튼) 안에서 호출해 소리를 켠다. 몇 번 불러도 된다. */
  unlock() {
    const ctx = this.context;
    if (ctx.state === 'running') return Promise.resolve();
    return ctx.resume().catch(() => {});
  }

  /**
   * @param {object} sound                 keymap.jamoToSound 결과
   * @param {object} [options]
   * @param {number} [options.when]        시작 시각(AudioContext 시간). 생략하면 지금.
   * @param {number} [options.duration]    길이(초). 생략하면 직접 연주용 기본 길이.
   * @param {number} [options.velocity]    세기 0~1
   */
  play(sound, { when, duration, velocity = 1 } = {}) {
    if (!sound) return;
    const start = Math.max(when ?? 0, this.now);
    if (sound.type === 'note') this.#note(sound.midi, start, duration, velocity);
    else if (sound.type === 'perc') this.#percussion(sound.name, start, velocity);
  }

  /** 울리고 있거나 예약된 소리를 모두 끈다. */
  stopAll() {
    if (!this.#ctx) return;
    const now = this.#ctx.currentTime;
    for (const voice of this.#voices) {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setTargetAtTime(0, now, 0.015);
      voice.source.stop(now + 0.15);
    }
  }

  #note(midi, start, duration, velocity) {
    const ctx = this.context;
    const freq = midiToFreq(midi);
    const peak = NOTE_PEAK * velocity;
    const decay = Math.min(2.5, Math.max(0.25, DECAY_AT_C4 * 2 ** ((60 - midi) / 24)));
    const off = start + (duration ?? LIVE_HOLD);

    const osc = ctx.createOscillator();
    osc.setPeriodicWave(this.#wave);
    osc.frequency.value = freq;

    // 때린 직후엔 밝고, 울리면서 어두워진다.
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.min(freq * 8, 12000), start);
    filter.frequency.setTargetAtTime(Math.min(freq * 2.5, 12000), start, 0.25);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak, start + ATTACK);
    gain.gain.setTargetAtTime(0, start + ATTACK, decay);
    gain.gain.setTargetAtTime(0, Math.max(off, start + ATTACK), RELEASE);

    osc.connect(filter).connect(gain).connect(this.#master);
    osc.start(start);
    osc.stop(off + RELEASE * 8);
    this.#register(osc, gain);
  }

  #percussion(name, start, velocity) {
    const ctx = this.context;
    const gain = ctx.createGain();
    let source;

    if (name === 'thump') {
      source = ctx.createOscillator();
      source.frequency.setValueAtTime(160, start);
      source.frequency.exponentialRampToValueAtTime(50, start + 0.12);
      gain.gain.setValueAtTime(0.7 * velocity, start);
      gain.gain.setTargetAtTime(0, start, 0.06);
      source.connect(gain);
      source.start(start);
      source.stop(start + 0.4);
    } else {
      source = ctx.createBufferSource();
      source.buffer = this.#noiseBuffer();
      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 6000;
      gain.gain.setValueAtTime(0.35 * velocity, start);
      gain.gain.setTargetAtTime(0, start, 0.02);
      source.connect(filter).connect(gain);
      source.start(start);
      source.stop(start + 0.15);
    }

    gain.connect(this.#master);
    this.#register(source, gain);
  }

  #register(source, gain) {
    const voice = { source, gain };
    this.#voices.add(voice);
    source.onended = () => {
      gain.disconnect();
      this.#voices.delete(voice);
    };
  }

  #noiseBuffer() {
    if (!this.#noise) {
      const ctx = this.context;
      const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.2), ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.#noise = buffer;
    }
    return this.#noise;
  }
}
