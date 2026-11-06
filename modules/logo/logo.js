const LOGOS=Object.freeze({
 AAPL:["apple","Stocks"],MSFT:["microsoft","Stocks"],GOOGL:["google","Stocks"],AMZN:["amazon","Stocks"],NVDA:["nvidia","Stocks"],TSLA:["tesla","Stocks"],META:["meta","Stocks"],INTC:["intel","Stocks"],QCOM:["qualcomm","Stocks"],AMD:["amd","Stocks"],TSM:["tsmc","Stocks"],AVGO:["broadcom","Stocks"],ORCL:["oracle","Stocks"],ARM:["arm","Stocks"],MU:["micron","Stocks"],ASML:["asml","Stocks"],SNDK:["sandisk","Stocks"],SKHYNIX:["sk-hynix","Stocks"],MRVL:["marvell","Stocks"],GLW:["corning","Stocks"],HOOD:["robinhood","Stocks"],CBRS:["cerence","Stocks"],SPCX:["spacex","Stocks"],BTC:["bitcoin","Core"],HYPE:["hyperliquid","Core"],XAU:["gold","Core"],CL:["crude-oil","Core"]
});
const ROOT="https://mrajjqq.github.io/Media/Logos/";
const SERVER_TIME_URL="https://api.bitget.com/api/v2/public/time";
const FOUR_HOURS_MS=14400000;
const brand=document.getElementById("logo-brand"),line=document.getElementById("logo-line"),image=document.getElementById("logo-image"),label=document.getElementById("logo-symbol"),countdown=document.getElementById("logo-countdown");
let current="",pending=null,transitioning=false,serverTimeAtSync=null,performanceAtSync=null,syncBusy=false,clockTimer=null,syncTimer=null;
function apply(symbol){
 const entry=LOGOS[symbol];
 if(!entry){image.hidden=true;image.removeAttribute("src");label.textContent="";current=symbol||"";return;}
 image.src=ROOT+entry[1]+"/"+entry[0]+".svg";
 image.alt=symbol;image.hidden=false;label.textContent=symbol;current=symbol;renderCountdown();
}
function setSymbol(symbol){
 if(typeof symbol!=="string"||!symbol||symbol===current||transitioning)return;
 if(!current){apply(symbol);line.style.opacity="1";return;}
 pending=symbol;transitioning=true;line.style.opacity="0";
 window.setTimeout(()=>{
  if(pending)apply(pending);
  pending=null;line.style.opacity="1";
  window.setTimeout(()=>{transitioning=false;},1500);
 },1500);
}
function exchangeNow(){
 if(serverTimeAtSync===null||performanceAtSync===null)return null;
 return serverTimeAtSync+(performance.now()-performanceAtSync);
}
function renderCountdown(){
 if(!current){countdown.textContent="--:--";return;}
 const now=exchangeNow();
 if(now===null){countdown.textContent="--:--:--";return;}
 const nextClose=(Math.floor(now/FOUR_HOURS_MS)+1)*FOUR_HOURS_MS;
 const remainingMinutes=Math.max(0,Math.ceil((nextClose-now)/60000));
 const hours=Math.floor(remainingMinutes/60),minutes=remainingMinutes%60;
 countdown.textContent=[hours,minutes].map(v=>String(v).padStart(2,"0")).join(":");
}
async function syncExchangeTime(){
 if(syncBusy||document.visibilityState==="hidden")return;
 syncBusy=true;const start=performance.now();
 try{
  const response=await fetch(SERVER_TIME_URL,{method:"GET",cache:"no-store"});
  if(!response.ok)throw new Error("Bitget server-time HTTP "+response.status);
  const payload=await response.json(),end=performance.now(),serverTime=Number(payload?.data?.serverTime);
  if(payload?.code!=="00000"||!Number.isFinite(serverTime)||serverTime<=0)throw new Error("Invalid Bitget server-time response");
  serverTimeAtSync=serverTime;performanceAtSync=(start+end)/2;renderCountdown();
 }catch(error){console.warn("[VEGAS Logo 4H countdown] server-time sync failed",error);}
 finally{syncBusy=false;}
}
function startClock(){
 if(clockTimer!==null)return;
 void syncExchangeTime();
 clockTimer=window.setInterval(renderCountdown,1000);
 syncTimer=window.setInterval(syncExchangeTime,60000);
}
function stopClock(){
 if(clockTimer!==null)window.clearInterval(clockTimer);
 if(syncTimer!==null)window.clearInterval(syncTimer);
 clockTimer=syncTimer=null;
}
window.addEventListener("message",event=>{
 if(event.origin!=="https://mrajjqq.github.io")return;
 if(event.data?.type==="VEGAS_LOGO_SET_SYMBOL")setSymbol(event.data.symbol);
});
document.addEventListener("visibilitychange",()=>{
 if(document.visibilityState==="hidden")stopClock();
 else{startClock();renderCountdown();}
});
line.style.opacity="0";
startClock();
