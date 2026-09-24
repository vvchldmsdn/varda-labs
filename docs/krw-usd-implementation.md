# KRW / USD 구현 및 검증 기록

> 1차 당시의 기록입니다. 2단계 실제 원장 연결과 현재 검증 상태는 [후속 기록](./krw-usd-phase2-implementation.md)을 확인하세요.

2026-09-14. 작업 기준은 로컬 `origin/master` 59ea52a이며 별도 `codex/krw-usd-foundation` worktree에서 수정했다. 원래 작업 폴더의 미커밋 변경은 보존했다. 운영 DB·인증·Cron·공급자 키를 사용하거나 변경하지 않았다. commit/push/배포는 수행하지 않는다.

## 기능별 데이터 계약

| 기능 | 필수 근거 | 부족할 때 |
| --- | --- | --- |
| 간편 입력 구성 | 입력 금액·통화·시각, 혼합 통화의 명시된 환산 기준 | 통화별 원본 합계, 미환산 항목 유지. 부분 금액으로 비중 100%를 만들지 않음 |
| 실제 종목 평가 | 실제 소수 수량, 원시 가격·관측 시각, 평가 시각의 FX | 확인 가능한 소계와 제외 사유. 금·현금·기타 기록을 삭제하지 않음 |
| 실제 변동 | 각 시점의 수량·가격·FX, 구간의 거래 완전성 | 평가 차이와 투자 변동을 구분. 현금흐름 불명 시 실제 성과 미제공 |
| 실제 성과 | 포트폴리오 전체 현금 포함 평가, 외부 입출금·통화·날짜 | 기존 Modified Dietz 정의 유지, 근거 부족이면 미제공 |
| 추가투입 | 목표 합계 100%, 평가 통화의 재원·평가. 매도에는 dated 원가·매입 FX | 원가 불명·손실은 매도 제외. MA 통화/가격 기준 불명은 감액하지 않음 |
| 가상 위험·비교·시뮬레이션 | 정확한 종목, 같은 날짜의 가격·FX, 기업행위/가격 기준, 최소 30 수익률 관측 | 전체 입력 범위가 불완전하면 차단. 개인 실제 과거 성과로 표시하지 않음 |

언어는 통화와 독립이다. 기존 KRW v1 저장 JSON을 재작성하지 않으며, 새 입력 v2에 입력 통화·분석 통화·locale·IANA timeZone·asOf·manual 근거를 보존한다. 시각 표시만 사용자 시간대를 사용하며 서비스 기록 경계 07:00 Asia/Seoul은 바뀌지 않는다.

## 연결한 코드

- `src/lib/money.ts`: BigInt 유리수 Decimal, 정확한 native decimal 직렬화, KRW 정수/USD 센트, locale 입력 검증. FX·수량을 미리 반올림하지 않음.
- `currency-valuation.ts`, `currency-performance.ts`: 날짜별 직접/역 FX, 미래·오래된 근거 차단, 원시 수량 평가, 가격/FX/순매매 분해. 가격×FX 교차항은 기존처럼 FX에 귀속. 과거 quote 시각과 현재 평가 시각을 구분하여 폐장 후에도 현재 FX로 평가. 현금흐름의 서비스 날짜와 실제 평가 구간을 함께 검사하며, 실제 거래의 시간 순서도 검증한다. 현금 포함 성과의 설명은 기존 투자종목 경계와 구분하되 Modified Dietz의 날짜 가중 방식을 유지한다.
- `currency-contribution.ts`: 기존 정책을 최소 통화 단위에 적용. dated 원가의 정확한 손실 비교가 Number 반올림 후에도 매도를 차단한다. 12% drift, 105% 도착점, MA120 비율·3% 보간·금/채권 예외는 변경하지 않음. 비용 미포함 기준 환산이며 주문은 실행하지 않음.
- `quick-portfolio.ts`, 첫 방문 UI, activation, draft/plan queries: USD 센트·개별 입력 통화·시간대·원본 시각 보존. 입력→가입 후 복원→Home, 기존 owner/idempotency 검증 재사용.
- `/portfolio/research`: 저장된 owner 입력→공유 시장 이력 admission→가상 구성 위험·비중 비교·1,000개 bootstrap 경로. 통화/날짜/모델/가격 기준/시계열 hash를 구분. 통화 변경은 날짜별 수익률부터 다시 계산한다. 비교지수/무위험 데이터가 없으면 beta/Sharpe는 null.
- `/portfolio/reporting`: 기존 owner-scoped sources의 원본 수량/가격으로 읽기 전용 평가. 종목별 손익/실제 과거 데이터는 별도 근거를 요구한다. 새 공급자 데이터를 기존 KIS admission에 섞지 않음.
- Twelve Data provider와 기존 collection queue 확장: 기본 비활성, 사용권/출시 승인/공유 예산 선예약 필수. 자세한 구현과 공식 출처·문의 초안은 [공급자 준비 상태](krw-usd-provider-readiness.md).

