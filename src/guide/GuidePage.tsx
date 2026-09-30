import { PlayHeader, PlayIntro } from "../components/PlayChrome";
import { MEMORY_DELETE_PENALTY, MEMORY_INITIAL_ERASERS } from "../game/memory";
import { GuidePlayer } from "./GuidePlayer";

export function GuidePage() {
  return (
    <div className="shell guide">
      <PlayHeader actionsLabel="이동" actions={<a className="primary" href="/">게임으로</a>} />
      <PlayIntro
        eyebrow="HOW TO PLAY"
        description="메모 한 줄로 용사를 움직이는 법을 40초 영상으로 안내합니다."
        aside={<>플레이 안내<small>A DUNGEON OF SMALL LESSONS</small></>}
      />
      <GuidePlayer />
      <section className="guide-text">
        <h2>한 줄씩, 함께 배우는 모험</h2>
        <p>용사는 남겨 둔 지시대로 움직여요. 지금 할 지시가 없으면 멈춰요. 넘어진 이유를 보고, 다음 생에 기억할 지침을 한 줄 남겨주세요.</p>
        <ul>
          <li>용사가 할 행동을 자연스럽게 적어요. 같은 상황에서 다시 따를 조건을 함께 적어도 좋아요.</li>
          <li>현재 상황에 맞는 메모 중 화면 위쪽 한 줄을 따라요. 출발 전에 손잡이를 드래그하거나 ··· 메뉴의 ↑↓로 우선순위를 바꿀 수 있어요.</li>
          <li>사망 한 번당 새 지침은 최대 한 줄. 쓰지 않고 출발하면 기회는 사라져요.</li>
          <li>같은 상황에 서로 다른 행동을 새로 기억할 수는 없어요. 조건을 구체적으로 바꾸거나 기존 메모를 지워주세요.</li>
          <li>지우개 {MEMORY_INITIAL_ERASERS}개를 먼저 쓰고, 소진 후에는 삭제 한 줄마다 {MEMORY_DELETE_PENALTY}데스예요.</li>
          <li>계속 걷게 하려면 전진 지침을 남겨 주세요. 그 지침을 지우면 저절로 걷지 않아요. 막히면 +1데스로 부활할 수 있어요.</li>
          <li>이미 본 같은 행동은 3배속. 탭을 떠나면 자동으로 멈춰요.</li>
        </ul>
        <p>진행은 이 브라우저에 자동 저장됩니다. 다른 기기와 동기화되지 않아요.</p>
      </section>
    </div>
  );
}
