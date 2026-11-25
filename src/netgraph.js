// 신호 연결 그래프: 모델(순수 함수) + SVG 그리기 + 방향 안내 애니메이션.
// 모델과 배치는 DOM 에 의존하지 않아 Node(test/check.js)에서도 검사한다. SVG·애니메이션은 브라우저(Electron)에서만 쓴다.
//
// 그래프는 buildNets() 결과(대상 모듈의 경계 포트 ↔ 직접 하위 인스턴스 포트, 단일 신호명 연결)만 그린다.
//  - 선 = 분석된 '신호명 연결' 하나. 계층도의 포함 관계 선과는 별개이며 신호 연결선으로 쓰지 않는다.
//  - 분석하지 못한 연결(비트 선택·연산식 등)은 숨기지 않고 인스턴스 상자 안에 '제외' 줄로 남긴다.
//  - 방향(구동 → 신호 → 수신)은 buildNets 가 확인한 포트 선언 방향이 있는 연결에만 붙인다. 없으면 점선·방향 없음.

const NG_DISCLAIMER = "연결 방향 안내입니다. 실제 시뮬레이션이 아니며, 점의 움직임·속도·순서는 회로 지연이나 값 변화와 무관합니다.";
const NG_LIMIT_NOTES = [
  "대상 모듈의 경계 포트와 직접 하위 인스턴스 포트 사이의 ‘단일 신호명’ 연결만 선으로 그립니다. 하위 모듈 내부는 따라가지 않습니다.",
  "선의 방향은 연결된 포트의 선언 방향(input/output)에서 확인한 경우에만 표시합니다. inout·정의 미제공·방향 선언 없음은 점선(방향 없음)입니다.",
  "assign/always 등 다른 구동원은 분석하지 않습니다. 방향이 없는 신호가 구동원이 없다는 뜻은 아닙니다.",
  "분석하지 못한 연결(비트 선택·연산식·상수·빈 연결·위치 기반·.*)은 인스턴스 상자 안에 ‘제외’로 남기며 선으로 그리지 않습니다.",
  "화살표·점은 연결 방향 안내일 뿐 실제 시뮬레이션이 아니며, 속도나 순서로 회로 지연을 나타내지 않습니다."
];

const NG = {ROW: 22, GAP: 10, TOP: 34, BX: 12, BW: 176, SX: 262, SW: 200, IX: 560, CH: 6.9, IGAP: 16};

const ngClip = (s, max) => { s = String(s); return s.length > max ? s.slice(0, Math.max(1, max - 1)) + "…" : s; };

// 그래프 모델. nets: buildNets() 결과(오류 없음), mod: 대상 모듈 레코드(인스턴스 순서·제외 연결 확인용), modMap: 정의 여부 확인용
function ngBuildModel(nets, mod, modMap) {
  const signals = nets.nets.map(nt => ({
    key: "s:" + nt.name, net: nt.name, declared: nt.declared, bits: nt.bits, counts: nt.counts,
    warn: nt.notes.filter(n => n.level === "warn").map(n => n.text), notes: nt.notes
  }));
  const boundary = [];
  const sigByName = new Map(signals.map(s => [s.net, s]));
  const edges = [];
  const rowOf = new Map();     // instance\0port → 신호 연결 정보
  nets.nets.forEach(nt => nt.endpoints.forEach(e => {
    if (e.kind === "boundary") {
      boundary.push({key: "b:" + e.port, net: nt.name, port: e.port, dir: e.dir, bits: e.bits, used: true});
      edges.push({key: "e:b:" + e.port, net: nt.name, kind: "boundary", endpoint: "b:" + e.port, signal: "s:" + nt.name,
        arrow: e.arrow, directed: e.arrow !== "none", reason: e.reason || null});
    } else {
      rowOf.set(e.instance + "\0" + e.port, {net: nt.name, e});
    }
  }));
  for (const u of nets.unusedBoundary) boundary.push({key: "b:" + u.name, net: null, port: u.name, dir: u.dir, bits: u.bits, used: false});

  const exMap = new Map();
  for (const x of nets.excluded) exMap.set(x.instance + "\0" + x.port, x);
  const instances = [];
  for (const x of (mod ? mod.instances : [])) {
    const rows = [];
    for (const c of x.conns) {
      const k = x.name + "\0" + c.port;
      const hit = rowOf.get(k);
      if (c.kind === "net" && hit) {
        const e = hit.e;
        const key = "r:" + x.name + "." + c.port;
        rows.push({key, kind: "net", port: c.port, net: hit.net, dir: e.dir, bits: e.bits, arrow: e.arrow, reason: e.reason || null, line: x.line});
        edges.push({key: "e:" + key, net: hit.net, kind: "instance", endpoint: key, signal: "s:" + hit.net,
          arrow: e.arrow, directed: e.arrow !== "none", reason: e.reason || null});
      } else {
        const ex = exMap.get(k);
        rows.push({key: "r:" + x.name + "." + c.port, kind: "excluded", port: c.port, net: null, text: (ex && ex.text) || c.text || "",
          reason: (ex && ex.reason) || "분석하지 않는 연결 형태입니다", line: x.line});
      }
    }
    instances.push({key: "i:" + x.name, name: x.name, module: x.module, array: !!x.array, undef: !(modMap && modMap.has(x.module)), line: x.line, rows});
  }
  return {module: nets.module, signals, boundary, instances, edges,
    counts: {signals: signals.length, edges: edges.length, directed: edges.filter(e => e.directed).length,
      excludedRows: instances.reduce((a, i) => a + i.rows.filter(r => r.kind === "excluded").length, 0)},
    sigByName};
}

