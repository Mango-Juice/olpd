# 현재 요구사항과 구현·검증 맵

이 문서는 현재 로컬 코드의 책임과 확인 범위를 연결한다. 최신 결과는 [2026-09-23 검증 기록](verification.md)을 기준으로 한다. 과거 공개 배포 관찰은 그 날짜의 기록이며 현재 배포 상태를 뜻하지 않는다. 자동화 통과, 실제 API 표본, 실기기 동작, 사람 대상 플레이 관찰은 서로 다른 증거다.

| 현재 요구 | 구현 위치 | 확인 범위 |
| --- | --- | --- |
| 공용 플레이 진입과 개발 전용 local QA | `src/main.tsx`, `src/CampaignShell.tsx`, `src/QaShell.tsx` | 일반 진행과 QA 분기, QA localhost 조건 및 별도 저장 경로 |
| 프롤로그와 1장 기존 플레이 | `src/App.tsx`, `src/game/`, `src/components/DungeonCanvas.tsx`, `src/render/` | 기존 1장 입력·저장·재생 회귀 검사 |
| 2~10장 콘텐츠와 공통 실행 화면 | `src/campaign/spatial/`, `src/campaign/registry.ts`, `src/campaign/level.ts`, `src/CampaignShell.tsx`, `src/components/CampaignPlay.tsx`, `src/components/CampaignCanvas.tsx` | 후속 54개 장면의 카탈로그·초기 배치 및 공용 QA 화면 |
| 메모 누적·작성 기회·삭제 비용·우선순위 | `src/campaign/notebook.ts`, `src/campaign/run.ts`, `src/game/memory.ts` | 순수 규칙 검사와 실제 UI 흐름 검사 |
| 구조화 지침 AST, 검증, public-kind binding | `src/campaign/types.ts`, `src/campaign/validation.ts`, `src/campaign/bindings.ts`, `src/campaign/scheduler.ts` | 허용된 노드·참조·바인딩 및 실행기의 로컬 판정 |
| 캠페인 입력 해석 API와 제공자 경계 | `server/campaign-http.ts`, `server/campaign-service.ts`, `server/campaign-deepseek.ts`, `server/provider-http.ts`, `api/campaign-interpret.ts` | 요청 제한·타임아웃·취소·응답 검증의 테스트. 실제 API smoke는 별도 표본 증거 |
| 캠페인 진행·활성 런·완료 기록 | `src/campaign/progress.ts`, `src/campaign/repository.ts`, `src/campaign/authority.ts` | IndexedDB 원자 갱신·revision 충돌·복구 및 저장 검증 |
| QA 슬롯 분리 | `src/QaShell.tsx`, `server/dev.ts` | `?qa=1` localhost 진입과 `one-line-per-death:qa:spatial-v1` localStorage 경로 |
| 프롬프트와 전송 계약 | `docs/api.md`, `server/campaign-deepseek.ts`, `server/campaign-contracts.ts` | 타입·요청 검증 및 합성 fixture. 최신 프롬프트 전체 장면의 실제 정확도와는 별개 |

## 현재 계약

- 콘텐츠는 서사 프롤로그와 66개 본편 장면으로 구성된다. 본편은 1장 12장면, 2~10장 각 6장면이다.
- 입력은 Enter로 해석·저장·출발을 잇는다. 1장은 최대 80자, 후속 장은 최대 500자다.
- 1장의 기존 Jev 판단 경로와 후속 장의 `InstructionProgram` 해석 경로는 서로 다른 입력 모델을 쓰지만, 캠페인 메모 정책·화면·재생 모듈을 공유한다.
- 캠페인 실행은 `StageRun v3`, `contentRevision: spatial-v1`을 사용한다. 진행·활성 런·완료 기록은 IndexedDB 문서로 함께 관리하고, 구버전 런은 현재 실행 콘텐츠로 재사용하지 않고 복구 영역에 보존한다.
- QA는 개발 서버의 localhost에서만 제공하며 별도 localStorage 키에 저장한다. 실제 API를 사용한다.
- AI는 지침을 구조화된 프로그램으로 해석한다. 대상 binding과 AST를 검증한 뒤 실행하며, 물리·성공·점수·비용은 로컬 게임 코드가 판정한다.

구현 구조와 보존 경계는 [공간 실행기 v4](spatial-implementation.md), API 상세는 [AI 해석 API](api.md)를 참고한다. 검증 결과는 [2026-09-23 검증 기록](verification.md)을 확인한다. 실기기 사용, 첫 플레이 사용자 이해도, 난이도와 재미는 자동화나 브라우저 에뮬레이션으로 확인한 것으로 간주하지 않는다.

### 명시적 이동

1장과 후속 장 모두 사용자가 남긴 지시로만 이동한다. 적용되는 지시가 없거나 실행이 끝나면 제자리에서 멈춘다. 자동 전진·자동 사망·새 메모 삽입은 하지 않는다. 명시한 이동은 도착이나 충돌까지 이어가며, 지시한 탑승·대기는 그에 따른 환경 변화를 진행한다. 지시 없는 정지는 데스나 작성권을 바꾸지 않는다.