## 중요한 미완료 연결

이 변경은 전 화면의 USD 운영 지원 완료가 아니다.

1. 기존 실제 Home/Today/History/Structure/Lab/Simulation의 KRW read model은 보존했다. 새 USD 입력 Home과 가상 연구 화면은 연결했지만, 기존 실제 과거 손익·경제변수 simulation 전체가 USD 엔진으로 이행된 것은 아니다.
2. `/portfolio/reporting`의 실제 source는 소유 종목만 읽는다. 계좌 현금·과거 원가 날짜·거래/가격 관측 시각을 온전히 복원하지 못하므로 소계만 표시하고 전체 비중·실제 성과·불완전 범위의 매도 계획은 차단한다. 과거 snapshotDate를 실제 가격 관측 시각으로 가장하지 않는다.
3. 기존 KIS FX 응답에는 정확한 환율 관측 시각이 없으므로 새 dated FX 근거로 승격하지 않는다. timestamp가 확인된 ER-API daily reference의 새 쓰기에만 metadata를 보존한다. 기존 행을 소급 보정하지 않는다.
4. 새 raw-price 연구는 기업행위 확인이 없으면 활성화하지 않는다. 원시 가격을 분할 조정/배당 재투자 수익률이라고 표시하지 않는다. 검증된 가격 기준·권리·이력 확보가 실제 분석 출시 조건이다.
5. 전체 계정의 보고통화 설정 저장, 실제 원가/거래의 다중 통화 이행과 full-policy 투자계획 영구 저장은 후속 구현이 필요하다. 이번 저장 대상은 입력 구성과 매수 전용 간편 계획이다. 새 가상 연구는 동일 날짜 벡터의 과거 수익률 bootstrap이며, 기존 경제변수 모형 전체를 USD로 이행했다고 표시하지 않는다.

다음 변경 단위는 (1) 현금·거래·원가의 날짜/통화 근거를 보존하는 쓰기와 전체 평가 읽기 연결, (2) 공급자 provenance 저장기와 실제 수요 기반 큐 연결, (3) 기업행위·FX 이력을 확보한 실제 USD 분석 및 경제변수 모형 이행이다. 어느 단계에서도 기존 기록의 결측을 현재 가격/환율로 메우지 않는다.

## 마이그레이션 / 운영 전환

- `0048_reporting_currency_inputs.sql`: v1/v2 계획 엔진 허용, nullable FX 관측 metadata 추가. 기존 JSON·holdings·거래·RLS 변경 없음.
- `0049_twelve_data_collection.sql`: 기존 예산의 provider/credit 확장과 운영 전용 reservation ledger. tenant 권한 없음, 강제 RLS. 기존 KIS 기본값 유지.
- 운영 적용 전 백업과 테스트 branch rehearsal, 현재 실제 schema와 migration journal 대조, FX 쓰기/읽기 및 예산 권한 검증 필요. 적용 승인은 별도다.
- 롤백은 우선 새 UI/서버 수집 경로를 비활성화한다. v2 데이터가 저장된 뒤 제약을 v1-only로 되돌리거나 열/테이블을 삭제하지 않는다. 원본 보존 후 재배포로 복구한다.
- 데이터/계약이 준비돼도 Twelve Data는 자동으로 켜지지 않는다. verified listing, 사용권/대상 지역·표시/분석/저장 권한, 운영 예산, write admission, 공개 승인 및 실응답 검증을 별도로 완료한다.

