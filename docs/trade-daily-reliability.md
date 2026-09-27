# 거래 기록과 일일 저장의 신뢰성

2026-09-27 · 구현 기준 `e9dee3648db5e36616105c3659b4819e5b867365` · 작업 브랜치 `codex/trade-daily-reliability`

## 작업 경계와 재현

기존 루트 작업과 이전 release worktree의 변경을 보존하며 별도 worktree에 구현했다. 후속 요청은 전용 브랜치 PR·실제 CI·기존 격리 QA Preview를 허용한다. master 병합, 운영 DB 조회/수정, 실제 사용자 거래 복구, 공급자 호출, Production 배포와 설정 변경은 허용 범위 밖이다. 실제 개인 정보 대신 임의 UUID와 합성 종목을 사용한다. 최종 실행 여부는 아래 결과 및 출시 검증 기록을 따른다.

| 기존 문제 | 확인 및 변경 |
| --- | --- |
| A. native 실패가 최종 실행 결과에서 빠짐 | legacy/native 모두 완료 판정과 최종 실행 기록에 포함. 오류는 실패(HTTP 500), 증거 부족/미완료는 보류(409), 완료는 200. 필요한 저장 수만 최상위 집계하고 공급자 수집 결과는 별도 metadata로 유지. |
| B. 같은 날짜 기록이 재시도를 차단 | 단순 시도와 완료를 구분. 실행 backoff와 계좌·날짜·단계·revision별 영속 작업을 사용. |
| C. 불명확한 저장의 ID가 메모리에만 존재 | 첫 요청 전 브라우저에 제한된 초안과 operation ID 보존. 재진입은 조회부터. |
| D. 일반 입력은 snapshot 이전 거래 거부 | guard를 제거하지 않고 기존 매매 화면의 명시적인 과거 추가/정정 경로에서 시작 잔액 이후 원장을 재생. |
| E. 일회성 브랜치 전용 workflow | PR/master의 고정 5개 job으로 대체. 자동 코드 수정·push 권한 제거. |

## 일일 저장과 재시도

- 서비스 구간은 `[D 07:00 KST, D+1 07:00 KST)`. 기존 `snapshot_date`는 **종료 경계 날짜**를 유지한다. 06:59:59.999의 거래는 포함하고 정확히 07:00 거래는 다음 구간이다.
- `daily_snapshot_work`는 계좌·종료일·legacy/native·revision의 유일한 작업이다. 상태, 시도 수, generation, lease, 시작/종료 시각, 짧은 사유, 다음 시도 시각을 보존한다. tenant는 직접 조회/수정할 수 없다.
- 실행 소유권을 먼저 확보한 요청만 작업을 처리한다. legacy와 native의 저장이 모두 끝나기 전에 FX/live quote를 덮어쓰지 않는다. 미완료 계좌가 있으면 이번 실행의 부가 시세 갱신을 보류한다. 기존 공급자 수집 요청 한도는 유지한다.
- 기존 `/api/cron/market-cycle/run` 외에 `/api/cron/snapshots/retry`가 **이미 큐에 있는 저장 작업만** 깨운다. 새 날짜 발견이나 공급자 수집을 수행하지 않는다. 두 경로 모두 기존 관리자 secret·쓰기 활성 조건을 유지하며 HTTP 실패만으로 플랫폼이 재시도한다고 가정하지 않는다.
- 일반 발견 범위는 최근 **3개 종료일**, 한 번에 **300개 발견**, 단계당 **30개 처리/60초**, 전체 신규 처리 시작 한도는 **260초**다. 개별 SQL은 기존 timeout을 유지한다.
- 작업별 일시 실패 최대 **4회**, **5/10/20분** 간격이다. claim은 1회를 예약하며 완료·자료 부족·lock 경합에서는 돌려준다. worker 중단도 예약된 시도를 소비해 무한 재실행하지 않는다. 자료 부족은 `blocked`로 보존하고 자동 재시도하지 않는다. lock 경합은 1분 뒤 다시 시도하되 실패 예산을 쓰지 않는다. 작업 lease는 **90초**. 기존 시장 전체 실행의 5분 backoff·최대 4회·활성 lease 30분은 별개다.
- 수정으로 무효화한 기존 snapshot 날짜는 원장 정정과 같은 transaction에서 큐에 넣는다. 이미 큐에 있는 과거 미완료 날짜는 3일 밖이어도 처리한다. 새롭게 발견할 수 있는 무기록 장기 공백은 3일 범위를 넘지 않는다.
- 완료된 같은 cutoff는 다시 생성하지 않는다. 쓰기 commit 이후 작업 완료 응답만 유실된 legacy snapshot도 기존 확정값을 그대로 보존한다.
- generation 확인과 행 잠금을 실제 금융 쓰기 transaction에 넣었다. lease를 잃은 worker는 금융 쓰기와 완료 기록 모두 실패한다. 원장 owner lock/revision CAS도 함께 적용한다.
- 정정으로 무효화된 평가값은 화면에서 제외한다. 그 snapshot의 원래 가격·환율 근거는 별도 private query로 읽을 수 있으며, cutoff 이전의 허용된 KIS raw 관측만 재계산에 재사용한다. 과거 수량/성과는 재사용하지 않는다. 다른 공급자는 기존 사용권 검증 경로를 통과해야 한다.
- legacy 종합 History는 일부 계좌만 남은 합계를 전체 자산으로 표시하지 않는다.

