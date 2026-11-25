// 화면 처리: SVG 계층도 그리기, 인식 결과 표, 버튼 동작
// analyzer.js, layout.js, sample.js 가 먼저 로드되어 있어야 한다. (index.html의 script 순서 참고)
const NS = "http://www.w3.org/2000/svg";
const $ = id => document.getElementById(id);
// 계층도 색상·글꼴 (style.css 의 변수와 같은 값)
const C = {text: "#1b2a4a", muted: "#5a6a85", edge: "#5b6472", nodeFill: "#ffffff", nodeStroke: "#9aa8bd",
  topFill: "#e3edff", topStroke: "#2563eb", dashedFill: "#f4f6f9"};
const MONO = 'Consolas, "D2Coding", "Courier New", monospace';
const UI_FONT = '"Malgun Gothic", "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';

function el(name, attrs, parent) {
  const e = document.createElementNS(NS, name);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
function h(tag, text, cls) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}
function fit(text, w, size) {
  const max = Math.floor((w - 16) / (size * 0.62));
  return text.length > max ? text.slice(0, Math.max(1, max - 1)) + "…" : text;
}

function draw(root) {
  const L = layout(root);
  const svg = el("svg", {width: L.width, height: L.height, viewBox: "0 0 " + L.width + " " + L.height, role: "img", "aria-label": "Verilog 모듈 계층도"});
  const defs = el("defs", {}, svg);
  const mk = el("marker", {id: "arrow", viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "8", markerHeight: "8", orient: "auto-start-reverse"}, defs);
  el("path", {d: "M0,0 L10,5 L0,10 z", fill: C.edge}, mk);

  const edges = el("g", {fill: "none", stroke: C.edge, "stroke-width": "1"}, svg);
  for (const p of L.nodes) {
    if (!p.children.length) continue;
    const x1 = p.x + p.w, y1 = p.y + p.h / 2, midX = x1 + COL_GAP / 2;
    const ys = p.children.map(c => c.y + c.h / 2);
    el("path", {d: "M" + x1 + "," + y1 + " H" + midX}, edges);
    const top = Math.min(y1, ...ys), bot = Math.max(y1, ...ys);
    if (bot > top) el("path", {d: "M" + midX + "," + top + " V" + bot}, edges);
    for (const c of p.children) el("path", {d: "M" + midX + "," + (c.y + c.h / 2) + " H" + (c.x - 1), "marker-end": "url(#arrow)"}, edges);
  }
  const g = el("g", {}, svg);
  for (const n of L.nodes) {
    // 블록 하나 = 키보드 포커스 가능한 그룹. data-id 는 최상위부터의 전체 인스턴스 경로 기반 id 라서 같은 모듈의 여러 인스턴스도 구분된다.
    const grp = el("g", {class: "node" + (n.canExpand ? " can" : ""), tabindex: "0", role: "button", "data-id": n.id,
      "aria-label": "모듈 " + n.module + ", 인스턴스 " + n.instance + (n.tag ? ", " + n.tag : "") +
        (n.canExpand ? (n.open ? ", 펼쳐짐(직접 하위 " + n.kids + "개)" : ", 접힘(직접 하위 " + n.kids + "개)") : ", 펼칠 하위 없음") +
        ". 한 번 누르면 선택" + (n.canExpand ? ", 두 번 누르거나 Enter 로 펼치기/접기, 오른쪽·왼쪽 화살표로 펼치기·접기" : "") + ", i 키로 상세 정보"}, g);
    if (n.canExpand) grp.setAttribute("aria-expanded", String(n.open));
    el("rect", {class: "ring", x: n.x - 4, y: n.y - 4, width: n.w + 8, height: n.h + 8, rx: "7", ry: "7"}, grp);
    el("title", {}, grp).textContent = "모듈: " + n.module + "\n인스턴스: " + n.instance + (n.tag ? "\n" + n.tag : "") +
      (n.canExpand ? "\n(더블클릭: " + (n.open ? "하위 접기" : "하위 펼치기") + " · 직접 하위 " + n.kids + "개)" : "\n(펼칠 하위 없음)") + "\n(ⓘ 버튼 또는 i 키: 상세 정보)";
    const dashed = n.kind === "undef" || n.kind === "recursive";
    const isTop = n.depth === 0;
    const r = el("rect", {x: n.x, y: n.y, width: n.w, height: n.h, rx: "4", ry: "4",
      fill: isTop ? C.topFill : dashed ? C.dashedFill : C.nodeFill,
      stroke: isTop ? C.topStroke : C.nodeStroke, "stroke-width": isTop ? "1.5" : "1"}, grp);
    if (dashed) r.setAttribute("stroke-dasharray", "5 3");
    // 모듈명·인스턴스명은 식별자라 고정폭, 태그(‘최상위’ 등 한글 안내)는 UI 글꼴
    el("text", {x: n.x + n.w / 2, y: n.y + 19, "text-anchor": "middle", "font-size": "13", "font-weight": "bold", "font-family": MONO, fill: C.text}, grp).textContent = fit(n.module, n.w - 44, 13);
    el("text", {x: n.x + n.w / 2, y: n.y + 33, "text-anchor": "middle", "font-size": "11", "font-family": MONO, fill: C.muted}, grp).textContent = fit(n.instance, n.w - 44, 11);
    if (n.tag) el("text", {x: n.x + n.w / 2, y: n.y + 46, "text-anchor": "middle", "font-size": "10", "font-family": UI_FONT, fill: C.muted}, grp).textContent = fit(n.tag, n.w - 28, 16);
    if (n.pm && typeof bvDrawPorts === "function") bvDrawPorts(grp, n);
    // 좌측 ⓘ = 상세 정보, 우측 ▸/▾ = 펼치기/접기(펼칠 수 있는 블록에만). 글자와 겹치지 않게 양 옆에 둔다.
    const ib = el("g", {class: "nbtn info", "data-act": "info", role: "button", "aria-label": n.module + " 상세 정보"}, grp);
    el("title", {}, ib).textContent = "상세 정보(원본 코드·파일·줄)";
    el("rect", {x: n.x + 3, y: n.y + 3, width: 18, height: 18, rx: "9", ry: "9"}, ib);
    el("text", {x: n.x + 12, y: n.y + 16, "text-anchor": "middle", "font-size": "12", "font-family": UI_FONT}, ib).textContent = "ⓘ";
    if (n.canExpand) {
      const tb = el("g", {class: "nbtn tgl", "data-act": "toggle", role: "button", "aria-label": n.module + (n.open ? " 하위 접기" : " 하위 펼치기")}, grp);
      el("title", {}, tb).textContent = n.open ? "하위 접기" : "직접 하위 " + n.kids + "개 펼치기";
      el("rect", {x: n.x + n.w - 21, y: n.y + 3, width: 18, height: 18, rx: "4", ry: "4"}, tb);
      el("text", {x: n.x + n.w - 12, y: n.y + 16, "text-anchor": "middle", "font-size": "12", "font-family": UI_FONT}, tb).textContent = n.open ? "▾" : "▸";
      if (!n.open) el("text", {x: n.x + n.w - 12, y: n.y + 33, "text-anchor": "middle", "font-size": "9", "font-family": UI_FONT, fill: C.muted}, grp).textContent = "하위 " + n.kids;
    }
  }
  return {svg, L};
}

/* ---------- 화면 ---------- */
// 분석 항목(items): 단일 소스 또는 통합 설계. 항목마다 소스(files)와 화면 상태(st)를 따로 가진다.
//   전역 `state` 는 "현재 항목의 st" 를 가리키는 참조이며 항목을 바꿀 때 교체된다 → 항목 사이에 소스·결과·선택·상세 상태가 섞이지 않는다.
// state.shown: 마지막 분석 결과(실패 포함, 화면 표시용) / state.res: 성공한 최신 분석 결과(소스를 고치면 null)
// state.files: 분석 시점의 소스 스냅샷(상세 패널의 원본 소스·줄 번호용)
// state.root/index: 마지막으로 만든 전체 계층과 id 색인, state.scope: 선택한 최상위 기준 범위(충돌·미포함 모듈)
// 선택·상세·탐색 대상은 노드 id(최상위부터의 전체 인스턴스 경로)로 관리하며, 상단의 ‘최상위 모듈’ 선택(topSel)과는 별개다.
//   selected: 강조 중인 블록 / detail: 상세 패널에 열린 블록 / focus: 부분 계층 보기의 중심 블록 / netsTarget: 신호 연결 탭의 대상 블록
const MAX_READ_BYTES = 2 * 1024 * 1024;   // 파일 하나의 읽기 상한(이보다 크면 불러오지 않음). 분석 한도(약 30만 자)는 analyzer.js 가 따로 검사한다.
const STALE_MSG = "소스가 변경되었습니다. 다시 ‘코드 분석’을 눌러 주세요.";
const NETS_STATUS = "신호 연결: 단일 신호명으로 연결된 항목만 표시합니다. 제한사항은 아래 ‘분석 범위와 제한사항’에서 확인하세요.";
const TABS = {tree: ["tabTree", "wrapTree"], result: ["tabResult", "panelResult"], nets: ["tabNets", "panelNets"], tb: ["tabTb", "panelTb"], circ: ["tabCirc", "panelCirc"]};

function newState() {
  return {res: null, shown: null, files: [], top: null, tab: "tree", tree: null, scope: null,
    status: {text: "Verilog 코드를 입력하고 분석해 주세요.", err: false},
    root: null, index: null, selected: null, detail: null, focus: null, netsTarget: null, nets: null,
    netsMode: "card", netSel: null, gv: null, vcd: null, tbTop: null,
    expanded: null, viewCount: 0, portsFull: new Set(), showPorts: true};
}
let items = [], cur = null, itemSeq = 0, pasteSeq = 0;
let state = newState();

function clearNav(st) {
  st.root = null; st.index = null; st.selected = null; st.detail = null;
  st.focus = null; st.netsTarget = null; st.nets = null; st.circModule = null; st.circ = null; st.tree = null; st.expanded = null; st.viewCount = 0; st.portsFull = new Set();
}

function showTab(which) {
  state.tab = which;
  for (const k in TABS) {
    const on = k === which;
    $(TABS[k][0]).classList.toggle("on", on);
    $(TABS[k][0]).setAttribute("aria-selected", String(on));
    $(TABS[k][1]).style.display = on ? "" : "none";
  }
  $("resultBar").style.display = which === "result" ? "" : "none";
  $("legend").style.display = which === "tree" ? "" : "none";
  if (which === "nets") renderNets();
  if (which === "tb") renderTb();
  if (which === "circ") renderCirc();
  paintStatus();
  renderMetrics();
}

