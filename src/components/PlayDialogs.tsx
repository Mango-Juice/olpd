import type { Settings } from "../game/types";
import Modal from "./Modal";

export function PlaySettingsDialog({ settings, onChange, onExport, onNew, onClose }: {
  settings: Settings; onChange: (settings: Settings) => void; onExport: () => void; onNew: () => void; onClose: () => void;
}) {
  return <Modal title="작은 모험의 설정" onClose={onClose}>
    <label><input type="checkbox" checked={settings.muted} onChange={(event) => onChange({ ...settings, muted: event.target.checked })} />배경음악·효과음 끄기</label>
    <label><input type="checkbox" checked={settings.reducedMotion} onChange={(event) => onChange({ ...settings, reducedMotion: event.target.checked })} />움직임과 장식 효과 줄이기</label>
    <p>자동 저장은 마지막으로 확정된 판단 지점을 기억해요.</p>
    <div className="action-row"><button className="secondary" onClick={onExport}>기록 내보내기</button><button className="secondary" onClick={onNew}>새 도전 시작</button></div>
  </Modal>;
}

export function PlayShareDialog({ text, includeNotes, onIncludeNotes, notice, onCopy, onSystemShare, onClose }: {
  text: string; includeNotes: boolean; onIncludeNotes: (value: boolean) => void; notice: string;
  onCopy: () => void; onSystemShare?: () => void; onClose: () => void;
}) {
  return <Modal title="우리의 모험을 남겨요" onClose={onClose}>
    <p>아래 내용 그대로 공유해요. 링크를 연 친구는 자신의 새 기록으로 시작합니다.</p>
    <label><input type="checkbox" checked={includeNotes} onChange={(event) => onIncludeNotes(event.target.checked)} />최종 메모장도 함께 공유</label>
    <pre>{text}</pre>
    <div className="action-row"><button className="primary" onClick={onCopy}>내용 복사</button>{onSystemShare && <button className="secondary" onClick={onSystemShare}>시스템 공유</button>}</div>
    {notice && <p role="status">{notice}</p>}
  </Modal>;
}

export function PlayRestartDialog({ onRestart, onClose, disabled = false, firstChapter = false }: {
  onRestart: () => void; onClose: () => void; disabled?: boolean; firstChapter?: boolean;
}) {
  return <Modal title="새 메모장을 펼칠까요?" onClose={onClose}>
    <p>이번 장의 메모와 데스 기록을 초기화하고 {firstChapter ? "1-1 첫걸음" : "첫 스테이지"}부터 시작해요. 완료 기록과 열린 장은 그대로 남아요.</p>
    <div className="action-row">
      <button type="button" className="primary" disabled={disabled} onClick={onRestart}>새 도전 시작</button>
      <button type="button" className="secondary" onClick={onClose}>계속할게요</button>
    </div>
  </Modal>;
}
