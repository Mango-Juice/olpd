# PLAN.md 구현 및 검증 맵

이 문서는 구현 위치와 실제로 확인한 증거를 연결한다. 테스트 성공과 실기기/사람의 사용성 관찰은 별도이다.

2026-09-22 후속 요청으로 원래 계획의 최신 지침 우선·순서 변경 금지·매회 별도 확정은 대체됐다. 현재는 손잡이 드래그 또는 메모 `···` 메뉴에서 출발 전에 우선순위를 조절하고, 화면 위쪽의 적용 가능한 한 줄을 실행한다. 첫 학습 이후에는 해석 성공 시 기억과 출발을 이어서 처리한다. 아래 이전 검증 맵과 함께 최신 결과는 `docs/verification.md`를 확인한다.

| 계획 요구                                  | 구현                                                | 검증                                                     |
| ------------------------------------------ | --------------------------------------------------- | -------------------------------------------------------- |
| React + TS + Vite + Canvas, HTML 입력/메모 | src/App.tsx, components/DungeonCanvas.tsx, render/* | 타입/빌드, desktop/mobile 스크린샷                       |
| 원본 용사/환경, 일관된 팔레트와 출처       | render/scene.ts, palette.ts, docs/art-direction.md  | 렌더된 장면 직접 확인                                    |
| 8개 모션, 사망 유지, 부활, 저FPS 장식 축소 | render/animation.ts, DungeonCanvas                  | 브라우저 실재생, animation 테스트                        |
| 입력/해석/확정/출발, 실제 Jev              | App, server/jev.ts                                  | scripts/browser-check.ts 실제 5회 호출로 처음부터 클리어 |
| IME Enter, 중복/오래된 응답 무시           | App request id + AbortController + composing        | 브라우저 검증 및 오류 경계 검증                          |
| 전진 기본값, 최근 우선, 한 행동/80자       | game/core.ts, server/service.ts                     | core/api 테스트                                          |
| 죽음 1회/1줄, 기회 미누적, 삭제 원자 비용  | game/core.ts                                        | core 테스트, browser 삭제/취소 검증                      |
| 튜토리얼과 본편 기록 분리/메모 이월        | core startMain, App practice                        | 실제 AI 튜토리얼 완료 후 초기화 확인                     |
| 8개 방, 여러 판단점, 최종 조합             | game/content.ts                                     | 실제 8개 방 클리어, core 전체 경로 테스트                |
| 이미 본 이벤트 3배속, 신규 방 일반속도     | core signature + Canvas                             | core 테스트, 이벤트 로그                                 |
| 숨김/일시정지, 감소모션, 소리 저장         | DungeonCanvas + audio.ts + App                      | 브라우저 설정/정지 검증                                  |
| 자동 저장/버전/손상/다른탭 충돌            | game/storage.ts                                     | storage 테스트, 새로고침 및 2탭 검증                     |
| 선택적 메모 공유, 미리보기/시스템/복사     | App share dialog                                    | 실제 클리어 공유 미리보기 검증                           |
| 비밀 서버키, 호출 중단/원문 없는 로그      | server/*, .gitignore                                | bundle 비밀값 검사, 환경 검증                            |
| IP 분당 30회                               | server/rate-limit.ts + Vercel WAF                   | unit 31번째 차단, 공개 URL WAF 검증                      |
| AI 한국어 60개 이상 평가                   | scripts/evaluate.ts                                 | docs/jev-evaluation-*.md (최종 결과 참조)                |
| 공개 배포/비로그인 사용/검색 차단          | vercel.json, robots.txt                             | 최종 공개 브라우저와 HTTP 검증                           |

폰트는 @fontsource를 통해 프로젝트 의존성에 포함한 Noto Sans KR Variable와 Gowun Batang이다. 모두 SIL Open Font License이며 node_modules 해당 패키지/LICENSE 및 배포 번들에 원본 라이선스 고지를 보관한다. Google Fonts CDN 런타임 요청은 없다.

검증 증거 파일은 `artifacts/`(git 제외)에 있으며, 배포와 최종 결과는 README 및 docs/verification.md에 기록한다. 실제 휴대전화 키보드와 사람 대상 사용성 관찰은 브라우저의 모바일 에뮬레이션 검증과 구분한다.
