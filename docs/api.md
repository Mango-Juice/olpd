# AI 해석 API

현재 캠페인의 동작·요청 한도는 `server/campaign-http.ts`, `server/campaign-service.ts`, `server/campaign-deepseek.ts`, `server/provider-http.ts`를 따른다. API 키와 공급자 응답은 브라우저에 전달하지 않는다. 서버는 클라이언트가 보낸 관찰 세계를 저장하거나 게임의 물리 결과를 대신 판정하지 않는다.

## `POST /api/campaign-interpret`

2~10장의 입력 경로다. 서버는 stage catalog와 대조해 세계 관찰을 검증하고 콘텐츠에서 이름·설명·공개 종류 등 신뢰할 필드를 복원한 뒤, 공개된 정보만 공급자에게 전달한다. DeepSeek는 기본 `deepseek-flash` 모델을 사용하며 기본 thinking 설정은 `disabled`다. 해석은 JSON 구조화 행동 프로그램(`InstructionProgram`)을 만들고, 프로그램 AST·참조·바인딩을 서버가 검증한다. 물리와 성공 여부는 로컬 실행기가 판정한다.

요청 본문은 정확히 여섯 필드를 포함한다.

| 필드 | 형식과 의미 |
| --- | --- |
| `text` | 지침 문자열, 제어 문자 제외 1~500 Unicode code point |
| `stageId` | 1~10 사이 장 ID |
| `runId` | 비어 있지 않은 실행 ID |
| `revision` | 0 이상의 정수 revision |
| `attempt` | 1 이상의 정수 시도 번호 |
| `world` | 현재 장면의 `WorldState` 스냅샷 |

서버는 stage, run, revision, attempt 형식과 장면 catalog를 확인하고, 현재 시도와 맞지 않는 오래된 관찰 fact를 제거한다. 전체 HTTP 요청 본문은 최대 256 KiB이며, 초과 시 413으로 거절한다.

성공 응답은 구조화 프로그램과 보조 메타데이터를 담는다.

```json
{
  "program": {
    "version": 2,
    "id": "deepseek-example",
    "model": "deepseek-flash",
    "text": "모든 방에서 상자를 밀어",
    "scope": { "stageId": 2 },
    "bindings": { "crate-1": { "kind": "public-kind", "value": "crate" } },
    "guard": false,
    "body": { "kind": "action", "actor": "hero", "verb": "push", "target": "crate-1" }
  },
  "confidence": null,
  "needsConfirmation": false,
  "sourceSpans": { "actions": [], "condition": null }
}
```

프로그램 body는 허용된 행동·조건·순서·병렬·대기 노드로 제한된다. 장 범위 규칙은 화면에서 확인된 `publicKind` binding을 포함해야 한다. 런타임은 메모가 적용될 때 공개 종류가 정확히 하나의 보이는 물체와 일치하는 경우에만 ID를 해석하며, AI를 다시 호출하지 않는다. 모호하거나 지원할 수 없는 입력은 프로그램으로 추측하지 않고 clarification/error로 반환한다.

서버는 요청당 제공자 호출을 최대 한 번 수행한다. 자동 재시도나 모델 교체는 없다. 직렬화한 DeepSeek 요청도 256 KiB를 넘으면 전송하지 않는다. DeepSeek 제공자 요청은 8초 제한을 받고, 제공자 응답은 최대 128 KiB까지 읽는다. 사용자가 진행을 취소하거나 클라이언트 연결이 닫히면 AbortSignal로 공급자 요청을 중단한다. 해석 실패·취소·시간 초과는 작성 기회와 저장된 메모를 소모하지 않는다.

## 로컬 QA 경로

개발 서버에서 `http://localhost:5173/?qa=1`로 연 로컬 QA는 같은 요청 계약을 `POST /api/qa/campaign-interpret`로 보낸다. 이 라우트는 서버에 loopback으로 접속한 요청만 허용하며, 실제 API를 사용한다. 프런트엔드의 QA 저장은 `one-line-per-death:qa:shared-v1` localStorage 슬롯에 따로 보관되며 일반 캠페인 IndexedDB 기록과 분리된다. 운영 배포에는 이 QA 라우트가 없다.

## 오류 응답

오류는 `{ "error": { "code", "message", "retryable" } }` 형태다. 입력·세계 검증 오류는 400/413, 지원 불가한 장면 정보나 입력은 422, 제한 초과는 429, 제공자 형식/응답 오류는 502, 비활성·설정 누락·시간 초과·취소·연결 실패는 503으로 반환한다. 취소와 시간 초과 응답은 재시도 가능 표시를 가질 수 있지만 서버가 자동 재시도하지 않는다.

`AI_ENABLED=false`이면 새 해석 요청을 중단한다. 로그에는 모델, 규칙 버전, 토큰, 지연, 오류 코드만 기록하며 지침 원문, API 키, IP는 남기지 않는다.

## 프롤로그·1장 API

`POST /api/interpret`는 기존 프롤로그·1장의 Jev 해석 경로다. 입력 제한은 2 KiB, 텍스트는 1~80자, 서버 요청 제한 시간은 15초다. 성공은 `Interpretation` 타입의 행동과 적용 상황을 반환하며 메모 저장·충돌 판정은 클라이언트 게임 코어가 수행한다. 이 경로는 현재 캠페인용 `InstructionProgram` 계약과 다르다.

요청은 `text`, `dungeonVersion`, `rulesVersion` 세 필드만 받으며 두 버전은 모두 `"1"`이다. 저장 직전 코어가 기존 메모와 비교해 적용 상황 전체가 같고 행동이 다른 문장을 거절한다. 입력 초안과 작성 기회는 보존한다.

## `GET /api/status`

`aiEnabled`, Jev 키의 설정 여부인 `configured`, 두 값을 합친 `ready`, Jev 모델·규칙 버전과 프로세스 단위 집계 지표를 반환한다. 이 `ready`는 DeepSeek 설정 여부를 검사하지 않는다. 지표는 호출 수·토큰·지연·오류 수를 집계하며 서버리스 인스턴스 전체를 합산한 값은 아니다.

## 제한 운영 경계

서버 측 IP별 분당 30회 제한은 단일 Node 프로세스/서버리스 인스턴스에 적용된다. 여러 인스턴스에 걸친 전역 제한이 아니다. 배포 환경의 Vercel WAF는 `/api/interpret` 경로를 별도 제한한다. 운영 상태와 공개 URL은 [검증 기록](verification.md)에서 날짜별로 확인한다. 로컬 검사나 과거 배포 기록만으로 현재 배포 상태를 주장하지 않는다.
