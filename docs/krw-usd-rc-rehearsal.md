# KRW/USD RC: PostgreSQL 리허설과 migration 계획

2026-09-20. 대상은 `codex/krw-usd-foundation`의 현재 변경이다. 이 문서는 운영 적용 승인이나 실행 기록을 대신하지 않는다.

## 현재 결과

**실제 PostgreSQL: NOT RUN.** 이 환경의 PATH에서 `postgres`, `initdb`, `pg_ctl`, `psql`, `docker`를 찾지 못했고 기본 Windows PostgreSQL 설치 위치도 없었다. `pg` TCP 드라이버도 현재 의존성에서 resolve되지 않았다. 승인된 테스트 DB를 나타내는 환경변수 이름은 없었다. 환경변수 값, `.env.local`, 운영 DB와 자격 증명은 읽지 않았다. 설치·원격 DB 연결·운영 migration은 실행하지 않았다.

로컬 안전 검사 8/8은 통과했다. 여기에는 **실제 0000~0053 SQL 전체 chain을 PGlite에 적용**하고, 0047에서 만든 합성 KRW 계좌·기존 이벤트·draft·plan·FX·KIS budget row가 0048~0053 이후 보존되는 검사가 포함된다. 같은 전체 schema에서 실제 native writer의 시작·소수 수량 매수·snapshot 저장도 확인한다. 이는 PostgreSQL 서버의 다중 연결 결과가 아니다. `--validate-only`는 journal 54개, 순서, 파일 hash, prerequisite 부재를 검사하고 `validation: PASS`, `status: NOT RUN`을 출력한다.

새 파일의 Node 구문 검사와 대상 ESLint는 통과했다. 처음 `node --test` 실행은 Windows sandbox의 자식 프로세스 `spawn EPERM` 때문에 실행되지 않았다. 저장소 기존 방식과 같은 단일 프로세스 실행으로 8/8을 확인했다.

## 실행기와 안전 경계

- [실행기](../scripts/krw-usd-rc-rehearsal.mjs)는 URL, 기존 data directory, `.env` 파일, 외부 hostname을 입력받지 않는다. 기본 동작은 검증만 수행한다.
- 실제 모드는 명시한 PostgreSQL binary와 이미 설치된 `pg`가 있을 때만 진행한다. 다운로드·패키지 설치·Docker 실행은 하지 않는다. 이 도구 준비는 별도 개발 환경 결정이며 운영 DB 승인과 다르다.
- 실행기가 `output/krw-usd-rc-rehearsal/local-*` 안에 **새 클러스터**를 만든다. 임의 포트의 `127.0.0.1`에만 bind하고 Unix socket은 비활성화한다. 무작위 로컬 비밀번호를 만들며 상속된 PG/DB/provider 변수와 Node preload 설정을 PostgreSQL 자식 프로세스에 넘기지 않는다.
- 접속 후 `data_directory`의 realpath, 실제 서버 IP와 DB 이름을 새 클러스터와 대조한다. 포트 선점이나 검사 실패 시 기존 서버로 fallback하지 않는다. 운영 기본 URL을 쓰는 `db:migrate`, `build:vercel`, `drizzle.config.ts`를 호출하지 않는다.
- 역할 provisioning이 migration 밖에 있다는 현재 구조를 반영해 새 클러스터에만 역할을 만든다. tenant는 `NOSUPERUSER NOBYPASSRLS`, server writer는 `NOSUPERUSER BYPASSRLS`다. server writer의 application owner 검사와 tenant의 SQL 권한/RLS를 각각 검증한다. 이는 배포된 Neon role의 실제 설정을 확인한 결과가 아니다.
- 0000~0047 baseline을 적용하고 합성 legacy row를 넣는다. 이어 0048~0049 적용 중 실패를 일으켜 DDL rollback을 검사한 다음 0048~0053을 순서대로 하나의 release transaction에 적용한다. journal에는 원본 SQL SHA-256과 `when`을 기록한다. 이는 설치된 `PgDialect.migrate`의 pending batch transaction 경계를 따른다. 배포의 실제 Drizzle CLI/Neon transport 자체는 실행하지 않는다.
- [동시 연결 사례](../scripts/krw-usd-rc-rehearsal-cases.mjs)는 실제 TypeScript writer/query와 provider queue/store를 사용한다. SQL transport만 TCP pool로 바꾸고 provider HTTP만 fixture로 대체한다. Auth subject/tenant는 합성이다.
- 종료 시 해당 새 클러스터만 `pg_ctl stop -m fast`로 정지한다. 결과와 합성 DB 파일은 보존하고 재귀 삭제하지 않는다. `report.json`에 case 상태, 서버 버전, migration hash, backend session 수와 정지 상태를 남긴다. 비밀번호·SQL parameter·개인 자료는 보고하지 않는다.

