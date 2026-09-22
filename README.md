# 죽을 때마다 한 줄 · One Line Per Death

**배포된 기존 버전: https://olpd.vercel.app**

아래 10장·80스테이지 캠페인은 로컬 구현 상태다. 이번 작업에서는 배포하지 않았다. [구현·검증 기록](docs/campaign-implementation.md)을 참고한다.

작은 용사에게 자연어 지침을 남기며 탈출하는 웹 게임. React + TypeScript + Vite + Canvas 2D, Node.js API를 사용한다. 프롤로그·1장은 TypeSafe Jev, 2장 이후 캠페인은 DeepSeek V4.1 Flash(`deepseek-flash`)로 지침을 해석한다.

## 실행

Node.js 22.x (`package.json`의 지원 버전).

```sh
npm ci
cp .env.example .env.local
# .env.local에 TYPESAFE_API_KEY와 DEEPSEEK_API_KEY 설정
npm run dev
```

`http://localhost:5173`에서 프런트엔드와 API가 같은 주소로 열린다. 키는 서버에서만 읽는다. `VITE_` 접두어를 붙이지 않는다. 키가 없으면 입력 시 복구 가능한 오류를 표시한다. 실제 플레이에 모킹이나 키워드 기반 해석 대체 경로는 없다.

캠페인 해석은 기본 non-thinking(`CAMPAIGN_DEEPSEEK_THINKING=disabled`), 요청당 한 번 호출, 최대 8초다. `low`는 서버 설정으로 비교할 수 있으며 자동 fallback/재호출은 없다. 해석 미리보기에서 확인해야 메모를 쓰고, 취소·해석 오류에는 작성 기회를 쓰지 않는다.

## 플레이

- 서사 프롤로그는 SKIP할 수 있다. 신규 플레이는 작은 도입 26개를 포함한 10장·80스테이지를 진행한다.
- 도입은 한 장면에 임시 한 줄을 무료로 쓰고 고치며 배운다. 본편으로 넘어가면 원래 메모·지우개·복귀점 규칙을 적용한다.
- 1장의 기존 8방은 화면 1-5~1-12로 유지한다. 다음 장은 앞 장을 완료해야 열린다.
- 물건·주체·순서·조건을 자연어로 적고 실행 의도를 확인한다. 모델은 지침만 해석하고 물리와 성공은 코드가 결정한다.
- 메모는 위쪽부터 우선한다. 기본 전진은 안전하게 열린 유일한 보행 경로에서만 수행하고, 상호작용이나 역할을 대신 결정하지 않는다.
- 관찰한 연결은 현재 시도에서 다시 확인해야 한다. 10장에는 세 봉인 복귀점과 편지 엔딩이 있다.
- 모든 장이 공용 화면과 원본 용사 아트를 쓰며, 장별 합성 BGM·음소거·모션 감소를 지원한다.
- 진행·메모·학습 기록은 자동 저장한다. 기존 본편 저장은 도입 면제로 이어지고 다중 창 충돌은 멈춰 알린다.
- 로컬 QA: **http://localhost:5173/?qa=1**. 장과 개별 스테이지를 바로 선택하며 일반 진행과 따로 저장한다.

## 로컬 추가 기능: 모험 연혁 (미배포)

클리어 화면의 **우리의 모험 돌아보기**에서 생별 메모 작성·삭제·우선순위 변경·부활·행동 결과를 확인한다. 반복해서 통과한 장면은 접혀 있고, 각 장면을 점수나 진행에 영향 없이 다시 볼 수 있다. 완료한 여정은 별도 IndexedDB 보관함에 한 번 저장하며, 새 도전 이후에도 화면 아래 **지난 모험 기록**에서 연다. 이전 저장 파일은 행동 기록을 복원하고 누락된 메모 변경 이력을 안내한다. 보관 실패 시 현재 클리어 기록을 덮어쓰지 않고 재시도·내보내기를 제공한다.

## 검사

```sh
npm test
npm run build         # 타입 검사(미사용 코드 포함) + 프로덕션 빌드
npm run typecheck     # 타입 검사만 필요할 때
npx playwright install chromium
```

브라우저 검사는 별도 터미널에서 `npm run dev`를 실행한 상태에서 수행한다. 새 캠페인의 기본 UI 검사는 `test:campaign:scenes`, `test:onboarding`, `test:onboarding:legacy`다. 아래 구형 `test:browser`·`test:errors`·`test:notebook`은 이전 프롤로그/localStorage 흐름의 보존된 검사이며 새 캠페인 인수 증거로 사용하지 않는다.

