import type { ReturnTimelinePoint } from '../return-timeline';

/** Keep the selected timeline date independent of the availability of a saved row. */
export function selectHistoryPoint<Row extends { date: string }>(
  rows: readonly Row[],
  timeline: readonly ReturnTimelinePoint[],
  requestedDate: string | null | undefined,
) {
  const returnPoint = timeline.find(point => point.date === requestedDate) ?? timeline.at(-1);
  const selectedDate = returnPoint?.date ?? (rows.find(row => row.date === requestedDate) ?? rows.at(-1))?.date;
  return {
    returnPoint,
    selectedDate,
    selected: rows.find(row => row.date === selectedDate),
    latestDate: timeline.at(-1)?.date ?? rows.at(-1)?.date,
  };
}
