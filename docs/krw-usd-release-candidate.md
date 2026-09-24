# KRW/USD phase 2 — 코드 Release Candidate 검토 기록

2026-09-20. 작업 위치: `.worktrees/krw-usd-foundation`, branch `codex/krw-usd-foundation`, 기준 HEAD `59ea52a78873ec39348afedea9fe0e4afbd0d3a7`. 기존 미커밋 phase 1/2와 UI 변경을 보존했다. 원격 master는 이번 조회에서 `3a081f9922d2c20e7eaf0d8decae1589c88a7fa0`였으며, 앞서 배포한 UI 변경을 이 작업에서 되돌리지 않았다. 이 기록은 배포 승인이나 실제 공급자 검증 결과가 아니다.

## 1. 실제 연결 상태와 이번 추가 구현

| 기능 | 실제 연결 | 공통 엔진/검증 | 명시적 제한 |
|---|---|---|---|
| Home / Today | 인증된 원장·계좌·보유 DAL → native projection → 통화 평가 | 실제 writer/query/PGlite, 통화별 현재값·거래·원가·기여도 | 시세/FX 근거 누락은 제한. 기업행위 확인은 아래 Twelve 경로와 유지된 KIS 경로를 구분 |
| History | 계좌별 immutable snapshot + 원장 당시 수량·FX·외부자금 | 실제 snapshot writer와 Modified Dietz | 기존 원화 합계를 USD 이력으로 변환하지 않음. 근거 없는 과거 기록 생성 없음 |
| Structure | 동일 평가 근거와 실제 종가/FX 연구 입력 | 공통 통화 수익률/risk 엔진 | 미확인 금리·benchmark의 Sharpe/beta만 미제공. 부분 소계를 전체100%로 만들지 않음 |
| Contribution | 계좌·통화별 실제 현금/원가/목표/정책 → 저장 계획 | 기존 공통 정책 + KRW원/USD센트 배분, PGlite 저장·재시도 | 표시 통화가 저장 계획의 매도 판단을 재작성하지 않음. 원가 불명 매도 금지 |
| Lab | 실제 계좌 원장·이력/외부자금 → 공통 비교 엔진 | 실제 조회 + 동일 통화 비교/Modified Dietz | 금리 근거 없는 max-Sharpe 후보 제한. 결과는 가상 비교 |
| Simulation | 실제 계정 조회로 구성한 통화별 수익률 → 공통 연구 엔진 | 1,000-path bootstrap, 경제모형은 별도 admission | USD 경제모형 미지원. 1,000경로 자체가 macro 모델 검증 근거는 아님 |
| 금액만 입력한 사용자 | 인증 전 draft → activation API → owner별 portfolio_drafts → QuickHome | 실제 writer/query/PGlite, 공개 브라우저 입력 복원 | 평가금액·통화·시각 기반 구성. 수량·거래·원가·실제 성과를 생성하지 않음 |

이전 [phase2 구현 기록](krw-usd-phase2-implementation.md)의 연결을 재사용했다. 이번에는 기업행위 당일 상태/비율 방향, 혼합 그룹, 모형 근거, 금리 없는 위험지표를 보완했다. 별도 USD 앱/평가 엔진·운영 tenant·Demo 저장 예외는 만들지 않았다.

그룹 통합 검사에서 거래 시점 FX 조회가 오래되지 않은 이전 snapshot FX에 가려지는 오류도 수정했다. 거래·원가·외부자금의 실제 날짜 FX를 읽고, 다른 표시 통화에서 이미 수집된 정확한 날짜 FX도 재사용한다. 저장 snapshot의 당시 FX는 그대로 보존한다.

## 2. USD 경제모형과 3. benchmark/risk-free

[모형별 전체 계약](usd-model-dependencies.md)에 engine ID, factor 정의·출처, 보정 기간, seed, 공분산/상태 전이, 수익률/FX 기준을 기록했다.

