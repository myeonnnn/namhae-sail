import { audioOutput } from './sound';

/** 배경음의 크기와 음색을 정하는, 지금의 선박과 바다의 상태 */
export interface AmbientInput {
  /** 엔진의 회전수를 최대 회전수로 나눈 값 (0~1). 엔진이 꺼져 있으면 0이다. */
  rpmRatio: number;
  /** 유의파고 (m) */
  waveHeight: number;
  /** 풍속 (m/s) */
  windSpeed: number;
}

// 엔진음의 기본 진동수 (Hz): 공회전일 때와 최대 회전수일 때
const ENGINE_PITCH = [52, 96] as const;
// 엔진음의 크기: 공회전일 때와 최대 회전수일 때. 파도와 바람의 소리보다 작게, 깔리는 정도로만 둔다.
const ENGINE_VOLUME = [0.012, 0.03] as const;
// 값이 바뀔 때 소리가 따라가는 빠르기 (초). 뚝뚝 끊기지 않게 한다.
const SMOOTHING = 0.15;
// 파도 소리가 밀려왔다가 빠지는 주기 (Hz)
const WASH_RATE = 0.13;

/**
 * 계속 이어지는 배경음: 회전수를 따라 조금 높아지는 낮은 엔진음, 파고를 따라 커지는 파도 소리, 풍속을 따라 커지는 바람 소리.
 * 음원 파일 없이 발진기와 잡음으로 만든다. 브라우저가 소리를 허용한 뒤(사용자의 첫 입력 이후)에 처음 호출될 때 장치를 만든다.
 */
export class AmbientSound {
  private nodes?: {
    engineLow: OscillatorNode;
    engineHigh: OscillatorNode;
    engineFilter: BiquadFilterNode;
    engineGain: GainNode;
    waveFilter: BiquadFilterNode;
    waveGain: GainNode;
    windFilter: BiquadFilterNode;
    windGain: GainNode;
  };

  /** 매 프레임 호출한다. */
  update(input: AmbientInput): void {
    const audio = audioOutput();
    // 사용자가 화면을 누르거나 키를 누르기 전에는 브라우저가 소리를 막아 둔다.
    if (!audio || audio.context.state !== 'running') return;
    const { context } = audio;
    const nodes = (this.nodes ??= this.build(context, audio.output));
    const now = context.currentTime;
    const set = (param: AudioParam, value: number) => param.setTargetAtTime(value, now, SMOOTHING);

    // 엔진: 회전수가 오르면 음이 조금 높아지고 커진다. 높은 소리는 계속 걸러서 낮게 웅웅거리는 소리로 둔다.
    const rpm = Math.min(Math.max(input.rpmRatio, 0), 1);
    const pitch = ENGINE_PITCH[0] + (ENGINE_PITCH[1] - ENGINE_PITCH[0]) * rpm;
    set(nodes.engineLow.frequency, pitch);
    set(nodes.engineHigh.frequency, pitch * 2.02);
    set(nodes.engineFilter.frequency, 160 + 260 * rpm);
    set(nodes.engineGain.gain, rpm < 0.02 ? 0 : ENGINE_VOLUME[0] + (ENGINE_VOLUME[1] - ENGINE_VOLUME[0]) * rpm);

    // 파도: 파고가 높을수록 크고, 낮은 소리가 많이 섞인다.
    const sea = Math.min(input.waveHeight / 4, 1);
    // 걸러 내는 범위를 낮게 잡아서, 쉿 하는 잡음이 아니라 낮게 웅성거리는 소리가 되게 한다.
    set(nodes.waveFilter.frequency, 520 - 240 * sea);
    set(nodes.waveGain.gain, 0.02 + 0.07 * sea);

    // 바람: 풍속이 오르면 커지고 음이 높아진다.
    const wind = Math.min(input.windSpeed / 30, 1);
    set(nodes.windFilter.frequency, 260 + 380 * wind);
    set(nodes.windGain.gain, 0.035 * wind * wind);
  }

  private build(context: AudioContext, output: GainNode): NonNullable<AmbientSound['nodes']> {
    // 엔진: 부드러운 삼각파에 한 옥타브 위의 사인파를 조금 섞고, 높은 소리를 걸러 낸다.
    // 톱니파는 배음이 많아서 날카롭게 웅웅거리므로 쓰지 않는다.
    const engineFilter = context.createBiquadFilter();
    engineFilter.type = 'lowpass';
    const engineGain = context.createGain();
    engineGain.gain.value = 0;
    const engineLow = context.createOscillator();
    const engineHigh = context.createOscillator();
    engineLow.type = 'triangle';
    engineHigh.type = 'sine';
    const highMix = context.createGain();
    highMix.gain.value = 0.25;
    engineLow.connect(engineFilter);
    engineHigh.connect(highMix).connect(engineFilter);
    engineFilter.connect(engineGain).connect(output);
    engineLow.start();
    engineHigh.start();

    // 파도와 바람은 같은 잡음을 서로 다르게 걸러서 만든다.
    const noise = context.createBufferSource();
    noise.buffer = createNoise(context, 3);
    noise.loop = true;

    const waveFilter = context.createBiquadFilter();
    waveFilter.type = 'lowpass';
    const waveGain = context.createGain();
    waveGain.gain.value = 0;
    // 파도가 밀려왔다가 빠지는 것처럼, 느린 진동으로 음량을 오르내린다.
    const wash = context.createGain();
    wash.gain.value = 0.55;
    const washRate = context.createOscillator();
    washRate.frequency.value = WASH_RATE;
    const washDepth = context.createGain();
    washDepth.gain.value = 0.45;
    washRate.connect(washDepth).connect(wash.gain);
    washRate.start();
    noise.connect(waveFilter).connect(wash).connect(waveGain).connect(output);

    const windFilter = context.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.Q.value = 0.8;
    const windGain = context.createGain();
    windGain.gain.value = 0;
    noise.connect(windFilter).connect(windGain).connect(output);
    noise.start();

    return { engineLow, engineHigh, engineFilter, engineGain, waveFilter, waveGain, windFilter, windGain };
  }
}

/** 지정한 길이(초)의 잡음을 만든다. 이웃한 값을 많이 섞어서 높은 소리를 줄인다. 그대로 쓰면 귀에 거슬리는 쉿 소리가 된다. */
function createNoise(context: AudioContext, seconds: number): AudioBuffer {
  const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
  const data = buffer.getChannelData(0);
  let previous = 0;
  for (let i = 0; i < data.length; i++) {
    previous = previous * 0.85 + (Math.random() * 2 - 1) * 0.15;
    data[i] = previous;
  }
  return buffer;
}
