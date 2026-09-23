import { chromium } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const fontRoot = path.join(root, "node_modules/@fontsource/gowun-batang");
let fontCss = await readFile(path.join(fontRoot, "700.css"), "utf8");
const urls = [...new Set([...fontCss.matchAll(/url\(([^)]+)\)/g)].map(match => match[1]))];
for (const url of urls) {
  const clean = url.replace(/['"]/g, "");
  const data = await readFile(path.join(fontRoot, clean));
  fontCss = fontCss.split(url).join('"data:font/woff2;base64,' + data.toString("base64") + '"');
}
const sprite = (await readFile(path.join(root, "public/art/moru-sprite-sheet-v3.png"))).toString("base64");
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
    ${fontCss}
    *{box-sizing:border-box}body{margin:0;background:#171a26;color:#f4ebd3;font-family:"Gowun Batang",serif}
    .card{width:1200px;height:630px;position:relative;overflow:hidden;background:radial-gradient(ellipse at 88% 16%,#384c4b 0%,transparent 48%),linear-gradient(120deg,#121526,#242440)}
    .frame{position:absolute;inset:26px;border:1px solid #ded1a129;border-radius:22px}
    .stars{position:absolute;right:105px;top:45px;font-size:28px;color:#d8c48e;letter-spacing:48px}
    .copy{position:absolute;left:75px;top:81px;z-index:3}
    .eyebrow{font:600 15px sans-serif;letter-spacing:4px;color:#bda979}
    h1{font-weight:700;font-size:72px;line-height:1.25;letter-spacing:-3px;margin:35px 0 25px}
    h1 span{color:#b5d5b9} .lead{font-size:25px;line-height:1.8;color:#d9d5c9;margin:0}
    .tag{position:absolute;left:77px;bottom:64px;font-size:19px;color:#bbcaac}
    .url{position:absolute;right:73px;bottom:53px;font:14px sans-serif;letter-spacing:2px;color:#acb6b3}
    .arch{position:absolute;right:58px;top:135px;width:245px;height:420px;border:24px solid #686b8059;border-bottom:0;border-radius:150px 150px 0 0;background:linear-gradient(180deg,#11152c,#38434455)}
    .light{position:absolute;right:92px;top:-60px;width:140px;height:590px;background:linear-gradient(#e0e8b315,transparent);transform:rotate(22deg)}
    .note{position:absolute;right:131px;top:132px;width:310px;height:238px;padding:32px;border-radius:8px;background:#eee9d4;box-shadow:0 18px 48px #0004;transform:rotate(5deg);color:#414c42}
    .note small{font-size:15px;color:#77846d}.note p{font-size:27px;line-height:1.65;margin:22px 0 0}.rule{height:1px;background:#54624730;margin-top:14px}
    .bookmark{position:absolute;right:23px;top:-9px;width:22px;height:51px;background:#88a68c;clip-path:polygon(0 0,100% 0,100% 100%,50% 80%,0 100%)}
    .floor{position:absolute;bottom:75px;right:56px;width:458px;height:28px;border-radius:50%;background:#0b102d66;filter:blur(4px)}
    canvas{position:absolute;right:210px;bottom:81px;width:244px;height:262px;z-index:5}
  </style></head><body><main class="card">
    <div class="frame"></div><div class="light"></div><div class="stars">✧ · ✦</div><div class="arch"></div>
    <div class="copy"><div class="eyebrow">ONE LINE PER DEATH</div><h1>죽을 때마다<br><span>한 줄</span></h1><p class="lead">용사는 다시 태어나고,<br>당신의 한 줄은 남습니다.</p></div>
    <div class="note"><div class="bookmark"></div><small>용사의 메모장</small><p>구덩이가 있으면<br>뛰어넘어.</p><div class="rule"></div></div>
    <div class="floor"></div><canvas width="340" height="365"></canvas>
    <div class="tag">말로 가르치는 던전 퍼즐</div><div class="url">olpd.vercel.app</div>
  </main></body></html>`);
  await page.evaluate(async data => {
    const img = new Image();
    img.src = "data:image/png;base64," + data;
    await img.decode();
    document.querySelector("canvas")!.getContext("2d")!.drawImage(img, 45, 60, 340, 365, 0, 0, 340, 365);
    await document.fonts.ready;
  }, sprite);
  await mkdir("public/og", { recursive: true });
  await page.screenshot({ path: "public/og/one-line-per-death.png" });
  console.log("Generated public/og/one-line-per-death.png (1200x630), using the existing hero sprite.");
} finally { await browser.close(); }
