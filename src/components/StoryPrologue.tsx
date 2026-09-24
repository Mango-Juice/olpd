import { useEffect, useRef } from "react";
import { idleHeroFrame } from "../render/animation";
import { drawHero } from "../render/scene";
import "./StoryPrologue.css";

export function StoryPrologue({
  onRead,
  onSkip,
  disabled,
}: {
  onRead: () => void;
  onSkip: () => void;
  disabled: boolean;
}) {
  return (
    <section className="story-prologue" aria-labelledby="chapter-story-title">
      <div className="story-prologue-scene" aria-hidden="true">
        <span className="story-prologue-moon">◔</span>
        <StoryHeroCanvas />
        <span className="story-prologue-door" />
      </div>
      <div className="story-prologue-copy">
        <span className="eyebrow">PROLOGUE · 오래된 편지</span>
        <h2 id="chapter-story-title">한 줄이 작은 용사의 길이 됩니다.</h2>
        <p>
          달빛이 닿지 않는 던전 깊은 곳, 용사는 오래된 편지를 품고 문 앞에
          섰습니다. 당신이 남긴 한 줄만이 다음 걸음을 알려 줍니다.
        </p>
        <p>
          앞에 펼쳐진 여섯 장면을 지나며 용사가 기억할 지침을 써 주세요.
          넘어져도 메모는 남고, 다음 출발에 다시 적용됩니다.
        </p>
        <div className="action-row">
          <button type="button" className="primary" disabled={disabled} onClick={onRead}>
            첫 문을 향해 <span>→</span>
          </button>
          <button type="button" className="subtle" disabled={disabled} onClick={onSkip}>
            이야기 SKIP
          </button>
        </div>
      </div>
    </section>
  );
}

function prepareCanvas(
  canvas: HTMLCanvasElement,
  logicalWidth: number,
  logicalHeight: number,
) {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(logicalWidth * pixelRatio);
  canvas.height = Math.round(logicalHeight * pixelRatio);
  const context = canvas.getContext("2d");
  context?.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  return context;
}

function StoryHeroCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas ? prepareCanvas(canvas, 180, 220) : null;
    if (!canvas || !context) return;
    let frame = 0;
    const draw = (now: number) => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      drawHero(
        context,
        {
          ...idleHeroFrame(now / 1000),
          x: 90,
          y: 196,
          shadow: 0,
        },
        now / 1000,
      );
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="story-prologue-hero-canvas"
      width={180}
      height={220}
      aria-hidden="true"
    />
  );
}
