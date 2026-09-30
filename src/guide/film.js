// 플레이 안내 페이지의 40초 소개 영상. 모든 그림은 시간 t(초)의 순수 함수라서 프레임 단위로 재현된다.
const W = 1920, H = 1080;
export const DUR = 40;
const cv = document.getElementById("c"), ctx = cv.getContext("2d");
const C = {
  abyss: "#090b1d", deep: "#11132f", navy: "#191b43", violet: "#292653", stone: "#35325f",
  stoneLight: "#57517b", mortar: "#201e43", moon: "#b8dcde", mint: "#80d7b6", mintDark: "#3f8f79",
  peach: "#f3a785", gold: "#f6c76d", flame: "#ff8b55", ink: "#201b32", spike: "#aaa9cc",
  cream: "#f6efdc", paper: "#ece6d2", rule: "#d3cbb2",
};
const SERIF = '"Gowun Batang", serif', SANS = '"Noto Sans KR Variable", sans-serif';
const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, k) => a + (b - a) * k;
const p = (t, a, b) => clamp((t - a) / (b - a));
const win = (t, a, b, f = 0.25) => Math.min(p(t, a, a + f), 1 - p(t, b - f, b));
const hash = (i) => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const E = {
  out: (k) => 1 - Math.pow(1 - k, 3),
  in: (k) => k * k * k,
  inOut: (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  back: (k) => 1 + 2.70158 * Math.pow(k - 1, 3) + 1.70158 * Math.pow(k - 1, 2),
  expo: (k) => (k >= 1 ? 1 : 1 - Math.pow(2, -10 * k)),
};

const sheet = new Image();
const SPR = {
  idle: [45, 60, 340, 365, 344], walk: [500, 70, 340, 355, 334], jump: [910, 40, 400, 365, 342],
  revive: [510, 470, 420, 380, 356], joy: [990, 470, 430, 380, 352],
};

function font(o) { return `${o.w || 700} ${o.size || 40}px ${o.f || SERIF}`; }
function text(s, x, y, o = {}) {
  ctx.save();
  ctx.font = font(o);
  ctx.fillStyle = o.c || C.cream;
  ctx.textAlign = o.align || "left";
  ctx.textBaseline = o.base || "alphabetic";
  ctx.globalAlpha *= o.a ?? 1;
  ctx.letterSpacing = (o.ls || 0) + "px";
  ctx.fillText(s, x, y);
  ctx.restore();
}
function measure(s, o = {}) {
  ctx.save(); ctx.font = font(o); ctx.letterSpacing = (o.ls || 0) + "px";
  const w = ctx.measureText(s).width; ctx.restore(); return w;
}
function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function star(x, y, r, a = 1, c = C.gold) {
  ctx.save(); ctx.translate(x, y); ctx.globalAlpha *= a; ctx.fillStyle = c; ctx.beginPath();
  for (let i = 0; i < 8; i++) { const R = i % 2 ? r * 0.28 : r, an = (i * TAU) / 8; ctx.lineTo(Math.cos(an) * R, Math.sin(an) * R); }
  ctx.closePath(); ctx.fill(); ctx.restore();
}
function hero(pose, x, y, s = 0.5, o = {}) {
  const [sx, sy, sw, sh, bl] = SPR[pose];
  ctx.save();
  ctx.translate(x, y); ctx.rotate(o.rot || 0); ctx.scale(s * (o.sx || 1), s * (o.sy || 1));
  ctx.globalAlpha *= o.a ?? 1;
  ctx.drawImage(sheet, sx, sy, sw, sh, -sw / 2, -bl, sw, sh);
  ctx.restore();
}
// 글자별로 솟아오르는 헤드라인
function riseText(s, x, y, o, t, t0, step = 0.07) {
  let cx = x;
  [...s].forEach((ch, i) => {
    const k = p(t, t0 + i * step, t0 + i * step + 0.5);
    if (k > 0) text(ch, cx, y + (1 - E.back(k)) * 70, { ...o, a: E.out(k) });
    cx += measure(ch, o);
  });
}
function brush(x0, x1, y, k, c = C.gold, lw = 12) {
  if (k <= 0) return;
  ctx.save(); ctx.strokeStyle = c; ctx.lineWidth = lw; ctx.lineCap = "round"; ctx.beginPath();
  const n = 40;
  for (let i = 0; i <= n * k; i++) { const u = i / n; ctx.lineTo(lerp(x0, x1, u), y + Math.sin(u * 5) * 5 - u * 8); }
  ctx.stroke(); ctx.restore();
}

// ───────── 배경
function background(t) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, C.abyss); g.addColorStop(0.6, C.navy); g.addColorStop(1, "#1d2440");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // 비스듬한 빛줄기
  ctx.save(); ctx.globalAlpha = 0.06 + 0.02 * Math.sin(t * 0.8); ctx.fillStyle = C.moon; ctx.beginPath();
  ctx.moveTo(1500, 0); ctx.lineTo(1860, 0); ctx.lineTo(1320, H); ctx.lineTo(1040, H); ctx.fill(); ctx.restore();
  // 떠다니는 먼지
  for (let i = 0; i < 70; i++) {
    const sp = 8 + hash(i) * 26, x = (hash(i + 100) * W + t * sp * 0.4) % W;
    const y = H - ((hash(i + 200) * H + t * sp) % H), r = 1 + hash(i + 300) * 2.6;
    const a = 0.15 + 0.35 * (0.5 + 0.5 * Math.sin(t * (1 + hash(i + 400) * 2) + i));
    ctx.globalAlpha = a; ctx.fillStyle = i % 5 ? C.moon : C.gold;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
  const v = ctx.createRadialGradient(W / 2, H / 2, 420, W / 2, H / 2, 1150);
  v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(3,4,14,.62)");
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
}