// 테스트벤치 탭: 파일 역할(f.role)은 항목(it.files)에 있고, 분석에는 마지막 분석 시점의 소스 스냅샷(state.files)을 쓴다.
function rolesOf(it) { const m = new Map(); (it ? it.files : []).forEach(f => { if (f.role === "testbench") m.set(f.id, "testbench"); }); return m; }
function renderTb() {
  renderItems();   // ‘테스트벤치로 보임’ 힌트를 최신 분석 결과로 갱신
  tbRender($("panelTb"), {res: state.res, files: state.files, roles: rolesOf(cur), st: state, onJump: jumpToDut});
}
// DUT 인스턴스의 모듈 상세로 이동: 최상위를 테스트벤치로 맞춰 계층도를 만들고 해당 인스턴스 블록의 상세를 연다.
function jumpToDut(tbName, instName) {
  if (!state.res) return;
  if (state.top !== tbName || !state.root || state.root.module !== tbName) { $("topSel").value = tbName; doShow(); }
  if (!state.index) return;
  let id = null;
  for (const [k, info] of state.index) if (info.parent === state.root.id && info.node.instance === instName) { id = k; break; }
  if (!id) { setStatus("계층도에서 인스턴스 '" + instName + "' 블록을 찾지 못했습니다.", true); return; }
  showTab("tree"); revealNode(id); openDetail(id);
}

function setStatus(text, isErr) {
  state.status = {text, err: !!isErr};
  paintStatus();
}
function paintStatus() {
  const s = $("status");
  const nets = state.tab === "nets";
  s.textContent = nets ? NETS_STATUS : state.status.text;
  s.classList.toggle("err", !nets && state.status.err);
}

/* ---------- 요약 칩: 현재 탭과 관련된 값만 표시 ---------- */
function metric(label, value, cls, tip) {
  const m = h("div", undefined, "metric" + (cls ? " " + cls : ""));
  if (tip) m.title = tip;
  m.append(h("span", label), h("b", String(value)));
  return m;
}
// 계층도 탭: 최상위 모듈 · 계층도 블록 수 · 깊이 · (정의 미제공 수) · (부분 계층 중심)
// 인식 결과 탭: 모듈 정의 수 · 인스턴스 선언 수 · 확인 필요 건수 · (통합 설계: 분석 파일 수 · 정의 충돌)
function renderMetrics() {
  const box = $("metrics");
  box.innerHTML = "";
  const res = state.res;
  if (!res) return;
  if (state.tab === "tree") {
    const t = state.tree;
    if (!t) return;
    box.append(
      metric("최상위 모듈", t.top, "main"),
      metric("전체 블록", t.count + "개", "", "최상위부터 모두 펼쳤을 때의 블록 수 (같은 모듈도 인스턴스마다 하나씩 센다)"),
      metric("표시 중", state.viewCount + "개", "", "지금 펼쳐서 화면에 보이는 블록 수"),
      metric("깊이", t.depth + "단계", "", "모두 펼쳤을 때의 깊이")
    );
    if (state.expanded) {
      const bx = h("button", "모두 펼치기", "btn btn-secondary btn-small"); bx.type = "button"; bx.id = "btnExpandAll";
      bx.addEventListener("click", () => setAllExpanded(true));
      const bc = h("button", "모두 접기", "btn btn-secondary btn-small"); bc.type = "button"; bc.id = "btnCollapseAll";
      bc.addEventListener("click", () => setAllExpanded(false));
      const lb = h("label", undefined, "chk-inline"); const cbx = h("input"); cbx.type = "checkbox"; cbx.id = "chkPorts"; cbx.checked = state.showPorts !== false;
      cbx.addEventListener("change", () => setShowPorts(cbx.checked));
      lb.append(cbx, document.createTextNode(" 포트 표시"));
      lb.title = "블록 안에 입력(왼쪽)·출력/inout(오른쪽) 포트와 상위 연결 신호를 표시합니다.";
      box.append(bx, bc, lb);
    }
    if (t.nUndef) box.append(metric("정의 미제공", t.nUndef + "개"));
    if (state.focus && state.index) {
      const f = state.index.get(state.focus);
      box.append(metric("중심 모듈", f.node.module + " (" + f.node.instance + ")", "main", "부분 계층 보기: " + f.pathText));
      const b = h("button", "전체 계층으로", "btn btn-secondary btn-small");
      b.type = "button"; b.id = "btnFullTree";
      b.addEventListener("click", () => { state.focus = null; renderTreeView(); renderMetrics(); setStatus("전체 계층을 표시합니다."); });
      box.append(b);
    }
  } else if (state.tab === "nets") {
    const n = state.nets;
    if (!n || n.error) return;
    box.append(
      metric("대상 모듈", n.module, "main"),
      metric("신호", n.summary.netCount + "개", "", "단일 신호명으로 연결된 신호의 수"),
      metric("연결 포트", n.summary.instancePortCount + "개", "", "직접 하위 인스턴스의 포트 연결 수"),
      metric("분석 제외", n.summary.excludedCount + "건")
    );
  } else {
    box.append(
      metric("모듈 정의", res.modules.length + "개", "", "분석에 포함된 소스에서 찾은 module 정의의 수"),
      metric("인스턴스 선언", res.instCount + "개", "", "분석에 포함된 소스 전체에서 찾은 인스턴스 선언문의 수"),
      metric("확인 필요", collectWarns(res).length + "건")
    );
    if (cur && cur.kind === "design") box.append(metric("분석 파일", res.files.filter(f => f.status !== "excluded").length + "/" + res.files.length + "개", "", "분석에 포함한 파일 수 / 전체 파일 수"));
    if (res.conflicts.length) box.append(metric("정의 충돌", res.conflicts.length + "건"));
  }
}

/* ---------- Markdown 복사 (현재 분석 결과 state.res 만 사용) ---------- */
function setCopyMsg(text) { $("copyMsg").textContent = text || ""; }
function setCopyEnabled(on) { $("btnCopyMd").disabled = !on; setCopyMsg(""); }

async function copyMarkdown() {
  const res = state.res;   // 클릭 시점의 최신 성공 결과. 소스 수정·분석 실패 시 state.res 는 null
  if (!res) { setCopyMsg("복사할 최신 분석 결과가 없습니다. 먼저 ‘코드 분석’을 누르세요."); return; }
  let md;
  try { md = toMarkdown(res); }
  catch (e) { setCopyMsg("Markdown을 만들지 못했습니다: " + e.message); return; }
  try {
    if (window.gateClipboard) await window.gateClipboard.writeText(md);
    else if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(md);
    else throw new Error("이 환경에서는 클립보드 기능을 사용할 수 없습니다.");
    setCopyMsg("Markdown을 복사했습니다");
  } catch (e) {
    setCopyMsg("복사하지 못했습니다: " + (e && e.message ? e.message : "원인을 알 수 없습니다."));
  }
}

