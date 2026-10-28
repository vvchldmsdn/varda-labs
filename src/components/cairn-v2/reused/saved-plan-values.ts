import {validatePlan,type PlanInput} from '../../../lib/investment-plan';
import {parseMoneyInput,type Currency} from '../../../lib/money';
export type PlanEditorRow={name:string;value:string;target:string};
export function readPlanEditor(currency:Currency,amount:string,rows:PlanEditorRow[],now=new Date().toISOString()):{ok:true;input:PlanInput}|{ok:false;error:string}{
 const cash=parseMoneyInput(amount,currency);if(cash===null)return {ok:false,error:'추가 투자금의 형식과 통화 자릿수를 확인해 주세요.'};
 const mapped=[];for(const row of rows){const value=parseMoneyInput(row.value,currency);if(value===null||!/^\d+(?:\.\d{1,2})?$/.test(row.target))return {ok:false,error:'평가금액과 목표 비중의 형식을 확인해 주세요.'};const [a,b='']=row.target.split('.');mapped.push({name:row.name,value,targetBps:Number(a)*100+Number(b.padEnd(2,'0'))});}
 return validatePlan({currency,amount:cash,rows:mapped,...(currency==='USD'?{version:2,asOf:now}:{})});
}
export const planValue=(value:number)=>String(value);