- KRW 경제모형의 기존 수학·seed는 보존한다. 결과에 reporting currency, KRW simple-return/log transform, 실제 factor source/import 정보, 보정창, policy/model ID를 고정한다. 저장되지 않은 publication timestamp/vintage는 null이며 검증됐다고 표시하지 않는다.
- USD 경제모형은 **미지원**이다. USD calibration·정확한 vintage/공개시각·정책이 승인되지 않았으므로 KRW 모형을 이름만 바꿔 실행하거나 현재 환율로 나누지 않는다.
- USD 기본 bootstrap/구성/평가/가능한 비교는 계속 사용한다. 실제 USD 종가·FX·기업행위 이력이 부족하면 해당 결과만 제한한다.
- 선택적 benchmark/rate 계약을 공통 연구 엔진에 연결했다. 통화, 기간 endpoints, price/total-return 의미, FX 정책, 관측/수집 시각, source/definition/maturity를 확인한다.
- 실제 loader에는 아직 승인된 KRW/USD reference dataset이 공급되지 않는다. 두 통화 모두 근거 없는 Sharpe/beta/comparison은 unavailable. 기존 위험 화면과 연결된 Lab의 0% rate/KODEX·VOO fallback도 제거했다. 변동성·낙폭·분산도·다른 후보 계산은 유지한다.

근거: `src/lib/currency-reference-evidence.ts`, `currency-research.ts`, `simulation-owner-economic-research.ts`, `portfolio-risk-read-model.ts`; `tests/currency-reference-evidence.test.mjs`, `currency-model-provenance.test.mjs`, 기존 economic/risk/optimizer 회귀.

## 4. 기업행위

- 같은 날 가격과 분할이 도착하는 순서를 분리한다. action-only queue는 raw history와 별도 작업이며 미완료 거래일의 종가를 만들지 않는다.
- pending/provisional, 공급자 충돌, 보유 수량 불일치, 기업행위 이후 가격 대기를 구분한다. 다음 날짜의 유효 확인 전에는 정상 평가로 확정하거나 snapshot을 저장하지 않는다.
- **설정과 상장 매핑이 유효한 Twelve 경로에서 같은 뉴욕 날짜의 기업행위 응답은 빈 목록이어도 provisional이다.** 이전부터 보유한 해당 미국 종목의 당일 실시간 평가가 다음 뉴욕 날짜의 확인까지 미제공될 수 있다. 이는 검증된 실시간 미국 시장 지원이 아니라 보수적인 지원 제한이다.
- Twelve가 비활성이거나 상장 매핑이 없으면 기존에 허용된 KIS 현재가 경로는 유지한다. 이 경로를 Twelve 기업행위 검증 완료로 표시하지 않는다. KIS 연구 이력의 기업행위 근거는 unknown으로 남아 해당 연구 결과를 제한한다.
- 실제 오류였던 공급자 split factor와 원장 수량 비교 방향을 바로잡았다. 2:1/1:2를 각각 검증한다. raw가격 + 실제 수량을 사용하고 수정가격/수량을 이중 적용하지 않는다.
- 당일 action-only 응답은 관측 버전으로 저장한다. 과거 as-of와 저장 snapshot은 보존한다. 기존 과거 이력 수집의 상충 응답은 conflict로 격리한다. 동일 사건 정규화와 중복 저장 차단을 유지한다.
- 공급자 배당액은 사용자 실제 입금이 아니다. 원장에 사용자가 기록한 현금 배당만 성과에 반영한다. 연구 가격은 split-only이며 배당 재투자 series와 섞지 않는다.
- symbol change/merger/spinoff 자동 원장 전환은 미지원. 같은 ticker의 모든 미지원 사건을 검출한다고 주장하지 않는다.

코드·사용권·실환경 packet: [공급자 준비 기록](krw-usd-provider-readiness.md). 근거 테스트: `native-service-integration.test.mjs`, `twelve-data.test.mjs`, `twelve-data-storage.test.mjs`, `twelve-data-collection.test.mjs`. 외부 HTTP는 합성 응답, DB·tenant transport는 PGlite, 서버 설정과 Next after는 격리된 시험 경계로 대체했다. writer·SQL queue/store/query·평가는 실제 구현을 사용한다.

## 5. 혼합 그룹 성과

새 그룹 규칙을 별도의 매매 정책으로 만들지 않고 기존 선택 범위의 금융 경계를 명시했다.