// ───────── 0–4초 타이틀
function title(t) {
  const out = E.in(p(t, 3.45, 3.95));
  if (out >= 1) return;
  ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(-160 * out, 0);
  const ek = E.out(p(t, 0.15, 0.9));
  ctx.save(); ctx.beginPath(); ctx.rect(150, 250, 620 * ek, 60); ctx.clip();
  text("ONE LINE PER DEATH", 160, 292, { f: SANS, w: 600, size: 28, c: C.gold, ls: 9 }); ctx.restore();
  riseText("죽을 때마다", 150, 480, { size: 168 }, t, 0.35);
  riseText("한 줄", 150, 690, { size: 190, c: C.mint }, t, 1.0, 0.1);
  brush(158, 560, 738, E.out(p(t, 1.45, 1.95)));
  const sk = E.out(p(t, 1.9, 2.5));
  text("말로 가르치는 던전 퍼즐", 156, 850 + (1 - sk) * 24, { f: SANS, w: 500, size: 46, c: C.moon, a: sk });
  // 메모 카드와 용사
  const ck = E.back(p(t, 0.6, 1.3));
  ctx.save(); ctx.translate(1390, 380 + (1 - ck) * 140); ctx.rotate(0.07 - (1 - ck) * 0.2); ctx.globalAlpha *= p(t, 0.6, 0.9);
  ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = 60; ctx.shadowOffsetY = 30;
  ctx.fillStyle = C.paper; rr(-290, -230, 580, 430, 14); ctx.fill(); ctx.shadowColor = "transparent";
  ctx.fillStyle = "#7fa58e"; ctx.beginPath(); ctx.moveTo(210, -232); ctx.lineTo(250, -232); ctx.lineTo(250, -140); ctx.lineTo(230, -160); ctx.lineTo(210, -140); ctx.fill();
  text("용사의 메모장", -240, -160, { size: 28, c: "#6f8f7c" });
  const memo = ["구덩이가 보이면", "점프해."], n = Math.floor(p(t, 1.25, 2.4) * 12);
  text(memo[0].slice(0, n), -240, -60, { size: 62, c: C.ink });
  text(memo[1].slice(0, Math.max(0, n - 8)), -240, 36, { size: 62, c: C.ink });
  ctx.strokeStyle = C.rule; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-240, 90); ctx.lineTo(240, 90); ctx.stroke();
  ctx.restore();
  const hk = E.back(p(t, 0.95, 1.55));
  if (hk > 0) {
    ctx.save(); ctx.globalAlpha *= 0.35 * hk; ctx.fillStyle = "#000"; ctx.beginPath(); ctx.ellipse(1610, 945, 150, 20, 0, 0, TAU); ctx.fill(); ctx.restore();
    hero("idle", 1610, 940 - Math.abs(Math.sin(t * 2.2)) * 10, 0.85 * hk);
  }
  [[1120, 110, 16, 0], [1660, 470, 22, 1.3], [1560, 150, 7, 2.2]].forEach(([x, y, r, ph]) =>
    star(x, y, r * (0.8 + 0.3 * Math.sin(t * 3 + ph)), p(t, 1.2, 1.8) * 0.9));
  ctx.restore();
}

// ───────── 4–26초 플레이 설명
const X0 = 945, FLOOR = 770, PIT = [1300, 1500], DOOR = 1760;
const DEATHS = [8.5, 15.5], CLEAR = 24;
const walkBob = (t) => ({ dy: -Math.abs(Math.sin(t * TAU * 2)) * 12, rot: Math.sin(t * TAU * 2) * 0.05 });

function heroState(t) {
  const idle = { pose: "idle", x: X0, y: FLOOR - Math.abs(Math.sin(t * 2.2)) * 4 };
  const walk = (a, b, x0, x1) => { const w = walkBob(t); return { pose: "walk", x: lerp(x0, x1, p(t, a, b)), y: FLOOR + w.dy, rot: w.rot }; };
  const fall = (a) => { const k = p(t, a, a + 0.6); return { pose: "jump", x: 1350 + 50 * k, y: FLOOR + E.in(k) * 300, rot: k * 1.4, s: 1 - 0.25 * k, fall: true, a: 1 - p(t, a + 0.3, a + 0.55) }; };
  const revive = (a) => { const k = p(t, a, a + 0.45); return { pose: "revive", x: X0, y: FLOOR, a: k, s: 0.7 + 0.3 * E.back(k) }; };
  if (t < 4.5) { const k = E.back(p(t, 4.1, 4.5)); return { ...idle, s: k, a: p(t, 4.1, 4.25) }; }
  if (t < 6.3) return idle;
  if (t < 8.3) return walk(6.3, 8.3, X0, 1350);
  if (t < 8.9) return fall(8.3);
  if (t < 9.4) return null;
  if (t < 10.3) return revive(9.4);
  if (t < 12.5) return idle;
  if (t < 15.3) return walk(12.5, 15.3, X0, 1350);
  if (t < 15.9) return fall(15.3);
  if (t < 16.4) return null;
  if (t < 17.3) return revive(16.4);
  if (t < 20) return idle;
  if (t < 22) return walk(20, 22, X0, 1220);
  if (t < 22.8) { const k = p(t, 22, 22.8); return { pose: "jump", x: lerp(1220, 1585, k), y: FLOOR - 230 * 4 * k * (1 - k), rot: lerp(-0.12, 0.12, k) }; }
  if (t < CLEAR) return walk(22.8, CLEAR, 1585, 1610);
  const d = t - CLEAR;
  return { pose: "joy", x: 1610, y: FLOOR - Math.abs(Math.sin(d * 7)) * 60 * Math.exp(-d * 1.2) };
}

