/** Observations shown only after the named body was actually contacted. */
export const EARLY_CONTACT_HINTS: Readonly<Record<string, { key: string; text: string }>> = {
  '02-v2-1/02-v2-1-box': { key: 'box-moves', text: '상자 옆에 빈자리가 있네. 옆으로 밀릴 것 같아.' },
  '02-v2-2/02-v2-2-box': { key: 'box-supports', text: '이 상자는 올라서도 버틸 만큼 단단해 보여.' },
  '02-v2-2/02-v2-2-window': { key: 'window-high', text: '창턱이 높네. 아래에 발 디딜 곳이 필요하겠어.' },
  '02-v2-3/02-v2-3-plank': { key: 'plank-spans', text: '널빤지 양 끝이 돌턱에 닿을 만큼 길어 보여.' },
  '02-v2-4/02-v2-4-pool': { key: 'floating-platform', text: '물길 가운데 코르크 발판이 떠 있네. 발을 디딜 수 있을까?' },
  '02-v2-5/02-v2-5-pool': { key: 'drain-water', text: '계단 쪽이 물에 잠겼네. 물 밖에 배수 덮개가 보여.' },
  '02-v2-6/02-v2-6-box': { key: 'bridge-support', text: '처진 다리 아래 빈자리가 이 상자만 해 보여.' },

  '03-v2-1/03-v2-1-steam': { key: 'steam-pulse', text: '뜨거운 김이 잠깐씩 멎는 것 같아.' },
  '03-v2-2/03-v2-2-oven': { key: 'oven-opens', text: '오븐 문이 열렸다 닫히는 박자가 있네.' },
  '03-v2-3/03-v2-3-claw': { key: 'claw-rises', text: '집게가 오르내리네. 올라갈 때 아래에 틈이 생겨.' },
  '03-v2-4/03-v2-4-dough': { key: 'rising-dough', text: '반죽이 부풀 때마다 윗면이 선반에 가까워지네.' },
  '03-v2-5/03-v2-5-tray': { key: 'moving-platform', text: '쟁반이 양쪽 턱 사이를 오가며 잠깐씩 멈추네.' },
  '03-v2-6/03-v2-6-steam': { key: 'steam-pulse', text: '뜨거운 김이 잠깐씩 멎는 것 같아.' },
  '03-v2-6/03-v2-6-tray': { key: 'moving-platform', text: '쟁반이 양쪽 턱 사이를 오가며 잠깐씩 멈추네.' },

  '04-v2-1/04-v2-1-windmill': { key: 'windmill-guard', text: '풍차가 멈춰 있네. 바람이 닿으면 움직일까?' },
  '04-v2-2/04-v2-2-lift': { key: 'wind-lift', text: '승강판 아래 풍낭에 바람관이 이어져 있네.' },
  '04-v2-3/04-v2-3-hotplate': { key: 'hotplate-cools', text: '송풍기 바람이면 철판이 식을 것 같아.' },
  '04-v2-4/04-v2-4-blades': { key: 'spinning-blades', text: '바람길을 바꾸면 날개도 멈출까?' },
  '04-v2-5/04-v2-5-door': { key: 'spring-door', text: '풍로문 옆 벽 홈에 걸쇠가 맞을 것 같아.' },
  '04-v2-6/04-v2-6-lift': { key: 'wind-lift', text: '승강판 아래 풍낭에 바람관이 이어져 있네.' },

  '05-v2-2/05-v2-2-thorns': { key: 'ceiling-thorns', text: '천장 가시 아래로 빈 공간이 보여.' },
  '05-v2-3/05-v2-3-vine': { key: 'low-vine', text: '덩굴 아래에는 몸이 지날 만한 공간이 남아 있네.' },
  '05-v2-4/05-v2-4-shelf': { key: 'low-shelf', text: '돌시렁이 낮게 내려와 있어. 이 아래는 머리 위가 좁네.' },
  '05-v2-4/05-v2-4-thorn': { key: 'floor-thorns', text: '가시꽃 위쪽은 열려 있네.' },
  '05-v2-5/05-v2-5-arch': { key: 'low-arch', text: '아치 안쪽은 머리 위가 좁네.' },
  '05-v2-5/05-v2-5-thorns': { key: 'ceiling-thorns', text: '천장 가시 아래로 빈 공간이 보여.' },
  '05-v2-6/05-v2-6-vine': { key: 'low-vine', text: '덩굴 아래에는 몸이 지날 만한 공간이 남아 있네.' },
  '05-v2-6/05-v2-6-thorns': { key: 'floor-thorns', text: '바닥 가시 위쪽은 열려 있네.' },
};
