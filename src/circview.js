// 회로 탭: Yosys 변환 결과를 RTL 회로(기호) / 게이트 수준(범용 게이트)으로 표시한다.
// 원본 계층도와 구분되는 별도 보기이며, 변환 결과에 있는 셀과 연결만 그린다(추측 연결 없음).
const CV_NS = "http://www.w3.org/2000/svg";
function cvEl(tag, attrs, text) {
  const e = document.createElementNS(CV_NS, tag);
  if (attrs) for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
  if (text != null) e.textContent = text;
  return e;
}
function cvH(tag, text, cls) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function cvSig(files) { let h = 0, n = 0; for (const f of files) { n += f.text.length; for (let i = 0; i < f.text.length; i += 7) h = (h * 31 + f.text.charCodeAt(i)) | 0; } return n + ":" + h; }

// 대상 모듈이 의존하는 파일만 변환에 넣는다(다른 파일의 문법 문제가 섞이지 않게 함).
function cvFilesFor(modMap, files, target) {
  const seen = new Set(), ids = new Set(), st = [target];
  while (st.length) {
    const n = st.pop(); if (seen.has(n)) continue; seen.add(n);
    const m = modMap.get(n); if (!m) continue;
    ids.add(m.fileId); for (const i of m.instances) st.push(i.module);
  }
  return files.filter(f => ids.has(f.id)).map(f => ({id: f.id, name: f.name, displayName: f.displayName || f.name, text: f.text}));
}

const CV_AND = new Set(["$and", "$logic_and", "$reduce_and", "$_AND_", "$_NAND_", "$_ANDNOT_"]);
const CV_OR = new Set(["$or", "$logic_or", "$reduce_or", "$reduce_bool", "$_OR_", "$_NOR_", "$_ORNOT_"]);
const CV_XOR = new Set(["$xor", "$xnor", "$reduce_xor", "$reduce_xnor", "$_XOR_", "$_XNOR_"]);
const CV_NOT = new Set(["$not", "$logic_not", "$_NOT_", "$_BUF_"]);
const CV_BUBBLE = new Set(["$xnor", "$reduce_xnor", "$_NAND_", "$_NOR_", "$_XNOR_", "$not", "$logic_not", "$_NOT_"]);