function stage(t) {
  const SX = 830, SY = 200, SW = 1010, SH = 660;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.55)"; ctx.shadowBlur = 70; ctx.shadowOffsetY = 30;
  ctx.fillStyle = C.deep; rr(SX, SY, SW, SH, 30); ctx.fill(); ctx.shadowColor = "transparent";
  rr(SX, SY, SW, SH, 30); ctx.clip();
  const g = ctx.createLinearGradient(0, SY, 0, SY + SH); g.addColorStop(0, "#15173a"); g.addColorStop(1, "#231f4c");
  ctx.fillStyle = g; ctx.fillRect(SX, SY, SW, SH);
  // 벽돌
  ctx.strokeStyle = "rgba(87,81,123,.22)"; ctx.lineWidth = 2;
  for (let r = 0; r < 10; r++) for (let c = -1; c < 9; c++) {
    const x = SX + c * 130 + (r % 2) * 65, y = SY + r * 58;
    ctx.globalAlpha = 0.5 + hash(r * 17 + c) * 0.5; ctx.strokeRect(x, y, 130, 58);
  }
  ctx.globalAlpha = 1;
  // 횃불
  const fl = 0.85 + 0.1 * Math.sin(t * 13) + 0.05 * Math.sin(t * 29);
  const tg = ctx.createRadialGradient(1075, 430, 0, 1075, 430, 300 * fl);
  tg.addColorStop(0, "rgba(255,139,85,.34)"); tg.addColorStop(1, "rgba(255,139,85,0)");
  ctx.fillStyle = tg; ctx.fillRect(SX, SY, SW, SH);
  ctx.fillStyle = C.stoneLight; ctx.fillRect(1067, 440, 16, 60);
  ctx.fillStyle = C.flame; ctx.beginPath(); ctx.ellipse(1075, 425, 15 * fl, 27 * fl, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = C.gold; ctx.beginPath(); ctx.ellipse(1075, 432, 7 * fl, 14 * fl, 0, 0, TAU); ctx.fill();
  // 출구
  const clear = p(t, CLEAR, CLEAR + 0.4), glow = 0.3 + 0.08 * Math.sin(t * 3) + clear * 0.7;
  const dg = ctx.createRadialGradient(DOOR, 690, 10, DOOR, 690, 260 + clear * 160);
  dg.addColorStop(0, `rgba(246,199,109,${0.5 * glow})`); dg.addColorStop(1, "rgba(246,199,109,0)");
  ctx.fillStyle = dg; ctx.fillRect(SX, SY, SW, SH);
  ctx.fillStyle = C.stoneLight; ctx.beginPath(); ctx.moveTo(DOOR - 70, FLOOR); ctx.lineTo(DOOR - 70, 640); ctx.arc(DOOR, 640, 70, Math.PI, 0); ctx.lineTo(DOOR + 70, FLOOR); ctx.fill();
  ctx.fillStyle = `rgba(246,199,109,${0.25 + glow * 0.75})`; ctx.beginPath(); ctx.moveTo(DOOR - 52, FLOOR); ctx.lineTo(DOOR - 52, 642); ctx.arc(DOOR, 642, 52, Math.PI, 0); ctx.lineTo(DOOR + 52, FLOOR); ctx.fill();
  // 구덩이와 바닥
  const see = win(t, 21.3, 22.3, 0.3);
  ctx.fillStyle = "#07081a"; ctx.fillRect(PIT[0], FLOOR, PIT[1] - PIT[0], 100);
  ctx.fillStyle = C.spike;
  for (let i = 0; i < 7; i++) { const x = PIT[0] + i * 28.6; ctx.beginPath(); ctx.moveTo(x, 862); ctx.lineTo(x + 14, 822); ctx.lineTo(x + 28, 862); ctx.fill(); }
  [[SX, PIT[0]], [PIT[1], SX + SW]].forEach(([a, b]) => {
    ctx.fillStyle = C.stone; ctx.fillRect(a, FLOOR, b - a, 100);
    ctx.fillStyle = C.stoneLight; ctx.fillRect(a, FLOOR, b - a, 12);
    ctx.strokeStyle = C.mortar; ctx.lineWidth = 3;
    for (let x = a + 40; x < b; x += 96) { ctx.beginPath(); ctx.moveTo(x, FLOOR + 12); ctx.lineTo(x, FLOOR + 100); ctx.stroke(); }
  });
  if (see > 0) { ctx.save(); ctx.globalAlpha = see; ctx.strokeStyle = C.gold; ctx.lineWidth = 6; ctx.shadowColor = C.gold; ctx.shadowBlur = 24; ctx.strokeRect(PIT[0], FLOOR - 3, PIT[1] - PIT[0], 96); ctx.restore(); }
  // 돌아오는 종
  let sw = 0, ring = [];
  DEATHS.forEach((td) => { const d = t - td; if (d >= 0) { sw += 0.55 * Math.sin(d * 17) * Math.exp(-d * 2.6); ring.push(d); } });
  ctx.save(); ctx.translate(X0, SY); ctx.rotate(sw);
  ctx.strokeStyle = C.stoneLight; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 86); ctx.stroke();
  ctx.fillStyle = C.gold; ctx.beginPath(); ctx.moveTo(-34, 150); ctx.quadraticCurveTo(-30, 86, 0, 84); ctx.quadraticCurveTo(30, 86, 34, 150); ctx.closePath(); ctx.fill();
  ctx.fillRect(-42, 146, 84, 10); ctx.beginPath(); ctx.arc(0, 166, 9, 0, TAU); ctx.fill();
  ctx.restore();
  ring.forEach((d) => [0, 0.18].forEach((off) => {
    const k = p(d - off, 0, 0.9); if (k <= 0 || k >= 1) return;
    ctx.save(); ctx.globalAlpha = (1 - k) * 0.8; ctx.strokeStyle = C.gold; ctx.lineWidth = 5 * (1 - k) + 1;
    ctx.beginPath(); ctx.arc(X0, SY + 130, 50 + E.out(k) * 330, 0, TAU); ctx.stroke(); ctx.restore();
  }));
  // 시야선
  const h = heroState(t);
  if (see > 0 && h) {
    ctx.save(); ctx.globalAlpha = see * 0.9; ctx.strokeStyle = C.gold; ctx.lineWidth = 4; ctx.setLineDash([10, 12]); ctx.lineDashOffset = -t * 60;
    ctx.beginPath(); ctx.moveTo(h.x + 40, FLOOR - 95); ctx.lineTo(PIT[0] + 40, FLOOR - 4); ctx.stroke(); ctx.restore();
  }
  // 용사
  if (h) {
    const s = 0.5 * (h.s ?? 1);
    if (h.y <= FLOOR + 1) { ctx.save(); ctx.globalAlpha = 0.3 * (h.a ?? 1) * clamp(1 - (FLOOR - h.y) / 400); ctx.fillStyle = "#000"; ctx.beginPath(); ctx.ellipse(h.x, FLOOR + 4, 78, 11, 0, 0, TAU); ctx.fill(); ctx.restore(); }
    if (h.pose === "revive") { const rg = ctx.createRadialGradient(h.x, FLOOR - 90, 0, h.x, FLOOR - 90, 190); rg.addColorStop(0, `rgba(128,215,182,${0.5 * (h.a ?? 1)})`); rg.addColorStop(1, "rgba(128,215,182,0)"); ctx.fillStyle = rg; ctx.fillRect(SX, SY, SW, SH); }
    // 떨어질 때는 구덩이 폭 안에서만 보이도록 바닥 뒤로 가린다.
    ctx.save();
    if (h.fall) { ctx.beginPath(); ctx.rect(SX, SY, SW, FLOOR - SY); ctx.rect(PIT[0], FLOOR, PIT[1] - PIT[0], 100); ctx.clip(); }
    hero(h.pose, h.x, h.y, s, { rot: h.rot, a: h.a });
    ctx.restore();
    const bang = win(t, 21.75, 22.25, 0.12);
    if (bang > 0) { ctx.save(); ctx.translate(h.x + 10, h.y - 225 - 14 * E.back(p(t, 21.75, 22))); ctx.globalAlpha = bang; ctx.fillStyle = C.gold; rr(-26, -34, 52, 60, 16); ctx.fill(); text("!", 0, 14, { size: 50, c: C.ink, align: "center", f: SANS, w: 900 }); ctx.restore(); }
  }
  // 죽음: 섬광, 종잇조각, 되감기 빛
  DEATHS.forEach((td, di) => {
    const d = t - td; if (d < 0 || d > 1.6) return;
    ctx.fillStyle = `rgba(255,209,170,${0.6 * (1 - p(d, 0, 0.4))})`; ctx.fillRect(SX, SY, SW, SH);
    for (let i = 0; i < 30; i++) {
      const s = di * 100 + i, an = -Math.PI / 2 + (hash(s) - 0.5) * 2.2, sp = 380 + hash(s + 1) * 520, life = p(d, 0, 1.1);
      if (life >= 1) continue;
      const x = 1400 + Math.cos(an) * sp * d, y = 790 + Math.sin(an) * sp * d + 900 * d * d;
      ctx.save(); ctx.translate(x, y); ctx.rotate(d * (6 + hash(s + 2) * 10)); ctx.globalAlpha = 1 - life;
      ctx.fillStyle = [C.cream, C.mint, C.gold][i % 3]; ctx.fillRect(-9, -6, 18, 12); ctx.restore();
    }
    const k = p(d, 0.38, 0.9);
    if (k > 0 && k < 1) for (let j = 0; j < 14; j++) {
      const u = clamp(E.inOut(k) - j * 0.03); if (u <= 0) continue;
      const x = (1 - u) ** 2 * 1400 + 2 * u * (1 - u) * 1190 + u * u * X0, y = (1 - u) ** 2 * 770 + 2 * u * (1 - u) * 330 + u * u * 690;
      ctx.save(); ctx.globalAlpha = (1 - j / 14) * 0.9; ctx.fillStyle = C.mint; ctx.shadowColor = C.mint; ctx.shadowBlur = 20;
      ctx.beginPath(); ctx.arc(x, y, 11 - j * 0.6, 0, TAU); ctx.fill(); ctx.restore();
    }
  });
  // 클리어
  const cd = t - CLEAR;
  if (cd > 0) {
    for (let i = 0; i < 36; i++) {
      const an = hash(i + 50) * TAU, sp = 200 + hash(i + 60) * 620, k = p(cd, 0, 1.5);
      star(DOOR - 60 + Math.cos(an) * sp * E.out(k), 640 + Math.sin(an) * sp * E.out(k) + 160 * k * k, 8 + hash(i + 70) * 16, 1 - k, i % 3 ? C.gold : C.mint);
    }
    const k = E.back(p(cd, 0.05, 0.5));
    ctx.save(); ctx.translate(1420, 440); ctx.scale(k, k); ctx.globalAlpha = p(cd, 0.05, 0.2);
    ctx.shadowColor = "rgba(246,199,109,.7)"; ctx.shadowBlur = 50;
    text("CLEAR", 0, 0, { size: 140, c: C.gold, align: "center", ls: 10 }); ctx.restore();
    const ck = E.out(p(cd, 0.45, 0.9));
    text("메모 2줄  ·  2데스", 1420, 515 + (1 - ck) * 20, { f: SANS, w: 600, size: 38, c: C.cream, align: "center", a: ck });
  }
  ctx.restore();
  // 데스 카운터
  const n = DEATHS.filter((td) => t >= td).length, last = DEATHS[n - 1] ?? -9, pop = 1 + 0.5 * (1 - E.out(p(t, last, last + 0.4)));
  ctx.save(); ctx.translate(1730, 270);
  ctx.fillStyle = "rgba(9,11,29,.7)"; rr(-82, -44, 164, 88, 44); ctx.fill();
  text("DEATH", -56, 9, { f: SANS, w: 700, size: 22, c: C.peach, ls: 3 });
  ctx.translate(48, 0); ctx.scale(pop, pop); text(String(n), 0, 18, { size: 52, c: C.cream, align: "center" });
  ctx.restore();
}

