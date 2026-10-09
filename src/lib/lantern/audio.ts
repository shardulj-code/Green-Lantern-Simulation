type Bus = {
  ctx: AudioContext;
  master: GainNode;
  noise: AudioBuffer;
};

let bus: Bus | null = null;
let muted = false;

function context() {
  if (!bus) {
    const ctx = new AudioContext({ latencyHint: "interactive" });
    const master = ctx.createGain();
    master.gain.value = 0.85;
    master.connect(ctx.destination);
    const noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    bus = { ctx, master, noise };
  }
  return bus;
}

/** Call synchronously inside the first pointer/key gesture. */
export function unlockAudio() {
  const { ctx } = context();
  if (ctx.state === "suspended") void ctx.resume();
}

export function resumeAudio() {
  if (!bus) return;
  if (bus.ctx.state === "suspended") void bus.ctx.resume();
}

export function setAudioMuted(next: boolean) {
  muted = next;
  if (bus) bus.master.gain.setTargetAtTime(next ? 0 : 0.85, bus.ctx.currentTime, 0.02);
}

export function audioMuted() {
  return muted;
}

function env(peak: number, dur: number) {
  const { ctx, master } = context();
  const gain = ctx.createGain();
  gain.connect(master);
  const t = ctx.currentTime;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.018);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  return { ctx, gain, t };
}

function tone(freq: number, dur: number, type: OscillatorType, peak: number, slideTo?: number) {
  if (muted) return;
  const { ctx, gain, t } = env(peak, dur);
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t + dur);
  osc.connect(gain);
  osc.start(t);
  osc.stop(t + dur + 0.02);
  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
  };
}

function whoosh(dur: number, peak: number) {
  if (muted || !bus) return;
  const { ctx, gain, t } = env(peak, dur);
  const src = ctx.createBufferSource();
  src.buffer = bus.noise;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(400, t);
  filter.frequency.exponentialRampToValueAtTime(1800, t + dur * 0.6);
  filter.Q.value = 0.7;
  src.connect(filter);
  filter.connect(gain);
  src.start(t);
  src.stop(t + dur);
  src.onended = () => {
    src.disconnect();
    filter.disconnect();
    gain.disconnect();
  };
}

export const sfx = {
  equip() {
    tone(220, 0.34, "sawtooth", 0.08, 880);
    tone(440, 0.42, "sine", 0.12, 1320);
    whoosh(0.28, 0.1);
  },
  select() {
    tone(740, 0.09, "square", 0.05, 980);
  },
  form() {
    whoosh(0.36, 0.14);
    tone(160, 0.4, "triangle", 0.08, 420);
  },
  active() {
    tone(520, 0.16, "sine", 0.06, 760);
  },
  dismiss() {
    tone(480, 0.22, "triangle", 0.07, 90);
    whoosh(0.18, 0.06);
  },
  recharge() {
    tone(262, 0.16, "sine", 0.07, 392);
    tone(392, 0.2, "sine", 0.06, 523);
    tone(523, 0.28, "triangle", 0.07, 784);
  },
  low() {
    tone(180, 0.14, "square", 0.06, 120);
    setTimeout(() => tone(140, 0.18, "square", 0.05, 90), 150);
  },
  suit() {
    tone(196, 0.45, "sine", 0.07, 294);
    tone(294, 0.5, "triangle", 0.06, 392);
    whoosh(0.4, 0.08);
  },
};
