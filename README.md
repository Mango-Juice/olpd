![죽을 때마다 한 줄 — One Line Per Death](docs/assets/readme-banner.png)

# 죽을 때마다 한 줄 · One Line Per Death

죽을 때마다 한 줄의 메모를 남겨, 작은 용사를 출구로 이끄는 자연어 퍼즐 게임입니다.

“구덩이가 보이면 점프해.” 용사는 메모를 기억하고, 조건에 맞는 지시를 위에서부터 골라 행동합니다. 실패를 통해 메모를 쌓고 순서를 바꾸며 10개 장의 퍼즐을 풀어갑니다.

## 어떻게 작동나요?

- **React · TypeScript · Canvas 2D**로 게임 화면과 애니메이션을 구현했습니다.
- **TypeSafe Jev · DeepSeek Flash**가 자연어 메모를 행동과 조건으로 해석합니다.
- **내부 알고리즘**이 메모의 우선순위, 이동·충돌과 성공 여부를 판정합니다.
- 진행 상황은 브라우저에 자동 저장됩니다.

## 로컬 실행

Node.js 22.x와 TypeSafe·DeepSeek API 키가 필요합니다.

```sh
npm ci
cp .env.example .env.local
# .env.local에 TYPESAFE_API_KEY와 DEEPSEEK_API_KEY 설정
npm run dev
```

브라우저에서 `http://localhost:5173`을 엽니다.

개발 지침은 [AGENTS.md](AGENTS.md)에 정리되어 있습니다.
