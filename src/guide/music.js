// 120 BPM, 40초 배경 음악과 효과음을 합성한다. 장면 시각은 film.js 와 맞춘다.
// 음원 파일 없이 브라우저에서 한 번 계산해 AudioBuffer 로 재생한다.
export function renderMusic() {
  const SR = 44100, DUR = 40, N = SR * DUR;
  const L = new Float32Array(N), R = new Float32Array(N), SL = new Float32Array(N), SR_ = new Float32Array(N);
  const TAU = Math.PI * 2;
  let seed = 1234567;
  const noise = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2147483648) - 1;
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const wave = { sine: (ph) => Math.sin(ph * TAU), tri: (ph) => 1 - 4 * Math.abs((ph % 1) - 0.5), saw: (ph) => 2 * (ph % 1) - 1, sq: (ph) => ((ph % 1) < 0.5 ? 0.6 : -0.6) };

  function put(i, v, pan = 0, send = 0) {
    if (i < 0 || i >= N) return;
    const l = v * (1 - pan) * 0.7071, r = v * (1 + pan) * 0.7071;
    L[i] += l; R[i] += r; SL[i] += l * send; SR_[i] += r * send;
  }
  // 감쇠형 음. f1 을 주면 주파수가 미끄러진다.
  function tone(t0, dur, f, o = {}) {
    const { type = "tri", gain = 0.1, a = 0.005, tau = dur * 0.5, pan = 0, send = 0, f1 = f, rel = 0.03 } = o;
    const n = Math.floor(dur * SR), s0 = Math.floor(t0 * SR); let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR, fr = f * Math.pow(f1 / f, i / n);
      ph += fr / SR;
      const env = Math.min(1, t / a) * Math.exp(-t / tau) * Math.min(1, (dur - t) / rel);
      put(s0 + i, wave[type](ph) * env * gain, pan, send);
    }
  }
  function pad(t0, dur, f, gain) {
    const n = Math.floor(dur * SR), s0 = Math.floor(t0 * SR);
    for (let i = 0; i < n; i++) {
      const t = i / SR, env = Math.min(1, t / 0.35) * Math.min(1, (dur - t) / 0.4);
      const v = Math.sin(TAU * f * t) + 0.6 * Math.sin(TAU * f * 1.006 * t) + 0.35 * wave.tri(f * 0.997 * t);
      put(s0 + i, v * env * gain, Math.sin(t * 0.7 + f) * 0.5, 0.25);
    }
  }
  function nz(t0, dur, o = {}) {
    const { gain = 0.1, tau = dur * 0.3, hp = true, pan = 0, send = 0, swell = false } = o;
    const n = Math.floor(dur * SR), s0 = Math.floor(t0 * SR); let prev = 0, lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR, x = noise(), env = swell ? Math.pow(i / n, 2.2) : Math.exp(-t / tau);
      lp += (x - lp) * 0.25; const v = hp ? x - prev : lp; prev = x;
      put(s0 + i, v * env * gain, pan, send);
    }
  }
  const kick = (t, g = 0.55) => tone(t, 0.28, 150, { type: "sine", f1: 42, gain: g, tau: 0.11, a: 0.001 });
  const hat = (t, g = 0.05) => nz(t, 0.06, { gain: g, tau: 0.018, pan: 0.25 });
  const snare = (t, g = 0.16) => { nz(t, 0.18, { gain: g, tau: 0.05, send: 0.2 }); tone(t, 0.12, 210, { type: "tri", f1: 150, gain: g * 0.7, tau: 0.04 }); };
  const pluck = (t, m, g = 0.085, pan = 0) => { tone(t, 0.4, hz(m), { type: "tri", gain: g, tau: 0.12, pan, send: 0.45 }); tone(t, 0.25, hz(m), { type: "sq", gain: g * 0.25, tau: 0.06, pan, send: 0.3 }); };
  const bass = (t, m, d = 0.24, g = 0.2) => { tone(t, d, hz(m), { type: "tri", gain: g, tau: 0.3 }); tone(t, d, hz(m - 12), { type: "sine", gain: g * 0.8, tau: 0.3 }); };
  const lead = (t, m, d, g = 0.075) => { tone(t, d + 0.15, hz(m), { type: "sq", gain: g, tau: 0.5, a: 0.012, send: 0.5, pan: -0.15 }); tone(t, d + 0.15, hz(m) * 1.004, { type: "tri", gain: g, tau: 0.5, a: 0.012, send: 0.4, pan: 0.15 }); };

  // 코드 진행: [시작, 끝, 구성음(MIDI)]
  const Am = [57, 60, 64], F = [53, 57, 60], E = [52, 56, 59], G = [55, 59, 62], Dm = [50, 53, 57], Cmaj = [48, 52, 55];
  const CH = [[0, 2, Am], [2, 4, F], [4, 6, Am], [6, 8, F], [8, 10, E], [10, 12, Am], [12, 14, F], [14, 16, G], [16, 18, Dm], [18, 20, E],
    [20, 21, Cmaj], [21, 22, G], [22, 23, Am], [23, 24, F], [24, 25, Cmaj], [25, 26, G],
    [26, 28, Am], [28, 30, F], [30, 32, Cmaj], [32, 34, G], [34, 35, F], [35, 36, G], [36, 37, F], [37, 38, G], [38, 40, Cmaj]];
  const chordAt = (t) => CH.find(([a, b]) => t >= a && t < b)[2];
  const DEATHS = [8.5, 15.5], END = 38;
  const quiet = (t) => DEATHS.some((d) => t >= d && t < d + 1.5);
  const big = (t) => (t >= 20 && t < 26) || (t >= 36 && t < END);
  const tech = (t) => t >= 26 && t < 35;
  const groove = (t) => (t >= 4 && t < 8.5) || (t >= 10 && t < 15.5) || (t >= 16.5 && t < 19) || big(t) || tech(t);

  CH.forEach(([a, b, ch]) => ch.forEach((m) => pad(a, b - a, hz(m), big(a) ? 0.03 : 0.024)));

  for (let t = 0; t < END; t += 0.125) {
    const q = Math.round(t * 8), ch = chordAt(t), beat = q % 4 === 0, eighth = q % 2 === 0;
    if (quiet(t)) continue;
    // 아르페지오
    const pat = [0, 1, 2, 1, 0, 2, 1, 2], i8 = Math.floor(q / 2) % 8;
    if (t < 4) { if (beat) pluck(t, ch[pat[(q / 4) % 8]] + 12, 0.07, 0.3); }
    else if ((t >= 16.5 && t < 20) || (t >= 35 && t < 36)) pluck(t, ch[q % 3] + 12 + 12 * (Math.floor(q / 3) % 2), 0.04 + 0.015 * (q % 8) / 8, Math.sin(q) * 0.5);
    else if (eighth) pluck(t, ch[pat[i8]] + (big(t) ? 24 : 12), big(t) ? 0.06 : 0.075, i8 % 2 ? 0.4 : -0.4);
    if (!groove(t)) continue;
    // 원리 구간은 절반 빠르기로 가라앉힌다
    if (beat && (!tech(t) || q % 8 === 0)) kick(t);
    if (eighth && !beat) { hat(t, 0.06); bass(t, ch[0] - 12, 0.22, 0.17); }
    if (beat) bass(t, ch[0] - 12, 0.24, 0.2);
    if (big(t) && !eighth) hat(t, 0.03);
    if ((t >= 12 || big(t)) && q % 8 === 4) snare(t, tech(t) ? 0.1 : 0.16);
  }
  // 빌드업과 상승음
  [19, 35].forEach((b) => { for (let i = 0; i < 8; i++) snare(b + (i < 4 ? i * 0.125 : 0.25 + i * 0.0625), 0.07 + i * 0.012); });
  nz(3, 1, { gain: 0.05, swell: true, send: 0.3 });
  nz(18, 2, { gain: 0.09, swell: true, send: 0.3 });
  nz(34.5, 1.5, { gain: 0.08, swell: true, send: 0.3 });
  tone(18.5, 1.5, 220, { type: "saw", f1: 880, gain: 0.035, tau: 9, a: 1.2, send: 0.4 });
  [[4, 0.05], [20, 0.09], [26, 0.06], [36, 0.09]].forEach(([t, g]) => nz(t, 1.5, { gain: g, tau: 0.4, send: 0.4 }));

  // 절정부 선율
  [[20, 84, .5], [20.5, 79, .25], [20.75, 76, .25], [21, 86, .5], [21.5, 83, .5], [22, 88, .75], [22.75, 84, .25], [23, 81, .5], [23.5, 84, .5],
    [24, 91, 1], [25, 86, .5], [25.5, 79, .5], [36, 81, .5], [36.5, 84, .5], [37, 83, .5], [37.5, 86, .5]].forEach(([t, m, d]) => lead(t, m - 12, d));
  [72, 76, 79, 84].forEach((m, i) => { tone(END, 2, hz(m), { type: "tri", gain: 0.09, tau: 0.8, send: 0.5, pan: (i - 1.5) * 0.3 }); tone(END, 2, hz(m), { type: "sq", gain: 0.03, tau: 0.5, send: 0.5 }); });
  kick(END, 0.6); bass(END, 36, 1.6, 0.22); nz(END, 1.8, { gain: 0.08, tau: 0.5, send: 0.4 });

  // 효과음: 타자, Enter, 검사, 죽음, 되감기, 점프, 클리어, 원리 카드
  const typing = (a, b, n) => { for (let i = 0; i < n; i++) { const t = a + ((b - a) * i) / n; nz(t, 0.03, { gain: 0.07, tau: 0.006, pan: -0.5 }); tone(t, 0.04, 1900 + (i % 3) * 240, { type: "sine", gain: 0.03, tau: 0.01, pan: -0.5 }); } };
  typing(1.25, 2.4, 12); typing(4.6, 5.5, 7); typing(10.2, 11.3, 12);
  [5.75, 11.5, 19.5].forEach((t) => { tone(t, 0.12, 180, { type: "sine", f1: 70, gain: 0.3, tau: 0.04 }); tone(t + 0.03, 0.2, 660, { type: "tri", f1: 1320, gain: 0.08, tau: 0.08, send: 0.5, pan: -0.4 }); });
  [6.3, 6.8, 7.3, 7.8, 12.5, 13, 13.5, 14, 14.5].forEach((t) => tone(t, 0.08, 1568, { type: "tri", gain: 0.05, tau: 0.02, pan: -0.5, send: 0.3 }));
  [20, 20.5, 21, 21.5, 22.8, 23.3].forEach((t) => { tone(t, 0.06, 740, { type: "tri", gain: 0.04, tau: 0.015, pan: -0.5 }); tone(t + 0.14, 0.08, 1568, { type: "tri", gain: 0.05, tau: 0.02, pan: -0.5, send: 0.3 }); });
  DEATHS.forEach((t) => {
    tone(t - 0.22, 0.24, 700, { type: "saw", f1: 160, gain: 0.07, tau: 1 });
    tone(t, 0.9, 110, { type: "sine", f1: 36, gain: 0.6, tau: 0.3, a: 0.001 });
    nz(t, 0.5, { gain: 0.14, tau: 0.1, hp: false });
    [[1, 0.2], [2.01, 0.11], [2.76, 0.08], [4.07, 0.05], [5.4, 0.03]].forEach(([r, g]) => tone(t, 1.5, 329.6 * r, { type: "sine", gain: g, tau: 0.5 / Math.sqrt(r), send: 0.6, pan: -0.2 }));
    for (let i = 0; i < 8; i++) tone(t + 0.4 + i * 0.06, 0.09, hz(64 + i * 3), { type: "sine", gain: 0.05, tau: 0.04, send: 0.5, pan: 0.6 - i * 0.15 });
    tone(t + 0.95, 0.5, hz(76), { type: "tri", gain: 0.06, tau: 0.2, send: 0.6 });
  });
  tone(22, 0.3, 392, { type: "sq", f1: 1175, gain: 0.07, tau: 0.2, send: 0.4 });
  tone(21.75, 0.1, 1760, { type: "tri", gain: 0.06, tau: 0.03, send: 0.4 });
  [72, 76, 79, 84, 88, 91].forEach((m, i) => tone(24 + i * 0.06, 0.6, hz(m), { type: "tri", gain: 0.09, tau: 0.22, send: 0.6, pan: -0.5 + i * 0.2 }));
  nz(24, 1.8, { gain: 0.1, tau: 0.5, send: 0.4 });
  [[27, 69], [27.8, 72], [28.6, 76], [31.3, 69], [32.1, 72], [32.9, 76]].forEach(([t, m]) => { tone(t, 0.3, hz(m + 12), { type: "tri", gain: 0.07, tau: 0.1, send: 0.6, pan: 0.4 }); tone(t, 0.1, 140, { type: "sine", f1: 70, gain: 0.18, tau: 0.04 }); });
  [81, 88].forEach((m, i) => tone(29.5 + i * 0.09, 0.5, hz(m), { type: "tri", gain: 0.08, tau: 0.2, send: 0.6, pan: -0.4 }));

  // 핑퐁 딜레이 → 소프트 클립 → 정규화 → 끝 페이드
  const D = Math.floor(0.375 * SR);
  for (let i = D; i < N; i++) { SL[i] += SR_[i - D] * 0.42; SR_[i] += SL[i - D] * 0.42; L[i] += SL[i - D] * 0.5; R[i] += SR_[i - D] * 0.5; }
  let peak = 0;
  for (let i = 0; i < N; i++) { L[i] = Math.tanh(L[i] * 1.5); R[i] = Math.tanh(R[i] * 1.5); peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); }
  for (let i = 0; i < N; i++) {
    const t = i / SR, g = (0.85 / peak) * Math.min(1, t / 0.05, (DUR - t) / 1.0);
    L[i] *= g; R[i] *= g;
  }
  return { sampleRate: SR, duration: DUR, left: L, right: R };
}
