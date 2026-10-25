/** A tiny Web Audio helper shared by the newer games. */
export class Sfx {
  private ctx: AudioContext | null = null;
  enabled = true;

  /** Must be called from a user gesture so the browser allows audio. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  tone(freq: number, dur: number, type: OscillatorType, vol: number, at = 0, slideTo?: number) {
    const a = this.ctx;
    if (!this.enabled || !a) return;
    const t = a.currentTime + at;
    const osc = a.createOscillator();
    const g = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(a.destination);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  arpeggio(freqs: number[], step: number, type: OscillatorType = 'triangle', vol = 0.14) {
    freqs.forEach((f, i) => this.tone(f, 0.35, type, vol, i * step));
  }

  close() { void this.ctx?.close(); }
}
