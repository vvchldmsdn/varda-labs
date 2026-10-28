import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module, { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript"), React = require("react"), { renderToStaticMarkup } = require("react-dom/server");
const old = { load: Module._load, resolve: Module._resolveFilename, ts: Module._extensions[".ts"], tsx: Module._extensions[".tsx"], css: Module._extensions[".css"], fetch: globalThis.fetch };
let blockedFetches = 0, blockedActions = 0;
const mocks = new Proxy({}, { get(_target, key) { if (key === "__esModule") return true; return async state => { blockedActions++; return state; }; } });
Module._resolveFilename = function(request, parent, ...rest) { return old.resolve.call(this, request.startsWith("@/") ? path.join(root, "src", request.slice(2)) : request, parent, ...rest); };
Module._load = function(request, parent, ...rest) {
  if (/^@\/app\/.*\/actions$/.test(request)) return mocks;
  if (request === "server-only") throw new Error("UI test reached a server-only dependency");
  if (request === "next/navigation") return { useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }), useSearchParams: () => new URLSearchParams("end=2026-10-27&model=economic"), usePathname: () => "/quality-review" };
  if (request === "next/link") return { __esModule: true, default: ({children,href,...props}) => React.createElement("a", {...props, href: typeof href === "string" ? href : href.pathname}, children), useLinkStatus: () => ({pending:false}) };
  return old.load.call(this, request, parent, ...rest);
};
const transpile = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
Module._extensions[".ts"] = transpile;
Module._extensions[".tsx"] = transpile;
Module._extensions[".css"] = module => { module.exports = { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) }; };
globalThis.fetch = async () => { blockedFetches++; throw new Error("UI render must not fetch"); };
const results=[];
try {
  const {LocaleProvider} = require(path.join(root,"src/components/i18n/locale-provider.tsx"));
  const render = (component, props={}, locale="ko") => renderToStaticMarkup(React.createElement(LocaleProvider,{initialLocale:locale},React.createElement(component,props)));
  const check = (name, fn) => { fn(); results.push(name); };
  const { AccountCreateForm, AccountEditor } = require(path.join(root,"src/components/account-management.tsx"));
  check("account create retains named required field and native form",()=>{
    const html=render(AccountCreateForm);
    assert.match(html,/<form[^>]*data-cairn-form/); assert.match(html,/<input(?=[^>]*name="name")(?=[^>]*maxLength="100")(?=[^>]*required="")[^>]*>/);
    assert.match(html,/<button(?=[^>]*type="submit")(?=[^>]*data-cairn-button)[^>]*>/);
  });
  const id="00000000-0000-4000-8000-000000000001";
  check("account editor preserves stale-write identity and archive guard",()=>{
    const html=render(AccountEditor,{account:{id,name:"Synthetic account",code:"synthetic",accountType:"brokerage",currency:"KRW",isActive:true,updatedAt:"2026-10-28T00:00:00Z",activeHoldingCount:1,openGroupReferenceCount:0}});
    assert.match(html,/<input(?=[^>]*name="accountId")(?=[^>]*type="hidden")(?=[^>]*value="00000000-0000-4000-8000-000000000001")[^>]*>/);
    assert.match(html,/<input(?=[^>]*name="archiveConfirmed")(?=[^>]*disabled="")[^>]*>/);
    assert.match(html,/name="expectedUpdatedAt"/);
  });
  const {PortfolioGroupCreateForm}=require(path.join(root,"src/components/portfolio-group-management.tsx"));
  check("group members retain independent checkbox names",()=>{
    const html=render(PortfolioGroupCreateForm,{accounts:[{id,code:"synthetic",name:"Synthetic account"}],assets:[{id:"00000000-0000-4000-8000-000000000002",accountId:id,accountName:"Synthetic account",name:"Synthetic ETF",ticker:"VOO"}]});
    assert.match(html,/<input(?=[^>]*name="accountId")(?=[^>]*type="checkbox")[^>]*>/);assert.match(html,/<input(?=[^>]*name="assetId")(?=[^>]*type="checkbox")[^>]*>/);
  });
  const {NativeTradeFields}=require(path.join(root,"src/components/native-trade-fields.tsx"));
  check("fractional trade retains exact quantity and USD unit price",()=>{
    const html=render(NativeTradeFields,{kind:"buy",unit:"USD",quantity:"6.177563",fields:{inputMode:"execution",quantity:"0.010709",price:"701.263896"},edit:()=>{}});
    assert.match(html,/<input(?=[^>]*name="quantity")(?=[^>]*value="0.010709")(?=[^>]*required="")[^>]*>/);
    assert.match(html,/<input(?=[^>]*name="price")(?=[^>]*value="701.263896")(?=[^>]*required="")[^>]*>/);
    assert.match(html,/USD/); assert.match(html,/총 체결금액/);
  });
  const {AuthPasswordField}=require(path.join(root,"src/components/auth/auth-password-field.tsx"));
  check("localized password input keeps native constraints and controlled visibility button",()=>{
    const html=render(AuthPasswordField,{id:"synthetic-password",newPassword:true},"en");
    assert.match(html,/<input(?=[^>]*id="synthetic-password")(?=[^>]*type="password")(?=[^>]*minLength="12")(?=[^>]*data-cairn-control)[^>]*>/);
    assert.match(html,/<label[^>]*for="synthetic-password"/); assert.match(html,/<button(?=[^>]*type="button")(?=[^>]*data-cairn-button)[^>]*>/);
  });
  const {SimulationDateControl}=require(path.join(root,"src/components/simulation/simulation-query-controls.tsx"));
  check("research cutoff retains query date as native date control",()=>{
    const html=render(SimulationDateControl);
    assert.match(html,/<input(?=[^>]*type="date")(?=[^>]*name="end")(?=[^>]*value="2026-10-27")[^>]*>/);
    assert.match(html,/<button[^>]*type="submit"/);
  });
  assert.equal(blockedActions,0);assert.equal(blockedFetches,0);
  console.log(JSON.stringify({passed:results.length,checks:results,actionsExecuted:blockedActions,fetches:blockedFetches},null,2));
} finally {
  Module._load=old.load;Module._resolveFilename=old.resolve;
  for (const [extension,previous] of [[".ts",old.ts],[".tsx",old.tsx],[".css",old.css]]) { if(previous)Module._extensions[extension]=previous;else delete Module._extensions[extension]; }
  globalThis.fetch=old.fetch;
}
