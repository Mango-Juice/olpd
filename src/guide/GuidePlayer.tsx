import { useEffect, useReducer, useRef, useState } from "react";
import { Sound, SoundOff } from "../components/PlayChrome";
import { useCanvasPlayback } from "../hooks/useCanvasPlayback";
import { DUR, loadSprite, renderAt, warmFonts } from "./film.js";
import type { Music } from "./music.js";

const FILM_WIDTH = 1920;
const SPRITE_TIMEOUT_MS = 10_000;
const FONT_TIMEOUT_MS = 4_000;
const AUDIO_TIMEOUT_MS = 2_000;
/** 움직임 줄이기 설정에서는 타이틀이 다 나온 장면에 멈춘 채로 시작한다. */
const REDUCED_MOTION_START = 3;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const fmt = (seconds: number) => `0:${String(Math.floor(seconds)).padStart(2, "0")}`;

function synthesize(): Promise<Music> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./music-worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<Music>) => { resolve(event.data); worker.terminate(); };
    worker.onerror = () => { reject(new Error("music worker failed")); worker.terminate(); };
  });
}

export function GuidePlayer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const seekRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLOutputElement>(null);
  const [reducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [playing, setPlaying] = useState(!reducedMotion);
  const [onScreen, setOnScreen] = useState(true);
  const [sound, setSound] = useState<"off" | "loading" | "on">("off");
  const [notice, setNotice] = useState("");
  const [, redraw] = useReducer((count: number) => count + 1, 0);
  const film = useRef({ time: reducedMotion ? REDUCED_MOTION_START : 0, dragging: false, playing: !reducedMotion });
  const audio = useRef<{ context: AudioContext | null; buffer: AudioBuffer | null; source: AudioBufferSourceNode | null; startedAt: number; offset: number }>(
    { context: null, buffer: null, source: null, startedAt: 0, offset: 0 },
  );

  const stopSource = () => { audio.current.source?.stop(); audio.current.source = null; };
  const startSource = (at: number) => {
    const current = audio.current;
    if (!current.context || !current.buffer) return;
    stopSource();
    const source = current.context.createBufferSource();
    source.buffer = current.buffer;
    source.connect(current.context.destination);
    source.start(0, at);
    Object.assign(current, { source, startedAt: current.context.currentTime, offset: at });
  };
  const play = () => { if (sound === "on") startSource(film.current.time); film.current.playing = true; setPlaying(true); };
  const pause = () => { stopSource(); film.current.playing = false; setPlaying(false); };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await Promise.race([loadSprite("/art/moru-sprite-sheet-v3.png"), sleep(SPRITE_TIMEOUT_MS).then(() => { throw new Error("sprite timeout"); })]);
        // 글꼴이 늦어도 영상은 시작한다. 늦게 온 글꼴은 공용 재생 훅이 다시 그려 반영한다.
        await Promise.race([warmFonts(), sleep(FONT_TIMEOUT_MS)]);
        if (!cancelled) setStatus("ready");
      } catch {
        if (!cancelled) setStatus("failed");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { document.documentElement.dataset.film = status; }, [status]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting));
    observer.observe(canvas);
    // 탭을 떠나면 게임과 같이 멈추고, 돌아와도 저절로 다시 재생하지 않는다.
    const onVisibility = () => { if (document.hidden) pause(); };
    document.addEventListener("visibilitychange", onVisibility);
    const current = audio.current;
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      stopSource();
      void current.context?.close();
      current.context = null;
      current.buffer = null;
    };
  }, []);

  useCanvasPlayback({
    canvasRef,
    paused: !playing || !onScreen || status !== "ready",
    reducedMotion,
    draw: ({ canvas, context, deltaMs }) => {
      if (status !== "ready") return;
      const state = film.current, current = audio.current;
      // 소리가 나는 동안은 오디오 시계를 따라가 화면과 음악이 어긋나지 않게 한다.
      if (current.source && current.context) state.time = current.offset + current.context.currentTime - current.startedAt;
      else state.time += deltaMs / 1000;
      if (state.time >= DUR) { state.time = 0; if (current.source) startSource(0); }
      renderAt(context, state.time, canvas.width / FILM_WIDTH);
      if (seekRef.current && !state.dragging) seekRef.current.value = String(state.time);
      if (timeRef.current) timeRef.current.textContent = `${fmt(state.time)} / ${fmt(DUR)}`;
    },
  });

  const seek = (value: number) => {
    film.current.time = value;
    if (audio.current.source) startSource(value);
    redraw();
  };

  const toggleSound = async () => {
    if (sound === "on") { stopSource(); setSound("off"); return; }
    setSound("loading");
    setNotice("");
    try {
      // iOS Safari는 탭한 직후에 만든 오디오만 허용하므로, 합성을 기다리기 전에 먼저 켠다.
      const context = audio.current.context ?? new AudioContext();
      audio.current.context = context;
      const resumed = context.resume();
      if (!audio.current.buffer) {
        const music = await synthesize();
        const buffer = context.createBuffer(2, music.left.length, music.sampleRate);
        buffer.copyToChannel(music.left as Float32Array<ArrayBuffer>, 0);
        buffer.copyToChannel(music.right as Float32Array<ArrayBuffer>, 1);
        audio.current.buffer = buffer;
      }
      await Promise.race([resumed, sleep(AUDIO_TIMEOUT_MS)]);
      if (context.state !== "running") throw new Error("audio blocked");
      // 준비하는 동안 바뀐 재생 상태와 위치를 그대로 이어받는다.
      if (film.current.playing) startSource(film.current.time);
      setSound("on");
    } catch {
      stopSource();
      setSound("off");
      setNotice("소리를 켤 수 없어요. 영상은 소리 없이 볼 수 있어요.");
    }
  };

  const failed = status === "failed";
  const soundLabel = sound === "loading" ? "소리 준비 중" : sound === "on" ? "소리 끄기" : "소리 켜기";
  return (
    <section className="guide-player" aria-label="40초 소개 영상">
      {failed && <p className="guide-notice" role="status">영상을 불러오지 못했어요. 아래 글에서 규칙을 볼 수 있어요.</p>}
      <canvas
        ref={canvasRef}
        hidden={failed}
        role="img"
        aria-label="메모 한 줄을 적어 용사를 움직이고, Jev가 문장을 판단하는 과정을 보여 주는 40초 애니메이션"
        onClick={() => (playing ? pause() : play())}
      />
      <div className="guide-controls" hidden={failed}>
        <button id="play" type="button" className="icon-button" disabled={status !== "ready"} aria-label={playing ? "일시정지" : "재생"} title={playing ? "일시정지" : "재생"} onClick={() => (playing ? pause() : play())}>
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button id="sound" type="button" className="icon-button" disabled={status !== "ready" || sound === "loading"} aria-label={soundLabel} title={soundLabel} onClick={() => void toggleSound()}>
          {sound === "on" ? <Sound /> : <SoundOff />}
        </button>
        <input
          id="seek"
          ref={seekRef}
          type="range"
          min={0}
          max={DUR}
          step={0.01}
          defaultValue={film.current.time}
          aria-label="재생 위치"
          onChange={(event) => seek(Number(event.target.value))}
          onPointerDown={() => { film.current.dragging = true; }}
          onPointerUp={() => { film.current.dragging = false; }}
          onPointerCancel={() => { film.current.dragging = false; }}
        />
        <output ref={timeRef}>{`${fmt(film.current.time)} / ${fmt(DUR)}`}</output>
      </div>
      {notice && <p className="guide-notice" role="status">{notice}</p>}
    </section>
  );
}

function PlayIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 5v14l12-7Z" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="M8 5v14m8-14v14" />
    </svg>
  );
}
