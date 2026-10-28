import type {LabModel} from '@/lib/cairn-v2/lab-contract';
type PeriodReason=NonNullable<LabModel['period']['reason']>;
type Blocker=LabModel['comparison']['blockers'][number];
// Display labels only: source statuses, period admission and price policy stay upstream.
const periodReasons:Record<PeriodReason,string>={
 ambiguous_query:'기간이 여러 번 지정되어 비교할 수 없습니다.',
 both_dates_required:'시작일과 종료일을 함께 입력해 주세요.',
 invalid_date:'유효한 날짜를 입력해 주세요.',
 invalid_order:'시작일이 종료일보다 늦습니다.',
 source_unavailable:'이 기간의 관측 자료를 확인할 수 없습니다.',
 start_not_observed:'요청한 시작일의 관측 기록이 없습니다.',
 end_not_observed:'요청한 종료일의 관측 기록이 없습니다.',
 range_evidence_incomplete:'요청 기간 전체를 비교할 근거가 부족합니다.',
};
const blockers:Record<Blocker,string>={
 source_segment_authority_blocked:'선택 기간에 저장 출처가 섞였거나 비교가 허용된 저장 구간이 아닙니다.',
 fount_scope_adjustment_blocked:'제외 계좌의 날짜·저장 식별 근거를 확인해야 합니다.',
 snapshot_evidence_invalid:'평가 스냅샷 형식 또는 중복을 확인해야 합니다.',
 actual_path_reconciliation_mismatch:'저장된 전체 평가액과 계좌별 합계가 일치하지 않습니다.',
 actual_path_incomplete:'비교 가능한 전체 계좌 평가일이 부족합니다.',
 event_account_unresolved:'일부 거래 이벤트의 계좌를 확정할 수 없습니다.',
 event_evidence_unsupported:'거래금액 또는 이벤트 유형을 확인해야 합니다.',
 scenario_close_evidence_invalid:'KODEX 200의 비교 가격 근거를 확인해야 합니다.',
 flow_schedule_blocked:'거래일·가격일·대기 기간 등 체결 일정의 근거를 확인해야 합니다.',
 path_calculation_blocked:'가상 경로 계산의 보존 조건을 충족하지 못했습니다.',
 pending_flows_at_window_end:'마지막 평가일까지 처리되지 않은 거래가 있습니다.',
 account_composition_incomplete:'비교에 필요한 계좌별 자료가 완전하지 않습니다.',
 account_composition_mismatch:'계좌별 구성과 전체 비교의 범위가 일치하지 않습니다.',
};
export const labPeriodReason=(reason:PeriodReason|null)=>reason?periodReasons[reason]:null;
export const labBlockerLabel=(reason:Blocker)=>blockers[reason];
export const labFundingLabel=(status:LabModel['funding']['actual']['status'])=>({ready:'근거 있음',unavailable:'근거 부족',not_requested:'이번 비교 대상 아님'}[status]);
export const labChartPalette={actual:'var(--cairn-v2-ink, #20211f)',scenario:'var(--cairn-v2-brand, #c64623)',axis:'var(--cairn-v2-line, #e1e1dc)',text:'var(--cairn-v2-muted, #6c6d68)',surface:'var(--cairn-v2-paper, #f7f7f5)'};
