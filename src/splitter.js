// 상세 패널 폭 조절(끌기·키보드). 패널이 계층도를 덮지 않고 옆에 놓이며, 폭만 바꾼다(펼침 상태·탐색 범위와 무관).
(function () {
  const wrap = document.getElementById("wrapTree"), det = document.getElementById("detail"), bar = document.getElementById("detailSplit");
  if (!wrap || !det || !bar) return;
  const MIN = 260;
  const maxW = () => Math.max(MIN, Math.floor(wrap.clientWidth * 0.7));
  const setW = w => { const v = Math.max(MIN, Math.min(maxW(), Math.round(w))); det.style.width = v + "px"; bar.setAttribute("aria-valuenow", String(v)); };
  const sync = () => { bar.style.display = det.style.display === "none" ? "none" : ""; };
  new MutationObserver(sync).observe(det, {attributes: true, attributeFilter: ["style"]});
  sync();
  let drag = false;
  bar.addEventListener("pointerdown", ev => { drag = true; document.body.classList.add("dragging"); ev.preventDefault(); });
  window.addEventListener("pointermove", ev => { if (drag) setW(wrap.getBoundingClientRect().right - ev.clientX); });
  const end = () => { drag = false; document.body.classList.remove("dragging"); };
  window.addEventListener("pointerup", end); window.addEventListener("pointercancel", end);
  bar.addEventListener("keydown", ev => {
    const w = det.getBoundingClientRect().width;
    if (ev.key === "ArrowLeft") { ev.preventDefault(); setW(w + 24); }
    else if (ev.key === "ArrowRight") { ev.preventDefault(); setW(w - 24); }
  });
  bar.addEventListener("dblclick", () => { det.style.width = ""; });
})();
