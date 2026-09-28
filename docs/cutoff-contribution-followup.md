# 07:00 평가와 추가투입 후속 검증

작업일: 2026-09-27. 기준 `99da6fe725cec7d87a625a5b89ef52ea40774d14`.
운영 판단 후속 검토(2026-09-28): [현재 플랜·사전 수집·원본 규칙·0060 검증](cutoff-operating-readiness-review.md).
작업 브랜치: `codex/cutoff-contribution-followup`, 기존 `trade-daily-reliability` checkout 재사용.
원래 루트의 미커밋 작업은 보존했다. 이번 작업은 코드·격리 검증까지이며 커밋, push, 배포, 운영 DB/환경/Cron 변경을 포함하지 않는다.

## 실제 운영 확인과 한계

- remote master와 실제 Vercel Production 모두 위 SHA. 배포 `dpl_GnmBUZs3GFxSbfRY5MjWLid2MbDG`, READY.
- 명시적 read-only transaction의 집계 조회로 journal 60개(0059까지), reliability `compatible`, 최근 5회 market-cycle `completed`를 확인했다.
- 실제 시작 시각은 07:58:56~58 KST였다. 설정상 07:00 호출이어도 **07:00 전 관측 확보를 보장하지 않는다**.
- 최근 legacy/native 일일 저장 집계와 FX의 관측/수집 시각을 구분해 읽었다. 사용자별 금융 원자료 전수 감사, 과거 기록 보정, 새 공급자 요청은 하지 않았다. 완료 상태만으로 모든 과거 숫자가 정확하다고 판정하지 않는다.
- 비밀값은 로컬 승인 경로에서 비공개로 사용했고 출력·문서·커밋하지 않았다. `output/release-readiness/cutoff-production-readonly.json`은 집계 증거다.

## A: 변경과 실제 연결

| 경로 | 이전 문제 | 변경 |
|---|---|---|
| 기존 시장 실행기 | cutoff 이후 갱신에 의존 | 06:45 이상 07:00 미만 호출에서 FX·고유 종목 수집만 하는 `pre_cutoff` 단계. daily와 claim 분리, 기존 lease/제한 재사용 |
| 기존 시세/FX writer | live cache 교체로 직전 관측 소실 | 0060의 제한된 공유 receipt 저장, 같은 DB transaction에 기록 |
| 공통 가격/FX 선택 | 늦게 수집한 오래된 관측 우선, stale market time 가능 | 실제 관측/수집을 각각 검증. 유효 live 우선, 정확한 거래일·출처의 공식 종가만 fallback |
| legacy daily writer | 유효 live가 있어도 별도 종가 없음으로 거부 | 공통 평가가격 readiness 사용. 권한·수량·원장·기업행위·FX 검증 유지 |
| native query/writer | 현재 캐시·과거 캡처의 근거 혼동 | cutoff 직전 원장 상태 + 저장된 관측 + 검증된 fallback. 동일 revision 완료 기록 보존 |
| Home/Today/History projection | 첫 거래 직후 캡처가 비교 기준 가능 | 요청 통화에서 완성된 정규 daily 기준만 선택. 없는 기준을 현재값으로 채우지 않음 |

T는 종료일 07:00 Asia/Seoul이며 사건은 `[T−24h,T)`이다. 정확히 T의 사건은 다음 사이클이다. 같은 cutoff·유효 revision의 완료 결과는 새 시세로 덮어쓰지 않는다. 정정 revision은 원본 근거를 유지하면서 별도 파생 결과를 만든다.

독립 검산: 실제 DB 조회→공통 엔진→snapshot writer에서 10주 × $105 × 1,300 = **1,365,000원**. 종가 $100보다 적격 live $105가 우선한다. 이후 캐시 $110/1,310, receipt 정리 후에도 완료 값은 유지한다. 실제 소수 수량과 입력 금액만 있는 자산도 분리한다.

저장 용량·기간·권한과 실제 관측/수집 시각 계약은 [cutoff storage](cutoff-observation-storage.md)를 따른다. 신규 KIS/유료 공급자를 활성화하지 않는다.

동일한 최신 관측 시각에 서로 다른 가격이 있으면 live 근거를 제외한다. 보관된 과거 캡처도 공급자 사용권 검증을 우회할 수 없다. 화면은 실제 가격 관측 시각, 수집 시각, 종가 거래일을 구분하며 평가 실행 시각을 가격 관측 시각처럼 표시하지 않는다.

## B: 단계별 연결과 차이

