# KRW/USD 2단계: 실제 원장 연결과 검증

2026-09-20. 작업 위치: `.worktrees/krw-usd-foundation`, `codex/krw-usd-foundation`.
이 문서는 1차 기록 `krw-usd-implementation.md`의 후속이다. 1차의 미구현 목록은 당시 상태이며, 현재 상태는 아래를 따른다.

## 배포와 로컬 작업의 구분

- 기존 데스크톱 UI는 `b2cf4cf`로 커밋하고 PR #193을 실제 배포 브랜치 `master`에 병합했다. Production `3a081f9`는 Ready이며 공개 화면을 확인했다. 인증된 운영 계정의 전체 UI는 검증하지 않았다.
- 글로벌화 2단계는 로컬 미커밋 상태다. 원래 작업 폴더의 변경과 1차 구현을 보존했다. UI 배포 패치를 이 작업 트리에도 반영했다.
- 운영 DB·인증·공급자 비밀값·Cron 설정을 조회/변경하지 않았으며 새 유료 요청·계약·배포를 실행하지 않았다.

## 기능별 실제 연결

| 기능 | 실제 사용자 경로와 공통 엔진 | 격리 DB 근거 | 남는 제한 |
|---|---|---|---|
| Home | 인증된 scope → `getTrackedCurrencyEvidence` → `buildTrackedCurrencyPortfolio`; native 현금과 실제 보유 포함 | native-service-integration, native-portfolio-persistence | 종목 가격/FX/기업행위 근거가 없으면 해당 항목 제외, 전체 합계·비중은 차단 |
| Today | 같은 원장·평가 → 실제 거래 구간별 가격/FX 기여, 외부 입출금 제외, 배당/비용 포함 | 동일 테스트와 currency-tracked-portfolio, currency-valuation | 직전 기록이나 구간 거래 근거 없으면 수익으로 표시하지 않음 |
| History | immutable native snapshot + 현재 관측, 각 시점 수량·원본 가격·당시 FX | native-portfolio-persistence, native-service-integration | 새 원장 시작 전 과거 보유는 추정하지 않음; 기존 KRW 기록 보존 |
| Structure | 동일 현금 포함 평가에서 실제 비중·기존 ring; 같은 평가 입력으로 공통 연구 엔진의 위험 구간만 계산 | 실제 조회/평가 통합, native-structure-risk, reporting-currency-routes | 이력 불완전 시 구성만 표시. Sharpe/beta는 통화에 맞는 벤치마크·무위험 금리 근거 전까지 미제공 |
| Contribution | 실제 승인 목표·자산 성격/매수 가능 여부/MA 근거 + 원장 cost lots → 기존 정책 엔진 | native-contribution-plans, currency-valuation | 누락 원가는 매도 판단만 제한; 미승인 목표는 설정 CTA |
| Lab | 실제 현금 포함 관측 성과와 같은 외부 입출금을 사용한 명시적 종목 반사실 비교; 기존 unit path/Modified Dietz core 일반화 | native-currency-research, native-currency-counterfactual | 현재 비중 backcast는 가상으로 구분; 다른 기간끼리 actual 비교하지 않음 |
| Simulation | 실제 소유 종목의 날짜별 native 수익률/FX → 공통 bootstrap 1,000경로 | native-currency-research, native-currency-counterfactual, native-economic-admission | USD 경제변수 모형은 미검증 정책으로 제한. KRW도 현금/종목/값/실행비중이 기존 모형과 정확히 같을 때만 진입 |

이 표는 예시 화면만의 연결이 아니다. 외부 DB transport를 인메모리 PostgreSQL(PGlite)로 대체한 실제 writer/query/engine 테스트를 포함한다. 외부 인증과 Twelve Data HTTP는 합성 경계이며 실제 이메일/OAuth/공급자 검증은 아니다.