/* ---------- 인식 결과 ---------- */
// mono: 식별자 열(고정폭, 길면 줄바꿈), nums: 숫자 열(오른쪽 정렬)
function table(headers, rows, mono, nums) {
  const t = h("table");
  const thead = h("thead"), hr = h("tr");
  headers.forEach((x, i) => hr.appendChild(h("th", x, nums.includes(i) ? "num" : "")));
  thead.appendChild(hr); t.appendChild(thead);
  const tb = h("tbody");
  rows.forEach(r => {
    const tr = h("tr");
    r.forEach((v, i) => {
      const td = h("td", v, [mono.includes(i) ? "m" : "", nums.includes(i) ? "num" : ""].join(" ").trim());
      if (mono.includes(i)) td.title = v;
      tr.appendChild(td);
    });
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  return t;
}

const STYLE_LABEL = {named: "이름 기반", none: "포트 없음", positional: "위치 기반(확인 필요)", mixed: "혼합(확인 필요)", implicit: ".* (확인 필요)"};
function styleOf(x) {
  const k = new Set(x.conns.map(c => c.kind === "positional" ? "positional" : c.kind === "implicit" ? "implicit" : "named"));
  if (!x.conns.length) return STYLE_LABEL.none;
  if (k.has("implicit")) return STYLE_LABEL.implicit;
  if (k.has("positional") && k.size > 1) return STYLE_LABEL.mixed;
  if (k.has("positional")) return STYLE_LABEL.positional;
  return STYLE_LABEL.named;
}

function conflictText(c) {
  return "모듈명 '" + c.name + "' 정의 충돌: " + c.defs.map(d => d.displayName + " " + d.line + "줄").join(", ") + " → 어느 정의를 쓸지 정하지 않습니다.";
}
// 확인 필요 항목(칩의 건수와 Markdown 의 건수가 같은 기준). skipConflicts: 충돌은 별도 상자에 표시할 때 목록에서 제외
function collectWarns(res, skipConflicts) {
  const warns = res.warnings.slice();
  res.modules.forEach(m => m.warns.forEach(w => warns.push("[" + m.name + (m.file ? " · " + m.file.displayName : "") + "] " + w)));
  if (!skipConflicts) res.conflicts.forEach(c => warns.push(conflictText(c)));
  if (res.undef.length) warns.push("정의가 분석에 포함된 소스에 없는 모듈: " + res.undef.join(", ") + " → 계층도에서 ‘정의 미제공’으로 표시하며 펼치지 않습니다.");
  return warns;
}
function defLabel(res, name) { return res.modMap.has(name) ? "정의됨" : res.defs.has(name) ? "정의 충돌" : "정의 미제공"; }

const ORIGIN_LABEL = {file: "파일에서 불러옴", paste: "직접 입력"};
function fileStatusText(rec) {
  return rec.status === "excluded" ? "분석에서 제외" : rec.status === "error" ? "분석 실패" : "분석에 포함";
}

function renderResult(res) {
  const p = $("panelResult"); p.innerHTML = "";
  const wrap = h("div", undefined, "pad"); p.appendChild(wrap);
  if (!res) { wrap.appendChild(h("div", "아직 분석한 결과가 없습니다.", "empty")); return; }
  const design = !!cur && cur.kind === "design";

  if (res.error) {
    const w = h("div", undefined, "notice error");
    w.append(h("strong", "분석 실패"), h("div", "원인: " + res.error),
      h("div", "다음 행동: 소스를 확인·수정(또는 파일을 추가)한 뒤 ‘코드 분석’을 다시 눌러 주세요."));
    wrap.appendChild(w);
  }
  // 파일 목록(통합 설계) · 파일별 안내(.sv, include, 인코딩 등) — 처리하지 못한 부분을 숨기지 않는다
  if ((design || res.files.some(f => f.status !== "ok")) && res.files.length) {
    const sec = h("section", undefined, "mod");
    const head = h("div", undefined, "mod-head");
    head.append(h("span", "분석에 포함된 파일", "mod-name"), h("span", res.files.length + "개 중 " + res.files.filter(f => f.status === "ok").length + "개 분석 성공", "mod-meta"));
    sec.appendChild(head);
    sec.appendChild(table(["파일", "출처", "상태", "모듈 정의"],
      res.files.map(f => {
        const src = cur.files.find(x => x.id === f.id);
        return [f.displayName, src ? ORIGIN_LABEL[src.origin] : "", fileStatusText(f) + (f.error ? ": " + f.error : ""), f.status === "ok" ? f.moduleCount + "개" : "-"];
      }), [0], [3]));
    wrap.appendChild(sec);
  }
  const fnotes = [];
  res.files.forEach(f => {
    const src = cur && cur.files.find(x => x.id === f.id);
    const all = [].concat(src ? src.readNotes || [] : [], f.notes);
    all.forEach(t => fnotes.push("[" + f.displayName + "] " + t));
  });
  if (fnotes.length) {
    const w = h("div", undefined, "notice info");
    w.appendChild(h("strong", "파일별 안내 (" + fnotes.length + "건)"));
    const ul = h("ul"); fnotes.forEach(x => ul.appendChild(h("li", x))); w.appendChild(ul); wrap.appendChild(w);
  }
  if (res.conflicts.length) {
    const w = h("div", undefined, "notice error");
    w.appendChild(h("strong", "모듈명 충돌 " + res.conflicts.length + "건 — 해결이 필요합니다"));
    const ul = h("ul"); res.conflicts.forEach(c => ul.appendChild(h("li", conflictText(c)))); w.appendChild(ul);
    w.appendChild(h("div", "충돌한 모듈에 도달하는 최상위는 계층도를 만들 수 없습니다. 해결: 왼쪽 목록에서 충돌한 파일의 ‘분석 포함’을 끄거나 목록에서 제거한 뒤 다시 분석하세요. (원본 파일은 바뀌지 않습니다.)"));
    wrap.appendChild(w);
  }
  if (res.error) {
    const rest = collectWarns(res, true);
    if (rest.length) { const ul = h("ul"); rest.forEach(x => ul.appendChild(h("li", x))); wrap.appendChild(ul); }
    return;
  }
  const warns = collectWarns(res, true);
  if (warns.length) {
    const w = h("div", undefined, "notice warn");
    w.appendChild(h("strong", "경고 · 확인이 필요한 항목 (" + warns.length + "건)"));
    const ul = h("ul"); warns.forEach(x => ul.appendChild(h("li", x))); w.appendChild(ul); wrap.appendChild(w);
  }
  const sc = state.scope;
  if (sc && sc.ok) {
    const sec = h("section", undefined, "mod");
    const head = h("div", undefined, "mod-head");
    head.append(h("span", "선택한 최상위 " + sc.top + " 기준 범위", "mod-name"), h("span", "계층에 포함된 모듈 " + sc.reachable.length + "개 · 포함되지 않는 모듈 " + sc.unreferenced.length + "개", "mod-meta"));
    sec.appendChild(head);
    if (sc.undef.length) sec.appendChild(h("div", "정의 미제공: " + sc.undef.join(", "), "mod-empty m"));
    if (sc.unreferenced.length) {
      sec.appendChild(h("div", "아래 모듈은 선택한 최상위에서 인스턴스화되지 않아 계층도에 나오지 않습니다. 이 프로그램은 둘을 임의로 연결하지 않습니다(연결하는 상위 코드가 있어야 합니다).", "mod-empty"));
      sec.appendChild(table(["모듈", "파일", "정의 시작 줄(파일 기준)", "비고"], sc.unreferenced.map(u => [u.name, u.displayName, String(u.line), u.conflict ? "정의 충돌" : ""]), [0, 1], [2]));
    } else sec.appendChild(h("div", "포함되지 않는 모듈 없음", "mod-empty"));
    wrap.appendChild(sec);
  }
  const note = h("div", undefined, "notice info");
  note.append(h("strong", "안내"), h("div", "아래 목록은 텍스트 패턴으로 찾은 결과입니다. 실제 코드와 대조해 누락·오인식이 없는지 확인한 뒤 계층도를 생성하세요."));
  wrap.appendChild(note);
  for (const m of res.modules) {
    const sec = h("section", undefined, "mod");
    const head = h("div", undefined, "mod-head");
    head.append(h("span", m.name, "mod-name"), h("span", (m.file ? m.file.displayName + " · " : "") + "module · " + m.line + "줄 · 인스턴스 " + m.instances.length + "개", "mod-meta"));
    sec.appendChild(head);
    if (m.instances.length) {
      sec.appendChild(table(["인스턴스명", "모듈명", "정의 여부", "포트 연결 형식", "줄"],
        m.instances.map(x => [x.name, x.module, defLabel(res, x.module), styleOf(x) + (x.array ? " · 배열" : ""), String(x.line)]), [0, 1], [4]));
    } else sec.appendChild(h("div", "인식된 인스턴스 없음 (하위 모듈이 없거나 인식하지 못함)", "mod-empty"));
    wrap.appendChild(sec);
  }
}

/* ---------- 분석 · 계층도 생성 ---------- */
function filesForAnalysis(it) {
  return it.files.map(f => ({id: f.id, name: f.name, displayName: f.displayName, text: f.text, include: f.include}));
}
function emptyResult(msg) {
  return {error: msg, files: [], modules: [], defs: new Map(), modMap: new Map(), conflicts: [], roots: [], undef: [], instCount: 0, warnings: []};
}

function doAnalyze() {
  const it = cur;
  if (!it) return;
  if (!it.files.length) { setStatus("분석할 파일이 없습니다. 먼저 파일을 추가해 주세요.", true); return; }
  let res;
  try { res = analyzeDesign(filesForAnalysis(it)); }
  catch (e) { res = emptyResult("분석 중 예기치 않은 오류: " + e.message); }
  state.shown = res;
  state.res = res.error ? null : res;
  state.files = it.files.map(f => ({id: f.id, name: f.name, displayName: f.displayName, text: f.text}));
  state.scope = null; state.tree = null;
  resetNav();
  if (res.error) {
    renderPanels();
    setStatus("분석하지 못했습니다. ‘인식 결과’ 탭의 원인을 확인하고 소스를 고치거나 파일을 추가한 뒤 다시 분석해 주세요.", true);
    showTab("result"); return;
  }
  if (!state.top || !res.defs.has(state.top)) state.top = res.roots[0] || [...res.defs.keys()][0];
  renderPanels();
  const nW = collectWarns(res).length + (res.conflicts.length ? 0 : 0);
  setStatus("분석했습니다. 최상위 모듈을 선택하고 ‘계층도 생성’을 눌러 주세요." + (nW ? " 확인이 필요한 항목이 있습니다." : ""), res.conflicts.length > 0);
  showTab("result");
}

function doShow() {
  if (!state.res) return;
  const top = $("topSel").value;
  state.top = top;
  const sc = scopeOf(state.res, top);
  state.scope = sc;
  resetNav();
  if (!sc.ok) {
    state.tree = null;
    renderPanels();
    setStatus(sc.message, true);
    showTab("tree"); return;
  }
  const {root, count, truncated} = buildTree(state.res.modMap, top, 1500);
  state.root = root; state.index = indexTree(root);
  const nUndef = (function c(n) { return (n.kind === "undef" ? 1 : 0) + n.children.reduce((a, x) => a + c(x), 0); })(root);
  state.tree = {top, count, depth: tvFullDepth(root), nUndef, truncated};
  state.expanded = new Set([root.id]);   // 처음에는 최상위의 직접 하위까지만 보인다. 나머지는 더블클릭/▸ 버튼으로 펼친다.
  renderResult(state.shown);
  renderTreeView();
  const notes = [];
  if (truncated) notes.push("블록 수가 많아 일부 하위 인스턴스를 생략했습니다.");
  if (state.res.roots.length > 1 || !state.res.roots.includes(top)) notes.push("선택한 모듈 기준의 계층입니다.");
  if (sc.unreferenced.length) notes.push("선택한 최상위에 포함되지 않는 모듈 " + sc.unreferenced.length + "개는 ‘인식 결과’ 탭에서 확인하세요.");
  setStatus(notes.join(" ") || "계층도를 생성했습니다.");
  showTab("tree"); $("panelTree").scrollTo(0, 0);
}

/* ---------- 현재 항목의 상태를 화면 전체에 반영 ---------- */
const TREE_EMPTY = "최상위 모듈을 선택하고 ‘계층도 생성’을 눌러 주세요.";
function renderControls() {
  const sel = $("topSel"), btn = $("btnShow");
  $("btnAnalyze").disabled = !cur || !cur.files.length;
  sel.innerHTML = "";
  const res = state.res;
  if (!res) {
    sel.appendChild(new Option(state.shown && state.shown.error ? "(분석 실패)" : "(먼저 코드를 분석하세요)", ""));
    sel.disabled = true; btn.disabled = true; return;
  }
  const order = [...res.roots, ...[...res.defs.keys()].filter(k => !res.roots.includes(k))];
  for (const nm of order) {
    const tag = res.defs.get(nm).length > 1 ? "  (정의 충돌)" : res.roots.includes(nm) ? "  (최상위 후보)" : "";
    sel.appendChild(new Option(nm + tag, nm));
  }
  if (state.top && res.defs.has(state.top)) sel.value = state.top;
  sel.disabled = false; btn.disabled = false;
}

function renderPanels() {
  const st = state, p = $("panelTree");
  renderResult(st.shown);
  renderControls();
  setCopyEnabled(!!st.res);
  $("detail").style.display = "none"; $("detailBody").innerHTML = "";
  if (st.root && st.index) {
    renderTreeView();
    if (st.detail && st.index.get(st.detail)) openDetail(st.detail, true);
  } else if (st.scope && !st.scope.ok) {
    p.innerHTML = "";
    const w = h("div", undefined, "notice error pad-m");
    w.append(h("strong", "계층도를 만들 수 없습니다"), h("div", st.scope.message));
    if (st.scope.conflicts && st.scope.conflicts.length) {
      const ul = h("ul"); st.scope.conflicts.forEach(c => ul.appendChild(h("li", conflictText(c)))); w.append(ul);
    }
    p.appendChild(w);
  } else {
    p.innerHTML = "";
    p.appendChild(h("div", st.shown && !st.res ? (st.shown.error ? "분석에 실패했습니다. ‘인식 결과’ 탭을 확인하세요." : STALE_MSG) : TREE_EMPTY, "empty"));
  }
  if (st.tab !== "nets") $("panelNets").innerHTML = '<div class="empty">먼저 분석하고 계층도를 생성해 주세요.</div>';
  showTab(st.tab);
}

// 소스가 바뀌면 그 항목의 최신 결과를 무효로 한다(다른 항목에는 영향 없음)
function invalidate(it) {
  const st = it.st;
  if (!st.res) return;
  st.res = null; st.scope = null;
  clearNav(st);
  st.status = {text: STALE_MSG, err: false};
  if (it === cur) renderPanels();
}

/* ---------- 계층도 보기 · 선택 · 상세 · 부분 계층 ---------- */
function resetNav() {
  clearNav(state);
  $("detail").style.display = "none";
  $("detailBody").innerHTML = "";
  $("panelNets").innerHTML = '<div class="empty">먼저 분석하고 계층도를 생성해 주세요.</div>';
}

// 현재 보기(전체 또는 부분 계층)를 그린다. 반환값은 배치 정보(L).
// opts.keep: 이전 스크롤 위치를 유지(펼침/접힘용). 없으면 맨 위로(처음 생성·중심 보기 전환).
function renderTreeView(opts) {
  const start = state.focus ? state.index.get(state.focus).node : state.root;
  if (!state.expanded) state.expanded = new Set([state.root.id]);
  const view = tvView(start, state.expanded);
  state.viewCount = tvCount(view);
  if (!state.portsFull) state.portsFull = new Set();
  if (typeof bvDecorate === "function" && state.res) bvDecorate(view, {modMap: state.res.modMap, index: state.index, full: state.portsFull, show: state.showPorts !== false});
  const {svg, L} = draw(view);
  const p = $("panelTree");
  const sTop = p.scrollTop, sLeft = p.scrollLeft;
  p.innerHTML = ""; p.appendChild(svg);
  paintSelection();
  if (opts && opts.keep) { p.scrollTop = sTop; p.scrollLeft = sLeft; } else p.scrollTo(0, 0);
  return L;
}

/* ---------- 펼치기 / 접기 (인스턴스 경로 id 기준) ---------- */
function nodeElOf(id) { return nodeEls().find(x => x.getAttribute("data-id") === id); }
// 방금 조작한 블록이 화면에서 같은 위치에 남도록 스크롤을 보정한다.
function relayoutKeepingAnchor(id) {
  const p = $("panelTree");
  const before = nodeElOf(id);
  const pr = p.getBoundingClientRect();
  const o = before ? (r => ({dx: r.left - pr.left, dy: r.top - pr.top}))(before.getBoundingClientRect()) : null;
  renderTreeView({keep: true});
  const g = nodeElOf(id);
  if (g && o) {
    const r = g.getBoundingClientRect(), pr2 = p.getBoundingClientRect();
    p.scrollLeft += (r.left - pr2.left) - o.dx;
    p.scrollTop += (r.top - pr2.top) - o.dy;
  }
  return g;
}
function toggleNode(id) {
  const info = state.index && state.index.get(id);
  if (!info || !tvExpandable(info.node)) return;
  const opened = tvToggle(state.expanded, id);
  state.selected = id;
  const g = relayoutKeepingAnchor(id);
  if (g) g.focus({preventScroll: true});
  renderMetrics();
  setStatus((opened ? "펼침: " : "접음: ") + info.pathText + " (직접 하위 " + info.node.children.length + "개). 표시 중인 블록 " + state.viewCount + "개.");
}
// 접힌 포트 요약 ↔ 전체 포트 보기 (인스턴스 경로별)
function togglePorts(id) {
  if (!state.index || !state.index.get(id)) return;
  if (state.portsFull.has(id)) state.portsFull.delete(id); else state.portsFull.add(id);
  state.selected = id;
  const g = relayoutKeepingAnchor(id);
  if (g) g.focus({preventScroll: true});
  setStatus(state.portsFull.has(id) ? "전체 포트를 표시합니다: " + state.index.get(id).pathText : "포트를 접힌 요약으로 표시합니다: " + state.index.get(id).pathText);
}
function setShowPorts(on) {
  state.showPorts = on;
  renderTreeView({keep: true});
  setStatus(on ? "블록에 입출력 포트를 표시합니다." : "블록에 모듈명·인스턴스명만 표시합니다.");
}
function expandNode(id) { const info = state.index && state.index.get(id); if (info && tvExpandable(info.node) && !state.expanded.has(id)) toggleNode(id); }
function collapseNode(id) { if (state.expanded.has(id)) toggleNode(id); }
// 모두 펼치기/접기: 전체 구조가 바뀌므로 맨 위부터 다시 보여 준다.
function setAllExpanded(open) {
  state.expanded = open ? tvAllExpandable(state.root) : new Set();
  if (state.focus && !open) state.expanded.add(state.focus);
  renderTreeView();
  renderMetrics();
  setStatus(open ? "모든 블록을 펼쳤습니다." : "모든 블록을 접었습니다. 블록을 더블클릭하거나 ▸ 를 눌러 펼치세요.");
}
// 숨겨진 블록을 보이게(조상 펼침). 이미 보이면 아무것도 하지 않는다.
function revealNode(id) {
  let info = state.index && state.index.get(id), changed = false;
  while (info && info.parent) { if (!state.expanded.has(info.parent)) { state.expanded.add(info.parent); changed = true; } info = state.index.get(info.parent); }
  if (changed) renderTreeView({keep: true});
}

function nodeEls() { return [...$("panelTree").querySelectorAll("g.node")]; }
function paintSelection() {
  for (const g of nodeEls()) g.classList.toggle("sel", g.getAttribute("data-id") === state.selected);
}
function selectNode(id) { state.selected = id; paintSelection(); }

function kv(label, value, mono) {
  const row = h("div", undefined, "kv");
  const v = h("div", value, "kv-v" + (mono ? " m" : ""));
  row.append(h("div", label, "kv-k"), v);
  return row;
}

// 모듈이 사용된 위치(부모 모듈 안의 인스턴스 선언): 그 파일 이름과 파일 기준 줄 번호
function usageOf(info) {
  if (!info.parent) return null;
  const pn = state.index.get(info.parent).node;
  const pm = state.res.modMap.get(pn.module);
  const m = /#(\d+)$/.exec(info.node.id);
  return pm && m ? instanceLocation(pm, +m[1]) : null;
}

function openDetail(id, quiet) {
  const info = state.index && state.index.get(id);
  if (!info) return;
  state.selected = id; state.detail = id; paintSelection();
  const n = info.node, mod = state.res.modMap.get(n.module);
  $("detailTitle").textContent = "모듈 상세";
  const body = $("detailBody"); body.innerHTML = "";
  const isRoot = n === state.root;
  body.append(
    kv("모듈명", n.module, true),
    kv("인스턴스명", isRoot ? "(최상위, 인스턴스 아님)" : n.instance, true),
    kv("전체 인스턴스 경로", info.pathText, true),
    kv("정의 파일", mod ? mod.file.displayName : "정의 미제공", true),
    kv("모듈 정의 시작 줄(파일 기준)", mod ? mod.line + "줄" : "정의 미제공")
  );
  const use = usageOf(info);
  if (use) body.append(kv("사용 위치(인스턴스 선언)", use.displayName + " · " + use.line + "줄 · " + use.parentModule + " 안의 " + use.instance, true));
  const sub = h("div", undefined, "kv");
  sub.append(h("div", "직접 하위 인스턴스", "kv-k"));
  const sv = h("div", undefined, "kv-v");
  if (!mod) sv.textContent = "정의 미제공 (분석에 포함된 소스에 module 정의가 없어 알 수 없음)";
  else if (!mod.instances.length) sv.textContent = "하위 모듈 없음";
  else { const ul = h("ul", undefined, "kid"); mod.instances.forEach(x => ul.appendChild(h("li", x.name + " : " + x.module + (res_undef(x.module) ? "  (정의 미제공)" : "") + "  · " + x.line + "줄", "m"))); sv.appendChild(ul); }
  sub.append(sv); body.append(sub);
  // 포트 표: 모듈 정의의 포트명·방향·폭과, 이 인스턴스에서 상위가 연결한 신호(같은 모듈도 인스턴스마다 다름)
  if (mod && typeof piBlock === "function") {
    const par = info.parent ? state.res.modMap.get(state.index.get(info.parent).node.module) : null;
    const im = /#(\d+)$/.exec(id);
    const pb = piBlock(state.res.modMap, n.module, par, im ? +im[1] : 0);
    const pk = h("div", undefined, "kv");
    pk.append(h("div", "포트 " + pb.total + "개 (포트명 / 방향 / 폭 / 상위 연결 신호)", "kv-k"));
    const tbl = h("table", undefined, "ptab");
    pb.rows.forEach(r => {
      const tr = h("tr");
      const dirTxt = {input: "input", output: "output", inout: "inout ◂▸", unknown: "미확인"}[r.dir];
      const w = r.range || (r.bits == null ? "미확인" : "1비트");
      const c = info.parent ? (r.conn === "net" ? r.signal : r.conn === "const" ? "상수 " + r.signal : r.conn === "positional" ? r.signal + " (순서 기반)" : r.conn === "expr" ? "식 " + r.signal : r.conn === "open" ? "(빈 연결)" : "(연결 없음)") : "(최상위)";
      [r.port, dirTxt, w, c].forEach((t, i) => { const td = h("td", t, i === 0 || i === 3 ? "m" : ""); td.title = r.full; tr.append(td); });
      tbl.append(tr);
    });
    pk.append(tbl); body.append(pk);
  }
  if (n.kind === "recursive") body.append(h("div", "재귀 참조라 계층도에서는 더 펼치지 않았습니다.", "kv-note"));
  const src = h("div", undefined, "kv");
  src.append(h("div", "원본 소스 코드", "kv-k"));
  const ms = mod ? moduleSource(state.files, mod) : null;
  if (ms) {
    const pre = h("pre", ms.lines.map(l => String(l.no).padStart(4, " ") + "  " + l.text).join("\n"), "src");
    pre.tabIndex = 0; pre.setAttribute("aria-label", n.module + " 원본 소스 코드");
    src.append(h("div", ms.displayName + " · " + ms.startLine + "~" + ms.endLine + "줄 (줄 번호는 이 파일 기준)", "kv-note"));
    src.append(pre);
    if (!ms.terminated) src.append(h("div", "endmodule 을 찾지 못해 시작 줄부터 파일 끝까지 표시합니다.", "kv-note"));
    if (state.files.find(f => f.id === ms.fileId) && cur && cur.files.find(f => f.id === ms.fileId && f.text !== state.files.find(x => x.id === f.id).text))
      src.append(h("div", "분석 이후 소스가 수정되었습니다. 위 내용은 분석 시점의 소스입니다.", "kv-note"));
  } else src.append(h("div", "정의 미제공", "kv-v"));
  body.append(src);
  $("btnDetailFocus").disabled = !mod;
  $("btnDetailNets").disabled = !mod; $("btnDetailCirc").disabled = !mod;
  $("detail").style.display = "";
  // 패널이 열리면 트리 영역이 좁아지므로 선택한 블록이 가려지지 않게 화면 안으로 가져온다(펼침 상태·탐색 범위는 그대로).
  const sg = !quiet && nodeElOf(id); if (sg && sg.scrollIntoView) sg.scrollIntoView({block: "nearest", inline: "nearest"});
  if (!quiet) $("detailTitle").focus();
}
function res_undef(name) { return !state.res.modMap.has(name); }

function closeDetail() {
  const id = state.detail;
  state.detail = null;
  $("detail").style.display = "none";
  const g = nodeEls().find(x => x.getAttribute("data-id") === id);
  if (g) g.focus({preventScroll: true});
}

function setFocusView(id) {
  if (!state.index || !state.index.get(id)) return;
  state.focus = id === state.root.id ? null : id;
  if (state.focus) state.expanded.add(state.focus);   // 중심 블록은 직접 하위가 보이도록 펼친 상태로 시작
  renderTreeView();
  renderMetrics();
  const f = state.focus && state.index.get(state.focus);
  setStatus(f ? "부분 계층 보기: " + f.pathText + " 아래만 표시합니다. 위 ‘전체 계층으로’ 버튼으로 돌아갈 수 있습니다." : "전체 계층을 표시합니다.");
}

// 회로 탭(Yosys 변환 결과). 대상은 선택한 인스턴스의 모듈. 소스가 바뀌어 분석 결과가 달라지면 새로 변환한다.
function renderCirc() {
  const p = $("panelCirc"); p.innerHTML = "";
  if (!state.res || !state.index) { p.append(h("div", "회로를 보려면 소스를 분석하고 ‘계층도 생성’을 누른 뒤, 계층도 블록의 ⓘ → ‘이 모듈의 회로 변환 보기’를 선택하세요.", "empty")); return; }
  const mod = state.circModule || state.root.module;
  if (!state.circ || state.circ.mod !== mod) state.circ = {mod, mode: (state.circ && state.circ.mode) || "rtl", expanded: new Set(), cache: (state.circ && state.circ.cache) || new Map(), scale: 1};
  cvRender(p, {target: mod, modMap: state.res.modMap, files: state.files, st: state.circ,
    onBack: () => showTab("tree"),
    setTarget: name => { state.circModule = name; renderCirc(); },
    hasModule: name => state.res.modMap.has(name)});
}
function openCirc(id) {
  if (!state.index || !state.index.get(id)) return;
  state.circModule = state.index.get(id).node.module; state.circ = null;
  showTab("circ");
}

function openNets(id) {
  if (!state.index || !state.index.get(id)) return;
  state.netsTarget = id;
  showTab("nets");
}

/* ---------- 신호 연결 탭 (카드형) ---------- */
const DIR_TEXT = {"to-net": "구동", "from-net": "수신", none: "방향 없음"};
const ARROW_GLYPH = {"to-net": "──▶ 신호", "from-net": "신호 ──▶", none: "───"};
const NOTE_LABEL = {warn: "확인", info: "참고"};
const LIMITS = [
  "이 탭은 텍스트 패턴으로 찾은 간이 분석입니다. 시뮬레이션·합성 결과가 아닙니다.",
  "대상 모듈의 경계 포트와 직접 하위 인스턴스 포트 중 ‘단일 신호명’으로 이름 기반 연결된 항목만 묶습니다.",
  "비트 선택, 연산식·연결 연산({ }), 상수, 빈 연결, 위치 기반 연결, .* 는 분석에서 제외하고 아래 ‘분석 제외 연결’에 사유와 함께 남깁니다.",
  "하위 모듈의 내부를 따라가며 신호를 추적하지 않습니다. 직접 하위 인스턴스의 포트까지만 봅니다.",
  "assign / always 등 다른 구동원은 분석하지 않습니다. ‘알려진 구동 포트 없음’은 구동원이 없다는 뜻이 아닙니다.",
  "inout 포트와 정의를 알 수 없는 포트는 연결 사실만 표시하고, 구동·수신 판정에서는 제외합니다(화살표 없음).",
  "폭을 계산할 수 없으면 ‘폭 미확인’으로 표시하며 추측하지 않습니다. 인스턴스 배열은 폭을 판단하지 않습니다.",
  "generate, 매크로 등 지원하지 않는 문법 안의 연결은 인식하지 못할 수 있습니다.",
  "여러 파일 설계에서도 대상 모듈 하나의 정의(한 파일)와 그 직접 하위 모듈만 봅니다. 줄 번호는 대상 모듈이 정의된 파일 기준입니다."
];

function endpointRow(e) {
  const li = h("li", undefined, "ep");
  const who = e.kind === "boundary" ? "경계 포트 " + e.port : e.instance + "." + e.port;
  const meta = [];
  if (e.kind === "instance") meta.push(e.module || "?");
  meta.push(e.dir || "방향 미확인");
  meta.push(e.bits != null ? e.bits + "비트" : "폭 미확인");
  li.append(h("span", DIR_TEXT[e.arrow], "ep-dir " + e.arrow), h("span", ARROW_GLYPH[e.arrow], "ep-arrow"),
    h("span", who, "ep-who m"), h("span", meta.join(" · "), "ep-meta"));
  if (e.kind === "instance") li.title = e.instance + " 인스턴스 · " + e.line + "줄(대상 모듈 파일 기준)" + (e.reason ? " · " + e.reason : "");
  if (e.reason) li.append(h("div", "방향 없음 사유: " + e.reason, "ep-why"));
  return li;
}

function netCard(nt) {
  const card = h("section", undefined, "card");
  const head = h("div", undefined, "card-head");
  const decl = nt.declared === "port" ? "경계 포트" : nt.declared === "net" ? "내부 신호" : "선언 없음";
  head.append(h("span", nt.name, "card-name m"), h("span", decl + " · " + (nt.bits != null ? nt.bits + "비트" : "폭 미확인"), "card-meta"),
    h("span", "구동 " + nt.counts.drivers + " · 수신 " + nt.counts.loads + (nt.counts.undirected ? " · 방향 없음 " + nt.counts.undirected : ""), "card-meta"));
  card.append(head);
  const ul = h("ul", undefined, "eps");
  nt.endpoints.forEach(e => ul.appendChild(endpointRow(e)));
  card.append(ul);
  if (nt.notes.length) {
    const nl = h("ul", undefined, "notes");
    nt.notes.forEach(x => nl.appendChild(h("li", NOTE_LABEL[x.level] + ": " + x.text, "note " + x.level)));
    card.append(nl);
  }
  return card;
}

function renderNets() {
  const p = $("panelNets"); p.innerHTML = "";
  const wrap = h("div", undefined, "pad"); p.appendChild(wrap);
  state.nets = null;
  if (!state.res || !state.index) {
    wrap.append(h("div", "신호 연결을 보려면 소스를 분석하고 ‘계층도 생성’을 누른 뒤, 계층도에서 모듈 블록을 두 번 눌러 ‘이 모듈의 신호 연결 보기’를 선택하세요. (바로 이 탭을 열면 최상위 모듈이 대상이 됩니다.)", "empty"));
    return;
  }
  const id = state.netsTarget || state.root.id;
  const info = state.index.get(id) || state.index.get(state.root.id);
  const n = info.node;
  const tmod = state.res.modMap.get(n.module);
  const nets = buildNets(state.res.modMap, n.module);
  state.nets = nets;

  const bar = h("div", undefined, "nets-target");
  const l1 = h("div", undefined, "nt-line");
  l1.append(h("span", "대상 모듈", "kv-k"), h("span", n.module, "m nt-v"));
  const l2 = h("div", undefined, "nt-line");
  l2.append(h("span", "인스턴스 경로", "kv-k"), h("span", info.pathText, "m nt-v"));
  bar.append(l1, l2);
  if (tmod) {
    const l3 = h("div", undefined, "nt-line");
    l3.append(h("span", "정의 파일", "kv-k"), h("span", tmod.file.displayName + " · " + tmod.line + "줄", "m nt-v"));
    bar.append(l3);
  }
  const back = h("button", "계층도로 돌아가기", "btn btn-secondary btn-small");
  back.type = "button"; back.addEventListener("click", () => showTab("tree"));
  bar.append(back);
  wrap.append(bar);
  // 보기 전환: 카드(기존) / 그래프. 같은 분석 결과(buildNets)를 쓴다.
  const modes = h("div", undefined, "nets-modes"); modes.setAttribute("role", "group"); modes.setAttribute("aria-label", "신호 연결 보기 방식");
  [["card", "카드"], ["graph", "그래프"]].forEach(([k, label]) => {
    const b = h("button", label, "btn btn-small " + (state.netsMode === k ? "btn-primary" : "btn-secondary")); b.type = "button";
    b.setAttribute("aria-pressed", String(state.netsMode === k));
    b.addEventListener("click", () => { if (state.netsMode !== k) { state.netsMode = k; renderNets(); } });
    modes.append(b);
  });
  if (!nets.error) wrap.append(modes);

  if (nets.error) {
    const w = h("div", undefined, "notice warn");
    w.append(h("strong", "정의 미제공"), h("div", "이 모듈은 분석에 포함된 소스에 정의가 없어 포트와 신호를 알 수 없습니다. 추측하지 않습니다."));
    wrap.append(w);
  } else {
    if (!nets.nets.length) wrap.append(h("div", "단일 신호명으로 연결된 항목이 없습니다. (하위 인스턴스가 없거나 모두 분석 제외 대상입니다)", "empty"));
    if (state.netsMode === "graph" && nets.nets.length) {
      gvRender(wrap, {nets, mod: tmod, modMap: state.res.modMap, st: state, extra: window.pbExtra ? (box, api) => pbExtra(box, api, {tmod, nets, nodeId: id, info}) : null});
    } else {
      nets.nets.forEach(nt => wrap.append(netCard(nt)));
    }
    if (nets.unusedBoundary.length) {
      const s = h("section", undefined, "mod");
      s.append(h("div", undefined, "mod-head"));
      s.firstChild.append(h("span", "하위 인스턴스와 연결되지 않은 경계 포트", "mod-name"));
      s.append(h("div", nets.unusedBoundary.map(x => x.name + " (" + (x.dir || "방향 미확인") + ")").join(", "), "kv-v m"));
      s.append(h("div", "이 모듈 안의 assign/always 등에서만 쓰이거나 연결되지 않았을 수 있습니다. 이 탭에서는 판단하지 않습니다.", "kv-note"));
      wrap.append(s);
    }
    if (nets.excluded.length) {
      const s = h("section", undefined, "mod");
      s.append(h("div", undefined, "mod-head"));
      s.firstChild.append(h("span", "분석 제외 연결", "mod-name"), h("span", nets.excluded.length + "건", "mod-meta"));
      s.append(table(["인스턴스", "포트", "연결 내용", "제외 사유", "줄(파일 기준)"],
        nets.excluded.map(x => [x.instance, x.port, x.text, x.reason, String(x.line)]), [0, 1, 2], [4]));
      wrap.append(s);
    }
  }
  const d = h("details", undefined, "limits");
  d.open = true;
  d.append(h("summary", "분석 범위와 제한사항"));
  const ul = h("ul"); LIMITS.forEach(x => ul.appendChild(h("li", x))); d.append(ul);
  wrap.append(d);
}

/* ---------- 계층도 블록 조작 (이벤트 위임) ----------
   한 번 클릭 = 선택 / 더블클릭·Enter·▸▾ 버튼 = 같은 펼치기·접기 / ⓘ 버튼·i 키 = 상세 정보(탐색 범위는 바뀌지 않음)
   → / ← = 펼치기 / 접기(← 는 이미 접혀 있으면 상위 블록으로 이동) */
(function () {
  const p = $("panelTree");
  const idOf = ev => { const g = ev.target.closest && ev.target.closest("g.node"); return g ? g.getAttribute("data-id") : null; };
  const actOf = ev => { const b = ev.target.closest && ev.target.closest("[data-act]"); return b ? b.getAttribute("data-act") : null; };
  p.addEventListener("click", ev => {
    const id = idOf(ev); if (!id) return;
    const act = actOf(ev);
    if (act === "toggle") toggleNode(id);
    else if (act === "info") { selectNode(id); openDetail(id); }
    else if (act === "ports") togglePorts(id);
    else selectNode(id);
  });
  // 블록 본문 더블클릭 = 펼치기/접기. 버튼 위의 더블클릭은 버튼 클릭이 이미 처리했으므로 무시한다.
  p.addEventListener("dblclick", ev => { const id = idOf(ev); if (id && !actOf(ev)) toggleNode(id); });
  p.addEventListener("keydown", ev => {
    const id = idOf(ev);
    if (!id || ev.target.getAttribute("data-id") !== id) return;
    if (ev.key === "Enter") { ev.preventDefault(); toggleNode(id); }
    else if (ev.key === "ArrowRight") { ev.preventDefault(); expandNode(id); }
    else if (ev.key === "ArrowLeft") {
      ev.preventDefault();
      if (state.expanded.has(id)) collapseNode(id);
      else { const info = state.index.get(id); const g = info && info.parent && nodeElOf(info.parent); if (g) { selectNode(info.parent); g.focus(); } }
    }
    else if (ev.key === " ") { ev.preventDefault(); selectNode(id); }
    else if (ev.key === "i" || ev.key === "I") { ev.preventDefault(); selectNode(id); openDetail(id); }
    else if (ev.key === "p" || ev.key === "P") { ev.preventDefault(); togglePorts(id); }
  });
  $("btnDetailClose").addEventListener("click", closeDetail);
  $("btnDetailFocus").addEventListener("click", () => { if (state.detail) setFocusView(state.detail); });
  $("btnDetailNets").addEventListener("click", () => { if (state.detail) openNets(state.detail); });
$("btnDetailCirc").addEventListener("click", () => { if (state.detail) openCirc(state.detail); });
$("tabCirc").addEventListener("click", () => showTab("circ"));
  $("detail").addEventListener("keydown", ev => { if (ev.key === "Escape") closeDetail(); });
})();

/* ---------- 대화상자 (이름 입력 · 같은 이름 파일 · 제거 확인) ---------- */
function askName(opts) {
  return new Promise(resolve => {
    const d = $("nameDialog"), f = $("nameForm"), inp = $("nameInput"), err = $("nameErr");
    $("nameTitle").textContent = opts.title; $("nameLabel").textContent = opts.label;
    inp.value = opts.initial || ""; err.textContent = "";
    let done = false;
    const finish = v => {
      if (done) return; done = true;
      f.removeEventListener("submit", onSub); $("nameCancel").removeEventListener("click", onCancel); d.removeEventListener("close", onClose);
      if (d.open) d.close();
      resolve(v);
    };
    const onSub = e => { e.preventDefault(); const v = inp.value.trim(); const m = opts.validate(v); if (m) { err.textContent = m; inp.focus(); return; } finish(v); };
    const onCancel = () => finish(null), onClose = () => finish(null);
    f.addEventListener("submit", onSub); $("nameCancel").addEventListener("click", onCancel); d.addEventListener("close", onClose);
    d.showModal(); inp.focus(); inp.select();
  });
}

// pending: planAddFiles 가 돌려준 같은 이름 후보. 반환: {입력 순번: "skip" | "separate"} (취소·Esc = 모두 건너뛰기)
function askDuplicates(pending) {
  return new Promise(resolve => {
    const d = $("dupDialog"), f = $("dupForm"), list = $("dupList");
    list.innerHTML = "";
    pending.forEach(p => {
      const box = h("fieldset", undefined, "dup");
      box.append(h("legend", p.name, "m"));
      box.append(h("div", "이미 목록에 있는 같은 이름: " + p.matches.map(m => m.displayName +
        (m.sameText ? "(내용 동일)" : "(내용 다름)") + (m.sameSize ? "" : " · 크기 다름")).join(", "), "dup-meta"));
      [["skip", "이번 추가 건너뛰기"], ["separate", "별도 소스로 추가"]].forEach(([v, label], i) => {
        const lab = h("label", undefined, "dup-opt");
        const r = h("input"); r.type = "radio"; r.name = "dup-" + p.index; r.value = v; r.checked = i === 0;
        lab.append(r, document.createTextNode(" " + label)); box.append(lab);
      });
      list.append(box);
    });
    let done = false;
    const finish = dec => {
      if (done) return; done = true;
      f.removeEventListener("submit", onSub); $("dupCancel").removeEventListener("click", onCancel); d.removeEventListener("close", onClose);
      if (d.open) d.close();
      resolve(dec);
    };
    const allSkip = () => { const o = {}; pending.forEach(p => { o[p.index] = "skip"; }); return o; };
    const onSub = e => {
      e.preventDefault();
      const o = {};
      pending.forEach(p => { const c = list.querySelector('input[name="dup-' + p.index + '"]:checked'); o[p.index] = c ? c.value : "skip"; });
      finish(o);
    };
    const onCancel = () => finish(allSkip()), onClose = () => finish(allSkip());
    f.addEventListener("submit", onSub); $("dupCancel").addEventListener("click", onCancel); d.addEventListener("close", onClose);
    d.showModal(); $("dupOk").focus();
  });
}

function askConfirm(opts) {
  return new Promise(resolve => {
    const d = $("confirmDialog"), f = d.querySelector("form");
    $("confirmTitle").textContent = opts.title; $("confirmMsg").textContent = opts.msg; $("confirmYes").textContent = opts.yes || "확인";
    let done = false;
    const finish = v => {
      if (done) return; done = true;
      f.removeEventListener("submit", onSub); $("confirmNo").removeEventListener("click", onNo); d.removeEventListener("close", onClose);
      if (d.open) d.close();
      resolve(v);
    };
    const onSub = e => { e.preventDefault(); finish(true); };
    const onNo = () => finish(false), onClose = () => finish(false);
    f.addEventListener("submit", onSub); $("confirmNo").addEventListener("click", onNo); d.addEventListener("close", onClose);
    d.showModal(); $("confirmNo").focus();
  });
}

/* ---------- 분석 목록 · 소스 영역 ---------- */
function makeItem(kind, name) { return {id: "i" + (++itemSeq), kind, name, files: [], activeFileId: null, st: newState()}; }
function uniqueItemName(base) {
  const used = new Set(items.map(x => x.name.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) { const c = base + " (" + n + ")"; if (!used.has(c.toLowerCase())) return c; }
}
function activeFile() { return cur ? cur.files.find(f => f.id === cur.activeFileId) || null : null; }
function setIntake(text, isErr) { const m = $("intakeMsg"); m.textContent = text || ""; m.classList.toggle("err", !!isErr); }

function fileStatusMark(it, f) {
  const sh = it.st.shown, rec = sh && sh.files && sh.files.find(x => x.id === f.id);
  if (!f.include) return "제외";
  if (!rec) return "";
  return rec.status === "error" ? "분석 실패" : rec.status === "excluded" ? "제외" : "";
}

function renderItems() {
  const ul = $("itemList"); ul.innerHTML = "";
  if (!items.length) { ul.appendChild(h("li", "분석 항목이 없습니다. ‘+ 새 분석’으로 시작하세요.", "item-empty")); return; }
  for (const it of items) {
    const li = h("li", undefined, "item" + (it === cur ? " on" : ""));
    li.dataset.id = it.id;
    const row = h("div", undefined, "item-row");
    const b = h("button", undefined, "item-main"); b.type = "button";
    if (it === cur) b.setAttribute("aria-current", "true");
    b.append(h("span", it.name, "item-name"), h("span", it.kind === "design" ? "통합 설계 · 파일 " + it.files.length + "개" : "단일 소스", "item-kind"));
    b.addEventListener("click", () => { if (it !== cur) activate(it); });
    const x = h("button", "×", "item-x"); x.type = "button";
    x.title = "목록에서 제거(원본 파일은 삭제되지 않음)"; x.setAttribute("aria-label", it.name + " 목록에서 제거");
    x.addEventListener("click", () => removeItem(it));
    row.append(b, x); li.append(row);
    if (it === cur && it.kind === "design") {
      const act = h("div", undefined, "item-actions");
      const bf = h("button", "파일 불러오기", "btn btn-primary btn-small"); bf.type = "button"; bf.dataset.act = "load";
      bf.title = "이 설계에 .v/.sv 파일을 추가합니다(여러 개 선택 가능). 파일을 이 항목 위로 끌어 놓아도 됩니다.";
      bf.addEventListener("click", () => openPicker("add", it));
      const bw = h("button", "소스 직접 작성", "btn btn-secondary btn-small"); bw.type = "button"; bw.dataset.act = "write";
      bw.addEventListener("click", () => composeSource(it));
      act.append(bf, bw);
      if (!it.files.length) act.append(h("span", "소스가 없습니다. 파일을 끌어 놓아도 됩니다.", "item-hint"));
      li.append(act);
      const fl = h("ul", undefined, "filelist");
      if (!it.files.length) fl.append(h("li", "파일 없음", "file-empty"));
      for (const f of it.files) {
        const fr = h("li", undefined, "frow" + (f.id === it.activeFileId ? " on" : ""));
        const cb = h("input"); cb.type = "checkbox"; cb.checked = f.include;
        cb.setAttribute("aria-label", f.displayName + " 분석에 포함"); cb.title = "분석에 포함 (끄면 이 파일은 분석에서 제외됩니다)";
        cb.addEventListener("change", () => { f.include = cb.checked; invalidate(it); renderItems(); });
        const fb = h("button", f.displayName, "file-main"); fb.type = "button";
        if (f.id === it.activeFileId) fb.setAttribute("aria-current", "true");
        fb.addEventListener("click", () => { it.activeFileId = f.id; renderSource(); renderItems(); });
        const mark = fileStatusMark(it, f);
        const fx = h("button", "×", "item-x"); fx.type = "button";
        fx.title = "이 파일을 목록에서 제거(원본 파일은 삭제되지 않음)"; fx.setAttribute("aria-label", f.displayName + " 목록에서 제거");
        fx.addEventListener("click", () => removeFile(it, f));
        const rs = h("select", undefined, "role-sel"); rs.setAttribute("aria-label", f.displayName + " 파일 역할");
        rs.title = "이 파일의 역할(분석 결과는 바뀌지 않으며 '테스트벤치' 탭에서 쓰입니다)";
        [["design", "설계"], ["testbench", "테스트벤치"]].forEach(([v, t]) => { const o = h("option", t); o.value = v; rs.append(o); });
        rs.value = f.role === "testbench" ? "testbench" : "design";
        rs.addEventListener("change", () => { f.role = rs.value; renderItems(); if (it === cur && state.tab === "tb") renderTb(); });
        const fr0 = fr; fr0.append(cb, fb, rs);
        if (f.role !== "testbench" && it.st.res && tbFileHint(it.st.res, f.id)) fr0.append(h("span", "테스트벤치로 보임", "file-mark"));
        if (mark) fr.append(h("span", mark, "file-mark"));
        fr.append(fx); fl.append(fr);
      }
      li.append(fl);
    }
    ul.append(li);
  }
}

function sourceNotesFor(f) {
  const notes = (f.readNotes || []).slice();
  const c = checkExtension(f.name);
  if (c.ok && c.note) notes.push(c.note);
  if (/`include\b/.test(dzStripComments(f.text))) notes.push(INCLUDE_NOTE);
  return notes;
}
function renderSrcNotes() {
  const box = $("srcNotes"); box.innerHTML = "";
  const f = activeFile();
  if (!f) return;
  sourceNotesFor(f).forEach(t => box.appendChild(h("div", t, "src-note")));
}

function renderSource() {
  const ta = $("input"), design = !!cur && cur.kind === "design", f = activeFile();
  $("srcName").textContent = !cur ? "" : f ? f.displayName + (design ? "  ·  " + cur.name : "") + "  ·  " + (ORIGIN_LABEL[f.origin] || "") : design ? cur.name + "  ·  파일 없음" : cur.name;
  ta.hidden = !f;
  const em = $("srcEmpty");
  em.hidden = !!f;
  em.textContent = !cur ? "분석 항목이 없습니다. 왼쪽 위 ‘+ 새 분석’에서 단일 소스 또는 통합 설계를 시작하세요."
    : "이 통합 설계에는 아직 소스가 없습니다. 위 목록의 ‘" + cur.name + "’ 아래 [파일 불러오기] [소스 직접 작성] 버튼을 누르거나, 파일을 이 설계 항목 위로 끌어 놓으세요.";
  if (f) ta.value = f.text;
  renderSrcNotes();
}

function renderAll() {
  renderItems();
  renderSource();
  renderPanels();
  setIntake("");
}

function activate(it) {
  cur = it; state = it.st;
  renderAll();
}

async function removeItem(it) {
  const ok = await askConfirm({title: "분석 항목 제거", yes: "제거",
    msg: "‘" + it.name + "’ 항목을 분석 목록에서 제거합니다. 원본 파일은 삭제되거나 수정되지 않습니다. 이 프로그램 안에서 고친 소스 내용과 분석 결과는 사라집니다."});
  if (!ok) return;
  const i = items.indexOf(it);
  if (i < 0) return;
  items.splice(i, 1);
  if (cur === it) { cur = items[Math.min(i, items.length - 1)] || null; state = cur ? cur.st : newState(); }
  renderAll();
}

async function removeFile(it, f) {
  const ok = await askConfirm({title: "파일 제거", yes: "제거",
    msg: "‘" + f.displayName + "’ 파일을 이 통합 설계 목록에서 제거합니다. 원본 파일은 삭제되거나 수정되지 않습니다. 이 프로그램 안에서 고친 내용은 사라지고, 다시 분석해야 합니다."});
  if (!ok) return;
  const i = it.files.indexOf(f);
  if (i < 0) return;
  it.files.splice(i, 1);
  if (it.activeFileId === f.id) it.activeFileId = it.files.length ? it.files[Math.min(i, it.files.length - 1)].id : null;
  invalidate(it);
  if (it === cur) { renderItems(); renderSource(); renderControls(); }
}

/* ---------- 파일 불러오기 · 붙여넣기 ---------- */
let pickMode = null, pickTarget = null;
// mode: "single"(새 단일 항목) | "add"(target 통합 설계에 추가)
function openPicker(mode, target) { pickMode = mode; pickTarget = target || null; const p = $("filePick"); p.multiple = mode === "add"; p.value = ""; p.click(); }

function sizeText(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + "MB" : Math.ceil(n / 1024) + "KB"; }
async function readOne(file) {
  const chk = checkExtension(file.name);
  if (!chk.ok) return {error: chk.reason + " (불러오지 않음)"};
  if (file.size > MAX_READ_BYTES) return {error: "'" + file.name + "': 파일이 너무 큽니다(" + file.size.toLocaleString("ko-KR") + "바이트). " + MAX_READ_BYTES.toLocaleString("ko-KR") + "바이트(2MB) 이하만 불러옵니다."};
  try {
    const text = await file.text();
    const rec = {name: file.name, text, size: file.size, lastModified: file.lastModified, origin: "file", readNotes: []};
    if (text.indexOf("�") >= 0)
      rec.readNotes.push("UTF-8로 읽는 중 해석하지 못한 글자가 있었습니다. 파일이 UTF-8이 아니면(예: CP949) 한글 주석 등이 깨져 보일 수 있습니다. 원본 파일은 바뀌지 않습니다.");
    return rec;
  } catch (e) {
    return {error: "'" + file.name + "': 파일을 읽지 못했습니다(" + (e && e.message ? e.message : "원인을 알 수 없음") + "). 원본 파일은 바뀌지 않았습니다."};
  }
}

async function handleIncoming(list, mode, target) {
  const msgs = [], incoming = [];
  for (const f of list) { const r = await readOne(f); if (r.error) msgs.push(r.error); else incoming.push(r); }
  if (mode === "single") {
    if (!incoming.length) { setIntake(msgs.join(" ") || "불러올 파일이 없습니다.", true); return; }
    const plan = planAddFiles([], [incoming[0]], {});
    if (!plan.added.length) { setIntake(msgs.join(" ") || "불러오지 못했습니다.", true); return; }
    const it = makeItem("single", uniqueItemName(plan.added[0].name));
    it.files = plan.files; it.activeFileId = plan.added[0].id;
    items.push(it); activate(it);
    if (list.length > 1) msgs.push("단일 소스는 파일 하나만 불러옵니다. 첫 번째 파일만 사용했습니다.");
    setIntake(msgs.join(" "), msgs.length > 0);
    return;
  }
  if (!target || target.kind !== "design" || !items.includes(target)) return;
  await addIncoming(target, incoming, msgs);
}

async function addIncoming(it, incoming, msgs) {
  let plan = planAddFiles(it.files, incoming, {});
  if (plan.pending.length) plan = planAddFiles(it.files, incoming, await askDuplicates(plan.pending));
  const out = msgs.slice();
  plan.rejected.forEach(r => out.push(r.reason + " (불러오지 않음)"));
  if (plan.added.length) {
    it.files = plan.files; it.activeFileId = plan.added[plan.added.length - 1].id;
    invalidate(it);
  }
  const parts = [];
  if (plan.added.length) parts.push(plan.added.length + "개 파일을 추가했습니다(" + plan.added.map(f => f.displayName).join(", ") + ").");
  if (plan.skipped.length) parts.push("같은 이름 " + plan.skipped.length + "개는 이번 추가를 건너뛰었습니다.");
  const text = parts.concat(out).join(" ") || "추가된 파일이 없습니다.";
  if (it === cur) { renderItems(); renderSource(); renderControls(); setIntake(text, out.length > 0 && !plan.added.length); }
  else renderItems();
}

// 통합 설계에 "소스 직접 작성"으로 소스 추가: 파일명 + 코드. 취소하면 아무것도 바꾸지 않는다. 디스크에는 쓰지 않는다.
function composeSource(it) {
  if (!it || it.kind !== "design") return Promise.resolve();
  return new Promise(resolve => {
    const d = $("composeDialog"), f = $("composeForm"), nm = $("composeName"), code = $("composeCode"), err = $("composeErr");
    $("composeTarget").textContent = "추가할 통합 설계: " + it.name;
    nm.value = ""; code.value = ""; err.textContent = "";
    let done = false;
    const finish = async res => {
      if (done) return; done = true;
      f.removeEventListener("submit", onSub); $("composeCancel").removeEventListener("click", onCancel); d.removeEventListener("close", onClose);
      if (d.open) d.close();
      if (res && items.includes(it)) {
        if (it !== cur) activate(it);
        await addIncoming(it, [{name: res.name, text: res.text, size: res.text.length, origin: "paste"}], []);
        if (it === cur && !$("input").hidden) $("input").focus();
      }
      resolve();
    };
    const onSub = e => {
      e.preventDefault();
      const name = nm.value.trim();
      if (!name) { err.textContent = "파일명을 입력하세요."; nm.focus(); return; }
      const c = checkExtension(name);
      if (!c.ok) { err.textContent = c.reason; nm.focus(); return; }
      if (!code.value.trim()) { err.textContent = "코드를 입력하세요."; code.focus(); return; }
      finish({name, text: code.value});
    };
    const onCancel = () => finish(null), onClose = () => finish(null);
    f.addEventListener("submit", onSub); $("composeCancel").addEventListener("click", onCancel); d.addEventListener("close", onClose);
    d.showModal(); nm.focus();
  });
}
async function createDesign() {
  const name = await askName({title: "통합 설계 만들기", label: "설계 이름", initial: uniqueItemName("설계"),
    validate: v => !v ? "이름을 입력하세요." : v.length > 40 ? "40자 이하로 입력하세요." :
      items.some(x => x.name.toLowerCase() === v.toLowerCase()) ? "같은 이름의 항목이 이미 있습니다." : ""});
  if (!name) return;
  const it = makeItem("design", name);
  items.push(it); activate(it);
  setIntake("통합 설계를 만들었습니다. 항목 아래 [파일 불러오기] [소스 직접 작성] 버튼, 우클릭 메뉴, 파일 끌어 놓기로 소스를 넣으세요.");
}

function createPasteItem() {
  const it = makeItem("single", uniqueItemName("직접 입력"));
  const plan = planAddFiles([], [{name: "pasted-" + (++pasteSeq) + ".v", text: "", size: 0, origin: "paste"}], {});
  it.files = plan.files; it.activeFileId = plan.added[0].id;
  items.push(it); activate(it);
  $("input").focus();
}

/* ---------- 이벤트 연결 ---------- */
const menu = $("newMenu"), btnNew = $("btnNew");
function closeMenu(focusBtn) { menu.hidden = true; btnNew.setAttribute("aria-expanded", "false"); if (focusBtn) btnNew.focus(); }
btnNew.addEventListener("click", ev => {
  const open = menu.hidden;
  menu.hidden = !open; btnNew.setAttribute("aria-expanded", String(open));
  if (open) $("miSingleFile").focus();
  ev.stopPropagation();
});
document.addEventListener("click", ev => { if (!menu.hidden && !menu.contains(ev.target)) closeMenu(false); });
menu.addEventListener("keydown", ev => { if (ev.key === "Escape") closeMenu(true); });
$("miSingleFile").addEventListener("click", () => { closeMenu(false); openPicker("single"); });
$("miSinglePaste").addEventListener("click", () => { closeMenu(false); createPasteItem(); });
$("miDesign").addEventListener("click", () => { closeMenu(false); createDesign(); });

/* ---------- 통합 설계 우클릭 메뉴 (대상 = 우클릭한 설계) ---------- */
const ctx = $("ctxMenu");
let ctxTarget = null;
function closeCtx() { ctx.hidden = true; ctxTarget = null; }
function openCtx(it, x, y) {
  ctxTarget = it; ctx.hidden = false;
  ctx.style.left = Math.max(4, Math.min(x, innerWidth - ctx.offsetWidth - 4)) + "px";
  ctx.style.top = Math.max(4, Math.min(y, innerHeight - ctx.offsetHeight - 4)) + "px";
  $("cmFile").focus();
}
const itemOf = ev => { const li = ev.target.closest && ev.target.closest("li.item[data-id]"); return li ? {li, it: items.find(x => x.id === li.dataset.id)} : null; };
$("itemList").addEventListener("contextmenu", ev => {
  const o = itemOf(ev);
  if (!o || !o.it || o.it.kind !== "design") return;
  ev.preventDefault();
  let x = ev.clientX, y = ev.clientY;
  if (!x && !y) { const r = o.li.getBoundingClientRect(); x = r.left + 24; y = r.top + 24; }   // 키보드(Shift+F10)로 연 경우
  if (o.it !== cur) activate(o.it);
  openCtx(o.it, x, y);
});
// 목록이 다시 그려져 ev.target 이 떨어져 나가도 판단이 틀리지 않게 이벤트 경로를 쓴다
document.addEventListener("contextmenu", ev => { if (!ev.composedPath().some(n => n.id === "itemList")) closeCtx(); });
document.addEventListener("click", ev => { if (!ctx.hidden && !ctx.contains(ev.target)) closeCtx(); });
ctx.addEventListener("keydown", ev => { if (ev.key === "Escape") closeCtx(); });
$("cmFile").addEventListener("click", () => { const t = ctxTarget; closeCtx(); if (t) openPicker("add", t); });
$("cmWrite").addEventListener("click", () => { const t = ctxTarget; closeCtx(); if (t) composeSource(t); });

/* ---------- OS 탐색기에서 끌어온 파일 놓기 (통합 설계 항목 위에만 추가, 앱 내부 항목 이동은 지원 안 함) ---------- */
const hasFiles = ev => !!ev.dataTransfer && [...ev.dataTransfer.types].includes("Files");
const listEl = $("itemList");
let dropLi = null, hintShown = false;
function setDrop(li) { if (dropLi === li) return; if (dropLi) dropLi.classList.remove("drop"); dropLi = li; if (li) li.classList.add("drop"); }
listEl.addEventListener("dragover", ev => {
  if (!hasFiles(ev)) return;
  ev.preventDefault();
  const o = itemOf(ev);
  hintShown = true;
  if (o && o.it && o.it.kind === "design") { ev.dataTransfer.dropEffect = "copy"; setDrop(o.li); setIntake("놓으면 ‘" + o.it.name + "’에 추가됩니다."); }
  else { ev.dataTransfer.dropEffect = "none"; setDrop(null); setIntake("통합 설계 항목 위에 놓아 주세요.", true); }
});
listEl.addEventListener("dragleave", ev => { if (!listEl.contains(ev.relatedTarget)) { setDrop(null); if (hintShown) { hintShown = false; setIntake(""); } } });
listEl.addEventListener("drop", ev => {
  if (!hasFiles(ev)) return;
  ev.preventDefault();
  hintShown = false;
  const o = itemOf(ev), files = [...ev.dataTransfer.files];
  setDrop(null);
  if (!o || !o.it || o.it.kind !== "design") { setIntake("파일은 통합 설계 항목 위에 놓아 주세요. 단일 소스에는 파일을 놓을 수 없습니다.", true); return; }
  if (!files.length) { setIntake("놓은 항목에서 파일을 찾지 못했습니다.", true); return; }
  if (o.it !== cur) activate(o.it);
  handleIncoming(files, "add", o.it);
});
// 목록 밖에 놓아도 창이 파일로 이동(열기)하지 않게 막는다
["dragover", "drop"].forEach(type => document.addEventListener(type, ev => {
  if (!hasFiles(ev)) return;
  const handled = ev.defaultPrevented;   // 목록의 핸들러가 이미 처리함
  ev.preventDefault();
  if (type === "drop" && !handled) { hintShown = false; setDrop(null); setIntake("파일은 왼쪽 목록의 통합 설계 항목 위에 놓아 주세요.", true); }
}));
$("filePick").addEventListener("change", async ev => {
  const list = [...ev.target.files], mode = pickMode, target = pickTarget;
  ev.target.value = ""; pickMode = null; pickTarget = null;
  if (list.length && mode) await handleIncoming(list, mode, target);
});

/* ---------- 지원 문법 안내 대화상자 (Esc·닫기 버튼·바깥 클릭으로 닫힘) ---------- */
const dlg = $("helpDialog");
$("btnHelp").addEventListener("click", () => dlg.showModal());
$("btnHelpClose").addEventListener("click", () => dlg.close());
dlg.addEventListener("click", e => { if (e.target === dlg) dlg.close(); });

$("btnAnalyze").addEventListener("click", doAnalyze);
$("btnShow").addEventListener("click", doShow);
$("btnCopyMd").addEventListener("click", copyMarkdown);
$("topSel").addEventListener("change", () => { state.top = $("topSel").value; });
$("tabTree").addEventListener("click", () => showTab("tree"));
$("tabResult").addEventListener("click", () => showTab("result"));
$("tabNets").addEventListener("click", () => showTab("nets"));
$("tabTb").addEventListener("click", () => showTab("tb"));
$("input").addEventListener("input", () => {
  const f = activeFile();
  if (!f) return;
  f.text = $("input").value;     // 이 프로그램 안의 사본만 바뀐다(원본 파일은 수정하지 않음)
  renderSrcNotes();
  invalidate(cur);
});

// 처음에는 샘플 코드 하나를 단일 소스 항목으로 둔다
(function () {
  const it = makeItem("single", "샘플");
  const plan = planAddFiles([], [{name: "sample.v", text: SAMPLE, size: SAMPLE.length, origin: "paste"}], {});
  it.files = plan.files; it.activeFileId = plan.added[0].id;
  items.push(it); activate(it);
})();