const LINES = {
  A: { text: "앞으로 전진해", cond: "항상", act: "전진", type: [4.6, 5.5], tags: 5.9 },
  B: { text: "구덩이가 보이면 점프해", cond: "구덩이가 보이면", act: "점프", type: [10.2, 11.3], tags: 11.65 },
};
const ENTERS = [5.75, 11.5, 19.5];
// [시각, 줄, 조건이 맞았는가]
const SCAN = [];
[6.3, 6.8, 7.3, 7.8, 12.5, 13, 13.5, 14, 14.5].forEach((s) => SCAN.push([s, "A", true]));
[20, 20.5, 21, 21.5, 22.8, 23.3].forEach((s) => SCAN.push([s, "B", false], [s + 0.14, "A", true]));
SCAN.push([22, "B", true]);

function chip(label, value, x, y, c, a) {
  const w = measure(value, { f: SANS, w: 600, size: 24 }) + 84;
  ctx.save(); ctx.globalAlpha *= a;
  ctx.fillStyle = c; rr(x, y - 20, w, 40, 20); ctx.fill();
  text(label, x + 14, y + 7, { f: SANS, w: 800, size: 19, c: "rgba(32,27,50,.62)" });
  text(value, x + 62, y + 8, { f: SANS, w: 600, size: 24, c: C.ink });
  ctx.restore(); return w;
}

