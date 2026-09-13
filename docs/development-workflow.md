# Varda 개발·검증 기준

이 문서는 작업에 필요한 기준을 찾는 입구다. 기능 명세나 과거 검증 기록을 복사하지 않는다. 현재 사용자의 요청·허용 범위를 먼저 확인하고 해당 영역의 문서, 연결된 코드와 테스트를 함께 읽는다. 구현과 계약이 다르면 구현을 자동으로 정답으로 삼지 말고 불일치의 근거를 밝힌다.

## 기준 문서와 우선순위

| 작업 영역 | 먼저 읽을 기준 | 적용 범위와 주의점 |
| --- | --- | --- |
| 화면 구성 | [Presentation composition](design/presentation-composition-redesign.md) | 데스크톱은 큰 시각화와 관련 핵심 요약을 한 장면에 배치하고 상세 정보는 명확한 진입점으로 제공한다. |
| 색상·카드·동작 | [Visual interaction](design/visual-interaction-redesign.md) | 밝은 paper/ink, 절제된 주황 강조와 음수의 파랑, 필요한 곳의 완결된 시각화 카드. 이 문서의 옛 세로 배치는 위 구성 문서가 대체한다. |
| 실제 스타일 | [layout.tsx](../src/app/layout.tsx), [presentation.css](../src/app/presentation.css), [modern.css](../src/app/modern.css), [motion.css](../src/app/motion.css), [stage.css](../src/app/stage.css), [locale.css](../src/app/locale.css) | 토큰과 import 순서, 뒤의 미디어 규칙까지 확인한다. 문서에 있는 옛 색상값을 CSS 위에 덮어쓰지 않는다. |
| 신규 사용자 | [New-user experience](new-user-experience.md) | 수량·현재 보유자산으로 시작, 원가는 선택 입력, 실제 개인 기록과 공용 시장 이력 분리. 아래의 최신 모바일·반복 QA 보완을 함께 적용한다. |
| 오늘 변동·실시간 이력 | [Movement contract](today-movement-readonly-data-contract.md), [History contract](history-balance-readonly-design.md) | 과거 단계의 범위 제한은 현재 기능 목록이 아니다. 현재 연결은 [dashboard query](../src/db/queries/portfolio-dashboard.ts), [baseline](../src/lib/portfolio-dashboard-baseline.ts), [movement](../src/lib/portfolio-movement.ts), [live history](../src/lib/history-live-valuation.ts)와 해당 테스트에서 확인한다. |
| 추가투입 | [Policy completion](additional-contribution-policy-completion.md), [실행된 보완 정책](multi-user-collection-and-contribution-adjustments.md) | 기본 계산과 나중에 구현된 근거 신선도·가정 비교의 관계를 유지한다. [Adjustment policy](additional-contribution-adjustment-policy.md)의 연구 제안을 모두 구현된 기능으로 간주하지 않는다. |
| 투자 랩·시뮬레이션 | [Counterfactual contract](investment-lab-historical-counterfactual-contract.md), [Execution input authority](simulation-execution-input-authority-contract.md) | 실제와 가상의 비교·입력 권위를 먼저 확인하고, 변경하는 엔진이 참조하는 세부 계약만 추가로 읽는다. 투자 추천으로 해석하거나 결측을 가공해 채우지 않는다. |
| CRUD·다중 사용자·시세 수집 | [Mutation and lease authority](portfolio-mutation-and-provider-lease-authority.md), [실행된 수집 보완](multi-user-collection-and-contribution-adjustments.md) | 세션 owner, tenant/RLS, 원장·보유 lifecycle, 공유 수집·제한을 연결된 writer와 함께 확인한다. 옛 문서의 registry 개수·상태는 재확인이 필요하다. |

[Simple modern](design/simple-modern-redesign.md)은 첫 제안 기록이다. [Presentation system](design/presentation-system.md)의 cobalt/terracotta 팔레트도 현재 색상 기준이 아니다. 두 문서는 삭제하지 않되 최신 디자인을 되돌리는 근거로 사용하지 않는다. [Frontend route map](frontend-surface-route-map.md)과 [Price/snapshot pipeline](price-sync-and-snapshot-pipeline.md)의 옛 보호 방식·미구현/Cron 상태, 각 문서의 포트·브랜치·테스트 통과 수는 당시 기록이며 현재 실행 지침이 아니다.

### 후속 사용자 요청으로 보완된 기준

