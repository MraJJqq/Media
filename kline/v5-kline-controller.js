const DB_NAME="vegas-v5-market-cache",DB_VERSION=2,STORE_NAME="candles";
const HISTORY_PAGE_SIZE=200,FOUR_HOURS_MS=14_400_000;
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
 let selectedSymbol="",selectedContract="",candles=[],historyComplete=false,requestController=null,frameReady=false,busy=false,destroyed=false,activeBackfill=null;
 async function readCache(contract){
  const db=await dbPromise;if(!db){const old=memoryCache.get(contract);return {candles:old?.candles||[],historyComplete:old?.historyComplete===true};}
  return new Promise(resolve=>{const req=db.transaction(STORE_NAME,"readonly").objectStore(STORE_NAME).get(contract);
   req.onsuccess=()=>resolve({candles:Array.isArray(req.result?.candles)?req.result.candles:[],historyComplete:req.result?.historyComplete===true});
   req.onerror=()=>{const old=memoryCache.get(contract);resolve({candles:old?.candles||[],historyComplete:old?.historyComplete===true});};
  });
 }
 async function writeCache(contract,next,complete){
  const record={contract,updatedAt:Date.now(),historyComplete:complete===true,candleCount:next.length,oldestTimestamp:next[0]?.t??null,candles:next};
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
 function setStatus(symbol,state,error){
  if(!frameReady||destroyed)return;
  frame.contentWindow?.setHistoryStatus?.(symbol,candles.length,historyComplete,state,error?String(error.message||error):"");
 }
 function current(symbol,contract,sig){return !destroyed&&!sig.aborted&&selectedSymbol===symbol&&selectedContract===contract}
 function signal(){
  if(!requestController||requestController.signal.aborted)requestController=new AbortController();
  return requestController.signal;
 }
 function latestLimit(rows){
  if(!rows.length)return 1000;
  const latestStart=Math.floor(Date.now()/FOUR_HOURS_MS)*FOUR_HOURS_MS;
  const gapBars=Math.max(0,Math.floor((latestStart-rows[rows.length-1].t)/FOUR_HOURS_MS));
  return gapBars<=2?3:1000;
 }
 async function latest(contract,sig,limit=1000){
  const p="/api/v2/mix/market/candles?symbol="+encodeURIComponent(contract)+"&productType=USDT-FUTURES&granularity=4H&limit="+limit;
  return mergeCandles(normalizeRows(await client.request(p,{signal:sig})));
 }
 async function historyPage(contract,oldest,sig){
  const p="/api/v2/mix/market/history-candles?symbol="+encodeURIComponent(contract)+"&productType=USDT-FUTURES&granularity=4H&limit="+HISTORY_PAGE_SIZE+"&endTime="+Math.max(0,oldest-1);
  return mergeCandles(normalizeRows(await client.request(p,{signal:sig})));
 }
 async function backfillHistory(symbol,contract,sig){
  const task={contract,id:Symbol(contract)};activeBackfill=task;
  try{
   while(current(symbol,contract,sig)&&!historyComplete&&candles.length){
    const oldest=candles[0].t,page=await historyPage(contract,oldest,sig);
    if(!current(symbol,contract,sig))return;
    if(!page.length){historyComplete=true;await writeCache(contract,candles,true);setStatus(symbol,readinessState());return;}
    const nextOldest=page[0].t;
    if(!(nextOldest<oldest)){historyComplete=true;await writeCache(contract,candles,true);setStatus(symbol,readinessState());return;}
    candles=mergeCandles(candles,page);
    await writeCache(contract,candles,false);
    if(!current(symbol,contract,sig))return;
    render();setStatus(symbol,"loading");
    if(page.length<HISTORY_PAGE_SIZE){historyComplete=true;await writeCache(contract,candles,true);setStatus(symbol,readinessState());return;}
   }
   if(current(symbol,contract,sig)&&historyComplete)setStatus(symbol,readinessState());
  }catch(error){
   if(current(symbol,contract,sig)&&!isHidden()){setStatus(symbol,"request-failed",error);console.warn("[VEGAS V5 K-line history]",symbol,error);}
  }finally{if(activeBackfill===task)activeBackfill=null;}
 }
 async function select(symbol){
  const item=bySymbol.get(symbol);if(!item||destroyed)return false;
  if(selectedSymbol===symbol&&candles.length)return refresh();
  requestController?.abort("symbol-changed");requestController=new AbortController();const sig=requestController.signal;
  selectedSymbol=symbol;selectedContract=item.contract;historyComplete=false;busy=true;
  const cached=await readCache(selectedContract);
  if(!current(symbol,item.contract,sig)){if(selectedSymbol===symbol)busy=false;return false;}
  candles=mergeCandles(cached.candles);historyComplete=cached.historyComplete;render();
  setStatus(symbol,candles.length?readinessState():"loading");
  try{
   const fresh=await latest(item.contract,sig,latestLimit(candles));
   if(!current(symbol,item.contract,sig))return false;
   if(fresh.length){
    candles=mergeCandles(candles,fresh);
    await writeCache(item.contract,candles,historyComplete);
    if(!current(symbol,item.contract,sig))return false;
    render();
   }
   if(!candles.length){setStatus(symbol,"no-data");return false;}
   setStatus(symbol,readinessState());
   return true;
  }catch(error){
   if(current(symbol,item.contract,sig)&&!isHidden()){setStatus(symbol,"request-failed",error);console.warn("[VEGAS V5 K-line]",symbol,error);}
   return false;
  }finally{
   if(current(symbol,item.contract,sig)){busy=false;if(!historyComplete&&candles.length&&activeBackfill?.contract!==item.contract)void backfillHistory(symbol,item.contract,sig);}
  }
 }
 async function refresh(){
  if(destroyed||!selectedContract||isHidden()||busy||activeBackfill?.contract===selectedContract)return false;
  const sym=selectedSymbol,contract=selectedContract,sig=signal();busy=true;
  try{
   const fresh=await latest(contract,sig,latestLimit(candles));
   if(!current(sym,contract,sig))return false;
   if(fresh.length){
    candles=mergeCandles(candles,fresh);
    await writeCache(contract,candles,historyComplete);
    if(!current(sym,contract,sig))return false;
    render();
   }
   setStatus(sym,readinessState());
   return fresh.length>0;
  }catch(error){
   if(current(sym,contract,sig)&&!isHidden()){setStatus(sym,"request-failed",error);console.warn("[VEGAS V5 K-line refresh]",sym,error);}
   return false;
  }finally{
   if(current(sym,contract,sig)){busy=false;if(!historyComplete&&candles.length&&activeBackfill?.contract!==contract)void backfillHistory(sym,contract,sig);}
  }
 }
 function attach(){frameReady=true;render();if(selectedSymbol)setStatus(selectedSymbol,candles.length?readinessState():"no-data")}
 function suspend(){requestController?.abort("page-hidden");activeBackfill=null}
 function resume(){if(!destroyed&&!isHidden())refresh()}
 function destroy(){if(destroyed)return;destroyed=true;requestController?.abort("controller-destroyed");activeBackfill=null}
 return Object.freeze({select,refresh,attach,suspend,resume,destroy,get selectedSymbol(){return selectedSymbol}});
}
