# 캠페인 Jev 합성 추출 프로브 — 2026-09-22

> 당시 코드와 실험 판단을 보존한 기록입니다. 현재 구현 기준은 [캠페인 구현 기록](campaign-implementation.md)입니다.

## 최종 상태 — 사용자 조건에 따른 중단

**현재 Jev 기반 경로로 필수 2장 자유 입력 요구를 충족하지 못해 추가 구현과 goal을 중단한다.** 아래 초기 프로브의 성공 및 당시 중단 보류 판단은 과거 기록이다. 최신 판단은 이 절과 [구현 상태](campaign-implementation.md)를 우선한다.

독립 감사로 확인한 결함을 교정했다. 최종 동사 확정 뒤 역할 질문을 생성하고, 역할의 `presence`와 `meaning`을 분리해 source/entity/joint에서 일관되게 참조한다. 행동 anchor는 Noul ≥ .5인 토큰만 선택하며 행동 수 추정 때문에 낮은 확률 단어를 강제 추가하지 않는다. 동사·역할 단계에 공개 세계와 actor의 위치·탑승 상태를 전달한다. optional=false의 독립 답은 버린다. `action_count=unclear`는 여전히 즉시 명료화를 요청한다.

교정 후 동일한 고정 8사례를 실제 Jev 1.13.0으로 재평가했다. 의미 보존과 물리 실행을 모두 만족한 결과는 **2/8**이다.

| 사례 | 교정 후 결과 |
| --- | --- |
| 상자를 띄우고 타고 내리는 도입 원문 | 목적지를 상자 자신으로 선택하여 무료 거절 |
| 같은 도입의 풀어쓴 표현 | 목적지 역할 충돌로 무료 거절 |
| 상자 위에 올라 | 의미·물리 성공 |
| 상자에서 맞은편 발판으로 내려 | 의미·물리 성공 |
| 떠 있는 통에 물 두 칸 붓기 | source/destination 모두 대야로 선택, 무료 거절 |
| 통에 물 두 칸 붓기 | 동일 오류 |
| 통에 물 세 칸 붓기 | 동일 오류, 수량 3 자체는 정확 |
| 통에 물 2칸 붓기 | 동일 오류, 수량 2 자체는 정확 |

물 붓기 네 사례의 잘못된 destination 대야 confidence는 .69~.81이었다. 따라서 단순히 confidence 기준을 낮추거나 충돌 검사를 제거해서 해결할 수 없다. 단일 행동 일부의 성공은 인정하지만, 필수 관계·연속 지시를 충족하지 못하는 현재 경로를 완성된 장으로 취급하지 않는다. 이는 Jev의 보편적 불가능 증명이 아닌 현재 요구사항에 대한 실용적 중단 판단이다. 다른 provider, 키워드 파서, 고정 해법으로 우회하지 않았다.

증거는 로컬 ignored artifacts에 보존한다. 모두 설계용 공개 fixture이며 실제 사용자 입력을 수집한 기록이 아니다.

- `artifacts/campaign-jev-v4/cohort.json`: 교정 전 1/8, 실제 응답 26회, 입력 192,075 / 출력 36,931 토큰.
- `artifacts/campaign-jev-v4-corrected/cohort.json`: 교정 후 2/8, 실제 응답 26회, 입력 199,327 / 출력 33,339 토큰. 역할 단계에서 거절된 사례는 joint 호출 전 중단되어 계획상 최대 32회보다 적다.
- state/questions/answers 및 정확한 rejection field를 보존하며 비밀 header/API key는 trace에 포함하지 않는다.
- 중단 직전 전체 `pnpm test`: 32파일 300개 통과. `pnpm build`: 타입 검사·빌드 통과. 이는 mock/typed 검증이며 위 실제 Jev 실패를 덮지 않는다.

## 결론

Jev 1.13.0은 자유로운 한국어 한 줄에서 **행동 수, 순차/동시 관계, 명시 조건, `hold`와 1회 `pull`의 의미 차이**를 typed `Choice`/`Noul`로 판정할 수 있었다. 원문 토큰의 행동·조건 서술어를 1차로 고르고, 그 anchor별로 2차 해석하면 비연속 행위자, 대상 참조, canonical 엔티티 ID, 조건 predicate, 명시 도구까지 복구할 수 있었다.

