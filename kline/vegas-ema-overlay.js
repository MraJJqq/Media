import { createVegasEmaOverlay } from "../Charts/vegas-ema.js";
const canvas=document.createElement("canvas");
canvas.setAttribute("aria-hidden","true");
canvas.style.cssText="position:fixed;inset:0;width:100%;height:100%;display:block;z-index:11;background:transparent;pointer-events:none";
(document.body||document.documentElement).appendChild(canvas);
const overlay=createVegasEmaOverlay({canvas});
window.setVegasEmaCandles=candles=>overlay.setCandles(candles);
window.addEventListener("klineviewportchange",event=>{if(event.detail)overlay.setView(event.detail)});
window.addEventListener("beforeunload",()=>overlay.destroy(),{once:true});
