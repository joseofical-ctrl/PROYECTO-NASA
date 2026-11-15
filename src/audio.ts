// Web Audio API synth: no external files.
let ctx: AudioContext | null = null
let master: GainNode | null = null
let musicGain: GainNode | null = null
let musicTimer: number | null = null
let musicOn = false
let step = 0

function ensure(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext()
    master = ctx.createGain()
    master.gain.value = 0.5
    master.connect(ctx.destination)
    musicGain = ctx.createGain()
    musicGain.gain.value = 0.0
    musicGain.connect(master)
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

function tone(freq: number, start: number, dur: number, type: OscillatorType, vol: number, dest: AudioNode, endFreq?: number) {
  const c = ensure()
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, start)
  if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, start + dur)
  g.gain.setValueAtTime(0.0001, start)
  g.gain.exponentialRampToValueAtTime(vol, start + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  o.connect(g).connect(dest)
  o.start(start)
  o.stop(start + dur + 0.05)
}

export function unlockAudio() { ensure() }

/** Epic ascending synth sweep + chord */
export function playIntroSweep() {
  const c = ensure()
  const t = c.currentTime
  tone(80, t, 1.4, 'sawtooth', 0.15, master!, 640)
  tone(160, t + 0.1, 1.3, 'square', 0.08, master!, 1280)
  const chord = [261.63, 329.63, 392.0, 523.25]
  chord.forEach((f, i) => tone(f, t + 1.2 + i * 0.03, 1.6, 'square', 0.07, master!))
  tone(65.41, t + 1.2, 1.8, 'triangle', 0.2, master!)
}

export function playHover() {
  const c = ensure()
  tone(520, c.currentTime, 0.05, 'square', 0.05, master!)
}

/** Low "pop" click */
export function playClick() {
  const c = ensure()
  const t = c.currentTime
  tone(220, t, 0.12, 'square', 0.18, master!, 70)
  tone(110, t, 0.1, 'triangle', 0.2, master!, 55)
}

// Chiptune ambient loop: Am - F - C - G arpeggios
const PROG = [
  [220.0, 261.63, 329.63],
  [174.61, 220.0, 261.63],
  [261.63, 329.63, 392.0],
  [196.0, 246.94, 293.66],
]
const BASS = [55, 43.65, 65.41, 49]

function scheduleNote() {
  const c = ensure()
  const t = c.currentTime + 0.02
  const chord = Math.floor(step / 8) % 4
  const arp = PROG[chord][[0, 1, 2, 1][step % 4]] * (step % 8 >= 4 ? 2 : 1)
  tone(arp, t, 0.22, 'square', 0.35, musicGain!)
  if (step % 4 === 0) tone(BASS[chord], t, 0.5, 'triangle', 0.7, musicGain!)
  if (step % 16 === 0) tone(PROG[chord][2] * 2, t, 1.6, 'triangle', 0.25, musicGain!)
  step++
}

export function setMusic(on: boolean) {
  const c = ensure()
  musicOn = on
  musicGain!.gain.cancelScheduledValues(c.currentTime)
  musicGain!.gain.linearRampToValueAtTime(on ? 0.28 : 0, c.currentTime + 0.3)
  if (on && musicTimer === null) {
    musicTimer = window.setInterval(scheduleNote, 230)
  } else if (!on && musicTimer !== null) {
    window.clearInterval(musicTimer)
    musicTimer = null
  }
}

export const isMusicOn = () => musicOn
