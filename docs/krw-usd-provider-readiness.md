# KRW/USD 공급자 연결과 공개 전 조건

확인일: 2026-09-20. 코드 구현, 합성 응답을 사용하는 격리 SQL 검사, 실공급자 검증, 운영 공개는 서로 다른 상태다. 이번 구현·검사에서 유료 가입·실 API 호출·문의 발송·운영 설정 변경은 하지 않았다.

## 현재 구현과 변경 경계

- 기존 `MarketDataProvider` 어댑터, 별도 공급자 partition을 쓰는 `twelve-data-collection.ts`, 서버 config, provenance 저장기와 demand service가 있다. 회원 loader는 검토된 상장 tuple을 `resolveTwelveDataTarget`으로 해석한 뒤 요청한다. 미지원·복수 상장은 해당 종목의 결측으로 남긴다.
- 미국 주식/ETF의 검토된 상장 매핑만 허용한다. 키·티커·MIC·거래소·USD가 맞아야 응답을 받아들인다. 검색 결과나 같은 이름만으로 상장을 선택하지 않는다.
- 실 호출은 서버 전용 factory의 확인된 사용권, 허용 dataset/audience, 만료일, 별도 출시 승인, 원자적 예산 예약 함수가 모두 필요하다. API 키·언어·URL의 `fixture`/`preview`만으로 활성화되지 않는다. 기본값은 비활성이다.
- fixture transport는 별도 `mode: fixture`에만 있고 자격증명을 받지 않는다. 결과는 `twelve_data_fixture`와 `synthetic`으로 구분한다. 실 데이터의 공개·품질 검증을 의미하지 않는다.
- HTTP는 고정 공식 origin, redirect 금지, no-store, 시간/응답 크기 제한을 사용한다. 오류는 정해진 코드로 줄여 키가 섞일 수 있는 공급자 원문을 전달하지 않는다.

## 구현된 endpoint 계약

