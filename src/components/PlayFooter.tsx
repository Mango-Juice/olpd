export function PlayFooter({ onRestart, disabled = false, local = false }: {
  onRestart?: () => void;
  disabled?: boolean;
  local?: boolean;
}) {
  return <footer className="footer">
    <span>{local ? "이 브라우저에 자동 저장됩니다." : "진행은 안전하게 자동 저장됩니다."}</span>
    <div className="play-footer-actions">
      {onRestart && <button type="button" className="subtle" disabled={disabled} onClick={onRestart}>이 장 처음부터</button>}
    </div>
  </footer>;
}
