# 프로젝트 개발 지침

## 구현 기준

- 자연어 메모로 용사를 움직이는 퍼즐 게임. 신규 플레이는 프롤로그와 10장·60스테이지로 구성한다. 프롤로그를 건너뛰어도 1-1에서 시작하며, 앞 장을 완료해야 다음 장이 열린다.
- [공통 메모 수칙](docs/game-rules.md)을 기준으로 한다. 매 행동마다 메모를 위에서부터 검사해 조건이 맞는 첫 수칙을 실행한다. 메모는 소모되지 않는다. 맞는 수칙이 없으면 멈추며, 암묵적인 전진이나 상호작용을 넣지 않는다.
- 모든 장은 1장에서 추출한 공용 메모장·입력·재생·대사·점수·기록 UI를 사용한다. 맵과 행동 판정만 장별 어댑터로 확장한다. 복사한 별도 UI나 축소된 메모장 기능을 만들지 않는다.
- 메모는 장 안에서 누적한다. 사망 후 한 줄을 추가하고 장 입구부터 재시작한다. 지우개 두 개를 소진한 뒤 삭제는 한 줄당 3데스다.
- Enter 한 번으로 해석·저장·출발한다. 공용 입력에서 한글 조합, 중복 제출, 취소와 늦은 응답을 처리하며 해석 실패에는 작성 기회를 쓰지 않는다.
- 후속 장은 스크롤 없는 한 화면에 2~4개 요소를 배치한다. 목표는 한 문장으로 알리고 관계는 물체와 움직임으로 보여 준다. 내부 수치·상세 성질표·불필요한 접기 UI를 노출하지 않는다.

## 구조와 AI 경계

- React + TypeScript + Vite + Canvas 2D, Node.js API를 사용한다.
- `src/game/`: 1장 판정·비용·저장 검증·현재 행동 기록·오디오. `src/campaign/spatial/`: 2~10장 선언형 배치와 공용 이동·충돌·장치 실행기.
- `src/App.tsx`와 `src/components/`: 입력·메모장·공용 플레이 UI. `CampaignChronicle.tsx`는 현재 실행의 행동 설명과 재생을 담당한다.
- `src/render/`와 `DungeonCanvas.tsx`: 확정된 이벤트의 그래픽 재생. 코어가 생사·비용을 먼저 판정하고 저장하며 프레임 속도는 판정에 영향을 주지 않는다.
- `server/`, `api/`: 입력 검증·AI 해석·호출 제한·Vercel Node API. AI는 지침만 해석하고 물리·성공 여부는 코드가 결정한다.
- 프롤로그·1장은 TypeSafe Jev, 후속 장은 DeepSeek V4.1 Flash(`deepseek-flash`)를 사용한다. 캠페인은 기본 non-thinking(`CAMPAIGN_DEEPSEEK_THINKING=disabled`), 요청당 한 번, 최대 8초이며 자동 재호출·fallback은 없다. `low`는 서버 설정으로 비교할 수 있다.
- 키는 서버에서만 읽고 `VITE_` 접두어를 붙이지 않는다. 키가 없으면 복구 가능한 오류를 표시한다. 실제 플레이에 모킹이나 키워드 대체 해석을 넣지 않는다.

## 저장과 호환성

- 현재 메모·진행·행동 기록은 자동 저장한다. 완료 후에는 장별 완료·해금·최고 기록과 마지막 완료 참조/시각만 남기고 완료 회차 전체를 누적하지 않는다. 다중 창 충돌은 정지하고 알린다.
- 저장 문서 v5는 이전 완료 상세를 검증·요약하고 새 문서 저장 성공 후 동일한 원본만 정리한다. 진행 중 실행과 개편 전 활성 복구 자료는 보존한다.
- 1장의 무표기/버전 1 저장은 옛 도입·8방 경로를 유지한다. 신규·초기화는 `layoutVersion: 3`의 6장면이다. 버전 2 좌표는 검증용으로 보존하되 마지막 다리 이후 제거된 구간은 실행하지 않는다.
- 규칙 변경 시 저장 버전과 명시적 마이그레이션을 함께 관리한다. 저장된 지침을 조용히 다시 해석하지 않는다.

## 로컬 실행과 QA