// 배치: 모든 좌표를 계산한다(그리기와 분리해 테스트 가능).
function ngLayout(model) {
  const L = {sig: new Map(), bnd: new Map(), inst: new Map(), row: new Map(), edges: new Map(), w: 0, h: 0};
  let y = NG.TOP;
  model.signals.forEach(s => { L.sig.set(s.key, {x: NG.SX, y, w: NG.SW, h: NG.ROW}); y += NG.ROW + NG.GAP; });
  const sigEnd = y;
  let by = sigEnd;
  model.boundary.forEach(b => {
    if (b.used) { const sp = L.sig.get("s:" + b.net); L.bnd.set(b.key, {x: NG.BX, y: sp.y, w: NG.BW, h: NG.ROW}); }
  });
  model.boundary.forEach(b => { if (!b.used) { L.bnd.set(b.key, {x: NG.BX, y: by, w: NG.BW, h: NG.ROW}); by += NG.ROW + NG.GAP; } });
  let iy = NG.TOP, iw = 230;
  model.instances.forEach(inst => {
    let mw = (inst.name + " : " + inst.module + (inst.undef ? " (정의 미제공)" : "")).length;
    inst.rows.forEach(r => { mw = Math.max(mw, (r.kind === "excluded" ? r.port + " (제외) " + r.text : r.port + " · " + (r.dir || "방향 미확인")).length + 9); });
    iw = Math.max(iw, Math.min(420, Math.ceil(mw * NG.CH) + 24));
  });
  model.instances.forEach(inst => {
    const rows = Math.max(1, inst.rows.length);
    const h = NG.ROW + rows * NG.ROW + 8;
    L.inst.set(inst.key, {x: NG.IX, y: iy, w: iw, h});
    inst.rows.forEach((r, i) => L.row.set(r.key, {x: NG.IX, y: iy + NG.ROW + 4 + i * NG.ROW, w: iw, h: NG.ROW}));
    iy += h + NG.IGAP;
  });
  L.w = NG.IX + iw + NG.BX;
  L.h = Math.max(sigEnd, by, iy) + 8;
  // 선: 흐름 방향대로 시작점 → 끝점을 잡는다(방향 없는 연결은 왼쪽 → 오른쪽 점선)
  for (const ed of model.edges) {
    const sp = L.sig.get(ed.signal);
    const ep = ed.kind === "boundary" ? L.bnd.get(ed.endpoint) : L.row.get(ed.endpoint);
    if (!sp || !ep) continue;
    const epL = ed.kind === "boundary" ? {x: ep.x + ep.w, y: ep.y + ep.h / 2} : {x: ep.x, y: ep.y + ep.h / 2};   // 끝점 쪽 접점
    const sL = {x: sp.x, y: sp.y + sp.h / 2}, sR = {x: sp.x + sp.w, y: sp.y + sp.h / 2};
    const sigSide = ed.kind === "boundary" ? sL : sR;
    let a, b;
    if (ed.directed && ed.arrow === "from-net") { a = sigSide; b = epL; }       // 신호 → 수신 포트
    else if (ed.directed && ed.arrow === "to-net") { a = epL; b = sigSide; }    // 구동 포트 → 신호
    else if (ed.kind === "boundary") { a = epL; b = sigSide; }
    else { a = sigSide; b = epL; }
    const dx = (b.x - a.x) / 2;
    L.edges.set(ed.key, {a, b, d: "M" + a.x + " " + a.y + " C" + (a.x + dx) + " " + a.y + "," + (b.x - dx) + " " + b.y + "," + b.x + " " + b.y});
  }
  return L;
}

