import test from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";
import {
  buildContributionOrderBasis, buildContributionOrderOptions, defaultContributionOrderSettings, defaultContributionOrderRule,
  projectContributionOrderPlan, validContributionOrderRule, validContributionWalletAmount, withFractionalOrders,
} from "../src/lib/cairn-v2/contribution-order-plan.ts";
import { decodeFractionalPreferences, encodeFractionalPreferences } from "../src/lib/cairn-v2/contribution-order-preferences.ts";

const allocation = (ticker, allocationKrw, extra = {}) => ({
  allocationKey: ticker, ticker, name: ticker, accountCode: "account", accountName:"Synthetic account", market: "korea", assetType: "etf",
  currency: "KRW", allocationKrw, baseNeedKrw: allocationKrw * 2, trimAmountKrw: 0, ...extra,
});
const holding = (row, currentPrice, quantity = 1) => ({...row, account:row.accountCode, currentPrice, quantity});
function scenario(rows, holdingRows, options = {}) {
  return buildContributionOrderBasis({cashAmountKrw:1_000_000,totalAllocatedKrw:rows.reduce((sum,row) => sum + row.allocationKrw,0), rows, ...options},
    {structure:{holdingRows,usdKrwRate:1500}});
}

test("defaults to whole units, then sizes the declared fractional lot as part of the same allocation", () => {
  const a=allocation("AAA",200_000), b=allocation("BBB",300_000), c=allocation("CCC",500_000);
  const basis=scenario([a,b,c],[holding(a,180_000),holding(b,250_000),holding(c,600_000,.22)]);
  const whole=projectContributionOrderPlan(basis,defaultContributionOrderSettings);
  assert.equal(whole.result.orders.every(row => /^\d+$/.test(row.quantity)),true);
  const rule = {CCC:{...defaultContributionOrderRule,kind:"fractional-shares",step:".01",minimum:"0"}};
  const {result} = projectContributionOrderPlan(basis,{...defaultContributionOrderSettings,rules:rule});
  assert.equal(result.status,"exact");
  assert.equal(result.remainingKrw,0);
  assert.deepEqual(result.orders.map(row=>[row.key,row.quantity,row.principalKrw]),[["AAA","1",180_000],["BBB","1",250_000],["CCC","0.95",570_000]]);
  const capped = projectContributionOrderPlan(basis,{...defaultContributionOrderSettings,rules:{CCC:{...rule.CCC,capKrw:"500000"}}});
  assert.ok(capped.result.orders.find(row=>row.key==="CCC").principalKrw <= 500_000);
});

test("preserves upstream buy caps and only relaxes a whole position when the strict set cannot be funded", () => {
  const a=allocation("AAA",200_000), b=allocation("BBB",300_000, {baseNeedKrw:300_000});
  const basis=scenario([a,b],[holding(a,180_000),holding(b,250_000)],{cashAmountKrw:500_000});
  assert.equal(projectContributionOrderPlan(basis,defaultContributionOrderSettings).result.principalKrw,430_000);
  const projected=projectContributionOrderPlan(basis,{...defaultContributionOrderSettings,useCashLimits:true,cashByWallet:{"account:KRW":"195000"}});
  assert.equal(projected.relaxed,true);
  assert.equal(projected.result.principalKrw,180_000);
});

test("caps buys by explicit funding and currencies, excludes unavailable prices and independently rounds sales down", () => {
  const a=allocation("AAA",100_000, {accountCode:"east"}), b=allocation("BBB",105_000,{currency:"USD",market:"us",baseNeedKrw:180_000});
  const sale=allocation("SALE",0,{trimAmountKrw:25_000});
  const missing=allocation("MISSING",80_000);
  const basis=scenario([a,b,sale,missing],[holding(a,50_000),holding(b,10),holding(sale,10_000,1.8)],{cashAmountKrw:210_000});
  assert.equal(basis.budgetKrw,210_000);
  assert.deepEqual(basis.unavailable,["MISSING"]);
  const settings={...defaultContributionOrderSettings,useCashLimits:true,cashByWallet:{"east:KRW":"155000","account:USD":"30"},rules:{AAA:{...defaultContributionOrderRule,fee:"5000"}}};
  const {result,sales}=projectContributionOrderPlan(basis,settings);
  assert.ok(result.orders.every(row=>row.spentMinor <= (row.currency==="USD"?3000:155_000)));
  assert.equal(result.principalKrw,145_000);
  assert.equal(result.feesKrw,5_000);
  assert.equal(result.remainingKrw,60_000);
  assert.deepEqual(sales,[{key:"SALE",quantity:1,principalKrw:10_000}]);
});

