export function PlayFooter({ onRestart, onHistory, disabled = false, local = false }: {
  onRestart?: () => void;
  onHistory?: () => void;
  disabled?: boolean;
  local?: boolean;
}) {
  return <footer className="footer">
    <span>{local ? "이 브라우저에 자동 저장됩니다." : "진행은 안전하게 자동 저장됩니다."}</span>
    <div className="play-footer-actions">
      {onRestart && <button type="button" className="subtle" disabled={disabled} onClick={onRestart}>이 장 처음부터</button>}
      {onHistory && <button type="button" className="subtle" onClick={onHistory}>지난 모험 기록</button>}
    </div>
  </footer>;
}
