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

## 실행 증거

이 파일의 작성 시점에는 후속 검증이 진행 중이다. 이전 2,952개 PASS를 새 코드의 최종 결과로 사용하지 않는다. 실행 완료 후 아래를 실제 산출물과 최종 SHA로 갱신한다.

| 구분 | 상태 | 근거 |
| --- | --- | --- |
| 코드/로컬 전체 검증 | NOT RUN | 후속 전체 검사 진행 중 |
| 실제 Next 앱 전체 | NOT RUN | 새로운 production 앱 harness 진행 중 |
| 실제 인증 | NOT RUN | 기존 QA 이메일 로그인 재확인 진행 중 |
| 원격 CI | NOT RUN | 전용 PR 작성 전 |
| Preview 격리 | PASS | 9/27 메타데이터·실제 DB 신원 확인: 별도 QA 프로젝트/endpoint, 운영 연결 제외 |
| migration/복구 | NOT RUN | 후속 실제 PostgreSQL 호환성/실패 주입 검증 진행 중 |
| 운영 스케줄 준비 | BLOCKED | 코드 경로와 절차 준비, Production 스케줄 적용 승인 전 |

## Preview 및 운영 경계

자동 Preview가 일반 build에서 migration을 수행할 수 있으므로 최초 push에 이 브랜치만 `git.deploymentEnabled=false`를 포함한다. 프로젝트 전체 자동 배포는 바꾸지 않는다. 별도 QA 프로젝트 `cairn-bc-preview-20260924`는 Git 연동 없이 승인된 `rapid-rain-28976365` 프로젝트의 고정 endpoint만 사용한다. QA 배포의 build는 migration 대신 journal hash·역할·RLS를 읽어 검증한다.

9/27 현재 계정 플랜은 Hobby다. 기존 하루 1회 Cron은 유지한다. 권장되는 미완료 저장 wake는 5분 간격이며 단계당 최대 30건·60초, 전체 120초로 제한한다. 이 스케줄은 적용하지 않았다. Hobby의 빈번한 Cron 제한 때문에 별도 승인된 실행기 또는 플랜 검토가 필요하다. 공급자 수집 실행 주기는 늘리지 않는다.

참고: [Vercel Cron 한도](https://vercel.com/docs/cron-jobs/usage-and-pricing), [브랜치별 배포 제어](https://vercel.com/docs/project-configuration/git-configuration), [실행 중 Cron 관리](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

## 남겨 두는 운영 승인

PR 병합, Production 0059 적용 및 역할 확인, 호환 배포와 `paused`/`compatible` 전환, QA 후 기능 활성화, provider-free retry 실행기·주기 적용, required checks 연결은 이번 작업 이후 승인한다. 오래된 reader로의 단순 rollback이나 revision/tombstone 삭제는 복구 절차가 아니다.
