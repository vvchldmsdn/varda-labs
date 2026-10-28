/** Presentation only. Raw values remain the source for color, selection and calculations. */
export function preciseNumber(value:number|null|undefined,digits=2){if(value==null||!Number.isFinite(value))return '—';const text=value.toLocaleString('ko-KR',{minimumFractionDigits:digits,maximumFractionDigits:digits});return value!==0&&Number(text.replaceAll(',',''))===0?'≈'+(0).toFixed(digits):value===0?(0).toFixed(digits):text;}
export const formatMoneyInput=(value:string)=>/^\d+$/.test(value)?value.replace(/\B(?=(\d{3})+(?!\d))/g,','):value;
/** Normalize only valid grouping. Invalid, fractional and signed input reaches the existing validator unchanged. */
export const parseMoneyInput=(value:string)=>/^\d{1,3}(?:,\d{3})+$/.test(value)?value.replaceAll(',',''):value;

export function normalizeMoneyEdit(value:string,inputType:string,data:string|null,previous:string){const nativeEdit=/^\d*$/.test(previous)&&(inputType.startsWith('delete')||inputType==='insertText'&&data!==null&&/^\d+$/.test(data));return nativeEdit?value.replaceAll(',',''):parseMoneyInput(value);}
