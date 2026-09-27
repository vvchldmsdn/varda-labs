# 거래 기록·일일 저장 출시 검증

기준: 2026-09-27, `codex/trade-daily-reliability`, base `e9dee3648db5e36616105c3659b4819e5b867365`.

## 승인 범위

전용 브랜치 PR/CI와 기존 합성 QA Preview만 대상이다. master 병합, 운영 DB 조회/수정, Production 배포·설정, 실제 사용자 거래 복구, 공급자 활성화는 수행하지 않는다. 루트의 미커밋 작업은 보존한다.

## 후속 보완

- 자료가 없는 작업을 6시간마다 다시 실패시키던 처리 대신 `blocked`로 보존하고 근거 복구 후 검토된 재개를 제공한다. lock 경합은 실패 예산과 분리한다. worker 중단은 예약한 시도를 소비하여 4회 후 명시적으로 소진된다.
- 수집을 반복하지 않는 `/api/cron/snapshots/retry`를 추가했다. 실제 job/writer를 사용하고 새로운 공급자 호출을 하지 않는다.
- 이전 배포/worker의 늦은 쓰기를 차단할 DB 실행 상태와 trigger를 0059에 추가했다. UI 제어만으로 안전성을 주장하지 않는다.
- 기존 원장 component 검사에 실제 production Next App Router 검사를 추가한다. 로컬 검증의 외부 identity 대체와 QA의 실제 이메일 인증을 별도로 판정한다.
- 새 관리 테이블을 소유권·검증 등록부에 반영했다. 기존 금융 계산 정의와 사용자 데이터는 바꾸지 않았다.
- 실제 QA에서 기기 시계가 서버보다 약 1초 빠를 때 기본 거래 시각이 미래로 판정되어 저장이 거절됐다. ledger 응답의 서버 시각과 브라우저의 단조 증가 시간을 사용해 기본값을 계산한다. 사용자가 입력한 시각과 서버 writer의 미래 시각 제한은 유지한다.
- 시계가 60초 느린 브라우저에서는 유효한 서버 평가 자료가 미래 자료로 잘못 판정되어 Home이 사라졌다. 기존 공통 엔진을 인증된 서버 조회 다음에 실행하고 화면에는 같은 자료의 KRW/USD 결과를 전달한다. 금융 계산·미래 자료 제한·계정별 격리·Contribution 정책은 바꾸지 않았다.
- 검증 환경 자체의 누락 필드, PostgreSQL `inet` 주소의 `/32` 표기, 실제 화면의 완료 대기와 저장일/평가일 구분을 수정했다. 이를 앱의 금융 결함 수정으로 세지 않는다.

## 호환성 및 복구 표

| 조합 | 의도된 동작 | 검증 기준 |
| --- | --- | --- |
| 구버전 + 0058 | 기존 일반 거래/평가 유지 | 고정한 이전 소스 writer/query/snapshot 실행 |
| 구버전 + 0059 `legacy` | 일반 거래/조회 호환, 신규 revision/취소 불가 | 0058 결과와 비교 |
| 새 버전 + 0059 `compatible` | transaction 호환 표시가 있는 writer만 허용 | 실제 tenant writer와 worker |
| 첫 revision/취소 후 구버전 | 이전 쓰기 차단, 구버전 조회는 사용 금지 | SQL guard 및 원본-only reader의 차이 확인 |
| 새 버전 + `paused` | 신규 금융 쓰기 중단, 확정 원장/operation 조회 가능 | 장애 주입 후 원본·revision 보존 |
| 호환 버전 복구 + `compatible` | 같은 원장을 이어서 사용 | 현재 9주·현금 $1,130 고정 기대값 |

