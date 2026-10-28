// Group only the integer digits of String(number); never format/round its fraction.
export function eventNumber(value:number|null){if(value===null)return '—';const raw=String(value);if(/[eE]/.test(raw))return raw;const [integer,fraction]=raw.split('.');return integer.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(fraction===undefined?'':'.'+fraction);}
export function eventRecordedTime(value:string|null){return value?value.replace('T',' ').replace(/Z$/,' UTC'):'기록 시각 미제공';}
