import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  intlLocale,
  localeCookie,
  resolveLocale,
  translate,
  translationEntry,
} from "../src/lib/i18n/locale.ts";
import { translateHomeHistory } from "../src/components/home/home-history-messages.ts";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";

describe("locale display preference", () => {
  it("accepts the two supported locales and defaults invalid persisted values to Korean", () => {
    assert.equal(resolveLocale("ko"), "ko");
    assert.equal(resolveLocale("en"), "en");
    for (const value of [undefined, null, "", "EN", "en-US", "fr", " en", "en; Path=/auth", "en\r\nSet-Cookie: injected=1"]) {
      assert.equal(resolveLocale(value), "ko");
    }
    assert.equal(intlLocale("en"), "en-US");
    assert.equal(intlLocale("ko"), "ko-KR");
  });

  it("persists only a validated site-wide display preference and enables Secure only for HTTPS", () => {
    assert.equal(localeCookie("en", true), "varda-locale=en; Path=/; Max-Age=31536000; SameSite=Lax; Secure");
    assert.equal(localeCookie("ko", false), "varda-locale=ko; Path=/; Max-Age=31536000; SameSite=Lax");
    assert.equal(localeCookie("en; Domain=example.test\r\nother=1", true), "varda-locale=ko; Path=/; Max-Age=31536000; SameSite=Lax; Secure");
  });

  it("prefers explicit translations and preserves user data even when a name matches a product label", () => {
    const input = Object.freeze({ name: "홈", ticker: "KODEX 200", account: "은우의 ISA", amountKrw: 12345678, weightBps: 3750 });
    const before = structuredClone(input);
    assert.equal(translate("ko", "오늘 변동", "Today's movement"), "오늘 변동");
    assert.equal(translate("en", "오늘 변동", "Today's movement"), "Today's movement");
    assert.equal(translate("en", "홈"), "Home");
    assert.equal(translate("en", input.name, input.name), "홈");
    assert.equal(translate("en", input.account), input.account);
    assert.equal(translate("en", input.ticker), input.ticker);
    assert.equal(translate("en", "의도적으로 빈 표시", ""), "");
    assert.deepEqual(input, before);
  });

  it("localizes complete dynamic service messages without changing counts, signs, currency or unknown asset names", () => {
    assert.equal(translateHomeHistory("활동 3건"), "3 activities");
    assert.equal(translateHomeHistory("부분 합산 12건"), "12 partial totals");
    assert.equal(translateHomeHistory("계산 제외 2건"), "2 calculation exclusions");
    assert.equal(translateHomeHistory("+1,250주"), "+1,250 shares");
    assert.equal(translateHomeHistory("4좌"), "4 units");
    assert.equal(translateHomeHistory("누적 손익 -₩12,345"), "Total gain/loss -₩12,345");
    assert.equal(translateHomeHistory("₩26,040,000"), "₩26,040,000");
    assert.equal(translateHomeHistory("KODEX 200"), "KODEX 200");
    assert.equal(translateHomeHistory("은우의 장기 투자 계좌"), "은우의 장기 투자 계좌");
  });

  it("keeps non-service names and numeric labels intact and never reads inherited dictionary properties", () => {
    for (const value of ["constructor", "__proto__", "toString", "hasOwnProperty", "₩26,040,000", "+3.75%", "-₩12,345", "  1,234.50  ", "2026.09.08", "KRW/USD", ""]) {
      assert.equal(translateHomeHistory(value), value);
      assert.equal(translate("en", value), value);
    }
    const messages = Object.freeze(Object.assign(Object.create({ "상속된 문구": "Unexpected translation" }), { "홈": "Home", "빈 문구": "" }));
    assert.equal(translationEntry(messages, "상속된 문구"), undefined);
    assert.equal(translationEntry(messages, "constructor"), undefined);
    assert.equal(translationEntry(messages, "__proto__"), undefined);
    assert.equal(translationEntry(messages, "홈"), "Home");
    assert.equal(translationEntry(messages, "빈 문구"), "");
  });

  it("renders the real provider and text leaf in the selected language without a server locale flash", async () => {
    const [provider, text] = await importUiWithPorts([
      "src/components/i18n/locale-provider.tsx",
      "src/components/i18n/localized-text.tsx",
    ], { "next/navigation": { usePathname: () => "/history" } });

    function Readout() {
      const { locale, t } = provider.useI18n();
      return React.createElement("section", { "data-locale": locale },
        React.createElement("h1", null, React.createElement(text.T, { ko: "저장 수익률", en: "Recorded return" })),
        React.createElement("span", null, t("누적 손익 -₩12,345", "Total gain/loss -₩12,345")),
        React.createElement("span", { "data-user-name": true }, "홈"),
      );
    }
    const render = initialLocale => renderToStaticMarkup(React.createElement(provider.LocaleProvider, { initialLocale }, React.createElement(Readout)));
    const ko = render("ko");
    const en = render("en");
    assert.match(ko, /data-locale="ko"/);
    assert.match(ko, /<h1>저장 수익률<\/h1>/);
    assert.match(en, /data-locale="en"/);
    assert.match(en, /<h1>Recorded return<\/h1>/);
    assert.match(en, /Total gain\/loss -₩12,345/);
    assert.match(en, /data-user-name="true">홈<\/span>/);
    assert.doesNotMatch(en, /저장 수익률/);
  });

  it("localizes native accessible attributes while preserving server children and form values", async () => {
    const [provider, element] = await importUiWithPorts([
      "src/components/i18n/locale-provider.tsx",
      "src/components/i18n/localized-element.tsx",
    ], { "next/navigation": { usePathname: () => "/additional-contribution" } });

    const render = initialLocale => renderToStaticMarkup(React.createElement(provider.LocaleProvider, { initialLocale },
      React.createElement(element.LocalizedElement, { as: "section", "aria-label": "계산 근거", title: "투입 금액", en: { "aria-label": "Calculation sources", title: "Contribution amount" } },
        React.createElement("input", { name: "amount", defaultValue: "12345678" }),
        React.createElement("span", null, "은우의 ISA · KRW"),
      ),
    ));
    const ko = render("ko");
    const en = render("en");
    assert.match(ko, /aria-label="계산 근거"/);
    assert.match(en, /aria-label="Calculation sources"/);
    assert.match(en, /title="Contribution amount"/);
    for (const markup of [ko, en]) {
      assert.match(markup, /name="amount" value="12345678"/);
      assert.match(markup, /은우의 ISA · KRW/);
    }
  });
});
