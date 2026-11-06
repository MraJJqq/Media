const TICKER_MAX_AGE_MS=600_000;
const TICKER_FUTURE_SKEW_MS=60_000;
export function isFreshBitgetTicker(row,nowMs=Date.now()){
 const timestamp=Number(row?.ts);
 if(!Number.isFinite(timestamp)||timestamp<=0||!Number.isFinite(nowMs))return false;
 const age=nowMs-timestamp;
 return age>=-TICKER_FUTURE_SKEW_MS&&age<=TICKER_MAX_AGE_MS;
}
export function createMarketStore({client,instruments=[],now=()=>Date.now()}={}){
 if(!client||typeof client.request!=="function")throw new TypeError("A Bitget client is required");
 let destroyed=false;
 async function loadTickerMap(){
  if(destroyed){const error=new Error("store-destroyed");error.name="AbortError";throw error;}
  const rows=await client.request("/api/v2/mix/market/tickers?productType=USDT-FUTURES");
  if(destroyed){const error=new Error("store-destroyed");error.name="AbortError";throw error;}
  const wanted=new Set(instruments.map(item=>item.contract)),map=new Map();
  for(const row of rows){
   const contract=String(row.symbol||"").toUpperCase();
   if(wanted.has(contract)&&isFreshBitgetTicker(row,now()))map.set(contract,row);
  }
  return map;
 }
 function destroy(){destroyed=true;}
 return Object.freeze({loadTickerMap,destroy});
}
