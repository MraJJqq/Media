const DB_NAME="vegas-v6-market-cache",DB_VERSION=1,STORE="candles";
const INTERVALS=Object.freeze({"1H":"1h","4H":"4h","8H":"8h","D":"1d"});
const TIMEFRAMES=Object.freeze(["1H","4H","8H","D"]);
const MS=Object.freeze({"1H":3600000,"4H":14400000,"8H":28800000,"D":86400000});
const PAGE=2000,API="https://api.gateio.ws/api/v4/futures/usdt",WS_URL="wss://fx-ws.gateio.ws/v4/ws/usdt";
const keyOf=(contract,tf)=>"gate-usdt:"+contract+":"+tf;
const normalize=rows=>(Array.isArray(rows)?rows:[]).map(r=>({t:Number(r.t??r[0]),o:Number(r.o??r[5]??r[1]),h:Number(r.h??r[3]??r[2]),l:Number(r.l??r[4]??r[3]),c:Number(r.c??r[2]??r[4])})).filter(x=>Number.isFinite(x.t)&&x.t>0&&[x.o,x.h,x.l,x.c].every(v=>Number.isFinite(v)&&v>0));
const merge=(...groups)=>{const m=new Map();for(const g of groups)for(const c of g||[])m.set(c.t,c);return [...m.values()].sort((a,b)=>a.t-b.t)};
function openDB(){return new Promise((resolve,reject)=>{if(!("indexedDB"in window))return reject(new Error("IndexedDB unavailable; durable K-line cache cannot start"));const q=indexedDB.open(DB_NAME,DB_VERSION);q.onupgradeneeded=()=>{if(!q.result.objectStoreNames.contains(STORE))q.result.createObjectStore(STORE,{keyPath:"id"})};q.onsuccess=()=>{q.result.onversionchange=()=>q.result.close();resolve(q.result)};q.onerror=()=>reject(q.error||new Error("IndexedDB open failed"));q.onblocked=()=>reject(new Error("IndexedDB upgrade blocked"))})}
export function createGateKlineController({frame,instruments=[],onState=()=>{},isHidden=()=>document.hidden}={}){
 const dbp=openDB(),bySymbol=new Map(instruments.map(x=>[x.symbol,x])),memory=new Map();
 let symbol="",contract="",timeframe="4H",candles=[],complete=false,ws=null,retryTimer=0,pingTimer=0,stopped=false,selection=0,contractsPromise=null,wsSubscription=null,writeTimer=0;
 const pendingWrites=new Map(),requestControllers=new Set();
 let queueRunning=false,queueRestartRequested=false,paused=false;
 const completed=new Set(),failed=new Map();
 const canWork=()=>!stopped&&!paused&&!isHidden();
 async function read(key){const db=await dbp;return new Promise((resolve,reject)=>{let tx;try{tx=db.transaction(STORE,"readonly")}catch(e){reject(e);return}const q=tx.objectStore(STORE).get(key);q.onsuccess=()=>resolve(q.result||{candles:[],historyBoundaryReached:false,latestGapStatus:"pending"});q.onerror=()=>reject(q.error||new Error("IndexedDB read failed"));tx.onerror=()=>reject(tx.error||new Error("IndexedDB read transaction failed"))})}
 async function write(key,rows,done,status="ok",error=null){const data=rows,r={id:key,source:"Gate USDT perpetual",updatedAt:Date.now(),schemaVersion:2,historyComplete:done===true,historyBoundaryReached:done===true,historyBoundaryStatus:done===true?"api-empty-page-confirmed":"not-yet-confirmed",latestGapStatus:(status==="latest-verified"||done===true)?"clear":"pending",requestStatus:status,lastError:error,candleCount:data.length,oldestTimestamp:data[0]?.t??null,newestTimestamp:data.at(-1)?.t??null,candles:data};const db=await dbp;await new Promise((resolve,reject)=>{let tx;try{tx=db.transaction(STORE,"readwrite")}catch(e){reject(e);return}tx.objectStore(STORE).put(r);tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error||new Error("IndexedDB write failed"))})}
 function scheduleWrite(key,rows,done,status="ok",error=null){pendingWrites.set(key,{rows:rows.slice(),done,status,error});if(!writeTimer)writeTimer=setTimeout(()=>{void flushPendingWrites()},750)}
 async function flushPendingWrites(){if(writeTimer){clearTimeout(writeTimer);writeTimer=0}const jobs=[...pendingWrites.entries()];pendingWrites.clear();await Promise.all(jobs.map(async([key,p])=>{try{await write(key,p.rows,p.done,p.status,p.error)}catch(error){onState({status:"cache-write-failed",key,error:String(error?.message||error)})}}))}
 function mergeLive(rows,incoming){for(const item of incoming){const last=rows[rows.length-1];if(!last||item.t>last.t){rows.push(item);continue}if(item.t===last.t){rows[rows.length-1]=item;continue}const index=rows.findIndex(row=>row.t===item.t);if(index>=0)rows[index]=item;else{rows.push(item);rows.sort((a,b)=>a.t-b.t)}}return rows}
 async function request(url){let lastError;for(let attempt=0;attempt<5;attempt++){if(!canWork())throw new Error("History request paused");const controller=new AbortController();requestControllers.add(controller);try{const res=await fetch(url,{headers:{Accept:"application/json"},cache:"no-store",signal:controller.signal});if(res.status===429||res.status>=500)throw new Error("Gate HTTP "+res.status);if(!res.ok)throw new Error("Gate HTTP "+res.status);const body=await res.json();if(!Array.isArray(body))throw new Error("Gate returned non-array candlesticks");return normalize(body)}catch(error){lastError=error;if(!canWork()||controller.signal.aborted)throw error;if(attempt===4)break;await new Promise(r=>setTimeout(r,Math.min(8000,1000*2**attempt)))}finally{requestControllers.delete(controller)}}throw lastError||new Error("Gate history request failed")}
 async function getContracts(){if(!contractsPromise)contractsPromise=fetch(API+"/contracts",{headers:{Accept:"application/json"},cache:"no-store"}).then(async r=>{if(!r.ok)throw new Error("Gate contract list HTTP "+r.status);const rows=await r.json();if(!Array.isArray(rows))throw new Error("Gate contract list invalid");return new Map(rows.map(x=>[x.name,x]))}).catch(e=>{contractsPromise=null;throw e});return contractsPromise}
 async function assertContract(c){const all=await getContracts();if(!all.has(c))throw new Error("Gate USDT perpetual contract not found: "+c);return all.get(c)}
 async function latest(c,n,tf){const u=API+"/candlesticks?contract="+encodeURIComponent(c)+"&interval="+INTERVALS[tf]+"&limit="+n;return merge(await request(u))}
 async function older(c,tf,oldest){const step=MS[tf]/1000,from=Math.max(0,oldest-PAGE*step),to=Math.max(0,oldest-1);if(to<=from)return [];const u=API+"/candlesticks?contract="+encodeURIComponent(c)+"&interval="+INTERVALS[tf]+"&from="+from+"&to="+to;return merge(await request(u))}
 async function range(c,tf,from,to){const step=MS[tf]/1000;let cursor=Math.max(0,from),rows=[];while(cursor<=to&&canWork()){const end=Math.min(to,cursor+(PAGE-1)*step),u=API+"/candlesticks?contract="+encodeURIComponent(c)+"&interval="+INTERVALS[tf]+"&from="+cursor+"&to="+end,part=await request(u);if(!canWork())break;if(!part.length)throw new Error("Gate history gap could not be filled");rows=merge(rows,part);const next=part[part.length-1].t+step;if(next<=cursor)throw new Error("Gate gap repair pagination stalled");cursor=next}return rows}
 function isActive(c,tf){return !stopped&&c===contract&&tf===timeframe}
 function render(rows,token=selection,tf=timeframe){if(stopped||token!==selection||tf!==timeframe)return;const w=frame?.contentWindow;if(!w)return;w.setCandles?.(rows);w.setVegasEmaCandles?.(rows);w.setHistoryStatus?.(symbol,rows.length,complete,complete?"ready":"loading","",tf)}
 async function repairGaps(c,tf,source){
  let rows=source,guard=0;const step=MS[tf]/1000,key=keyOf(c,tf);
  while(canWork()&&guard++<10000){
   let left=null,right=null;
   for(let i=1;i<rows.length;i++){if(rows[i].t-rows[i-1].t>step){left=rows[i-1].t;right=rows[i].t;break}}
   if(left===null)return rows;
   const added=await range(c,tf,left+step,right-1);
   if(!canWork())return rows;
   const next=merge(rows,added);
   if(next.length===rows.length)throw new Error("Gate history gap remains unresolved");
   rows=next;await write(key,rows,false);
   if(isActive(c,tf)){candles=rows;complete=false;render(rows,selection,tf)}
  }
  if(guard>=10000)throw new Error("Gate history gap repair limit reached");
  return rows
 }
 function sendSubscription(event,sub){if(!ws||ws.readyState!==WebSocket.OPEN||!sub)return;ws.send(JSON.stringify({time:Math.floor(Date.now()/1000),channel:"futures.candlesticks",event,payload:[INTERVALS[sub.timeframe],sub.contract]}))}
 function setSubscription(){if(!canWork()||!contract||!ws||ws.readyState!==WebSocket.OPEN)return;const next={contract,timeframe};if(wsSubscription&&wsSubscription.contract===next.contract&&wsSubscription.timeframe===next.timeframe)return;if(wsSubscription)sendSubscription("unsubscribe",wsSubscription);sendSubscription("subscribe",next);wsSubscription=next}
 function closeWS(){if(retryTimer)clearTimeout(retryTimer);if(pingTimer)clearInterval(pingTimer);retryTimer=pingTimer=0;const old=ws;if(old){sendSubscription("unsubscribe",wsSubscription);old.onclose=null;try{old.close()}catch(_){}}ws=null;wsSubscription=null}
 function current(token=selection){return !stopped&&token===selection}
 function subscribe(){if(!canWork()||!contract)return;if(!ws){try{const socket=new WebSocket(WS_URL);ws=socket;socket.onopen=()=>{if(ws!==socket||!canWork())return;pingTimer=setInterval(()=>{if(ws===socket&&socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({time:Math.floor(Date.now()/1000),channel:"futures.ping"}))},20000);wsSubscription=null;setSubscription()};socket.onmessage=e=>{if(ws!==socket||!canWork())return;let message;try{message=JSON.parse(e.data)}catch(_){return}if(message.channel!=="futures.candlesticks"||message.event!=="update"||!Array.isArray(message.result))return;const first=message.result[0],rawContract=first?.n||first?.contract,rawInterval=first?.i||first?.interval;if(rawContract!==contract||rawInterval!==INTERVALS[timeframe])return;const incoming=normalize(message.result);if(!incoming.length)return;const token=selection,c=contract,tf=timeframe;candles=mergeLive(candles,incoming);scheduleWrite(keyOf(c,tf),candles,complete);render(candles,token,tf)};socket.onclose=()=>{if(ws===socket){ws=null;wsSubscription=null;if(pingTimer)clearInterval(pingTimer);pingTimer=0;if(canWork())retryTimer=setTimeout(subscribe,3000)}};socket.onerror=()=>{try{socket.close()}catch(_){}}}catch(_){retryTimer=setTimeout(subscribe,5000);return}}setSubscription()}
 async function backfillPeriod(c,tf){
  const key=keyOf(c,tf),cached=await read(key);
  if(!canWork())return;
  if(cached.historyBoundaryReached===true&&cached.latestGapStatus==="clear"){completed.add(key);failed.delete(key);return}
  let rows=merge(cached.candles),done=cached.historyBoundaryReached===true&&cached.latestGapStatus==="clear";
  const fresh=isActive(c,tf)?[]:await latest(c,rows.length?3:PAGE,tf);
  if(!canWork())return;
  rows=merge(rows,fresh);
  if(!rows.length)throw new Error("Gate returned no historical candles for "+c+" "+tf);
  await write(key,rows,done);
  const before=rows.length;
  rows=await repairGaps(c,tf,rows);
  if(!canWork()){await write(key,rows,false,"paused");return}
  if(rows.length!==before)done=false;
  await write(key,rows,done,"latest-verified");
  if(isActive(c,tf)){candles=rows;complete=done;render(rows,selection,tf)}
  if(done){completed.add(key);failed.delete(key);return}
  while(canWork()&&rows.length){
   const page=await older(c,tf,rows[0].t);
   if(!canWork()){await write(key,rows,false,"paused");return}
   if(!page.length){done=true;await write(key,rows,true,"history-boundary-reached");break}
   const old=rows[0].t,next=page[0].t;
   if(next>=old)throw new Error("Gate history pagination did not move backward");
   rows=merge(rows,page);await write(key,rows,false);
   rows=await repairGaps(c,tf,rows);
   if(!canWork()){await write(key,rows,false,"paused");return}
   if(isActive(c,tf)){candles=rows;complete=false;render(rows,selection,tf)}
   // A short page is not proof of the oldest history boundary. Probe the next earlier window; only an empty successful page confirms the boundary.
  }
  if(done){completed.add(key);failed.delete(key)}
  if(isActive(c,tf)){candles=rows;complete=done;render(rows,selection,tf);onState({symbol,contract:c,timeframe:tf,count:rows.length,historyComplete:done,status:done?"history-boundary-reached":"paused"})}
 }
 async function runHistoryQueue(){
  if(queueRunning||!canWork())return;
  queueRunning=true;
  try{
   const active=instruments.find(item=>item.symbol===symbol),ordered=active?[active,...instruments.filter(item=>item!==active)]:instruments;
   const periods=[timeframe,...TIMEFRAMES.filter(tf=>tf!==timeframe)];
   for(const item of ordered){
    for(const tf of periods){
     if(!canWork())break;
     const key=keyOf(item.gateContract||item.contract,tf);
     if(completed.has(key))continue;
     const c=item.gateContract||item.contract;
     try{await backfillPeriod(c,tf);if(completed.has(key))failed.delete(key)}
     catch(error){
      if(!canWork())break;
      const message=String(error?.message||error);failed.set(key,message);
      try{const snapshot=await read(key);await write(key,snapshot.candles,false,"failed",message)}catch(_){}
      if(isActive(c,tf))onState({symbol:item.symbol,contract:c,timeframe:tf,status:"request-failed",error:message});
     }
     if(canWork())await new Promise(resolve=>setTimeout(resolve,60));
    }
    if(!canWork())break;
   }
  }finally{
   queueRunning=false;
   if(queueRestartRequested&&canWork()){queueRestartRequested=false;void runHistoryQueue()}
  }
 }
 function startHistoryQueue(){if(stopped||paused||isHidden())return;if(queueRunning)return;void runHistoryQueue()}
 async function select(nextSymbol,nextContract,tf=timeframe){
  if(stopped)return false;
  if(!INTERVALS[tf])throw new Error("Unsupported timeframe: "+tf);
  const item=bySymbol.get(nextSymbol),c=nextContract||item?.gateContract||item?.contract;
  if(!c)throw new Error("A Gate USDT perpetual contract is required");
  selection++;const token=selection;symbol=nextSymbol;contract=c;timeframe=tf;complete=false;setSubscription();
  frame?.contentWindow?.migrateLegacyViewportKey?.(keyOf(c,tf));
  try{
   await assertContract(c);if(!current(token)||!canWork())return false;
   const cached=await read(keyOf(c,tf));if(!current(token)||!canWork())return false;
   candles=merge(cached.candles);complete=cached.historyComplete===true;render(candles,token,tf);
   onState({symbol,contract,timeframe,count:candles.length,historyComplete:complete,status:"cache-loaded"});
   const fresh=await latest(c,Math.min(PAGE,Math.max(3,candles.length?3:PAGE)),tf);
   if(!current(token)||!canWork())return false;
   candles=merge(candles,fresh);await write(keyOf(c,tf),candles,complete);render(candles,token,tf);subscribe();startHistoryQueue();
   return candles.length>0
  }catch(e){if(current(token))onState({symbol,contract,timeframe,count:candles.length,historyComplete:complete,status:"request-failed",error:String(e?.message||e)});return false}
 }
 async function refresh(){
  if(stopped||!contract||!canWork())return false;
  const token=selection,c=contract,tf=timeframe;
  try{const rows=await latest(c,3,tf);if(!current(token)||!canWork())return false;candles=mergeLive(candles,rows);await write(keyOf(c,tf),candles,complete);render(candles,token,tf);return true}
  catch(e){if(current(token))onState({symbol,contract,timeframe,status:"request-failed",error:String(e?.message||e)});return false}
 }
 function suspend(){paused=true;for(const controller of requestControllers)controller.abort("page-hidden");closeWS();void flushPendingWrites()}
 function resume(){if(stopped||isHidden())return;paused=false;if(queueRunning)queueRestartRequested=true;else startHistoryQueue();if(contract)void select(symbol,contract,timeframe)}
 function destroy(){if(stopped)return;stopped=true;paused=true;selection++;for(const controller of requestControllers)controller.abort("controller-destroyed");closeWS();void flushPendingWrites()}
 return Object.freeze({select,refresh,resume,suspend,destroy,getContracts,get state(){return Object.freeze({symbol,contract,timeframe,count:candles.length,historyComplete:complete,historyQueue:Object.freeze({running:queueRunning,completed:completed.size,total:instruments.length*TIMEFRAMES.length,failed:Object.fromEntries(failed)})})}});
}
