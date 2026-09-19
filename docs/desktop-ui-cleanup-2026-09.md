# 로그인 후 데스크톱 UI 정비

2026-09-20 · `codex/desktop-ui-cleanup` · 기준 `9aa9e5c34187ed1b280cd11fc6ed66dd371a4d4d`

원래 작업 폴더와 KRW/USD 작업 폴더의 변경을 보존하기 위해 별도 worktree에서 작업했다. 금융 엔진, DB query/writer/schema, 인증, 공급자 수집은 수정하지 않았다. 커밋·push·배포·운영 연결도 실행하지 않았다.

## 변경 범위

| 요청 | 실제 변경 | 연결된 파일 |
|---|---|---|
| 1 | 데스크톱 히트맵 바깥 배경·테두리·패딩 제거. 셀·선택·popover 유지 | `home/portfolio-overview.module.css` |
| 2 | ‘연결’ → ‘동반 움직임’. 기존 모바일 관계 행을 데스크톱에서도 재사용. 종목 쌍·상관계수·공통 관측일 표시 | `home/holding-movement-heatmap.tsx`, `home/mobile-holding-connections.*` |
| 3 | 포트 구조에서 상관·위험, ETF 구성종목으로 직접 이동. ETF 검색/선택/돌아가기에서 scope/account 유지, 상세 경로의 포트 구조 메뉴 활성화 | `portfolio/portfolio-structure-view.tsx`, `app-navigation.tsx`, `src/app/etfs/page.tsx` |
| 4 | FX 상세를 모달 전체 너비로 배치. 요약 수치 재배열, 그래프 높이 확대, 열 때 그래프 영역 노출 | `home/fx-impact-popover.*`, `home/portfolio-overview.module.css` |
| 5 | 상승 막대 기본색을 주황으로 고정. hover는 점 크기만 강조 | `today/today-contribution-explorer.tsx` |
| 6 | 포트 구조 외곽 surface 제거 | `portfolio-structure/structure-stage.module.css` |
| 7 | 선택 segment의 기존 이동에 윤곽선·다른 segment 약화 추가. reduced-motion에서도 윤곽선 유지. 각도/면적 계산 불변 | `portfolio/portfolio-allocation-ring.tsx`, `portfolio-structure/allocation-ring.module.css` |
| 8·11 | 공통 `cairn-select` 스타일: 높이·타입·화살표·초점·disabled 통일. native select의 키보드/메뉴 동작 유지 | `src/app/stage.css`, `portfolio/portfolio-allocation-explorer.tsx`, `investment-lab/investment-lab-time-machine.tsx` |
| 9 | 추가투입 외곽 surface 제거, 계산 그룹 유지 | `additional-contribution/contribution-stage.module.css` |
| 10 | 메뉴의 hover 위치 이동 제거 | `src/app/modern.css` |
| 12 | 실제/가상 label과 금액을 각각 세로로 가까이 묶음 | `investment-lab/investment-lab-modern.module.css` |
| 13 | 중앙값 선 2.8 → 1.4, 선택 선 1.8 → 2.2. 일반 경로 alpha .10 → .14, 굵기 .7 → .8 | `simulation/simulation-fan-explorer.tsx`, `simulation/simulation-path-canvas.tsx` |
| 14 | 기존 차트를 재마운트하지 않는 확대 surface 추가. mode/unit/선택 보존, 배경·버튼·Escape 닫기, focus trap/복귀, 배경 inert/scroll lock | `presentation/expandable-chart.*`, `simulation/simulation-fan-explorer.tsx` |
| 15 | 경로 상세 기능은 구현하지 않음. 아래 출력 자료 조사만 수행 | 금융 엔진 변경 없음 |

위 표의 component 경로는 `src/components/` 기준이다. 색상 토큰·현재 디자인·계산 결과는 유지한다. 작은 비교 차트에는 확대 UI를 추가하지 않았다.

## 데이터 의미와 메뉴 이동

- 동반 움직임은 `buildHoldingConnectionGraph`의 기존 Pearson 상관계수다. 저장된 일별 등락의 같은 날짜를 짝지으며 `live_price` 셀은 제외한다. 기록이 있는 비중 상위 7종목, 공통 관측 최소 6일, 절대 상관 .18 이상, 강도순 최대 12쌍이라는 기존 기준을 변경하지 않았다. 실시간 가격 변화와 저장된 원화 단위가치 변화를 섞지 않는다.
- `/etfs`는 `searchReadOnlyEtfMasters`와 `getReadOnlyEtfHoldings`를 사용하는 단일 ETF 구성종목 참고 화면이다. 포트폴리오 간 ETF 겹침 분석이 아니다. 실제 사용자 인증 경계는 그대로 유지했다.
- 포트 구조의 직접 링크 외에도 기존 위험 요약 dialog는 유지했다. 계정 scope는 URL에 유지되며 자산 데이터는 추가로 URL에 넣지 않았다.

## 메뉴 움직임 측정

1440×900 로컬 Home → Lab 이동에서 RSC 응답을 지연시키고 30ms 간격으로 측정했다. 전·중·후 sidebar는 96×900, 항목 높이 60px, 내부 gap 5px, AppNavigation 1개였다. 항목들의 기본 y는 `101,164,227,290,363,426,489,562`였다.

Lab 항목만 hover 중 y=426 → 424로 움직였고 loading 화면 교체에서 같은 이동이 재생됐다. 원인은 `.varda-sidebar-link:hover { transform: translateY(-2px) }`였다. 전체 간격 변경은 이 환경에서 재현되지 않았다. `AppNavigation`을 공유 layout으로 옮기거나 auth/routing을 재설계하지 않고 위치 transform만 제거했다. pending 점은 absolute 배치여서 공간을 차지하지 않는다.