test("ignores static fractional balances when determining order support and requires an explicit fractional rule", () => {
  const a=allocation("AAA",200_000);
  const basis=scenario([a],[{...holding(a,150_000,.25),fractionalKrwValue:5000}],{cashAmountKrw:250_000});
  assert.equal(projectContributionOrderPlan(basis,defaultContributionOrderSettings).result.orders[0].quantity,"1");
  const rule = {AAA:{...defaultContributionOrderRule,kind:"fractional-amount",step:"1000"}};
  assert.equal(projectContributionOrderPlan(basis,{...defaultContributionOrderSettings,rules:rule}).status,"invalid");
});

test("uses the verified manual gold identity for whole grams without treating other commodities as shares", () => {
  const gold=allocation(null,180_000,{allocationKey:"gold",name:"금현물", accountCode:"brokerage", assetType:"commodity"});
  const commodity=allocation(null,20_000,{allocationKey:"other", name:"Other commodity",assetType:"commodity"});
  const basis=scenario([gold,commodity],[holding(gold,95_000,8),holding(commodity,10_000,2)],{cashAmountKrw:200_000});
  assert.equal(basis.rows[0].unit,"gram");
  assert.deepEqual(basis.unavailable,["Other commodity"]);
  assert.deepEqual(projectContributionOrderPlan(basis,defaultContributionOrderSettings).result.orders.map(row=>[row.key,row.quantity]),[["gold","2"]]);
});

test("offers account-specific options for held and planned assets before a cash amount or order exists", () => {
  const stock = {accountId:"east", accountCode:"east-code", accountName:"East", assetId:"a", assetName:"VOO",
    ticker:"VOO", assetType:"etf", market:"us", currency:"USD", buyability:"buyable", currentValueKrw:420};
  const options = buildContributionOrderOptions({rows:[
    stock,
    {...stock, accountId:"west", accountCode:"west-code", accountName:"West", currentValueKrw:0},
    {...stock, assetId:"s", buyability:"locked"},
    {...stock, assetId:"g", accountCode:"brokerage", assetName:"금현물", ticker:null, assetType:"commodity", market:"korea", currency:"KRW"},
  ]});
  assert.deepEqual(options.map(row => [row.key, row.walletKey, row.unit, row.canBuy, row.canSell]),[
    ["east:a","east-code:USD","share",true,true], ["west:a","west-code:USD","share",true,false],
    ["east:s","east-code:USD","share",false,true], ["east:g","brokerage:KRW","gram",true,true],
  ]);
});

test("uses the same capability for fractional buys and sells and never spends projected proceeds", () => {
  const sale = allocation("SALE",0,{trimAmountKrw:100_000, currency:"USD", market:"us"});
  const buy = allocation("NEW",80_000);
  const basis = scenario([sale,buy],[holding(sale,200,.8),holding(buy,80_000,0)],{cashAmountKrw:0});
  const fractional = withFractionalOrders(defaultContributionOrderRule, true);
  const whole = withFractionalOrders(fractional, false);
  const project = rule => projectContributionOrderPlan(basis,{...defaultContributionOrderSettings,rules:{SALE:rule}});
  assert.deepEqual(project(whole).sales,[]);
  const expectedSale = [{key:"SALE", quantity:.333333, principalKrw:99_999.9}];
  assert.deepEqual(project(fractional).sales,expectedSale);
  assert.deepEqual(project({...fractional, step:".05"}).sales,expectedSale);
  const amountBuy = {...fractional, kind:"fractional-amount", step:"0.50"};
  assert.equal(withFractionalOrders(amountBuy,true), amountBuy);
  assert.deepEqual(project(amountBuy).sales, expectedSale);
  assert.equal(project(fractional).result.principalKrw,0);
  const limitedByHolding = scenario([sale],[holding(sale,200,.1234569)]);
  assert.deepEqual(projectContributionOrderPlan(limitedByHolding, {...defaultContributionOrderSettings,rules:{SALE:fractional}}).sales,
    [{key:"SALE", quantity:.123456, principalKrw:37_036.8}]);
  assert.equal(whole.kind,"whole");
  assert.equal(validContributionOrderRule(fractional, "KRW", "gram"),false);
  assert.equal(validContributionWalletAmount("10.12","USD"),true);
  assert.equal(validContributionWalletAmount("10.12","KRW"),false);
});