| 기능 | 변경 코드 | 근거 테스트 |
|---|---|---|
| Home / Today | [계정별 조회](../src/db/queries/currency-tracked-portfolio.ts), [공통 평가·변동](../src/lib/currency-tracked-portfolio.ts), [실제 화면](../src/components/currency-tracked-view.tsx) | [공급자→실제 조회→평가](../tests/native-service-integration.test.mjs), [기여·성과](../tests/currency-tracked-portfolio.test.mjs) |
| History | [원장 투영](../src/lib/native-portfolio-projection.ts), [스냅샷 저장](../src/db/queries/native-portfolio-snapshots.ts), [일일 작업](../src/lib/snapshots/native-daily-job.ts) | [원장·이체·이력 PGlite](../tests/native-portfolio-persistence.test.mjs) |
| Structure | [기존 route 연결](../src/app/portfolio/structure/page.tsx), [공통 연구 엔진](../src/lib/currency-research.ts) | [위험 구간 검사](../tests/native-structure-risk.test.mjs), [실제 연구 조회](../tests/native-currency-research.test.mjs) |
| Contribution | [정책 연결](../src/lib/currency-contribution.ts), [원가·승인 목표 조회](../src/db/queries/native-contribution-context.ts), [계획 저장·삭제](../src/db/queries/native-contribution-plans.ts) | [계획 PGlite·계정 경계](../tests/native-contribution-plans.test.mjs) |
| Lab | [계정별 연구 조회](../src/db/queries/currency-research.ts), [실제 기간 반사실 계산](../src/lib/investment-lab-counterfactual-path.ts) | [동일 외부 현금흐름 비교](../tests/native-currency-counterfactual.test.mjs) |
| Simulation | [기존 route 연결](../src/app/simulation/page.tsx), [경제모형 허용 조건](../src/lib/native-economic-admission.ts) | [모형 조건](../tests/native-economic-admission.test.mjs), [기존 화면 연결](../tests/reporting-currency-routes.test.mjs) |
| Provider | [수집·조회 서비스](../src/lib/market-data/twelve-data-service.ts), [관측 저장](../src/lib/market-data/twelve-data-store.ts) | [큐·저장 통합](../tests/twelve-data-storage.test.mjs), [실제 사용자 평가 연결](../tests/native-service-integration.test.mjs) |
| 간편 입력 연속성 | [입력 모델](../src/lib/quick-portfolio.ts), [인증 후 이어가기](../src/components/first-visit/portfolio-activation.tsx), [입력 Home](../src/components/first-visit/quick-home.tsx) | [통화 저장](../tests/currency-persistence.test.mjs), [입력 UI](../tests/quick-currency-ui.test.mjs), [인증 후 경로](../tests/activation-routing.test.mjs) |

## 원본·현금흐름·원가

- `native-portfolio-ledger.ts`와 `0050_native_portfolio_ledger.sql`: 명시적 시작 잔액, 입금/출금, 매수/일부·전량 매도, 배당, 수수료, 환전, 동일 소유자 계좌 간 이체, 분할/병합, 사후 원가 입력. 원본 금액·통화·실제 시각·순서·수량을 남긴다.
- 시작 잔액은 관측 출발점이며 가짜 입금/매수가 아니다. 금액만 입력한 draft는 기존 Home을 사용하고 이 원장으로 자동 승격하지 않는다.
- 원장의 완전성은 확인한 시작 상태부터 기록한 이벤트가 일관되게 이어진다는 뜻이다. 증권사와 자동 대조해 사용자가 빠뜨린 거래·배당·분할까지 없음을 확인했다는 뜻은 아니다.
- 처분 원가는 기존 비례 가중평균 정책에 따라 원래 취득 lot의 잔여 비율로 보존한다. 환전 전후 금액과 수수료는 각 통화로 남긴다. 수수료는 비용으로 분리하며 세무 원가 계산을 제공하지 않는다.
- 외부 입출금만 성과 계산의 자본흐름이다. 동일 scope 내부 거래·환전·이체는 외부 입출금으로 중복 산입하지 않는다. 계좌만 보는 경우 scope 밖의 자기 계좌로 이체한 금액은 그 scope의 입출금이다.
- 원가 또는 취득 시점 FX가 없으면 원가/관련 매도 조건만 미제공한다. 현재 FX로 과거 원가를 채우지 않는다.
- 기록된 매도 손익은 매도 당시 보존한 처분 lot와 매도대금을 각각 실제 날짜 FX로 환산한다. 수수료는 이 요약과 별도이며 기간 성과에는 비용으로 포함한다. 이후 원가를 보완해도 이전 미확인 매도의 원가를 소급 생성하지 않는다. 종목을 전량 매도해도 근거가 남는다.
- 분할은 원장 수량/잔여 원가 비율과 raw 가격으로 처리한다. 별도 수정가격과 이중 적용하지 않는다. 현금 배당은 실제 기록한 금액만 반영한다.
- 현금 포함 실제 성과는 기존 Modified Dietz core에 실제 평가·입출금 timestamp 가중을 추가한 `observed_timestamp_modified_dietz_v1`이다. 관측 구간별 추정 수익률을 연결한다. 기존 일자/EOD 정책은 유지하며 TWR/MWR 또는 세무 수익률로 부르지 않는다. 중간 관측이 불완전하면 조용히 버리지 않고 성과를 제한한다.
- 가격/FX 기여는 거래 시점으로 나눈 실제 보유 구간에서 계산하며 교차항을 FX에 배정한다. 전량 매도 뒤 임의의 zero-endpoint 가격은 기여에 영향을 주지 않는다.