- Node.js 22.x. `npm ci` 후 `.env.example`을 `.env.local`로 복사하고 두 API 키를 설정한다. `npm run dev`는 프런트엔드와 API를 `http://localhost:5173`에서 제공한다.
- localhost 개발 서버의 `/?qa=1`에서 프롤로그·각 장·후속 개별 스테이지를 선택한다. AI는 실제 API를 사용한다.
- QA 저장 키는 `one-line-per-death:qa:spatial-v1`이며 일반 진행과 분리한다. “새 QA 시작”은 QA 슬롯만 초기화한다. 일반 플레이는 `/`로 돌아간다.

## 검사

```sh
npm test
npm run build         # 타입 검사(미사용 코드 포함) + 프로덕션 빌드
npm run typecheck     # 타입 검사만 필요할 때
npx playwright install chromium
```

브라우저 검사는 별도 터미널에서 `npm run dev`를 실행한 상태에서 수행한다. 기본 검사는 유료 API 없이 명시적 fixture로 UI와 실제 실행기·저장을 확인한다.

| 명령 | 범위 | 실제 API |
| --- | --- | --- |
| `npm run test:browser` | 프롤로그·1장과 후속 장 공용 UI | 호출 없음 |
| `npm run test:ui` | 1장 가독성·장면별 재생 | 호출 없음 |
| `npm run test:drag` / `test:priority` | 메모 드래그·우선순위·충돌 | 호출 없음 |
| `npm run test:notebook` | 삭제 비용·공유·설정 | 호출 없음 |
| `npx tsx scripts/browser-campaign-storage.ts` | 저장 요약 전환·트랜잭션 실패·반복 완료 후 크기 | 호출 없음 |
| `npm run test:errors` | 통신·저장 오류, IME, 늦은 응답 | 호출 없음 |
| `npm run test:campaign:scenes` | 후속 54장면 고정 화면과 모바일 폭 | 호출 없음 |
| `npm run test:campaign:recovery` | 옛 저장 원본·해금 보존과 새 형식 재개 | 호출 없음 |
| `npm run eval:campaign -- --ids=02-v2-1` | 지정한 현재 장면의 한국어 해석·실행 | DeepSeek, 장면당 1회. `--all`은 최대 54회 |
| `npm run eval:campaign:smoke` | Jev와 DeepSeek의 조건·재사용·대기·협동 표본 | 최대 4회. `--only=02-v2-1`로 1건 지정 가능 |
| `npm run eval:jev` | 1장 한국어 행동·상황 평가 | 실제 Jev 호출 |
| `npm run test:priority:live` / `test:guards` | 실제 API의 우선순위/입력 경계 | 실제 Jev 호출 |

`test:onboarding`은 새 1장 6장면 완료·2장 해금·메모 유지·재접속 검사, `test:onboarding:legacy`는 기존 도입 저장의 이어하기 검사, `test:campaign:shared`는 후속 장 공용 UI 검사만 따로 실행한다. 자동화 성공은 실제 모델 정확도나 사람의 체감 난이도와 구분한다. 브라우저 fixture는 실제 플레이의 AI 경로에 포함되지 않는다.

`artifacts/`는 Git에서 제외되는 로컬 결과 폴더다. 이전 콘텐츠용 실행 스크립트는 제거했으며, 당시 실험과 검증 수치는 [과거 기록 안내](docs/history/README.md)에서 구분한다. `npm run preview`는 빌드된 정적 화면만 제공하고 Node API는 띄우지 않는다.

## Canvas 성능

- 공용 재생 루프는 일시정지·탭 숨김 중 반복 그리기를 멈춘다. 정지 중 설정·크기·이미지가 바뀌면 필요한 한 프레임만 다시 그린다.
- 고정 배경은 해상도에 맞춰 캐시하고 변하지 않은 캠페인 배치는 재사용한다. 배경 캐시 원시 픽셀은 캔버스당 최대 20 MiB이며 초과하면 직접 그린다.
- `npm run test:canvas`로 정지·재개·크기 변경·숨김·화면 이탈을 검사한다. 실측과 실제 기기 검증의 한계는 [검증 기록](docs/verification.md)에 남긴다.

## 배포·운영