- **계좌 전체 선택:** 해당 계좌의 보유 종목과 KRW/USD 현금을 포함한다.
- **개별 종목 선택:** 해당 보유만 포함한다. 계좌 현금을 임의 비례 배분하지 않는다. 계좌와 종목의 중복 선택은 한 번만 포함한다.
- 개별 종목 매수 gross+fee는 그룹으로 들어오는 자금, 매도 net/외부 현금에 지급된 linked dividend는 나가는 자금이다. 외부에서 낸 linked fee는 들어오는 자금으로 처리해 투자 수익에서 비용을 차감한다. 선택한 두 whole-account 간 현금 이동은 내부 이동이다.
- 종목 귀속이 없는 partial-account 배당/비용은 그룹 성과만 차단한다. 현재 구성은 계속 표시한다. 입력 화면에 선택 가능한 관련 종목 필드를 연결했다.
- 분모/시각 가중은 기존 Modified Dietz를 그대로 사용한다. 모든 구성요소를 같은 reporting currency/as-of로 평가한다. 계좌별 snapshot 시각이 다르면 하나의 그룹 시점으로 임의 결합하지 않는다.
- 연구 DAL과 화면도 `selected_group` 경계를 보존한다. 기간을 바꾸어 재계산한 그룹 성과를 계좌 현금 전체가 포함된 성과로 표시하지 않는다.
- 현재 membership의 마지막 변경 이후만 비교한다. 현재 종목을 과거에 소급 포함하지 않는다. 기록된 원가/원장/FX를 덮어쓰지 않는다.
- 지원 안 되는 자산·알 수 없는 현금·찾을 수 없는 member는 전체 평가/비중/성과에서 빠진 사실을 남긴다. 확인 가능한 소계와 제외 개수를 표시하며 제외 비중을 모르면 null. 확인된 일부를 전체100%로 재정규화하지 않는다. 실현손익도 같은 completeness를 적용한다.
- 금액 입력 draft는 실제 asset ID/quantity가 없어 group membership으로 몰래 편입하지 않는다. QuickHome의 구성 분석을 유지한다. 이를 실제 원장 그룹 성과와 자동 혼합하는 기능은 제공하지 않는다.

코드: `native-group-scope.ts`, `native-portfolio-projection.ts`, `currency-tracked-portfolio.ts`, 실제 `db/queries/currency-tracked-portfolio.ts`·`native-portfolio-ledger.ts`·`native-portfolio-snapshots.ts`. 그룹 DTO로 부분 계좌 snapshot을 저장하지 못하게 차단한다.

고정값 검증: whole-account cash $50 + direct holding2×$125 = **$300**. 다음 시점2×$135+$50 = **$320**, 선택종목 현금배당$5가 제외된 계좌 현금으로 지급되면 그룹 수익은 **$25**. 시작FX1400/종료·배당FX1260일 때 시작₩420,000/종료₩403,200, 그룹 수익은 **−₩10,500**. 실제 writer/SQL membership/RLS/provider fixture/store/query/snapshot을 통과한다. 별도 순수 테스트는 혼합 KRW현금, 중복 선택, 내부 이동, 매매·수수료, 미귀속 소득, membership 변경과 missing member를 검증한다.

## 6. DB 검증 차이와 7. 실제 Auth/Provider

- PGlite는 실제 SQL/migration/writer/query와 owner/RLS 조건의 통합 근거다. 실제 PostgreSQL 다중 연결·advisory lock 대기·네트워크·Neon pooling 근거는 아니다.
- [PostgreSQL 리허설 실행기/사례/54개 migration 검증](krw-usd-rc-rehearsal.md)을 준비했다. URL이나 기존 data directory를 받지 않고 직접 만든 새 loopback cluster만 허용한다. 현재 PostgreSQL binary와 pg TCP driver가 없어 실제 실행은 NOT RUN이다.
- [실제 인증 검증 절차](krw-usd-rc-auth-validation.md)는 이메일/OAuth/취소/만료/계정변경/재시도를 구분한다. 실제 이메일·OAuth 완료는 NOT RUN. 기존 PGlite 검사에서 대체한 인증 지점을 명시했다.
- Twelve 실제 계약/자격 증명/청구 크레딧·응답 coverage는 미검증이다. 기본 비활성, 기존 KIS 경로 유지, 공개/오류 fallback으로 활성화하지 않는다.

## 8. Migration과 rollback