### 운영상 남은 제한

현재 Production 스케줄은 변경하지 않았다. 하루 한 번 호출이면 5분 backoff가 있어도 그날 자동 재실행되지는 않는다. 자료 복구 또는 일시 문제 해결 후 정확한 owner/account/revision/generation의 작업만 감사 기록을 남기고 재개한다. [재시도 실행·운영자 절차](snapshot-retry-operations.md)를 따른다. 제공된 운영자 CLI는 격리 loopback 리허설 전용이며 운영 DB 실행 도구로 오인하지 않는다. 3일 밖의 미발견 공백을 자동으로 생성하지 않으며 대기량이 처리 상한을 넘으면 다음 실행이 필요하다.

## 불명확한 거래 저장 복구

`trade-operation-recovery.ts`와 기존 `NativeLedgerView`를 연결했다. 기존 quick trade 진입점은 유지한다.

1. 현재 인증 subject의 해시로 구분한 브라우저 저장소에 초안과 UUID를 실제 저장·재확인한 후 전송한다. 다른 탭의 미확인 operation은 덮어쓰지 않는다. Web Locks가 없거나 저장이 차단되면 전송 전에 중단한다.
2. 새로고침/같은 계정 재로그인 시 인증된 API에서 operation을 먼저 조회한다. 미조회/일시 오류를 실패 확정으로 취급하지 않는다. 재시도는 같은 ID·내용만 사용한다.
3. 24시간 이후 금융 초안은 지우고 ID만 남긴다. 정리는 해당 origin에 다음 접근했을 때 수행하며 브라우저가 닫힌 상태의 정시 삭제를 보장하지 않는다. 완료/취소 확인 후 ID도 지운다.
4. 만료된 미확인 요청은 서버에서 저장 여부를 확인하고 안전하게 종료할 수 있다. `native_operation_cancellations`는 ID만 보존한다. 이미 commit된 거래는 취소하지 않고 기존 결과를 반환한다. owner lock과 DB wrapper가 이후 도착한 원래 요청을 차단한다.
5. 다른 계정으로 바뀌거나 인증이 만료되면 조회/취소/저장 응답 모두 이전 화면과 입력을 지운다. 타 사용자 operation은 소유권 확인 없이 조회·재전송할 수 없다.

URL/analytics에 초안, 금액, operation이나 토큰을 넣지 않는다. 새 UUID로 의도적으로 기록한 별개 거래는 같은 종목·수량이어도 별개로 남는다. 종료된 ID tombstone은 지연 요청을 막으므로 임의 삭제하지 않는다. 브라우저 데이터가 사용자가 직접 삭제되거나 다른 기기로 바뀐 경우에는 저장 복구 ID 자동 연속성을 보장하지 않는다.

## 일반 과거 거래 추가·정정