function cvShape(n) {
  const x = n.x, y = n.y, w = n.w, h = n.bodyH, g = cvEl("g"), type = n.cell ? n.cell.type : "";
  const st = {class: "cv-sym cv-k-" + n.kind};
  if (n.kind === "pin-in") g.append(cvEl("path", Object.assign({d: `M${x},${y} H${x + w - 10} L${x + w},${y + h / 2} L${x + w - 10},${y + h} H${x} Z`}, st)));
  else if (n.kind === "pin-out") g.append(cvEl("path", Object.assign({d: `M${x + 10},${y} H${x + w} V${y + h} H${x + 10} L${x},${y + h / 2} Z`}, st)));
  else if (n.kind === "mux" || n.kind === "gmux" || n.kind === "pmux") g.append(cvEl("path", Object.assign({d: `M${x},${y} L${x + w},${y + h * 0.16} V${y + h * 0.84} L${x},${y + h} Z`}, st)));
  else if (n.kind === "arith" || n.kind === "cmp" || n.kind === "shift") g.append(cvEl("rect", Object.assign({x, y, width: w, height: h, rx: 16}, st)));
  else if (n.kind === "logic" || n.kind === "gate") {
    const bw = CV_BUBBLE.has(type) ? 6 : 0, bx = x + w - bw * 2;
    if (CV_AND.has(type)) g.append(cvEl("path", Object.assign({d: `M${x},${y} H${x + (w - bw * 2) / 2} A${(w - bw * 2) / 2},${h / 2} 0 0 1 ${x + (w - bw * 2) / 2},${y + h} H${x} Z`}, st)));
    else if (CV_OR.has(type) || CV_XOR.has(type)) {
      const e = x + w - bw * 2;
      g.append(cvEl("path", Object.assign({d: `M${x},${y} Q${x + (e - x) * 0.6},${y} ${e},${y + h / 2} Q${x + (e - x) * 0.6},${y + h} ${x},${y + h} Q${x + (e - x) * 0.3},${y + h / 2} ${x},${y} Z`}, st)));
      if (CV_XOR.has(type)) g.append(cvEl("path", {d: `M${x - 5},${y} Q${x + (e - x) * 0.25},${y + h / 2} ${x - 5},${y + h}`, class: "cv-line"}));
    } else if (CV_NOT.has(type)) g.append(cvEl("path", Object.assign({d: `M${x},${y} L${x + w - bw * 2},${y + h / 2} L${x},${y + h} Z`}, st)));
    else g.append(cvEl("rect", Object.assign({x, y, width: w, height: h, rx: 4}, st)));
    if (bw) g.append(cvEl("circle", {cx: bx + bw, cy: y + h / 2, r: bw, class: "cv-sym cv-bubble"}));
  } else if (n.kind === "reg" || n.kind === "latch" || n.kind === "gff") {
    g.append(cvEl("rect", Object.assign({x, y, width: w, height: n.bits ? n.h : h, rx: 3}, st)));
    const clk = n.left.find(p => /^(CLK|C)$/.test(p.name));
    if (clk) g.append(cvEl("path", {d: `M${x},${clk.y - 5} L${x + 7},${clk.y} L${x},${clk.y + 5}`, class: "cv-line"}));
  } else if (n.kind === "sub") g.append(cvEl("rect", Object.assign({x, y, width: w, height: h, rx: 3}, st)), cvEl("rect", {x: x + 3, y: y + 3, width: w - 6, height: h - 6, rx: 2, class: "cv-inner"}));
  else g.append(cvEl("rect", Object.assign({x, y, width: w, height: h, rx: 3, "stroke-dasharray": "4 3"}, st)));
  return g;
}
function cvWidthText(c) {
  if (!c) return "";
  if (c.reg) return "[" + (c.reg.width - 1) + ":0]";
  const q = c.pins.find(p => p.dir === "output"); return q && q.bits.length > 1 ? "[" + (q.bits.length - 1) + ":0]" : "";
}
function cvNodeTitle(n) {
  if (!n.cell) return n.label;
  const c = n.cell, lines = [c.label + " (" + c.type + ")"];
  if (c.reg) lines.push("저장 소자(Yosys 셀) · " + c.reg.width + "비트" + (c.reg.name ? " · 신호 " + c.reg.name : ""));
  lines.push(c.src ? "원본: " + c.src.file + ":" + c.src.line : "원본 소스 대응: 확인 불가(Yosys 결과에 위치 정보 없음)");
  return lines.join("\n");
}

