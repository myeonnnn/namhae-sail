/**
 * 효과음. 음원 파일 없이 Web Audio의 발진기로 짧은 음을 만든다.
 * 브라우저는 사용자가 화면을 누르거나 키를 누른 뒤에만 소리를 허용하므로, 처음 소리를 낼 때 오디오 장치를 연다.
 */

let context: AudioContext | undefined;

function audio(): AudioContext | undefined {
  try {
    context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume();
    return context;
  } catch {
    // 소리를 낼 수 없는 환경에서는 조용히 넘어간다.
    return undefined;
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
  const ctx = audio();
  if (!ctx) return;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  const at = ctx.currentTime + start;
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  // 음이 뚝 끊기면 딸깍 소리가 나므로, 짧게 올렸다가 서서히 줄인다.
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(volume, at + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  oscillator.connect(gain).connect(ctx.destination);
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
