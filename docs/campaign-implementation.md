# 캠페인 구현 — 1장 게임의 공용화

2026-09-23 개편. 기준은 기존 프롤로그·1장의 동작이다. 이전 `quiet-v1`의 장면별 메모 덮어쓰기·무료 수정·무료 되감기는 폐기한다. 이 기록은 `shared-v1` 구현 범위다. 이후 공간 개편의 현재 구현은 [공간 실행기 v4](spatial-implementation.md)에 구분했다. 아래 수치는 공용화 당시 기록이며 새 공간 실행기의 검증 결과와 구분한다.

## 공용 코드와 장별 어댑터

| 책임 | 실제 공용 모듈 | 장별 차이 |
| --- | --- | --- |
| 메모 누적·작성 기회·삭제 비용·우선순위 | `src/game/memory.ts` | Chapter 1의 Interpretation과 후속 장의 InstructionProgram을 각 코어가 보관 |
| 메모장 UI | `MemoryNotebook` | 텍스트·행동 설명과 저장 핸들러만 전달; 별도 캠페인 메모장 없음 |
| 입력→해석→저장→출발 | `usePlayCommand`, `PlayCommandComposer`, `postInterpretJson` | Jev 판단 또는 DeepSeek 프로그램을 검증하는 어댑터 |
| 재생 시계·중단·가시성·효과음 시점 | `useCanvasPlayback`, `advancePlaybackTimeline`, `render/animation.ts` | DungeonCanvas는 observation, CampaignCanvas는 before/after world를 그림 |
| 캐릭터·동작 | `HeroFrame`, `drawHero`, 사망·부활·기쁨 포즈 | 새 물체 행동의 접근·접촉·조작 동작 추가 |
| 헤딩·대사·재생·출발·점수·완료 화면 | `PlaySceneHeading`, `PlaySceneCaption`, `PlaySceneFooter`, `PlaySessionControls`, `PlayLaunchControls`, `PlayDeathScore`, `PlayClearPanel` | 장 이름·목적·현재 상태·콜백 |
| 도움말·설정·공유 | `PlayDialogs` | 물체 행동 설명과 저장 어댑터; 기존 프롤로그 특화 안내는 보존 |
| 모험 기록·장면 재생 | `Chronicle` | StageChronicle/CampaignChronicle이 공통 view model을 생성 |
| 모바일 키보드 | `useMobileKeyboardLayout`와 공용 CSS | 없음 |
| 제공자 HTTP | `server/provider-http.ts` | Jev Choice와 DeepSeek AST 해석·검증은 분리 |

클래식 장애물 판단과 물체·동료·시간을 포함한 세계 판정은 같은 함수로 억지로 합치지 않는다. 양쪽 코어가 같은 메모 정책과 화면·재생 모듈을 사용하며, 장별 콘텐츠는 물리 상태·행동·완료 조건만 정의한다.

## 유지해야 하는 행동

- 메모는 낮은 우선순위부터 저장하고, 화면과 실행기에는 높은 우선순위부터 전달한다. 새 문장은 기존 문장을 덮어쓰지 않는다.
- 본편에서는 죽은 뒤 한 줄을 쓸 수 있다. 삭제는 죽은 뒤에만 가능하며 지우개 2개 이후 한 줄마다 삭제 패널티 3데스다. 삭제가 작성 기회를 만들지는 않는다.
- 장면 통과는 무료 작성 기회나 새 메모장을 만들지 않는다. 재시도는 메모를 챙겨 장의 입구로 돌아간다. 막힘은 포기 후 1데스를 받아 새 지침을 쓸 수 있다.
- 자동 진행은 재생 완료 콜백으로만 다음 물리 판단을 요청한다. 별도 1.3초 캠페인 진행 타이머는 없다. 탭 숨김·일시정지·한 장면씩 보기가 재생과 진행을 함께 멈춘다.
- 장면별 이전/이후 세계, 행동, 결과와 메모 변경 이력을 보존한다. 완료 기록에서 실제 애니메이션을 독립적으로 다시 볼 수 있다.
- 960×500 고정 장면, 필수 요소 2~4개, 한 문장 목적, 내부 수치 비노출을 유지한다. 선택 점선 원은 제거한다.

## AI와 비용 경계

프롤로그·1장은 Jev의 네 행동 판단, 후속 장은 `deepseek-flash`의 구조화 행동 프로그램을 사용한다. 요청당 제공자 호출은 한 번이며 자동 재시도·자동 모델 교체는 없다. 기존 DeepSeek non-thinking 기본값을 유지한다. 공통 HTTP 모듈에서 응답 크기·timeout·취소·제공자 오류를 제한한다. 키와 제공자의 원문 오류는 UI로 보내지 않는다.

현재 공개된 물체·상태만 전달한다. 명시적인 일반 규칙은 저작된 `publicKind`에 연결해 다음 장면에서 로컬로 다시 적용한다. 없으면 건너뛰고, 대상이 여러 개면 임의로 고르지 않는다. 이 과정에는 AI 호출이 없다. AI는 행동을 번역하고, 물리 엔진이 성공과 실패를 판정한다.

입력 제한은 1장 80자, 순서·동시 행동을 지원하는 후속 장 500자다. UI·서버에서 검사하며, 후속 장의 더 긴 한도는 복합 명령 표현을 위한 어댑터 차이다.

## 저장과 복구

새 런은 `StageRun v3`, `contentRevision: shared-v1`, 저장 문서는 v3이다. 기존 v2 및 `quiet-v1` 활성·완료 원본은 IndexedDB 복구 영역으로 보존한다. 과거 완료·해금·시각을 유지하고 새 게임 완료 기록으로 꾸미지 않는다. 옛 QA 저장 키도 지우지 않는다. 새 QA는 `one-line-per-death:qa:shared-v1`을 사용한다.

## 검증의 의미

공용 규칙·저장 무결성·물리 실행 검사는 단위/통합 테스트로, 실제 버튼·키보드·드래그·재생·레이아웃은 Playwright로 구분한다. 브라우저 fixture는 유료 모델 품질의 증거가 아니다. 기존 Chapter 1 회귀 스크립트는 테스트 전용 엔트리에서 실제 App을 렌더하며, 별도 캠페인 검사는 실제 QaShell을 사용한다.

2026-09-23 실제 API smoke: Jev 1회와 DeepSeek 3회 중 일반 규칙 1건에서 `binding.kind` 출력 오류를 발견했다. 제공자 원문을 확인해 프롬프트의 고정 필드와 존재 조건 표현을 명확히 했고 해당 1건만 추가 호출해 통과했다. 총 5회 호출이다. 마지막 관측은 Jev 약 2.01초, DeepSeek 대기/동시 행동 약 0.81/1.17초, 일반 규칙 재검사 약 1.21초였다. 표본 4개에 대한 결과이며 전체 장·임의 입력·난이도 검증 결과가 아니다. 원본은 로컬 `artifacts/shared-live/`에 있다.

이전 54장면 API 결과는 과거 프롬프트에 대한 누적 재검사 기록이다. 최신 프롬프트로 전체를 다시 실행했다는 의미가 아니다. 현재 전체 검사 결과는 [검증 기록](verification.md)에 갱신한다. 배포·push는 하지 않는다.