0048~0053별 additive 여부, 기존 row 기본값, backfill·nullable·index·lock·old-app 호환 표와 중단 절차는 [migration 계획](krw-usd-rc-rehearsal.md)에 있다. 0047 합성 KRW 원자료를 둔 전체0000~0053 PGlite 적용/보존 검사도 포함한다.

원본을 새 값으로 덮어쓰는 blanket backfill은 없다. 근거 없는 native state/원가/과거 FX는 null로 남긴다. future backfill은 별도 승인 후 dry-run→count→sample→bounded batch→post-check 순서다. 이미 새 원장/공급자 작업이 생긴 뒤 pre-phase2 코드로 단순 롤백하면 legacy writer·공유 queue 경계가 손상될 수 있다. 장애 시 새 공급자/쓰기 중단, 호환 schema 및 보호 코드 유지, 상태 대조 후 별도 승인된 복구를 사용한다. migration 파일 삭제나 기존 데이터 삭제는 rollback이 아니다.

## 9. Release gates

최종 통합 검사 결과다. PASS는 이 문서에 명시한 지원 범위의 코드 기준이며 외부 서비스 출시 검증을 포함하지 않는다.

| Gate | 상태 | 근거/남은 조건 |
|---|---|---|
| 1 — code/model complete | PASS | 연결된 writer/query/engine과 독립 검토 완료. USD economic·미공급 reference dataset·미지원 기업행위는 명시적 제외 범위 |
| 2 — full tests/lint/build | PASS | 전체 2,823/2,823, 전체 lint·Production webpack build, desktop/mobile 브라우저 검증 통과 |
| 3 — isolated PostgreSQL rehearsal | BLOCKED | native PostgreSQL binary와 TCP driver 부재. 다중 연결 미실행 |
| 4 — real auth journey | NOT RUN | 승인된 격리 auth 환경에서 이메일/OAuth 완료 필요 |
| 5 — provider contract/credentials | BLOCKED | dataset별 사용권·보관·표시 허가·자격증명·실사용량 검증 없음 |
| 6 — migration approval | BLOCKED | 운영 적용 미승인 |
| 7 — deployment approval | BLOCKED | commit/push/deploy 미승인 |

### 최종 로컬 검증 기록

- 전체 테스트: **2,823/2,823 PASS**, fail/cancelled/skipped 0, 최종 실행 622초. 첫 실행 2,818개 중 2,817개 통과, 신규 리허설 도구 2개의 writer 목록 분류 누락 1건을 수정했다. 운영 writer registry를 확대하거나 검사 자체를 제거하지 않고 기존 rehearsal-only 목록에 정확한 두 경로만 추가했다.
- ESLint 전체 코드 검사와 Production webpack build: PASS (`output/**`의 생성된 QA 산출물은 lint에서 제외). 마지막 그룹 표시 변경도 별도 대상 lint/Structure UI 검사를 통과했다. `build:vercel` 또는 migration 명령은 실행하지 않았다.
- 공개 화면 Playwright: 1440/390/320px에서 16개 검증 모두 최종 PASS. 첫 화면 compile 중 12초 reload timeout 1건은 동일 입력 복원 경로의 단독 재실행에서 통과했다. 브라우저 JS 오류 0건, 가로 넘침 없음. 외부 Analytics 요청은 차단했다.
- 실제 원장/계획 컴포넌트 Playwright: 16/16 PASS. 시작 잔액, 사후 원가, 소수 매수, 전량 매도/재매수, 계획 저장·새로고침·삭제 실패/재시도, 종목 연결 배당·수수료를 확인했다. 실제 API/writer와 PGlite를 사용하되 session·시세·FX·계획 정책·snapshot 자동 저장 포트는 시험용으로 대체했다. 이 검사는 실제 이메일/OAuth 성공의 근거가 아니다.
- PostgreSQL 준비 검사: 8/8 PASS와 validate-only PASS(54개 migration). 실제 TCP 다중 연결 실행은 NOT RUN이다.
- 그룹 성과 표시 추가 검사: 실제 연구 컴포넌트에 합성 `selected_group` DTO를 주입하여 1440/390/320px·한국어/영어 표시와 가로 넘침을 확인했다. 3개 크기 모두 PASS, JS 오류 0건. 이는 그룹 DAL 통합 검사를 대신하지 않는 표시 검사이며 `output/phase2-resume/rc-group-browser/report.json`에 기록했다.
- 로컬 Production 빌드 인증 경계: private ledger/reporting/research의 preview 쿼리도 로그인으로 이동하고 원장/계획 API가 비회원 401을 반환하는 5개 검사 PASS. 처음 검증 스크립트가 로그인 URL에 쿼리가 있다고 가정한 오류를 실제 route에 맞춰 수정했다. 앱 보호 코드를 바꾸지 않았으며 `output/phase2-resume/rc-production-boundary.json`에 기록했다.
- 관련 근거: `output/phase2-resume/rc-full-tests-final.txt`, `rc-lint-final.txt`, `rc-build.txt`; `output/playwright/krw-usd-rc/public/report.json`, `public-retry/report.json`; `output/phase2-resume/rc-native-browser/report.json`. 모두 로컬 합성 QA 산출물이며 commit 대상에 자동 포함하지 않는다.