## 저장·보안·이력

- `api/portfolio/ledger`는 기존 verified session/tenant resolution, same-origin, bounded JSON, strict mutation validation, session-bound key를 사용한다. 계정 전환 시 오래된 폼 요청을 거부한다.
- 실제 DB writer는 owner transaction/RLS, 계좌·자산 소유권, expected sequence, operation ID로 중복/충돌을 처리한다. 동일 시각 이벤트도 native sequence 순으로 재생한다.
- 변경 계좌 모두의 마지막 평가 시각을 동일 owner 잠금 안에서 재확인한다. 이체 받는 계좌의 기존 기록과, 조회 후 쓰기 전에 새로 캡처된 기록도 포함한다. 해당 평가 이전·동시 시각 거래는 두 계좌 모두 변경하지 않고 거부한다. 이후 시각의 정상 이체와 이미 성공한 요청 재전송은 유지한다. PGlite의 writer→capture→write 순서 검증에서 이체 후 수익률은 정확히 0이며, 실제 서버 다중 연결 경합 검증은 별도로 남는다.
- `0052` deferred constraint는 native 계좌에서 구형 UI가 수량·현금을 우회 변경하는 것을 막는다. 종료된 계좌는 현재 입력에서 제외하되 과거 기록은 남긴다. 검증된 0 잔액·0 수량 종료 이후에만 과거 scope 합산의 0 경계를 인정한다.
- 스냅샷은 최초 완전 관측을 서비스 일자별로 보존한다. 누락/오래된 가격·FX가 daily slot을 선점하지 못하며 나중에 재시도할 수 있다. 당시 저장한 FX는 후속 historical backfill보다 우선한다. 캡처 시간을 07:00으로 위장하지 않는다.
- 기존 스케줄 실행기 안에 native snapshot 작업을 연결했다. 실제 스케줄 설정은 변경하지 않았다. 계좌별로 저장된 관측만 읽고 공급자 호출 없이 캡처한다. 계좌 하나가 차단돼도 다른 계좌는 진행한다.
- `native_contribution_plans`/`0053`은 별도 immutable 계획 저장소다. 서버가 현재 승인 정책과 원장을 다시 읽어 계산하고, 재원 통화·처분원가·FX·매도대금·수익판단 통화·원장 sequence를 고정한다. 화면 통화 변경으로 이전 계획을 재계산하지 않는다. 저장은 거래 실행이 아니다.
- 저장 계획은 동일 계정에서 삭제할 수 있다. 삭제 실패 시 목록을 유지하고 재시도하며, 다른 계정의 ID나 이전 로그인 세션으로 삭제할 수 없다.

## 공급자와 모형

실제 큐 → 별도 HTTP/credit 예약 → 응답 검증 → claim-fenced 저장 → 사용권/보존기간 검증 조회 → 사용자 평가를 연결했다. Twelve Data는 기본 비활성이며 KIS를 교체하지 않는다. 중복/재시도/lease 만료/부분 실패/출처 불일치를 검사한다.

현재 가격을 실제 수량에 연결하기 전에 취득 확인일부터 가격일까지 연속된 유효 기업행위 근거와 원장의 분할 처리를 확인한다. 누락·만료·충돌은 해당 종목만 차단한다. 공개되지 않은 당일 자료나 미수집 분할을 없다고 추정하지 않는다.

위 coverage 차단은 검토된 Twelve Data 상장 경로에 적용한다. 기존 KIS 경로/한국 종목의 사용자 원장 분할 입력 정책은 유지했다. KIS가 모든 기업행위를 검증한다고 새로 주장하지 않는다. 현재 Twelve adapter는 완료된 뉴욕 거래일을 수집하므로 당일 장중 시세에는 검증된 당일 기업행위 계약과 pipeline 확장이 추가로 필요하다.

