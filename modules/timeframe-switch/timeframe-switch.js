(() => {
  const buttons = [...document.querySelectorAll(".tf button[data-timeframe]")];
  const baseTransform = button => button.getAttribute("aria-pressed") === "true" ? "translateZ(12px)" : "";
  function setActive(timeframe) {
    for (const button of buttons) {
      button.setAttribute("aria-pressed", String(button.dataset.timeframe === timeframe));
      button.style.transform = "";
    }
  }
  for (const button of buttons) {
    button.addEventListener("click", () => {
      const timeframe = button.dataset.timeframe;
      setActive(timeframe);
      if (window.parent !== window) {
        window.parent.postMessage({type:"VEGAS_GATE_SET_TIMEFRAME", timeframe}, location.origin);
      }
    });
    button.addEventListener("pointermove", event => {
      const rect = button.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;
      button.style.transform = `${baseTransform(button)} rotateX(${(.5-y)*18}deg) rotateY(${(x-.5)*18}deg)`;
    });
    button.addEventListener("pointerleave", () => { button.style.transform = ""; });
  }
  window.addEventListener("message", event => {
    if (event.origin !== location.origin || event.source !== window.parent) return;
    if (event.data?.type === "VEGAS_GATE_TIMEFRAME_STATE" && ["4H","8H"].includes(event.data.timeframe)) {
      setActive(event.data.timeframe);
      window.parent.postMessage({type:"VEGAS_GATE_TIMEFRAME_READY"}, location.origin);
    }
  });
})();