한 요청에서 `action_1`, `action_2`, `action_3`을 독립 질문으로 동시에 물은 방식은 슬롯 정렬에 실패했다. 이후 실제 2단계 방식은 필수 5문장과 도구 문장 중 4개의 전체 AST 후보를 의미상 정확하게 만들었고, 나머지 2개도 핵심 행동은 맞았지만 optional `destination`을 잘못 채웠다. 따라서 **Jev를 전혀 활용할 수 없는 한계에는 도달하지 않았다.** 다만 자동 실행은 optional 역할 confidence, 역할 충돌, source coverage gate를 통과한 경우로 제한하고 나머지는 preview/사용자 확인으로 보내야 한다.

## 프로브 구조

당시 실행 파일은 `scripts/probe-campaign-jev.ts`였다. 실험 실행 기록이며 현재 저장소의 코드 경로는 아니다.

- 공백 기준 토큰에 문자 오프셋을 붙이고, 최대 6토큰의 모든 연속 span을 코드에서 만든다.
- 행동절, 명시 행위자, 대상, 목적지, 조건절, 조건 주어와 기준값은 span ID를 선택지로 둔 `Choice`가 고른다. 선택 후 원문 문자열은 코드가 그대로 복사한다.
- 행동 수, AST `Verb`, 배우(`hero | keeper`), 합성 관계, 지속 방식, 조건 속성과 비교 연산은 닫힌 `Choice`다.
- 조건/동시성 존재 여부는 `Noul`이다.
- 코드는 선택 결과를 `PhysicalAction`, `sequence`, `parallel`, `if`, `Predicate`로 조립한다. 모든 `EntityId`는 공개 `visible_entities` catalog의 닫힌 `Choice`에서만 가져오며, 원문 source span을 함께 보존한다.
- 키워드 fallback, 생성형 JSON 파싱, 고정 해답 ID, 퍼즐 해결 로직은 없다.
- `.env.local`에서는 `TYPESAFE_API_KEY` 한 항목만 읽는다. 키와 다른 환경 변수는 출력하지 않는다. 각 HTTP 호출은 30초 후 중단된다.

최종 프로브는 의미 결과와 자동 실행 판단을 분리한다. anchor probability나 typed field confidence가 기준보다 낮거나, 행동절이 anchor를 포함하지 않거나, 필수 source가 없거나, target/destination/instrument 역할이 충돌하거나, 조건이 불완전하면 `program`을 비운다. 의미 분석용 조립 결과는 `candidateProgram`에 남긴다. 독립 speculative 질문에서 entity가 `NONE`으로 확정된 역할의 source 답은 unused branch로 버린다.

이 구성은 라이브 문서의 다음 계약을 따른다.