브라우저에서 실제 사용한 로컬 주소와 행동:

| 주소 | 테스트 상태·행동 | 확인한 결과 |
|---|---|---|
| `http://localhost:3196/try?mode=personal` | 비회원 USD 계획 입력 후 새로고침 | 입력 $700.55/$299.45, 새 투자금 $100.01 및 목표 50/50 복원 |
| `http://localhost:3196/try/analyze` | 비회원 $1,234.56 + ₩1,300,000 입력, 환율1,300 설정, 분석 후 새로고침 | $2,234.56 및 입력 통화/평가 통화와 draft 복원. 실제 보유 수량은 만들지 않음 |
| `http://localhost:3196/?preview=quick-usd` | 개발 전용 합성 금액 입력 Home | $2,234.56, 320/390/1440px 가로 넘침 없음 |
| `http://localhost:3196/portfolio/reporting?preview=currency&currency=USD` | 개발 전용 fixture, 언어와 평가 통화 전환 | USD $1,100 / KRW ₩1,386,000 재계산, 언어와 통화 선택 분리 |
| `http://localhost:3196/portfolio/research?preview=currency` | 개발 전용 fixture, 기간·비중·통화 조작 | 1,000개 기본 bootstrap 경로, 근거 없는 Sharpe/beta 미표시 |
| `http://127.0.0.1:3197/` / `/plan` | 임시 PGlite 컴포넌트 harness | 종목 연결 배당 $5/수수료 $0.25 후 USD 현금 $1,880.00. 계획 저장·재조회·삭제 재시도 |

3196/3197 검증 서버는 검사 종료 후 중지했다. 위 주소는 실제 사용한 테스트 주소이며 계속 실행되는 운영 환경이 아니다. preview URL은 실제 사용자 데이터 검증을 대신하지 않는다. 일반 `/portfolio/ledger`는 비회원 로그인 경계와 API 401을 별도로 확인했다.

## 10. 운영 전에 필요한 정확한 승인

1. 로컬 PostgreSQL 도구/TCP 드라이버 준비 방식과 실행기가 만드는 폐기 가능한 DB 리허설. 운영 DB를 대안으로 사용하지 않는다.
2. 운영과 분리된 실제 Auth QA 환경·지정 계정의 가입/입력 저장/삭제 범위. 이메일/OAuth callback 설정 확인 포함.
3. Twelve dataset별 계약, member/public 표시 범위·캐시/보존, 테스트 자격증명 및 최소 패킷 호출 예산. 실검증 후 Production 활성화는 별도 판단한다.
4. 운영0048~0053 적용 대상·순서·백업/복구·중단창과 사후 검증. 실행 전 read-only preflight 범위도 명시한다.
5. 검토한 전체 diff의 commit/push/배포 범위와 rollout. 현재 작업에서는 어떤 것도 실행하지 않았다.

USD 경제모형 보정, 실제 benchmark/rate dataset 공급, merger/spinoff 자동 처리는 새 모델/데이터 범위 결정이 필요하다. 이를 자격증명만 있으면 바로 켜지는 기능으로 보고하지 않는다. 해당 기능을 명시적으로 제외한 RC의 기본 통화 평가·원장·bootstrap 경로와 구분한다.