## 로컬 확인

운영 연결값이 없는 localhost 전용 서버: `http://127.0.0.1:3165`.

- `/try/analyze`: EN 선택 후 USD, VOO 1,234.56 입력. 혼합 KRW 1,300,000을 추가하면 FX 없을 때 합계 미제공. 명시적으로 1 USD=1,300 KRW 입력 시 $2,234.56.
- `/?preview=quick-usd`: 위 합성 입력의 실제 Home 컴포넌트. 개발 모드 한정이며 가입 성공 검증을 대신하지 않음.
- `/portfolio/research?preview=currency`: KRW/USD 재계산, 실험 비중, 30/126/252 기간, 1,000 경로. 합성 데이터 표시.
- `/portfolio/reporting?preview=currency`: $1,000→$1,100 / 1,400→1,260 예제로 실제 수량 평가·분해 엔진 검증. USD +10%, KRW -1% (비용·입출금 없음).
- preview 없는 개인 경로는 인증 필요. 실제 이메일 인증·운영 저장·실제 공급자 응답은 이 환경에서 검증하지 않음.

검증 로그는 `output/currency-verification/`, 스크린샷과 브라우저 검수 기록은 `output/playwright/usd/`, `output/playwright/usd-research/`에 보관한다.

## 검증 결과

- 최종 전체 `npm test`: **2,676개 통과 / 실패 0 / 건너뜀 0** (353 suites). 추가투입 KRW 회귀, USD +10%/KRW -1%, 기준 통화별 매도 조건, 원가 누락, 소수 금액·수량, 환율 결측/미래/오래됨, 혼합 통화 현금흐름, 분할/배당/공급자 기준, 서비스 경계, 큐·재시도·권한 테스트 포함. 큰 USD 금액의 Number 직렬화 손실은 입력 거부로 처리하며, 금융 금액을 조용히 반올림해 저장하지 않는다.
- 최종 전체 lint 통과. 최종 `next build --webpack` Production build 통과. 로컬 의존성 junction 때문에 webpack을 사용했으며, Windows 하위 프로세스 제한으로 첫 sandbox build가 실패한 뒤 동일한 격리 환경의 허용된 로컬 실행에서 통과했다.
- 최종 브라우저: 1440px 데스크톱, 390/320px 모바일; KRW/한국어·USD/영어·혼합 통화, 소수 입력, 새로고침 복원, 기준 시각 유지, 인증 취소/실패 복귀, 키보드, reduced-motion, 가로 넘침, Home→연구 내 투자 랩/시뮬레이션 실제 이동 확인.
- 로컬 Production 앱에서 `/start`, `/try/analyze`, `/demo/home`, `/demo/today` HTTP 200. 개인 연구/평가 경로에 개발 fixture query를 붙여도 로그인으로 전환되고 fixture는 렌더링되지 않음. Next.js streaming redirect의 최초 HTTP 상태는 200이므로 이를 일반 HTTP 302로 보고하지 않는다. 인증 미설정 상태의 activation API는 503으로 차단되며 저장을 시도하지 않음.
- 메모리 PGlite 및 인증 port 대체 테스트로 USD 원본 저장·복원, 같은 import의 중복 방지, 계정 변경 거부, 다른 owner 조회/삭제 차단, v1 JSON 보존, 0048/0049 SQL의 추가형 제약과 운영 전용 예약 RLS를 검증한다. 실제 외부 인증/운영 DB 검증과 구분한다.
- 미검증: 실제 이메일 가입/인증 복귀, 운영 데이터의 완전성, 실제 사업용 공급자 응답과 커버리지, 서로 다른 PostgreSQL 프로세스의 경쟁/장애 회복, 운영 수집 주기·청구량·장기 데이터 품질. 계약과 운영 변경 승인은 별도로 필요하다.