- 모바일은 데스크톱 장면을 축소해 끼워 넣지 않는다. 핵심 수치·다음 행동·간결한 목록을 먼저 보여주고 큰 그래프는 단순화하거나 상세 보기로 옮긴다. 필요한 스크롤은 허용한다. 데스크톱도 창 높이·확대 때문에 내용이 잘리면 접근 경로를 남긴다.
- 모달·날짜 선택창은 닫기/취소와 충분한 주변 공간을 확보한다. 배경 탭, Escape, 포커스 복귀와 내부 링크 이동을 확인한다. 모바일 Today의 종목 터치는 선택 요약을 바꾸고 그 요약에서 상세를 여는 흐름을 보존한다.
- 한국어·영어는 같은 계산과 기능을 제공한다. 긴 영어 문구, 작은 화면, 숫자·날짜·통화 표기가 레이아웃과 의미를 깨뜨리지 않아야 한다.
- 07:00 Asia/Seoul은 서비스 기록 경계다. 오늘 변동의 기준일·시세 기준 시각·조회 시각을 구분한다. 장 시작 전·휴장이라는 이유로 값을 강제로 0으로 만들지 않는다. 기준이 오래됐거나 없으면 그 이유를 표시한다. 오늘의 실시간 히트맵/평가액과 저장된 과거 기록은 구분하며 과거 원가를 현재 원가로 다시 쓰지 않는다.
- 기존에 요청된 반복 사용자 QA는 **4시간 간격**이며 기능·로직·UI·UX·디자인·성능을 함께 본다. `new-user-experience.md`의 six-hour 문구는 이전 기록이다. 기존 점검에 거래·계좌 시나리오를 **추가**하는 것이며 대체하지 않는다. 이 문서나 Skill 호출 자체는 예약을 만들거나 변경하거나 즉시 실행하지 않는다.

## 변경 경계

1. 실제 cwd, branch/HEAD, `git status --short`, staged/unstaged diff, 관련 untracked 파일과 적용 `AGENTS.md`/override를 먼저 확인한다. 오래된 checkout과 최신 작업 worktree를 혼동하지 않는다. 원래의 dirty 작업과 `.codex/`, `.worktrees/`, QA 산출물을 임의로 추가·삭제하지 않는다.
2. 문서/Skill 정비는 해당 파일에 한정한다. UI 작업이 계산·인증·스키마 변경의 권한이 되지는 않는다. 기능 변경은 route → server query/writer → 공용 엔진 → UI DTO/상호작용 순서로 실제 연결을 확인해 가장 작은 경계에서 수정한다.
3. DB 읽기는 Server Component/DAL에, 실제 상호작용은 Client Component에 둔다. 독립 읽기는 병렬화하고 세션·tenant·입력 검증 의존 순서는 유지한다. UI에 별도 금융 공식을 만들거나 화면 진입 때마다 provider 체인을 중복 호출하지 않는다.
4. Worktree는 DB를 격리하지 않는다. 기존 세션의 승인도 포함해 대상·영향·권한을 확인한다. 운영 데이터 보정/삭제, 스키마 적용, 인증 설정, provider 작업과 배포를 검증 명령에 몰래 포함하지 않는다. 비밀값·쿠키·인증 state·개인 원자료는 로그나 커밋에 넣지 않는다.

## 검증 명령의 실제 영향

2026-09-10, `c104c52`의 [package.json](../package.json), [test runner](../tests/run.mjs), [Playwright config](../playwright.config.ts)와 아래 entry/helper를 정적으로 확인했다. 실행 성공을 뜻하지 않는다. **명령·설정·import가 바뀌면 다시 분류한다.** 표에 없는 script나 옵션은 이름으로 안전 등급을 추정하지 않는다.

