# 공개 저장소와 검색·공유 운영

대표 주소는 **https://olpd.vercel.app/** 다. 도메인을 옮길 때는 index.html의 canonical·OG·Twitter 이미지·JSON-LD, public/robots.txt의 Sitemap, public/sitemap.xml, 공유 이미지의 주소, scripts/check-public-site.ts의 기대 주소를 함께 변경한다.

## Git 및 배포 경계

- .gitignore는 환경파일, 인증서/개인키, 의존성·빌드 결과, 배포 로컬 상태, 검증 산출물, 에디터/OS 파일, 루트의 게임 저장 내보내기를 제외한다. .env.example에는 빈 키와 공개 설정 기본값만 둔다.
- .vercelignore는 같은 로컬 자료 외에 docs/tests/scripts/AGENTS.md도 업로드하지 않는다. Git에서는 코드·문서·검사·프로젝트 지침·잠금파일과 공개 아트를 추적한다.
- public/의 파일과 Vite 클라이언트 환경변수는 공개된다. 서버 키를 VITE_ 접두사로 옮기지 않는다. 소유 확인용 메타 토큰은 공개 HTML에 있어야 하는 값이며 API 비밀키가 아니다.
- ignore 추가는 기존 Git 이력에서 파일을 지우지 않는다. 이번 점검에서는 당시 접근 가능한 23개 커밋 및 현재 추적 파일에서 로컬 .env.local의 3개 비밀값과 일치한 파일을 발견하지 못했다. 다른 과거 키나 연결할 원격 저장소의 별도 이력까지 검사한 것은 아니다.
- 현재 원격 저장소는 연결되지 않았다. 사용자가 원격 URL을 정한 뒤 연결한다. 공개 전에 커밋 목록과 추적 파일을 확인하며 .env.local 등을 강제로 추가하지 않는다.

## 검색과 링크 공유

- index.html 초기 head에 한국어 제목/설명, canonical, robots, Open Graph, Twitter large image, 두 검색 서비스 인증 태그와 VideoGame JSON-LD를 둔다. JavaScript를 실행하지 않는 공유 수집기도 메타 정보를 읽을 수 있다.
- 공유 이미지: public/og/one-line-per-death.png, 1200×630 PNG. 기존 용사 스프라이트와 로컬 Gowun Batang 글꼴로 만든 표지다. npm run generate:og로 다시 만들고 육안으로 확인한다. 그림을 바꾸면 공유 서비스의 미리보기 캐시가 갱신되기까지 시간이 걸릴 수 있다.
- 공개 페이지의 HTML 및 Vercel 전역 응답에서 이전 noindex를 제거했다. /api/ 응답은 noindex/nofollow이며 robots.txt에서도 API와 QA 쿼리를 수집하지 않도록 안내한다. robots 규칙은 접근 권한 제어 수단이 아니다.
- 실제 독립 URL이 있는 페이지는 루트 하나다. 장 선택·게임 진행은 같은 페이지 안의 로컬 상태이므로 허구의 장 URL을 사이트맵에 넣지 않는다. sitemap.xml에는 대표 루트만 싣고 부정확한 lastmod를 자동 생성하지 않는다.
- Vercel 기본 Preview 배포는 플랫폼의 X-Robots-Tag: noindex를 사용한다. 별도 Preview 도메인을 붙이는 경우 예외가 있으므로 직접 응답을 확인한다. [Vercel 응답 헤더](https://vercel.com/docs/headers/response-headers)
- canonical은 대표 URL을 알리는 신호이며 검색 결과 반영을 보장하지 않는다. [Google canonical 안내](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls), [네이버 로봇 메타 안내](https://searchadvisor.naver.com/guide/markup-structure)

## 서치어드바이저 / 서치 콘솔

배포된 초기 HTML head에 사용자가 제공한 naver-site-verification과 google-site-verification 값을 그대로 둔다. Google 토큰의 밑줄은 실제 _이며 역슬래시를 포함하지 않는다.

1. 각 서비스에서 https://olpd.vercel.app/의 소유 확인을 실행한다.
2. 사이트맵 URL **https://olpd.vercel.app/sitemap.xml** 을 제출한다.
3. 대표 페이지의 수집/색인 상태를 콘솔에서 확인한다.

태그 배포와 외부 서비스의 소유 확인 완료·사이트맵 접수·검색 색인은 각각 별개다. 이번 코드 작업은 계정 콘솔의 등록 버튼을 대신 누르지 않는다. [Google 사이트맵 안내](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)

## 릴리스 검사

    npm run build
    npm run check:seo
    SITE_URL=https://olpd.vercel.app npm run check:seo

마지막 명령은 배포 후 실행한다. 검사는 초기 HTML의 인증값·canonical·메타·JSON-LD, 검색 차단 여부, robots/sitemap 및 PNG 실제 크기를 확인한다. 공개 후에는 새 브라우저에서 게임 진입과 API 기동도 함께 확인한다. 검색 서비스 계정의 인증 결과나 실제 플랫폼별 공유 미리보기까지 확인하는 검사는 아니다.

## 모바일 자동 다크모드

게임은 자체 배경·종이·잉크 색상을 사용한다. 초기 HTML의 color-scheme 메타와 CSS :root에 only light를 지정해 브라우저의 자동 색상 변환을 거부한다. 밝은 게임 테마로 바꾸는 설정이 아니다. [Chrome 자동 다크모드 제외 안내](https://developer.chrome.com/blog/auto-dark-theme)

390px Chromium에서 light/dark 선호 및 Emulation.setAutoDarkModeOverride를 켠 메모장 PNG가 동일함을 확인했다. 실제 휴대전화의 모든 브라우저, 확장 기능 또는 OS 접근성 색상 반전까지 차단한다고 보장하지 않는다. 검사 자료는 Git 제외 artifacts/color-scheme/에 보관한다.