| 명령 | 범위 | 실제 API / 선행 조건 |
| --- | --- | --- |
| `npm run test:ui` | 가독성·우선순위 표시·장면별 재생 | 합성 저장 fixture, API 키 불필요 |
| `npm run test:drag` | 데스크톱·모바일 메모 순서 변경 | 합성 저장 fixture, API 키 불필요 |
| `npm run test:priority` | 우선순위·동일 조건 충돌 거부 | 합성 저장·해석 응답, API 키 불필요 |
| `npm run test:chronicle` | 연혁·장면 재생·완료 기록 보관 | 합성 저장 fixture, API 키 불필요 |
| `npm run test:browser` | 구 프롤로그 원형 검사 | 실제 Jev, 서버 키 필요·호출 비용 발생 |
| `npm run test:errors` | 통신·저장 오류, IME, 늦은 응답 | 늦은 응답 검사에서 실제 Jev 호출 |
| `npm run test:priority:live` | 우선순위·실제 해석 결과의 충돌 | 실제 Jev 호출 |
| `npm run test:notebook` | 삭제 비용·공유·설정 | `test:browser`가 만든 같은 `CHECK_LABEL`의 저장 기록 필요 |
| `npm run test:guards` | HTTP 입력 가드 | 실제 Jev 호출 |
| `npm run eval:campaign -- --repeat=3` | 캠페인 의미·조건·협동·물리·지연 평가 | 실제 DeepSeek, `.env.local` 필요·호출 비용 발생 |
| `npm run test:campaign:browser` | 미리보기·저장·2장 실행·무료 오류·취소 | 실행 중인 개발 서버와 실제 DeepSeek 필요·2회 호출 비용 발생 |
| `pnpm exec tsx scripts/browser-all-stages.ts` | 후속 68장면·개별 QA·모바일 렌더링 | 실제 API 호출 없음 |
| `pnpm exec tsx scripts/browser-onboarding-flow.ts` | 2장 무료 수정·재접속·본편 인계 | provider stub, 실제 물리·저장 |
| `pnpm exec tsx scripts/browser-legacy-onboarding.ts` | 서사 SKIP·1장 도입4개·본편 인계 | provider stub, 실제 UI·저장 |
| `pnpm exec tsx --env-file=.env.local scripts/evaluate-onboarding-live.ts` | 도입22개 실제 해석+물리 | DeepSeek 호출 비용 발생 |
| `npm run eval:jev` | 고정 한국어 합성 문장·상황 평가 | 실제 Jev, `.env.local` 필요·호출 비용 발생 |

`test:ui`, `test:drag`, `test:priority`, `test:chronicle`은 `scripts/browser-fixtures.ts`로 검사 데이터를 만들어 과거 `artifacts/` 파일 없이 실행한다. 합성 해석은 자동화 검사에만 사용하며 실제 플레이의 해석 경로에는 포함되지 않는다. 이 검사 성공은 Jev의 실제 해석 정확도 검증과 구분한다.

`APP_URL=https://...`로 대상 주소를 바꿀 수 있다. `CHECK_LABEL`을 지원하는 검사에서는 보고서와 실제 저장 기록의 접두어를 지정한다. 에뮬레이션·보고서·스크린샷은 `artifacts/`에 남는다. `npm run preview`는 빌드된 정적 화면만 제공하며 Node API를 띄우지 않는다.

## 구조

- `src/game/`: 버전·관찰·방, 순수 판정과 원자적 비용 처리, 저장 검증, 연혁·보관함·오디오
- `src/render/`, `src/components/DungeonCanvas.tsx`: 원본 그래픽과 프레임 단위 재생
- `src/App.tsx`: 입력/확정, 메모장, 튜토리얼, 결과·공유, 저장/UI 상태
- `src/components/StageChronicle.tsx`: 생별 연혁과 독립 장면 재생
- `server/`, `api/`: 요청 검증, Jev, 제한, Vercel Node API
- `scripts/evaluate.ts`: 고정 한국어 합성 문장 및 상황 평가
- `docs/`: 아트 출처, API, 평가 결과, 요구사항/검증 맵

