import "./PrologueGuide.css";

/** A short orientation shown before the first prologue begins. */
export function PrologueGuide() {
  return (
    <aside className="prologue-guide" aria-labelledby="prologue-guide-title">
      <h2 id="prologue-guide-title">한 줄이 용사의 길이 됩니다.</h2>
      <p>용사는 메모장에 적은 문장을 따라 움직여요. 실패해도 메모장은 남습니다.</p>
      <p className="prologue-guide-direction">
        ‘첫 번째 한 줄 남기기’를 누르고, 용사가 할 행동을 적어 주세요.
      </p>
    </aside>
  );
}