| 명령 | 확인한 영향 | 실행 전 조건 |
| --- | --- | --- |
| `git diff --check`, 문서 링크·Skill frontmatter 검사 | 로컬 파일 검사 | 새 untracked 문서도 별도로 포함한다. 문서만 바뀌면 이것이 기본 검증이다. |
| `npm run lint` | 로컬 ESLint, 수정 옵션 없음 | [ESLint config](../eslint.config.mjs)와 대상 파일 확인. |
| `npm run dev`, `npm start` | 로컬 서버 시작; 요청 경로에 따라 DB/Auth/provider 접근·갱신 가능 | 서버 주소만 localhost라고 데이터까지 격리되는 것은 아니다. 환경 로딩과 연결된 route를 확인한다. |
| `npm test`, `npm run test:coverage` | 정적/pure fixture와 임시 파일·메모리 PGlite 테스트 | [import-with-ports](../tests/helpers/import-with-ports.mjs), [mutation integration](../tests/portfolio-mutation-integration.test.mjs) 등 확인한 통합 테스트는 실제 DB/provider 대신 포트를 주입한다. 외부 테스트 DB는 요구하지 않는다. runner의 추가 import와 fixture 격리를 확인한다. |
| `npm run build` | `next build`, 로컬 산출물·환경 읽기; Google 폰트 네트워크 가능 | layout/config/prerender 경로를 읽는다. 빌드라는 이유만으로 DB 미접근을 보장하지 않는다. `build:vercel`과 구분한다. |
| `npm run test:e2e`, `npm run test:e2e:ui` | 설정에 따라 dev 서버 시작 또는 지정 서버 접근, 브라우저 파일 생성 | 아래 E2E 경계 확인. 자동으로 격리되거나 Production 읽기 전용이 되지 않는다. |
| `db:preview:preflight`, `db:preview:postflight` | 외부 DB SELECT + 로컬 임시 evidence 쓰기/읽기 | [preview evidence](../scripts/preview-database-evidence.mjs)의 연결 대상 확인. 문서 검증에 실행하지 않는다. |
| `npm run build:vercel` | Preview에서 preflight → **db:migrate** → postflight → build | [vercel-build](../scripts/vercel-build.mjs) 확인. 스키마 변경 가능한 배포 작업이다. |
| `db:generate`, `db:migrate`, `db:studio` | generate는 로컬 migration 파일 생성; migrate/studio는 환경 DB 적용·편집 가능 | [Drizzle config](../drizzle.config.ts) 확인. 생성과 DB 적용을 분리한다. |
| `rehearse:identity-pairing-consume`, `rehearse:tenant-expand`, curated-vector rehearsals | 외부 DB에서 실제 DDL/DML; 일부는 마지막에 rollback | [identity rehearsal](../scripts/rehearse-identity-pairing-consume-writer.mjs), [tenant rehearsal](../scripts/rehearse-tenant-expand.mjs) 확인. 전용 폐기 가능한 **테스트 DB** 필요. rollback을 운영 안전성으로 간주하지 않는다. |
| `audit:*`, `smoke:*` | 명령마다 로컬 분석/외부 DB·HTTP/인증 변경이 다름 | 예: [auth transport audit](../scripts/audit-auth-transport-runtime.mjs)는 소스 검사, [RLS helper](../scripts/lib/audit-tenant-table-rls.ts)는 DB 접근, [gold audit](../scripts/audit-fsc-krx-gold-source.mjs)는 provider 호출, [auth smoke](../scripts/smoke-auth-transport-route.mjs)는 sign-out POST도 실행한다. 각 실제 구현을 먼저 읽는다. |
| `snapshots:*`, `identity:assign-*`, `identity:issue-bootstrap-claim`, `target-policy:record`, `tenant-db-role:provision`, `cleanup:*`, `import:*`, `simulation:complete-kis-history`, `market-factors:sync-core`, `investment-lab:complete-stress-history` | 운영 데이터·권한 변경 또는 provider 수집 가능 | 일반 검증 목록에서 제외한다. plan/dry-run도 외부 읽기·호출량을 소비할 수 있다. 대상과 실행 옵션을 개별 확인한다. |

### 기존 E2E 재사용