/* ---------- SVG (브라우저 전용) ---------- */
const NG_NS = "http://www.w3.org/2000/svg";
function ngEl(tag, attrs, parent, text) {
  const e = document.createElementNS(NG_NS, tag);
  for (const k in (attrs || {})) e.setAttribute(k, attrs[k]);
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
const NG_DIR_WORD = {"to-net": "구동", "from-net": "수신", none: "방향 없음"};

// opts: {selected, onSelect(net|null)}
function ngRender(model, opts) {
  const L = ngLayout(model);
  const svg = ngEl("svg", {class: "ng", viewBox: "0 0 " + L.w + " " + L.h, width: L.w, height: L.h, role: "group",
    "aria-label": "신호 연결 그래프: 경계 포트, 신호, 하위 인스턴스 포트"});
  const defs = ngEl("defs", {}, svg);
  const mk = ngEl("marker", {id: "ngArrow", viewBox: "0 0 8 8", refX: "7", refY: "4", markerWidth: "7", markerHeight: "7", orient: "auto"}, defs);
  ngEl("path", {d: "M0 0 L8 4 L0 8 z", class: "ng-arrowhead"}, mk);
  [["경계 포트", NG.BX], ["신호", NG.SX], ["하위 인스턴스(직접)", NG.IX]].forEach(c => ngEl("text", {x: c[1], y: 18, class: "ng-col"}, svg, c[0]));
  const gE = ngEl("g", {class: "ng-edges"}, svg), gN = ngEl("g", {class: "ng-nodes"}, svg), gD = ngEl("g", {class: "ng-dots"}, svg);

  for (const ed of model.edges) {
    const g = L.edges.get(ed.key); if (!g) continue;
    const p = ngEl("path", {d: g.d, class: "ng-edge " + (ed.directed ? "dir" : "und"), "data-net": ed.net, "data-edge": ed.key}, gE);
    if (ed.directed) p.setAttribute("marker-end", "url(#ngArrow)");
    ngEl("title", {}, p, ed.net + " · " + (ed.directed ? (ed.arrow === "to-net" ? "구동 포트 → 신호" : "신호 → 수신 포트") : "방향 없음" + (ed.reason ? " (" + ed.reason + ")" : "")));
  }
  const focusable = (g, net, label) => {
    g.setAttribute("data-net", net); g.setAttribute("tabindex", "0"); g.setAttribute("role", "button"); g.setAttribute("aria-label", label);
  };
  for (const s of model.signals) {
    const r = L.sig.get(s.key);
    const g = ngEl("g", {class: "ng-sig" + (s.warn.length ? " warn" : ""), "data-key": s.key}, gN);
    focusable(g, s.net, "신호 " + s.net + (s.warn.length ? " (확인 필요 " + s.warn.length + "건)" : ""));
    ngEl("rect", {x: r.x, y: r.y, width: r.w, height: r.h, rx: 4, class: "ng-box"}, g);
    ngEl("text", {x: r.x + 8, y: r.y + 15, class: "ng-t m"}, g, ngClip(s.net, 15) + (s.bits != null && s.bits > 1 ? "[" + s.bits + "]" : ""));
    if (s.warn.length) ngEl("text", {x: r.x + 124, y: r.y + 15, class: "ng-warn"}, g, "⚠");
    ngEl("text", {x: r.x + r.w - 8, y: r.y + 15, class: "ng-val", "data-val": s.key, "text-anchor": "end"}, g, "");
    ngEl("title", {}, g, s.net + (s.declared === "port" ? " (경계 포트)" : s.declared === "net" ? " (내부 신호)" : " (선언 없음)") +
      " · 구동 " + s.counts.drivers + " · 수신 " + s.counts.loads + (s.counts.undirected ? " · 방향 없음 " + s.counts.undirected : "") +
      (s.warn.length ? "\n확인: " + s.warn.join(" / ") : ""));
  }
  for (const b of model.boundary) {
    const r = L.bnd.get(b.key);
    const g = ngEl("g", {class: "ng-bnd" + (b.used ? "" : " unused"), "data-key": b.key}, gN);
    if (b.used) focusable(g, b.net, "경계 포트 " + b.port); else { g.setAttribute("tabindex", "-1"); }
    ngEl("rect", {x: r.x, y: r.y, width: r.w, height: r.h, rx: 4, class: "ng-box"}, g);
    ngEl("text", {x: r.x + 8, y: r.y + 15, class: "ng-t m"}, g, ngClip(b.port, 14) + " · " + (b.dir || "방향 미확인") + (b.bits != null && b.bits > 1 ? " [" + b.bits + "]" : ""));
    ngEl("title", {}, g, "경계 포트 " + b.port + " (" + (b.dir || "방향 미확인") + ")" + (b.used ? "" : " · 하위 인스턴스와 연결된 신호명 연결을 찾지 못함"));
  }
  for (const inst of model.instances) {
    const r = L.inst.get(inst.key);
    const g = ngEl("g", {class: "ng-inst" + (inst.undef ? " undef" : ""), "data-key": inst.key}, gN);
    ngEl("rect", {x: r.x, y: r.y, width: r.w, height: r.h, rx: 5, class: "ng-ibox"}, g);
    ngEl("text", {x: r.x + 8, y: r.y + 16, class: "ng-ih m"}, g, ngClip(inst.name + " : " + inst.module, 48) + (inst.undef ? " (정의 미제공)" : "") + (inst.array ? " [배열]" : ""));
    if (!inst.rows.length) ngEl("text", {x: r.x + 8, y: r.y + NG.ROW + 17, class: "ng-ex"}, g, "포트 연결 없음");
    for (const row of inst.rows) {
      const rr = L.row.get(row.key);
      const rg = ngEl("g", {class: "ng-row " + row.kind, "data-key": row.key}, g);
      if (row.kind === "net") {
        focusable(rg, row.net, "포트 " + inst.name + "." + row.port + " 신호 " + row.net);
        ngEl("rect", {x: rr.x + 4, y: rr.y, width: rr.w - 8, height: rr.h - 2, rx: 3, class: "ng-rbox"}, rg);
        ngEl("text", {x: rr.x + 10, y: rr.y + 15, class: "ng-t m"}, rg, row.port + " · " + (row.dir || "방향 미확인") + (row.bits != null && row.bits > 1 ? " [" + row.bits + "]" : ""));
        ngEl("text", {x: rr.x + rr.w - 10, y: rr.y + 15, class: "ng-val", "data-val": row.key, "text-anchor": "end"}, rg, "");
        ngEl("title", {}, rg, inst.name + "." + row.port + " → 신호 " + row.net + " · " + NG_DIR_WORD[row.arrow] + (row.reason ? " · " + row.reason : "") + " · " + row.line + "줄(대상 모듈 파일 기준)");
      } else {
        ngEl("rect", {x: rr.x + 4, y: rr.y, width: rr.w - 8, height: rr.h - 2, rx: 3, class: "ng-rbox ex"}, rg);
        ngEl("text", {x: rr.x + 10, y: rr.y + 15, class: "ng-ex m"}, rg, ngClip(row.port + " (제외) " + row.text, Math.floor((rr.w - 20) / NG.CH)));
        ngEl("title", {}, rg, inst.name + "." + row.port + " · 분석 제외: " + row.reason + (row.text ? " · 연결 내용: " + row.text : ""));
      }
    }
  }
  // 방향이 확인된 선에만 점을 둔다
  for (const ed of model.edges) if (ed.directed && L.edges.get(ed.key)) ngEl("circle", {r: 3.4, class: "ng-dot", "data-net": ed.net, "data-edge": ed.key, cx: -20, cy: -20}, gD);

  // 선택: 같은 신호(data-net)의 요소만 강조, 나머지는 흐리게
  const select = net => {
    svg.classList.toggle("has-sel", !!net);
    svg.querySelectorAll("[data-net]").forEach(n => n.classList.toggle("on", !!net && n.getAttribute("data-net") === net));
  };
  svg.addEventListener("click", ev => {
    const t = ev.target.closest && ev.target.closest("[data-net]");
    const net = t && !t.classList.contains("ng-edge") ? t.getAttribute("data-net") : (t ? t.getAttribute("data-net") : null);
    const next = net && net !== (opts && opts.selected) ? net : null;
    if (opts) opts.selected = next;
    select(next);
    if (opts && opts.onSelect) opts.onSelect(next);
  });
  svg.addEventListener("keydown", ev => {
    if (ev.key !== "Enter" && ev.key !== " ") return;
    const t = ev.target.closest && ev.target.closest("[data-net][tabindex='0']");
    if (!t) return;
    ev.preventDefault(); t.dispatchEvent(new MouseEvent("click", {bubbles: true}));
  });
  svg._ng = {layout: L, select};
  if (opts && opts.selected) select(opts.selected);
  return svg;
}

/* ---------- 방향 안내 애니메이션 ----------
   모든 선에서 점이 같은 주기·같은 위상으로 움직인다(선 길이·순서에 따른 차이를 두지 않음). 시뮬레이션이 아니다. */
const NG_PERIOD_MS = 2200;
function ngAnimator(svg) {
  const dots = [...svg.querySelectorAll("circle.ng-dot")].map(c => ({c, p: svg.querySelector('path.ng-edge[data-edge="' + c.getAttribute("data-edge") + '"]')})).filter(x => x.p);
  const lens = dots.map(x => x.p.getTotalLength());
  const A = {playing: false, speed: 1, phase: 0.5, raf: 0, last: 0, dots: dots.length};
  const place = () => dots.forEach((x, i) => { const pt = x.p.getPointAtLength(A.phase * lens[i]); x.c.setAttribute("cx", pt.x); x.c.setAttribute("cy", pt.y); });
  const tick = now => {
    if (!A.playing) return;
    if (!svg.isConnected) { A.playing = false; return; }
    A.phase = (A.phase + (now - A.last) * A.speed / NG_PERIOD_MS) % 1; A.last = now; place();
    A.raf = requestAnimationFrame(tick);
  };
  A.play = () => { if (A.playing) return; A.playing = true; A.last = performance.now(); A.raf = requestAnimationFrame(tick); };
  A.pause = () => { A.playing = false; cancelAnimationFrame(A.raf); };
  A.setSpeed = v => { A.speed = v; };
  A.destroy = () => A.pause();
  place();
  return A;
}

// 값 표시: values = Map(key → {text, cls, changed}) 를 data-val 텍스트와 상태 클래스로 반영
function ngSetValues(svg, values) {
  svg.querySelectorAll("[data-val]").forEach(t => {
    const v = values && values.get(t.getAttribute("data-val"));
    t.textContent = v ? v.text : "";
    t.setAttribute("class", "ng-val" + (v ? " v-" + v.cls + (v.changed ? " chg" : "") : ""));
  });
  svg.querySelectorAll(".ng-sig").forEach(g => {
    const v = values && values.get(g.getAttribute("data-key"));
    g.classList.toggle("has-val", !!v);
    for (const c of ["v0", "v1", "vx", "vz", "vv", "vr"]) g.classList.toggle(c, !!v && ("v" + v.cls) === c);
    g.classList.toggle("chg", !!(v && v.changed));
  });
  svg.querySelectorAll("path.ng-edge").forEach(p => {
    const v = values && values.get("s:" + p.getAttribute("data-net"));
    for (const c of ["v0", "v1", "vx", "vz", "vv", "vr"]) p.classList.toggle(c, !!v && ("v" + v.cls) === c);
    p.classList.toggle("chg", !!(v && v.changed));
  });
}

if (typeof module !== "undefined" && module.exports) module.exports = {ngBuildModel, ngLayout, NG_DISCLAIMER, NG_LIMIT_NOTES};