## 시뮬레이션 확대와 향후 경로 설명

`ExpandableChart`가 같은 자식 figure를 유지하며 fixed dialog surface로 확장한다. 실행 객체와 canvas를 새로 계산하거나 복제하지 않는다. ResizeObserver가 표시 크기만 바꾼다. 외부 요소는 확대 중 inert, body는 기존 scroll-lock utility로 잠근다. Escape는 chart 선택 초기화보다 먼저 처리하여 닫을 때 선택을 유지한다.

| 필요한 자료 | 현재 보존 상태 |
|---|---|
| 포트폴리오 경로 | 브라우저 DTO에 `displayPaths.values`의 정규화 NAV 전체 경로 또는 `samplePaths` 존재. 원화 평가액 자체와는 구별해야 함 |
| 경로별 종목 | 경제모형 계산 중 `prepared.assetGrowth`에 종목별 누적 성장배율 존재. 브라우저용 경로별 종목 평가액 DTO는 없음 |
| 경로별 경제지표 | 계산 중 `prepared.factorStates`에 변환된 상태값 존재. 브라우저에는 요약 `factorBands`, 현재 지표·출처 등만 전달 |
| 난수·regime | seed와 모델 가정 존재. 경제모형의 매 단계 난수 충격/PRNG 내부 상태를 별도 출력하지 않음. 과거/체제 bootstrap 내부 draw plan과 경제모형 상태를 같은 자료로 간주하면 안 됨 |

근거: `src/lib/simulation-economic-state-model.ts`, `src/lib/simulation-owner-economic-research.ts`, `src/db/queries/simulation-owner-economic.ts`의 `prepared` 제외, `src/components/simulation/simulation-presentation.ts`. 향후 설명 기능은 같은 실행의 경로 ID에 맞춘 서버 projection, 상태 역변환과 모델별 구분이 필요하다. 그래프 결과만 보고 경제 원인을 추론하면 안 된다.

## 로컬 확인

전용 서버: `http://127.0.0.1:3174`. 실제 화면 component에 결정적 예시를 공급하는 기존 development preview다. 운영 사용자 로그인/DB/공급자 연결은 사용하지 않았다.

| URL | 확인 행동 |
|---|---|
| `http://127.0.0.1:3174/?preview=design` | 히트맵 → 동반 움직임, 변동 근거 → 환율 추세. 전체 평가액 28,886,300원 유지 |
| `http://127.0.0.1:3174/today?preview=design` | hover 전에도 상승 주황/하락 파랑 |
| `http://127.0.0.1:3174/portfolio/structure?preview=design&scope=all` | 31,622,300원, KODEX 200 비중 17.75%. segment와 dropdown 양방향 선택, 상세 링크 |
| `http://127.0.0.1:3174/additional-contribution?preview=design` | 바깥 카드 없는 계산 화면 |
| `http://127.0.0.1:3174/investment-lab?preview=design` | native scenario 선택, 실제 27,376,124원/가상 31,176,984원 기본 예시 |
| `http://127.0.0.1:3174/simulation?preview=design` | 경로 선택·시작값100·크게 보기·닫기, 분포 모드 확대. 예시 기본 중앙값 +1.0% |

실제 계정의 ETF 조회 및 데이터별 긴 이름/대규모 보유목록은 운영 로그인 상태에서 미검증이다. 인증을 우회하거나 예시를 실제 사용자 데이터처럼 보고하지 않는다.

## 검증 기록

- `e2e/desktop-ui-cleanup.spec.ts`: desktop 1440×900, 1366×768, mobile 390×844, 한영/overflow, ring geometry, keyboard select, modal state/focus, FX, nav/reduced motion.
- 최초 브라우저 7개와 마지막 초점 순환·nav 및 FX 검사 3개 통과(2개 재검증 포함, 고유 시나리오 8개). `output/desktop-ui/browser.txt`, `browser-final.txt`.
- 연결된 금융 계산 회귀를 포함한 전체 테스트 2,578개 통과, 실패/skip 없음: `output/desktop-ui/tests-final.txt`.
- 관련 UI/계산 설명 11개 통과: `output/desktop-ui/related-tests.txt`.
- 전체 lint 통과: `output/desktop-ui/lint-complete.txt`. 임시 QA 실행 스크립트는 제거했고 로그·캡처만 남겼다.
- 최종 소스의 webpack production build 통과: `output/desktop-ui/build-final.txt`. `build:vercel` 및 마이그레이션은 실행하지 않았다.
- 실제 이메일/OAuth, 운영 DB/RLS 연결, 운영 공급자 데이터는 이번 UI 작업에서 미검증이며 기존 경계를 변경하지 않았다.
- 비교 캡처는 `output/desktop-ui/before-*.png`, `after-*.png`, `expanded-simulation.png`, `relationships.png`, `fx-detail.png`에 있다. QA 산출물은 제품 배포 파일에 포함하지 않는다.

## 배포 전 후속 검토

- 확대 상태에서 선택 해제 버튼이 사라지거나 이전 경로 버튼이 비활성화되면 포커스가 차트 밖으로 빠지는 경우를 실제 브라우저에서 재현했다. 확대 영역의 초점 복구를 추가하고 닫을 때 감시와 이벤트를 정리한다. 금융 계산이나 경로 데이터는 변경하지 않는다.
- 기존 확대/닫기 검사와 이 회귀 2개가 통과했다(39.1초). 고유 브라우저 시나리오는 총 9개이며 대상 lint도 통과했다. 최신 빌드 근거는 `output/desktop-ui/build-release.txt`에 기록한다.
