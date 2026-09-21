# AI 해석 API

## `POST /api/interpret`

같은 출처의 서버가 TypeSafe Jev를 호출한다. 클라이언트에는 API 키와 서버 프롬프트가 전달되지 않는다. 화면과 판정에 필요한 관찰 데이터는 클라이언트에도 있다.

API의 성공은 문장 해석 성공을 뜻하며 메모 저장까지 보장하지 않는다. 저장 직전 `core.addInstruction`이 현재 메모와 비교한다. `appliesTo` 전체 집합이 같고 `action`이 다르면 충돌을 거절하고 초안·작성 기회·비용을 보존한다. 일부 상황만 겹치거나 같은 행동이면 허용한다. 기존 메모 원문을 서버로 전송하지 않으며, 수동 우선순위 변경과 기존 저장 데이터는 이 검사 때문에 무효화하지 않는다.

```json
{ "text": "구덩이가 보이면 뛰어", "dungeonVersion": "1", "rulesVersion": "1" }
```

성공 응답은 게임의 `Interpretation` 타입과 같다.

```json
{
  "action": "jump",
  "appliesTo": ["pit", "bridge", "pitCeilingPath"],
  "uncertainty": 0.23,
  "model": "jev-1.13.0",
  "rulesVersion": "1"
}
```

본문은 2 KiB 이하이며 필드는 정확히 세 개여야 한다. `text`는 앞뒤 공백을 제외한 Unicode 코드 포인트 1~80자, 두 버전은 모두 현재 값 `1`이어야 한다. 서버는 15초 후 호출을 중단한다.

오류 응답은 `{ "error": { "code", "message", "retryable" } }` 형태다.

| code | HTTP | 의미 |
|---|---:|---|
| `input` | 400/413 | 본문, 길이, 필드 또는 버전 오류 |
| `unsupported` | 422 | 지원하지 않는 행동 또는 한 줄에 여러 행동 |
| `uncertain` | 422 | 보정 임계값 아래의 행동/적용 상황 판정 |
| `rate_limited` | 429 | 앱 또는 TypeSafe 요청 제한 |
| `provider` | 502 | TypeSafe가 오류/잘못된 응답을 반환함 |
| `unavailable` | 503 | 비활성화, 미설정, 연결 실패, 시간 초과, 공급자 과부하 |

## `GET /api/status`

`aiEnabled`, `configured`, 둘을 합친 `ready`, 공급자/고정 모델/스키마 버전과 프로세스 단위 집계 지표를 반환한다. 지표는 호출 수, 입력·출력 토큰, 총·평균 지연, 코드별 오류 수만 포함하며 지침 원문이나 키는 기록하지 않는다. `AI_ENABLED=false`는 새 AI 호출을 중단한다.

서버는 각 Jev 호출과 API 오류를 구조화된 한 줄 JSON으로 남긴다. 필드는 모델, 규칙 버전, 토큰, 지연, 오류 코드뿐이며 지침 원문·키·IP는 포함하지 않는다. 서버리스 인스턴스별 `/api/status` 누계는 운영 전체 집계가 아니므로, 배포 후 호출량·비용·오류 확인에는 Vercel Runtime Logs의 `jev_call`/`interpret_error` 이벤트를 사용한다.

## 요청 제한의 운영 경계

서버 코드의 IP별 분당 30회 제한은 단일 Node 프로세스/서버리스 인스턴스 안에서만 정확하다. 메모리 카디널리티는 5,000개로 제한하며 가득 차면 새 IP를 보수적으로 거부한다. 여러 Vercel 인스턴스에 걸친 전역 제한으로 간주하면 안 된다. 배포의 Vercel WAF도 `/api/interpret` 정확 경로에 IP별 분당 30회를 적용하지만 리전별 집행 경계가 있으므로 전 세계 단일 원자 카운터는 아니다. 그 수준이 필요하면 Redis 같은 공유 저장소를 사용해야 한다.

## 로컬 실행

`.env.local`에 `TYPESAFE_API_KEY`를 넣고 `npm run dev`를 실행한다. `server/dev.ts`가 Node의 `loadEnvFile`로 파일을 읽고 Vite와 API를 같은 `http://localhost:5173` 출처에서 제공한다.