공급자의 상세 계약/데이터 조건과 rollout version floor는 `krw-usd-provider-readiness.md`, 경제변수의 단위·공개일·금리·FX·모형 의존성은 `usd-model-dependencies.md` 참조.

## 독립 기대값을 사용하는 주요 검사

1. USD 2,000 시작 → 매수/가격 변화 → 수수료·배당 → 일부 매도 → USD 200 출금: 종료 USD 1,902, 외부 흐름 −200, 투자 변화 +102 = 가격 +100 + 기타현금수익 +2.
2. USD 1,000×1,400 = KRW 1,400,000 → USD 1,100×1,260 = KRW 1,386,000: USD +10%, KRW −1%.
3. 실제 공급자 fixture와 DAL: 현금 USD 1,000 → 2주×100 매수 → 가격125: USD 1,050/KRW 1,470,000, 원가 USD200/KRW260,000. 다른 계좌/소유자 미혼합, refresh 재조회, 원래 snapshot 불변.
4. 10주×100 → 2:1 분할 → 20주×50: 가치 1,000 유지, 기록 배당10만 추가되어1,010.
5. 동일 timestamp 매수/매도 순서, 비용 근거 없음/나중에 보완, FX 누락/오래됨, 계좌 종료, 전량 매도, immutable 계획의 중복 저장/계정 전환, 공급자 재시도/충돌/기업행위 coverage.

## 격리 검증의 정확한 범위

- PGlite의 실제 PostgreSQL SQL/JSONB/제약/tenant role/RLS/transaction을 사용한다. 테스트용 최소 기존 테이블 + 실제 신규 migration, 또는 실제 Drizzle 조회 열을 구성한다.
- 실제 별도 PostgreSQL 서버의 여러 연결, Neon pooling, 네트워크 장애/lease 시계차, 운영 전체 migration chain rehearsal은 미검증이다. PGlite의 단일 연결 직렬화가 native PostgreSQL의 concurrent lock 검증을 대신하지 않는다.
- 이메일/OAuth의 외부 verified subject와 tenant 매핑만 테스트 경계에서 제공한다. production auth bypass는 추가하지 않았다. 실제 가입 완료는 미검증이다.
- 공급자 HTTP만 deterministic 응답으로 대체한다. 실제 상품별 사용권/가격/청구 크레딧/외부 timestamp 품질은 미검증이다.

## 로컬 확인

운영 연결이 없는 `http://127.0.0.1:3196`.

| URL | 상태와 행동 | 기대 |
|---|---|---|
| `/try/analyze` | 비회원, EN/USD 선택 후1,234.56 입력, 새로고침; KRW1,300,000 및 명시 FX1,300 추가 | USD2,234.56. 언어·입력 통화·소수 유지, 실제 보유 수량 생성 없음 |
| `/?preview=quick-usd` | 개발 전용 합성 금액 Home | USD2,234.56, 입력 기준 표시 |
| `/portfolio/reporting?preview=currency&currency=USD` | 개발 전용 고정 실제수량 모델 예시; KRW로 변경 | USD1,100 → KRW1,386,000; USD 상승/KRW 하락 |
| `/portfolio/research?preview=currency` | 합성 데이터 표시 상태에서 기간/통화/비중 변경 | 실제 공통 엔진의1,000개 가상 경로; 개인 실제 투자 이력 아님 |
| `/portfolio/ledger` | 로그인 없는 로컬 환경 | 로그인 경계로 이동, 원장 노출 없음 |

인증된 실제 native 계정 UI는 격리 DB와 검증 세션 경계가 필요하며 위 preview만으로 통합 완료를 주장하지 않는다.

## 운영 적용 전 순서와 중단/복구