function notepad(t) {
  const ink = E.out(p(t, 3.8, 4.5));
  ctx.save(); ctx.translate(430 - (1 - ink) * 240, 530); ctx.rotate(-0.025); ctx.globalAlpha *= ink;
  ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = 70; ctx.shadowOffsetY = 34;
  ctx.fillStyle = C.paper; rr(-320, -330, 640, 660, 16); ctx.fill(); ctx.shadowColor = "transparent";
  ctx.fillStyle = "#7fa58e"; ctx.beginPath(); ctx.moveTo(236, -332); ctx.lineTo(276, -332); ctx.lineTo(276, -236); ctx.lineTo(256, -256); ctx.lineTo(236, -236); ctx.fill();
  text("용사의 메모장", -272, -256, { size: 30, c: "#6f8f7c" });
  ctx.strokeStyle = C.rule; ctx.lineWidth = 2;
  [-220, -60, 100].forEach((y) => { ctx.beginPath(); ctx.moveTo(-280, y); ctx.lineTo(280, y); ctx.stroke(); });

  const swap = E.inOut(p(t, 17.4, 18.4)), lift = Math.sin(Math.PI * p(t, 17.2, 18.6));
  const slot = { A: E.inOut(p(t, 17.75, 18.05)), B: 1 - swap }, slotY = (k) => -150 + slot[k] * 160;
  ["A", "B"].forEach((key) => {
    const L = LINES[key], n = Math.ceil(p(t, ...L.type) * L.text.length);
    if (t < L.type[0] - 0.2) return;
    const y = slotY(key), lf = key === "B" ? lift : 0;
    ctx.save(); ctx.translate(lf * 22, y - lf * 8); ctx.rotate(lf * 0.015);
    if (lf > 0.01) { ctx.save(); ctx.shadowColor = "rgba(32,27,50,.4)"; ctx.shadowBlur = 30 * lf; ctx.shadowOffsetY = 14 * lf; ctx.fillStyle = "#f6f1df"; rr(-296, -62, 592, 138, 14); ctx.fill(); ctx.restore(); }
    // 검사 강조
    let hl = 0, ok = true;
    SCAN.forEach(([s, k, res]) => { if (k !== key) return; const v = p(t, s, s + 0.05) * (1 - (res ? p(t, s + 0.22, s + 0.46) : p(t, s + 0.1, s + 0.2))); if (v > hl) { hl = v; ok = res; } });
    if (hl > 0) {
      ctx.save(); ctx.globalAlpha *= hl; ctx.fillStyle = ok ? "rgba(128,215,182,.6)" : "rgba(243,167,133,.45)"; rr(-296, -62, 592, 138, 14); ctx.fill();
      ctx.strokeStyle = ok ? C.mintDark : "#c46a4a"; ctx.lineWidth = 7; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.beginPath();
      if (ok) { ctx.moveTo(234, -2); ctx.lineTo(250, 16); ctx.lineTo(278, -22); } else { ctx.moveTo(238, -20); ctx.lineTo(274, 16); ctx.moveTo(274, -20); ctx.lineTo(238, 16); }
      ctx.stroke();
      ctx.fillStyle = ok ? C.mintDark : "#c46a4a"; ctx.beginPath(); ctx.moveTo(-318, -14); ctx.lineTo(-300, 0); ctx.lineTo(-318, 14); ctx.fill();
      ctx.restore();
    }
    const unread = key === "B" ? win(t, 12.6, 16.9, 0.3) : 0;
    ctx.globalAlpha *= 1 - unread * 0.62;
    text(String(Math.round(slot[key]) + 1), -272, 10, { f: SANS, w: 800, size: 26, c: "#9a937c" });
    text(L.text.slice(0, n), -236, 12, { size: 46, c: C.ink });
    if (n < L.text.length || t < L.type[1] + 0.25) { if (Math.floor(t * 4) % 2 === 0 || n < L.text.length) { const cw = measure(L.text.slice(0, n), { size: 46 }); ctx.fillStyle = C.mintDark; ctx.fillRect(-232 + cw, -30, 4, 50); } }
    const ta = E.out(p(t, L.tags, L.tags + 0.35));
    if (ta > 0) { const w = chip("조건", L.cond, -236, 50 + (1 - ta) * 10, "rgba(246,199,109,.75)", ta); chip("행동", L.act, -226 + w, 50 + (1 - ta) * 10, "rgba(128,215,182,.85)", ta); }
    ctx.restore();
    if (unread > 0) text("읽히지 않음", 278, y + 58, { f: SANS, w: 700, size: 22, c: "#c46a4a", align: "right", a: unread });
  });
  // 끌어 옮기는 손
  const grab = win(t, 17.0, 18.8, 0.2);
  if (grab > 0) { ctx.save(); ctx.globalAlpha *= grab; ctx.translate(222 + lift * 22, slotY("B") - lift * 8 + 6); ctx.fillStyle = C.ink; ctx.strokeStyle = C.paper; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 0, 18 - lift * 4, 0, TAU); ctx.fill(); ctx.stroke(); ctx.restore(); }
  // AI 해석 안내
  const ai = Math.max(win(t, 5.8, 7.9), win(t, 11.55, 12.5));
  if (ai > 0) { star(-262, 208, 13, ai, C.mintDark); text("AI가 문장을 조건과 행동으로 해석", -238, 218, { f: SANS, w: 600, size: 27, c: "#4f6f60", a: ai }); }
  // Enter 키
  let press = 0; ENTERS.forEach((e) => { press = Math.max(press, 1 - p(t, e, e + 0.3)) * (t >= e ? 1 : 0) || press; });
  ctx.save(); ctx.translate(176, 272 + press * 7);
  ctx.fillStyle = "#b9b096"; rr(-104, -30 - press * 7 + 9, 208, 64, 16); ctx.fill();
  ctx.fillStyle = press > 0.05 ? C.mint : C.ink; rr(-104, -34, 208, 64, 16); ctx.fill();
  text("Enter ↵  출발", 0, 8, { f: SANS, w: 700, size: 27, c: press > 0.05 ? C.ink : C.cream, align: "center" });
  ctx.restore();
  ctx.restore();
}