| 단계 | 기존 Cairn | 이번 결과 / Gyeol 대조 |
|---|---|---|
| TRIM | 검증된 손익·목표 초과분 | 12% 기본, 목표×1.05 유지. 외화 원가의 현재 FX 대체를 매도 근거에서 제외 |
| MA/baseNeed/raw | 공통 기존 계산 | 유지. floor·최대잔여·원/센트·부족액 상한 유지 |
| 5개 승수 | 미연결 | 공통 v2 엔진에 수식·자료 상태 연결. 실제 query는 검증 가능한 FX·계좌 regime·KRW RC·KRW 성과 연결 |
| 조건부 topup | 별도 단계 없음 | 적격성·점수·부족액 cap 안에서만 보충. 후보 없음은 잔여 현금 |
| 자금/저장 | native 계획 저장 | 타 계좌 현금 혼입 차단, 보유 sequence·목표 revision·근거 재검증, 이전 계획 불변 |

요구 예제: 50만원씩, 목표 50:50, 신규 10만원, 경계 regime 0.70, 다른 승수 1 → raw 각 50,000원, 최종 각 **35,000원**, 현금 **30,000원**, topup 0.

실제 SQL/RLS 근거 조회 검산: raw 각 50,000원, US FX 0.634·regime 0.70 → US 22,190원 + 국내 35,000원, 현금 42,810원. 현재 계획은 현재 calculationAsOf를 사용하며 07:00 snapshot으로 고정하지 않는다.

Gyeol 함수 원본과 수식·그룹·FX_HOT·반올림 차이는 [원본 대조 기록](contribution-gyeol-modifiers-followup.md)에 정리했다. **Gyeol 전체와 동일한 운영 결과라고 주장하지 않는다.**

## 미확정 정책 / 코드 연결의 제한

- event: 원본의 bearish 비중 조정 뉴스 점수에 해당하는 저장 자료가 없어 실데이터 적용 보류.
- performance: 실제 저장 가격 조회에 연결했다. KRW 국내 자산 전체와 KODEX200의 같은 253개 관측일·동일 공급자/출처·조정방식이 확인된 가격이 있어야 적용한다. 현재 비중의 가상 log-return alpha90/252·signed MDD90이며 실제 사용자 수익률이 아니다. 90/252는 공통 관측 구간 수로 정확한 달력 90일/1년을 보장하지 않는다. KIS raw-only와 외화에는 기존 가격 사용 정책을 넘어 적용하지 않는다. 출처 검증은 사용권 승인을 대신하지 않으며, 실제 조정가격 공급자 활성화에는 별도 계약 확인이 필요하다.
- USD RC: 검증된 동일 통화 공분산 연결이 없다. 해당 승수만 미제공.
- USD 자금/매도대금 FX: Gyeol에 명확한 별도 정책이 없어 KRW 진입 감액·minimum을 임의 확장하지 않는다.
- 그룹 내부 실행·개별 손실매도 보호 및 자산별 override 저장: 원본/현재 계약에서 명확하지 않은 실행 규칙이나 DB 값을 생성하지 않는다.

미확인 승수는 값 1인 **미적용**으로 표시하며 관측된 중립과 구분한다. 근거가 부족한 후보는 topup에서 제외한다. 뉴스 원본 저장 계약과 미지원 통화·가격 기준 정책을 확정하기 전에는 전체 5개 승수가 모든 계좌에서 활성화됐다고 볼 수 없다.

## 검증 기록

최종 전체 검사와 브라우저 결과는 아래와 같다. 중간 실패는 보존했으며 최종 성공 결과와 구분한다.

- 수정 전 실패 재현: 종가 없는 유효 cutoff 저장, stale 관측/가격 시각, post-trade baseline, regime 감액, 타 계좌 현금, FX 최신 관측 우선 및 close 거래일 근거.
- 실제 PostgreSQL 17.11: **104/104 PASS**(마이그레이션 검사 포함), 신규 0060까지 빈 DB chain, 실제 writer/query/engine, RLS, 총 9개 TCP 연결·cutoff 검증 8개 연결, 동시 수집/저장, retention 및 rollback 검증. `output/krw-usd-rc-rehearsal/local-mRk31t/report.json`, 클러스터 종료 확인.
- PGlite: native writer/query 31개, API/계획 저장/목표 revision 충돌, legacy query와 계산 경계. 실제 네트워크 PostgreSQL 동시성 증거와 분리한다.
- 외부 quote response만 고정 fixture로 대체한 수집 검증과, 검증용 모듈 포트를 사용한 단위검사를 구분한다. 실제 이메일/OAuth 및 실 공급자 계약·응답은 이번 검증 범위가 아니다.

검증 중 발견한 회귀도 수정했다. 동일한 과거 거래 요청이 두 사전 조회 사이에 커밋되면 두 번째 요청이 `invalid/conflict`가 되던 경합을 실제 SQL로 재현했다. sequence 변경 시 동일 owner의 원본 operation을 다시 조회하여 같은 요청은 `existing`으로 복구한다. revision·tombstone·원자적 금융 writer는 유지한다. 또한 전체 테스트에서 UI tracker의 전역 타이머 대체가 다른 테스트의 timeout을 삼키지 않도록 대체 중 비동기 양보를 제거했다. 이 수정은 테스트 격리에만 해당한다.

