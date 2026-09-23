import type { Settings } from "../game/types";
import { MEMORY_INITIAL_ERASERS, MEMORY_DELETE_PENALTY } from "../game/memory";
import Modal from "./Modal";

export function PlayHelpDialog({ onClose, campaign = false, advanced = false }: {
  onClose: () => void; campaign?: boolean; advanced?: boolean;
}) {
  return <Modal title="한 줄씩, 함께 배우는 모험" onClose={onClose}>
    <p>용사는 기본적으로 앞으로 걸어요. 넘어진 이유를 보고, 다음 생에 기억할 지침을 한 줄 남겨주세요.</p>
    <ul>
      <li>{advanced ? "용사가 할 행동을 자연스럽게 적어요. 지금 물건을 가리키거나, 같은 상황에서 다시 따를 조건을 함께 적어도 좋아요." : "용사가 할 행동을 자연스럽게 적어요. 한 줄에는 한 가지 행동을, 여러 조건에 같은 행동을 연결해도 좋아요."}</li>
      <li>현재 상황에 맞는 메모 중 화면 위쪽 한 줄을 따라요. 출발 전에 손잡이를 드래그하거나 ··· 메뉴의 ↑↓로 우선순위를 바꿀 수 있어요.</li>
      <li>사망 한 번당 새 지침은 최대 한 줄. 쓰지 않고 출발하면 기회는 사라져요.</li>
      <li>같은 상황에 서로 다른 행동을 새로 기억할 수는 없어요. 조건을 구체적으로 바꾸거나 기존 메모를 지워주세요.</li>
      <li>지우개 {MEMORY_INITIAL_ERASERS}개를 먼저 쓰고, 소진 후에는 삭제 한 줄마다 {MEMORY_DELETE_PENALTY}데스예요.</li>
      <li>전진 지침을 지워도 기본 전진은 계속돼요. 막히면 +1데스로 부활할 수 있어요.</li>
      <li>이미 본 같은 행동은 3배속. 탭을 떠나면 자동으로 멈춰요.</li>
    </ul>
    <p>{campaign ? "진행은 여정 기록에 자동 저장됩니다." : "기록은 이 브라우저에만 저장됩니다. 다른 기기와 동기화되지 않아요."}</p>
    <button className="primary wide" onClick={onClose}>기억했어요</button>
  </Modal>;
}

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
