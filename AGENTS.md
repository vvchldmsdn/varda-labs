<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Cairn Labs 작업 기준

- 현재 요청과 기존 승인 범위가 우선이다. cwd·branch/HEAD·staged/unstaged diff와 관련 untracked 파일을 읽고 기존 변경을 보존한다. `.codex/`, `.worktrees/`, QA 산출물을 임의로 정리하거나 staging하지 않는다.
- 기준 입구는 [개발·검증 기준](docs/development-workflow.md)이다. 작업 영역의 링크만 따라가고 과거 완료 기록·포트·브랜치 상태를 현재 사실로 간주하지 않는다.
- 현재 제품 이름·로고는 Cairn Labs이며 신규 진입·가입 이후 흐름은 [제품 중심 온보딩](docs/product-led-onboarding.md)을 우선한다. 과거 문서의 Varda 이름이나 긴 등록 wizard를 되살리지 않는다. 회원 활동 권한·보존은 [회원 활동](docs/member-activity.md)을 따른다.
- 화면 구성은 [presentation composition](docs/design/presentation-composition-redesign.md), 색상·카드·동작은 [visual interaction](docs/design/visual-interaction-redesign.md)을 따른다. 후속 모바일 단순화·한국어/영어·4시간 QA 보완과 옛 문서의 대체 관계는 개발 기준에 정리되어 있다.
- 연결된 server query/writer·공용 엔진·UI를 확인한 뒤 수정한다. owner/tenant/RLS와 실제/가상·실시간/과거·원가/null 경계를 보존한다. UI 정비를 금융 계산·인증·DB 변경의 승인으로 해석하지 않는다.
- 검증은 [명령 영향과 변경별 절차](docs/development-workflow.md#검증-명령의-실제-영향)를 따른다. script/import/환경을 읽기 전에 `test:e2e`, `audit`, `smoke`, `build:vercel`을 안전한 로컬 검사로 간주하지 않는다. Worktree는 DB 격리가 아니다.
- 화면 변경/사용자 QA에는 [varda-ui-qa](.agents/skills/varda-ui-qa/SKILL.md), 변경 검증/PR 리뷰에는 [varda-safe-change](.agents/skills/varda-safe-change/SKILL.md)를 사용한다. 기존 브라우저·리뷰 도구를 재사용한다. 문서만 바뀌면 앱 실행 없이 문서와 변경 보존을 검증한다.
- 비밀값과 인증 state를 출력·커밋하지 않는다. 운영 변경·외부 댓글·commit/push/배포는 작업의 승인 범위 안에서만 수행하며, 지침/Skill의 존재 자체가 실행 권한이 되지는 않는다.

## Code Review Rules

- 세션에서 확정된 owner/RLS를 우회하는 읽기·쓰기, 시각화 편의를 위한 가격·환율·원가·결측 조작을 실제 호출 경로와 재현 조건으로 확인한다.
- 기준일/시세 시각·cache 갱신·CRUD lifecycle 및 모바일/키보드 접근 회귀를 확인한다. 변경 위치와 영향의 근거를 보고하고 기존 결함·의도된 변경을 새 회귀로 섞지 않는다.
- 일반 결함 리뷰는 기존 review-agent를 재사용한다. 독립 검토가 유용한 범위에만 서브에이전트를 사용한다. 실제 확인과 미검증을 구분하며 리뷰만으로 수정·게시·배포하지 않는다.
