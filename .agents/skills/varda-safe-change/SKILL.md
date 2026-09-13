---
name: varda-safe-change
description: Varda Labs의 변경 검증이나 PR 리뷰에서 코드·데이터 권위와 수정 경계를 확인하고 실제 script 영향에 맞춰 검증한다. 단순 문구 수정에 전체 테스트·DB 감사·배포를 자동으로 추가하지 않는다.
---

# Varda Safe Change

[개발·검증 기준](../../../docs/development-workflow.md)의 해당 영역과 명령 영향 표를 읽는다. 기존 승인과 현재 요청이 작업 범위를 정한다. 이 Skill은 DB 접근·수정, 인증 변경, 외부 댓글, commit/push/배포를 독립적으로 승인하지 않는다.

## 변경을 구체화하기

1. 실제 cwd, `git branch --show-current`, HEAD, `git status --short`, staged/unstaged diff와 관련 untracked 내용을 확인한다. 이전 작업 파일을 먼저 구분한다. 관리용 디렉터리와 무관한 변경을 묶어 staging하지 않는다. dirty checkout을 reset/restore/clean/강제 전환으로 정리하지 않는다.
2. 적용되는 `AGENTS.md`/override와 최신 기준 문서를 찾는다. Next 코드 변경은 설치된 `node_modules/next/dist/docs/` 해당 문서를 먼저 읽는다. 이전 문서의 배포 SHA·포트·완료 표시를 현 상태로 간주하지 않는다.
3. 요청 → route → 세션/DAL 또는 writer → 공용 엔진 → UI DTO/상호작용의 연결을 추적한다. 변경 파일, 유지할 계약, 확인할 사용자 결과를 좁게 정한다. 복잡한 수식을 UI에 복제하거나 페이지 파일 전체를 옛 worktree에서 가져오지 않는다.
4. 명령의 package script, 설정, import/helper, 환경 선택·write 옵션·산출물을 읽은 뒤 로컬/테스트 DB/외부 서비스/운영 변경을 구분한다. 이름에 test/audit/smoke/dry-run이 있다는 이유로 실행하지 않는다. Worktree와 `?preview=design`은 데이터 격리를 보장하지 않는다.

## 검증 선택

- 문서·Skill만 바뀌면 링크/경로·frontmatter·자동 블록·diff/원래 변경 보존을 확인한다. 앱 테스트나 서버를 불필요하게 실행하지 않는다.
- 코드 변경은 runner/import 구조를 보고 기존 관련 테스트부터 실행한다. 테스트 선택 방법이 불명확하면 지원되지 않는 인자를 꾸며내지 않는다. `tests/run.mjs`는 명시적 import runner이므로 새 테스트의 발견 여부도 확인한다.
- pure/주입 포트/PGlite로 검증할 수 있는 계산·writer는 외부 DB 없이 우선 확인한다. 테스트 fixture의 I/O 대체가 실제 경로를 덮는지 본다. 실제 Postgres 동시성/권한이 필요한 검증은 별도의 확인된 테스트 DB와 실행 범위가 필요하다.
- UI 변화는 [varda-ui-qa](../varda-ui-qa/SKILL.md)의 영향 화면을 실제 브라우저에서 확인한다. 전체 서비스 점검은 요청된 경우에만 수행한다.
- `test:e2e`의 서버/DB/state 상속, `build`의 환경·prerender·폰트 접근, `build:vercel`의 Preview migration을 구분한다. 세부 분류는 위 공용 문서를 사용한다. 운영 연결이 제외된 작업에서는 해당 검사를 미실행으로 남기고 가능한 로컬 검증을 완료한다.
- 의미 있는 회귀 사례로 검증한다. 단순 스타일 변경의 구현 문구를 그대로 검사하는 테스트는 추가하지 않는다. 통과한 검사를 새 변경·실패·미해결 우려 없이 반복하지 않는다.

## PR/변경 리뷰

실제 리뷰할 diff(미커밋/commit/PR)와 base를 먼저 고정한다. 원격 비교가 필요한 경우 ref의 최신성을 확인하고, merge-base 이후 실제 병합될 변경과 미커밋 변경을 구분한다. 로컬 추적 ref만 봤다면 원격과 같다고 말하지 않는다. 일반 defect-first 리뷰는 사용 가능한 기존 `review-agent`를 재사용한다.

Varda에서 특히 확인할 것은 세션에서 확정된 owner와 RLS, 기준일·시세 시각·FX·원가/null의 일관성, 실제/가상 데이터 구분, CRUD 원장·lifecycle·재시도·cache 갱신, server/client 읽기 순서와 UI 접근 경로다. 파일 위치와 재현 조건이 있는 결함을 심각도 순서로 보고하고, 기존 문제·의도된 변경·미검증 추측을 새 회귀와 섞지 않는다. 발견이 없으면 그 사실과 검증 한계를 쓴다.

독립 검토가 유용할 때만 범위가 겹치지 않는 서브에이전트에게 읽기/검증을 위임한다. 읽기 전용 리뷰어에게 코드 수정을 섞지 않는다. 리뷰만 요청받았다면 외부 댓글 게시나 release를 시작하지 않는다.

## 완료 기록

바뀐 동작과 이유, 실제 실행한 명령/환경/결과, 미실행 항목과 잔여 위험을 구분한다. `git diff --check`와 최종 상태를 확인하고 작업 전 변경이 보존됐는지 대조한다. 비밀값·인증 state·사용자 원자료를 결과에 포함하지 않는다. release가 요청된 경우에만 공용 문서의 PR → Production 확인 절차까지 적용한다.
