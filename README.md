# 죽을 때마다 한 줄 · One Line Per Death

**배포된 기존 버전: https://olpd.vercel.app**

아래 10장·66스테이지 캠페인은 로컬 구현 상태다. 이번 작업에서는 배포하지 않았다. [구현·검증 기록](docs/campaign-implementation.md)을 참고한다.

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

캠페인 해석은 기본 non-thinking(`CAMPAIGN_DEEPSEEK_THINKING=disabled`), 요청당 한 번 호출, 최대 8초다. `low`는 서버 설정으로 비교할 수 있으며 자동 fallback/재호출은 없다. 모든 장에서 Enter 한 번으로 해석 후 바로 저장하고 출발한다. 공용 입력 컴포넌트가 한글 조합·중복 제출·취소·늦은 응답을 처리하며, 해석 오류에는 작성 기회를 쓰지 않는다.

## 플레이

- 서사 프롤로그는 SKIP할 수 있다. 1장 12장면과 2~10장 각 6장면, 총 66스테이지를 진행한다.
- 2장 이후는 한 화면에 2~4개 요소만 둔다. 1장과 같이 메모를 누적하고, 죽은 뒤 한 줄을 더 써 장 입구부터 다시 시작한다. 지우개 두 개 이후 삭제는 한 줄당 3데스다. 내부 수치나 물체 설명표는 표시하지 않는다.
- 1장의 기존 8방은 화면 1-5~1-12로 유지한다. 다음 장은 앞 장을 완료해야 열린다.
- 물건·주체·순서·조건을 자연어로 적고 Enter로 바로 실행한다. 모델은 지침만 해석하고 물리와 성공은 코드가 결정한다.
- 메모는 위쪽부터 우선한다. 맞는 메모가 없으면 저작된 앞길로 전진하며, 상호작용이나 역할을 대신 결정하지 않는다.
- 관찰은 같은 화면의 윤곽과 움직임을 드러낸다. 10장의 세 봉인과 편지 이야기는 짧은 장면들로 이어진다.
- 모든 장이 공용 화면과 원본 용사 아트를 쓰며, 장별 합성 BGM·음소거·모션 감소를 지원한다.
- 진행과 메모는 자동 저장한다. 개편 전 2장 이후 기록은 별도 복구 자료로 보존하고 완료·해금 상태는 유지한다. 다중 창 충돌은 멈춰 알린다.
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

브라우저 검사는 별도 터미널에서 `npm run dev`를 실행한 상태에서 수행한다. Chapter 1 UI 검사는 테스트 전용 엔트리에서 실제 App과 공용 컴포넌트를 실행한다. 후속 장은 `test:campaign:shared`로 실제 QA 화면의 누적 메모·부활·재생·삭제 비용을 검사한다. `test:campaign:scenes`는 54개 장면 배치를 검사한다. 폐기된 콘텐츠 평가와 실제 API 정확도는 별도 범위다.

| 명령 | 범위 | 실제 API / 선행 조건 |
| --- | --- | --- |
| `npm run test:ui` | 가독성·우선순위 표시·장면별 재생 | 합성 저장 fixture, API 키 불필요 |
| `npm run test:drag` | 데스크톱·모바일 메모 순서 변경 | 합성 저장 fixture, API 키 불필요 |
| `npm run test:priority` | 우선순위·동일 조건 충돌 거부 | 합성 저장·해석 응답, API 키 불필요 |
| `npm run test:chronicle` | 연혁·장면 재생·완료 기록 보관 | 합성 저장 fixture, API 키 불필요 |
| `npm run test:browser` | 구 프롤로그 원형 검사 | 실제 Jev, 서버 키 필요·호출 비용 발생 |
| `npm run test:errors` | 통신·저장 오류, IME, 늦은 응답 | 합성 응답, 실제 API 호출 없음 |
| `npm run test:priority:live` | 우선순위·실제 해석 결과의 충돌 | 실제 Jev 호출 |
| `npm run test:notebook` | 삭제 비용·공유·설정 | 결정적 코어 fixture, 외부 artifact 불필요 |
| `npm run test:guards` | HTTP 입력 가드 | 실제 Jev 호출 |
| `npm run eval:campaign -- --repeat=3` | 캠페인 의미·조건·협동·물리·지연 평가 | 실제 DeepSeek, `.env.local` 필요·호출 비용 발생 |
| `npm run test:campaign:shared` | Enter·메모 누적·입구 부활·한 장면씩 재생·삭제 비용·모바일 | provider fixture, 실제 실행기·QA 저장 |
| `pnpm exec tsx scripts/browser-quiet-scenes.ts` | 새 후속 54장면·고정 화면·장별 모바일·내부 패널 제거 | 실제 API 호출 없음 |
| `pnpm exec tsx scripts/browser-legacy-onboarding.ts` | 서사 SKIP·1장 도입4개·본편 인계 | provider stub, 실제 UI·저장 |
| `pnpm exec tsx --env-file=.env.local scripts/evaluate-quiet-live.ts --all` | 새 54장면 대표 의도 실제 해석+실행 | DeepSeek 최대54회, 자동 재시도 없음 |
| `npx tsx --env-file=.env.local scripts/evaluate-shared-live.ts` | Jev 및 DeepSeek 재사용 규칙·대기·협동 smoke | 최대 4회, `--only=02-v2-1`으로 1건 지정 가능 |
| `npm run eval:jev` | 고정 한국어 합성 문장·상황 평가 | 실제 Jev, `.env.local` 필요·호출 비용 발생 |

`test:ui`, `test:drag`, `test:priority`, `test:notebook`, `test:chronicle`은 `scripts/browser-fixtures.ts`로 검사 데이터를 만들어 과거 `artifacts/` 파일 없이 실행한다. 합성 해석은 자동화 검사에만 사용하며 실제 플레이의 해석 경로에는 포함되지 않는다. 이 검사 성공은 Jev의 실제 해석 정확도 검증과 구분한다.

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

`pnpm dev` 후 `http://localhost:5173/?qa=1`을 열면 클리어 없이 구현된 장에 바로 입장할 수 있습니다. 프롤로그와 1~10장, 후속 장의 개별 스테이지를 모두 선택할 수 있습니다. QA 메모·진행은 `one-line-per-death:qa:shared-v1`에 별도 저장하며 일반 캠페인/연혁을 변경하지 않습니다. “새 QA 시작”은 해당 QA 슬롯만 초기화합니다. 일반 플레이는 `/`로 돌아갑니다. 개발 서버의 localhost에서만 열리고, AI 해석은 실제 API를 사용합니다.

### 장과 스테이지의 화면

한 장 안에서 여러 스테이지를 차례로 진행합니다(예: 4-1~4-6). 메모장·입력창·재생 시계·대사·점수·기록은 1장의 코드를 공용 모듈로 추출해 함께 사용합니다. 맵과 행동 판정은 장별 어댑터입니다. 목적은 한 문장으로 안내하고, 한 화면의 물체·움직임으로 관계를 보여 줍니다. 내부 수치와 접힌 상세 성질 패널은 표시하지 않습니다. [모듈별 책임](docs/campaign-implementation.md)을 참고하세요.
