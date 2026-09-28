# Cutoff · 추가투입 운영 판단 검토

2026-09-28 KST. 기준 HEAD `99da6fe725cec7d87a625a5b89ef52ea40774d14`,
`codex/cutoff-contribution-followup`. 기존 구현은 다시 만들지 않았다.
이번 후속 작업은 테스트·격리 검증기·검토 문서만 보완했다. 운영 변경 없음.
원래 저장소의 다른 미커밋 작업은 그대로 보존했다.

## 1. 시간의 의미와 현재 운영 상태

관리 API 읽기 확인: **2026-09-27 14:55:39 UTC / 23:55:39 KST**, 팀 플랜 **Hobby**.
canonical Production은 READY, SHA는 위 HEAD와 동일하다. 프로젝트 설정과 실제 배포의
Cron 정의 모두 아래 두 개뿐이다. 사전 수집 일정은 **없음**.

| UTC schedule | KST 의도 | 대상 |
|---|---|---|
| `0 22 * * *` | 07:00 이후 일일 평가 | `/api/cron/market-cycle/run` |
| `0 20 * * *` | 05:00 임시 실행 정리 | `/api/cron/simulation-executions` |

증거: `output/release-readiness/cutoff-current-scheduler.json` (플랜·일정·배포 필드만 저장).
인증값·환경변수·회원 정보는 수집 결과에 포함하지 않았다.

| 시각 | 코드/기록 | 확인 수준 |
|---|---|---|
| scheduler가 HTTP 요청을 실제 발송한 시각 | Vercel request 로그가 필요 | **NOT RUN**. Cron 식은 예정 시각이지 발송 증거가 아님 |
| 함수 진입/실행 시각 | `runCronMarketCycleWithinDeadline`의 `now` → `claimCronMarketCycleRun.startedAt` | 이전 읽기 조회의 최근 5회 07:58:56~58 KST. 함수 프로세스 시작과 완전히 같은 시각이라고 단정하지 않음 |
| 가격 실제 관측시각 | provider timestamp가 검증되면 별도 보존 | KIS 현재가에는 검증된 거래소 시각이 없어 null, `timestamp_basis=collection` |
| 가격 수집시각 | KIS `fetchKisLiveQuotes` 각 응답 body 처리 후 `new Date()` | 합성 응답 완료 검증 PASS; 실 응답 **NOT RUN** |
| FX 관측/수집시각 | `parseExchangeRateOpenAccessUsdKrwResponse`의 publication timestamp와 응답 완료 시각 분리 | 기본 pre-cutoff FX는 **er-api-open daily reference**. KIS FX라고 잘못 설명하지 않음 |
| snapshot 평가 기준 | D일 07:00 Asia/Seoul, 사건 `[T−24h,T)` | 코드/격리 검증 PASS |
| DB 기록 시각 | receipt `stored_at=clock_timestamp()`; snapshot captured/created와 transaction commit은 별개 | 운영 DB의 정확한 commit 시각은 **NOT RUN** |
| 작업 종료 시각 | `finishRun.finishedAt`는 완료 결과 DB 갱신에 넘기는 시각 | 기존 집계 07:59:36~08:00:01. 개별 snapshot commit 시각과 동일시하지 않음 |

07:59에 저장했더라도 유효한 pre07 자료/정확한 공식 종가 fallback으로 평가했다면 저장 지연이다.
07시 이후 live를 이전 cutoff 관측으로 썼다면 평가 기준 오류다. 과거 집계의 completed 표시만으로
어느 경우인지 확정하지 않았으며, 운영 사용자별 금융 원자료를 이번 검토에서 열거나 수정하지 않았다.

