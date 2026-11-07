import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {importUiWithPorts} from './helpers/import-ui-with-ports.mjs';

const [{HomeValuationHistory}] = await importUiWithPorts(['src/components/home/home-valuation-history.tsx'],{
  '@/components/use-measured-plot': {useMeasuredPlot:()=>[{width:360,height:240},()=>{}]},
  '@/components/i18n/locale-provider': {useI18n:()=>({t:(_ko,en)=>en})},
});
const frame=(day,total,complete=true)=>({at:`2026-09-${day}T00:00:00Z`,total,complete});
const render=(frames,currency='KRW')=>renderToStaticMarkup(createElement(HomeValuationHistory,{frames,currency}));

test('home history leaves unavailable frames as gaps without fabricating zero or returns',()=>{
  const frames=[frame('01','100'),frame('02','105'),frame('03',null,false),frame('04','108'),frame('05','110')];
  const before=structuredClone(frames), html=render(frames);
  assert.equal((html.match(/<path /g)||[]).length,2);
  assert.doesNotMatch(html,/NaN|Infinity|%/);
  assert.deepEqual(frames,before);
});
test('home history reports empty and incomplete records without an invented value',()=>{
  assert.match(render([]),/No dated valuations/);
  const html=render([frame('01',null,false)]);
  assert.match(html,/Complete valuation unavailable/);
  assert.doesNotMatch(html,/<path |<circle |NaN|Infinity/);
});
test('home history formats the admitted reporting currency and keeps a round single-date marker',()=>{
  const html=render([frame('01','1234.56')],'USD');
  assert.match(html,/\$1,234\.56/);
  assert.match(html,/viewBox="0 0 360 240"/);
  assert.match(html,/<circle [^>]*r="4"/);
  assert.match(html,/aria-valuetext="2026-09-01/);
});
test('home history never displays an invalid numeric value as a completed valuation',()=>{
  const html=render([frame('01','NaN')]);
  assert.match(html,/Complete valuation unavailable/);
  assert.doesNotMatch(html,/<path |<circle |NaN/);
});
