import type { GameEvent } from './events.js';

/**
 * Web Audio로 직접 합성하는 효과음.
 *
 * 음원 파일을 쓰지 않는 이유는 저작권이다. 참고 프로젝트의 효과음과 BGM은
 * 전부 원작 것이라 배포본에 넣을 수 없다. 합성음은 파일이 없으므로
 * 공개 배포본에도 그대로 들어가고, 스프라이트처럼 갈라질 일이 없다.
 *
 * AudioContext는 사용자가 화면을 건드리기 전에는 만들 수 없다(브라우저 정책).
 * 그래서 첫 입력 때 unlock()으로 깨운다.
 */
export class GameAudio {
  muted = false;

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** 같은 소리가 한 틱에 여러 번 겹치면 귀가 아프다 */
  private playedThisFrame = new Set<string>();

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.25;
    this.master.connect(this.ctx.destination);
  }

  play(events: readonly GameEvent[]): void {
    if (this.muted || !this.ctx || !this.master) return;
    this.playedThisFrame.clear();

    for (const e of events) {
      if (this.playedThisFrame.has(e.t)) continue;
      this.playedThisFrame.add(e.t);

      switch (e.t) {
        case 'bubble':
          // 물풍선을 내려놓는 둔탁한 소리
          this.tone({ from: 320, to: 180, dur: 0.09, type: 'sine', gain: 0.5 });
          break;
        case 'explode':
          this.noise({ dur: 0.32, gain: 0.55, cutoffFrom: 1800, cutoffTo: 180 });
          this.tone({ from: 150, to: 50, dur: 0.28, type: 'sine', gain: 0.5 });
          break;
        case 'break':
          this.noise({ dur: 0.12, gain: 0.25, cutoffFrom: 3200, cutoffTo: 900 });
          break;
        case 'pickup':
          // 두 음을 올려서 "좋은 일"이라는 신호를 준다
          this.tone({ from: 660, to: 660, dur: 0.07, type: 'square', gain: 0.22 });
          this.tone({ from: 990, to: 990, dur: 0.09, type: 'square', gain: 0.22, delay: 0.07 });
          break;
        case 'trap':
          // 내려가는 음 — 갇혔다
          this.tone({ from: 520, to: 160, dur: 0.3, type: 'triangle', gain: e.mine ? 0.6 : 0.3 });
          break;
        case 'rescue':
          this.tone({ from: 260, to: 780, dur: 0.22, type: 'triangle', gain: e.mine ? 0.6 : 0.3 });
          break;
        case 'death':
          this.tone({ from: 200, to: 40, dur: 0.5, type: 'sawtooth', gain: e.mine ? 0.6 : 0.28 });
          break;
      }
    }
  }

  private tone(o: {
    from: number;
    to: number;
    dur: number;
    type: OscillatorType;
    gain: number;
    delay?: number;
  }): void {
    const ctx = this.ctx!;
    const at = ctx.currentTime + (o.delay ?? 0);

    const osc = ctx.createOscillator();
    osc.type = o.type;
    osc.frequency.setValueAtTime(o.from, at);
    if (o.to !== o.from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), at + o.dur);

    const env = ctx.createGain();
    // 시작을 0에서 올려야 딱 소리가 나지 않는다
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(o.gain, at + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, at + o.dur);

    osc.connect(env).connect(this.master!);
    osc.start(at);
    osc.stop(at + o.dur + 0.02);
  }

  /** 폭발·파괴처럼 음정이 없는 소리 */
  private noise(o: { dur: number; gain: number; cutoffFrom: number; cutoffTo: number }): void {
    const ctx = this.ctx!;
    const at = ctx.currentTime;
    const frames = Math.ceil(ctx.sampleRate * o.dur);

    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buffer;

    // 저역으로 쓸어내려야 "펑" 하고 퍼지는 느낌이 난다
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(o.cutoffFrom, at);
    filter.frequency.exponentialRampToValueAtTime(o.cutoffTo, at + o.dur);

    const env = ctx.createGain();
    env.gain.setValueAtTime(o.gain, at);
    env.gain.exponentialRampToValueAtTime(0.0001, at + o.dur);

    src.connect(filter).connect(env).connect(this.master!);
    src.start(at);
    src.stop(at + o.dur);
  }
}