test("matches unheld planned quotes to their own option and allocation even for a shared ticker across accounts", () => {
  const candidate = (accountId, assetId, price) => ({
    accountId, assetId, accountCode:accountId, accountName:accountId, assetName:"New ETF", ticker:"NEW", assetType:"etf",
    market:"us", currency:"USD", buyability:"buyable", currentValueKrw:0, currentPrice:price,
  });
  const model = {structure:{holdingRows:[],usdKrwRate:1500}, rows:[candidate("east","e",10),candidate("west","w",11)]};
  model.plannedMaRows = model.rows;
  const options = buildContributionOrderOptions(model);
  const rows = model.rows.map((row,index) => allocation(row.ticker,40_000,{...row,allocationKey:options[index].key}));
  const basis = buildContributionOrderBasis({cashAmountKrw:80_000,totalAllocatedKrw:80_000,rows},model);
  assert.deepEqual(basis.rows.map(row => [row.key,row.price]),[["east:e",10],["west:w",11]]);
  assert.deepEqual(basis.unavailable,[]);
  const {result} = projectContributionOrderPlan(basis,{...defaultContributionOrderSettings,
    rules:{[options[0].key]:withFractionalOrders(defaultContributionOrderRule,true)}});
  assert.match(result.orders[0].quantity,/\./);
  assert.match(result.orders[1].quantity,/^\d+$/);
});

test("stores only fractional capabilities for eligible share identities and revalidates them when restored", () => {
  const share = {key:"east:a",unit:"share",currency:"USD",canBuy:true,canSell:true};
  const gold = {...share,key:"east:g",unit:"gram"};
  const rule = {...withFractionalOrders(defaultContributionOrderRule,true), fee:"21", capKrw:"750000"};
  const raw = encodeFractionalPreferences({"east:a":rule,"east:g":rule,"unrelated":rule},[share,gold]);
  assert.deepEqual(JSON.parse(raw),{"east:a":{kind:"fractional-shares",step:"0.000001",minimum:"0"}});
  assert.deepEqual(decodeFractionalPreferences(raw,[share]),{"east:a":{...rule,fee:"",capKrw:""}});
  assert.deepEqual(decodeFractionalPreferences(raw,[{...share,key:"west:a"}]),{});
  assert.deepEqual(decodeFractionalPreferences(raw,[{...share,canBuy:false}]),{"east:a":{...rule,fee:"",capKrw:""}});
  assert.deepEqual(decodeFractionalPreferences(raw,[{...share,canBuy:false,canSell:false}]),{});
  assert.deepEqual(decodeFractionalPreferences(raw,[{...share,unit:"gram"}]),{});
  assert.deepEqual(decodeFractionalPreferences(raw.replace("0.000001","0"),[share]),{});
  assert.deepEqual(decodeFractionalPreferences("invalid",[share]),{});
});

test("migrates sell-only, buy-only and dual device preferences into one capability", () => {
  const share = {key:"east:a",unit:"share",currency:"USD",canBuy:true,canSell:true};
  const restore = (entry, option = share) => decodeFractionalPreferences(JSON.stringify({[option.key]:entry}),[option]);
  const defaultFractional = withFractionalOrders(defaultContributionOrderRule,true);
  assert.deepEqual(restore({kind:"whole",fractionalSell:true,step:"",minimum:""}),{[share.key]:defaultFractional});
  assert.deepEqual(restore({kind:"whole",fractionalSell:false}),{});
  const amount = {kind:"fractional-amount",step:"0.01",minimum:"5.00"};
  for (const fractionalSell of [false,true]) {
    assert.deepEqual(restore({...amount,fractionalSell}),{[share.key]:{...defaultContributionOrderRule,...amount}});
  }
  const planned = {...share,canSell:false};
  assert.deepEqual(restore({...amount,fractionalSell:false},planned),{[share.key]:{...defaultContributionOrderRule,...amount}});
  assert.deepEqual(restore({kind:"whole",fractionalSell:true},{...share,currency:null}),{});
  assert.deepEqual(restore({kind:"whole",fractionalSell:true},{...share,unit:"gram"}),{});
});

