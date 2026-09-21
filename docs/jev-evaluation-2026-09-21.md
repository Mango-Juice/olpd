# Jev 한국어 해석 평가 — 2026-09-21

- 모델: `jev-1.13.0` (고정 버전)
- 규칙 버전: `1`
- 합성 지침: 85개
- 문장-상황 쌍: 371/371 (100.0%); 행동 오분류는 해당 문장의 7쌍을 모두 실패 처리
- 행동 분류: 53/53
- 전체 적용 집합 엄격 일치: 53/53
- 지원 외·다중·모호 지침 거부: 32/32
- 튜토리얼·대표 전체 집합: 11/11
- 임계값: action top probability >= 0.6, applicability selected probability >= 0.6
- 동시 호출: 3, 요청 제한: 15초
- 지연: p50 251ms, p95 359ms
- 호출/토큰: 85 calls, input 890384, output 35549
- 추정 실제 비용: $0.0374 (Jev 1.13 입력 $0.042/Mtok, 출력 무료 기준)
- 평가 세트 SHA-256: `2a94e16056bec721b32938e6ba749665e9420a50bd7a366ebf4cf88cf04519d7`

허용 지침마다 7개 관찰 상황을 모두 채점한다. 튜토리얼·대표 사례는 행동과 7개 상황 전체 집합까지 정확히 일치해야 통과한다. 이 수치는 이 저장소의 고정 합성 평가 세트에 대한 결과이며 전체 한국어 정확도를 뜻하지 않는다.

## 범주별 결과

- tutorial: full-set 3/3, rejected 0/0
- representative: full-set 8/8, rejected 0/0
- clear: full-set 20/20, rejected 0/0
- exception: full-set 22/22, rejected 0/0
- negative: full-set 0/0, rejected 23/23
- ambiguous: full-set 0/0, rejected 9/9

## 불일치

없음