- [`Choice`](https://docs.typesafe.ai/primitives/choice): 정의된 후보 하나와 전체 확률분포를 반환하며 최대 255개 선택지를 받는다.
- [`Noul`](https://docs.typesafe.ai/primitives/noul): yes 확률 하나를 반환한다.
- [State](https://docs.typesafe.ai/concepts/state): 한 요청의 모든 질문은 같은 state를 보지만 서로의 답은 보지 못한다.
- [Pre-parsed value extraction](https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook): 코드는 후보를 만들고 모델은 의미에 맞는 원문 후보를 선택한다.
- [API](https://docs.typesafe.ai/api)와 [Models](https://docs.typesafe.ai/models): `POST /v1/systemone`, `jev-1.13.0`, 입력 토큰 과금, CJK 정확도는 영어보다 낮으므로 대상 데이터 평가가 필요하다.

## 1차 단일 요청 실험

실제 API 요청 10회로 단일 fan-out을 먼저 검사했다. 첫 5회에서 슬롯 중복을 관찰한 뒤, 순번을 “행동 서술어의 원문 위치”로 명확히 하고 목적지의 `NONE` 기준을 강화해 같은 5문장을 한 번씩만 재실행했다.

| 실행 | 요청 | 입력 토큰 | 출력 토큰 | 합계 지연 |
| --- | ---: | ---: | ---: | ---: |
| 최초 | 5 | 127,497 | 35,028 | 3,256ms |
| 조정 후 | 5 | 132,702 | 34,995 | 3,118ms |
| 합계 | 10 | 260,199 | 70,023 | 6,374ms |

조정 후 5회의 평균 종단 지연은 624ms, 범위는 282–1,007ms였다. 라이브 문서의 $0.042/M 입력 토큰, 출력 무료 가격을 적용한 10회 추정 비용은 약 **$0.0109**다. 지연은 이 실행 환경에서 관찰한 값이며 서비스 보장이 아니다.

### 조정 후 사례별 관찰

| 입력 | 맞은 판정과 원문 근거 | 실패 또는 한계 | gate |
| --- | --- | --- | --- |
| `빈 코르크 상자를 물에 띄우고 그 위에 올라 건너편 발판에서 내려` | 행동 3개 0.87, sequence 0.95. 1번 `place` 0.99, 대상 `[0,9)`과 목적지 `물에`; 2번 `board` 0.88, 대상 `그 위에`. | 3번 `내려`를 `dismount`가 아니라 `board` 0.73으로 판정. | 거절: `low_verb_confidence` |
| `인형이 왼쪽 발판을 누르는 동안 나는 문을 건너` | 행동 2개 0.99, parallel 0.86, P(parallel)=0.95. 배우 선택은 keeper/hero, 동사는 hold 0.82 / move 0.95. | 1번 절과 대상을 `나는 문을 건너`/`문을`로 골라 2번 절과 중복. typed 답들이 서로 모순된다. | 거절: `duplicate_action_clause` |
| `수위가 위 눈금에 닿으면 수문을 닫아` | 행동 1개 0.95, P(condition)=0.97. 조건 `[0,13)`=`수위가 위 눈금에 닿으면`, 주어 `수위가`, 값 `위 눈금에`, `level`/`reaches_or_above`; 행동 `[14,20)`=`수문을 닫아`, `close` 0.88, 대상 `수문을`. | normalized actor는 암시된 hero였지만 actor source 질문은 잘못 `수위가`를 골랐다. 실제 물 엔티티와 `level` 속성 연결도 미검증이다. | 거절: `actor_source_outside_action_clause` |
| `인형은 내가 문을 건너는 동안 레버를 당긴 채 있어` | 행동 2개 0.90, parallel 0.70, P(parallel)=0.92. `당긴 채 있어`를 `hold`, duration=`sustained`로 판정. | 두 슬롯이 모두 레버 절을 선택하고 첫 actor도 잘못 연결. hold confidence 0.55/0.65. | 거절: 낮은 confidence, 중복, 낮은 composition confidence |
| `인형은 내가 문을 건너는 동안 레버를 한 번 당겨` | 행동 2개 0.98, P(parallel)=0.88. 레버 동작의 두 번째 슬롯은 `pull` 0.93, duration=`once`. | 두 슬롯이 모두 레버 절을 선택하고 composition confidence 0.57. | 거절: 낮은 confidence, 중복, 낮은 composition confidence |

원시 응답의 비밀정보를 제외한 핵심 형태는 다음과 같다.

```json
{
  "event-condition": {
    "action": { "actor": "hero", "verb": "close", "targetSpan": [14, 17] },
    "condition": {
      "clauseSpan": [0, 13],
      "subjectSpan": [0, 3],
      "valueSpan": [4, 9],
      "property": "level",
      "comparison": "reaches_or_above"
    }
  },
  "minimal-pair": {
    "당긴 채 있어": { "verb": "hold", "duration": "sustained" },
    "한 번 당겨": { "verb": "pull", "duration": "once" }
  }
}
```

최소 대조쌍은 **의미 필드 수준에서는 구별되었다.** 다만 절-배우-대상의 슬롯 결합이 깨졌으므로 두 문장 전체를 실행 가능한 AST로 검증했다는 뜻은 아니다.

## 실제 2단계 실험

최종 프로브는 고정 `action_1/2/3` 슬롯을 제거했다.

1. 1차 요청은 각 원문 토큰에 `action_anchor`/`condition_anchor` Noul을 붙이고, 행동 수만큼 확률 상위 anchor를 원문 순서로 선택한다. action count, composition, condition, parallel도 함께 판정한다.
2. 2차 요청은 선택된 각 anchor를 이름 붙은 state로 전달한다. 각 질문은 anchor 하나에만 묶여 행동절, 비연속 행위자 span, actor, verb, duration, target/destination/instrument span과 canonical entity ID를 고른다.
3. 코드는 typed 답을 `PhysicalAction`, `sequence`, `parallel`, `if`, `Predicate`로 조립한다. `hasParallel` Noul은 낮은-confidence composition Choice를 보완하지만, 의미가 충돌하면 거절한다.

공개 fixture catalog에는 `cork_box`, `water`, `far_platform`, `left_plate`, `door`, `sluice_gate`, `upper_mark`, `lever`, `long_rope`, `boat`, `anchor_ring`만 넣었다. 모델은 이 ID 중 하나만 선택할 수 있고, 코드가 문장별 정답 ID를 지정하지 않는다.

### 호출량

2단계 본 실행은 6문장×2회인 12요청이었다. 이후 전체 결과에서 드러난 일반 문제를 반영해 optional source는 선택된 entity가 `NONE`일 때 버리고, role collision과 낮은-confidence optional entity를 차단하고, duration 기준을 명확히 했다. 남은 한도에서 조건 문장과 1회 pull 문장을 각 2회 재검증했다.

| 실행 | 요청 | 입력 토큰 | 출력 토큰 | 합계 지연 |
| --- | ---: | ---: | ---: | ---: |
| 2단계 6문장 | 12 | 160,893 | 33,158 | 5,721ms |
| 조건 재검증 | 2 | 17,990 | 3,268 | 1,418ms |
| 1회 pull 재검증 | 2 | 28,951 | 5,976 | 1,579ms |
| 2단계 합계 | 16 | 207,834 | 42,402 | 8,718ms |
| 전체 프로브 합계 | 26 | 468,033 | 112,425 | 15,092ms |

문서 가격 $0.042/M 입력 토큰을 적용한 전체 추정 비용은 약 **$0.0197**다. 2단계 6문장 본 실행의 요청당 평균 관찰 지연은 477ms였다.

### 사례별 결과

| 입력 | 1차 anchor/구조 | 2차 의미 결과 | 실행 판단 |
| --- | --- | --- | --- |
| `빈 코르크 상자를 물에 띄우고 그 위에 올라 건너편 발판에서 내려` | `띄우고` .95, `올라` .96, `내려` .96; sequence .98 | `place(cork_box, water)` .92, `board(cork_box)` .91, `dismount(cork_box, far_platform)` .99까지 복구. | board의 destination을 target과 같은 `cork_box` .63으로 중복 선택했다. 최종 role-collision gate에서 거절해야 한다. |
| `인형이 왼쪽 발판을 누르는 동안 나는 문을 건너` | `누르는`/`건너` 각 .94; parallel .93, P(parallel)=.96 | `keeper hold left_plate`와 `hero move door`, 행위자 span `인형이`/`나는`까지 정확했다. | 의미상 전체 AST 성공. `NONE`인 destination의 독립 span 답은 unused branch라 최종 코드가 버린다. |
| `수위가 위 눈금에 닿으면 수문을 닫아` | action `닫아` .95, condition `닿으면` .90 | `if water.level gte upper_mark then hero close sluice_gate`; 조건절 `[0,13)`, action `[14,20)`과 canonical ID가 모두 정확했다. | condition property 선택은 `level`로 정확했지만 confidence .50이라 자동 실행은 거절하고 preview 확인 대상으로 둔다. |
| `인형은 내가 문을 건너는 동안 레버를 당긴 채 있어` | `건너는` .86, `당긴` .92; P(parallel)=.94 | 비연속 주어 `인형은`을 후행 `당긴`에 정확히 연결하고 `hero move door` + `keeper hold lever`; hold .96, sustained .74. | move의 optional destination을 관련 없는 `far_platform` .46으로 골랐다. 핵심 의미는 맞지만 자동 실행은 낮은-confidence destination gate에서 거절한다. |
| `인형은 내가 문을 건너는 동안 레버를 한 번 당겨` | 재검증: `건너는` .72, `당겨` .97; P(parallel)=.92 | `hero move door` + `keeper pull lever`; actor/target span과 canonical ID가 정확하고 duration도 `once`를 선택했다. | duration 선택은 의미상 정확하지만 confidence .46이라 preview 확인 대상으로 둔다. |
| `긴 밧줄로 배를 고리에 묶어` | `묶어` .97; single .97 | `hero tie target=boat destination=anchor_ring instrument=long_rope`; 세 역할과 source span 모두 .99. | 전체 AST 자동 수락 가능. |

2단계는 앞선 fan-out의 실제 실패였던 행동 누락, actor 교차 연결, `내려→board` 오분류를 해결했다. 특히 `인형은 내가 … 동안 레버를 …`의 비연속 주제 범위와 `hold`/`pull` 최소 대조쌍, 그리고 세 번째 논항 `instrument`가 Jev 기반으로 분리됐다.

남은 실패는 Jev가 전체 장 구현에 전혀 쓸 수 없다는 증거가 아니다. 두 오류 모두 optional destination의 존재/부재 판정이었고 낮거나 역할 충돌 confidence로 검출 가능했다. 반면 완전한 절 span은 일부 첫 본 실행에서 서술어만 선택되는 경우가 있어, 최종 스크립트는 절 질문을 “서술어와 명시 논항을 포함”하도록 강화했지만 전체 6문장 재실행은 16요청 한도 때문에 하지 않았다. 개별 actor/target/destination/instrument source span은 별도로 보존된다.

## 제품 권장안

1. 실제 검증한 것처럼 첫 요청에서 행동 수, composition, 조건/동시성, 각 행동/조건 서술어 anchor를 고른다. action count만큼 확률 상위 anchor를 원문 순서로 취하고 최소 probability를 검사한다.
2. 첫 답을 두 번째 요청의 이름 붙은 state로 넣는다. 각 anchor별로 행위자 명시 여부 `Noul`, `actor`, `verb`, `duration`, 대상/목적지/도구 span과 catalog ID를 묻는다. 명시되지 않은 명령 수신자는 코드의 대화 규칙으로 hero를 적용하고 가짜 actor span을 만들지 않는다.
3. 대상, 목적지, 도구는 현재 `WorldState.visible` 엔티티의 이름/별칭을 후보로 둔 `Choice`로 해석한다. 원문 span과 선택한 `EntityId`를 함께 보존한다. 후보에 없거나 confidence가 낮으면 실행하지 않고 사용자에게 구체화를 요청한다.
4. 2차 답의 verb가 정해지면 typed arity로 필요한 역할만 소비한다. `hold`에는 destination/instrument를 사용하지 않고, `board`의 destination이 target과 같은 중복 답이면 별도 목적지 의도가 없는 것으로 canonicalize할 수 있다. 사용자가 말한 서로 다른 destination은 버리지 않는다.
5. optional 역할을 채울 때는 선택한 entity가 그 행동 소유의 source span에 실제로 근거하는지 별도 typed 검증을 한다. `hold lever` branch에 다른 actor의 `far_platform`이 새어 들어온 사례처럼 근거가 어긋나면 거절한다. 필요하면 verb 선택 뒤 작은 3차 요청으로 해당 verb의 유효 인자만 묻는다.
6. 결과에 구조 검사를 적용한다: 절 중복/누락, actor 충돌, span이 원문 밖인지, action count 일치, 조건 필드 완결성, duration과 verb 일치, confidence 임계값. 실패 시 키워드 fallback이나 문장별 고정 패턴으로 억지 실행하지 않는다.

2단계는 라이브 Jev에서 실행했고, 현재 결론은 **조건부 go**다. 자동 실행 coverage를 늘리기 전에 대표 문장 반복 평가로 optional 역할 presence와 clause coverage를 측정해야 한다. confidence가 낮지만 의미가 맞는 조건 property/once duration은 preview에서 확인하게 하고, 틀린 optional destination은 자동 제거하지 말고 거절한다.

현재 런타임에서 `hold`는 상태를 유지하고 명시된 `release`가 있을 때 풀린다. 이 프로브는 사용자가 말하지 않은 release를 만들지 않는다. parallel branch 완료 시 자동 release가 필요하다는 별도 제품 의미를 채택한다면 모델 추출이 아니라 scheduler/AST 계약으로 명시해야 한다.

## 검증

프로브 파일만 대상으로 한 strict TypeScript 검사는 통과했다.

```text
npx tsc --noEmit --target ES2022 --lib ES2022,DOM,DOM.Iterable \
  --module ESNext --moduleResolution Bundler --strict --skipLibCheck \
  --types node scripts/probe-campaign-jev.ts
exit 0
```

현재 저장소 전체 `npx tsc --noEmit`도 exit 0으로 통과했다. `git diff --check -- scripts/probe-campaign-jev.ts docs/campaign-jev-probe.md`도 통과했다.

## 제품 컴파일러 v3 검증

앞의 26요청 프로브는 Jev 조합 가능성을 확인한 실험이다. 이후 실제 `WorldState`를 받는 제품 경계의 컴파일러를 별도로 구현했다.

- 당시 `server/campaign-jev.ts`: `interpretCampaignWithJev(text, world, options)`
- [`server/campaign-contracts.ts`](../server/campaign-contracts.ts): HTTP 요청 metadata와 반환 source span 계약
- [`tests/campaign-jev.test.ts`](../tests/campaign-jev.test.ts): 네트워크 fallback이 없는 mocked provider 검증
- 당시 `scripts/evaluate-campaign-jev.ts`: 실제 장의 공개 world와 physics를 이용한 재현 스크립트

요청 본문은 `text`, `stageId`, `runId`, `revision`, `attempt`, `world`를 받는다. 캠페인 상태가 클라이언트 IndexedDB에 있으므로 route가 서버 세션을 가정하지 않는다. route 통합 시에는 받은 snapshot을 canonical stage catalog와 대조하고 숨은 엔티티와 미관찰 사실을 제거해야 한다. 컴파일러는 전달된 `world.visible`의 유한 엔티티·속성·지역 후보만 쓴다. `propertyVisibility`가 명시적으로 `hidden`으로 분류한 `kind`, `driftAge`, `periodTicks` 같은 bookkeeping 값은 Jev state와 조건 후보에서 제거한다. `shown` 속성은 한국어 label/value를 함께 주고, 아직 catalog가 `unknown`인 속성은 임의로 숨기지 않는다. `phase` 같은 현재 상태와 `cycle` 같은 공개 유한 열거 선택지는 유지한다.

입력은 trim 후 1~500 codepoint, 공백 토큰 250개 이하이고, Choice 후보는 최대 255개, 직렬화 요청은 768KiB 이하이다. 세 요청을 합쳐 15초 제한을 공유한다. 모델은 `jev-1.13.0`으로 고정했다. `.env.local`의 `TYPESAFE_API_KEY` 외 항목은 평가 스크립트가 읽지 않으며, metric에는 모델·토큰 수·지연·오류 코드만 기록한다. raw input, 응답 본문, 키는 기록하지 않는다.

### v3 합성 계약

1. 첫 요청은 행동 수, token별 action/condition 확률, speculative verb, composition, 조건 존재, scope mode를 typed Choice/Noul로 판정한다. 행동 수만큼 token 확률 상위 anchor를 취한다. 선택되지 않은 token의 확률도 버리지 않고 `1 - max(unselected)`를 전체 confidence에 포함한다.
2. 둘째 요청은 각 anchor에 묶어 actor, contextual verb, target과 verb별 destination/instrument/amount, 조건 field/value/control, 명시 scope를 원문 span Choice와 공개 catalog Choice로 추출한다. `hold`, `board`, `move`에는 destination을 묻지 않고 `tie`에는 instrument, `pour`에는 amount를 요구한다. action count 0과 조건 1은 순수 `wait`로 만들 수 있다.
3. 셋째 요청은 전체 원문, 선택·비선택 anchor, 조립한 program, role별 source span과 entity를 한 state로 보고 joint Noul 검증을 한다. 정확한 action coverage, 비연속·생략 actor, 지시어나 앞 절에서 이어받은 target, 장거리 instrument, amount 숫자, 조건 control, scope ownership을 함께 검사한다. 기하적으로 “역할 span이 짧은 clause 안에 들어가야 한다”는 규칙은 쓰지 않는다.

모든 단계는 Jev typed 판정이며 키워드, 정규식 문장 해법, solution ID, generic JSON 생성 fallback이 없다. 최종 결과는 `parseProgram`을 통과해야 한다. joint 검증이 실제 모순 쪽(`< 0.5`)이면 반환하지 않고, 그 이상이어도 전체 confidence가 0.8 미만이면 `needsConfirmation=true`다. 현재 제품 정책은 confidence와 관계없이 모든 새 해석을 미리보기로 보여 주며 자동 실행하지 않는다.

scope도 자동으로 `world.segmentId`에 고정하지 않는다. Jev가 `stage_general | current_actor_region | explicit_region`을 고르고, current일 때만 `hero.location.region`, explicit일 때만 공개 region Choice와 source span을 사용한다. 영속 엔티티가 다음 구간에 남는 장에서 이전 메모가 무조건 재실행되는 일을 피하기 위한 경계다.

### 중간 2단계 회귀: 0/6

첫 제품 반복 50요청에서는 안전 gate를 거친 동일 6사례 중 tie와 kitchen wait 두 후보가 의미상 맞았고, tie는 실제 physics도 성공했다. 그 뒤 source ownership을 role span과 짧은 clause의 문자 포함 관계로 검사한 스냅샷을 동일 6사례에 12요청으로 재검증했다. 결과는 0/6이었다.

| 사례 | 결과 |
| --- | --- |
| intro exact/paraphrase, channels A/B | 독립 action count와 token Noul의 hard 일치 gate에서 거절 |
| tie | 문장 앞의 `밧줄로`가 뒤쪽 짧은 `묶어` clause 밖이라는 이유로 잘못 거절 |
| kitchen wait | target source가 짧은 action clause 밖이라는 이유로 잘못 거절 |

이 0/6은 Jev의 전체 한계가 아니라 한국어 장거리 논항에 맞지 않는 컴파일러 gate의 회귀다. 그래서 action count와 token Noul의 차이는 confidence로 보존하고 셋째 joint 판정에서 누락/추가를 검증하도록 바꿨다.

### v3 실제 8사례 결과

기존 6사례와 평가 전에 쓰지 않았던 tie/kitchen 바꿔쓰기 2사례를 각 3요청으로 실행했다. 첫 v3 실행은 2/8이었고, kitchen unseen은 의미 AST가 맞았으나 당시 `passage`가 중간 x=3을 가리켜 완료되지 않는 stage content 불일치가 있었다. 이후 공개 속성 filtering/한국어 label을 적용하고 passage의 물리 대상을 문장 의미와 맞춘 현재 스냅샷을 같은 8사례, 24요청으로 다시 실행했다. 현재 실행은 3/8, 합계 관찰 지연 8,562ms, wall time 약 9.2초였다.

| 사례 | 의미/검증 결과 | 실제 physics |
| --- | --- | --- |
| rain intro exact | joint ownership 불일치로 안전 거절 | 미실행 |
| rain intro paraphrase | verb와 target 공개 속성 불일치로 안전 거절 | 미실행 |
| channels A | joint ownership 불일치로 안전 거절 | 미실행 |
| channels B | verb와 target 공개 속성 불일치로 안전 거절 | 미실행 |
| tie exact | `tie(reach-barrel, reach-anchor, reach-rope)`와 세 source span 정확, confidence 0.28 | RAIN_REACH 안정화 성공 |
| tie unseen | 어순을 바꾼 처음 보는 문장도 같은 AST, confidence 0.29 | RAIN_REACH 안정화 성공 |
| kitchen exact | joint ownership 불일치로 안전 거절 | 미실행 |
| kitchen unseen | `wait pressure-dial.phase == stopped` 뒤 `move 03-1-passage`, 의미 AST 정확, confidence 0.47 | 수정된 실제 03-1 physics 완료 |

성공한 비밀정보 제외 결과는 다음과 같다.

```json
{
  "tie-exact": {
    "body": { "actor": "hero", "verb": "tie", "target": "reach-barrel", "destination": "reach-anchor", "instrument": "reach-rope" },
    "source": { "target": "통을", "destination": "고리에", "instrument": "밧줄로" },
    "confidence": 0.28,
    "physics": true
  },
  "tie-unseen": {
    "body": { "actor": "hero", "verb": "tie", "target": "reach-barrel", "destination": "reach-anchor", "instrument": "reach-rope" },
    "source": { "target": "통을", "destination": "고리에", "instrument": "짧은 밧줄로" },
    "confidence": 0.29,
    "physics": true
  },
  "kitchen-unseen": {
    "body": ["wait 03-1-pressure-dial.phase == stopped", "move 03-1-passage"],
    "semantic": true,
    "confidence": 0.47,
    "physics": true
  }
}
```

`place(cork, launch)`처럼 public physics에서 동등하게 성공하는 표현은 고정 canonical AST와 다르다는 이유만으로 실패 처리하지 않는다. 평가 스크립트는 executor가 있는 사례에서 실제 stage physics 결과를 최종 성공 기준으로 삼고 semantic exact-match는 별도 필드로 보존한다. kitchen unseen의 첫 runtime 실패는 Jev 오류로 세지 않았다. 문장의 직접 대상인 `오븐 앞 통로` AST는 정확했고, stage에서 같은 이름의 대상이 중간 x=3에 놓인 content 불일치였다. 물리 target 정렬 후 저장해 둔 동일 AST를 실행하면 03-1을 완료했고, 현재 재실행에서도 같은 AST와 physics 성공을 함께 확인했다.

수량 사례 `세 칸 얕은 대야의 물 두 칸을 떠 있는 빈 통에 부어`도 첫 v3와 현재 public-state 스냅샷에서 각각 3요청으로 재검증했다. 두 번 모두 `amount=2`가 포함된 완성 후보까지는 도달하지 못하고 destination/source 역할 충돌로 안전 거절됐다. 앞 반복에서는 `amount=2` 자체를 맞힌 적이 있으나 관형절 `떠 있는`을 행동으로 추가하거나 source/destination을 뒤집었다. 따라서 amount 보존 코드는 있고 mocked test도 통과하지만 실제 일반화 성공 근거는 아직 없다.

제품 컴파일러 작업의 실제 API 호출은 반복 50, 잘못된 기하 gate 재검증 12, 첫 v3 8사례 24와 amount 3, 현재 public-state v3 재검증 24와 amount 3으로 합계 116요청이다. 앞 절의 독립 프로브 26요청과는 구분한다.

### 판단과 남은 범위

현재 실측 성공률 3/8은 제품 자동 실행 품질로 부족하다. confidence가 낮은 정답을 미리보기로 보낼 수 있다는 사실과 잘못된 program을 사용자가 확인해 줄 것이라는 가정도 구분해야 한다. 현재 route/UI에서는 모든 해석을 미리보기로 유지하고, 실제 잘못된 역할·행동 누락은 joint 검증과 stage physics에서 차단해야 한다.

다만 Jev를 전혀 활용하지 못하는 한계도 입증되지 않았다. 같은 공개 world에서 exact와 처음 보는 어순 바꿔쓰기 모두 instrument를 포함한 AST를 만들었고 실제 physics가 성공했다. 따라서 사용자 중단 조건은 충족되지 않는다. 현재 실패는 다음의 구현·품질 gap이며 Jev 전체 불가능 판정이 아니다.

- 여러 조건의 재귀 합성, `if/else`, 순차와 동시가 섞인 중첩 program은 아직 명시적으로 거절한다.
- `가시가 드러나면 들어가지 마` 같은 부정 위험 guard는 predicate와 `not`/wait 조합으로 표현 가능하지만 아직 컴파일하지 않는다.
- explicit 지역과 general 규칙은 typed scope가 있으나 다양한 문장 반복 평가가 없다.
- 5·6장 공개 속성 label이 catalog에 추가되기 전에는 `unknown` 이름이 그대로 보이므로, 해당 장 활성화 전에 presentation catalog를 확장해야 한다.
- 1차 speculative verb와 2차 contextual verb의 arity가 달라지면 현재 재질문 없이 거절한다.
- action anchor, 조건 scalar type, destination/source ownership의 한국어 반복 안정성이 낮다.
- kitchen처럼 원문을 그대로 실행한 결과와 stage 완료가 다른 경우를 UI에서 “해석 오류”와 “추가 행동 필요”로 분리해야 한다.

권장 production 경로는 v3 구조를 유지하면서 실제 장별 corpus로 anchor/role/joint 질문을 평가하고, 실행 전 preview와 public physics 검사를 모두 통과한 program만 저장하는 것이다. 이후 장을 넓히기 전에 intro/channels/amount/wait의 반복 성공률과 provider 오류율을 통과 기준으로 두어야 한다.

v3 검증 명령은 다음과 같이 통과했다.

```text
AI_STRUCTURED_LOGS=false npx vitest run tests/campaign-jev.test.ts
Test Files 1 passed; Tests 7 passed

npx tsc --noEmit
exit 0
```