현재 실행 가능한 검증 명령:

```powershell
node --no-warnings tests/krw-usd-rc-rehearsal.test.mjs
node scripts/krw-usd-rc-rehearsal.mjs --validate-only
```

PostgreSQL 16 이상 binary 및 `pg`가 승인된 로컬 개발 환경에 준비된 후, **실제 설치 경로**를 사용한다. 아래 경로는 예시이며 자동 설치를 뜻하지 않는다.

```powershell
node scripts/krw-usd-rc-rehearsal.mjs --execute-local --pg-bin "C:\Program Files\PostgreSQL\18\bin"
```

예상 결과는 모든 case `PASS`, 54개 migration hash, `distinctBackendSessions >= 3`, `clusterStopped: true`, 최상위 `status: PASS`다. 준비 도구가 없으면 `NOT RUN`과 종료 코드 2로 끝난다. 실행 중 assertion/SQL 오류나 정지 실패는 `FAIL`과 종료 코드 1이다. 이 실제 실행 결과가 생기기 전에는 Gate 3을 PASS로 변경하지 않는다.

## 실제 서버에서 확인할 사례

| 경계 | 연결과 검증 대상 | 기대 결과 |
| --- | --- | --- |
| 역할·함수 | tenant TCP login, server writer TCP login, catalog | tenant는 superuser/BYPASSRLS 아님. native mutation 함수는 SECURITY INVOKER와 고정 search_path. tenant 직접 실행/수정은 42501 |
| RLS·pool 재사용 | owner A/B와 owner 미설정 transaction | 타 owner 계좌 0행, 자기 계좌만 조회, transaction 종료 후 owner 설정 누출 없음 |
| FORCE RLS | 신규 provider 4개 표와 native plan, 비우회 table owner | catalog의 ENABLE+FORCE를 확인. plan의 실제 비우회 소유자도 policy 없는 행을 조회하지 못함 |
| 동일 거래 재시도 | owner lock을 잡은 제3연결 뒤 동일 요청 2개 | 실제 `pg_locks` 대기 2개 확인 후 해제. `created`+`existing`, 원장·현금 한 번만 반영 |
| owner 동시 변경 | 같은 expected sequence, 서로 다른 operation ID | `created`+`conflict`, sequence 1회 증가, 덮어쓰기 없음 |
| 다른 owner | A lock 유지 중 B writer/query | B 변경은 A 해제 전에 완료. 서로의 계좌·원장 혼합 없음 |
| transaction snapshot | REPEATABLE READ 조회 사이 다른 연결 commit | 열린 read transaction은 최초 상태 유지. 이후 새 조회는 변경된 sequence 확인. mutation의 READ COMMITTED와 분리 |
| 원장·스냅샷 경합 | transfer가 owner lock을 기다리는 동안 같은 lock 보유 연결에서 실제 snapshot writer 실행 | 받는 계좌 snapshot보다 과거 transfer는 거부, 양쪽 cash/sequence 보존, daily capture 재시도는 추가 row 없음 |
| provider quote job | 동시 enqueue 2개·동시 claim 2개·동일 claim 저장 2개 | queue key 1개, claim 1개, quote row 1개, 종료된 claim 저장 거부 |
| 동일 기업행위 | 실제 adapter의 동일 split payload를 같은 claim으로 두 연결에서 저장 | row lock/unique key를 통해 action 1개. raw history의 split 위험이 query에서 유지 |
| credit 예약 | 같은 reservation 동시 예약 | `granted`+`duplicate`, HTTP/credit count 1회. provider table tenant 직접 접근 거부 |
| decimal·제약 | 6자리 소수 수량, 18자리 quote, duplicate native sequence, 우회 수량 변경 | 수량 `0.000001`, quote `500.123456789123456789` 보존. 중복 23505, 우회는 N0001. 실제 USD 거래대금은 cent 단위를 유지하며 원장 현금 기대값 `1000.74`를 독립 상수로 검사 |
| timezone | Seoul/UTC 동등 instant, New York session, microseconds | 동일 instant와 `123456` microseconds 보존. 서비스 날짜를 단순 UTC 날짜로 바꾸지 않음 |
| migration 실패 | 0048~0049 중 오류 후 rollback | 추가 column/table이 남지 않음. 이후 전체 RC batch 정상 적용과 기존 KRW 값 보존 |