- 전체 lint·타입 검사: PASS, `output/reliability-ci/lint-type-0h9SLd/report.json`. 이후 계산 설명 문구만 수정한 파일도 별도 ESLint 통과.
- 전체 테스트: **3,031/3,031 PASS**, 실패·건너뜀 0, `output/reliability-ci/unit-tests-epKCUP/report.json` 및 `logs/full-tests.log`. 후속 계산 설명 문구 관련 기존 UI/방법론 검사도 5/5 통과했다.
- 최종 production build: PASS, `output/reliability-ci/production-build-4pXmaG/report.json`. 성과 adapter, 재시도 보완, 최종 설명 문구를 포함한 소스를 사용했다. 운영 자격 증명·DB·공급자 호출을 제외한 폐기 복사본에서 수행했다.
- 실제 Next 앱 브라우저: **10개 여정 PASS**, `output/reliability-fullapp/local-ZtnX1V/browser-rerun4/report.json`. native 한/영 1440·390·320px, legacy 한/영 1440·320px. 목표 저장→7,000원 매수/3,000원 잔여 미리보기→regime 변경 후 10,000원/0원으로 서버 재계산 저장→영어·새로고침 복원 확인. 가로 넘침·계정 전환·거래 복구·History도 포함한다.
- 브라우저의 외부 인증은 **폐기 build의 검증된 session subject 입력 경계만 대체**했다. 실제 DB·owner/RLS·App Router·금융 writer/query는 사용했다. 운영 인증 소스를 변경하거나 실제 이메일/OAuth를 통과했다고 보고하지 않는다. 이 browser build 후의 성과 adapter·거래 경합 보완은 실제 SQL 단위·PostgreSQL 및 최종 전체 test/build로 별도 확인한다. 마지막 문구 검수에서는 MA 원배분을 최종 매수금처럼 설명하던 문장을 수정했다.

| 변경 경로 | 직접 근거 |
|---|---|
| cutoff 선택·legacy readiness | `tests/cutoff-contract-followup.test.mjs`, `tests/daily-cutoff-readiness.test.mjs` |
| 기존 수집 writer→0060→native daily | `scripts/cutoff-observation-postgres-cases.mjs`, `tests/native-portfolio-persistence.test.mjs` |
| daily/intraday·통화별 조회 | `tests/native-service-integration.test.mjs`, `tests/native-group-performance.test.mjs` |
| 5승수·topup·계좌 현금 | `tests/additional-contribution-modifiers.test.mjs` |
| 실제 regime/자산 SQL·공통 RC 연결 | `tests/additional-contribution-modifier-read.test.mjs` |
| 성과 가격 SQL·Gyeol log return | `tests/additional-contribution-performance.test.mjs` (7/7, 독립 alpha90 −12.63%, alpha252 −31.48%, MDD90 −13.37%) |
| 계획 저장·버전 재검증 | `tests/native-contribution-plans.test.mjs`, `scripts/reliability-contribution-ui-cases.mjs` |
| 겹친 동일 과거 거래 재시도 | `tests/native-historical-idempotency.test.mjs`, `scripts/reliability-postgres-cases.mjs` |

## 운영 적용 전 필요한 정확한 작업

1. 추가형 0060 migration과 trusted worker 권한을 검토·승인한다. 기존 journal/hash를 고치지 않는다.
2. 수정 코드의 배포를 별도로 승인한다. 기존 revision/tombstone/lease 호환성을 유지한다.
3. cutoff 전에 실행 가능한 기존 운영 실행기를 확인한다. 최소안은 같은 market-cycle endpoint를 06:50~06:55에 한 번 더 호출하고 기존 07:00 이후 finalize를 유지하는 것이다. 실행 지연 보장이 없는 스케줄만으로 pre-cutoff 확보를 약속하지 않는다. 기존 인증·공급자 제한을 그대로 쓰고 새 유료 서비스나 스케줄은 승인 없이 적용하지 않는다.
4. 승인된 환경에서 실제 응답 완료 시각·receipt·일일 저장·조회까지 확인한다. 휴장/장 마감은 종가 fallback 정책으로 처리하고 누락을 휴장으로 추정하지 않는다.
5. 자동 재시도 주기와 backoff를 구분한다. 기존 [provider-free 재시도](snapshot-retry-operations.md)를 사용한다. 과거 자료가 실제 복구된 경우에만 정확한 owner/account/revision 작업을 재등록한다.
6. 과거 기록은 별도 읽기 감사 후 정정 범위를 승인받는다. `cutoff_live`라는 가격 종류만으로 오류 판정하지 않는다.

장애 시 `paused → 원장/revision/tombstone 보존 → 호환 코드 수정·검증 → compatible 재개`. 취소·revision 이전 버전으로 단순 롤백하지 않는다. 추가 receipt 저장을 중지할 필요가 있어도 기존 거래·snapshot을 삭제하지 않는다.
