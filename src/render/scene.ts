import type { Observation, Phase } from "../game/types";
import { detourPathPoint, FLOOR_Y, type HeroFrame } from "./animation";
import { PALETTE as C } from "./palette";

export const VIEW_WIDTH = 960;
export const VIEW_HEIGHT = 500;

interface SceneFrame {
  time: number;
  hero: HeroFrame;
  observation: Observation;
  phase: Phase;
  reducedMotion: boolean;
}

const BACKDROP_ARCHES = [102, 386, 774] as const;
const BACKDROP_PILLARS = [23, 272, 889] as const;
const VINE_LEAVES = [
  [826, 55, -0.5],
  [842, 94, 0.35],
  [827, 135, -0.45],
  [836, 180, 0.35],
  [824, 227, -0.4],
] as const;
const FLOOR_LEAVES = [
  [78, 379],
  [97, 386],
  [748, 389],
  [781, 381],
  [904, 388],
] as const;
const COZY_GLOWS = [
  [64, 394, 1, "#80d7b6"],
  [89, 396, 0.66, "#f6c76d"],
  [738, 395, 0.62, "#f3a785"],
  [924, 394, 0.86, "#80d7b6"],
] as const;
const COZY_PLANTS = [
  [327, 390, 1],
  [786, 388, -1],
] as const;

const roundedRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) => {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
};

function stonePath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  bevel = 5,
) {
  ctx.beginPath();
  ctx.moveTo(x + bevel, y);
  ctx.lineTo(x + w - bevel, y);
  ctx.lineTo(x + w, y + bevel);
  ctx.lineTo(x + w - 2, y + h - bevel);
  ctx.lineTo(x + w - bevel, y + h);
  ctx.lineTo(x + bevel, y + h);
  ctx.lineTo(x, y + h - bevel);
  ctx.lineTo(x + 2, y + bevel);
  ctx.closePath();
}