- [presentation-and-auth.spec.ts](../e2e/presentation-and-auth.spec.ts)는 개발 전용 `?preview=design` 화면과 더미 인증 입력을 검증한다. Production URL에서 이 suite를 실행하지 않는다. mock 화면 통과는 실제 가입·원장·RLS의 증거가 아니다.
- [authenticated-portfolio.spec.ts](../e2e/authenticated-portfolio.spec.ts)는 `E2E_AUTH_STORAGE_STATE`가 있으면 실제 Home → Today를 방문한다. 방문에 따른 자동 갱신/수집도 고려한다. 인증 state가 없어 skip된 검사는 통과한 사용자 여정으로 보고하지 않는다.
- `PLAYWRIGHT_BASE_URL`은 dev 서버 생성을 생략한다. 기본 설정도 프로세스의 `DATABASE_URL`을 상속하고 CI 외에는 기존 서버를 재사용한다. 가짜 DB URL fallback 하나가 격리를 증명하지 않는다. 연결된 `.env`의 값을 출력하지 말고 env 로더·변수 이름·대상 환경을 확인한다.
- 디자인 QA는 확인된 전용 localhost 서버와 DB/Auth/provider가 격리된 프로세스를 사용한다. 기존 설정/테스트를 재사용하고 전역 설정이나 새 프레임워크로 대체하지 않는다. 운영 연결이 금지된 작업에서는 실제 포트·서버·환경을 확인할 수 있을 때만 실행한다.
- 기존 desktop-chromium/Pixel 7 프로젝트와 실패 시 screenshot/video/trace를 재사용한다. 성공한 전후 화면은 수동으로도 캡처해야 한다. 공유용 근거는 비밀값 없는 `output/playwright/<작업명>/`에 두고, 인증 state·개인정보가 든 trace를 그대로 첨부하지 않는다.

## 작업 크기에 맞는 검증과 리뷰

| 변경 | 최소 검증 |
| --- | --- |
| 문서·Skill | 상대 링크/명시된 경로, frontmatter, Next 자동 블록 보존, diff와 원래 변경 보존. 앱 테스트·build·E2E·DB audit는 필요하지 않다. |
| UI/상호작용 | 관련 기존 테스트와 lint, 영향 화면의 실제 desktop/mobile 조작 및 전후 화면. 공용 스타일/탐색 변경은 연결된 화면까지 넓힌다. |
| 계산·CRUD | 관련 pure/주입 포트/PGlite 회귀 테스트로 먼저 확인하고 영향도에 따라 전체 test/lint/build. PGlite는 실제 다중 세션 Postgres 동시성·RLS 검증을 대체하지 않는다. |
| 명시적으로 요청된 release | 전체 test/lint/Production build, 실제 diff 리뷰, PR, 확인한 Production branch 병합, Vercel Ready와 배포 SHA/alias, HTTP 및 영향 화면 확인. `master`/`main` 이름을 추정하지 않는다. 이 절차의 존재만으로 배포가 승인되지는 않는다. |

PR 리뷰는 변경된 동작의 재현 조건·영향·파일 위치·증거를 우선한다. 세션 owner/RLS 누락, 금융 기준일·통화·원가/null 오염, 일반 화면의 렌더 시점 write/provider 호출, stale cache, 모바일/키보드 접근 회귀를 실제 호출 경로로 확인한다. 의도된 변경이나 기존 결함을 새 회귀로 보고하지 않는다. 발견이 없으면 없음과 남은 검증 한계를 쓴다. 일반 defect-first 리뷰는 사용 가능한 기존 `review-agent`를 재사용하고 별도 중복 Skill을 만들지 않는다. 리뷰만 요청받았으면 파일 수정·외부 댓글 게시·배포를 수행하지 않는다.

서브에이전트는 독립적인 읽기/리뷰/테스트처럼 병렬 실행의 이점이 있는 부분에만 쓴다. 대상 파일과 쓰기 권한을 분리하고 결과를 근거로 통합한다. 의견 수가 코드·계산·브라우저 증거를 대신하지 않는다.

## Skill 사용

저장소의 `.agents/skills/`에 두고, 이 checkout에서 사용한다. 기존 브라우저 Skill은 조작 방법을, 기존 리뷰 Skill은 일반 결함 리뷰를 담당한다. 아래 두 Skill은 Varda 기준과 검증 경계를 연결한다.

- `$varda-ui-qa 오늘 변동의 모바일 선택·상세 모달을 데스크톱과 함께 확인해줘.`
- `$varda-safe-change 현재 변경의 검증 범위를 정하고 PR 리뷰해줘. 외부 연결과 배포는 하지 마.`

Skill 선택기에 없으면 해당 `SKILL.md` 경로를 직접 지정해 읽게 할 수 있다. 저장소 범위 발견 및 명시적 호출 방식은 [Codex Skills](https://learn.chatgpt.com/docs/build-skills), AGENTS 로딩은 [공식 지침](https://learn.chatgpt.com/docs/agent-configuration/agents-md)을 따른다. 전역 설치·설정 변경은 필요하지 않다. 파일 생성만으로 GitHub 자동 리뷰나 예약 QA가 활성화되는 것은 아니다.