const STEPS = [[4, "한 줄을 적는다"], [8.5, "죽으면 한 줄 더"], [12, "위에서부터 읽는다"], [16.5, "순서를 바꾼다"], [20, "출구까지"]];
const CAPTIONS = [
  [4.4, 8.4, "메모 *한 줄*을 적으면 용사는 적힌 대로 움직입니다"],
  [8.7, 10.1, "죽으면 입구로 돌아가고, *메모는 남습니다*"],
  [10.2, 12.3, "죽을 때마다 *한 줄*을 더 적습니다"],
  [12.5, 15.4, "매 행동마다 *위에서부터* 읽고, 맞는 *첫 줄*만 따릅니다"],
  [15.7, 17.0, "윗줄이 늘 맞으면 아랫줄은 *읽히지 않습니다*"],
  [17.1, 19.8, "줄의 *순서*를 바꿔 우선순위를 정합니다"],
  [20.0, 23.9, "구덩이가 보이면 *점프*, 아니면 *전진*"],
  [26.8, 30.6, "Jev가 선택지마다 *확률*을 매기고, *0.6 이상*일 때만 받아들입니다"],
  [31.3, 33.5, "AI는 문장만 *해석*하고, 결과는 게임 코어가 *확정*합니다"],
  [33.7, 35.7, "실행 중에는 AI를 *다시 부르지 않습니다*"],
];

function hud(t) {
  const a = p(t, 3.9, 4.4);
  text("HOW TO PLAY", 112, 92, { f: SANS, w: 700, size: 24, c: C.gold, ls: 7, a });
  let idx = 0; STEPS.forEach(([s], i) => { if (t >= s) idx = i; });
  STEPS.forEach(([s, label], i) => {
    const end = STEPS[i + 1]?.[0] ?? 99, k = E.out(p(t, s, s + 0.4)), o = p(t, end - 0.2, end);
    if (k <= 0 || o >= 1) return;
    ctx.save(); ctx.globalAlpha *= k * (1 - o); ctx.translate(0, (1 - k) * -24 - o * 24);
    text("0" + (i + 1), 110, 166, { size: 58, c: C.mint });
    text(label, 196, 166, { size: 58 });
    ctx.restore();
  });
  STEPS.forEach(([s], i) => {
    const x = 1560 + i * 58, end = STEPS[i + 1]?.[0] ?? CLEAR, f = p(t, s, end);
    ctx.save(); ctx.globalAlpha *= a; ctx.fillStyle = "rgba(184,220,222,.2)"; rr(x, 126, 48, 8, 4); ctx.fill();
    if (f > 0) { ctx.fillStyle = i === idx ? C.mint : C.moon; rr(x, 126, 48 * f, 8, 4); ctx.fill(); }
    ctx.restore();
  });
}

function captions(t) {
  CAPTIONS.forEach(([a0, b0, s]) => {
    const k = win(t, a0, b0, 0.22); if (k <= 0) return;
    const o = { f: SANS, w: 600, size: 42 }, segs = s.split("*"), tw = segs.reduce((w, x) => w + measure(x, o), 0);
    ctx.save(); ctx.globalAlpha *= k; ctx.translate(0, (1 - E.out(p(t, a0, a0 + 0.22))) * 22);
    ctx.fillStyle = "rgba(9,11,29,.78)"; rr(W / 2 - tw / 2 - 52, 925, tw + 104, 92, 46); ctx.fill();
    ctx.strokeStyle = "rgba(184,220,222,.2)"; ctx.lineWidth = 2; ctx.stroke();
    let x = W / 2 - tw / 2;
    segs.forEach((seg, i) => { text(seg, x, 986, { ...o, c: i % 2 ? C.mint : C.cream, w: i % 2 ? 800 : 600 }); x += measure(seg, o); });
    ctx.restore();
  });
}

function game(t) {
  if (t < 3.7 || t > 26.3) return;
  const out = E.in(p(t, 25.8, 26.3));
  let shake = 0; DEATHS.forEach((td) => { const d = t - td; if (d >= 0) shake += Math.exp(-d * 7) * 18; });
  ctx.save();
  ctx.globalAlpha = (1 - out) * p(t, 3.8, 4.3);
  ctx.translate(W / 2 + Math.sin(t * 95) * shake, H / 2 + Math.cos(t * 83) * shake * 0.6);
  ctx.scale(1 + out * 0.08, 1 + out * 0.08); ctx.translate(-W / 2, -H / 2);
  ctx.save(); ctx.translate((1 - E.out(p(t, 3.9, 4.6))) * 240, 0); stage(t); ctx.restore();
  notepad(t); hud(t);
  ctx.restore();
}

// ───────── 26–36초 원리. 막대 길이는 설명용 예시이고 기준 0.6만 실제 값이다.
const OPTS = [
  ["핵심 행동은?", [["전진", 0.04], ["점프", 0.95], ["숙이기", 0.02], ["우회", 0.02]], 27.0],
  ["조건의 종류는?", [["무조건", 0.05], ["명확한 조건", 0.93], ["불명확", 0.03]], 27.8],
];
const SITU = [["평평한 길", false], ["구덩이", true], ["바닥 가시", false], ["낮은 가시 통로", false]];
const PIPE = [
  ["해석", "Jev · DeepSeek", "입력할 때 한 번만 호출", 31.3],
  ["코어", "우선순위 · 충돌 · 성공", "AI 없이 결과를 확정", 32.1],
  ["Canvas", "재생", "확정된 기록을 그대로 재생", 32.9],
];
function card(x, y, w, h, c = "rgba(184,220,222,.22)") {
  ctx.fillStyle = "rgba(17,19,47,.88)"; rr(x, y, w, h, 22); ctx.fill();
  ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.stroke();
}