1. 이 미커밋 변경을 최신 production branch와 비교하고 기존 UI/온보딩 변경을 보존해 병합 검토한다. 지금 단계에서는 배포하지 않는다.
2. 별도 PostgreSQL에서 기존 전체 migration chain + 0048~0053을 순서대로 적용해 실제 역할/권한, 보안 함수, 동시 쓰기/중복/retry를 재현한다. production schema/journal 확인과 적용은 별도 승인 후에만 한다.
3. 기존 계좌를 자동 원장 변환하지 않는다. 시작 시점/현금/수량을 사용자가 확인하고 원본은 보존한다. 가격·FX·원가가 부족한 지표는 차단한다.
4. 공급자는 계속 disabled로 둔 채 호환 코드를 배포하고 외부 auth 및 계정별 저장/복원 검증을 수행한다. 그 뒤 사용권·검토 상장·예산·공개 허용을 별도 확인한다.
5. Twelve 작업을 넣기 전에 구형 worker가 모두 종료되어야 한다. 구형 CLAIM_SQL은 공급자 prefix를 구분하지 않으므로 Twelve pending/running 작업을 KIS 작업으로 가져갈 수 있다.
6. 장애 시 신규 provider 수집/해당 UI 진입을 중단하되 partition-aware worker와 additive schema를 유지한다. native 계좌가 존재하면 0052 우회 방지와 원장 호환 writer도 유지한다. 원장·계획·관측을 삭제하거나 v2/v3 자료를 old-only 제약으로 되돌리지 않는다. 원본 보존 후 forward fix한다.

## 최종 실행 결과

- 최종 전체 test: 이체 경계 보완 후 **2,792/2,792 통과**, 실패·취소·건너뜀 0, 종료 코드 0 (`output/phase2-resume/full-test-post-fence.txt`). 실행 시간 약 375초. 앞선 전체 검사 2,790개 통과 후 새 경합 회귀를 추가하고 다시 실행한 결과다.
- 이체/평가 시각 경계 보완: 실제 원장 PGlite 20/20, 기존 원장 reducer·lifecycle 18/18 통과 (`output/phase2-resume/snapshot-fence-targeted.txt`).
- Production build: 이체 경계 보완 후 `next build --webpack` 종료 코드 0, TypeScript·페이지 수집·정적 생성 통과 (`output/phase2-resume/build-post-fence.txt`). Windows worktree의 node_modules junction 때문에 Next 공식 Webpack 옵션을 사용했다. 운영 연결 환경값을 제거하고 DB는 닫힌 loopback 주소로 둔 일반 build이며 migration을 포함하는 `build:vercel`은 실행하지 않았다.
- 전체 ESLint: 이체 경계 보완 후 종료 코드 0, 오류·경고 출력 없음 (`output/phase2-resume/lint-post-fence.txt`).
- Playwright 공개/예시 흐름: 16/16 통과, page error 0. 1440/390/320px에서 통화·언어 변경, 연구 조건 변경, 소수 입력 복원, 혼합 통화 합계, 비회원 원장/API 차단을 확인했다 (`output/phase2-resume/browser/report.json`). 첫 desktop 연구 검사는 개발 모드 hydration 대기 timeout으로 실패했으며, 새 browser context로 hydration을 확인한 재검사에서 통과했다. 최초 실패는 보고서에 남겼다.
- Playwright 원장/계획 흐름: 12/12 통과, page error 0. 실제 UI/API/writer와 신규 SQL migration을 PGlite로 실행해 시작 잔액, 사후 원가, USD 0.25 입금, 1.25주 매수, 11.25주 전량 매도, 1.5주 재매수, 계획 저장·삭제 실패 후 재시도를 검사했다. 끝의 USD 현금은 1,875.25, 수량은 1.5다 (`output/phase2-resume/native-browser/report.json`).
- 원장 브라우저 검사의 외부 인증·시세·FX·승인 목표는 합성 port다. 실제 CSS·폰트·공통 페이지 wrapper를 사용한 desktop/mobile screenshot을 별도로 확인했다. 실제 가입/운영 사용자 검증이나 운영 시세 검증을 의미하지 않는다.

운영 공개는 보류다. 기본 USD 원장/평가와 supported historical 연구의 코드 연결은 구현했지만, 실제 auth/provider 확인·별도 PostgreSQL rehearsal·운영 적용 승인·사용권이 필요하다. USD 경제변수 모형과 검증된 USD benchmark/risk-free 데이터 정책은 별도 모델 계약/코드 작업이며 단순 출시 승인만 남은 것으로 표현하지 않는다.

범위는 전체 소유 계좌와 단일 계좌 중심이다. 선택 종목과 계좌가 혼합된 portfolio group은 현금/처분 경계를 검증하지 않은 상태에서 완전 성과·매도 손익을 표시하지 않는다. 이 그룹 전용 경계 확장은 별도 코드 작업이다. 기존 KIS 기업행위 검증의 미확인 구간도 자동 복원하지 않는다.
