import type {SVGProps} from 'react';
type Props=SVGProps<SVGSVGElement>&{size?:number};
const icon=(d:string)=>function Icon({size=16,...props}:Props){return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}><path d={d}/></svg>};
export const Check=icon('m5 12 4 4L19 6'),ChevronDown=icon('m6 9 6 6 6-6'),ArrowRight=icon('M4 12h16m-6-6 6 6-6 6'),ChevronLeft=icon('m15 6-6 6 6 6'),ChevronRight=icon('m9 6 6 6-6 6'),X=icon('m6 6 12 12M18 6 6 18'),AreaChart=icon('M4 4v16h16M5 17l5-8 4 4 5-7'),ChartNoAxesCombined=icon('m3 18 5-9 5 5 8-11M3 10l6 6 6-8 6 9');