function cvDrawNode(svg, n, ctx) {
  const g = cvEl("g", {class: "cv-node" + (ctx.st.selected === n.key ? " sel" : ""), "data-key": n.key, tabindex: "0", role: "button", "aria-label": cvNodeTitle(n).replace(/\n/g, ", ")});
  g.append(cvEl("title", null, cvNodeTitle(n)));
  g.append(cvShape(n));
  const c = n.cell, cx = n.x + n.w / 2, cy = n.y + n.bodyH / 2;
  if (n.kind === "pin-in" || n.kind === "pin-out") g.append(cvEl("text", {x: n.kind === "pin-in" ? n.x + 6 : n.x + 14, y: cy + 4, class: "cv-port"}, n.label));
  else if (n.kind === "reg" || n.kind === "latch" || n.kind === "gff") {
    g.append(cvEl("text", {x: cx, y: n.y + 15, "text-anchor": "middle", class: "cv-lbl"}, c.kind === "gff" ? c.label : (c.kind === "latch" ? "LATCH" : "REG")));
    const nm = c.reg ? (c.reg.name ? c.reg.name : "(이름 미확인)") + cvWidthText(c) : "";
    if (nm) g.append(cvEl("text", {x: cx, y: n.y + 28, "text-anchor": "middle", class: "cv-sub"}, nm.length > 16 ? nm.slice(0, 15) + "…" : nm));
  } else if (n.kind === "sub") {
    g.append(cvEl("text", {x: cx, y: n.y + 16, "text-anchor": "middle", class: "cv-lbl"}, c.type), cvEl("text", {x: cx, y: n.y + 29, "text-anchor": "middle", class: "cv-sub"}, "하위 모듈 " + (c.hidden ? "" : c.id)));
  } else if (n.kind === "other") {
    g.append(cvEl("text", {x: cx, y: n.y + 16, "text-anchor": "middle", class: "cv-lbl"}, c.type), cvEl("text", {x: cx, y: n.y + 29, "text-anchor": "middle", class: "cv-sub"}, "미지원 셀(기호 없음)"));
  } else {
    const wt = cvWidthText(c);
    const big = n.kind === "mux" || n.kind === "gmux" || n.kind === "pmux" ? "MUX" : (n.kind === "logic" || n.kind === "gate") ? "" : c.label;
    if (big) g.append(cvEl("text", {x: cx, y: cy + 4, "text-anchor": "middle", class: "cv-lbl"}, big));
    if (n.kind === "logic" || n.kind === "gate") g.append(cvEl("text", {x: cx - (CV_BUBBLE.has(c.type) ? 3 : 0), y: n.y + n.bodyH + 11, "text-anchor": "middle", class: "cv-sub"}, c.label + (wt ? " " + wt : "")));
    else if (wt) g.append(cvEl("text", {x: cx, y: n.y + n.bodyH + 11, "text-anchor": "middle", class: "cv-sub"}, wt));
  }
  // 핀
  for (const p of n.left.concat(n.right, n.bottom)) {
    if (n.kind === "pin-in" || n.kind === "pin-out") { g.append(cvEl("circle", {cx: p.x, cy: p.y, r: 2.2, class: "cv-pin"})); continue; }
    g.append(cvEl("circle", {cx: p.x, cy: p.y, r: 2.2, class: "cv-pin"}));
    if (n.kind === "mux" || n.kind === "gmux" || n.kind === "pmux" || n.kind === "logic" || n.kind === "gate" || n.kind === "arith" || n.kind === "cmp" || n.kind === "shift") {
      if (p.side === "B") g.append(cvEl("text", {x: p.x, y: p.y - 3, "text-anchor": "middle", class: "cv-pn"}, p.name));
      else if (n.kind !== "logic" && n.kind !== "gate") g.append(cvEl("text", {x: p.side === "L" ? p.x + 4 : p.x - 4, y: p.y + 3, "text-anchor": p.side === "L" ? "start" : "end", class: "cv-pn"}, p.name));
    } else g.append(cvEl("text", {x: p.side === "L" ? p.x + 8 : p.side === "R" ? p.x - 4 : p.x, y: p.side === "B" ? p.y - 3 : p.y + 3, "text-anchor": p.side === "L" ? "start" : p.side === "R" ? "end" : "middle", class: "cv-pn"}, p.name));
    (p.consts || []).forEach(s => g.append(cvEl("text", {x: p.x - 4, y: p.y - 3 - ((p.consts.indexOf(s)) * 10), "text-anchor": "end", class: "cv-const"}, s.text.length > 22 ? s.text.slice(0, 21) + "…" : s.text)));
    if ((p.open || []).length) { const t = cvEl("text", {x: p.x - 5, y: p.y + 3, "text-anchor": "end", class: "cv-open"}, "×"); t.append(cvEl("title", null, "구동원을 확인할 수 없는 연결(연결 없음 또는 변환 결과에 구동 셀 없음)")); g.append(t); }
  }
  // 레지스터 비트 펼침
  if (c && c.reg && c.reg.width > 1) {
    const open = !!n.bits, b = cvEl("g", {class: "cv-btn", "data-act": "bits", "data-key": n.key, tabindex: "0", role: "button", "aria-expanded": String(open), "aria-label": open ? "비트 접기" : "비트 펼치기"});
    b.append(cvEl("rect", {x: n.x + 4, y: n.y + n.bodyH - 17, width: 62, height: 14, rx: 3, class: "cv-btnbox"}), cvEl("text", {x: n.x + 35, y: n.y + n.bodyH - 7, "text-anchor": "middle", class: "cv-btntxt"}, (open ? "▾ 비트 접기" : "▸ " + c.reg.width + "비트 보기")));
    g.append(b);
    if (open) {
      const cw = CV_BITW, rowsN = n.bits.rows; let k = 0;
      g.append(cvEl("text", {x: n.x + 8, y: n.y + n.bodyH + 14, class: "cv-sub"}, "비트 값: " + (ctx.bitNote || "값 데이터 없음(미제공)")));
      for (let r = 0; r < rowsN; r++) {
        const count = Math.min(CV_ROW, c.reg.width - r * CV_ROW), x0 = n.x + 8;
        for (let i = 0; i < count; i++) {
          const bit = c.reg.width - 1 - (r * CV_ROW + i);   // 위쪽 칸이 상위 비트
          const idx = c.reg.bitIdx[bit], v = ctx.bitValue ? ctx.bitValue(c, bit) : undefined;
          const cx0 = x0 + i * cw, cy0 = n.y + n.bits.y0 + r * 24;
          const cell = cvEl("g", {class: "cv-bit" + (v === "x" || v === "z" ? " cv-bitx" : v === "1" ? " cv-bit1" : "")});
          cell.append(cvEl("title", null, (idx != null ? "비트 " + idx : "비트 (이름 기준 인덱스 미확인, 위치 " + bit + ")") + " · " + (v == null ? "값 미제공" : "값 " + v)));
          cell.append(cvEl("rect", {x: cx0, y: cy0, width: cw - 2, height: 20, rx: 2}), cvEl("text", {x: cx0 + (cw - 2) / 2, y: cy0 + 8, "text-anchor": "middle", class: "cv-bi"}, idx != null ? String(idx) : "?"), cvEl("text", {x: cx0 + (cw - 2) / 2, y: cy0 + 17, "text-anchor": "middle", class: "cv-bv"}, v == null ? "·" : v));
          g.append(cell); k++;
        }
      }
    }
  }
  svg.append(g);
}
const CV_BITW = 19, CV_ROW = 32;

