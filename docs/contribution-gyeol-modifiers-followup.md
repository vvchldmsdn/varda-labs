# 추가투입 정책 원본 대조 및 계산 근거 연결

검토 기준: Cairn 운영 코드 `99da6fe`와 Gyeol `6c9183e` (2026-09-27). 운영 DB/API 호출이나 데이터 수정 없이 로컬 코드와 격리 검증으로 확인했다.

## 원본의 실제 연결 경로

Gyeol의 `base44/functions/calcRebalanceRecommendation/entry.ts`가 권위 있는 계산 경로다. `src/components/portfolio/desktop/visual/CreativeContributionScreen.jsx:165`, `PortfolioDashboardDesktop.jsx:378`, `mobile/ContributionScreen.jsx:220`에서 호출한다. 별도 `RebalancingCalculator` 화면은 이 정책의 근거가 아니다.

아래 라인은 Gyeol 원본 기준이다.

| 항목 | 원본 위치 | 확인된 정의 |
|---|---|---|
| FX 백분위 | 490–496 | 마지막 min(252,N)개, 현재 값 이하의 관측 수/N. 60–251개도 실제 분모 사용 |
| FX 승수 | 511–614 | percentile × trend × stretch × exposure, clamp 0.55–1, 소수 3자리. stretch 0.5% 이상 0.98 포함 |
| FX 상태 | 592 | multiplier ≤0.75 HOT, ≤0.90 CAUTION |
| 설정 우선순위 | 887–905, 951–963 | 사용자 설정/기본값, 자산 trim override 우선. 기본 trim 12%, minimum 85% |
| RC | 199–209, 1059–1063 | 현재 비중과 공분산의 signed 위험기여율. 90관측. 목표 대비 1.2배 0.90 / 1.5배 0.85 |
| 뉴스 | 267–272 | overall sentiment를 0–100 변환 후 bearish 비중으로 추가 감점 |
| regime | 275, 1150–1160 | macro 50%, portfolio 35%, news 15%. 70/45 경계로 안정/주의/경계 |
| 성과 관찰 | 212–213, 1048, 1065–1069, 1171–1174 | KODEX200 비교 alpha90, alpha252가 모두 음수이고 signed MDD ≤−10%일 때 0.90 |
| minimum | 1181–1191 | min(설정, 안정85/주의65/경계40), FX_HOT이면 **10%p 차감** |
| 그룹 | 1350–1455 | 그룹 합산 목표, 내부 전체 MA 아래이면 0.50, trim threshold 평균, 합산 손익, 가중 FX, signed RC 합산 |
| raw/penalty | 1521–1603 | raw 부족액 비례 → 5승수 곱(4자리) → minor unit 반올림 |
| 조건부 보충 | 1647–1737 | raw>0, 남은 부족액>0, penalty≥0.85, 기본 MA priority 1인 후보. raw/전체raw 비율40 + penalty25 + target 대비 부족률20 + MA10 + FX5 |

원본 `execution_mode`는 계산 함수에서 읽지 않는다. 그룹 결과를 차트에 투영하는 `buildAfterValueMap:696–709`는 현재 평가액 비례 분배지만, 이는 실행 지시나 그룹 구성종목별 손실매도 보호 규칙이 아니다. 원본에는 별도 USD 자금 정책도 없다.

## 이번에 연결한 범위