function tech(t) {
  const a = Math.min(p(t, 26.1, 26.5), 1 - p(t, 35.7, 36.1)); if (a <= 0) return;
  ctx.save(); ctx.globalAlpha = a;
  text("HOW IT WORKS", 112, 92, { f: SANS, w: 700, size: 24, c: C.gold, ls: 7 });
  [[26.2, 31, "Jev가 문장을 판단한다"], [31, 37, "판정은 코어가 확정한다"]].forEach(([s, e, label]) => {
    const k = E.out(p(t, s, s + 0.4)), o = p(t, e - 0.2, e); if (k <= 0 || o >= 1) return;
    text(label, 110, 166 + (1 - k) * -24 - o * 24, { size: 58, a: k * (1 - o) });
  });
  const A = 1 - p(t, 30.6, 31), B = p(t, 31, 31.4);
  if (A > 0) {
    ctx.save(); ctx.globalAlpha *= A; ctx.translate(-120 * E.in(1 - A), 0);
    const CX = 1010, CW = 800, CHh = 176, JX = 880, JY = 420;
    // 메모 한 줄 → Jev
    text("플레이어가 적은 한 줄", 112, 326, { f: SANS, w: 600, size: 26, c: C.moon, a: p(t, 26.4, 26.8) });
    const sk = E.back(p(t, 26.4, 26.9));
    ctx.save(); ctx.translate(400, JY); ctx.rotate(-0.02); ctx.scale(sk, sk); ctx.globalAlpha *= p(t, 26.4, 26.6);
    ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = 50; ctx.shadowOffsetY = 22;
    ctx.fillStyle = C.paper; rr(-290, -62, 580, 124, 14); ctx.fill(); ctx.shadowColor = "transparent";
    text("구덩이가 보이면 점프해", 0, 17, { size: 46, c: C.ink, align: "center" });
    ctx.restore();
    const ak = p(t, 26.8, 27.1);
    ctx.save(); ctx.globalAlpha *= ak; ctx.strokeStyle = C.mint; ctx.lineWidth = 5; ctx.setLineDash([12, 10]); ctx.lineDashOffset = -t * 70;
    ctx.beginPath(); ctx.moveTo(706, JY); ctx.lineTo(706 + 84 * ak, JY); ctx.stroke(); ctx.restore();
    const jk = E.back(p(t, 26.8, 27.3)), pulse = 0.5 + 0.5 * Math.sin(t * 6);
    OPTS.map((o) => o[2]).concat(28.6).forEach((s, i) => {
      const k = E.out(p(t, s - 0.1, s + 0.3)); if (k <= 0) return;
      const y = 232 + i * 200 + CHh / 2;
      ctx.save(); ctx.globalAlpha *= 0.55 * k; ctx.strokeStyle = C.mint; ctx.lineWidth = 3; ctx.beginPath();
      ctx.moveTo(JX + 70, JY); ctx.bezierCurveTo(JX + 110, JY, CX - 50, y, CX, y); ctx.stroke(); ctx.restore();
    });
    if (jk > 0) {
      ctx.save(); ctx.translate(JX, JY); ctx.scale(jk, jk);
      ctx.strokeStyle = `rgba(128,215,182,${0.45 * (1 - pulse)})`; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 0, 78 + pulse * 22, 0, TAU); ctx.stroke();
      ctx.fillStyle = C.mint; ctx.beginPath(); ctx.arc(0, 0, 74, 0, TAU); ctx.fill();
      text("Jev", 0, 17, { size: 50, c: C.ink, align: "center" });
      ctx.restore();
    }
    text("TypeSafe Jev", JX, 548, { f: SANS, w: 600, size: 24, c: C.moon, align: "center", a: p(t, 27, 27.4) });
    // 질문 카드: 선택지별 확률
    OPTS.forEach(([q, opts, s], ci) => {
      const k = E.out(p(t, s, s + 0.45)); if (k <= 0) return;
      const y = 232 + ci * 200, cw = (CW - 64) / opts.length, f = E.out(p(t, s + 0.3, s + 0.9));
      ctx.save(); ctx.globalAlpha *= k; ctx.translate((1 - k) * 80, 0);
      card(CX, y, CW, CHh);
      text(q, CX + 32, y + 52, { f: SANS, w: 700, size: 28 });
      if (ci === 0) text("기준 0.6", CX + CW - 32, y + 52, { f: SANS, w: 700, size: 22, c: C.gold, align: "right" });
      opts.forEach(([label, v], i) => {
        const x = CX + 32 + i * cw, top = v > 0.6, bw = cw - 24;
        ctx.fillStyle = "rgba(184,220,222,.16)"; rr(x, y + 86, bw, 14, 7); ctx.fill();
        ctx.fillStyle = top ? C.mint : C.moon; rr(x, y + 86, Math.max(14, bw * v * f), 14, 7); ctx.fill();
        ctx.fillStyle = C.gold; ctx.fillRect(x + bw * 0.6 - 1, y + 80, 3, 26);
        text(label, x, y + 144, { f: SANS, w: top ? 800 : 500, size: 28, c: top ? C.mint : C.moon });
      });
      ctx.restore();
    });
    const k3 = E.out(p(t, 28.6, 29.05));
    if (k3 > 0) {
      const y = 632; let x = CX + 32;
      ctx.save(); ctx.globalAlpha *= k3; ctx.translate((1 - k3) * 80, 0);
      card(CX, y, CW, CHh);
      text("어느 상황에 적용되는가?", CX + 32, y + 52, { f: SANS, w: 700, size: 28 });
      SITU.forEach(([label, ok], i) => {
        const o = { f: SANS, w: ok ? 800 : 500, size: 26 }, w = measure(label, o) + 74, kk = E.back(p(t, 28.9 + i * 0.13, 29.3 + i * 0.13));
        ctx.save(); ctx.translate(x + w / 2, y + 116); ctx.scale(kk, kk);
        ctx.fillStyle = ok ? C.mint : "rgba(184,220,222,.13)"; rr(-w / 2, -26, w, 52, 26); ctx.fill();
        ctx.strokeStyle = ok ? C.ink : C.peach; ctx.lineWidth = 4; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.beginPath();
        if (ok) { ctx.moveTo(-w / 2 + 20, 0); ctx.lineTo(-w / 2 + 28, 9); ctx.lineTo(-w / 2 + 42, -9); } else { ctx.moveTo(-w / 2 + 22, -8); ctx.lineTo(-w / 2 + 38, 8); ctx.moveTo(-w / 2 + 38, -8); ctx.lineTo(-w / 2 + 22, 8); }
        ctx.stroke();
        text(label, -w / 2 + 54, 9, { ...o, c: ok ? C.ink : C.moon });
        ctx.restore(); x += w + 12;
      });
      ctx.restore();
    }
    // 구조화된 결과
    const rk = E.out(p(t, 29.5, 29.9));
    if (rk > 0) {
      text("수칙으로 저장", 112, 650, { f: SANS, w: 600, size: 26, c: C.moon, a: rk });
      ctx.save(); ctx.translate(112, 712 + (1 - rk) * 16); ctx.scale(1.5, 1.5);
      const w = chip("조건", "구덩이가 보이면", 0, 0, "rgba(246,199,109,.92)", rk); chip("행동", "점프", w + 10, 0, "rgba(128,215,182,.95)", rk);
      ctx.restore();
    }
    ctx.restore();
  }
  if (B > 0) {
    ctx.save(); ctx.globalAlpha *= B;
    PIPE.forEach(([title, tag, sub, s], i) => {
      const x = 380 + i * 580, y = 500, k = E.back(p(t, s, s + 0.5));
      if (i > 0) {
        const lk = E.out(p(t, s - 0.35, s + 0.05)), x0 = x - 370, x1 = x - 210;
        ctx.save(); ctx.strokeStyle = "rgba(184,220,222,.5)"; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(lerp(x0, x1, lk), y); ctx.stroke();
        if (lk >= 1) { ctx.fillStyle = C.mint; ctx.shadowColor = C.mint; ctx.shadowBlur = 18; ctx.beginPath(); ctx.arc(lerp(x0, x1, (t * 0.9 + i * 0.5) % 1), y, 9, 0, TAU); ctx.fill(); }
        ctx.restore();
      }
      if (k <= 0) return;
      ctx.save(); ctx.translate(x, y); ctx.scale(k, k); ctx.globalAlpha *= p(t, s, s + 0.2);
      card(-210, -150, 420, 300, i === 1 ? C.mint : undefined);
      text(title, 0, -38, { size: 74, align: "center", c: i === 1 ? C.mint : C.cream });
      const to = { f: SANS, w: 700, size: 24 }, tw = measure(tag, to) + 44;
      ctx.fillStyle = "rgba(246,199,109,.16)"; rr(-tw / 2, 4, tw, 46, 23); ctx.fill();
      text(tag, 0, 36, { ...to, c: C.gold, align: "center" });
      text(sub, 0, 108, { f: SANS, w: 500, size: 28, c: C.moon, align: "center" });
      ctx.restore();
    });
    text("프롤로그·1장은 Jev, 2~10장은 DeepSeek가 문장을 해석합니다", W / 2, 770, { f: SANS, w: 500, size: 30, c: C.moon, align: "center", a: p(t, 33.2, 33.7) });
    ctx.restore();
  }
  ctx.restore();
}

