// 신호 연결 그래프 위의 VCD 재생 도구(DOM). 파싱·값 조회·경로 연결은 vcd.js, 그래프 그리기는 netgraph.js 가 맡는다.
// 이 화면은 이미 만들어진 VCD 파일의 기록을 보여 줄 뿐이며 시뮬레이션을 실행하지 않는다.
// 상태는 항목별 state.vcd 에 둔다: {name, size, data, baseText, baseUser, t, speed, playing, ctl, prevVals, hold}
//
// pbExtra(box, api, ctx): gvRender 의 extra 훅. ctx = {tmod, nets, nodeId, info(대상 노드 정보: path/pathText)}

const PB_SPEEDS = [[0.25, "0.25×"], [1, "1×"], [4, "4×"], [16, "16×"]];
const PB_SECONDS = 20;      // 1× 에서 전체 구간을 재생하는 데 걸리는 실제 시간(초)
const PB_HOLD_MS = 600;     // 재생 중 값이 바뀐 신호의 강조 유지 시간
const PB_VCD_NOTE_SAMPLE = "예제: examples/sim_demo/tb_counter.vcd (수작업 fixture, 실제 시뮬레이터 출력 아님)";

function pbExtra(box, api, ctx) {
  const st = api.state;
  if (st.vcd && st.vcd.ctl) { st.vcd.ctl.stop(); st.vcd.playing = false; }
  const wrap = h("section", undefined, "pb");
  wrap.append(h("strong", "VCD 재생 (기존 시뮬레이션 결과 파일 보기)"));
  wrap.append(h("div", "ⓘ " + VCD_PLAY_NOTE, "pb-disc"));

  const row0 = h("div", undefined, "pb-row");
  const pick = document.createElement("input");
  pick.type = "file"; pick.id = "vcdPick"; pick.accept = ".vcd"; pick.hidden = true;
  const btnLoad = h("button", st.vcd ? "다른 VCD 불러오기" : "VCD 불러오기", "btn btn-secondary btn-small"); btnLoad.type = "button";
  btnLoad.addEventListener("click", () => { pick.value = ""; pick.click(); });
  const msg = h("span", "", "pb-msg");
  row0.append(btnLoad, pick, msg);
  wrap.append(row0);
  api.svg.parentNode.before(wrap);

  pick.addEventListener("change", async () => {
    const f = pick.files && pick.files[0]; pick.value = "";
    if (!f) return;
    msg.className = "pb-msg"; msg.textContent = "VCD 읽는 중…";
    try {
      const text = await f.slice(0, VCD_MAX_CHARS + 1).text();
      const d = vcdParse(text);
      if (!d.ok) { msg.className = "pb-msg err"; msg.textContent = "‘" + f.name + "’: " + d.error + " 이전 VCD 를 그대로 유지합니다."; return; }
      if (f.size > VCD_MAX_CHARS && !d.truncated) d.warnings.push("파일이 커서 앞부분만 읽었습니다.");
      st.vcd = {name: f.name, size: f.size, data: d, baseText: null, baseUser: false, t: null, speed: 1, playing: false, ctl: null, prevVals: null, hold: new Map()};
      renderNets();
    } catch (e) { msg.className = "pb-msg err"; msg.textContent = "VCD 를 읽지 못했습니다: " + e.message; }
  });

  if (!st.vcd) {
    wrap.append(h("div", "VCD 파일(.vcd)을 불러오면 현재 그래프의 신호 값을 시점별로 볼 수 있습니다. " + PB_VCD_NOTE_SAMPLE, "pb-msg"));
    return;
  }
  const V = st.vcd, vcd = V.data;
  const rootName = ctx.info.path[0];
  const rel = ctx.info.path.slice(1);
  const allRel = [...state.index.values()].map(x => x.path.slice(1));
  const sugg = vcdSuggestBase(vcd, allRel, rootName);
  const scopes = vcdScopeList(vcd);
  if (V.baseText == null) V.baseText = sugg ? sugg.text : "";
  const basePath = V.baseText ? V.baseText.split(".") : [];

  // 파일·시간 정보
  const ts = vcd.timescale;
  wrap.append(h("div", V.name + " · 시간 단위 " + (ts ? ts.text : "미확인") + " · 범위 " + vcdTimeText(vcd, vcd.startTime) + " ~ " + vcdTimeText(vcd, vcd.endTime) +
    " · 신호 " + vcd.vars.length + "개 · 스코프 " + vcd.scopes.length + "개" + (vcd.truncated ? " · 일부만 읽음" : ""), "pb-msg"));
  vcd.warnings.forEach(w => wrap.append(h("div", "⚠ " + w, "pb-msg err")));

  // 기준 경로 선택(설계 최상위 ↔ VCD 스코프)
  const rowB = h("div", undefined, "pb-row");
  const sel = document.createElement("select"); sel.className = "pb-scope"; sel.setAttribute("aria-label", "VCD 기준 경로");
  const o0 = document.createElement("option"); o0.value = ""; o0.textContent = "(VCD 최상위)"; sel.appendChild(o0);
  scopes.forEach(s => { const o = document.createElement("option"); o.value = s.text; o.textContent = s.text + " (" + s.vars + ")"; sel.appendChild(o); });
  sel.value = V.baseText;
  rowB.append(h("span", "기준 경로 — 설계 최상위 ‘" + rootName + "’ 에 해당하는 VCD 스코프:"), sel);
  if (!V.baseUser && sugg) rowB.append(h("span", sugg.weak ? "자동 제안(일치하는 하위 경로 없음, 직접 확인 필요)" : "자동 제안(확인 필요, 바꿀 수 있음)", "pb-msg"));
  sel.addEventListener("change", () => { V.baseText = sel.value; V.baseUser = true; V.prevVals = null; renderNets(); });
  wrap.append(rowB);

  // 설계 ↔ VCD 연결(이름 기준만, 못 찾으면 미매핑 목록에 남김)
  const mp = vcdMapGraph(vcd, basePath, rel, api.model);
  const widthWarns = [...mp.map].filter(([, x]) => x.widthWarn);
  const label = {};
  api.model.signals.forEach(s => { label[s.key] = "신호 " + s.net; });
  api.model.instances.forEach(i => i.rows.forEach(r => { label[r.key] = i.name + "." + r.port; }));
  const total = api.model.signals.length + api.model.instances.reduce((a, i) => a + i.rows.filter(r => r.kind === "net").length, 0);
  wrap.append(h("div", "VCD 스코프 ‘" + (mp.targetText) + "’ 기준으로 연결 " + mp.map.size + "개 / 연결하지 못함 " + mp.unmapped.length + "개 (그래프 신호·포트 " + total + "개 중)" +
    (mp.targetScope ? "" : " — 대상 스코프를 VCD 에서 찾지 못했습니다"), "pb-msg"));
  if (mp.unmapped.length || widthWarns.length) {
    const d = h("details", undefined, "pb-un"); d.open = mp.unmapped.length + widthWarns.length <= 6;
    d.append(h("summary", "연결하지 못한 항목 " + mp.unmapped.length + "개" + (widthWarns.length ? " · 폭 불일치(확인 필요) " + widthWarns.length + "개" : "")));
    const ul = h("ul", undefined, "pb-list");
    mp.unmapped.forEach(u => ul.append(h("li", u.label + " — " + u.why)));
    widthWarns.forEach(([k, x]) => ul.append(h("li", label[k] + " — 연결했지만 폭이 다릅니다(" + x.widthWarn + ")")));
    d.append(ul, h("div", "연결하지 못한 항목은 임의로 연결하지 않으며 그래프에 값이 표시되지 않습니다.", "pb-msg"));
    wrap.append(d);
  }
  if (!mp.map.size) { wrap.append(h("div", "이 그래프와 연결된 VCD 신호가 없어 재생할 값이 없습니다. 기준 경로를 확인하세요.", "pb-msg err")); return; }

  const recs = [...mp.map.values()].map(x => x.v.rec);
  const times = vcdChangeTimes(recs);
  const t0 = vcd.startTime, t1 = vcd.endTime;
  if (V.t == null || V.t < t0 || V.t > t1) V.t = t0;

  // 이동·재생 도구
  const rowT = h("div", undefined, "pb-row");
  const mk = (txt, title) => { const b = h("button", txt, "btn btn-secondary btn-small"); b.type = "button"; b.title = title; return b; };
  const bFirst = mk("⏮ 처음", "처음 시점으로"), bPrev = mk("◀ 이전 변경", "이전 값 변경 시점으로"), bPlay = mk("▶ 재생", "재생/일시정지"),
    bNext = mk("다음 변경 ▶", "다음 값 변경 시점으로");
  const spd = document.createElement("select"); spd.className = "pb-speed"; spd.setAttribute("aria-label", "재생 속도");
  PB_SPEEDS.forEach(o => { const op = document.createElement("option"); op.value = o[0]; op.textContent = o[1]; spd.appendChild(op); });
  spd.value = String(V.speed);
  rowT.append(bFirst, bPrev, bPlay, bNext, spd);
  const slider = document.createElement("input"); slider.type = "range"; slider.className = "pb-slider"; slider.min = String(t0); slider.max = String(t1); slider.step = "any";
  slider.setAttribute("aria-label", "시점");
  const timeEl = h("span", "", "pb-time"); timeEl.id = "pbTime";
  rowT.append(slider, timeEl);
  const chgEl = h("div", "", "pb-msg"); chgEl.id = "pbChanged";
  const leg = h("div", undefined, "pb-row");
  leg.append(h("span", "값 표시:"), h("span", "0", "vl v0"), h("span", "1", "vl v1"), h("span", "X 알 수 없음", "vl vx"), h("span", "Z 구동 없음", "vl vz"), h("span", "8'h3F 벡터", "vl vv"),
    h("span", "테두리 강조 = 직전 시점 대비 값이 바뀐 신호", "pb-msg"));
  // 이동·재생 도구는 그래프 바로 아래에 두고 스크롤해도 화면 아래에 붙어 있게 한다(그래프를 보면서 조작)
  const transport = h("div", undefined, "pb-transport");
  transport.append(rowT, chgEl, leg);
  api.svg.parentNode.after(transport);

  // 시점 반영
  const setTime = (t, playing) => {
    V.t = t;
    const raw = new Map(), values = new Map(), diff = [];
    const now = performance.now();
    for (const [key, x] of mp.map) {
      const val = vcdValueAt(x.v.rec, t);
      raw.set(key, val);
      const f = vcdFormat(val, x.v.size, x.v.type);
      const changed = V.prevVals ? V.prevVals.get(key) !== val : false;
      if (changed) { diff.push(key); if (playing) V.hold.set(key, now + PB_HOLD_MS); }
      values.set(key, {text: f.text, cls: f.cls, changed: changed || (playing && (V.hold.get(key) || 0) > now)});
    }
    if (!playing) V.hold.clear();
    V.prevVals = raw;
    ngSetValues(api.svg, values);
    timeEl.textContent = "현재 시점 " + vcdTimeText(vcd, Math.round(t * 100) / 100) + " (단위 " + (ts ? ts.unit : "미확인") + ")";
    slider.value = String(t);
    if (!playing || diff.length) chgEl.textContent = diff.length ? "직전 시점 대비 값이 바뀐 신호: " + diff.map(k => label[k] || k).join(", ") : (V.prevVals && !playing ? "직전 시점 대비 바뀐 신호 없음" : chgEl.textContent);
    bPrev.disabled = vcdStep(times, t, -1) == null; bNext.disabled = vcdStep(times, t, 1) == null;
    bFirst.disabled = t <= t0;
  };
  const stop = () => { V.playing = false; cancelAnimationFrame(V.raf); bPlay.textContent = "▶ 재생"; bPlay.setAttribute("aria-pressed", "false"); };
  const play = () => {
    if (t1 <= t0) return;
    if (V.t >= t1) { V.prevVals = null; setTime(t0, false); }
    V.playing = true; bPlay.textContent = "⏸ 일시정지"; bPlay.setAttribute("aria-pressed", "true");
    let last = performance.now();
    const frame = now => {
      if (!V.playing) return;
      if (!wrap.isConnected) { stop(); return; }
      const rate = (t1 - t0) / PB_SECONDS * V.speed;
      let t = V.t + (now - last) / 1000 * rate; last = now;
      if (t >= t1) { setTime(t1, true); stop(); return; }
      setTime(t, true);
      V.raf = requestAnimationFrame(frame);
    };
    V.raf = requestAnimationFrame(frame);
  };
  V.ctl = {stop};
  bPlay.addEventListener("click", () => { V.playing ? stop() : play(); });
  const jump = t => { stop(); setTime(t, false); };
  bFirst.addEventListener("click", () => { V.prevVals = null; jump(t0); });
  bPrev.addEventListener("click", () => { const t = vcdStep(times, V.t, -1); if (t != null) jump(t); });
  bNext.addEventListener("click", () => { const t = vcdStep(times, V.t, 1); if (t != null) jump(t); });
  slider.addEventListener("input", () => jump(+slider.value));
  spd.addEventListener("change", () => { V.speed = +spd.value; });
  if (t1 <= t0) { bPlay.disabled = true; slider.disabled = true; }
  setTime(V.t, false);
}
