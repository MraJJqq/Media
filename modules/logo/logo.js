const LOGOS=Object.freeze({
 AAPL:["apple","Stocks"],MSFT:["microsoft","Stocks"],GOOGL:["google","Stocks"],AMZN:["amazon","Stocks"],NVDA:["nvidia","Stocks"],TSLA:["tesla","Stocks"],META:["meta","Stocks"],INTC:["intel","Stocks"],QCOM:["qualcomm","Stocks"],AMD:["amd","Stocks"],TSM:["tsmc","Stocks"],AVGO:["broadcom","Stocks"],ORCL:["oracle","Stocks"],ARM:["arm","Stocks"],MU:["micron","Stocks"],ASML:["asml","Stocks"],SNDK:["sandisk","Stocks"],SKHYNIX:["sk-hynix","Stocks"],MRVL:["marvell","Stocks"],GLW:["corning","Stocks"],HOOD:["robinhood","Stocks"],CBRS:["cerence","Stocks"],SPCX:["spacex","Stocks"],BTC:["bitcoin","Core"],HYPE:["hyperliquid","Core"],XAU:["gold","Core"],CL:["crude-oil","Core"]
});
const ROOT="https://mrajjqq.github.io/Media/Logos/";
const brand=document.getElementById("logo-brand"),image=document.getElementById("logo-image"),label=document.getElementById("logo-symbol");
let current="",pending=null,transitioning=false;
function apply(symbol){
 const entry=LOGOS[symbol];
 if(!entry){image.hidden=true;image.removeAttribute("src");label.textContent="";current=symbol||"";return;}
 image.src=ROOT+entry[1]+"/"+entry[0]+".svg";
 image.alt=symbol;
 image.hidden=false;
 label.textContent=symbol;
 current=symbol;
}
function setSymbol(symbol){
 if(typeof symbol!=="string"||!symbol||symbol===current||transitioning)return;
 if(!current){apply(symbol);brand.style.opacity="1";return;}
 pending=symbol;transitioning=true;
 brand.style.opacity="0";
 window.setTimeout(()=>{
  if(pending)apply(pending);
  pending=null;
  brand.style.opacity="1";
  window.setTimeout(()=>{transitioning=false;},1500);
 },1500);
}
window.addEventListener("message",event=>{
 if(event.origin!=="https://mrajjqq.github.io")return;
 if(event.data?.type==="VEGAS_LOGO_SET_SYMBOL")setSymbol(event.data.symbol);
});
brand.style.opacity="0";
