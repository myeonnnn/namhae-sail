/**
 * 효과음. 음원 파일 없이 Web Audio의 발진기로 짧은 음을 만든다.
 * 브라우저는 사용자가 화면을 누르거나 키를 누른 뒤에만 소리를 허용하므로, 처음 소리를 낼 때 오디오 장치를 연다.
 */

const MUTE_KEY = 'namhae-sail:muted';

let context: AudioContext | undefined;
let master: GainNode | undefined;
let muted = readMuted();

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

/** 모든 소리가 거쳐 가는 출력. 소리를 끄면 이 지점의 음량을 0으로 내린다. 소리를 낼 수 없는 환경이면 undefined이다. */
export function audioOutput(): { context: AudioContext; output: GainNode } | undefined {
  try {
    if (!context) {
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(context.destination);
    }
    if (context.state === 'suspended') void context.resume();
    return { context, output: master! };
  } catch {
    // 소리를 낼 수 없는 환경에서는 조용히 넘어간다.
    return undefined;
  }
}

export function isMuted(): boolean {
  return muted;
}

/** 소리를 끄거나 켠다. 다음에 접속했을 때에도 유지되도록 브라우저에 기억해 둔다. */
export function setMuted(value: boolean): void {
  muted = value;
  if (context && master) master.gain.setTargetAtTime(value ? 0 : 1, context.currentTime, 0.05);
  try {
    localStorage.setItem(MUTE_KEY, value ? '1' : '0');
  } catch {
    // 저장하지 못해도 이번 접속에서는 적용된다.
  }
}

/** 한 음을 낸다. start는 지금부터 몇 초 뒤에 시작할지이다. */
function tone(
  frequency: number,
  start: number,
  duration: number,
  volume = 0.12,
  type: OscillatorType = 'triangle',
): void {
  const audio = audioOutput();
  if (!audio) return;
  const { context: ctx, output } = audio;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  const at = ctx.currentTime + start;
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  // 음이 뚝 끊기면 딸깍 소리가 나므로, 짧게 올렸다가 서서히 줄인다.
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(volume, at + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  oscillator.connect(gain).connect(output);
  oscillator.start(at);
  oscillator.stop(at + duration + 0.02);
}

/** 카운트다운의 숫자가 바뀔 때 */
export function playCount(): void {
  tone(440, 0, 0.18);
}

/** 출발 */
export function playGo(): void {
  tone(880, 0, 0.5, 0.16);
}

/** 관문을 통과했을 때 */
export function playGate(): void {
  tone(660, 0, 0.12);
  tone(990, 0.09, 0.22);
}

/** 완주했을 때의 팡파르: 으뜸화음을 차례로 올린 뒤에 마지막 화음을 길게 울린다. */
export function playFanfare(): void {
  const notes: [frequency: number, start: number, duration: number][] = [
    [523.25, 0, 0.16],
    [659.25, 0.14, 0.16],
    [783.99, 0.28, 0.16],
    [1046.5, 0.42, 0.3],
    [783.99, 0.74, 0.14],
    [1046.5, 0.88, 0.9],
    [1318.5, 0.88, 0.9],
    [783.99, 0.88, 0.9],
  ];
  for (const [frequency, start, duration] of notes) tone(frequency, start, duration, 0.11, 'square');
}

let splashNoise: AudioBuffer | undefined;

/**
 * 부서지는 마루가 선체를 때리는 소리: 짧게 터졌다가 잦아드는 잡음.
 * 처음에는 높은 소리까지 섞여서 철썩하고, 걸러 내는 범위를 빠르게 낮춰서 물이 쏟아지는 소리로 이어지게 한다.
 * @param intensity 0~1 범위의 세기. 클수록 크고 길다.
 */
export function playSplash(intensity: number): void {
  const audio = audioOutput();
  if (!audio || intensity <= 0) return;
  const { context: ctx, output } = audio;
  if (!splashNoise) {
    splashNoise = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
    const data = splashNoise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const strength = Math.min(intensity, 1);
  const duration = 0.45 + 0.6 * strength;
  const now = ctx.currentTime;

  const source = ctx.createBufferSource();
  source.buffer = splashNoise;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(2600 + 2400 * strength, now);
  filter.frequency.exponentialRampToValueAtTime(380, now + duration);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.1 + 0.22 * strength, now + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  source.connect(filter).connect(gain).connect(output);
  source.start(now);
  source.stop(now + duration + 0.05);
}