게임 코어는 판단 지점에서 생사·비용을 먼저 확정하고 저장한다. Canvas는 확정된 이벤트를 재생한다. 프레임 속도는 판정에 영향을 주지 않는다.

## 배포·운영

Vercel 프로젝트 `olpd`에 Vite와 Node API를 함께 배포한다. 서버 비밀값 `TYPESAFE_API_KEY`와 `DEEPSEEK_API_KEY`를 production/preview 환경에 설정한다. `.env.local`, `.vercel`, 테스트 저장 기록은 Git에서 제외한다. 사이트 및 robots 응답은 noindex/nofollow다.

```sh
npx vercel link --project olpd --scope <본인 스코프>
npx vercel env add TYPESAFE_API_KEY production --sensitive
npx vercel env add DEEPSEEK_API_KEY production --sensitive
npx vercel deploy --prod
```

`AI_ENABLED=false`로 AI 공급자 호출을 중단할 수 있다. Vercel 환경변수 변경 후 재배포해야 적용된다. 긴급 중단이 필요하면 Vercel 방화벽에서 `/api/interpret`와 `/api/campaign-interpret`를 일시 차단한다. 지침 원문·비밀값은 운영 로그에 남기지 않는다.

API에는 서버 인스턴스 단위 IP 30회/분 제한과, 배포 프로젝트의 Vercel WAF IP 30회/60초 제한을 함께 적용한다. WAF는 고정 윈도와 리전별 카운터이며 전 세계에서 합산되는 비용 상한이 아니다. 호출·토큰·지연·오류 로그와 TypeSafe·DeepSeek 사용량을 확인해야 한다. 유료 플랜이나 데이터베이스는 구매하지 않는다.

저장 파일은 게임/던전/해석 규칙 버전을 포함한다. 향후 규칙 변경 시 버전을 올리고 명시적인 마이그레이션을 제공해야 하며, 저장된 지침을 조용히 다시 해석하지 않는다.

검사 결과와 공개 배포의 관찰 범위는 [검증 기록](docs/verification.md), AI 평가는 [Jev 평가](docs/jev-evaluation-2026-09-21.md)를 참고한다. 현재 개발 현황은 [PLAN](PLAN.md), 미구현 확장안은 [스토리 구상](docs/story-concept.md)과 [10장 스테이지 설계](docs/stage-design/README.md)에 구분해 보관한다.


## Git 작업

현재 개발 브랜치는 `main`이다. 기능·수정·문서처럼 목적이 다른 변경은 별도 커밋으로 남긴다. 커밋 전에 `git diff --check`와 변경 범위에 맞는 검사를 실행하고, `git diff --cached`로 포함할 파일을 확인한다.

`.env.local`, `.vercel/`, `node_modules/`, `dist/`, `artifacts/`는 추적하지 않는다. 로컬 커밋은 원격 push나 Vercel 배포를 수행하지 않는다.

캠페인 DeepSeek의 적용 범위와 실측은 [DeepSeek 평가](docs/campaign-deepseek-probe.md), 전체 스테이지의 미완료 범위는 [캠페인 구현 기록](docs/campaign-implementation.md)을 참고한다. 로컬 검증과 공개 배포 상태는 구분한다.

### 로컬 QA 모드

`pnpm dev` 후 `http://localhost:5173/?qa=1`을 열면 클리어 없이 구현된 장에 바로 입장할 수 있습니다. 프롤로그·1~6장과 실험 중인 7장을 제공하며, 미구현 8~10장은 입장 불가로 표시합니다. QA 메모·진행은 `one-line-per-death:qa:v1`에 별도 저장하며 일반 캠페인/연혁을 변경하지 않습니다. “새 QA 시작”은 해당 QA 슬롯만 초기화합니다. 일반 플레이는 `/`로 돌아갑니다. 개발 서버의 localhost에서만 열리고, AI 해석은 실제 API를 사용합니다.

### 장과 스테이지의 화면

한 장 안에서 여러 스테이지를 차례로 진행합니다(예: 4장 안의 4-1~4-5). 플레이 화면은 1장과 같은 공용 헤더·장면/종이 메모장 배치·입력창·실마리·진행 표시를 사용합니다. 처음에는 목표와 첫 개념만 안내하고, 물건 설명은 선택했을 때, 전체 성질은 자세히 보기를 열었을 때 보여 줍니다. 이전 스테이지의 원인 장치 상태는 현재 물건과 섞지 않고 별도로 접어 둡니다.