function cvDrawEdge(svg, e, sel) {
  const d = "M" + e.pts.map(p => p[0] + "," + p[1]).join(" L");
  const on = sel && (e.fromNode === sel || e.toNode === sel);
  const p = cvEl("path", {d, class: "cv-wire" + (e.width > 1 ? " bus" : "") + (e.back ? " back" : "") + (on ? " on" : ""), "data-from": e.fromNode, "data-to": e.toNode});
  const nm = nlSliceName(window.__cvModel, e.bits);
  p.append(cvEl("title", null, (e.width > 1 ? e.width + "비트 버스" : "1비트") + (nm ? " · 신호 " + nm : " · 이름 있는 신호 미확인") + (e.back ? " · 되먹임(뒤로 가는 연결)" : "")));
  svg.append(p);
  if (e.width > 1) {
    const mid = e.pts[Math.min(1, e.pts.length - 1)], x = (e.pts[0][0] + mid[0]) / 2 + 2;
    svg.append(cvEl("text", {x: e.pts[0][0] + 4, y: e.pts[0][1] - 3, class: "cv-wl"}, String(e.width)));
  }
}

function cvDraw(box, model, ctx) {
  const L = clLayout(model, {expanded: ctx.st.expanded});
  window.__cvModel = model;
  const sc = ctx.st.scale || 1;
  const svg = cvEl("svg", {width: Math.round(L.width * sc), height: Math.round(L.height * sc), viewBox: "0 0 " + L.width + " " + L.height, class: "cv-svg", role: "group", "aria-label": "변환된 회로"});
  L.edges.forEach(e => cvDrawEdge(svg, e, ctx.st.selected));
  L.nodes.forEach(n => cvDrawNode(svg, n, ctx));
  box.innerHTML = ""; box.append(svg);
  return L;
}

// 선택한 요소의 설명(변환 결과 기준, 파라미터·원본 위치·대응 여부)
function cvDetail(box, model, key, ctx) {
  box.innerHTML = ""; if (!key) { box.append(cvH("div", "요소를 누르면 변환 결과의 정보와 원본 소스 대응이 여기에 표시됩니다.", "empty")); return; }
  const n = key.startsWith("cell:") ? model.cells.find(c => "cell:" + c.id === key) : null;
  if (!n) { box.append(cvH("div", key.replace(/^port(-out)?:/, "포트 "), "kv-v m")); return; }
  const rows = [["셀 종류", n.label + " (" + n.type + ")"], ["Yosys 셀 이름", n.hidden ? "(자동 생성) " + n.id : n.id]];
  if (n.reg) rows.push(["저장 소자", n.reg.width + "비트" + (n.reg.name ? " · 신호 " + n.reg.name : " · 이름 있는 신호와 일치하지 않음")]);
  Object.entries(n.params).filter(([k]) => /WIDTH|POLARITY|VALUE|SIGNED/.test(k)).forEach(([k, v]) => rows.push([k, typeof v === "string" && v.length > 20 ? v.slice(-12) + "…" : String(v)]));
  rows.push(["원본 위치", n.src ? n.src.file + " · " + n.src.line + (n.src.endLine && n.src.endLine !== n.src.line ? "~" + n.src.endLine : "") + "줄" : "확인 불가 — Yosys 결과에 위치 정보가 없습니다(원본과 연결하지 않음)"]);
  const t = cvH("div", null, "cv-detail");
  rows.forEach(([k, v]) => { const r = cvH("div", null, "nt-line"); r.append(cvH("span", k, "kv-k"), cvH("span", v, "m nt-v")); t.append(r); });
  box.append(t);
  if (n.kind === "sub" && ctx.hasModule && ctx.hasModule(n.type)) { const b = cvH("button", "이 하위 모듈의 회로 보기: " + n.type, "btn btn-secondary btn-small"); b.type = "button"; b.addEventListener("click", () => ctx.setTarget(n.type)); box.append(b); }
}

