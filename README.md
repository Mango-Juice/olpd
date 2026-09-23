# 죽을 때마다 한 줄 · One Line Per Death

메모의 실행·반복·우선순위는 [공통 메모 수칙](docs/game-rules.md)을 기준으로 한다. 조건이 맞는 첫 수칙을 매 행동마다 다시 선택하며, 실행 완료로 메모를 소모하지 않는다.

**서비스 주소: https://olpd.vercel.app**

2026-09-23 운영 배포: 1장을 여섯 장면으로 통합한 10장·60스테이지를 반영했다. 기존 저장은 이전 경로를 보존한다. 공개 주소의 새 1장 진입·재시작 확인과 로컬 전체 플레이 검사는 [배포·검증 기록](docs/verification.md)에 구분해 기록했다.

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

- 서사 프롤로그는 읽거나 SKIP할 수 있다. 어느 쪽이든 1-1에서 시작한다. 1~10장 각 6장면, 총 60스테이지를 진행한다.
- 2장 이후는 한 화면에 2~4개 요소만 둔다. 1장과 같이 메모를 누적하고, 죽은 뒤 한 줄을 더 써 장 입구부터 다시 시작한다. 지우개 두 개 이후 삭제는 한 줄당 3데스다. 내부 수치나 물체 설명표는 표시하지 않는다.
- 1장은 첫 입력부터 같은 메모장으로 여섯 장면을 잇는다. 별도 네 단계 도입이나 중간 메모 초기화는 없다. 다음 장은 앞 장을 완료해야 열린다.
- 물건·주체·순서·조건을 자연어로 적고 Enter로 바로 실행한다. 모델은 지침만 해석하고 물리와 성공은 코드가 결정한다.
- 메모는 매 행동마다 위쪽부터 다시 검사하며, 조건이 맞는 첫 수칙을 실행한다. 실행해도 수칙은 소모되지 않는다. 맞는 수칙이 없으면 제자리에서 멈춘다. 계속 걷게 하려면 전진 지시를 남겨야 하며, 시스템이 이동·상호작용·역할을 대신 결정하지 않는다.
- 관찰은 같은 화면의 윤곽과 움직임을 드러낸다. 10장의 세 봉인과 편지 이야기는 짧은 장면들로 이어진다.
- 모든 장이 공용 화면과 원본 용사 아트를 쓰며, 장별 합성 BGM·음소거·모션 감소를 지원한다.
- 진행과 메모는 자동 저장한다. 개편 전 2장 이후 기록은 별도 복구 자료로 보존하고 완료·해금 상태는 유지한다. 다중 창 충돌은 멈춰 알린다.
- 1장의 기존 진행 저장(`layoutVersion` 없음/1)은 옛 도입과 8방 경로로 계속한다. 새 시작·초기화는 6장면(`layoutVersion: 2`)을 사용하고, 완료 보관함의 옛 번호는 유지한다.
- 로컬 QA: **http://localhost:5173/?qa=1**. 장과 개별 스테이지를 바로 선택하며 일반 진행과 따로 저장한다.

## 모험 연혁

클리어 화면의 **우리의 모험 돌아보기**에서 생별 메모 작성·삭제·우선순위 변경·부활·행동 결과를 확인한다. 반복해서 통과한 장면은 접혀 있고, 각 장면을 점수나 진행에 영향 없이 다시 볼 수 있다. 완료한 여정은 별도 IndexedDB 보관함에 한 번 저장하며, 새 도전 이후에도 화면 아래 **지난 모험 기록**에서 연다. 이전 저장 파일은 행동 기록을 복원하고 누락된 메모 변경 이력을 안내한다. 보관 실패 시 현재 클리어 기록을 덮어쓰지 않고 재시도·내보내기를 제공한다.

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
| `npm run test:notebook` / `test:chronicle` | 삭제 비용·공유·설정·연대기·보관 | 호출 없음 |
| `npm run test:errors` | 통신·저장 오류, IME, 늦은 응답 | 호출 없음 |
| `npm run test:campaign:scenes` | 후속 54장면 고정 화면과 모바일 폭 | 호출 없음 |
| `npm run test:campaign:recovery` | 옛 저장 원본·해금 보존과 새 형식 재개 | 호출 없음 |
| `npm run eval:campaign -- --ids=02-v2-1` | 지정한 현재 장면의 한국어 해석·실행 | DeepSeek, 장면당 1회. `--all`은 최대 54회 |
| `npm run eval:campaign:smoke` | Jev와 DeepSeek의 조건·재사용·대기·협동 표본 | 최대 4회. `--only=02-v2-1`로 1건 지정 가능 |
| `npm run eval:jev` | 1장 한국어 행동·상황 평가 | 실제 Jev 호출 |
| `npm run test:priority:live` / `test:guards` | 실제 API의 우선순위/입력 경계 | 실제 Jev 호출 |