// ───────── 36–40초 마무리
function outro(t) {
  t -= 10;
  const a = p(t, 26.1, 26.5); if (a <= 0) return;
  ctx.save(); ctx.globalAlpha = a;
  const mv = E.inOut(p(t, 27.4, 27.9)), cy = lerp(560, 860, mv), sc = lerp(1, 0.4, mv), cnt = E.expo(p(t, 26.2, 27.1));
  ctx.save(); ctx.translate(W / 2, cy); ctx.scale(sc, sc);
  const parts = [[String(Math.round(10 * cnt)), 230, C.mint, SERIF], ["장", 100, C.cream, SERIF], ["  ·  ", 100, C.moon, SERIF], [String(Math.round(60 * cnt)).padStart(2, "0"), 230, C.gold, SERIF], ["스테이지", 100, C.cream, SERIF]];
  let tw = parts.reduce((w, [s, size]) => w + measure(s, { size }), 0), x = -tw / 2;
  parts.forEach(([s, size, c]) => { text(s, x, 60, { size, c }); x += measure(s, { size }); });
  ctx.restore();
  const o1 = { size: 150 }, w1 = measure("죽을 때마다 ", o1), w2 = measure("한 줄", o1), x0 = W / 2 - (w1 + w2) / 2;
  riseText("죽을 때마다 ", x0, 560, o1, t, 27.6, 0.05);
  riseText("한 줄", x0 + w1, 560, { ...o1, c: C.mint }, t, 27.95, 0.08);
  brush(x0 + w1 + 4, x0 + w1 + w2, 598, E.out(p(t, 28.2, 28.6)), C.gold, 10);
  const hk = E.back(p(t, 27.7, 28.2));
  if (hk > 0) hero("joy", W / 2, 370 - Math.abs(Math.sin((t - 27.7) * 5)) * 26, 0.62 * hk);
  [[-250, 250, 18], [260, 210, 24], [330, 330, 10], [-330, 340, 12]].forEach(([dx, y, r], i) => star(W / 2 + dx, y, r * (0.8 + 0.3 * Math.sin(t * 5 + i)), p(t, 28, 28.4)));
  const uk = E.out(p(t, 28.4, 28.9));
  text("olpd.vercel.app", W / 2, 700 + (1 - uk) * 16, { f: SANS, w: 500, size: 40, c: C.moon, align: "center", ls: 4, a: uk });
  ctx.restore();
  const fade = p(t, 29.5, 30); if (fade > 0) { ctx.fillStyle = `rgba(9,11,29,${fade})`; ctx.fillRect(0, 0, W, H); }
}

export function renderAt(t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
  background(t); title(t); game(t); tech(t); outro(t); captions(t);
  const fin = 1 - p(t, 0, 0.35); if (fin > 0) { ctx.fillStyle = `rgba(9,11,29,${fin})`; ctx.fillRect(0, 0, W, H); }
}

export async function ready(spriteUrl) {
  sheet.src = spriteUrl; await sheet.decode();
  // 필요한 글리프 묶음을 모두 받도록 전 구간을 미리 그린 뒤 글꼴을 기다린다.
  for (let pass = 0; pass < 2; pass++) { for (let t = 0; t < DUR; t += 0.25) renderAt(t); await document.fonts.ready; }
  renderAt(0);
}
