import { createHash } from 'node:crypto';
export const MASTER_SOURCES = Object.freeze({
 KOSPI: {file:'kospi_code.mst', tail:227, url:'https://new.real.download.dws.co.kr/common/master/kospi_code.mst.zip'},
 KOSDAQ: {file:'kosdaq_code.mst', tail:221, url:'https://new.real.download.dws.co.kr/common/master/kosdaq_code.mst.zip'},
});
// KIS official stocks_info parser uses 228/222 including the LF terminator.
// Group ST=stock, EF=ETF; no inference from names or six-digit codes.
export function parseKisInstrumentMaster(bytes, exchange) {
 const spec=MASTER_SOURCES[exchange]; if(!spec) throw Error('unsupported exchange');
 const text=new TextDecoder('euc-kr',{fatal:true}).decode(bytes);
 const sourceSha256=createHash('sha256').update(bytes).digest('hex'), rows=[], excluded={};
 for(const line of text.split(/\r?\n/).filter(Boolean)){
  if(line.length<=21+spec.tail) throw Error('truncated master row');
  const tail=line.slice(-spec.tail), securityGroup=tail.slice(0,2);
  if(!/^[A-Z]{2}$/.test(securityGroup)) throw Error('invalid master layout');
  if(!['ST','EF'].includes(securityGroup)){excluded[securityGroup]=(excluded[securityGroup]||0)+1;continue;}
  const ticker=line.slice(0,9).trim(),isin=line.slice(9,21),name=line.slice(21,-spec.tail).trim();
  if(!/^[0-9A-Z]{6}$/.test(ticker)||!/^KR[A-Z0-9]{10}$/.test(isin)||!name||name.length>255||/[\u0000-\u001f\u007f\ufffd]/.test(name)) throw Error('invalid security identity');
  rows.push({isin,ticker,name,market:'korea',exchange,currency:'KRW',assetType:securityGroup==='ST'?'stock':'etf',securityGroup,source:'kis_master',sourceSha256});
 }
 return {rows,excluded,sourceSha256,sourceUrl:spec.url};
}
export function validateMasterBatch(parts) {
 if(parts.length!==2) throw Error('both KOSPI and KOSDAQ masters required');
 const rows=parts.flatMap(p=>p.rows),codes=new Set(),isins=new Set();
 for(const r of rows){if(codes.has(r.ticker)||isins.has(r.isin))throw Error('duplicate identity');codes.add(r.ticker);isins.add(r.isin);}
 for(const exchange of ['KOSPI','KOSDAQ'])if(rows.filter(r=>r.exchange===exchange).length<500)throw Error('incomplete master');
 if(rows.filter(r=>r.assetType==='etf').length<100)throw Error('missing ETF universe');
 return rows;
}
