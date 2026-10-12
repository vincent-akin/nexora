/** Small Web Audio sound set for Card Clash: soft, warm and a little ceremonial. */
export class VaultAudio {
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

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, at = 0, slideTo?: number) {
    const a = this.ctx;
    if (!this.enabled || !a) return;
    const t = a.currentTime + at;
    const osc = a.createOscillator();
    const g = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(a.destination);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  flip() { this.tone(520, 0.07, 'triangle', 0.09); this.tone(780, 0.05, 'sine', 0.05, 0.03); }
  match(streak: number) {
    const base = 523.25 * Math.pow(1.0595, Math.min(streak, 6) * 2);
    this.tone(base, 0.22, 'triangle', 0.14);
    this.tone(base * 1.5, 0.3, 'triangle', 0.12, 0.09);
  }
  mismatch() { this.tone(190, 0.2, 'sawtooth', 0.07, 0, 120); }
  tick() { this.tone(1100, 0.03, 'square', 0.04); }
  win() { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, 0.4, 'triangle', 0.15, i * 0.11)); }
  lose() { [392, 330, 262].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.12, i * 0.16)); }
  close() { void this.ctx?.close(); }
}