Vercel 프로젝트 `olpd`에 Vite와 Node API를 함께 배포한다. 서버 비밀값 `TYPESAFE_API_KEY`와 `DEEPSEEK_API_KEY`를 production/preview 환경에 설정한다. `.env.local`, `.vercel`, 테스트 저장 기록은 Git에서 제외한다. 운영 페이지는 검색 수집을 허용하고 API는 noindex를 유지한다. 메타 정보·공유 이미지·소유 확인·사이트맵 제출 절차는 [공개 운영 준비](docs/publishing.md)를 참고한다.

```sh
npx vercel link --project olpd --scope <본인 스코프>
npx vercel env add TYPESAFE_API_KEY production --sensitive
npx vercel env add DEEPSEEK_API_KEY production --sensitive
npx tsx scripts/check-server-imports.ts
npx vercel deploy --prod
```

`AI_ENABLED=false`로 AI 공급자 호출을 중단할 수 있다. Vercel 환경변수 변경 후 재배포해야 적용된다. 긴급 중단이 필요하면 Vercel 방화벽에서 `/api/interpret`와 `/api/campaign-interpret`를 일시 차단한다. 지침 원문·비밀값은 운영 로그에 남기지 않는다.

API에는 서버 인스턴스 단위 IP 30회/분 제한과, 배포 프로젝트의 Vercel WAF IP 30회/60초 제한을 함께 적용한다. WAF는 고정 윈도와 리전별 카운터이며 전 세계에서 합산되는 비용 상한이 아니다. 호출·토큰·지연·오류 로그와 TypeSafe·DeepSeek 사용량을 확인해야 한다. 유료 플랜이나 데이터베이스는 구매하지 않는다.

저장 파일은 게임/던전/해석 규칙 버전을 포함한다. 향후 규칙 변경 시 버전을 올리고 명시적인 마이그레이션을 제공해야 하며, 저장된 지침을 조용히 다시 해석하지 않는다.

검사 결과와 공개 배포의 관찰 범위는 [검증 기록](docs/verification.md), AI 평가는 [Jev 평가](docs/jev-evaluation-2026-09-21.md)를 참고한다. 현재 구현은 [공간 실행기](docs/spatial-implementation.md), 공간·물체별 연출 기획은 [10장 스테이지 설계](docs/stage-design/README.md), 이야기 설정은 [스토리 구상](docs/story-concept.md)을 따른다.

## Git 작업

- 목적이 다른 변경은 별도 커밋으로 남긴다. 커밋 전에 `git diff --check`, 범위에 맞는 검사, `git diff --cached` 확인을 수행한다.
- `.env.local`, `.vercel/`, `node_modules/`, `dist/`, `artifacts/`는 추적하지 않는다. 로컬 커밋과 원격 push·배포는 구분한다.
- [DeepSeek 평가](docs/campaign-deepseek-probe.md)와 [캠페인 구현 기록](docs/campaign-implementation.md)을 참고한다. 로컬 검증과 공개 배포 상태를 구분한다.

## Subagent delegation

When acting as the main agent, act as the lead engineer: understand the user's intent, make design decisions, coordinate implementation, and deliver the integrated result.

When acting as a subagent, complete your assigned task within its scope and report to the assigning agent. Do not take over global coordination.

Bias toward completing the assigned task autonomously. Do not stop at a proposal or first implementation when the requested work and appropriate verification can be completed directly.

### Keep in the main agent

The main agent retains responsibility for:

- interpreting ambiguous requirements and user intent
- architecture, API design, and consequential implementation tradeoffs
- reasoning about cross-cutting effects and changes to scope or assumptions
- integrating, reconciling, and reviewing delegated results
- deciding whether the integrated result is correct and complete

Subagents may investigate alternatives and recommend decisions. The main agent must make the final decision with the relevant evidence; do not transfer decision ownership merely because reasoning is difficult or expensive.

### Delegate bounded work

Delegate when the assignment has a clear objective, bounded scope, and an independently reviewable result, and delegation is expected to improve speed, quality, or context efficiency.

Good candidates include:

- isolated implementation or refactoring after the relevant design is established
- repetitive or mechanical edits
- exploration of independent subsystems or investigation of independent hypotheses
- bug reproduction and diagnostic collection
- targeted tests, builds, lint, type checks, and log analysis
- bounded reviews for correctness and regressions

