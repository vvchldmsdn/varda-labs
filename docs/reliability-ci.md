# 거래 기록·일일 저장 CI

`.github/workflows/reliability.yml`은 모든 PR과 `master` push에 같은 다섯 검사를 실행한다. 경로 필터, 변경 파일 조건, 자동 수정·커밋·push 단계는 없다. 이전 일회성 `trade-entry-verification.yml`을 대체한다.

| 고정 job 이름 | 실제 명령과 판정 |
| --- | --- |
| `lint-type` | ESLint → `next typegen` → `tsc --noEmit --incremental false`. 생성된 route 타입도 검사한다. |
| `unit-tests` | 기존 `tests/run.mjs` 전체 필수 회귀. |
| `production-build` | `next build --webpack`. 배포/마이그레이션을 포함하는 `build:vercel`은 실행하지 않는다. |
| `postgres-integration` | 기존 `krw-usd-rc-rehearsal.mjs`의 `rehearseReliability`로 빈 스키마·기존 스키마 upgrade·실제 PostgreSQL 원장/cutoff/재시도/RLS를 검사한다. 미설치·미실행은 성공이 아니다. |
| `browser-journeys` | 기존 실제 원장 UI → route → PostgreSQL의 세부 복구 사례와 `reliability-fullapp.mjs`의 production Next 전체 화면을 모두 요구한다. Home quick trade·거래 내역·Today·History·정정·모바일을 실제 App Router로 확인한다. 둘 중 누락/실패가 있으면 job은 실패한다. |

## 같은 환경에서 로컬 실행

Node 24와 lockfile의 의존성을 사용한다. 기존 설치가 없다면 `npm ci`, 브라우저 실행 전에 `npx --no-install playwright install chromium`이 필요하다. 이 설치들은 패키지/브라우저 배포 서버에 접근하며 실제 시세 공급자를 호출하지 않는다.

```sh
node scripts/reliability-ci.mjs --validate-only
node scripts/reliability-ci.mjs --job lint-type
node scripts/reliability-ci.mjs --job unit-tests
node scripts/reliability-ci.mjs --job production-build
node scripts/reliability-ci.mjs --job postgres-integration --pg-bin /usr/lib/postgresql/16/bin
node scripts/reliability-ci.mjs --job browser-journeys --pg-bin /usr/lib/postgresql/16/bin
node scripts/reliability-ci.mjs --job all --pg-bin /usr/lib/postgresql/16/bin
```

Windows에서도 같은 명령을 사용하되 `--pg-bin`에는 확인한 PostgreSQL 16 이상 `bin` 절대 경로를 넣는다. PostgreSQL 통합과 브라우저 job 모두 새 폐기 가능한 DB가 필요하며, `--pg-bin`이 없으면 시작하지 않는다. 원격 DB URL, 기존 data directory, 환경 파일을 지정하는 옵션은 없다. `all`은 로컬 자원 충돌을 피하려고 순서대로 실행한다. 각 job 실행 시 환경 경계 자체도 실제 loopback/차단 socket과 임시 소스 복사로 검사한다.

## 격리 경계

- 실행 대상은 `output/reliability-ci/<job>-<run>/workspace`의 소스 복사다. 미커밋 코드도 포함하지만 `.env*`, `.vercel`, `.git`, `.next`, 기존 QA 출력은 복사하지 않는다. dependency 디렉터리만 재사용한다. 원래 checkout의 생성물·앱 소스는 변경하지 않는다.
- 부모의 DB/Auth/provider/Git 토큰, preload, 사용자 설정 홈을 상속하지 않는다. 기본 DB 주소는 연결할 수 없는 loopback 포트 1이며 PostgreSQL rehearsal은 별도의 랜덤 포트/자격증명/신규 data directory만 사용한다. PostgreSQL 서버의 실제 data directory와 주소를 다시 확인한다.
- Node socket은 loopback만 허용한다. 앱의 기존 `next/font` 로딩이 필요한 production build 단계에서는 `fonts.googleapis.com`, `fonts.gstatic.com`만 추가 허용한다. 전체 앱 harness의 build에도 같은 폰트 예외를 적용하고, 앱 실행/페이지 네트워크는 다시 loopback으로 제한한다.
- 전체 앱 로컬 검사는 폐기용 소스 복사의 `current-session-subject` 모듈에서 외부의 확인된 identity subject만 대체한다. 실제 tenant resolver·RLS·writer/query·valuation·App Router를 유지하고 Neon HTTP transport만 로컬 PostgreSQL로 연결한다. 원본 인증 파일의 SHA256 불변도 확인하며 원본 `src`/Next 설정은 변경하지 않는다. cookie 제거/identity 복귀는 실제 provider 로그아웃·이메일 로그인으로 보고하지 않는다. 실제 인증은 승인된 별도 QA Preview에서 검증한다.
- 이 guard는 우발적 외부 연결을 검출하는 장치이며 악성 PR 코드에 대한 OS sandbox라고 주장하지 않는다. GitHub workflow는 `pull_request`를 사용하며 `pull_request_target`, secrets, environment, 쓰기 권한을 사용하지 않는다. checkout 인증도 저장하지 않는다.
- CI의 PostgreSQL 패키지 설치는 시스템 binary 확보용이다. 검증은 기존 시스템 DB에 접속하지 않고 runner가 만든 새 loopback cluster에서 수행한다. PGlite 결과를 실제 PostgreSQL로 표시하지 않는다.
- 산출물은 합성 테스트의 요약·로그·스크린샷만 7일 보관한다. DB cluster 디렉터리·브라우저 프로필·인증 state는 업로드하지 않는다. 로컬 산출물은 `.gitignore` 대상이다.

## 병합 필수 체크 연결 — 별도 승인 후

1. 이 workflow를 승인된 PR로 올리고 다섯 job이 실제 GitHub에서 성공하는지 확인한다. 로컬 PASS는 원격 실행 성공을 의미하지 않는다.
2. 저장소의 `master` ruleset 또는 branch protection에서 위 다섯 job 이름을 required status checks로 선택한다. 체크가 생성된 뒤 이름과 출처가 이 workflow인지 확인한다.
3. 실패한 체크/실행 중인 체크가 있는 PR의 병합이 실제로 차단되는지 확인한다. 관리자의 bypass 정책은 별도 결정한다.
4. workflow/job 이름을 바꿀 때는 기존 필수 체크와 함께 갱신한다. required 이름만 남고 workflow가 실행되지 않는 상태를 만들지 않는다.

이번 후속 요청은 전용 브랜치의 실제 GitHub CI와 격리 Preview까지 포함한다. required check 강제 설정, master 병합, 운영 migration/스케줄/배포는 포함하지 않는다. [최종 SHA와 실행 판정](trade-daily-release-readiness.md)을 따르며 로컬 PASS와 원격 CI PASS를 구분한다.