- 기존 v1 기본 계산을 그대로 유지하고, 명시적인 근거 입력이 있을 때 `gyeol_fin_explainable_rebalance_v2`를 사용한다. 원본의 FX·RC·regime·event·performance 수식을 공통 엔진에 추가했다.
- 단계는 TRIM → MA 목표 → 부족액 raw → 5승수 감액 → 자격 있는 후보만 조건부 보충이다. 감액 후 전 자산에 다시 나누지 않는다. 보충은 후보별 부족액 상한 및 확정적인 key tie-break를 지킨다. 후보가 없거나 용량이 소진되면 현금으로 남긴다.
- 사용자 요청의 기존 원 단위 floor/최대잔여 배분을 유지한다. 원본의 raw 반올림 후 임의 보정과 20회 반복 제한은 복사하지 않았다. USD는 기존 minor-unit adapter를 이용한다.
- `additional-contribution-modifiers` 서버 조회는 실제 tenant transaction으로 자산 분류와 계좌 regime을 읽는다. regime은 같은 계좌·비표본·최신 3일·필수 driver가 모두 있는 단일 행만 인정한다. 전체 계좌에 특정 계좌 regime을 빌려주지 않는다.
- FX는 기존 승인된 공통 조회를 이용한다. 단일 source의 날짜별 관측을 중복 제거하며 미래 수집·오래된 자료·60개 미만을 제한한다. MA120 없는 구간은 120일 평균을 만들지 않는다.
- RC는 공통 위험 엔진의 완전한 90일 KRW 공분산을 현재 평가액 비중으로 다시 계산한다. USD RC로 이름만 바꾸지 않는다. Gyeol은 log return, Cairn 공통 엔진은 기존 수익률 계약을 사용하므로 원본과 동일 시계열 결과라고 주장하지 않는다.
- 성과는 실제 공유 가격 SQL → 기존 가격 admission → 순수 Gyeol 성과 helper → 동일 5승수 엔진으로 연결했다. KRW 국내 양수 보유 전체와 KODEX200(069500)의 최신 253개 날짜가 정확히 같고 최소 두 종목이며, 동일 공급자·출처의 검증된 수정주가일 때만 현재 평가액 비중의 log return으로 beta·alpha90/252·signed MDD90을 계산한다. beta를 먼저 소수 두 자리로 반올림하며 alpha와 MDD도 원본처럼 두 자리다. 요청 시각만 바뀌면 저장 계획의 근거 버전이 바뀌지 않도록 실제 수집 시각을 보존한다.
- legacy USD 원가에는 취득 시점 FX가 없으므로 현재 환율로 만든 KRW 원가를 매도 근거로 쓰지 않는다. 그 행의 매도 판단만 보류한다. native 계획은 기존 dated cost lots와 취득 시점 FX를 그대로 사용한다.
- 실제 자금 통화는 새 투자금·선택 예수금·가상 매도대금까지 포함한다. USD 자금/매도대금이 있으면 KRW 환전 진입 정책을 적용하지 않고 해당 승수 및 minimum을 미확정으로 표시한다. 표시 통화가 이 결정을 바꾸지 않는다.
- native 저장은 사용자·보유 sequence를 다시 확인하고, owner lock 안에서 승인된 목표 revision/hash/version도 확인한다. 클라이언트 preview 근거 버전과 달라졌으면 서버 최신 근거로 계산해 저장하고 이를 알린다. 저장된 계획의 통화·원가·정책·근거는 이후 표시 통화 변경으로 재작성하지 않는다.

## 미확정과 미연결을 숨기지 않는 범위

| 항목 | 실제 상태 | 추가로 필요한 근거/결정 |
|---|---|---|
| event | 수식 구현, 실데이터 적용 보류 | 저장된 단일 news sentiment는 원본 bearish 비중 조정 점수와 다름. 해당 구성 데이터 필요 |
| performance | 실제 가격 SQL·공통 엔진 연결 및 격리 DB 검증 완료 | 동일 날짜 253개·동일 출처의 검증된 KRW 수정주가 전체 커버 필요. KIS 원시 종가만 있는 경우, 외화·누락·오래된 자료는 미적용 |
| USD RC | 해당 승수 미제공 | 동일 통화 기준의 검증된 공분산 공급 경로 필요 |
| USD 자금 FX | 해당 승수/minimum 미확정 | USD 보유자금·KRW/외화 매도대금에 대한 명시적 원본 정책 없음 |
| 그룹 실행 | 기존 승인된 자산별 목표 벡터 유지 | 그룹 내부 실행 모드, 종목별 손실 보호와 잔여금 정책을 별도로 확정해야 함 |
| 자산 trim override | 공통 엔진 입력 지원 | Cairn 현재 DB에 Gyeol 해당 설정 필드가 없으므로 저장된 값을 지어내지 않음 |

