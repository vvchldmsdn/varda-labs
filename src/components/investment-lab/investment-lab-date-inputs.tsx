'use client';

import { DraftPreservationNotice } from '@/components/recovery/draft-preservation-notice';
import { Field, Input, Form, Status } from '@/components/cairn-ui';
import { useId, useState, type ComponentProps } from 'react';
import { useI18n } from '@/components/i18n/locale-provider';
import { useNavigationDraft } from '@/components/recovery/use-navigation-draft';
import { readLabPeriodDraft, type LabPeriodDraft } from '@/lib/lab-period-draft';
import type { Currency } from '@/lib/money';
import { LabText } from './lab-text';

export function InvestmentLabPeriodForm({ children, ...props }: ComponentProps<'form'>) {
  const [error, setError] = useState('');
  const id = useId();
  const { t } = useI18n();
  return <Form {...props} noValidate onChange={() => setError('')} onSubmit={event => {
    const form = event.currentTarget;
    const fields = (['start', 'end'] as const).map(name => ({ name, input: form.elements.namedItem(name) as HTMLInputElement | null }));
    for (const { name, input } of fields) {
      const value = input?.value ?? '';
      const label = name === 'start' ? t('시작 관측일', 'Start date') : t('종료 관측일', 'End date');
      let message = '';
      if (!value) message = t(`${label}을 선택해 주세요.`, `Choose the ${label.toLowerCase()}.`);
      else {
        const date = new Date(`${value}T00:00:00.000Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
          message = t(`${label}의 날짜 형식을 확인해 주세요.`, `Check the ${label.toLowerCase()} format.`);
        } else if (input?.min && value < input.min) message = t(`${label}은 ${input.min} 이후 날짜를 선택해 주세요.`, `Choose a ${label.toLowerCase()} on or after ${input.min}.`);
        else if (input?.max && value > input.max) message = t(`${label}은 ${input.max} 이전 날짜를 선택해 주세요.`, `Choose a ${label.toLowerCase()} on or before ${input.max}.`);
      }
      if (message) { event.preventDefault(); setError(message); input?.focus(); return; }
    }
    const start = fields[0].input!, end = fields[1].input!;
    if (start.value >= end.value) {
      event.preventDefault();
      setError(t('종료 관측일은 시작 관측일보다 뒤여야 합니다.', 'The end date must be later than the start date.'));
      end.focus();
    }
  }} aria-describedby={error ? id : undefined}>
    {children}
    {error && <Status as="p" id={id} tone="danger" role="alert">{error}</Status>}
  </Form>;
}

export function InvestmentLabDateInputs({ scope, currency, start, end, baseStart, baseEnd, min, max }: {
  scope: string; currency: Currency; start: string | null; end: string | null;
  baseStart: string; baseEnd: string; min: string | null; max: string | null;
}) {
  const initial: LabPeriodDraft = { version: 1, scope, currency, start: start ?? '', end: end ?? '', baseStart, baseEnd };
  const [draft, update, draftNotPreserved] = useNavigationDraft({ initial, path: '/investment-lab', scope,
    read: query => readLabPeriodDraft(query.getAll('_labDraft'), initial),
    write: value => ({ _labDraft: JSON.stringify(value) }),
  });
  return <><DraftPreservationNotice visible={draftNotPreserved} />{(['start', 'end'] as const).map(name => <Field key={name} className="min-w-0 flex-1 basis-48">
    <LabText value={name === 'start' ? '시작 관측일' : '종료 관측일'} />
    <Input style={{ minHeight: 48 }} name={name} type="date" required min={min ?? undefined} max={max ?? undefined}
      value={draft[name]} onChange={event => update({ ...draft, [name]: event.target.value })} />
  </Field>)}</>;
}
