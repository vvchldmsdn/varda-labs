# KRW/USD RC — 실제 인증 검증 절차

2026-09-20. 이 문서는 실행 승인이 아니다. 이번 작업은 새 계정·운영 데이터·인증 설정을 변경하지 않는다.

## 현재 경계

- 이메일과 Google은 Neon Auth transport가 준비된 경우 노출된다. 이메일은 `VARDA_AUTH_EMAIL_PASSWORD_ENABLED=true`, GitHub는 추가로 `VARDA_AUTH_GITHUB_ENABLED=true`가 필요하다. Naver는 별도 서버 설정이 준비된 경우만 노출된다. 세 버튼이 모두 실제 운영에서 켜져 있다고 가정하지 않는다.
- 확인한 코드: `src/lib/auth/auth-method-availability.ts`, `auth-transport-runtime.ts`, `naver-auth-runtime.ts`, `/auth` route, `src/components/first-visit/portfolio-activation.tsx`.
- 과거 QA 계정 사용 승인이 있었지만 이번 요청은 새 가입/운영 mutation을 제외한다. 현재 작업 트리에는 승인된 격리 인증 환경이 확인되지 않았다. 실제 이메일 수신·OAuth 완료는 **NOT RUN**이다.
- `tests/currency-persistence.test.mjs`는 실제 `/api/portfolio-activation` → tenant writer/query → PGlite RLS를 통과한다. 대체 지점은 `readCurrentSessionSubject`, `resolveCurrentTenantContext`, DB transport다. 이메일·OAuth·실제 신원 연결 서버를 대신 검증한 것이 아니다.
- `tests/portfolio-activation.test.mjs`는 만료/다른 탭/취소/재시도/신원 변경/미인증/비활성 owner를 다룬다. 이 테스트의 writer stub은 DB 통합 근거로 세지 않는다.
- 테스트 우회는 import-with-ports 또는 로컬 브라우저 harness에만 있다. Production route에 우회 플래그를 추가하지 않는다.

## 실행 전 준비

1. 운영과 분리된 인증 프로젝트 + DB + callback origin을 확인하고 해당 테스트 계정의 가입/입력 저장/삭제 범위를 승인받는다. 데이터베이스 주소나 토큰을 보고서에 기록하지 않는다.
2. 서버 설정 이름: `NEON_AUTH_BASE_URL`, `NEON_AUTH_BASE_URL_SHA256`, `NEON_AUTH_COOKIE_SECRET`; 표시 기능 플래그는 위와 같다. Naver는 `VARDA_AUTH_NAVER_ENABLED`, `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`, `NAVER_AUTH_SECRET`, `NAVER_AUTH_ORIGIN`. 기존 transport 검증 조건과 callback allowlist를 만족해야 한다. 값은 비공개 설정 채널로만 제공한다.
3. 승인된 로컬/Preview origin을 아래 `<QA origin>`에 사용한다. 실제 사이트에서 임의로 수행하지 않는다. 새 브라우저 profile, 데스크톱 1440×900/모바일390×844를 각각 사용한다.
4. 인증 동작을 녹화할 때 이메일, 비밀번호, callback URL, token, sessionKey, 네트워크 본문을 캡처·일반 로그에 남기지 않는다. 기록에는 시나리오명, 통과 여부, 민감값 없는 화면 경로만 남긴다.

## A — USD 입력 → 이메일 인증 → Home

1. `<QA origin>/try/analyze`에서 English, USD, America/New_York을 선택한다. 임의 테스트 자산 두 개에 $1,000.25와 $234.31를 입력한다. 합계 **$1,234.56** 확인.
2. 결과에서 가입/저장을 선택한다. quick draft identity는 동일 브라우저 내부 검증에서만 비교하고 보고서/URL로 내보내지 않는다.
3. `/auth/sign-up`에서 승인된 이메일 방식으로 가입/인증한다. 현재 서비스에 실제 표시되는 링크/코드 방식을 따른다. 같은 브라우저로 돌아온다. 다른 기기로 인증했다면 원래 브라우저에서 로그인을 계속한다.
4. `/portfolio/activate`의 인증된 GET/POST 후 `/?welcome=1`로 이동하는지 확인한다. Home 합계 $1,234.56, 각 소수 금액·입력 통화·평가 통화·언어·시간대·입력 시각 유지. 계좌/수량/매입단가/목표비중 재입력 요구가 없어야 한다.
5. 새로고침/뒤로가기/저장 재시도 후 같은 입력 기록 1개만 존재해야 한다. 실제 보유 수량/거래/원가가 생성되지 않아야 한다.

## B — 혼합 통화 → 지원 OAuth → 같은 입력

1. `/try/analyze`에서 USD 자산 $1,000.25 + KRW 자산 ₩1,400,000을 입력한다. 평가 통화 USD, 환산 근거를 사용자가 입력하는 UI라면 1 USD=₩1,400. 합계 **$2,000.25**. 이 수동 환율은 입력 구성 분석용이며 과거 실제 수익률 FX가 아니다.
2. 실제 켜진 Google/GitHub/Naver 각각 독립 profile에서 실행한다. 비활성 수단은 **NOT RUN**으로 기록한다.
3. OAuth 완료 후 동일 draft가 인증된 owner 아래 입력 기록으로 저장되고 Home에 위 금액이 보이는지 확인한다. KRW로 바꾸면 같은 입력 기준 **₩2,800,350**. 언어 변경이 평가 통화를 바꾸지 않아야 한다.
4. 승인된 두 번째 QA 신원은 첫 계정의 기록을 조회/삭제할 수 없어야 한다. 공개 Demo 데이터가 저장 기록에 섞이면 실패다.

## C/D — 취소·만료·계정 변경·실패 재시도

| 동작 | 기대 결과 |
|---|---|
| Signup에서 취소 | `/try/analyze` 결과로 복귀, 금액 유지, 영구 저장 없음 |
| 활성화 신원 확인 전 다른 탭에서 입력 변경/취소 | 이전 비동기 응답이 새 draft를 덮거나 저장하지 않음 |
| 한 신원에 묶인 저장 intent에서 계정 변경 | 자동 저장 중단, 입력 확인 후 명시적으로 다시 저장해야 함 |
| 24시간 만료 | 만료 안내와 입력 화면 복귀, 자동 복구·저장 없음. 서버 시간/토큰 조작 대신 로컬 통합 테스트에서 만료 검증; 실제 실험은 대기하거나 승인된 격리 브라우저 상태만 사용 |
| 인증 취소/일시 실패 후 동일 계정 재시도 | 인증 완료 전 owner data 없음, 입력 유지, 성공 후 기록 1개 |
| POST 성공 응답 유실 후 재시도 | 동일 draft id의 기존 기록 반환, 새 holding/거래 생성 없음 |
| 사이트 저장 권한 거부 | 명확한 안내, URL/analytics로 입력을 우회 전송하지 않음 |

분석 이벤트에는 이벤트 이름만 전송되는지 확인한다. 자산 금액·종목·이메일·계좌·draft/session identity를 analytics payload에 포함하지 않는다. `/auth` 민감 경로의 제외는 유지한다. 인증 제공자의 callback token은 필수 인증 프로토콜 경로이므로 주소 전체를 보고서에 복사하지 않는다.

실패 시 개인정보 없이 화면 경로·단계·기대/실제·HTTP 상태만 기록하고 해당 gate를 FAIL로 전환한다. 이메일/OAuth를 실제로 완료하기 전에는 이 절차를 준비했다는 이유로 PASS를 부여하지 않는다.