자료가 없는 승수는 계산상 미적용 값 1과 `unavailable` 사유를 함께 가진다. 관측 결과가 중립인 `ready:1`과 구분한다. 자료가 부족한 후보는 조건부 보충 대상에서 제외한다. unknown/minimum을 충족했다고 표시하지 않는다.

### 뉴스·성과의 실제 연결과 남은 근거

- **뉴스는 실제 저장 근거가 부족하다.** Gyeol `calcRebalanceRecommendation/entry.ts:269–272`는 `NewsSentimentDaily.overall_score`와 `bearish_ratio`를 함께 사용한다. 같은 파일 `:1163` 및 `calcMarketRegime/entry.ts:241`이 저장한 `MarketRegimeDaily.news_sentiment_score`는 보정된 0–100 `newsScore`가 아니라 원래 `overall_score`다. Cairn `scripts/import-base44-market-context.mjs:294–296`은 이 값을 그대로 옮기며, `src/db/schema.ts`에는 `NewsSentimentDaily`/`bearish_ratio` 저장 계약이 없다. 따라서 현재 regime 필드를 0–100 event 입력으로 재사용하거나 bearish=0을 가정하지 않는다. 원본 두 입력과 시점/출처를 보존하는 추가 저장·조회 연결이 필요하다.
- **성과 연결은 완료했지만 자료 승인 경계는 유지한다.** Gyeol `:196,212–213,1048–1069` 공식은 `src/lib/additional-contribution-performance.ts`에 있으며, `src/db/queries/additional-contribution-performance.ts`가 기존 `loadPortfolioRiskPriceCandidates` 실제 SQL·가격 admission/preferred selector를 재사용한다. 기존 `benchmarks: []`를 임의로 채우거나 Lab의 현금흐름 조정 실현 성과를 이 가상 고정 비중 alpha로 대체하지 않는다. KRW 현재 평가액으로 가중하고 외화는 현재 FX로 과거 가격을 바꾸지 않고 제외 사유를 반환한다. 수정주가와 원시 종가를 이어 붙이지 않으며, shared KIS raw history의 `recommendation: forbidden`은 MA의 별도 bounded-overlay 예외를 성과까지 자동 확장할 근거가 아니므로 원시 종가만 있으면 성과 승수는 `unavailable`이다. 실제 운영에서 승인된 수정주가·benchmark 자료가 충분한지는 이번 로컬 검증으로 확정하지 않았다.

## 재현과 검증