현재 Hobby는 15분 관측 창을 충족하지 못한다. 공식 문서는 Hobby를 시간 단위,
Pro를 분 단위 정밀도로 구분한다. [Cron 제약](https://vercel.com/docs/cron-jobs/usage-and-pricing).
아래 권장안도 장애 시각까지 보장하는 SLA는 아니다.

### 권장 설정안 — 기존 Vercel 실행기를 Pro에서 재사용

구매/설정은 **승인 대기**. 새 서비스 도입보다 기존 인증·lease·예산·실행 기록을 재사용한다.

| 선택 | 평가 |
|---|---|
| Hobby에서 pre07 Cron만 추가 | 비용 추가 없음. 시간 오차로 관측 창 보장 불가, **비권장** |
| 별도 상시 실행기 | 해당 실행기/자격증명/신뢰성 운영 근거를 확인하지 못함. 이 저장소의 GitHub workflow는 CI이며 스케줄러가 아님 |
| **Vercel Pro + 기존 endpoint** | 분 단위 예약, 기존 운영 표면 유지. **권장** |

검토용 예약안(아직 `vercel.json`에 적용하지 않음):

```json
[
  { "path": "/api/cron/market-cycle/run", "schedule": "50,56 21 * * *" },
  { "path": "/api/cron/market-cycle/run", "schedule": "0 22 * * *" },
  { "path": "/api/cron/simulation-executions", "schedule": "0 20 * * *" }
]
```

06:50 기본 수집, 06:56 재확인/부분 실패 회복, 07:00 기존 일일 평가. 5분 재시도 제한과
하루 phase별 최대 4회는 유지한다. 성공해도 6분 뒤 수집은 다시 허용되며 비용에 포함한다.
추가 함수 호출은 **2회/일, 약 60회/30일**. 한 번 최대 50개 고유 종목,
국내 KIS 1회/종목, 미국 거래소 탐색 최악 3회/종목, er-api FX 1회, 필요 시 토큰 요청.
보수적 상한은 `2 × (국내N + 3×미국N + FX1 + 토큰1)` 요청/일, N 합계≤50이면 최대 약304회/일.
이는 논리 요청 상한 추정이며 예산·timeout·실패에 따라 실제 성공 수는 적다. 기본 KIS 예산은
분당60회·최소1초 간격이고, 운영 override 값은 이번에 읽지 않았다. token budget도 별도 유지한다.
기존 45초 provider deadline/260초 작업 deadline을 늘리지 않는다. 50개가 전부 수집된다고 약속하지 않는다.

공식 현재 Pro 플랫폼 요금은 **월 US$20**, 배포 좌석1개와 사용량 credit $20 포함,
초과 사용량/추가 좌석·세금 별도. [Pro 요금](https://vercel.com/docs/plans/pro-plan).
팀 결제 권한, 배포 권한, 기존 Cron 인증 및 trusted worker 권한이 필요하다.

지연 처리: 07시 전에 진입했더라도 lease 대기 후 창을 넘으면 blocked. 일부 응답만 넘으면
끝난 시각별 receipt만 보존한다. **요청 자체가 07시 이후 도착하면 현재 endpoint는 daily 경로**다.
사전 수집 성공으로 보고하지 않으며, 유효한 이전 근거를 먼저 평가하고 이후 캐시를 갱신한다.
별도의 phase 전용 endpoint를 구현했다고 주장하지 않는다. 06:45보다 일찍 요청하는 일정도 금지한다.
빠진 근거는 정확한 거래일 종가 fallback 또는 unavailable이며 현재 가격으로 소급 생성하지 않는다.

### A–G 코드 및 검증 대응

| 요청 | 증거 | 결과/경계 |
|---|---|---|
| A 접속 없는 수집→보존→평가 | `cron-market-cycle-runner.test` upcoming-cutoff; `cutoff-observation-postgres-cases` real-writer 및 daily-writer | 실제 runner→writer/query/trigger→평가 DB 통합 PASS. 브라우저 없이 10×105×1300=1,365,000원. 자연 scheduler end-to-end는 NOT RUN |
| B 07시 이후 도착/대기 | runner의 신규 after07 test 및 expired lease test | 늦은 도착은 daily, 대기 만료는 blocked. prepared로 표시 안 함 |
| C 일부만 pre07 완료 | 신규 PG `partial-batch-preserves-only-precutoff-completions...` + runner partial-count test | 06:59:59만 보존, 07:00:01 제외; 늦은 retry로 소급 안 함 |
| D 가격/FX 한쪽 없음 | `daily-cutoff-readiness.test` 신규 price-only/FX-only 및 runner 양쪽 실패 | 외화 snapshot 저장 거부. KRW-only는 FX 필요 없음 |
| E 이후 live 갱신 | PG cache-overwrite, completed-record/prune | live 110/1310으로 바뀌어도 cutoff 105/1300 및 완료값 불변 |
| F 중복/경쟁 | PG bounded-receipts, real-daily concurrency, phase-separated claim | 중복 receipt 없음, concurrent daily 하나만 저장, prep가 daily 완료/cap을 소비하지 않음 |
| G fallback 구분 | `daily-cutoff-readiness.test`, `cutoff-contract-followup.test`, native provider reuse test | 적격 live105 우선; 검증된 공식 close100 fallback; missing/후시점 live 제외 |

신선도 정책은 변경하지 않았다: live/spot15분, daily-reference3일. reference FX는 07시 tick이 아니다.
DB 통합의 외부 KIS 응답은 합성 provider, FX는 합성 candidate를 실제 FX writer에 전달했다.
과거 합성 cutoff 시계와 실제 PostgreSQL lease 시계를 분리하기 위해 claim의 startedAt만 현재 시각으로
주입했다. claim/finish SQL, DB 권한, 수집/저장/조회/평가 함수는 실제 구현을 실행했다.
사전 수집에서 호출되면 안 되는 보조 queue 함수는 호출 즉시 실패하는 경계로 대체했다.

## 2. 실 공급자 QA 및 자연 07시 검증 순서

**실 응답 검증 NOT RUN**. 이전 6종목 시세 복구 승인은 이번 공급자 QA로 확대하지 않았다.
고객 원장/snapshot을 시험 대상으로 사용하지 않는다. Twelve Data/새 공급자 호출 없음.

승인 요청 대상: 권리가 확인된 QA 연결에서 아래 최대 호출량만 허용하고 응답을 고객 DB에 쓰지 않는다.

| 대상 | 호출 예산 | 확인 내용 |
|---|---|---|
| 국내 KIS 현재가1종목 | 1 | `stck_prpr`, 시세 종류, body 완료시각, timestamp 부재를 collection으로 유지 |
| 미국 KIS 현재가1종목 | 최대3(거래소 탐색 포함) | `last`, 실제 시장/통화/지연 여부, 실패 응답 제외 |
| 국내/미국 공식 종가 각1 | 최대1+3 | 거래일/원시·수정 기준/close를 live로 오표기하지 않음 |
| er-api-open USD/KRW | 1 | USD base, KRW rate, `time_last_update_*` publication과 fetch 분리 |
| KIS FX1 (사용 경로 별도 확인) | 최대3 | timestamp 없음/null, collection 근거; daily reference와 구별 |
| KIS token | 최대1 | 기존 cache 재사용 시0, 비공개 유지 |

**총 최대13 HTTP 요청**, 재시도 추가 호출은 이 예산 밖이므로 중단. 기존 limiter/사용권 우선.
실제 응답 검증 이후 값·비밀/헤더를 외부 공유하지 않고 필드 존재·종류·시각 의미만 기록한다.

자연 경계 전 출시 순서: (1) 이 코드/0060 검토 및 승인 → (2) 호환 gate와 권한 확인 후 제한된
QA 저장 환경에 0060 적용 → (3) 실 응답 normalization 검증 → (4) 승인된 Pro 사전 일정 활성화 →
(5) 다음 자연 시간 T에서 scheduler 요청/runner/receipt/finalized 자료를 관찰 → (6) pre07 수집률,
fallback/누락, cutoff 값과 저장 지연을 분리 검토 → (7) 승인 후 일반 운영 확대.
이는 실행 계획이며 현재 완료 아님. 수동 QA 호출은 자연 스케줄 성공이 아니다.
전체 owner sweep endpoint를 QA로 사용해 고객 snapshot을 바꾸지 않는다. 테스트 환경은 별도 DB와
샘플 owner만 두고, 외부 호출 자격/권리는 별도 승인한다.

## 3. Gyeol 원본과 적용 규칙

원본: `gyeol-fin/base44/functions/calcRebalanceRecommendation/entry.ts`, 기준 `6c9183e`.
상세 anchor는 [기존 대조표](contribution-gyeol-modifiers-followup.md). 아래는 재확인 결과다.

| 항목 | 원본/정의 | 구현 함수·적용 상태 | 증거 |
|---|---|---|---|
| FX .55 clamp | 511–614: 곱을 [.55,1], 3자리 | `calculateContributionFxOverlay` 일치 | modifiers test clamp .55 |
| FX_HOT | 592: 최종 multiplier≤.75 | 같은 함수 `.hot` | modifiers threshold test |
| minimum 보정 | 1181–1191: min(설정,85/65/40)−10 **percentage points** | `contributionMinimumRatio`, KRW 근거만 | 85→75, 100000→75000 |
| rawAllocationRatio | 1669: raw/step1Total, clamp[0,1] | `applyModifiers` raw/전체raw | topup readiness scores |
| penaltyPriority | 1672: clamp penalty | `applyModifiers`, resolver가 [0,1]로 제한한 penalty | .90/.70 검산 |
| deficitPct | 1666: (buyTarget−postTrimWeight)/buyTarget clamp | 같은 함수, postTrim total 비중 기준 | scores57.50/56.25 |
| maPriority | 1615–1629: MA_OK1, below.5, unknown0 | 같은 함수, unknown은 적격 제외 | existing modifier/cutoff tests 및 no-candidate |
| fxPriority | 1630–1644: 국내/hedged1, 국내비헤지.5, US0 | `contributionFxPriority` 자산별만 | 원본 코드 대조/기존 USD 경계 |
| score | 1676–1684: 40raw+25penalty+20deficit+10MA+5FX, 2자리 | 같은 함수 | 고정 독립 계산과 다중 후보 검산 |
| score0/동률 | 원본0제외, 동률은 배열 순서 의존 fallback | 0 제외. **키 기반 최대잔여** tie는 사용자 가이드의 기존 결정적 정책 유지 | no-candidate/odd-unit/reverse-order |
| cap/재배분 | 1703–1737: 남은baseNeed내 반복, 원본 guard20 | 상한·잔여 재분배 유지. **floor/최대잔여/후보 수 기반 종료**는 기존 Cairn 정책 | small-cap redistribution 및 exhausted capacity |

정상 적격 후보는 penalty≥.85 및 MA priority1이므로 score는 최소31.25보다 크다.
‘적격인데 score0’은 현재 정의에서 도달 불가능하다. 0 점수 후보 제외는 검증했으며 원본에 없는
임의 score 입력 API를 추가하지 않았다. 위 tie/반올림/종료 개선을 Gyeol과 byte-for-byte 동일이라고 하지 않는다.

뉴스: 저장된 sentiment−1..1은 원본 bearish 비중 조정0..100 점수와 다르다.
`readAdditionalContributionModifiers`가 unavailable을 전달하며 event 승수1은 **미적용**, 정상 중립 아님.
어느 필수 승수라도 unavailable인 후보는 topup 제외. 따라서 현재 뉴스 근거가 없는 실 계정에서
합성 검산처럼 topup이 발생한다고 약속하지 않는다. 필요한 원본은 뉴스 overall/bearish 구성자료와 저장 계약이다.

성과: `readAdditionalContributionPerformance` → `calculateContributionPerformance`.
KRW 국내 전체 보유 +069500, 같은 source/provider/adjustment의 검증된 수정가격253개,
완전히 일치하는 관측일, 현재 비중 log-return 가상 비교. beta 선반올림2자리,
alpha90/252 모두 음수 && signed MDD90≤−10%일 때 .9. MDD는 마지막90 수익률 구간의
누적가치 최고점 대비 낙폭(음수), 전체 보유의 실제 성과가 아님. 90/252는 관측구간 수이고 달력일 아님.
raw KIS/외화/누락/불일치/7일보다 오래된 최종 관측은 미적용. SQL/PGlite 독립 검산 −12.63/−31.48/−13.37 PASS.

USD 자금은 신규금·현금·매도대금으로 판단한다. `calculateCurrencyContribution`/`buildNativeContributionPlan`
서버와 `native-contribution-planner`/공통 설명에서 FX·minimum 미정의 범위를 유지한다.
USD cents 기본 배분은 지원하지만 USD topup 정책 검증으로 포장하지 않는다.
그룹 내부 실행·손실매도 보호는 정의가 없어 자산별 승인 목표만 사용한다. 원본 차트의 현재액 비례를
그룹 매매 규칙으로 복사하지 않았다. 이 미지원 때문에 맞는 전체 엔진을 폐기하지 않는다.

## 4. 독립 topup 단위검산과 저장

`tests/contribution-topup-readiness.test.mjs`: factor resolution/최소85%/FX priority만 고정 주입,
실제 엔진의 raw·score·상한·반올림·재배분을 실행한다. **원자료→승수 검증과 분리**한다.

| 입력/조건 | 독립 기대 결과 |
|---|---|
| raw각50000/cap각50000, .90/.70, 최소85%, HOT아님 | 감액45000/35000 → A+5000 → **50000/35000/현금15000** |
| .70/.70, 후보0 | 35000/35000/현금30000 |
| raw각25000, A/B score57.50/56.25, 부족16250 | topup8214/8036, 최종30714/29286/12500/12500, 현금15000 |
| 후보 둘의 총 cap 잔여6250 < shortfall16250 | 25000/25000/12500/12500, 현금25000, 최소미달 |
| 동률·가용100001 | 30001/29999/12500/12500, 현금15001; 순서 역전 동일 |
| A cap2000에 먼저 도달, B에 재분배 | 2000/49850/16575/16575, 현금15000 |

기존 35000/35000/현금30000 regime 사례는 감액 및 **topup 미발생** 검사다.
KRW 원/ USD cent 기존 회귀는 `additional-contribution-modifiers.test`와 `native-contribution-plans.test`.
USD100.01→매수70.00/현금30.01은 USD 미정의 minimum 경계도 확인한다.
미리보기와 서버 저장은 `buildNativeContributionPlan` 공유. 실제 API/PGlite 저장 테스트에
동일 basis의 preview result==persisted result 비교를 추가했다. 근거가 최신으로 바뀔 때는
기존 target revision/owner lock 재검증 및 `basisChanged` 표시 검사와 브라우저 증거를 재사용한다.

## 5. 0060 upgrade/권한/복구

추가 객체: 가격/FX 공유 receipt 두 테이블, index, immutable/capture trigger,
`snapshot_cutoff_receipt_date`, `record_snapshot_cutoff_fx`. owner 금융 테이블 변경 없음.
실제 기존 price cache writer/FX writer가 같은 TX로 보존하고
`readSnapshotCutoffObservations` → legacy daily/native-cutoff-evidence가 읽는다.
32개/일·종목·provider,35일, 쓰기당 최대2048개 만료 정리. collector가 멈추면 정리도 다음 쓰기까지 지연된다.

추가 검증기 `scripts/cutoff-upgrade-audit.mjs`: 운영과 같은 journal0059/compatible 상태를
새 loopback PostgreSQL에 재현. 기존 원장과 revision/tombstone/완료snapshot 합성 sentinel을 넣고,
실패0060 rollback 및 성공0060 이후 전체 row JSON·0059 보호함수 정의가 동일함을 확인했다.
sentinel은 보존 검사이며 실제 과거거래 replay 검증은 기존104개 PG 검사와 별도 writer 테스트가 근거다.
운영 스키마의 비공식 수동 drift를 덤프해 대조한 검사는 **NOT RUN**; 현재 배포 migration 기준이다.

권한은 tenant SELECT/DELETE/함수실행 거부, trusted worker 실제 캐시쓰기/receipt조회/정리 확인.
migration owner와 worker가 다르면 후자에 명시 grant가 필요하다. RLS를 이유로 tenant를 worker로 승격하지 않는다.
과거0059 코드가 공유 테이블을 몰라도 캐시 SQL은 유지되고 trigger가 캡처한다. 기존0059 금융 함수·guard
정의 불변을 확인했다. **99da6fe 전체 옛 앱 binary를0060 위에서 다시 부팅한 검사는 NOT RUN**이므로
이름만 추가형이라는 이유로 모든 롤백을 승인하지 않는다.

중단/복구: paused → 원장/revision/tombstone 보존 → 호환0059 이상 코드·권한 검증 → compatible.
0060 trigger 오류 시 승인된 운영자가 두 capture trigger만 transaction으로 일시 중지할 수 있으나,
금융/receipt 데이터 삭제나0058 앱 단순 복귀를 복구안으로 쓰지 않는다. 새 일반 앱에는0060 선적용 필요.

## 6. 판정 및 소스 상태

| 분류 | 판정 |
|---|---|
| 코드 구현 | **완료(명시한 지원 범위)**. 이번 후속에서 src/0060 금융 규칙 변경 없음 |
| 합성/격리 검증 | 신규 고정 topup·지연·부분 수집·0059→0060·실패 복구 PASS. 결과 묶음 참조 |
| 실제 공급자 | **NOT RUN**.13회 이하 QA 호출 권한/환경 확인 필요 |
| 07시 전 자동 확보 | **현재 BLOCKED**: Hobby+사전 일정 없음. 권장 Pro 재사용안 승인 및 자연 경계 관찰 필요 |
| Gyeol 일치 | 위 식 원본 확인. 뉴스 입력/그룹 실행/USD 일부 규칙은 미정의·미적용, 전체동일 아님 |
| 운영 적용 | **승인 대기**: migration/worker권한/배포/플랜/일정. 자동 변경하지 않음 |

기존 전체3031 테스트·lint/type·production build·PG104 검증은 기준 문서 기록을 재사용했다.
최종 production build 복사본과 현재 src/마이그레이션을 파일 SHA256으로 대조한 결과는 공유 묶음의
`verification/source-state.json`에 넣는다. 후속은 검증 파일만 바뀌었으므로 전체 앱 테스트/build를
이유 없이 반복하지 않았다. 새 테스트 및 검증기 lint와 관련 통합 검사만 실행했다.
전체 실행 명령·총수·PASS/NOT RUN은 공유 묶음 `verification/results.json`이 최종 기록이다.

최종 후속 결과: 관련 **104 tests PASS**(실패0), 이후 preview/저장 동일성 assertion을 넣은
계획 테스트 **11/11 PASS 재실행**(앞선104와 중복), PostgreSQL **73/73 checks PASS**
(61 migration 검사 포함), 변경 테스트/검증기 ESLint PASS. 최종 PG는
`output/krw-usd-rc-rehearsal/local-jOZpO6/report.json`, 실제 TCP7개 및 클러스터 종료 확인.
초기 검증기의 비활성 gate 준비/Node import/합성 시각과 SQL lease 시각 차이로 실패한 중간
실행은 최종 성공과 구별하며 기존 output에 남겼다. 이 과정에서 앱 코드는 수정하지 않았다.