const CV_NOTES = {
  rtl: "Yosys가 소스를 읽어 만든 RTL 수준 회로(곱셈·가산·MUX·레지스터 등 셀 단위)입니다. 원본 코드와 1:1 대응이 아니며, 최적화로 구조가 바뀔 수 있습니다. 원본 위치(src)가 없는 셀은 대응을 확인할 수 없다고 표시합니다.",
  gate: "RTL 회로를 Yosys가 범용 게이트(AND/OR/XOR/MUX 등)와 1비트 플립플롭으로 풀어 쓴 결과입니다. 특정 셀 라이브러리에 매핑하지 않았으므로 실제 칩·FPGA의 물리 구현 결과가 아닙니다."
};

// box: 탭 패널, ctx: {target, modMap, files, st, onBack, setTarget, bitValue?, bitNote?}
function cvRender(box, ctx) {
  box.innerHTML = "";
  const wrap = cvH("div", null, "pad cv-wrap"); box.append(wrap);
  const st = ctx.st; st.expanded = st.expanded || new Set(); st.mode = st.mode || "rtl"; st.scale = st.scale || 1; st.cache = st.cache || new Map();
  const bar = cvH("div", null, "nets-target"); const l1 = cvH("div", null, "nt-line");
  l1.append(cvH("span", "대상 모듈", "kv-k"), cvH("span", ctx.target, "m nt-v")); bar.append(l1);
  const back = cvH("button", "계층도로 돌아가기", "btn btn-secondary btn-small"); back.type = "button"; back.addEventListener("click", () => ctx.onBack()); bar.append(back);
  wrap.append(bar);
  const modes = cvH("div", null, "nets-modes"); modes.setAttribute("role", "group"); modes.setAttribute("aria-label", "회로 보기 수준");
  [["rtl", "RTL 회로"], ["gate", "게이트 수준"]].forEach(([k, label]) => { const b = cvH("button", label, "btn btn-small " + (st.mode === k ? "btn-primary" : "btn-secondary")); b.type = "button"; b.setAttribute("aria-pressed", String(st.mode === k)); b.addEventListener("click", () => { if (st.mode !== k) { st.mode = k; st.selected = null; st.expanded = new Set(); cvRender(box, ctx); } }); modes.append(b); });
  wrap.append(modes);
  const info = cvH("div", null, "cv-info"); wrap.append(info);
  const msg = cvH("div", null, "cv-msg"); wrap.append(msg);
  const view = cvH("div", null, "cv-view"); view.tabIndex = 0; view.setAttribute("aria-label", "회로 그림(가로·세로 스크롤)"); wrap.append(view);
  const det = cvH("div", null, "cv-det"); wrap.append(det);
  const notes = cvH("details", null, "limits"); notes.append(cvH("summary", "이 화면의 한계"));
  ["Yosys가 만든 결과를 그대로 그립니다. 원본 소스와 1:1 대응이 아니며, 대응을 확인할 수 없는 셀은 소스와 연결하지 않습니다.",
   "하위 모듈은 블록으로만 표시합니다(내부 회로는 그 모듈을 대상으로 다시 보세요).",
   "지원하지 않는 문법이나 변환 실패는 이유를 위에 표시하고 회로를 만들지 않습니다.",
   "비트 값은 값 데이터(VCD 등)와 대응이 확인된 경우에만 표시하고, 없으면 임의로 0을 채우지 않습니다."].forEach(s => notes.append(cvH("div", s, "kv-note")));
  wrap.append(notes);

  const rerender = () => { if (st.model) { cvDraw(view, st.model, ctx2); cvDetail(det, st.model, st.selected, ctx2); } };
  const ctx2 = Object.assign({}, ctx, {st, setTarget: ctx.setTarget});
  view.addEventListener("click", ev => {
    const bt = ev.target.closest && ev.target.closest("[data-act=bits]");
    if (bt) { const k = bt.getAttribute("data-key").slice(5); st.expanded.has(k) ? st.expanded.delete(k) : st.expanded.add(k); rerender(); return; }
    const nd = ev.target.closest && ev.target.closest(".cv-node"); st.selected = nd ? nd.getAttribute("data-key") : null; rerender();
  });
  view.addEventListener("keydown", ev => {
    const nd = ev.target.closest && ev.target.closest(".cv-node, .cv-btn"); if (!nd || (ev.key !== "Enter" && ev.key !== " ")) return; ev.preventDefault(); nd.dispatchEvent(new MouseEvent("click", {bubbles: true}));
  });
  const zoom = cvH("div", null, "cv-zoom"); [["−", -0.15], ["100%", 0], ["+", 0.15]].forEach(([t, d]) => { const b = cvH("button", t, "btn btn-secondary btn-small"); b.type = "button"; b.setAttribute("aria-label", d < 0 ? "축소" : d > 0 ? "확대" : "배율 100%"); b.addEventListener("click", () => { st.scale = d === 0 ? 1 : Math.max(0.4, Math.min(2.5, Math.round((st.scale + d) * 100) / 100)); rerender(); }); zoom.append(b); });
  wrap.insertBefore(zoom, view);

  // 변환 요청
  const files = cvFilesFor(ctx.modMap, ctx.files, ctx.target);
  if (!ctx.modMap.has(ctx.target)) { msg.append(cvH("div", "이 모듈은 분석에 포함된 소스에 정의가 없어 회로를 만들 수 없습니다. 추측하지 않습니다.", "notice warn")); return; }
  if (!files.length) { msg.append(cvH("div", "변환할 소스 파일을 찾지 못했습니다.", "notice warn")); return; }
  if (!window.gateYosys) { msg.append(cvH("div", "이 실행 환경에서는 Yosys 변환을 쓸 수 없습니다(앱 안에서만 동작).", "notice warn")); return; }
  const key = ctx.target + "|" + st.mode + "|" + cvSig(files), cached = st.cache.get(key);
  const show = res => {
    st.last = res; info.innerHTML = "";
    const l = (k, v) => { const r = cvH("div", null, "nt-line"); r.append(cvH("span", k, "kv-k"), cvH("span", v, "m nt-v")); info.append(r); };
    l("변환 도구", res.version || "Yosys(버전 확인 불가)"); l("변환 단계", (res.stages || []).join(" → "));
    info.append(cvH("div", CV_NOTES[st.mode], "kv-note"));
    if (!res.ok) {
      msg.innerHTML = ""; const w = cvH("div", null, "notice warn"); w.append(cvH("strong", "변환 실패"), cvH("div", res.error || "알 수 없는 오류"));
      if (res.log) { const d = cvH("details"); d.append(cvH("summary", "Yosys 로그(일부)"), cvH("pre", res.log.slice(-3000), "cv-log")); w.append(d); }
      msg.append(w); st.model = null; return;
    }
    const model = nlModel(res.json, ctx.target);
    if (model.error) { msg.innerHTML = ""; msg.append(cvH("div", model.error, "notice warn")); return; }
    st.model = model; msg.innerHTML = "";
    const unknown = model.cells.filter(c => c.kind === "other");
    if (unknown.length) msg.append(cvH("div", "기호를 지원하지 않는 셀 " + unknown.length + "개는 점선 블록으로 표시합니다: " + [...new Set(unknown.map(c => c.type))].join(", "), "notice"));
    if (!model.cells.length) msg.append(cvH("div", "변환 결과에 셀이 없습니다(포트 연결만 있는 모듈일 수 있습니다).", "notice"));
    rerender();
  };
  if (cached) { show(cached); return; }
  msg.append(cvH("div", "Yosys로 변환하는 중…", "notice")); st.model = null;
  const myToken = (st.token = (st.token || 0) + 1);
  window.gateYosys.convert({files: files.map(f => ({name: f.name, text: f.text})), top: ctx.target, mode: st.mode}).then(res => {
    if (st.token !== myToken) return; st.cache.set(key, res); show(res);
  }).catch(e => { if (st.token !== myToken) return; show({ok: false, error: "변환 요청 실패: " + (e && e.message), stages: []}); });
}
