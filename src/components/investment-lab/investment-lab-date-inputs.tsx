'use client';

import { DraftPreservationNotice } from '@/components/recovery/draft-preservation-notice';
import { Field, Input } from '@/components/cairn-ui';
import { useNavigationDraft } from '@/components/recovery/use-navigation-draft';
import { readLabPeriodDraft, type LabPeriodDraft } from '@/lib/lab-period-draft';
import type { Currency } from '@/lib/money';
import { LabText } from './lab-text';

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