test("home and detail render the same executable orders from the shared calculation, including persisted fractional lots", async () => {
  const tooExpensive = allocation("WHOLE-EXPENSIVE", 310_000, {baseNeedKrw:310_000});
  const whole = allocation("WHOLE", 315_000, {baseNeedKrw:360_000});
  const fractional = allocation("FRACTION", 125_000, {baseNeedKrw:180_100});
  const missing = allocation("MISSING", 50_000);
  const rows = [tooExpensive, missing, fractional, whole].map(row => ({
    ...row, strategicAllocationKrw:row.allocationKrw, action:"buy", trimReason:"not_overweight",
    currentWeightPct:0, postTopupWeightPct:10, targetWeightPct:25, ruleSteps:[],
  }));
  const basis = scenario(rows, [holding(tooExpensive,400_000), holding(whole,120_000), holding(fractional,200_000)]);
  const result = {
    rows, cashAmountKrw:1_000_000, totalAvailableFundsKrw:1_000_000, totalTrimProceedsKrw:0,
    totalAllocatedKrw:800_000, residualCashKrw:200_000, postTopupTotalKrw:1_000_000,
    calculationParameters:{minimumExecutionRatioPct:80}, minimumExecutionEvidenceAvailable:true, minimumExecutionSatisfied:true,
  };
  const options = rows.map(row => ({key:row.allocationKey, unit:"share", currency:"KRW", canBuy:true, canSell:true}));
  let stored = "";
  const [{ContributionHome}, {ContributionDetail}, {ContributionOrderProvider}] = await importUiWithPorts([
    "src/components/cairn-v2/home-contribution.tsx", "src/components/cairn-v2/planning-details.tsx",
    "src/components/cairn-v2/contribution-order-context.tsx",
  ], {
    // Supply the device storage snapshot while rendering both real consumers under the real provider.
    "@/lib/cairn-v2/contribution-order-preferences":{
      encodeFractionalPreferences,
      decodeFractionalPreferences:(_snapshot, eligible) => decodeFractionalPreferences(stored, eligible),
    },
    "next/navigation":{useRouter:() => ({}), usePathname:() => "/beta", useSearchParams:() => new URLSearchParams()},
    "next/link":{default:({href, children}) => h("a", {href}, children)},
  });
  const context = {scope:"all", mode:"domain", currency:"KRW", fixture:"standard", cashAmountKrw:"1000000"};
  const view = {domain:{state:"ready", planning:{targets:{rows:[]}, contribution:{
    state:"ready", inputKrw:1_000_000, result, orderBasis:basis, orderOptions:options,
  }}}};
  function surfaces() {
    const html = renderToStaticMarkup(h(ContributionOrderProvider, {basis, result, options, scope:"all", binding:"test", currency:"KRW"},
      h("section", {id:"home-surface"}, h(ContributionHome, {view})),
      h("section", {id:"detail-surface"}, h(ContributionDetail, {view, context}))));
    return html.split('<section id="detail-surface">');
  }
  const won = value => value.toLocaleString("ko-KR") + "원";
  const fractionalRule = {...withFractionalOrders(defaultContributionOrderRule, true), step:"0.001"};
  for (const rules of [{}, {FRACTION:fractionalRule}]) {
    stored = encodeFractionalPreferences(rules, options);
    const {result: sized} = projectContributionOrderPlan(basis, {...defaultContributionOrderSettings, rules});
    const [home, detail] = surfaces();
    const bar = markup => markup.match(/role="img" aria-label="([^"]+)"/)?.[1];
    assert.ok(bar(home));
    assert.equal(bar(detail), bar(home));
    for (const [label, amount] of [["예상 매수 원금",sized.principalKrw], ["주문 후 잔액",sized.remainingKrw], ["전략 유보금",200_000]]) {
      for (const markup of [home, detail]) assert.ok(markup.includes("<dt>" + label + "</dt><dd>" + won(amount) + "</dd>"));
    }
    assert.equal(sized.principalKrw + sized.feesKrw + sized.remainingKrw + 200_000, 1_000_000);
    const homeRows = [...home.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map(match => match[1]);
    const detailRows = [...detail.matchAll(/<summary\b[^>]*>([\s\S]*?)<\/summary>/g)]
      .map(match => match[1]).filter(row => row.includes("<small>예상 매수 원금</small>"));
    assert.equal(homeRows.length, 2);
    assert.equal(detailRows.length, rows.length);
    // Compare by account-specific executable order; the largest target does not dictate the order sizes.
    const ranked = sized.orders.toSorted((a,b) => b.principalKrw - a.principalKrw);
    for (const [i, order] of ranked.filter(order => order.principalKrw > 0).slice(0, 2).entries()) {
      const ticker = "<strong>" + order.key + "</strong>";
      assert.ok(homeRows[i].includes(ticker) && detailRows[i].includes(ticker));
      for (const row of [homeRows[i],detailRows[i]]) {
        assert.ok(row.includes(order.quantity + "주"));
        assert.ok(row.includes(won(order.principalKrw)));
      }
      assert.ok(detailRows[i].includes("<small>예상 매수 원금</small>" + won(order.principalKrw)));
    }
    const missingRow = detailRows.find(row => row.includes("<strong>MISSING</strong>"));
    assert.match(missingRow, /단가·환율·단위 확인 필요/);
    assert.doesNotMatch(missingRow, /0주|<small>예상 매수 원금<\/small>0원/);
    const fractionRow = detailRows.find(row => row.includes("<strong>FRACTION</strong>"));
    assert.ok(fractionRow.includes(rules.FRACTION ? "0.9주" : ">0주<"));
    assert.ok(fractionRow.includes("<small>목표 배분</small>125,000원"));
  }
});
