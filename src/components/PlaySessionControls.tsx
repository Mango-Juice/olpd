import type { ReactNode } from "react";

export function PlaySceneHeading({ eyebrow, title, children }: {
  eyebrow: ReactNode; title: ReactNode; children?: ReactNode;
}) {
  return <div className="scene-head"><div><span className="room-tag">{eyebrow}</span><h2>{title}</h2></div>{children}</div>;
}

export function PlaySceneCaption({ returning, accident, animating, kicker, memory, action, children }: {
  returning: boolean; accident: boolean; animating: boolean; kicker: ReactNode;
  memory: ReactNode; action: ReactNode; children?: ReactNode;
}) {
  return <div className={`scene-caption ${returning ? "returning" : ""} ${accident ? "accident" : ""}`} aria-live={animating ? "off" : "polite"}>
    <span className="caption-kicker">{kicker}</span><strong>{memory}</strong><span className="caption-action">{action}</span>{children}
  </div>;
}

/** Controls shared by every chapter. World adapters decide when an action is legal. */
export function PlaySceneFooter({ status, playing, paused, onTogglePause, label = "기억의 던전" }: {
  status: ReactNode; playing: boolean; paused: boolean; onTogglePause: () => void; label?: string;
}) {
  return <div className="scene-foot"><span><i />{status}</span>{playing
    ? <button onClick={onTogglePause} aria-label={paused ? "다시 재생" : "일시정지"}>{paused ? "▶ 다시 재생" : "Ⅱ 일시정지"}</button>
    : <span>✦ {label}</span>}</div>;
}

export function PlaySessionControls({ sceneByScene, onSceneByScene, awaitingNext, onNext, hasHistory, onHistory }: {
  sceneByScene: boolean; onSceneByScene: (value: boolean) => void; awaitingNext: boolean;
  onNext: () => void; hasHistory: boolean; onHistory: () => void;
}) {
  return <div className="playback-tools">
    <label><input type="checkbox" checked={sceneByScene} onChange={(event) => onSceneByScene(event.target.checked)} />한 장면씩 보기</label>
    {awaitingNext && <button className="secondary" onClick={onNext}>다음 장면 →</button>}
    {hasHistory && <button className="subtle" onClick={onHistory}>방금 무슨 일이?</button>}
  </div>;
}

export function PlayLaunchControls({ dead, canWrite, disabled, onLaunch }: {
  dead: boolean; canWrite: boolean; disabled: boolean; onLaunch: () => void;
}) {
  return <div className="action-row">
    <button className={canWrite ? "secondary" : "primary"} onClick={onLaunch} disabled={disabled}>
      {dead ? canWrite ? "한 줄 더 쓰지 않고 다시 출발" : "입구에서 다시 출발" : "모험 출발"} <span>→</span>
    </button>
    {canWrite && dead && <span className="helper">지침 없이 출발하면 이번 작성 기회는 사라져요.</span>}
    {!canWrite && <span className="saved-mark">✓ 한 줄을 메모장에 기억했어요</span>}
  </div>;
}

export function PlayDeathScore({ deaths, penaltyDeaths, best }: {
  deaths: number; penaltyDeaths: number; best?: number | null;
}) {
  return <div className="record-line">
    <span><strong className="score">{deaths + penaltyDeaths}</strong> 데스</span>
    <span>사망·부활 <strong>{deaths}</strong></span>
    <span>삭제 패널티 <strong>{penaltyDeaths}</strong></span>
    {best != null && <span>최고 <strong>{best}</strong></span>}
  </div>;
}

export function PlayClearPanel({ deaths, penaltyDeaths, best, onShare, onNew, children }: {
  deaths: number; penaltyDeaths: number; best?: number | null;
  onShare: () => void; onNew: () => void; children?: ReactNode;
}) {
  return <div className="composer">
    <span className="eyebrow">A SMALL HERO, A BIG ADVENTURE</span>
    <div className="win-score">{deaths + penaltyDeaths} <span style={{ fontSize: 18 }}>데스의 기억</span></div>
    <p className="helper">사망·자진 부활 {deaths} + 삭제 패널티 {penaltyDeaths} · 최고 기록 {best ?? deaths + penaltyDeaths}데스</p>
    <div className="action-row">
      <button className="primary" onClick={onShare}>우리의 모험 공유하기 ↗</button>
      <button className="secondary" onClick={onNew}>새로운 도전</button>
      {children}
    </div>
  </div>;
}
