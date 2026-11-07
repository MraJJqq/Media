const DB_NAME="vegas-v5-market-cache",DB_VERSION=2,STORE_NAME="candles";
const HISTORY_PAGE_SIZE=200,FOUR_HOURS_MS=14_400_000,CACHE_SCHEMA_VERSION=2;
function openCache(){
 return new Promise(resolve=>{
  if(!("indexedDB" in window))return resolve(null);
  const req=indexedDB.open(DB_NAME,DB_VERSION);
  req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE_NAME))req.result.createObjectStore(STORE_NAME,{keyPath:"contract"})};
  req.onsuccess=()=>resolve(req.result);req.onerror=()=>resolve(null);req.onblocked=()=>resolve(null);
 });
}
function normalizeRows(rows){
 return (Array.isArray(rows)?rows:[]).map(r=>({t:Number(r[0]),o:Number(r[1]),h:Number(r[2]),l:Number(r[3]),c:Number(r[4])}))
 .filter(c=>Number.isFinite(c.t)&&c.t>0&&[c.o,c.h,c.l,c.c].every(v=>Number.isFinite(v)&&v>0));
}
function mergeCandles(...groups){
 const map=new Map();for(const group of groups)for(const c of group||[])map.set(c.t,c);
 return [...map.values()].sort((a,b)=>a.t-b.t);
}
export function createV5KlineController({frame,client,instruments,isHidden=()=>document.hidden}={}){
 const bySymbol=new Map(instruments.map(item=>[item.symbol,item])),memoryCache=new Map(),dbPromise=openCache();
 let selectedSymbol="",selectedContract="",candles=[],historyComplete=false,selectionController=null,frameReady=false,busy=false,destroyed=false;
 let queueRunning=false,queueRequested=false;
 const completed=new Set(),failed=new Map();
 async function readCache(contract){
  const db=await dbPromise;
  if(!db){const old=memoryCache.get(contract);return {candles:old?.candles||[],historyComplete:old?.schemaVersion===CACHE_SCHEMA_VERSION&&old?.historyComplete===true};}
  return new Promise(resolve=>{const req=db.transaction(STORE_NAME,"readonly").objectStore(STORE_NAME).get(contract);
   req.onsuccess=()=>resolve({candles:Array.isArray(req.result?.candles)?req.result.candles:[],historyComplete:req.result?.schemaVersion===CACHE_SCHEMA_VERSION&&req.result?.historyComplete===true});
   req.onerror=()=>{const old=memoryCache.get(contract);resolve({candles:old?.candles||[],historyComplete:old?.schemaVersion===CACHE_SCHEMA_VERSION&&old?.historyComplete===true});};
  });
 }
 async function writeCache(contract,rows,complete){
  const next=mergeCandles(rows),record={contract,timeframe:"4H",schemaVersion:CACHE_SCHEMA_VERSION,updatedAt:Date.now(),historyComplete:complete===true,candleCount:next.length,oldestTimestamp:next[0]?.t??null,newestTimestamp:next[next.length-1]?.t??null,candles:next};
  const db=await dbPromise;if(!db){memoryCache.set(contract,record);return;}
  await new Promise(resolve=>{const tx=db.transaction(STORE_NAME,"readwrite");tx.objectStore(STORE_NAME).put(record);tx.oncomplete=tx.onerror=tx.onabort=()=>resolve()});
 }
 function render(){
  if(!frameReady||destroyed||!frame?.contentWindow)return;
  const w=frame.contentWindow;
  if(typeof w.setCandles==="function")w.setCandles(candles);
  if(typeof w.setVegasEmaCandles==="function")w.setVegasEmaCandles(candles);
 }
 function readinessState(){return historyComplete?(candles.length<676?"exchange-history-exhausted":"ready"):"loading"}
 function setStatus(symbol,state,error,count=candles.length){
  if(!frameReady||destroyed)return;
  frame.contentWindow?.setHistoryStatus?.(symbol,count,state==="ready"||state==="exchange-history-exhausted",state,error?String(error.message||error):"");
 }
 function selected(symbol,contract){return !destroyed&&selectedSymbol===symbol&&selectedContract===contract}
 async function latest(contract,limit=1000){
  const p="/api/v2/mix/market/candles?symbol="+encodeURIComponent(contract)+"&productType=USDT-FUTURES&granularity=4H&limit="+limit;
  return mergeCandles(normalizeRows(await client.request(p)));
 }
 async function historyPage(contract,oldest){
  const p="/api/v2/mix/market/history-candles?symbol="+encodeURIComponent(contract)+"&productType=USDT-FUTURES&granularity=4H&limit="+HISTORY_PAGE_SIZE+"&endTime="+Math.max(0,oldest-1);
  return mergeCandles(normalizeRows(await client.request(p)));
 }
 function publishIfSelected(symbol,contract,rows,complete){
  if(!selected(symbol,contract))return;
  candles=rows;historyComplete=complete;render();
  setStatus(symbol,complete?(rows.length<676?"exchange-history-exhausted":"ready"):"loading",null,rows.length);
 }
 async function backfillInstrument(item){
  const contract=item.contract,symbol=item.symbol,cached=await readCache(contract);
  let rows=mergeCandles(cached.candles),complete=cached.historyComplete;
  if(!rows.length){
   const fresh=await latest(contract);
   if(!fresh.length){failed.set(contract,"no-data");return;}
   rows=mergeCandles(rows,fresh);
   await writeCache(contract,rows,false);
   publishIfSelected(symbol,contract,rows,false);
  }else{
   const fresh=await latest(contract,rows.length<3?1000:3);
   if(fresh.length){rows=mergeCandles(rows,fresh);await writeCache(contract,rows,complete);publishIfSelected(symbol,contract,rows,complete);}
  }
  if(complete){completed.add(contract);failed.delete(contract);return;}
  while(!destroyed&&!isHidden()&&rows.length){
   const oldest=rows[0].t,page=await historyPage(contract,oldest);
   if(!page.length){complete=true;await writeCache(contract,rows,true);publishIfSelected(symbol,contract,rows,true);break;}
   const nextOldest=page[0].t;
   if(!(nextOldest<oldest)){complete=true;await writeCache(contract,rows,true);publishIfSelected(symbol,contract,rows,true);break;}
   rows=mergeCandles(rows,page);
   await writeCache(contract,rows,false);
   publishIfSelected(symbol,contract,rows,false);
   if(page.length<HISTORY_PAGE_SIZE){complete=true;await writeCache(contract,rows,true);publishIfSelected(symbol,contract,rows,true);break;}
  }
  if(complete){completed.add(contract);failed.delete(contract);}
 }
 async function runHistoryQueue(){
  if(queueRunning||destroyed||isHidden())return;
  queueRunning=true;queueRequested=false;
  try{
   for(const item of instruments){
    if(destroyed||isHidden())break;
    if(completed.has(item.contract))continue;
    try{await backfillInstrument(item);if(!completed.has(item.contract)&&!isHidden())failed.delete(item.contract);}
    catch(error){
     failed.set(item.contract,String(error?.message||error));
     if(selected(item.symbol,item.contract))setStatus(item.symbol,isHidden()?"paused":"request-failed",error);
     if(isHidden())break;
    }
   }
  }finally{
   queueRunning=false;
   if(queueRequested&&!destroyed&&!isHidden())void runHistoryQueue();
  }
 }
 function startHistoryQueue(){
  if(destroyed)return;
  queueRequested=true;
  if(!queueRunning&&!isHidden())void runHistoryQueue();
 }
 async function select(symbol){
  const item=bySymbol.get(symbol);if(!item||destroyed)return false;
  selectionController?.abort("symbol-changed");selectionController=new AbortController();const sig=selectionController.signal;
  selectedSymbol=symbol;selectedContract=item.contract;historyComplete=false;busy=true;
  const cached=await readCache(item.contract);
  if(sig.aborted||!selected(symbol,item.contract)){busy=false;return false;}
  candles=mergeCandles(cached.candles);historyComplete=cached.historyComplete;render();
  setStatus(symbol,candles.length?readinessState():"loading",null,candles.length);
  try{
   const p="/api/v2/mix/market/candles?symbol="+encodeURIComponent(item.contract)+"&productType=USDT-FUTURES&granularity=4H&limit="+(candles.length<3?1000:3);
   const fresh=mergeCandles(normalizeRows(await client.request(p,{signal:sig})));
   if(sig.aborted||!selected(symbol,item.contract))return false;
   if(fresh.length){candles=mergeCandles(candles,fresh);await writeCache(item.contract,candles,historyComplete);render();}
   setStatus(symbol,candles.length?readinessState():"no-data",null,candles.length);
   return candles.length>0;
  }catch(error){
   if(selected(symbol,item.contract)&&!isHidden()&&error?.name!=="AbortError")setStatus(symbol,"request-failed",error);
   return false;
  }finally{
   if(selected(symbol,item.contract)){busy=false;startHistoryQueue();}
  }
 }
 async function refresh(){
  if(destroyed||!selectedContract||isHidden()||busy)return false;
  const sym=selectedSymbol,contract=selectedContract;busy=true;
  try{
   const p="/api/v2/mix/market/candles?symbol="+encodeURIComponent(contract)+"&productType=USDT-FUTURES&granularity=4H&limit="+(candles.length<3?1000:3);
   const fresh=mergeCandles(normalizeRows(await client.request(p)));
   if(!selected(sym,contract))return false;
   if(fresh.length){candles=mergeCandles(candles,fresh);await writeCache(contract,candles,historyComplete);render();}
   setStatus(sym,readinessState(),null,candles.length);return fresh.length>0;
  }catch(error){
   if(selected(sym,contract)&&!isHidden()&&error?.name!=="AbortError")setStatus(sym,"request-failed",error);
   return false;
  }finally{if(selected(sym,contract))busy=false;}
 }
 function attach(){frameReady=true;render();if(selectedSymbol)setStatus(selectedSymbol,candles.length?readinessState():"no-data",null,candles.length);startHistoryQueue();}
 function suspend(){selectionController?.abort("page-hidden");}
 function resume(){if(destroyed||isHidden())return;startHistoryQueue();if(selectedSymbol)void refresh();}
 function destroy(){if(destroyed)return;destroyed=true;selectionController?.abort("controller-destroyed");}
 startHistoryQueue();
 return Object.freeze({select,refresh,attach,suspend,resume,destroy,get selectedSymbol(){return selectedSymbol},get historyQueueState(){return Object.freeze({completed:completed.size,total:instruments.length,failed:Object.fromEntries(failed)})}});
}