- 실제 native 시작 잔액이 있는 계좌에서 **이미 등록된 종목**의 누락 buy/sell 및 기존 buy/sell 정정을 지원한다. 매매 화면의 ‘과거 거래 추가·정정’에서 이유와 opening에 미포함 확인을 받는다.
- opening 이전/당일 시각 미상, opening 포함 거래, 없는 원본, 근거 없는 legacy/broker recovery, 신규 미등록 종목은 이 경로로 임의 복구하지 않는다. 신규 종목은 입력 단계에서 제한을 표시한다.
- `native-ledger-replay.ts`가 기존 Decimal 원장 엔진으로 매매·수수료·원가와 이후 거래를 재생한다. 0이라고 확인하지 않은 비용이나 원가를 만들어 넣지 않는다.
- 정확한 시각과 date-only 근거는 분리한다. 같은 날 불명확한 순서는 직전 기록을 명시적으로 선택한다. 현금을 맞추려고 순서를 바꾸지 않는다. 확인한 순서가 기존 시각 정책과 양립하지 않으면 정확한 시각 보완이 필요하다.
- 연결된 이체 계좌도 함께 재생하고 양쪽의 금액·통화·시각·방향 근거를 확인한다. 최대 **8개 계좌/500개 유효 이벤트** 범위만 원자적으로 처리한다. 초과분용 비동기 대규모 재생은 이번 구현 범위가 아니다.
- immutable `native_ledger_revisions`에 이유/입력 시각/영향 시작 시각/유효 기록을 보존한다. 원래 event ledger는 삭제하지 않는다. `effective_native_ledger_entries`와 owner/revision CAS로 신규 거래와 충돌을 감지한다.
- 정정과 현재 수량·현금 갱신, 재계산 날짜 큐 등록은 같은 transaction이다. 실패 시 이전 정상 상태가 유지된다. 거래는 저장됐지만 과거 시장 근거가 없으면 해당 파생 평가만 미제공한다.
- native Home/Today/History는 동일 `readNativeLedger`→공통 통화 evidence 경로를 사용해 무효 revision을 제외한다. native 화면에는 현재 종목 heatmap이 없으므로 native 정정의 heatmap UI 검증을 주장하지 않는다. 기존 legacy heatmap은 이 정정 경로의 대상이 아니다.

## 검증 및 근거

주요 검증 파일:

- `tests/trade-reliability.test.mjs`: 독립 기대값, 정정/원본, opening/동시성, 이체/순서, 브라우저 복구 저장소.
- `tests/cron-market-cycle-runner.test.mjs`: legacy/native 전체 상태와 저장 순서, 실패 우선순위, 공급자 보류 예산, 완료 후 중복 요청.
- `tests/history-overview.test.mjs`: 일부 계좌만 남는 날짜를 전체 손실로 표시하지 않음.
- `scripts/reliability-postgres-cases.mjs`: 실제 writer/query/공통 엔진 + 여러 TCP 연결, owner/RLS, 동시 동일 ID/변조, 9주/$1,130, 오래된 worker, 정정/Cron CAS, 경계 시각, 재시도, 완료 응답 유실.
- `scripts/reliability-browser-cases.mjs`: 실제 client component→실제 ledger route→실제 PostgreSQL. commit 응답 차단/새로고침/재로그인/과거 입력/만료 ID/계정 전환. 합성 identity resolver와 rollout admission만 테스트 프로세스에서 대체하고 Next shell/router는 테스트용 최소 shell이다. 전체 Next 탐색 및 실제 OAuth/email 로그인이 아니다.

폐기 가능한 PostgreSQL **17.11**의 새 data directory/랜덤 loopback 포트를 확인하고 실행했다. 이어서 GitHub의 Linux PostgreSQL16 통합 검사도 통과했다. PGlite만으로 통합 통과를 주장하지 않는다. 0058→0059 업그레이드, DDL 실패 rollback, legacy row 보존, 빈 DB 전체 migration을 확인했다.

후속 검증의 현재 결과와 산출물은 [출시 검증 기록](trade-daily-release-readiness.md)을 따른다. 아래 최초 구현 결과와 구분한다. 테스트 서버는 종료하며 보고서의 임시 loopback URL이 계속 서비스된다고 안내하지 않는다.

## migration / 중단 / 복구

추가형 `drizzle/0059_trade_daily_reliability.sql`과 journal/schema를 함께 준비했다. revision·취소·작업 큐·실행 상태 테이블 4개, owner 전용 유효 원장 view, 취소/정정 함수와 DB 쓰기 차단을 포함한다. 기존 행 삭제/금융 원자료 보정은 없다.

운영 승인 후 적용할 절차:

1. 현재 배포/스키마와 0058 기준의 호환성을 다시 확인하고 복구 가능한 DB 백업을 확보한다. 이 작업에서 운영 DB에는 접근하지 않았다.
2. 신규 mutation·worker의 진입을 중단하고 이미 실행 중인 작업을 종료·확인한 뒤 migration을 transaction으로 적용한다. 배포 교체만으로 기존 Cron이 끝났다고 판단하지 않는다. 0059 초기 상태는 `legacy`라 기존 일반 거래는 호환되지만 revision/취소 신규 쓰기는 차단된다.
3. 관리자 전용 `set_trade_reliability_mode('paused', 사유)`로 금융 쓰기를 잠근다. DB의 전환 전용 advisory lock은 이미 쓰기 승인을 받은 transaction이 종료될 때까지 기다린다. 거래·잔액·snapshot·큐의 DB trigger가 이전 deployment/worker까지 검사하므로 UI 버튼 숨김에 의존하지 않는다. 테넌트와 일반 worker에는 mode 변경 권한이 없다.
4. 같은 revision-aware 앱/worker를 배포하고 역할·GRANT를 확인한다. 새 writer는 transaction 안에서 `app.trade_reliability_version=0059`를 설정한다. 이 값은 호환성 표시이며 기존 인증/owner/RLS를 대신하지 않는다. 운영자가 `compatible`로 전환한 뒤 승인된 QA 범위부터 확인하고 일반 기능 활성화를 별도로 승인한다. 이전 writer는 이 시점부터 DB가 거부한다.
5. **첫 revision 또는 취소 tombstone이 데이터 의미의 비호환 지점이다.** 일반 거래는 기존 형식과 호환되지만 `compatible` 모드에서는 오래된 writer를 예방적으로 차단한다. 첫 revision/취소 후 `legacy` 복귀는 DB 자체가 거부한다. 구버전 reader는 정정 전 상태를 읽을 수 있으므로 단순 구버전 배포로 복구하지 않는다.
6. 장애 시 `paused`로 전환하고 새 작업 진입을 중단한다. 원장·revision·취소 ID·snapshot·큐를 보존한 채 호환 reader로 확정 거래를 조회한다. 원인을 수정한 호환 버전의 QA 후 `compatible`로 재개한다. revision 삭제, 역방향 수량 조작, 원본 덮어쓰기, tombstone 삭제는 복구 수단이 아니다.

Production migration/스케줄/기능 활성화/배포는 별도 승인 전이다. 정규 CI 파일은 [CI 실행·필수 체크 연결](reliability-ci.md)을 따른다. GitHub의 실제 다섯 검사는 실행했으며 branch protection 강제 설정은 변경하지 않았다.

## 이전 구현 단계 실행 결과 (후속 보완의 최종 판정 아님)

아래는 9월 25일 최초 구현 단계 증거다. 이후 DB 실행 차단·재시도·실제 Next 흐름이 보완됐으므로 현재 코드의 최종 통과로 인용하지 않는다. 후속 검증은 [출시 검증 기록](trade-daily-release-readiness.md)에서 구분한다.

| 검사 | 결과 / 증거 |
| --- | --- |
| 격리 경계 자체 검사 | 각 job의 `isolation-checks` PASS. 환경·소스 복사·외부 연결 차단을 확인. |
| lint + route typegen + TypeScript | PASS — `lint-type-kKS5wQ/report.json`. 이후 변경한 Cron은 별도 ESLint PASS 및 최종 production build 타입 검사 PASS. |
| 실제 PostgreSQL | PASS — `postgres-integration-Thu7vp/postgres-report.json`. 17.11, 8개 실제 연결, 빈 DB/upgrade/rollback 및 원장·RLS·재시도·늦은 쓰기 검증. |
| 브라우저 | PASS — `browser-journeys-K4SL1s/browser/report.json`. 데스크톱1280/모바일390px, 응답 유실/재진입/정정/만료/계정 전환과 수평 넘침 없음. PNG 실제 확인. |
| 최종 전체 테스트 | PASS — `unit-tests-jUlXqC/report.json`: 2,952/2,952, 실패/skip 0. |
| 최종 production build | PASS — `production-build-IhIMeQ/report.json`. 최종 Cron 변경 포함. |
| 원격 CI / required checks | 미실행. workflow 작성과 로컬 동일 실행기 검증만 완료. |
| 실제 이메일/OAuth/시세 공급자 | 미실행. 외부 인증만 합성 경계로 대체했고 provider는 호출하지 않음. |
| 운영 DB / Cron / 배포 | 미실행. 별도 승인 필요. |

브라우저 실제 확인 주소는 `http://127.0.0.1:50016`이었고 검증 후 서버와 PostgreSQL cluster를 종료했다. 이 임시 주소는 현재 확인용 서버가 아니다. 재현은 [CI 문서](reliability-ci.md)의 browser job을 사용한다. 운영/기존 사용자의 브라우저 세션을 테스트 계정으로 바꾸지 않았다.