`test:onboarding`은 새 1장 6장면 완료·2장 해금·메모 유지·재접속 검사, `test:onboarding:legacy`는 기존 도입 저장의 이어하기 검사, `test:campaign:shared`는 후속 장 공용 UI 검사만 따로 실행한다. 자동화 성공은 실제 모델 정확도나 사람의 체감 난이도와 구분한다. 브라우저 fixture는 실제 플레이의 AI 경로에 포함되지 않는다.

`artifacts/`는 Git에서 제외되는 로컬 결과 폴더다. 이전 콘텐츠용 실행 스크립트는 제거했으며, 당시 실험과 검증 수치는 [과거 기록 안내](docs/history/README.md)에서 구분한다. `npm run preview`는 빌드된 정적 화면만 제공하고 Node API는 띄우지 않는다.

## 구조

- `src/campaign/spatial/`: 2~10장 선언형 배치·공용 이동/충돌/장치 실행기
- `src/game/`: 버전·관찰·방, 순수 판정과 원자적 비용 처리, 저장 검증, 연혁·보관함·오디오
- `src/render/`, `src/components/DungeonCanvas.tsx`: 원본 그래픽과 프레임 단위 재생
- `src/App.tsx`: 입력/확정, 메모장, 튜토리얼, 결과·공유, 저장/UI 상태
- `src/components/StageChronicle.tsx`: 생별 연혁과 독립 장면 재생
- `server/`, `api/`: 요청 검증, Jev, 제한, Vercel Node API
- `scripts/evaluate.ts`: 고정 한국어 합성 문장 및 상황 평가
- `docs/`: 아트 출처, API, 평가 결과, 요구사항/검증 맵

게임 코어는 판단 지점에서 생사·비용을 먼저 확정하고 저장한다. Canvas는 확정된 이벤트를 재생한다. 프레임 속도는 판정에 영향을 주지 않는다.

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

현재 개발 브랜치는 `main`이다. 기능·수정·문서처럼 목적이 다른 변경은 별도 커밋으로 남긴다. 커밋 전에 `git diff --check`와 변경 범위에 맞는 검사를 실행하고, `git diff --cached`로 포함할 파일을 확인한다.

`.env.local`, `.vercel/`, `node_modules/`, `dist/`, `artifacts/`는 추적하지 않는다. 로컬 커밋은 원격 push나 Vercel 배포를 수행하지 않는다.

캠페인 DeepSeek의 적용 범위와 실측은 [DeepSeek 평가](docs/campaign-deepseek-probe.md), 전체 스테이지의 미완료 범위는 [캠페인 구현 기록](docs/campaign-implementation.md)을 참고한다. 로컬 검증과 공개 배포 상태는 구분한다.

### 로컬 QA 모드

`pnpm dev` 후 `http://localhost:5173/?qa=1`을 열면 클리어 없이 구현된 장에 바로 입장할 수 있습니다. 프롤로그와 1~10장, 후속 장의 개별 스테이지를 모두 선택할 수 있습니다. QA 메모·진행은 `one-line-per-death:qa:spatial-v1`에 별도 저장하며 일반 캠페인/연혁을 변경하지 않습니다. “새 QA 시작”은 해당 QA 슬롯만 초기화합니다. 일반 플레이는 `/`로 돌아갑니다. 개발 서버의 localhost에서만 열리고, AI 해석은 실제 API를 사용합니다.

### 장과 스테이지의 화면

한 장 안에서 여러 스테이지를 차례로 진행합니다(예: 4-1~4-6). 메모장·입력창·재생 시계·대사·점수·기록은 1장의 코드를 공용 모듈로 추출해 함께 사용합니다. 맵과 행동 판정은 장별 어댑터입니다. 목적은 한 문장으로 안내하고, 한 화면의 물체·움직임으로 관계를 보여 줍니다. 내부 수치와 접힌 상세 성질 패널은 표시하지 않습니다. [공간 실행기](docs/spatial-implementation.md)를 참고하세요.

## Canvas 성능

공용 재생 루프는 일시정지·탭 숨김 중 반복 그리기를 멈춘다. 정지 중 설정·크기·이미지가 바뀌면 필요한 한 프레임을 다시 그린다. 고정 배경은 해상도에 맞게 캐시하고, 캠페인의 변하지 않은 배치를 재사용한다. 캐릭터·덩굴 애니메이션과 판정 규칙은 유지한다. 배경 캐시의 원시 픽셀 크기는 캔버스당 최대 20 MiB이며, 조건을 벗어나면 직접 그린다.

개발 서버에서 `npm run test:canvas`로 정지·재개·크기 변경·숨김 이벤트·화면 이탈을 검사한다. 로컬 성능 실측과 실제 기기 검증의 한계는 [검증 기록](docs/verification.md)에 기록한다.
