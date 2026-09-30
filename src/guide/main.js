import "@fontsource-variable/noto-sans-kr";
import "@fontsource/gowun-batang/400.css";
import "@fontsource/gowun-batang/700.css";
import { MEMORY_DELETE_PENALTY, MEMORY_INITIAL_ERASERS } from "../game/memory";
import { DUR, ready, renderAt } from "./film.js";
import { renderMusic } from "./music.js";

const ICON = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4.5h4.5v15H6zM13.5 4.5H18v15h-4.5z"/></svg>',
  soundOn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9.5v5h4l5 4.5V5L7 9.5z"/><path d="M15 8.2a5 5 0 0 1 0 7.6M17.6 5.4a9 9 0 0 1 0 13.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  soundOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9.5v5h4l5 4.5V5L7 9.5z"/><path d="M16 9.5l5 5M21 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};
const $ = (id) => document.getElementById(id);
function setIcon(btn, icon, label) { btn.innerHTML = ICON[icon]; btn.setAttribute("aria-label", label); btn.title = label; }

document.querySelector("[data-erasers]").textContent = MEMORY_INITIAL_ERASERS;
document.querySelector("[data-penalty]").textContent = MEMORY_DELETE_PENALTY;

const playBtn = $("play"), soundBtn = $("sound"), seek = $("seek"), time = $("time"), canvas = $("c");
let playing = true, offset = 0, started = performance.now() / 1000;
let actx = null, buffer = null, source = null, sound = false, dragging = false;
setIcon(playBtn, "pause", "일시정지"); setIcon(soundBtn, "soundOff", "소리 켜기");

// 소리가 켜져 있으면 오디오 시계를 따라가 화면과 음악이 어긋나지 않게 한다.
const clock = () => (sound ? actx.currentTime : performance.now() / 1000);
const now = () => (playing ? offset + clock() - started : offset);

function stopSource() { if (source) { source.stop(); source = null; } }
function playFrom(t) {
  stopSource();
  offset = Math.max(0, Math.min(t, DUR - 0.01)); started = clock(); playing = true;
  if (sound) { source = actx.createBufferSource(); source.buffer = buffer; source.connect(actx.destination); source.start(0, offset); }
  setIcon(playBtn, "pause", "일시정지");
}
function pause() { offset = Math.min(now(), DUR); playing = false; stopSource(); setIcon(playBtn, "play", "재생"); }
const fmt = (s) => `0:${String(Math.floor(s)).padStart(2, "0")}`;

function frame() {
  let t = now();
  if (t >= DUR) { playFrom(0); t = 0; }
  renderAt(t);
  if (!dragging) seek.value = t;
  time.textContent = `${fmt(t)} / ${fmt(DUR)}`;
  requestAnimationFrame(frame);
}

const toggle = () => (playing ? pause() : playFrom(offset));
playBtn.onclick = toggle; canvas.onclick = toggle;
seek.oninput = () => { const t = +seek.value; if (playing) playFrom(t); else offset = t; };
seek.onpointerdown = () => { dragging = true; };
seek.onpointerup = seek.onpointercancel = seek.onchange = () => { dragging = false; };
soundBtn.onclick = async () => {
  const t = now(), was = playing;
  if (!sound) {
    if (!buffer) {
      soundBtn.disabled = true; soundBtn.title = "소리 준비 중";
      await new Promise((r) => setTimeout(r, 30));
      const m = renderMusic();
      actx = new AudioContext();
      buffer = actx.createBuffer(2, m.left.length, m.sampleRate);
      buffer.copyToChannel(m.left, 0); buffer.copyToChannel(m.right, 1);
      soundBtn.disabled = false;
    }
    await actx.resume(); sound = true;
    setIcon(soundBtn, "soundOn", "소리 끄기"); soundBtn.classList.remove("primary");
  } else {
    stopSource(); sound = false;
    setIcon(soundBtn, "soundOff", "소리 켜기"); soundBtn.classList.add("primary");
  }
  if (was) playFrom(t); else offset = t;
};

await ready("/art/moru-sprite-sheet-v3.png");
document.documentElement.dataset.film = "ready";
frame();
