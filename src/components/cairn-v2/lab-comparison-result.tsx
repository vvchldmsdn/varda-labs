'use client';
import { useState } from 'react';
import { Field, Input } from '@/components/cairn-ui';
import { InvestmentLabComparisonChart } from '@/components/investment-lab/investment-lab-comparison-chart';
import { labCompactKrw } from '@/components/investment-lab/investment-lab-chart-presentation';
import { useMeasuredPlot } from '@/components/use-measured-plot';
import { useI18n } from '@/components/i18n/locale-provider';
import type { LabModel } from '@/lib/cairn-v2/lab-contract';
import { labChartPalette } from './lab-presentation';
import styles from './lab.module.css';

export function LabComparisonResult({rows}: {rows: LabModel['comparison']['rows']}) {
  const [size, ref] = useMeasuredPlot();
  const [at, setAt] = useState(rows.length - 1);
  const {locale,t} = useI18n();
  const index = Math.min(at, rows.length - 1);
  const row = rows[index];
  if (!row) return null;
  const width = Math.max(120, size.width || 320);
  const height = Math.round(Math.max(145, Math.min(300, width * .45)));
  const money = (value: number, signed = false) => value.toLocaleString(locale, {
    maximumFractionDigits:0, signDisplay:signed?'exceptZero':'auto',
  }) + t('원',' KRW');
  const selected = row.serviceDate.replaceAll('-','.');
  const actual = money(row.actualMarketValueKrw);
  const benchmark = money(row.scenarioMarketValueKrw);
  const difference = money(row.differenceKrw,true);
  return <section className={styles.comparison} aria-label={t('KRW 과거 비교 차트','Historical comparison in KRW')}>
    <header><time dateTime={row.serviceDate}>{selected}</time><span>{index === rows.length-1 ? t('기말 평가','Closing values') : t('선택일 평가','Selected date')}</span></header>
    <dl className={styles.summary}>
      <div data-series="actual"><dt>{t('실제 평가','Portfolio')}</dt><dd>{actual}</dd></div>
      <div data-series="scenario"><dt>{t('KODEX 200 가상 평가','KODEX 200 scenario')}</dt><dd>{benchmark}</dd></div>
      <div><dt>{t('가상 − 실제','Scenario − portfolio')}</dt><dd>{difference}</dd></div>
    </dl>
    <div className={styles.chart}><div ref={ref}>
      <InvestmentLabComparisonChart chartId="beta-lab" rows={rows} title={t('실제 평가와 KODEX 200 과거 비교','Portfolio and KODEX 200 comparison')}
        description={t('동일 거래금액 기반 KRW 경로.','Values in KRW for the same trade amounts.')} scenarioLabel="KODEX 200" palette={labChartPalette}
        inspect={{width,height,selected:index,select:setAt,axis:value=>labCompactKrw(value,locale)}}/>
      <Field className={styles.chartControl}><span>{t('관측일 순서','Observation order')}</span>
        <Input type="range" min={0} max={rows.length-1} value={index} disabled={rows.length<2}
          onChange={event=>setAt(Number(event.target.value))} aria-label={t('비교 날짜','Comparison date')}
          aria-valuetext={[selected, t('실제','Portfolio')+' '+actual,'KODEX 200 '+benchmark,t('차액','Difference')+' '+difference].join(' · ')}/>
      </Field>
    </div></div>
  </section>;
}