- 수정 전 `additional-contribution-modifiers.test.mjs`의 경계 regime 사례는 50,000+50,000원으로 실패했다. 수정 후 raw 50,000씩 ×0.70 = 35,000씩, 잔여30,000원으로 통과한다.
- `tests/additional-contribution-modifiers.test.mjs`: 중립과 누락 구분, 59/60/252 FX, 0.55 clamp, 10%p HOT, signed MDD/RC, 후보 없음/단일 후보/cap/remainder/tie, USD cent 및 USD 매도대금 경계.
- 계좌 A의 보유자산과 현금만 있는 계좌 B의 1,000원을 전체 범위에서 함께 사용하면, 수정 전에는 1,000원 매수가 허용되는 실패를 재현했다. 선택한 양수 현금과 보유자산의 계좌 합집합을 검사해 차단한다. 사용하지 않는 현금은 차단 사유가 아니며 같은 계좌 현금은 사용할 수 있다.
- `tests/additional-contribution-modifier-read.test.mjs`: PGlite 내 실제 tenant transaction, regime/assets SQL 및 RLS → 실제 공통 RC/정책 엔진. FX·위험 시계열 및 성과 연결 사례의 가격 후보 반환은 고정 fixture로 대체한다. 실제 가격 SQL은 아래 별도 PGlite 검사에서 확인한다. 기대 raw50,000씩, FX0.634·regime0.70인 US22,190원 + 국내35,000원 =57,190원, 현금42,810원. 타 소유자·불완전 driver·stale/mixed-source FX·USD RC도 확인한다.
- `tests/additional-contribution-performance.test.mjs`: 실제 shared historical price SQL·Drizzle·PGlite → 기존 admission → 성과 helper. 가중치 75:25의 독립 폐쇄식 기대값 alpha90 −12.63%, alpha252 −31.48%, MDD90 −13.37%를 검증했다. beta를 1.234에서 1.23으로 먼저 반올림한 alpha, 정확한 날짜 정렬·253개 관측·표본/미래 수집·출처/공급자 혼합·상충 가격·외화·원시 종가 제한과 요청 시각만 바뀐 새로고침도 확인한다. modifier-read의 연결 회귀는 수정 전 항상 `unavailable`로 실패했고, 수정 후 실제 정책 엔진의 성과 승수 0.90으로 통과했다.
- `tests/native-contribution-plans.test.mjs`: 실제 API/query/writer 및 PGlite RLS, 저장/재시도/중복/외부 소유자/비활성 사용자/목표 버전 경합. 외부 인증 경계와 native context 반환은 test ports로 대체한다.
- `tests/additional-contribution-query-integration.test.mjs`: 실제 legacy query→공통 엔진, KRW 기존 값·null/0 설정·MA·외화 과거원가 부재 보호.
- `scripts/reliability-contribution-ui-cases.mjs`: 기존 isolated full-app 실행기에 연결한 실제 목표 저장→감액 미리보기→근거 변경→서버 계산·저장→영어 전환·새로고침 흐름. 한/영 각각 1440/390/320px 근거 패널 스크린샷과 overflow를 검사한다. 실행 결과는 해당 full-app 보고서가 권위다.

PGlite는 격리된 PostgreSQL 엔진이지만 운영 Neon의 네트워크/서버리스 세션 및 실제 공급자·외부 인증을 검증한 것은 아니다. 운영 DB 변경, 새로운 수집 작업, 비밀값, 주문, 배포는 이 구현에 포함하지 않았다.

### 실제 앱 브라우저 검증 기록

`output/reliability-fullapp/local-ZtnX1V/browser-rerun4/report.json`: PostgreSQL 17.11 및 실제 Next production build에서 10개 여정 PASS. 기존 매수·매도·재시도·소유자 전환·과거 거래/History 흐름과 함께, 목표비중 Server Action 저장 → 10,000원 raw ×경계0.70 = 매수7,000원/현금3,000원 → 서버 regime 변경 → 저장 시 매수10,000원/현금0원으로 재계산·변경 안내 → 영어 전환/새로고침/저장 계획 복원을 확인했다. 계획 저장 후 보유10주·현금101,000원이 바뀌지 않았음도 실제 DB로 검사했다.

- native 한/영 각각1440/390/320px, legacy 계산 모달 한/영 각각1440/320px에서 실제 입력/열기/언어 전환 및 viewport 가로 넘침 검사를 통과했다. 같은 폴더의 `contribution-*.png`가 캡처다.
- 앱 writer/query/engine/RLS는 실제 코드다. 외부 인증 완료 subject만 폐기 source copy에서 대체하고 Neon 전송만 로컬 PostgreSQL로 연결했다. 외부 시장 데이터/API·운영 DB는 사용하지 않았다. 실제 이메일/OAuth는 미검증이다.
- fixture category를 금융 writer guard 활성화 후 직접 바꾸던 첫 테스트 준비 오류는 초기 seed로 옮겼다. 접힌 부모 상세를 열지 않던 브라우저 selector도 사용자 조작 순서에 맞게 수정했다. 앱의 보호 장치나 계산을 완화하지 않았다.
- 이 브라우저 build 이후 추가된 성과 근거 query 및 동일 ID 재시도 보완의 최종 소스 검증은 전체 작업의 최종 build/회귀 기록을 별도로 따른다. 검증 서버와 폐기 DB는 종료했다.