`compatible` 활성화 자체부터 오래된 writer를 차단한다. 데이터 의미상 일반 거래 형식은 호환되며 첫 revision 또는 취소 tombstone 이후에는 `legacy`로 돌아갈 수 없다. 전환 잠금이 이미 승인된 DB transaction을 기다리는 것과, 아직 DB 쓰기에 진입하지 않은 외부 Cron 실행의 종료 확인은 구분한다. 운영 순서는 [구현 기록](trade-daily-reliability.md#migration--중단--복구)을 따른다.

## 과거 평가·복구 검증

- 실제 writer/query를 통과한 과거 누락 매수 재생 결과는 **9주 / 현금 USD 1,130**이다. 원본 행은 보존하며 같은 요청을 다시 실행해도 결과가 늘지 않는다.
- 당시 가격·FX가 있으면 새 revision의 snapshot을 다시 만든다. 실제 Next 화면에서는 **USD 2,000 → 2,010 / 변동 +10 / +0.5%**를 확인했다. 원장·Home·Today·History가 유효한 revision을 읽는다.
- 근거가 없으면 원장과 현재 보유 결과는 유지하고 파생 평가만 보류한다. 저장된 근거가 복구된 뒤 정확한 작업을 재등록하면 실제 snapshot writer가 처리한다. 현재 가격으로 과거를 채우거나 일부 계좌를 제외한 값을 전체로 표시하지 않는다.
- native History의 시계열과 기존 legacy History의 heatmap을 각각 검증했다. 현재 native 화면에 없는 heatmap을 새로 구현하거나 검증했다고 주장하지 않는다.
- 9개 연결 계좌와 500개 초과 기록은 변경 전에 거절한다. 일부 이체·기록만 성공 처리하지 않고 기존 장부를 보존한다.

## 실행 증거

금융 화면 수정 코드의 기준은 `82599194289d68772c42bc64a2e1edb58ffc25e7`이다. 문서 마감 뒤 최종 PR head와 GitHub가 checkout한 test-merge SHA의 관계는 [PR #198](https://github.com/vvchldmsdn/varda-labs/pull/198)의 검증 기록에 남긴다. 이전 2,952개 테스트 결과를 최종 코드의 성공으로 인용하지 않는다.

| 구분 | 상태 | 근거 |
| --- | --- | --- |
| 코드/로컬 집중 검증 | PASS | 서버 평가/화면 11건, 기존 route 7건, 서버 시각 5건, 원장 API/DB 29건. 실제 PG 17.11의 60 migration + 36 사례 |
| 로컬 전체 unit 재실행 | NOT RUN | 메모리 경합으로 중단했다. 전체 결과는 아래 실제 GitHub 실행으로 별도 판정 |
| 전체 unit / production build | PASS | 코드 기준 `8259919`의 실제 GitHub 실행: 2,966개/366 suites, 실패·취소·skip 0. production build 및 lint/type도 PASS |
| 실제 Next 앱 전체 | PASS | 코드 기준 `8259919`의 실제 production 앱 7개 흐름. 기기 시계 ±60초·과거 정정/재생성·응답 유실·만료·계정 전환·KRW/USD·320/390px·legacy heatmap |
| 실제 인증 | PASS | 기존 QA 이메일/비밀번호 로그인, 실제 SignOutButton, 로그아웃 뒤 API 401, 재로그인 뒤 원래 operation 조회. 외부 identity 대체 없음 |
| 신규 이메일 가입 / OAuth | NOT RUN | 기존 계정의 실제 로그인 검증과 구분 |
| 원격 CI 최종 판정 | PR 검증 기록 참조 | 코드 기준 run `36303665403`에서 unit/lint/type/build/PG 및 실제 browser 흐름 통과. job 집계의 이전 사례명 불일치는 이번 마감에서 수정. 최종 head 다섯 job의 SHA/결과는 PR 원본 체크와 검증 기록으로 확정 |
| Preview 격리 | PASS | 9/27 메타데이터·실제 DB 신원 확인: 별도 QA 프로젝트/endpoint, 운영 연결 제외 |
| migration/복구 | PASS | `output/release-readiness/pg-focused-report.json`: PG 17.11, 실제 TCP 8연결/RLS/구버전 writer/중단 복구. GitHub PostgreSQL16에서도 통과 |
| 운영 스케줄 준비 | BLOCKED | 코드 경로와 절차 준비, Production 스케줄 적용 승인 전 |

로컬 전체 앱의 외부 인증 subject 대체는 폐기 가능한 소스 복사에만 적용된다. 원본 인증 파일 해시·tenant resolver·RLS·실제 writer/query/engine은 유지한다. 이 결과를 실제 이메일 인증으로 합산하지 않는다. 실제 이메일 검증은 아래 QA에서 별도로 수행했다.

중간 실패 기록도 보존한다. `72bbd5a`의 검증 환경 실패를 `fba479a`에서 해결하여 다섯 검사가 통과했다(run `36302072209`). `099aa62`에서는 시계 차이 테스트가 실제 Home 결함을 발견하여 browser job이 실패했다(run `36302936101`). 테스트 완화 대신 서버 평가 연결을 수정했다. `8259919`의 실제 browser 두 실행기는 PASS였지만 최종 집계가 옛 사례명을 확인하여 job은 FAIL이었다. `scripts/reliability-ci.mjs`의 필수 사례명을 실제 검사와 맞추며 필수 검사를 삭제하지 않았다. 이 중간 run의 job 실패를 최종 CI PASS로 대신 보고하지 않는다.

## Preview 및 운영 경계

자동 Preview가 일반 build에서 migration을 수행할 수 있으므로 최초 push에 이 브랜치만 `git.deploymentEnabled=false`를 포함한다. 프로젝트 전체 자동 배포는 바꾸지 않는다. 별도 QA 프로젝트 `cairn-bc-preview-20260924`는 Git 연동 없이 승인된 `rapid-rain-28976365` 프로젝트의 고정 endpoint만 사용한다. QA 배포의 build는 migration 대신 journal hash·역할·RLS를 읽어 검증한다.

9/27 격리 PG 검증 후 해당 QA DB에만 0057~0059를 적용했다. 기존 journal 57개와 파일 hash를 먼저 대조했으며 60개 적용 후 `legacy` 상태를 확인했다. 운영 DB는 조회하거나 변경하지 않았다. 근거: `output/release-readiness/qa-migrations.json`.

QA의 `paused → compatible` 전환은 새 호환 앱 alias를 확인한 후 수행했다. 이후 검증은 합성 계좌만 사용했다. 실제 이메일 로그인부터 시작해 Home 매수/매도, 응답 유실, 새로고침, 실제 로그아웃/재로그인, 거래 내역·Today·History, 데스크톱 및 390/320px을 확인했다. 코드 기준 `8259919`의 QA 6개 사례 PASS에는 1분 느린 기기 시계에서 Home 유지도 포함된다. 최종 합성 값은 **12주 / 현금 USD 810 / 평가 USD 2,010 / 응답 유실 거래 1건**이다. 이전에 확정된 시험 거래는 재검증 때 새로 중복 입력하지 않는다. 최종 문서 commit의 별도 QA 배포 ID와 SHA도 PR에 연결한다.

확인 URL(기존 QA 계정으로 로그인 필요):

- [Home](https://cairn-bc-preview-20260924.vercel.app/?scope=account%3A26d9896f-f3f9-4116-846a-f467ba7b1e3f&currency=USD): 현재 평가 $2,010.00, 합성 보유 12주.
- [Today](https://cairn-bc-preview-20260924.vercel.app/today?scope=account%3A26d9896f-f3f9-4116-846a-f467ba7b1e3f&currency=USD), [History](https://cairn-bc-preview-20260924.vercel.app/history?scope=account%3A26d9896f-f3f9-4116-846a-f467ba7b1e3f&currency=USD): 같은 확정 원장과 가용/결측 근거 표시. QA의 과거 이력 부족을 가짜 수익률로 채우지 않는다.
- [거래 내역](https://cairn-bc-preview-20260924.vercel.app/portfolio/events?account=all): 합성 시험 거래 확인. 실제 사용자의 18건 거래는 조회·복구하지 않았다.

로컬 증거는 `output/release-readiness/qa-journey/report.json`, `qa-alias.json`, `qa-migrations.json`, `pg-focused-report.json`과 실제 화면 PNG다. 인증 state·비밀번호·원자료는 커밋/로그에 넣지 않는다. 공급자 호출은 NOT RUN이다.

9/27 현재 계정 플랜은 Hobby다. 기존 하루 1회 Cron은 유지한다. 권장되는 미완료 저장 wake는 5분 간격이며 단계당 최대 30건·60초, 전체 120초로 제한한다. 이 스케줄은 적용하지 않았다. Hobby의 빈번한 Cron 제한 때문에 별도 승인된 실행기 또는 플랜 검토가 필요하다. 공급자 수집 실행 주기는 늘리지 않는다.

참고: [Vercel Cron 한도](https://vercel.com/docs/cron-jobs/usage-and-pricing), [브랜치별 배포 제어](https://vercel.com/docs/project-configuration/git-configuration), [실행 중 Cron 관리](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

## 남겨 두는 운영 승인

PR 병합, Production 0059 적용 및 역할 확인, 호환 배포와 `paused`/`compatible` 전환, QA 후 기능 활성화, provider-free retry 실행기·주기 적용, required checks 연결은 이번 작업 이후 승인한다. 오래된 reader로의 단순 rollback이나 revision/tombstone 삭제는 복구 절차가 아니다.
