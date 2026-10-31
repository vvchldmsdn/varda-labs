# Presentation composition redesign

## 2026-10-31: 현재 적용할 구성 원칙

아래 September 8 기록의 **모든 핵심 화면을 한 viewport 안에 넣는 조건**은 현재 사용자의 요청으로 대체한다. 핵심 결과와 다음 행동을 먼저 보여주되, 글자와 버튼을 줄여 억지로 맞추지 않는다. 자연스러운 문서 스크롤을 허용한다. 과거 검증 결과는 당시 기록이다.

- 첫 화면은 사용자의 질문 하나에 답한다. 홈은 현재 평가·변동과 추가 투자 진입, 히스토리는 선택 날짜의 값과 차트, 추가 투자는 입력과 배분 결과가 우선이다.
- 관련 기능은 짧은 목적형 제목과 선택적인 한 줄 설명으로 연결한다. 공용 `ActionGroup`/`ActionContent`를 사용하고 링크는 이동, 버튼은 현재 화면의 동작으로 구분한다. 모든 화면에 일반적인 ‘다음’ 카드를 붙이지 않는다.
- 추가 투자 계산 이후 계획 작성, 새 투자금 비교, 저장 배분안 조회는 서로 다른 목적이다. 매도·보유 현금 포함 여부를 짧게 표시하며 계산 결과가 실제 주문이나 저장으로 오해되지 않게 한다.
- 긴 근거는 펼쳐보기로 옮긴다. 현재/저장, 실제/가상, 통화, 기준일, 부분 합계와 부족한 근거 등 결과를 해석하는 데 필요한 구분은 유지한다.
- 모바일은 하단 주요 탭과 충분한 터치 영역을 사용한다. 화면에 보이는 순서와 키보드·스크린리더 순서를 맞추고, 상세 화면을 닫으면 이전 선택과 초점을 유지한다.
- 모션은 열기·닫기와 선택 변화, 눌림 피드백에 쓴다. 반복적으로 주의를 빼앗는 효과를 추가하지 않는다. 시스템 및 앱의 효과 감소 설정을 따른다.
- 이번 구현 범위는 홈·추가 투자·히스토리와 베타 공통 탐색이다. 다른 탭·폼까지 검증 완료했다는 뜻은 아니다. 후속 범위는 같은 기준으로 개별 검증한다.

## 이전 구성 기록

The September 8 request supersedes the scrolling page composition of the previous redesign. Keep the existing paper/ink/orange language and direct chart motion. Change the information architecture itself: one route is one composed scene, with a dominant visual, a small set of related facts, and explicit detail entry points.

## Research and decisions

| Source reviewed | Applicable idea |
| --- | --- |
| [Behance: LLI Design](https://www.behance.net/gallery/35744099/LLI-Design-Website-2016) | Give the main visual most of the viewport and reveal supporting content in a side panel. This is an older structural reference, not a current implementation recommendation. |
| [Behance: Node responsive portfolio](https://www.behance.net/gallery/18464299/Node-Responsive-Portfolio-Template) | Compose to both viewport width and height, with restrained navigation around the scene. |
| [Foleon interactive annual report](https://www.foleon.com/templates/annual-reports) | Treat dense reports as interactive scenes and detail layers. Keep chart exploration in context. |
| [SketchBubble minimalist grey presentation](https://www.sketchbubble.com/en/presentation-minimalist-grey-theme.html) | Put the key figures beside a much larger graph instead of stacking both vertically. |
| [Pinterest finance dashboard reference](https://in.pinterest.com/pin/529947081172725203/) | Compared against the slide direction; conventional repeated summary cards are not the selected composition. |

Pinterest and Behance searches included financial dashboards, full-screen portfolio layouts, annual reports, and minimal financial slides. Some original Behance pages were available through indexed descriptions rather than direct fetch. No third-party template code or artwork is copied into the application.

## What changes on screen

- Home: large balance and a few related facts on the left; the holdings heatmap dominates the right. History and evidence open in detail views.
- Today: total movement and price/FX facts, contribution dots, and selected holding share the same horizontal scene. Long holdings lists scroll inside their own region.
- Contribution: input, funding composition, and leading allocations form one scene. The complete allocation list and calculation steps remain one click away.
- Structure: the allocation ring is the centre of the scene, with summary and selected holding on its sides. Group, risk and source details move into overlays.
- Risk: the correlation matrix takes priority over long explanatory tables.
- History: selected date and value on the left, a large chart on the right. Period facts and recorded evidence use detail layers.
- Lab: scenario and selected-date difference beside the actual/hypothetical comparison. Research controls retain their existing authority.
- Simulation: compact risk facts and period controls beside the large probability fan. Weight experiments and validation remain accessible from the scene footer.
- Management: a four-chapter index replaces the full page of links. Each chapter opens its relevant management links. Existing CRUD forms keep their own routes and scrolling where needed.

Desktop navigation also includes previous/next scene links that retain analysis scope and the development-preview flag. Mobile keeps the existing five primary destinations and full menu.

## Layout and interaction contract

Target desktop sizes are 1440 x 900 and 1366 x 768; mobile is 390 x 844. Each primary route should fit its main scene and detail entry points inside that viewport. Do not hide overflow to conceal content. Dense data may use a clearly bounded internal list; detailed tables and forms may scroll inside dialogs. Small-height windows and enlarged layouts retain scrolling access.

The shared frame uses `varda-stage-page` and `varda-stage-content`. Header, main visual and footer are arranged by each view; no transform-based whole-page scaling is used. Chart hover has a keyboard/touch equivalent. Native dialogs support Escape, focus containment and return to the trigger. Reduced-motion preferences remain supported.

Financial calculations, missing-evidence rules, server data access and tenant boundaries are unchanged. The original unfinished contribution policy remains in the original worktree. The local review URL uses marked example data; it does not create a production authentication bypass.

## Verified outcome

Validation completed September 8, 2026:

- The seven primary views, the detailed risk view and the management index were reviewed in real browsers at 1440 x 900, 1366 x 768 and 390 x 844. Main document scrolling is absent; relevant internal lists and detail views remain scrollable.
- All 2,009 tests pass. Full ESLint and the production build pass. `git diff --check` is clean.
- Ten local routes return HTTP 200, including the user's simulation URL with horizon=126, scope=all and kodexWeight=50.
- Calculation pending/completion, scenario and account selection, ring/matrix keyboard interaction, modal focus return, reduced motion and previous/next scene navigation were verified. Fresh browser reviews report no application errors or warnings.
- No database, finance library, dependency or lockfile change. Original HEAD and unfinished files remain untouched. No commit, push or production deployment.

Logs and reviewed screenshots are in the ignored `output/playwright/` directory. The local dev server remains available at `http://localhost:3107/?preview=design`.
