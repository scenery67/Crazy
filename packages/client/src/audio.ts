import type { GameEvent } from './events.js';

type SoundKind = GameEvent['t'];

/**
 * 효과음과 배경음.
 *
 * `public/sounds/`에 음원 파일이 있으면 그것을 쓰고, 없으면 합성음으로 대신한다.
 * 스프라이트와 같은 계약이라 파일이 없어도 게임은 그대로 돌아간다.
 * 다만 스프라이트와 달리 **종류별로** 대체한다 — 일부만 음원이어도
 * 화면처럼 어색해지지 않기 때문이다.
 *
 * 파일 이름은 원작 것을 그대로 쓰지 않고 이벤트 이름을 따른다.
 * 어떤 출처의 음원이든 이름만 맞추면 꽂히게 하기 위해서다:
 *
 *   sounds/bubble.mp3   물풍선 설치      sounds/trap.mp3    갇힘
 *   sounds/explode.mp3  폭발             sounds/rescue.mp3  구출
 *   sounds/break.mp3    블록 파괴        sounds/death.mp3   사망
 *   sounds/pickup.mp3   아이템 획득      sounds/bgm.mp3     배경음 (반복)
 *
 * .mp3가 없으면 같은 이름의 .wav를 찾는다.
 *
 * AudioContext는 사용자가 화면을 건드리기 전에는 만들 수 없다(브라우저 정책).
 * 그래서 첫 입력 때 unlock()으로 깨우고, 그 시점에 음원을 읽는다.
 */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private samples = new Map<string, AudioBuffer>();
  private bgm: AudioBufferSourceNode | null = null;
  private isMuted = false;
  /** 같은 소리가 한 틱에 여러 번 겹치면 귀가 아프다 */
  private playedThisFrame = new Set<string>();

  get muted(): boolean {
    return this.isMuted;
  }

  set muted(value: boolean) {
    this.isMuted = value;
    if (this.master) this.master.gain.value = value ? 0 : 0.25;
    if (value) this.stopBgm();
    else this.startBgm();
  }

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor =
      window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.isMuted ? 0 : 0.25;
    this.master.connect(this.ctx.destination);

    void this.loadSamples();
  }

  play(events: readonly GameEvent[]): void {
    if (this.isMuted || !this.ctx || !this.master) return;
    this.playedThisFrame.clear();

    for (const e of events) {
      if (this.playedThisFrame.has(e.t)) continue;
      this.playedThisFrame.add(e.t);

      const sample = this.samples.get(e.t);
      if (sample) {
        // 내 캐릭터에게 일어난 일은 조금 더 크게 들린다
        const loud = 'mine' in e && e.mine;
        this.playBuffer(sample, loud ? 1 : 0.6);
      } else {
        this.synth(e);
      }
    }
  }

  // ─────────────────────────── 음원 ───────────────────────────

  private async loadSamples(): Promise<void> {
    const base = `${import.meta.env.BASE_URL}sounds/`;
    const names: (SoundKind | 'bgm')[] = [
      'bubble',
      'explode',
      'break',
      'pickup',
      'trap',
      'rescue',
      'death',
      'bgm',
    ];

    await Promise.all(
      names.map(async (name) => {
        const buffer = await this.fetchSample(base, name);
        if (buffer) this.samples.set(name, buffer);
      }),
    );
    this.startBgm();
  }

  /** .mp3를 먼저 보고 없으면 .wav. 둘 다 없으면 합성음으로 간다 */
  private async fetchSample(base: string, name: string): Promise<AudioBuffer | null> {
    for (const ext of ['mp3', 'wav', 'ogg']) {
      try {
        const res = await fetch(`${base}${name}.${ext}`);
        if (!res.ok) continue;
        const bytes = await res.arrayBuffer();
        return await this.ctx!.decodeAudioData(bytes);
      } catch {
        // 없거나 못 읽는 형식이면 다음 확장자로
      }
    }
    return null;
  }

  private playBuffer(buffer: AudioBuffer, gain: number): void {
    const src = this.ctx!.createBufferSource();
    src.buffer = buffer;
    const env = this.ctx!.createGain();
    env.gain.value = gain;
    src.connect(env).connect(this.master!);
    src.start();
  }

  private startBgm(): void {
    if (this.bgm || this.isMuted || !this.ctx || !this.master) return;
    const buffer = this.samples.get('bgm');
    if (!buffer) return;

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    // 배경음은 효과음을 덮지 않게 낮춘다
    const env = this.ctx.createGain();
    env.gain.value = 0.35;
    src.connect(env).connect(this.master);
    src.start();
    this.bgm = src;
  }

  private stopBgm(): void {
    if (!this.bgm) return;
    try {
      this.bgm.stop();
    } catch {
      // 이미 멈춘 경우
    }
    this.bgm = null;
  }

  // ─────────────────────────── 합성음 (폴백) ───────────────────────────

  private synth(e: GameEvent): void {
    switch (e.t) {
      case 'bubble':
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
        this.tone({ from: 660, to: 660, dur: 0.07, type: 'square', gain: 0.22 });
        this.tone({ from: 990, to: 990, dur: 0.09, type: 'square', gain: 0.22, delay: 0.07 });
        break;
      case 'trap':
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