Subagents may make local implementation decisions within their assignment. They must report significant design questions, conflicting requirements, or necessary scope expansion to the main agent rather than silently redefining the task.

### Parallelism

Prefer parallel subagents for independent exploration, hypotheses, reviews, or verification. Parallelize implementation when ownership and dependencies are sufficiently clear.

Give concurrent editors disjoint file ownership. Treat tightly coupled changes as dependent even when they touch different files; avoid overlapping edits.

Do small tasks directly when delegation and review would cost more than the work. Do not fragment a tightly sequential task merely to use more agents.

Subagents may delegate further when supported and when independent work offers a material benefit. Keep nested assignments within the original scope and avoid delegation chains without useful parallelism.

### Verification

The main agent remains responsible for the integrated result. After delegated work:

1. Inspect the relevant changes or findings and their supporting evidence.
2. Resolve conflicts and remaining design questions.
3. Check that the pieces work together.
4. Run or request checks appropriate to the scope and risk of the integrated change.

Do not treat a success summary or exit status alone as proof of correctness. Inspect what was actually checked and report material gaps or blockers.

Start with targeted checks and complete required verification. Add tests when they meaningfully validate behavior or prevent regressions, not solely to mirror trivial, reversible implementation details.

Reuse relevant verification evidence instead of automatically repeating every subagent check. Broaden or repeat testing when subsequent changes, failures, integration risks, or unresolved concerns justify it.

### Noisy work

Keep large command outputs and repetitive diagnostic details in the subagent context when practical. Return enough evidence for review without forwarding full logs by default.

For verification work, report:

- command executed and exit status
- relevant pass/fail results, including failing test or check names
- concise error excerpts and likely cause, distinguishing evidence from hypotheses
- affected files or areas
- remaining uncertainty, skipped checks, and whether anything blocks completion

Provide fuller logs when necessary for diagnosis. Do not compress away contradictory findings or information needed to judge correctness.

### Delegation principle

Use the main agent for global judgment, coordination, and integration. Use subagents for independent implementation, exploration, and verification.

The main agent may implement directly when its existing context, task dependencies, or coordination overhead make that the better choice. Delegation is a means to complete the task, not a requirement to create workers for every step.

## Model selection

Choose models by uncertainty, reasoning burden, consequences of error, and verification difficulty, not file count or code volume.

Prioritize correctness, then optimize total cost and latency. Use a less expensive model when it can meet the assignment's requirements reliably without disproportionate supervision, retries, or rework.

Treat the following roles as routing defaults, not guaranteed capability boundaries. Adjust them using evidence from the actual task. Model choice and reasoning effort are separate decisions.

### GPT-6 Astra

Prefer Astra for lead-agent work requiring sustained judgment or discovery:

- ambiguous requirements, architecture, and complex task decomposition
- investigation where the problem or root cause remains poorly understood
- consequential choices across approaches, subsystems, migrations, or infrastructure
- revising the plan, resolving conflicting findings, and final integration judgment

Do not restrict Astra to planning if direct implementation is the most effective way to finish the task.

Use an Astra subagent when an independent branch needs comparable depth and parallelizing it materially improves speed or quality. Do not select Astra merely because an assignment touches many files.

### GPT-5.6 Sol

Use Sol for substantial implementation and demanding but bounded engineering where the objective and overall direction are sufficiently clear.

Good candidates include:

- complex features, nontrivial refactors, and changes spanning known modules
- difficult debugging after the problem area has been narrowed
- concurrency, state-management, data-consistency, or security-sensitive changes
- rigorous code review or validation of a proposed design

Prefer Sol when implementation requires significant reasoning or when a weaker model's mistakes would be difficult to detect. Return consequential architectural or scope decisions to the main agent.

### GPT-5.6 Terra

Use Terra for lighter exploration and straightforward, well-specified implementation with manageable risk and clear verification.

Good candidates include:

- repository exploration, read-heavy scans, and bounded summaries
- conventional components, handlers, endpoints, or integrations with established patterns
- straightforward bug fixes and localized refactors
- focused tests for already-understood behavior
- implementing an explicit design with limited interaction between subsystems

Do not assume every ordinary-looking feature belongs to Terra. Choose Sol when the surrounding behavior, edge cases, or verification require substantial technical judgment.

### GPT-5.6 Luna

Use Luna for explicit, narrow, repeatable work whose result can be checked mechanically.