`accounts`, `assets`, 기존 이벤트·snapshot migration은 현재 chain에서 **ENABLE RLS**를 사용하며 모든 기존 표에 FORCE가 있다고 주장하지 않는다. 신규 provider/plan의 FORCE와 기존 tenant role의 권한을 구분한다. PostgreSQL은 superuser/BYPASSRLS 역할을 FORCE의 대상으로 만들지 않으므로, superuser 조회 성공을 RLS 통과 근거로 쓰지 않는다. [PostgreSQL RLS 문서](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)

동일 owner의 advisory lock과 row lock은 다른 연결에서 실제 경합해야 의미가 있다. 단일 PGlite 연결에서 순서를 바꿔 실행한 검사는 이를 대체하지 않는다. REPEATABLE READ와 READ COMMITTED의 snapshot 시점도 별도로 검증한다. [명시적 잠금](https://www.postgresql.org/docs/current/explicit-locking.html), [transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html)

이 준비된 runner는 아직 실제 서버에서 실행되지 않았다. 로컬에서 통과하더라도 Neon pooling/서버 역할의 정확한 권한, 네트워크 단절, 운영 규모의 DDL 대기시간, clock skew, provider HTTP/실제 사용권, 실제 Auth journey는 별도 gate다. catalog 검증은 배포 대상의 read-only preflight 승인 후 같은 항목으로 다시 확인한다.

## 0048~0053 migration matrix

| Migration | 추가/기존 row/nullable/backfill | index·constraint·잠금 위험 | 구형 앱과 복구 |
| --- | --- | --- | --- |
| [0048](../drizzle/0048_reporting_currency_inputs.sql) | plan/draft engine 허용값에 currency v2 추가. 기존 JSON과 v1 값 유지. FX `observed_at`, `rate_kind` nullable 추가. backfill 불필요 | 두 CHECK 교체와 FX CHECK 검증. ALTER TABLE의 강한 table lock 및 기존 행 검증 비용. nullable 값은 새 CHECK 통과 | v2 row 작성 전 v1 소비는 유지. v2 작성 후 old-only CHECK 복귀 불가. 구형 parser가 v2를 복원할 수 있다고 가정하지 않음. FX 과거 시각을 fetched/current 시각으로 채우지 않음 |
| [0049](../drizzle/0049_twelve_data_collection.sql) | budget에 `provider NOT NULL DEFAULT 'kis'`, credit counter 기본 0. 기존 KIS counter 보존. reservation은 빈 신규 표. backfill 불필요 | provider/counter CHECK, reservation 복합 PK+budget FK+age index, ENABLE/FORCE RLS 및 tenant/PUBLIC 권한 회수. 기존 budget ALTER/CHECK의 잠금·검증 비용 | 기존 KIS row는 기본 provider로 호환. Twelve enqueue 전 모든 worker가 provider partition을 구분해야 함. 예약/credits 사용 후 삭제·counter 역변환 금지 |
| [0050](../drizzle/0050_native_portfolio_ledger.sql) | account `native_state`, event `native_data/sequence/operation_id`, snapshot `native_evidence` 모두 nullable. 기존 행 null 유지. `legacy_asset_id NOT NULL` 완화하되 legacy branch CHECK로 보호. 자동 변환/backfill 없음 | native sequence/operation partial unique index, JSON 크기·source·owner CHECK, SECURITY INVOKER 함수. 여러 기존 표 ALTER와 event index 구축이 write를 막거나 대기할 수 있음. `CONCURRENTLY` index가 아님 | legacy read 유지. native event 생성 후 legacy_asset_id NOT NULL 복구 불가. 원장 지원 writer와 nullable-aware reader가 version floor. 새 column/함수 삭제는 복구 수단 아님 |
| [0051](../drizzle/0051_market_provider_observations.sql) | observation/action coverage/action 3개 신규 빈 표. 값은 numeric(38,18), 시간은 timestamptz. dataset별 의미에 따라 observed/requested/exchange date nullable. 기존 FX·시세 이동 없음 | PK, coverage FK cascade, basis/source/time CHECK, lookup/expiry index, ENABLE/FORCE RLS, tenant/PUBLIC 회수. 신규 표 생성 위주지만 catalog 잠금은 존재 | disabled 상태의 구형 UI 영향 제한. 새 provider 캐시를 구형 ticker-only 저장소로 복사하지 않음. conflict/coverage 근거를 지우지 않고 수집 중지 후 forward fix |
| [0052](../drizzle/0052_native_legacy_lifecycle_guard.sql) | 함수와 deferred constraint trigger 추가. 데이터 변경 없음. native null인 legacy 계좌는 기존 동작. 동작 제약을 추가하므로 단순히 무영향 additive라고 분류하지 않음 | assets/accounts AFTER row trigger, DEFERRABLE INITIALLY DEFERRED. commit 때 수량·현금·보유·event state 일치 및 row lock 검증. 기존 활성 transaction/DDL과 잠금 충돌 가능 | native 계좌의 구형 수량·원가·통화 변경과 history 삭제는 거부됨. native 계좌가 있으면 guard 및 호환 writer를 유지. trigger 제거로 우회하는 rollback 금지 |
| [0053](../drizzle/0053_native_contribution_plans.sql) | immutable 계획 전용 신규 빈 표. owner/id/currency/request/document/time 필수. 기존 investment_plans와 원장 변화 없음. backfill 없음 | owner FK, owner+id PK, JSON/currency CHECK, owner/time index, ENABLE/FORCE RLS, tenant SELECT/INSERT/DELETE. 신규 표/catalog 잠금 | 구형 화면은 새 계획을 표시 못함. 신버전 계획 저장 후 table을 지우지 않음. 사용자에게 허용된 개별 삭제와 migration rollback의 데이터 삭제는 별개 |

PostgreSQL의 DDL 잠금은 transaction 끝까지 유지될 수 있다. 위 matrix는 소스의 잠금 위험을 식별한 것이며 운영 lock duration을 측정한 결과가 아니다. 배포 대상 table 크기·활성 transaction·migration journal/hash를 승인된 preflight에서 확인하고, `lock_timeout`/`statement_timeout`과 중단 조건을 적용한다. [PostgreSQL 잠금 문서](https://www.postgresql.org/docs/current/explicit-locking.html)

## backfill과 적용 순서

이번 6개 migration에는 필수 데이터 backfill이 없다. 기존 KRW row를 native/USD로 바꾸지 않는다. 과거 환율 관측 시각·원가·기업행위를 새로 추정하지 않는다. native 시작은 사용자가 확인한 시작 현금·수량을 실제 writer로 저장하는 opt-in이다.

미래에 근거가 있는 보정이 필요하면 다음 순서를 별도 승인 범위로 진행한다.

1. **Dry-run:** 대상 source·owner·기간·기존 version·null 조건을 고정한 read-only 후보 manifest를 만든다. 변경 전 hash와 근거 문서/관측 ID를 연결한다. 운영 대상 확인 전에는 실행하지 않는다.
2. **Count:** 후보·이미 처리·근거 없음·충돌을 각각 센다. 예상 count와 다르면 중단한다.
3. **Sample verification:** 합성 검증 후 승인된 실제 표본을 원본 evidence와 대조한다. 공유 보고에는 PII·자산금액·secret을 넣지 않는다.
4. **Bounded batch:** owner/PK 순서와 작은 제한량(초기 상한 100행)을 지정한다. 변경 전 hash/version 일치 조건, transaction, 짧은 lock timeout, 재시도 가능한 operation key를 사용한다. 다른 writer와 동일 owner 잠금을 따른다. null/충돌을 강제로 채우지 않는다.
5. **Post-check:** 처리+미처리 count 대조, 원본 KRW 값/ID/JSON 보존, owner/RLS와 경제적 합계, FX 시각·nullable 근거 확인. 오류 시 다음 batch를 중단하고 원본을 보존한 forward fix를 검토한다.

운영 적용은 아래 순서를 검토·승인한 뒤 진행한다.

1. 현재 source diff·migration hashes를 동결하고 최신 production UI 변경과 통합 검토한다. 운영/Preview journal을 지금 조회했다는 뜻은 아니다.
2. 위 새 클러스터 리허설을 실제 PostgreSQL에서 실행해 PASS 근거를 확보한다. 실패한 case를 숨기거나 PGlite 결과로 대체하지 않는다.
3. 승인된 대상에 한해 role/권한, 0047까지 journal과 hash, existing-native count, table size/lock, 복구 가능한 backup/PITR 상태를 read-only로 확인한다. 사전 조건 불일치 시 migration 중단.
4. compatibility code 배포와 migration 순서를 조율한다. 새 SQL을 읽는 코드가 schema보다 먼저 실행되지 않도록 새 진입을 제한하고, 기존 worker를 중단/drain한다. 검토된 migration batch를 순서대로 적용한다. 공급자는 disabled 유지.
5. tenant scope, 원장 시작/저장/재조회, immutable snapshot/plan, 기존 KRW 흐름을 검증한다. 실제 Auth와 provider는 각각 별도 gate를 충족한다.
6. Twelve queue에 작업이 생기기 전에 구형 비분할 worker가 남지 않았는지 확인한다. 계약/credential/예산/노출 범위 승인 후에만 제한된 provider 검증·활성화를 진행한다.

## 중단·rollback

- migration transaction 실패: 해당 pending batch를 rollback하고 원인·DDL 상태·journal을 확인한다. 실패했던 SQL을 임의로 건너뛰지 않는다. 위 runner는 의도적인 중간 실패에서 DDL rollback을 검사하도록 준비했다.
- 적용 후 아직 새 row가 없는 경우: provider disabled와 새 UI 진입 제한을 유지한다. schema를 남긴 호환 코드 rollback을 우선 검토한다. constraint/column 역변경은 자동 실행하지 않는다.
- v2 draft/plan, native 원장 또는 provider job이 존재하는 경우: 해당 자료를 읽고 보호하는 version floor 아래로 rollback하지 않는다. additive schema, partition-aware worker, 0052 guard와 native writer를 유지한다. 수집·새 진입을 중단하고 원본 보존 후 forward fix한다.
- 0050의 `legacy_asset_id NOT NULL`, 0048 old-only engine CHECK를 되살리거나 native snapshot·원장·계획·coverage를 삭제해 이전 schema에 맞추지 않는다. 사용자의 기록과 이미 관측된 시각을 복구 편의로 바꾸지 않는다.
- 실제 운영 승인 항목은 대상 DB/환경, 0048~0053 hash와 적용 창, 역할 권한, 중단/복구 책임 및 배포 버전이다. provider 계약/credential·공개 범위와 Production 배포는 별도 승인이다.

## 이 문서의 gate

| Gate | 상태 | 근거 |
| --- | --- | --- |
| GATE 3 — isolated PostgreSQL rehearsal | **BLOCKED** | 실행기·사례·PGlite 전체 chain 검사 준비 완료. native PostgreSQL binary와 TCP driver 부재로 gate 차단. 실제 서버 실행 상태는 **NOT RUN** |
| GATE 6 — migration approval | **BLOCKED** | migration matrix·순서·rollback 계획 준비. 운영 대상 확인과 적용 승인은 요청하지도 실행하지도 않음 |
| GATE 7 — production deployment approval | **BLOCKED** | 이번 작업 범위에 운영 배포 승인 없음 |

Gate 1/2/4/5는 전체 RC 보고서의 최신 코드·테스트·Auth/provider 근거로 판정한다. 이 문서의 준비 상태만으로 코드 전체나 운영 공개를 PASS 처리하지 않는다.
