// 신호 연결 탭의 [그래프] 보기: 도구 줄(방향 안내 재생·속도), 그래프(netgraph.js), 신호별 확인 사항.
// DOM 헬퍼 h()/$() 는 renderer.js 의 것을 호출 시점에 사용한다. 상태는 항목별 state(st)에 둔다: st.netSel, st.gv.
//
// c = {nets, mod, modMap, st, extra(wrap, api)}  — extra 는 VCD 재생 등 추가 도구를 붙이는 훅(playback.js)

function gvRender(wrap, c) {
  const st = c.st;
  st.gv = st.gv || {playing: false, speed: 1};
  const model = ngBuildModel(c.nets, c.mod, c.modMap);
  const box = h("section", undefined, "gv");
  const bar = h("div", undefined, "gv-bar");

  const btnPlay = h("button", "", "btn btn-secondary btn-small"); btnPlay.type = "button";
  const spd = document.createElement("select"); spd.className = "gv-speed"; spd.setAttribute("aria-label", "방향 안내 속도");
  [[0.5, "느리게 0.5×"], [1, "보통 1×"], [2, "빠르게 2×"]].forEach(o => { const op = document.createElement("option"); op.value = o[0]; op.textContent = o[1]; spd.appendChild(op); });
  spd.value = String(st.gv.speed);
  const lab = h("span", "연결 방향 안내", "gv-lab");
  bar.append(lab, btnPlay, spd);
  const disc = h("div", "ⓘ " + NG_DISCLAIMER, "gv-disc");
  box.append(bar, disc);

  const info = h("div", "", "gv-info");
  const sel = {selected: st.netSel || null, onSelect: net => { st.netSel = net; paintInfo(); }};
  const svg = ngRender(model, sel);
  const anim = svg.querySelector("circle.ng-dot") ? ngAnimator(svg) : null;
  if (anim) { anim.setSpeed(st.gv.speed); if (st.gv.playing) anim.play(); }
  const paintBtn = () => {
    btnPlay.textContent = !anim ? "방향이 확인된 연결 없음" : st.gv.playing ? "⏸ 일시정지" : "▶ 재생";
    btnPlay.disabled = !anim; btnPlay.setAttribute("aria-pressed", String(!!st.gv.playing));
  };
  btnPlay.addEventListener("click", () => { if (!anim) return; st.gv.playing = !st.gv.playing; st.gv.playing ? anim.play() : anim.pause(); paintBtn(); });
  spd.addEventListener("change", () => { st.gv.speed = +spd.value; if (anim) anim.setSpeed(st.gv.speed); });
  paintBtn();

  const legend = h("div", undefined, "gv-legend");
  legend.append(
    h("span", "━▶ 방향 확인(구동 → 신호 → 수신)", "lg dir"),
    h("span", "╌╌ 방향 없음(inout·정의 미제공·방향 선언 없음)", "lg und"),
    h("span", "점선 상자 ‘제외’ = 분석하지 못한 연결(선 없음)", "lg ex"),
    h("span", "클릭: 같은 신호 강조", "lg sel"));
  box.append(legend, info);

  const scroll = h("div", undefined, "gv-scroll"); scroll.append(svg); box.append(scroll);
  const paintInfo = () => {
    info.innerHTML = "";
    const n = st.netSel && c.nets.nets.find(x => x.name === st.netSel);
    if (!n) { info.textContent = "신호나 포트를 누르면 같은 신호의 연결이 강조됩니다."; return; }
    const words = {"to-net": "구동", "from-net": "수신", none: "방향 없음"};
    info.append(h("strong", "선택: " + n.name, "m"), h("span", " — " + n.endpoints.map(e => (e.kind === "boundary" ? "경계 포트 " + e.port : e.instance + "." + e.port) + "(" + words[e.arrow] + ")").join(", ")));
  };
  paintInfo();

  // 신호별 확인 사항(카드 보기의 경고·참고와 같은 내용)
  const withNotes = c.nets.nets.filter(n => n.notes.length).sort((a, b) => (b.notes.some(x => x.level === "warn") ? 1 : 0) - (a.notes.some(x => x.level === "warn") ? 1 : 0));
  const nd = h("details", undefined, "gv-notes"); nd.open = true;
  nd.append(h("summary", "신호별 확인 사항 (" + withNotes.length + "개 신호)"));
  withNotes.forEach(n => {
    const sec = h("div", undefined, "gv-note-sig");
    const nm = h("button", n.name, "linkbtn m"); nm.type = "button";
    nm.addEventListener("click", () => { st.netSel = n.name; svg._ng.select(n.name); sel.selected = n.name; paintInfo(); });
    sec.append(nm);
    const ul = h("ul", undefined, "notes");
    n.notes.forEach(x => ul.appendChild(h("li", (x.level === "warn" ? "확인: " : "참고: ") + x.text, "note " + x.level)));
    sec.append(ul); nd.append(sec);
  });
  const lim = h("details", undefined, "limits");
  lim.append(h("summary", "그래프의 범위와 제한사항"));
  const lul = h("ul"); NG_LIMIT_NOTES.forEach(x => lul.appendChild(h("li", x))); lim.append(lul);

  const api = {svg, model, box, bar, anim, state: st, selectNet: n => { st.netSel = n; sel.selected = n; svg._ng.select(n); paintInfo(); }};
  if (c.extra) c.extra(box, api);       // VCD 재생 도구 등
  box.append(nd, lim);
  wrap.append(box);
  return api;
}