공식 [API 문서](https://twelvedata.com/docs)의 필드와 매개변수를 기준으로 작성했다.

| 경로 | 구현 | 의미와 제한 |
| --- | --- | --- |
| `/quote` | `prepost=false`, 검토된 symbol/MIC/exchange, `close`와 `last_quote_at` | `timestamp`는 봉 시작 시각이므로 최신 가격 시각으로 쓰지 않는다. 시간외 별도 필드를 섞지 않는다. 실시간/지연 표시는 확인된 계약 설정에서 온다. |
| `/time_series` | `interval=1day`, `adjust=none`, 최대 366일 창, raw close | 수정주가·배당반영 수익률 필드는 null. 일별 날짜를 정확한 종가 timestamp로 꾸미지 않는다. 당일 미완성 일봉은 받지 않는다. |
| `/exchange_rate` | `symbol=USD/KRW`, 응답 `rate`/`timestamp` | USD 1당 KRW. 반대 쌍·관측 시각 누락·미래 시각·0 환율은 거부한다. |
| `/exchange_rate` 과거 조회 | 명시적 `date`, `timezone=UTC`, 별도 `usd_krw_history` 권한 | 요청 시각과 실제 응답 timestamp, 나중의 수집 시각을 각각 보존한다. `historical_spot`이며 일별 고시환율로 바꾸지 않는다. 요청 시각 이후 관측은 거부한다. |
| `/splits`, `/dividends` | 검토된 상장과 명시적 일자 창, 배당 `adjust=false` | 실제 사건과 기간별 수집 완료/미확인을 분리한다. 분할 인자와 수정하지 않은 현금배당을 저장한다. |

가격 문자열은 표시 단위로 먼저 반올림하지 않는다. 일별 날짜는 뉴욕 현지 거래일로 보존하고 수집 시각과 분리한다. `getTwelveDataCompletedHistoryWindow`는 뉴욕 오늘 전날까지 최대 366일을 선택한다. 오래된 관측은 값을 덮거나 0으로 만들지 않는다. 공급자의 수정주가·총수익률 시계열, 검색 전체 수집, WebSocket, 해외 전체 거래소는 구현하지 않았다.

`0051_market_provider_observations.sql`의 별도 reference cache는 MIC·session·license scope·가격 조정 방식·요청/관측/수집 시각을 보존한다. 기존 ticker-only 시세 writer에 이 응답을 넣지 않는다. 동일 관측의 다른 가격/시각은 원래 값을 덮지 않고 conflict로 격리한다. raw 이력만 받은 상태에서 투자 랩·시뮬레이션의 조정가격 요구를 만족했다고 표시하지 않는다.

## 공식 확인과 서면 확인 구분

Twelve Data [사업용 페이지](https://twelvedata.com/pricing-business)는 외부 표시와 외부 배포를 구분한다. 가격은 선택한 크레딧에 따라 달라지는 구성형이며 최종 Cairn 견적은 없다. [이용약관](https://twelvedata.com/terms)도 허용 용도·추가 약정·거래소 조건·보관 제한을 둔다. 키나 유료 구독만으로 모든 사용 권한이 생긴다고 해석하지 않는다.

| 항목 | 지금 확인한 것 | 공급자에게 서면 확인할 것 |
| --- | --- | --- |
| 미국 주식·ETF, FX | 공식 상품/endpoint가 존재 | 선정한 상장/MIC와 USD/KRW, 실시간·지연·종가별 실제 구독 범위·샘플 품질 |
| 이용자 지역 | 전 세계 시장 소개는 이용지역별 권한의 증거가 아님 | 한국·미국·그 외 국가 방문자의 허용 범위, 전문투자자 구분과 사용자 보고 |
| 공개 Demo·회원 화면 | 외부 표시 상품은 존재 | 비회원/회원별 사용권, 익명 트래픽, 로그아웃 뒤 공개 캐시 재사용 |
| 랜딩 영상·스크린샷 | Cairn은 합성 UI 영상 유지 가능 | 실제 시세가 포함된 캡처/동영상의 공개·보관·마케팅 권한 |
| 분석·가공 결과 | 약관은 원데이터와 가공 결과 용도를 구분 | 위험·기여도·시뮬레이션·반사실 비교, 비표시 계산, 복원 가능한 차트의 권한 |
| 저장·캐시 | 계약상 기간·조건 존재 | 공유 캐시 TTL, 장기 가격/기업행위 저장, 사용자 스냅샷, 백업 및 계약 종료 후 보존 |
| 내보내기·이메일 | 현재 구현 범위 밖 | CSV/PDF/이메일/공유 링크를 추가할 때 필요한 배포 권한 |
| 비용·출처 | 사업용 요금과 추가 거래소 조건 존재 | 월·연 총액, 크레딧 초과, 거래소/전문가 비용, 필수 attribution과 사용자 수 기준 |

**한투:** [제휴 안내](https://apiportal.koreainvestment.com/provider)는 제휴 대상과 시세 정보이용계약 조건을 설명한다. Cairn의 현재 회원·비회원 표시와 공유 수집 형태에 어떤 절차가 필요한지는 별도 확인 대상이다. 이번 확인으로 기존 운영 사용이 위법이라고 단정하거나 공급을 중단하지 않는다. 국내 시세의 동등한 대체가 확인되지 않은 Twelve Data로 자동 교체하지 않는다.

**Massive:** [사업용 안내](https://www.massive.com/business)는 거래소별 확장과 추가 거래소 비용/승인 절차를 안내한다. 미국 시장 비교 후보로만 유지한다. Cairn 용도별 견적·권한은 미확인이고 어댑터는 구현하지 않았다. 공급자의 평가성 가격을 거래소 최종 체결가로 취급하지 않는다.

한국 시장의 일부 종가 커버리지가 있다는 것만으로 한국 장중 시세를 대체하지 않는다. 실제 지원 상장과 제공 종류는 [거래소 목록](https://twelvedata.com/exchanges)과 계약에서 개별 확인한다. 금융규제/투자자문 해당 여부 검토는 데이터 사용권 확인과 별도이며 면책문구로 대체하지 않는다.

## 공급자 문의 초안 — 미발송

제목: Cairn Labs 미국 주식·ETF 및 USD/KRW 데이터 사용 범위 확인

Cairn Labs는 사용자가 등록한 포트폴리오의 평가·변동 기여·구조·가상 비교·확률 시뮬레이션을 제공하는 웹 서비스입니다. 실제 주문은 실행하지 않습니다. 한국과 해외의 비회원 체험 및 회원 화면을 제공합니다. 합성 포트폴리오와 개인 보유정보는 분리합니다.

미국 상장 주식/ETF 및 USD/KRW에 대해 다음 범위를 지원하는 사업용 계약과 견적을 요청드립니다.

1. 정확한 거래소/MIC·종목 목록, 실시간·지연·종가, 수정가격/배당/분할 제공 범위와 검증용 응답.
2. 해외 거주자를 포함한 비회원 Demo, 회원 화면, 공개 영상/스크린샷, 전문 사용자 분류와 보고 의무.
3. 기여도·위험·반사실 비교·시뮬레이션 결과의 비표시 계산 및 표시, 데이터 복원 가능성 기준.
4. 공유 캐시·가격 이력·사용자 스냅샷·백업의 허용 보존기간, 계약 종료 후 보존/삭제.
5. 향후 CSV/PDF·이메일·공유 링크 제공에 필요한 추가 권한.
6. API/배치/재시도의 크레딧, 거래소·사용자 추가 비용, attribution, 총월액·연액.

월간 사용자와 고유 종목/요청량은 실제 집계를 확인한 뒤 제시하겠습니다. 아직 확정되지 않은 수치를 보장하지 않습니다. 키가 아니라 위 용도별 권한과 제한에 대한 서면 답변이 필요합니다.

## 큐·예산·실행 운영

현재 `collection-worker.ts`는 KIS 설정과 lease/budget을 직접 사용한다. `vercel.json`에는 `0 22 * * *` 실행이 있다. 이것은 매일 07:00 KST의 **실행 설정**이지 그 시각의 모든 시장 종가 확정 보장이 아니다. 실제 Vercel 계정 요금제는 이번 작업에서 조회하지 않았다.

[Vercel 공식 제한](https://vercel.com/docs/cron-jobs/usage-and-pricing)에 따르면 Hobby의 Cron은 일일 실행과 시간 단위 정확도 제한이 있다. 현재 요금제가 Hobby라면 무인 분 단위 갱신을 약속할 수 없다. Pro/Enterprise의 분 단위 스케줄도 실행 비용·timeout·중복 실행·lease 회복 검증을 대신하지 않는다. 운영 Cron은 수정하지 않았다.

현재 구현:

1. 기존 `market_collection_jobs`와 claim token/180초 lease/최대 6회 시도/FIFO 보정/40초·5개 작업 한도를 재사용한다. 별도 큐를 만들지 않았다. 기존 KIS worker는 기본 `kis:` 작업만 가져온다.
2. Twelve 작업은 서버에서 검토한 상장, 허용 dataset, audience, license scope를 검증한 뒤 넣는다. 큐 키는 공급자·권한 범위의 hash와 dataset, MIC/거래소/원래 상장 키/종류/일자 창의 hash를 포함한다. 개인 계좌·수량·이메일·API 키는 큐에 들어가지 않는다. 종목 기준이 다른 작업이나 사용권 범위가 다른 작업을 합치지 않는다. 일별 이력은 기존 90일 구간으로 나누고 완성되지 않은 날짜는 등록 전에 거부한다.
3. `twelve-data-budget.ts`가 같은 credential 전체의 HTTP/credit 두 예산을 DB transaction/advisory lock으로 예약한다. HTTP 1회와 credits N개는 각각 저장하며 두 상한 중 하나만 초과해도 요청을 보내지 않는다. Twelve credit 창은 UTC 분 경계에서 갱신한다. 기존 KIS 예산과 통계를 섞지 않는다.
4. 0049는 기존 예산 표에 provider/window credits/누적 credits를 추가하고 `market_provider_reservations`를 만든다. 예약 ID는 서버 발급 시각과 claim token/slot의 hash로 구성한다. 같은 ID는 첫 예약 이후 요청을 다시 승인하지 않는다. 새 worker가 lease를 회복하면 새 ID로 다시 예약한다. 예약 직후 프로세스가 종료돼 HTTP가 나가지 않았더라도 사용량을 돌려준 것으로 추정하지 않는다.
5. 예약 ID는 DB 시각 기준 180초가 지나면 거부된다. 이 때문에 만료 후에도 replay가 거부되며, 하루가 지난 영수증은 범위별 최대 500개씩 정리할 수 있다. 예약 표는 RLS를 활성화·강제하고 tenant 권한을 주지 않는다. 마이그레이션은 작성/로컬 검증만 했으며 운영 적용 여부와 구분한다.
6. 예산 대기는 종목 실패 횟수를 소비하지 않는다. 실제 전송 실패는 큐의 시도 횟수를 소비하고 공유 cooldown과 최대 한 시간 backoff를 적용한다. 429/인증 실패/전송 실패 뒤 같은 drain에서 다른 종목을 연속 조회하지 않는다. 재시도마다 새 예약이 필요하다.

현재 service 연결과 남은 운영 조건:

- `getTwelveDataServerConfig`는 서버의 명시적 enabled flag, 비밀키, 확인된 사용권/출시 설정을 모두 검사한다. 이번 작업은 그 값을 읽거나 변경하지 않았다. 설정이 없거나 승인되지 않았으면 큐 조회·등록도 하지 않는다.
- `twelve-data-store.ts`는 쓰기 transaction에서 claim row를 잠그고 매 DML 및 transaction 끝에 lease/token을 재확인한다. 만료되면 부분 쓰기를 rollback한다. 원본 `fetched_at`은 지키고 재확인 시각만 따로 갱신한다. 사용권 scope와 보존기한은 읽을 때도 적용한다.
- `requestTwelveDataEvidence`는 cache를 먼저 읽고 필요한 작업을 기존 큐에 넣은 뒤 `after`로 실행한다. `resumeConfiguredTwelveDataService`는 기존 인증된 worker trigger가 KIS 상태와 독립적으로 중단/대기 작업을 재개할 수 있는 진입점이다. 새 cron 주기나 환경 활성화는 추가하지 않는다.
- 과거 FX는 한 번에 최대 1,000개 요청 시각을 검사하고 중복 제거 후 누락된 최대 40개만 enqueue한다. 초 단위 요청 시각이 공유 큐 key에 들어가므로 프로세스 종료 후 같은 작업을 복원할 수 있다. 한 역사 관측은 HTTP 1회와 1 credit을 예약한다. 현재 spot cache를 과거 응답으로 대신 쓰지 않으며 `knownAt` 이전에 수집된 증거만 반환한다. 많은 이력은 기존 polling/worker의 후속 실행이 필요하다.
- 현재 평가가 USD 환산을 필요로 하지 않아도 이미 저장된 현재 FX는 읽어서 스냅샷에 함께 보존한다. 없는 FX의 수집은 해당 보고통화에 환산이 필요할 때만 요청한다. 실제 스냅샷에서 복원한 spot은 원래 관측·수집·기록 시각을 유지하며 불필요한 과거 FX 요청을 만들지 않는다.
- `readTwelveDataSplitRisk`는 검토된 상장/사용권 scope/수집 시각/보관기한에 맞는 분할 coverage가 최초 보유 확인일 다음 날부터 가격 관측일까지 연속으로 완전한지 검사한다. 누락·만료·권한 없는 coverage, 구간 공백, 충돌, 소유자 원장과 현지 날짜·정확한 비율이 맞지 않는 분할은 해당 종목 가격 채택을 중단한다. `requestTwelveDataSplitRisk`는 raw 이력과 분할 양쪽 권한이 있을 때만 기존 제한된 이력 작업을 요청하며, 가격 이력 cache만 있다고 미완료 분할 검사를 건너뛰지 않는다. 공급자 자료로 보유 수량을 자동 변경하지 않는다.
- 일별 가격은 뉴욕의 완료된 날짜까지만 수집한다. 당일 기업행사는 기존 history 큐 종류 안의 별도 `us_actions` 작업으로 `/splits`·허용된 `/dividends`만 수집하며 미완성 일봉을 요청하지 않는다. 당일 응답은 `provisional`, 미수집은 `pending`으로 평가를 제한한다. `quoteFreshSeconds`와 큐의 최소 재요청 간격으로 재확인을 제한하고 다음 뉴욕 날짜의 유효 수집 전에는 최종 확인으로 승격하지 않는다. 기존 366일 한도 밖의 미확인 구간도 자동으로 축약하지 않는다. 실제 당일 응답 범위·게시 지연·정정 품질은 실환경 gate로 남는다.
- 실행기 요금제/실제 주기, 허용 보관기간·분석/표시 사용권, 정확한 공급자 사용량과 품질 대조는 운영 전 확인 사항이다. 07:00 이후 관측을 과거에 알고 있던 값으로 넣지 않는다.

공식 [credit 안내](https://support.twelvedata.com/en/articles/5615854-credits)와 [배치 안내](https://support.twelvedata.com/en/articles/5203360-batch-api-requests)에 따라 이번 세 endpoint는 종목/쌍당 1 credit으로 계획한다. 예를 들어 세 종목의 배치 1 HTTP는 3 credits이다. 실패 후 재시도도 새 예약이 필요하다. 어댑터는 batch를 아직 실행하지 않고 중복 대상만 병합한다.

`usage.httpAttempts`, `reservedApiCredits`, `fixtureRequests`를 분리했다. 예약 credit은 예산 상한 계산이며 실제 청구액/최종 공급자 집계라고 부르지 않는다. 실제 연결 후 응답의 `api-credits-used`/`api-credits-left` 및 공급자 usage와 대조한다. 회사 전체 크레딧 한도를 조회 없이 가정하지 않는다.

`getTwelveDataBudgetSummary`는 예약 HTTP/예약 credits/제한/차단 범위를 구분한다. 운영 대시보드에 이를 아직 연결하지 않았다. 향후 cache hit, 큐 대기시간, 가격 관측 나이, 공급자가 보고한 사용량, 실패/미지원 비율을 함께 표시해야 한다.

## 검증과 출시 조건

- `tests/twelve-data.test.mjs`: 기본 비활성, 키만 있을 때 거부, 출시/권한/만료/audience 거부, 예산 거부, listing 오연결, 관측시각/FX 방향, raw/adjusted 분리, DST 날짜, 중복 요청, throttle 중단, 민감 오류 차단, 비용 구분을 합성 응답으로 검사한다.
- `tests/twelve-data-collection.test.mjs`: 인메모리 PGlite에서 실제 0043+0049 SQL과 큐/예산/worker 함수를 실행한다. 기본 비활성의 DB/전송 미호출, KIS 작업 격리, 동시 claim, 동시 서로 다른/동일 예약, HTTP/credit 개별 상한, 분 전환/만료/정리 후 replay 거부, 6회 재시도, 정책대기, cooldown, cache hit, synthetic 저장 거부, tenant 접근 거부를 검증한다. 공급자 응답 경계와 최종 저장 callback은 합성 port로 대체하므로 실제 시세 저장 성공 검증은 아니다.
- `tests/twelve-data-storage.test.mjs`: 실제 0043+0049+0051 SQL, 실제 큐·budget·adapter parsing·fenced writer·admission service를 인메모리 PGlite에서 검사한다. HTTP와 `after`만 fixture로 대체한다. 검토된 상장 해석, 과거 FX의 방향/요청·관측·수집 시각과 사용권/knownAt, 공급자·상장 불일치, 중복 cache, 만료 claim, 중단 재개와 재시도 비용, 분할 scope·과거 지식·충돌 및 SQL의 null 기업행위 거부를 포함한다. 2026-09-20 이 suite 19개 통과, adapter 16개 및 collection 13개도 통과했다. 외부 Postgres나 실제 API 검증을 뜻하지 않는다.
- `tests/native-service-integration.test.mjs`: 인메모리 PGlite에서 실제 0043+0049+0050+0051 SQL과 현재 Drizzle 조회 열을 사용한다. 외부 DB transport와 공급자 HTTP/`after`만 시험 경계로 바꾸고 원장 writer, tenant-role 읽기, dashboard DAL, provider queue/store, 실제 `getTrackedCurrencyEvidence`, 평가/수익률 계산, 스냅샷 writer는 대체하지 않는다. 아래 5개 시나리오가 통과했다.
  1. 실제 초기 현금 USD 1,000과 2주 × USD 100 매수를 저장한다. 완료된 날짜의 관측가격 USD 125가 있어도 action coverage가 없으면 종목 평가를 막고, 실제 이력 수집으로 빈 분할 목록의 완전한 coverage를 저장한 뒤 USD 1,050 / KRW 1,470,000, 취득원가 USD 200 / KRW 260,000을 조회한다. 다른 계좌·소유자를 격리하고 스냅샷을 저장한 뒤 25시간 후 USD 100 입금, 26시간 시점 새 관측가격 USD 130으로 다시 조회한다. 만료된 coverage로는 평가를 막고 재수집 뒤 USD 1,160과 원래 USD 1,050 / KRW 1,470,000 기록, 실제 시각 가중 Modified Dietz `10 / (1050 + 100 / 26)`를 확인하며 원본 스냅샷 불변도 검사한다.
  2. 과거 FX 누락은 KRW 취득원가만 비우고 현재 총액과 USD 원가는 유지한다. 현재 FX 누락/4일 경과는 KRW 총액을 막고 USD 총액은 유지한다. 같은 관측시각의 다른 가격을 실제 worker로 수집하면 충돌 상태로 격리하며 종목 평가를 중단하고 계좌 현금·다른 계좌 계산은 유지한다.
  3. 실제 이력 수집으로 저장한 2:1 분할이 원장에 없으면 기존 2주 평가를 막는다. 소유자가 같은 날짜·비율의 분할을 기록한 뒤 4주 × USD 62.5와 현금을 합한 USD 1,050을 확인하여 자동 변경/이중 반영이 없음을 검증한다. 저장된 coverage 충돌도 종목 평가를 막는다.
  4. 실제 전량 매도 후에도 처분 lot와 매도대금이 남는다. 취득 USD 200 × 1,300, 매도 USD 220 × 1,400의 기록 손익은 USD 20 / KRW 48,000이며 수수료는 별도 비용이다.
  5. 원가를 모르는 상태에서 한 매도는 이후 원가 보완으로 재작성하지 않는다. 누락 FX, 다른 owner, 중복/미래 매도, 현재 spot으로 과거 원가를 대체하려는 입력은 관련 손익을 제한한다.
- 일반 `node --test`는 이 Windows sandbox에서 child process EPERM이 발생했다. 같은 격리 fixture 검사는 `node --test --test-isolation=none tests/twelve-data.test.mjs`로 실행한다. 테스트는 DB·환경 비밀값·공급자 HTTP를 사용하지 않는다.
- 미검증: 실제 키/사업용 권한, 개별 상장·과거 FX 커버리지, 실제 응답 품질/지연, 실제 배당·분할 이력, 서로 다른 실Postgres 프로세스의 contention/장애 회복, 운영 Cron, 출시 후 데이터 freshness.
- 공개 전: 사용권/출시 승인, reviewed listing과 지연·보관 정책, 실제 운영 실행기 확인, 비용·품질 비교, 별도 승인된 마이그레이션/설정/배포가 필요하다. 로컬 코드·fixture 통과로 외부 연결이나 공개를 승인하지 않는다.

## RC 기업행사 처리와 검증 범위

2026-09-20 코드 재확인에서 원장 분할 대조의 비율 방향을 수정했다. 공식 [분할 응답 예시](https://twelvedata.com/docs#splits)의 4-for-1은 `from_factor=4`, `to_factor=1`이다. 원장 수량 배수는 `from/to`, 연구용 과거 가격 조정 배수는 `to/from`으로 구분한다. 공급자 `ratio`의 이름을 근거로 방향을 추정하지 않는다.

| 상황 | 연결된 처리 |
| --- | --- |
| 2:1 분할 / 병합 | 소유자가 기록한 정확한 수량 배수와 공급자 날짜·인자를 양방향 대조한다. 원장의 원가 총액은 유지한다. 실제 평가에는 조정하지 않은 가격만 사용한다. |
| 가격 먼저 도착 | 당일 action 응답이 없으면 pending, 있어도 잠정 응답이면 provisional. 전체 평가와 스냅샷 확정을 막으며 현금 등 확인된 부분합은 별도로 유지한다. |
| 원장 분할 먼저 도착 | 분할 이전의 quote는 `corporate_action_price_pending`. 나중 가격·확정 coverage·원장 비율이 모두 맞아야 평가한다. |
| 당일 응답 뒤 사건 지연 도착 | action-only 응답마다 원래 수집 시각을 갖는 불변 coverage 버전을 저장한다. 조회 시점에 알려진 가장 최근 버전을 선택하고 다음 날짜 재확인으로 잠정을 해제한다. 과거 `asOf` 조회나 이미 저장된 스냅샷을 수정하지 않는다. |
| 중복 | 숫자 표기 차이와 동일 사건 중복을 정규화한다. 같은 날짜의 서로 다른 인자는 거부한다. provider event는 수량·현금을 자동 기록하지 않으며 owner operation retry도 동일 기록을 반환한다. |
| 현금 배당 | 공급자 ex-date·주당 금액은 시장 근거다. 지급일·세후 실제 입금액을 추정하지 않는다. 소유자의 실제 cash dividend 기록만 현금과 성과에 한 번 반영한다. 연구의 split-only 가격에는 배당 재투자를 포함하지 않는다. total-return 계열을 실제 원장 가격으로 허용하지 않는다. |
| symbol change / merger / spinoff | 이번 원장과 어댑터의 자동 처리 범위가 아니다. 미검토 새 상장 tuple은 거부하며, ticker만으로 전후 수량·원가·성과를 연결하지 않는다. 동일 티커로 일어나는 미지원 사건까지 이 endpoint들이 검출한다고 주장하지 않는다. 실제 지원 확장은 별도 명세·근거가 필요하다. |

SQL의 coverage `complete`는 해당 endpoint 응답을 온전히 수집했다는 기록이다. 읽기 경로는 뉴욕 수집 날짜를 추가 검사하여 당일/당일에 수집한 응답을 `provisional`로 판정한다. `pending`/`provisional`/충돌/원장 불일치/가격 대기를 UI 사유로 전달한다. 미완성 스냅샷은 저장하지 않고 다음 유효 평가에서 처음 완전한 기록을 저장한다. 같은 관측시각의 상충 가격, 동일 수집시각의 상충 기업행사, 완료된 기존 이력의 상충 응답은 자동 덮어쓰기 대상으로 삼지 않는다.

검증: `native-service-integration.test.mjs`의 추가 3개 사례는 실제 원장 writer·SQL queue/store·DAL·평가·snapshot을 사용해 2:1·1:2, 가격 선도착, 당일 빈 응답 이후 지연 도착, 과거 지식 보존, 동일 응답 중복, owner retry, 원장 선도착, 배당의 1회 성과 반영을 확인한다. `/time_series`가 당일 action 작업에서 호출되지 않는 것도 확인한다. `twelve-data.test.mjs`는 동일 날짜의 충돌·명시적 partial 응답·누락 배열·미래 날짜를 거부한다. 외부 HTTP는 모든 사례에서 합성 응답이다.

## 승인된 테스트 환경에서 실행할 최소 provider 검증 패킷

**상태: NOT RUN.** 이 작업에서 실 API 호출·자격증명 조회·공급자 설정 활성화는 하지 않았다. 승인된 테스트 자격증명, dataset별 사용권, 보관 정책이 확인되기 전에는 아래 실행을 시작하지 않는다. fixture 성공과 공식 문서 조회는 계정의 실제 권한·coverage 확인을 대신하지 않는다.

필요한 서버 환경 이름은 `TWELVE_DATA_API_KEY`, `CAIRN_TWELVE_DATA_ENABLED`, `CAIRN_TWELVE_DATA_SERVER_CONFIG`이다. 공개 `NEXT_PUBLIC_*` 변수를 만들지 않는다. 기본 enabled는 계속 false/미설정이다. 승인 후 별도 테스트 프로세스에만 적용할 JSON은 다음 항목을 포함해야 한다.

- `provider.audience`: `internal_validation`; `license.audiences`에도 이 범위만 둔다.
- `provider.listings`: 검토된 `instrumentKey`, `ticker`, `symbol`, `micCode`, `exchange`, `type`, `currency=USD`, `exchangeTimezone=America/New_York`.
- `provider.license`: `status`, 비밀값 없는 승인 `reference`, 테스트 전용 `cacheScope`, `expiresAt`, dataset 목록(`us_quote`, `us_daily_raw`, `usd_krw`, `usd_krw_history`, `us_splits`, `us_dividends`), `quoteDelay`.
- `provider.release`: 테스트 범위만을 승인한 `approved`·`reference`. 이 값은 Production 배포 승인이나 member/public 표시 사용권을 뜻하지 않는다.
- `budget`: 실제 승인 한도 이하의 `httpRequestsPerMinute`, `apiCreditsPerMinute`, `minimumIntervalMs`; `storage`: 계약에 맞는 `retentionSeconds`, `quoteFreshSeconds`, `fxFreshSeconds`, `historyFreshSeconds`.

후보는 **AAPL / XNAS / NASDAQ / Common Stock**, **VOO / ARCX / NYSE / ETF**, **USD/KRW**로 제한한다. 이 tuple은 검토 후보이며 실응답과 계약으로 확정하기 전에는 자동 등록하지 않는다. 예를 들어 VOO 응답의 exchange가 후보와 다르면 실패로 남기고 검토를 거친다. 계좌·보유수량·사용자 금액을 보내지 않는다.

| 순서 | 제한된 요청 | 필수 확인 필드·기대 결과 |
| --- | --- | --- |
| 1 | 두 후보 각 `/quote` 1회 | symbol/MIC/exchange/currency 일치, 양수 close, `last_quote_at <= fetchedAt`, timestamp와 최신 quote 시각의 구분, 계약상 지연 상태. |
| 2 | 두 후보 각 `/time_series` 1회, 완료된 거래일 5일 이하 | interval=1day, exchange_timezone, type, 거래일 datetime, raw close. `adjust=none`, `prepost=false`; 순서·중복·범위·휴장일을 확인하고 휴장일을 생성하지 않는다. |
| 3 | USD/KRW spot 1회, 명시적 과거 시각 1회 | symbol, rate, timestamp; 과거 요청은 UTC이며 `observedAt <= requestedAt <= fetchedAt`. 방향·정밀도·다른 시각의 사용권 확인. |
| 4 | AAPL `/splits` 1회, `/dividends` 1회 | 각 10일 이하의 명시적 기간. 분할은 공식 예시의 2020-08-31을 포함한 좁은 창으로 방향 검증; 배당은 승인된 표본 기간. metadata, 배열 존재, date / ex_date, from_factor / to_factor, 수정 전 amount. 빈 배열도 성공 여부와 범위를 별도 기록한다. |
| 5 (별도 실행 승인) | AAPL 당일 split+dividend 각 1회, 다음 날짜 같은 창 각 1회 | 당일 응답 가능 여부·지연·정정, 최초/후속 수집 시각, provisional→확정. 거래 중 임의의 빈 응답을 당일 사건 없음으로 확정하지 않는다. |

1–4는 **8 HTTP / 46 예약 credits**(quote 2 + history 2 + FX 2 + split 20 + dividend 20)로 계획한다. 5까지 모두 하면 **12 HTTP / 126 예약 credits**다. 배치/반복 수집은 사용하지 않으며 재시도마다 새 비용 예약이 필요하다. 실제 비용은 [endpoint 문서](https://twelvedata.com/docs)와 [credit 계산 안내](https://support.twelvedata.com/en/articles/5615854-credits)를 실행 당일 계약에 대조한다. `api-credits-used`, `api-credits-left`와 provider 사용량을 비교할 별도 승인된 검증 캡처가 필요하다. 현재 transport는 해당 헤더를 저장하지 않으므로 예약량만으로 실청구 검증을 PASS로 처리하지 않는다.

저장할 검증 결과는 요청 ID, endpoint, 비밀값 없는 symbol tuple과 기간, HTTP 상태, 수집 시각, 요청/관측 시각, timezone, raw/adjusted 의미, 응답 필드의 존재/형식, canonical payload hash, 예약/보고 credits, PASS/FAIL 및 이유다. 키가 있는 URL·Authorization·공급자 원문 오류·PII는 기록하지 않는다.

PASS는 승인 범위·모든 identity·날짜·정밀도·근거·보고 credits가 일치할 때만 부여한다. 누락 필드, partial, 잘못된 상장/FX 방향, 미래 시각, 불명확한 adjustment, 잘린 범위, 계획과 다른 소비량은 FAIL 또는 미검증으로 남기고 확장 수집을 중단한다. 429/auth/error·동일 사건 충돌은 fixture로 먼저 검증하며 실 quota 고갈이나 잘못된 키 반복 호출로 재현하지 않는다. 실제 테스트가 통과해도 Production public/member 경로 활성화, migration, secrets 변경, 계약 구매, 배포에는 각각 별도 승인이 필요하다.

## 순차 적용과 되돌리기 경계

0049는 기존 KIS 예산 표에 `provider='kis'`, credit 0 기본값 열을 더하고 별도 예약 표를 만든다. KIS의 기존 열 지정 insert는 그 기본값을 사용한다. 0051은 세 개의 새 공급자 증거 표와 색인·제약·강제 RLS를 만들며 기존 KIS 시세/FX 표를 고치거나 가격을 이전하지 않는다. 이 사실은 migration SQL과 격리 PGlite의 적용 결과를 확인한 범위이며 운영 DB 적용·운영 lock 시간·다운그레이드 검증은 아니다. 이미 적용한 migration 파일을 나중에 수정해 운영 DB가 바뀐다고 간주하지 않는다.

출시 시에는 기록된 migration 순서와 기존 DB 상태를 먼저 확인하고 Twelve를 비활성 상태로 유지한 채 schema 및 공급자별 큐 분리가 포함된 코드를 적용한다. 기존/구버전 인스턴스의 요청과 worker가 모두 끝난 것을 확인하기 전에는 Twelve 큐를 활성화하지 않는다. 새 코드의 기본 KIS claim·ready·maintenance는 `kis:` prefix에만 적용되고 별도 Twelve resumer의 비활성/오류는 기존 KIS 작업을 중단하지 않는다. 실제 KIS after-worker 경로를 유지한 기존 live-price route 시험 22개도 통과했다.

**코드 되돌리기의 하한선:** phase 2 이전 `collection-queue.ts`는 claim SQL에 공급자 prefix 조건이 없다. `twelve_data:` 대기/실행 작업이 남은 채 그 버전으로 되돌리면 구버전 KIS worker가 Twelve 작업을 KIS 작업으로 집어갈 수 있다. 장애 시 우선 Twelve 활성화를 끄고 공급자별 큐 분리가 있는 코드와 추가 schema를 유지한다. 더 오래된 버전으로 되돌려야 한다면 별도로 승인된 절차에서 모든 새/기존 worker를 멈추고 Twelve 작업·claim 상태를 점검·격리해야 한다. schema 삭제나 공유 큐 전체 삭제를 일반 rollback으로 사용하지 않는다. 이번 작업에서는 설정 변경, worker 중지, 운영 큐 변경, migration 적용, 배포/rollback을 수행하지 않았다.