function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  t: number,
  reducedMotion: boolean,
) {
  const bg = ctx.createLinearGradient(0, 0, 0, VIEW_HEIGHT);
  bg.addColorStop(0, "#11132f");
  bg.addColorStop(0.42, "#1b1d48");
  bg.addColorStop(0.75, "#2a2852");
  bg.addColorStop(1, "#18162f");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);

  // Far cavern silhouettes and a broad shaft make the room feel deep while
  // keeping the upper-left caption area calm.
  ctx.fillStyle = "rgba(7,9,29,.52)";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  for (let x = 0; x <= VIEW_WIDTH; x += 64) {
    ctx.lineTo(x, 38 + ((x / 64) % 3) * 19);
  }
  ctx.lineTo(VIEW_WIDTH, 0);
  ctx.closePath();
  ctx.fill();

  const shaft = ctx.createLinearGradient(544, 24, 746, 412);
  shaft.addColorStop(0, "rgba(202,238,231,.24)");
  shaft.addColorStop(0.46, "rgba(128,215,182,.10)");
  shaft.addColorStop(1, "rgba(125,158,177,0)");
  ctx.fillStyle = shaft;
  ctx.beginPath();
  ctx.moveTo(596, 0);
  ctx.lineTo(782, 0);
  ctx.lineTo(700, 405);
  ctx.lineTo(484, 405);
  ctx.closePath();
  ctx.fill();

  // Rounded masonry catches dim lavender light instead of reading as stripes.
  for (let row = 0; row < 5; row++) {
    const y = 54 + row * 55;
    const offset = row % 2 ? -35 : 8;
    for (let x = offset; x < VIEW_WIDTH; x += 105) {
      const light = 0.055 + row * 0.009;
      ctx.fillStyle = `rgba(164,157,199,${light})`;
      roundedRect(ctx, x, y, 91, 41, 12);
      ctx.fill();
      ctx.strokeStyle = "rgba(8,9,31,.22)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  ctx.lineWidth = 11;
  for (const x of BACKDROP_ARCHES) {
    const archGlow = ctx.createLinearGradient(x - 100, 160, x + 100, 390);
    archGlow.addColorStop(0, "rgba(112,105,164,.35)");
    archGlow.addColorStop(1, "rgba(44,41,91,.68)");
    ctx.strokeStyle = archGlow;
    ctx.beginPath();
    ctx.arc(x, 258, 98, Math.PI, 0);
    ctx.lineTo(x + 98, 392);
    ctx.moveTo(x - 98, 258);
    ctx.lineTo(x - 98, 392);
    ctx.stroke();
    ctx.fillStyle = "rgba(6,8,29,.42)";
    ctx.beginPath();
    ctx.arc(x, 258, 82, Math.PI, 0);
    ctx.lineTo(x + 82, 392);
    ctx.lineTo(x - 82, 392);
    ctx.closePath();
    ctx.fill();
  }

  // Broken pillars and moss sit in the middle plane.
  for (const x of BACKDROP_PILLARS) {
    ctx.fillStyle = "#302e5b";
    stonePath(ctx, x, 144, 32, 245, 5);
    ctx.fill();
    ctx.fillStyle = "#4c4775";
    ctx.fillRect(x - 7, 140, 46, 9);
    ctx.fillStyle = "rgba(188,180,222,.12)";
    ctx.fillRect(x + 5, 154, 5, 226);
  }

  const mist = ctx.createLinearGradient(0, 300, 0, 408);
  mist.addColorStop(0, "rgba(128,215,182,0)");
  mist.addColorStop(0.62, "rgba(128,215,182,.055)");
  mist.addColorStop(1, "rgba(184,220,222,.11)");
  ctx.fillStyle = mist;
  ctx.fillRect(0, 278, VIEW_WIDTH, 130);

  drawVines(ctx, t, reducedMotion);
}

function drawVines(
  ctx: CanvasRenderingContext2D,
  t: number,
  reducedMotion: boolean,
) {
  const sway = reducedMotion ? 0 : Math.sin(t * 0.7) * 2;
  ctx.strokeStyle = C.moss;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(820, 0);
  ctx.bezierCurveTo(818 + sway, 55, 852 - sway, 96, 833, 156);
  ctx.bezierCurveTo(818, 195, 846 + sway, 224, 826, 274);
  ctx.stroke();
  ctx.fillStyle = C.leaf;
  for (const [x, y, r] of VINE_LEAVES) {
    ctx.save();
    ctx.translate(x + sway, y);
    ctx.rotate(r);
    ctx.beginPath();
    ctx.ellipse(0, 0, 9, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = "#477764";
  for (const [x, y] of FLOOR_LEAVES) {
    ctx.beginPath();
    ctx.ellipse(x, y, 11, 4, -0.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTorch(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  t: number,
  reducedMotion: boolean,
) {
  const flicker = reducedMotion
    ? 0
    : Math.sin(t * 9 + x) * 3 + Math.sin(t * 15) * 1.5;
  const glow = ctx.createRadialGradient(x, y, 3, x, y, 88 + flicker);
  glow.addColorStop(0, "rgba(255,190,104,.34)");
  glow.addColorStop(0.45, "rgba(255,139,85,.12)");
  glow.addColorStop(1, "rgba(255,139,85,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(x - 100, y - 100, 200, 200);
  ctx.strokeStyle = "#75604d";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(x, y + 12);
  ctx.lineTo(x, y + 48);
  ctx.stroke();
  ctx.strokeStyle = "#31283b";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x - 11, y + 44);
  ctx.lineTo(x + 11, y + 44);
  ctx.stroke();
  ctx.fillStyle = C.flame;
  ctx.beginPath();
  ctx.moveTo(x, y + 15);
  ctx.bezierCurveTo(
    x - 15,
    y + 2,
    x - 9,
    y - 14 - flicker,
    x + 2,
    y - 24 - flicker,
  );
  ctx.bezierCurveTo(x + 15, y - 7, x + 14, y + 7, x, y + 15);
  ctx.fill();
  ctx.fillStyle = "#ffe28c";
  ctx.beginPath();
  ctx.ellipse(x + 1, y + 3, 5, 10, 0.16, 0, Math.PI * 2);
  ctx.fill();
}

function drawFloor(ctx: CanvasRenderingContext2D) {
  const grad = ctx.createLinearGradient(0, FLOOR_Y - 10, 0, VIEW_HEIGHT);
  grad.addColorStop(0, "#77709a");
  grad.addColorStop(0.1, "#4c4875");
  grad.addColorStop(0.55, "#35325f");
  grad.addColorStop(1, "#211f43");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(0, FLOOR_Y - 8);
  ctx.lineTo(VIEW_WIDTH, FLOOR_Y - 8);
  ctx.lineTo(VIEW_WIDTH, VIEW_HEIGHT);
  ctx.lineTo(0, VIEW_HEIGHT);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(211,202,229,.48)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, FLOOR_Y - 7);
  ctx.lineTo(VIEW_WIDTH, FLOOR_Y - 7);
  ctx.stroke();
  for (let row = 0; row < 3; row++) {
    const y = 410 + row * 31;
    const offset = row % 2 ? -48 : -4;
    for (let x = offset; x < VIEW_WIDTH; x += 104) {
      ctx.fillStyle = `rgba(17,16,48,${0.18 + row * 0.08})`;
      roundedRect(ctx, x, y, 94, 25, 8);
      ctx.fill();
      ctx.strokeStyle = "rgba(118,111,155,.25)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  const lip = ctx.createLinearGradient(0, 392, 0, 414);
  lip.addColorStop(0, "rgba(221,211,236,.17)");
  lip.addColorStop(1, "rgba(54,50,95,0)");
  ctx.fillStyle = lip;
  ctx.fillRect(0, FLOOR_Y - 7, VIEW_WIDTH, 25);
}

function cutPit(ctx: CanvasRenderingContext2D, bridge: boolean) {
  const x = 500;
  const w = 190;
  const voidGradient = ctx.createLinearGradient(0, FLOOR_Y - 8, 0, VIEW_HEIGHT);
  voidGradient.addColorStop(0, "#060815");
  voidGradient.addColorStop(1, "#111129");
  ctx.fillStyle = voidGradient;
  ctx.beginPath();
  ctx.moveTo(x, FLOOR_Y - 9);
  ctx.lineTo(x + 12, FLOOR_Y + 6);
  ctx.lineTo(x + 3, VIEW_HEIGHT);
  ctx.lineTo(x + w - 8, VIEW_HEIGHT);
  ctx.lineTo(x + w - 14, FLOOR_Y + 7);
  ctx.lineTo(x + w, FLOOR_Y - 9);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#84799c";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x - 6, FLOOR_Y - 9);
  ctx.lineTo(x + 8, FLOOR_Y + 3);
  ctx.moveTo(x + w + 7, FLOOR_Y - 9);
  ctx.lineTo(x + w - 12, FLOOR_Y + 4);
  ctx.stroke();
  if (bridge) drawBrokenBridge(ctx, x, w);
  else {
    ctx.strokeStyle = "rgba(99,93,136,.42)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + 24, FLOOR_Y + 14);
    ctx.lineTo(x + 42, VIEW_HEIGHT);
    ctx.moveTo(x + w - 24, FLOOR_Y + 14);
    ctx.lineTo(x + w - 46, VIEW_HEIGHT);
    ctx.stroke();
  }
}

function drawBrokenBridge(ctx: CanvasRenderingContext2D, x: number, w: number) {
  ctx.strokeStyle = "#382b38";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x - 7, FLOOR_Y - 4);
  ctx.quadraticCurveTo(x + 88, FLOOR_Y + 20, x + w + 8, FLOOR_Y - 4);
  ctx.moveTo(x - 7, FLOOR_Y + 4);
  ctx.quadraticCurveTo(x + 88, FLOOR_Y + 35, x + w + 8, FLOOR_Y + 4);
  ctx.stroke();
  const planks = [
    [505, 394, 36, 12, 0.08],
    [545, 401, 31, 11, 0.14],
    [582, 411, 20, 10, 0.28],
    [630, 405, 24, 10, -0.22],
    [660, 397, 34, 11, -0.12],
  ] as const;
  for (const [px, py, pw, ph, r] of planks) {
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(r);
    ctx.fillStyle = "#76604f";
    roundedRect(ctx, 0, 0, pw, ph, 2);
    ctx.fill();
    ctx.fillStyle = "#a17b59";
    ctx.fillRect(4, 2, pw - 8, 2);
    ctx.restore();
  }
}

function drawSpikes(ctx: CanvasRenderingContext2D, ceiling: boolean) {
  const y = ceiling ? 322 : FLOOR_Y - 8;
  const start = ceiling ? 490 : 510;
  const count = ceiling ? 9 : 7;
  const spacing = ceiling ? 25 : 25;
  ctx.fillStyle = ceiling ? "#32305b" : "#29274d";
  ctx.fillRect(start - 9, ceiling ? y - 18 : y, count * spacing + 13, 18);
  for (let i = 0; i < count; i++) {
    const x = start + i * spacing;
    const h = ceiling ? 22 + (i % 3) * 3 : 32 + (i % 3) * 5;
    const grad = ctx.createLinearGradient(
      x,
      y,
      x + 14,
      ceiling ? y + h : y - h,
    );
    grad.addColorStop(0, "#696587");
    grad.addColorStop(0.65, C.spike);
    grad.addColorStop(1, C.spikeLight);
    ctx.fillStyle = grad;
    ctx.beginPath();
    if (ceiling) {
      ctx.moveTo(x - 9, y);
      ctx.lineTo(x + 8, y + h);
      ctx.lineTo(x + 14, y);
    } else {
      ctx.moveTo(x - 9, y);
      ctx.lineTo(x + 5, y - h);
      ctx.lineTo(x + 14, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(32,28,58,.55)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

function drawLowCeiling(ctx: CanvasRenderingContext2D) {
  const grad = ctx.createLinearGradient(0, 276, 0, 324);
  grad.addColorStop(0, "#27254d");
  grad.addColorStop(1, C.stone);
  ctx.fillStyle = grad;
  stonePath(ctx, 465, 268, 252, 56, 7);
  ctx.fill();
  ctx.strokeStyle = "#585278";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(475, 316);
  ctx.lineTo(706, 316);
  ctx.stroke();
  drawSpikes(ctx, true);
}

function drawSidePath(ctx: CanvasRenderingContext2D) {
  const tracePath = (start = 0, end = 1, yOffset = 0) => {
    ctx.beginPath();
    const count = 36;
    for (let i = 0; i <= count; i++) {
      const t = start + ((end - start) * i) / count;
      const point = detourPathPoint(t);
      if (i === 0) ctx.moveTo(point.x, point.y + yOffset);
      else ctx.lineTo(point.x, point.y + yOffset);
    }
  };

  // The upper lane is a wall gallery, visually separate from the direct floor.
  ctx.fillStyle = "rgba(8,11,34,.62)";
  roundedRect(ctx, 470, 202, 212, 69, 18);
  ctx.fill();
  ctx.strokeStyle = "rgba(111,111,157,.4)";
  ctx.lineWidth = 5;
  roundedRect(ctx, 470, 202, 212, 69, 18);
  ctx.stroke();
  ctx.strokeStyle = "rgba(176,192,189,.2)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(487, 222);
  ctx.lineTo(665, 222);
  ctx.stroke();

  // Short wall brackets attach the ledge to the masonry without reading as a
  // bridge suspended over the pit.
  for (const progress of [0.38, 0.5, 0.62]) {
    const point = detourPathPoint(progress);
    ctx.strokeStyle = "rgba(57,57,91,.92)";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(point.x, point.y + 5);
    ctx.lineTo(point.x - 8, point.y + 27);
    ctx.stroke();
  }

  // A broad continuous deck shares its exact centerline with the hero feet.
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  tracePath();
  ctx.strokeStyle = "rgba(12,15,38,.72)";
  ctx.lineWidth = 27;
  ctx.stroke();
  tracePath();
  ctx.strokeStyle = "#545b70";
  ctx.lineWidth = 21;
  ctx.stroke();
  tracePath();
  ctx.strokeStyle = "#78838a";
  ctx.lineWidth = 15;
  ctx.stroke();
  tracePath(0, 1, -5);
  ctx.strokeStyle = "rgba(208,216,205,.38)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Stone seams and small chevrons explain walking direction without prose.
  for (let i = 1; i < 13; i++) {
    const t = i / 12;
    const point = detourPathPoint(t);
    const next = detourPathPoint(Math.min(1, t + 0.012));
    const angle = Math.atan2(next.y - point.y, next.x - point.x);
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(angle + Math.PI / 2);
    ctx.fillStyle = i % 3 === 0 ? "#817968" : "#686d76";
    roundedRect(ctx, -8 * point.scale, -2, 16 * point.scale, 4, 2);
    ctx.fill();
    ctx.restore();
  }
  for (const t of [0.12, 0.5, 0.88]) {
    const point = detourPathPoint(t);
    const next = detourPathPoint(Math.min(1, t + 0.015));
    const angle = Math.atan2(next.y - point.y, next.x - point.x);
    ctx.save();
    ctx.translate(point.x, point.y - 3);
    ctx.rotate(angle);
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 2.3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-5, -4);
    ctx.lineTo(1, 0);
    ctx.lineTo(-5, 4);
    ctx.stroke();
    ctx.restore();
  }

  // Two boards at the fork keep the direct road and the upper side lane distinct.
  ctx.fillStyle = "#5e4d48";
  ctx.fillRect(404, 326, 7, 69);
  ctx.fillStyle = "#8a6b52";
  stonePath(ctx, 373, 310, 78, 28, 5);
  ctx.fill();
  ctx.fillStyle = "#6f6258";
  stonePath(ctx, 378, 344, 68, 26, 5);
  ctx.fill();
  ctx.strokeStyle = C.peachLight;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(388, 330);
  ctx.lineTo(433, 318);
  ctx.lineTo(422, 313);
  ctx.moveTo(433, 318);
  ctx.lineTo(425, 327);
  ctx.moveTo(390, 357);
  ctx.lineTo(432, 357);
  ctx.lineTo(423, 351);
  ctx.moveTo(432, 357);
  ctx.lineTo(423, 363);
  ctx.stroke();
  ctx.lineCap = "butt";
}

function drawSidePathFootOcclusion(
  ctx: CanvasRenderingContext2D,
  hero: HeroFrame,
) {
  const halfWidth = 16 * hero.scale;
  ctx.strokeStyle = "rgba(42,43,67,.82)";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(hero.x - halfWidth, hero.y + 1);
  ctx.lineTo(hero.x + halfWidth, hero.y + 1);
  ctx.stroke();
  ctx.lineCap = "butt";
}

function drawDoor(ctx: CanvasRenderingContext2D, phase: Phase, t: number) {
  ctx.fillStyle = "#181833";
  ctx.beginPath();
  ctx.arc(858, 311, 50, Math.PI, 0);
  ctx.lineTo(908, FLOOR_Y - 8);
  ctx.lineTo(808, FLOOR_Y - 8);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#4f4b72";
  ctx.lineWidth = 9;
  ctx.stroke();
  const glowStrength =
    phase === "cleared" ? 0.52 + Math.sin(t * 3) * 0.07 : 0.16;
  const glow = ctx.createRadialGradient(858, 345, 5, 858, 345, 65);
  glow.addColorStop(0, `rgba(128,215,182,${glowStrength})`);
  glow.addColorStop(1, "rgba(128,215,182,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(790, 280, 138, 125);
  ctx.fillStyle = "#2f2b55";
  ctx.beginPath();
  ctx.arc(858, 311, 38, Math.PI, 0);
  ctx.lineTo(896, 394);
  ctx.lineTo(820, 394);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = phase === "cleared" ? C.mint : "#76749b";
  ctx.beginPath();
  ctx.arc(879, 352, 3, 0, Math.PI * 2);
  ctx.fill();
}

function drawDust(
  ctx: CanvasRenderingContext2D,
  t: number,
  reducedMotion: boolean,
) {
  ctx.fillStyle = "rgba(196,205,217,.34)";
  const count = reducedMotion ? 5 : 17;
  for (let i = 0; i < count; i++) {
    const drift = reducedMotion ? 0 : t * (5 + (i % 4));
    const x = ((43 + i * 83 + drift) % 900) + 25;
    const y = 90 + ((((i * 61 - drift * 0.7) % 265) + 265) % 265);
    ctx.beginPath();
    ctx.arc(x, y, i % 3 === 0 ? 1.7 : 1, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCozyDetails(
  ctx: CanvasRenderingContext2D,
  t: number,
  reducedMotion: boolean,
) {
  const pulse = reducedMotion ? 0 : (Math.sin(t * 2.4) + 1) * 0.04;
  for (const [x, y, s, color] of COZY_GLOWS) {
    const glow = ctx.createRadialGradient(x, y - 12, 1, x, y - 12, 24 * s);
    glow.addColorStop(0, `${color}${Math.round((0.18 + pulse) * 255)
      .toString(16)
      .padStart(2, "0")}`);
    glow.addColorStop(1, `${color}00`);
    ctx.fillStyle = glow;
    ctx.fillRect(x - 28 * s, y - 40 * s, 56 * s, 48 * s);

    ctx.fillStyle = "#ddd5cb";
    roundedRect(ctx, x - 3 * s, y - 13 * s, 6 * s, 14 * s, 3 * s);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x, y - 14 * s, 11 * s, 7 * s, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.32)";
    ctx.beginPath();
    ctx.ellipse(x - 3 * s, y - 17 * s, 2.2 * s, 1.4 * s, -0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const [x, y, flip] of COZY_PLANTS) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(flip, 1);
    ctx.fillStyle = "#6ca084";
    ctx.beginPath();
    ctx.ellipse(-8, 0, 14, 5, -0.55, 0, Math.PI * 2);
    ctx.ellipse(8, -2, 12, 4, 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#96c6a7";
    ctx.beginPath();
    ctx.ellipse(0, -5, 10, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

interface HeroSpriteSpec {
  x: number;
  y: number;
  width: number;
  height: number;
  baseline: number;
}

const HERO_SHEET_SCALE = 0.3;
const HERO_SPRITES: Record<HeroFrame["pose"], HeroSpriteSpec> = {
  idle: { x: 45, y: 60, width: 340, height: 365, baseline: 344 },
  walk: { x: 500, y: 70, width: 340, height: 355, baseline: 334 },
  jump: { x: 910, y: 40, width: 400, height: 365, baseline: 342 },
  duck: { x: 1370, y: 150, width: 390, height: 270, baseline: 244 },
  detour: { x: 500, y: 70, width: 340, height: 355, baseline: 334 },
  death: { x: 60, y: 520, width: 380, height: 330, baseline: 306 },
  revive: { x: 510, y: 470, width: 420, height: 380, baseline: 356 },
  joy: { x: 990, y: 470, width: 430, height: 380, baseline: 352 },
};
let heroSheet: HTMLImageElement | null = null;

function getHeroSheet() {
  if (!heroSheet && typeof Image !== "undefined") {
    heroSheet = new Image();
    heroSheet.decoding = "async";
    heroSheet.src = "/art/moru-sprite-sheet-v3.png";
  }
  return heroSheet;
}

function drawHeroLoadingSilhouette(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = C.mintDark;
  ctx.beginPath();
  ctx.ellipse(0, -45, 42, 48, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff1d9";
  ctx.beginPath();
  ctx.ellipse(0, -42, 30, 29, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = C.ink;
  ctx.beginPath();
  ctx.arc(-10, -45, 4, 0, Math.PI * 2);
  ctx.arc(10, -45, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawHero(ctx: CanvasRenderingContext2D, hero: HeroFrame, t: number) {
  const { x, y, pose, phase, facing, opacity, scale, rotation } = hero;
  ctx.save();
  ctx.globalAlpha = opacity;
  // Shadow and dust stay smooth; the character itself is a native-resolution sprite.
  if (hero.shadow > 0) {
    const shadowY = pose === "detour" ? y + 3 : FLOOR_Y + 2;
    ctx.fillStyle = `rgba(5,6,18,${0.3 * hero.shadow})`;
    ctx.beginPath();
    ctx.ellipse(
      x,
      shadowY,
      25 * hero.shadow,
      6 * hero.shadow,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  if (hero.dust > 0 && pose !== "death") {
    const dustY = pose === "detour" ? y : FLOOR_Y;
    ctx.fillStyle = "rgba(159,151,178,.25)";
    for (let i = 0; i < 3; i++) {
      const p = (phase * 1.7 + i * 0.31) % 1;
      ctx.beginPath();
      ctx.arc(
        x - facing * (16 + p * 17),
        dustY - p * 8,
        (1 - p) * 3.2,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }
  const sheet = getHeroSheet();
  if (sheet?.complete && sheet.naturalWidth > 0) {
    const sprite = HERO_SPRITES[pose];
    const idleBreathe = pose === "idle" ? Math.sin(t * 2.2) * 0.006 : 0;
    const deathSquash = pose === "death" ? 1 - phase * 0.14 : 1;
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.scale(
      facing * scale * (1 - idleBreathe),
      scale * (1 + idleBreathe) * deathSquash,
    );
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      sheet,
      sprite.x,
      sprite.y,
      sprite.width,
      sprite.height,
      -(sprite.width * HERO_SHEET_SCALE) / 2,
      -sprite.baseline * HERO_SHEET_SCALE,
      sprite.width * HERO_SHEET_SCALE,
      sprite.height * HERO_SHEET_SCALE,
    );
  } else {
    // Avoid an empty first frame while the local PNG is decoding.
    drawHeroLoadingSilhouette(ctx, x, y, scale);
  }
  ctx.restore();

  if (pose === "death" && hero.fatalKind)
    drawDeathMotif(ctx, x, y, phase, hero.opacity, hero.fatalKind);
  if (pose === "revive") drawReviveMotif(ctx, x, y, phase);
  if (pose === "joy") drawJoyMotif(ctx, x, y, phase);
}

function drawDeathMotif(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  phase: number,
  opacity: number,
  kind: NonNullable<HeroFrame["fatalKind"]>,
) {
  ctx.save();
  ctx.globalAlpha = Math.min(1, 0.35 + opacity);
  const colors =
    kind === "fall"
      ? ["#b8dcde", "#80d7b6", "#f4f1dc"]
      : ["#f6c76d", "#ffd1aa", "#f4f1dc"];
  for (let i = 0; i < 7; i++) {
    const a = i * 0.9 + phase * 0.6;
    const distance = 18 + phase * 34;
    ctx.fillStyle = colors[i % colors.length];
    ctx.beginPath();
    ctx.arc(
      x + Math.cos(a) * distance,
      Math.min(y, 414) - 40 + Math.sin(a) * distance * 0.55,
      2 + (i % 3) * 1.5,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.restore();
}

function drawReviveMotif(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  phase: number,
) {
  const p = Math.min(1, phase / 0.82);
  ctx.save();
  const beam = ctx.createLinearGradient(x, y - 145, x, y + 10);
  beam.addColorStop(0, "rgba(128,215,182,0)");
  beam.addColorStop(0.55, `rgba(128,215,182,${0.13 * (1 - p)})`);
  beam.addColorStop(1, "rgba(128,215,182,0)");
  ctx.fillStyle = beam;
  ctx.fillRect(x - 48, y - 145, 96, 155);
  for (let i = 0; i < 9; i++) {
    const a = i * 2.1 + p * Math.PI * 3;
    const radius = 18 + (i % 4) * 8;
    ctx.globalAlpha = Math.max(0, 0.9 - p * 0.45);
    ctx.fillStyle = i % 3 === 0 ? C.gold : C.mint;
    ctx.beginPath();
    ctx.arc(
      x + Math.cos(a) * radius,
      y - 16 - p * 92 + Math.sin(a) * 11,
      i % 2 === 0 ? 3 : 1.8,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.restore();
}

function drawJoyMotif(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  phase: number,
) {
  const colors = [C.gold, C.mint, C.peach];
  for (let i = 0; i < 7; i++) {
    const angle = i * 0.9;
    const dist = 18 + phase * 26;
    ctx.fillStyle = colors[i % colors.length];
    ctx.save();
    ctx.translate(x + Math.cos(angle) * dist, y - 42 + Math.sin(angle) * dist);
    ctx.rotate(angle);
    ctx.fillRect(-2, -5, 4, 9);
    ctx.restore();
  }
}

function drawBlockedMotif(
  ctx: CanvasRenderingContext2D,
  hero: HeroFrame,
  t: number,
) {
  ctx.save();
  ctx.fillStyle = C.gold;
  ctx.globalAlpha = 0.62 + Math.sin(t * 3) * 0.08;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(
      hero.x - 12 + i * 11,
      hero.y - 88 - Math.sin(t * 2 + i) * 2,
      2.5,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.restore();
}

export function renderScene(ctx: CanvasRenderingContext2D, frame: SceneFrame) {
  ctx.clearRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
  drawBackdrop(ctx, frame.time, frame.reducedMotion);
  drawDust(ctx, frame.time, frame.reducedMotion);
  drawTorch(ctx, 235, 205, frame.time, frame.reducedMotion);
  drawTorch(ctx, 765, 183, frame.time + 0.7, frame.reducedMotion);
  drawDoor(ctx, frame.phase, frame.time);
  drawFloor(ctx);

  const { observation } = frame;
  if (observation.sidePath) drawSidePath(ctx);
  if (observation.pit) cutPit(ctx, observation.id === "bridge");

  if (observation.floorSpikes) drawSpikes(ctx, false);
  if (observation.ceilingSpikes) drawLowCeiling(ctx);

  drawCozyDetails(ctx, frame.time, frame.reducedMotion);

  drawHero(ctx, frame.hero, frame.time);
  if (
    observation.sidePath &&
    !observation.floorSpikes &&
    frame.hero.pose === "detour" &&
    frame.hero.phase > 0.32 &&
    frame.hero.phase < 0.68
  ) {
    drawSidePathFootOcclusion(ctx, frame.hero);
  }
  if (frame.phase === "blocked" && frame.hero.pose === "idle")
    drawBlockedMotif(ctx, frame.hero, frame.time);

  // Subtle vignette binds the scene without obscuring hazards.
  const vignette = ctx.createRadialGradient(480, 280, 190, 480, 280, 570);
  vignette.addColorStop(0.55, "rgba(4,5,18,0)");
  vignette.addColorStop(1, "rgba(4,5,18,.48)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
}
