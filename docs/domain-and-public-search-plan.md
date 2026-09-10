# .com 도메인과 공개 검색 유입 도입안

2026-09-10 코드 및 공식 문서 조사. 제안 단계이며 도메인 구매·DNS·인증 설정·검색 정책은 변경하지 않았다.

## 판단

`.com` 자체가 Google 순위를 높이지는 않는다. 장기적인 서비스 이름, 기억하기 쉬운 주소, 공유와 이메일 발신 도메인을 확보하는 목적에서 도입할 가치가 있다. [Google의 TLD 안내](https://developers.google.com/search/help/site-position-in-search-faq)

현재 `src/app/layout.tsx`는 모든 현재 경로에 `noindex, nofollow`를 부여한다. 익명 홈은 로그인으로 이동하고 공개 소개 페이지·sitemap·canonical·언어별 검색 URL이 없다. 따라서 도메인 연결만으로 공개 검색 유입이 만들어지지는 않는다. `noindex`는 검색 결과 제외 지시이며 인증을 대신하는 접근 제어가 아니다. [Google robots 지침](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag)

## 도메인 선택

- 먼저 `vardalabs.com`을 후보로 검토한다. 읽기 쉽고 현재 서비스 이름과 대응한다.
- 가용하지 않거나 갱신 비용이 지나치면 `varda-labs.com`, `getvarda.com`을 비교한다. 모두 **등록 가능 여부·가격·기존 브랜드와의 혼동을 아직 확인하지 않은 후보**다.
- 첫해 할인보다 매년 갱신 가격, 등록자 계정의 2단계 인증, 자동 갱신, 소유자 계정 접근을 확인한다. 소유자는 사용자 계정으로 둔다.
- Vercel에서 구매하면 연결 관리가 단순하다. 외부 등록기관에서 구매해도 기존 프로젝트에 DNS로 연결할 수 있다. 실제 DNS 값은 프로젝트가 제시하는 값을 사용한다. [Vercel 도메인 연결](https://vercel.com/docs/domains/working-with-domains/add-a-domain)

## 실행 순서와 완료 조건

1. **주소 확정과 구매:** 실제 가용성·갱신 비용을 확인해 사용자가 주소와 비용을 확정한다.
2. **기존 Production에 연결:** Vercel 프로젝트 Settings → Domains에 apex와 `www`를 추가한다. 프로젝트가 제시하는 DNS 레코드를 등록하고 HTTPS 발급을 확인한다. 대표 주소는 하나로 고정한다. Vercel은 `www`를 대표 주소로 두고 apex를 리다이렉트하는 구성을 권장한다. [대표 주소와 redirect](https://vercel.com/docs/domains/working-with-domains/deploying-and-redirecting)
3. **인증을 새 주소에서 검증:** Neon의 allowed/trusted app origin, Google·GitHub의 실제 Managed Auth callback, 인증 메일·비밀번호 초기화 복귀 URL을 확인한다. `NEON_AUTH_BASE_URL`은 Auth 서버 주소이므로 앱 도메인으로 치환하지 않는다. Naver는 `NAVER_AUTH_ORIGIN`, 서비스 URL, `/api/oauth/callback/naver` 등록을 맞춘다. 기존 host 쿠키가 새 도메인으로 자동 이동한다고 기대하지 않는다.
4. **기존 주소 처리:** 새 주소에서 로그인·세션·원장 scope를 확인한 뒤 기존 `.vercel.app`의 사용자 페이지를 같은 경로의 대표 주소로 영구 이동한다. API/Cron·OAuth callback은 별도로 확인한다. host 조건은 Production 사용자 주소에만 적용하고 Preview/localhost를 강제 이동시키지 않는다.
5. **공개 검색 페이지 도입:** `/ko`, `/en` 소개와 `/ko/methodology/...`, `/en/methodology/...` 계산 가이드를 공개한다. 현재 개인 앱의 인증 경계를 유지한다. 공개 페이지에만 index 정책, canonical, 언어 alternates/hreflang, 제목·설명·OG 이미지, sitemap을 적용한다. 검색엔진이 로그인 없이 본문을 읽을 수 있게 서버에서 렌더링한다. 앱 안의 쿠키 언어 전환과 공개 문서의 언어별 URL은 용도가 다르다.
6. **검색과 분석 확인:** Search Console 도메인 소유 확인, 공개 sitemap 제출, URL 검사, 실제 Analytics 이벤트를 확인한다. 기존 주소가 실제 색인돼 있었다면 주소 변경 도구와 URL 대응 redirect를 적용한다. 순위 변동·재색인 시간이 생길 수 있으므로 일정한 순위 상승을 약속하지 않는다. [Google 사이트 이전 절차](https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes)

공개 가이드는 단순 키워드 페이지보다 실제 서비스의 계산·가정·예제·한계를 설명하는 콘텐츠로 시작한다. 이번 수식 설명을 근거로 삼되 개인 데이터, 내부 계정 식별자, 사용자별 결과를 공개 콘텐츠로 내보내지 않는다.

## 현재 코드의 전환 점검 지점

| 지점 | 필요한 확인 |
| --- | --- |
| `src/app/layout.tsx` | 현재 개인 앱의 noindex 유지; 공개 route에서만 명시적으로 index/metadata 덮어쓰기 |
| `src/lib/i18n/server.ts`, locale provider | 공개 한·영 URL별 언어와 메타데이터를 일치시키기 |
| `src/lib/auth/naver-auth-request.ts`, `naver-auth-config.ts` | exact origin, `__Host-` cookie, JWT audience와 새 callback |
| `src/lib/auth/auth-transport-api-contract.ts` | 요청 origin으로 만든 인증·재설정 복귀 링크 |
| `src/lib/auth/identity-pairing-claim-presentation-transport.ts` | 기존 `.vercel.app` 고정 origin; 운영 bootstrap-claim 기능 사용 시 점검 |
| Analytics / QA 문서·스크립트 | 새 대표 URL의 실제 이벤트, base URL, 저장된 테스트 인증 state 재인증 |

DB·tenant·사용자 계정의 이전이 필요한 것은 아니다. 이 제안에서는 가격·도메인 가용성·상표 충돌·Vercel/Neon 콘솔 설정·현재 Google 색인 현황은 확인하지 않았다.