Good candidates include:

- specified renames, repetitive edits, boilerplate, formatting, or copy changes
- simple configuration changes and lint fixes with obvious resolutions
- executing specified tests, builds, lint, or type checks
- targeted searches, diagnostic collection, and concise log summaries
- applying an already-specified transformation

Distinguish executing a check from diagnosing an unfamiliar failure. Luna may collect evidence and fix obvious local mistakes, but should return ambiguous debugging, design decisions, or cross-cutting changes to the main agent.

### Reasoning effort

Choose effort independently from the model. Use a level sufficient for reliable completion without unnecessary reasoning:

- **Low** for mechanical, deterministic, narrowly scoped work.
- **Medium** for ordinary implementation and investigation with manageable uncertainty.
- **High** for difficult debugging, complex logic, edge cases, or substantial tradeoffs.
- **Extra High or Max**, when available, for unusually demanding reasoning where the additional effort is justified.

Extra High and Max are distinct settings; use the exact level supported by the environment.

Do not automatically pair Sol with High or Luna with Low. Preserve an effective setting unless the task or evidence supports changing it.

When a result is inadequate, consider both additional effort on the current model and a more capable model. Neither must always precede the other.

### Escalation

Escalate based on evidence, including:

- inability to progress because the assignment needs deeper reasoning or judgment
- recurring uncertainty that affects correctness
- conceptual errors exposed by verification
- newly discovered architectural decisions or changes beyond the assigned scope

Choose the appropriate destination directly. Do not require every task to start with Luna or pass through Terra and Sol before reaching Astra.

Avoid repeated speculative retries when the assignment was routed too low. Preserve useful findings and failure evidence for the next agent.

Do not escalate merely because a command encounters an environmental failure, a dependency is unavailable, a deterministic local mistake needs fixing, the repository is large, or execution takes longer than expected.

A subagent that reaches its decision boundary should report to the main agent rather than silently widening its authority.

### Optimize total work, not per-call cost

Account for model usage, transferred context, coordination, supervision, retries, review, rework, and verification when choosing a route.

A cheaper invocation is not an improvement if another agent must redo the work. Conversely, do not use a stronger model when a cheaper model reliably produces an easily verified result.

Do not assume that more parallel agents will reduce total usage; require a worthwhile improvement in completion time, quality, or context management.

### Task shape matters more than task size

Examples of routing judgments, subject to the actual risks and available checks:

- A fully specified rename across 40 files may fit Luna.
- A conventional endpoint with clear behavior and established tests may fit Terra.
- A five-line concurrency fix may require Sol.
- A single configuration change may require Astra when its system-wide consequences are unclear.

### Context discipline

Give each subagent a concise assignment containing the information needed for correctness:

- objective and relevant requirements
- constraints, relevant files or symbols, and ownership boundaries
- decisions already made and questions still unresolved
- authorized actions
- expected verification
- expected result format

Prefer targeted context over unnecessary parent-history transfer when the tooling allows it. Do not omit dependencies, constraints, or contrary evidence merely to save tokens.

### Routing defaults

When no stronger task-specific evidence applies:

- **Luna:** mechanical execution and specified verification commands.
- **(DO NOT USE - version 6 model is not available) Terra:** lighter exploration and straightforward, readily verifiable implementation.
- **Sol:** substantial implementation and demanding bounded engineering.
- **Astra:** ambiguity, discovery, architecture, consequential coordination, and final judgment.

When uncertain between adjacent options, choose the cheaper one only when errors are inexpensive and easy to detect. Prefer the stronger option when errors would be subtle or costly to undo.

Choose **latest version of model**.

### Availability and reporting

Use only models and reasoning settings exposed by the current environment. Apply routing through supported tool parameters or configured agent roles; naming a model in an assignment does not by itself confirm that the runtime selected it.

When routing matters, request the intended model and effort explicitly where supported. Do not assume an unspecified subagent will automatically use a cheaper model.

Distinguish requested routing from confirmed execution. Do not claim that a model or effort was actually used unless the available tooling establishes it.

If the preferred model or selection control is unavailable, use an appropriate available option or perform the work directly. Report limitations that materially affect the result rather than blocking routine work.

The main agent retains responsibility for reviewing and integrating results regardless of which model produced them.