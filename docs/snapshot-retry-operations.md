# 일일 저장 재시도와 작업 복구

시세 수집은 기존 일일 `market-cycle/run`이 담당한다. 새 `/api/cron/snapshots/retry`는 저장된 큐의 기한이 된 작업만 처리하며, 새로운 작업 발견·시세/환율 요청·공급자 lease를 실행하지 않는다. 최근 3일의 발견 범위와 이미 큐에 들어온 과거 작업의 처리 범위는 다르다. 큐에 있는 미완료 작업은 3일이 지나도 남는다. 아직 발견되지 않은 3일 초과 공백까지 자동 생성한다고 보장하지 않는다.

## 작업 상태

| 상황 | 실패 예산 | 다음 처리 |
| --- | --- | --- |
| 완료 | 증가하지 않음 | 같은 작업을 재실행하지 않음 |
| 아직 실행 시각이 아님 | 증가하지 않음 | 기한 이후 실행기 호출 |
| owner/행 잠금 충돌 (`55P03`) | 증가하지 않음 | 1분 이후 실행기 호출 |
| cutoff 근거 부족 | 증가하지 않음 | `blocked`로 보존. 근거 보완과 운영자 검토 후 정확한 작업만 재등록 |
| snapshot 저장 실패 | 최대 4회 | 5/10/20분 뒤 시도; 4회 이후 운영자 검토 |
| 실행 중 worker 종료 | 1회 사용 | lease 만료 후 다음 worker가 인계. 4번째 종료는 `worker_interrupted_retry_exhausted`로 종료 |

`attempts`는 실패 횟수와 현재 실행이 예약한 실패 한 칸의 합이다. 완료·근거 보류·잠금 보류는 예약을 반환한다. `generation`은 인계와 명시적 재등록 때 증가하며, 오래된 worker의 금융 쓰기·완료 처리를 막는다.

매일 한 번인 현 운영 스케줄은 변경하지 않았다. 5분 뒤 재시도 시각이 저장됐다는 사실은 5분 뒤 실제 실행을 뜻하지 않는다. 계획/요금제와 별도 승인을 확인한 뒤 이 **provider-free 경로**만 5분 또는 10분 간격으로 호출하는 방안을 검토한다. 새 route는 기존 관리 인증과 `MARKET_CYCLE_CRON_WRITE_ENABLED`를 따르며 query parameter를 받지 않는다. DB의 release 쓰기 중지 장치가 활성화돼 있으면 큐 쓰기도 중단된다.

## 격리 로컬 복구 도구

`scripts/snapshot-work-operator.mjs`는 이번 검증용 로컬 PostgreSQL만 허용한다. 원격 DB URL이나 프로세스의 `DATABASE_URL`을 읽지 않는다. 명시적 연결 파일의 purpose, loopback host, 포트, DB 이름, `rc_admin` 역할을 확인하고 접속한 서버의 주소/역할/DB도 다시 확인한다. 파일의 비밀번호와 연결 정보는 출력하지 않는다. 연결 파일은 검증 환경에서만 만들며 커밋하지 않는다.

연결 파일 형식은 `{ "purpose": "cairn-reliability-isolated-postgres", "connection": { "host": "127.0.0.1", "port": <격리 포트>, "user": "rc_admin", "database": "postgres", "password": <파일에만 보존한 검증용 값>, "ssl": false } }`이다. 운영용 자격 증명을 넣지 않는다.

조회 인자:

```text
node scripts/snapshot-work-operator.mjs --connection-file <절대 경로> --action inspect --work-id <작업 UUID> --owner-id <테스트 owner UUID> --account-id <테스트 계좌 UUID> --revision <정확한 revision>
```

조회 결과는 상태·실패 횟수·다음 시각·generation·짧은 사유와 `nextAction`이다. 금융 원자료는 조회하지 않는다. `blocked`와 `failed`만 검토 후 재등록할 수 있다. 완료/진행 중 작업, 다른 owner/계좌, 바뀐 revision/generation은 거부한다.

재등록은 같은 인자에 `--action requeue --generation <조회한 generation> --reason <검토 사유 코드>`를 사용한다. 사유는 `evidence_restored`, `transient_issue_resolved`, `lease_interruption_reviewed` 중 하나다. 이것은 사실 확인을 대신하는 버튼이 아니다. cutoff 당시 근거가 복구됐는지, 실패 원인이 해소됐는지를 먼저 확인한다.

재등록은 기존 작업의 원인·상태·실패 횟수·generation을 `market_data_sync_runs`의 별도 `snapshot_work_requeue` 기록에 남긴 뒤 같은 transaction에서 해당 작업만 `pending`으로 돌린다. 새로 시도할 4회 예산을 열어 주며 이전 예산은 감사 기록에 보존한다. 원장/기존 snapshot/수량/현금은 변경하지 않는다. Production 복구 도구나 Production 실행 승인으로 사용할 수 없다.

## 근거

- `tests/snapshot-retry.test.mjs`: 관리 인증/옵트인/HTTP 상태, 순수 retry 실행 경계, 잠금 원인 분류, 원격 연결 차단.
- `scripts/reliability-retry-cases.mjs`: 실제 격리 PostgreSQL에서 오래된 큐, 근거 보류→감사 가능한 재등록→실제 snapshot writer, 4회 실패, 실제 owner lock 충돌, 기한 전 호출, 4회 worker 종료.

최종 실행 여부와 결과는 이번 release 검증 보고를 따른다. 이 문서만으로 테스트나 운영 스케줄이 실행됐다고 판단하지 않는다.
