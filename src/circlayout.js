// 회로 모델(netlist.js) → 배치(노드 좌표·핀·배선 경로). 순수 함수. 연결은 모델의 비트 연결에서만 만든다.
const CL = {PAD: 16, GAPX: 54, GAPY: 18, LANE: 7, BITW: 19, BITROW: 32, PINH: 16};

function clSize(c, expanded) {
  const kind = c.kind, left = [], right = [], bottom = [];
  const ins = c.pins.filter(p => p.dir !== "output"), outs = c.pins.filter(p => p.dir === "output");
  if (kind === "mux" || kind === "gmux" || kind === "pmux") {
    ins.forEach(p => (p.name === "S" ? bottom : left).push(p));
  } else if (kind === "reg" || kind === "latch" || kind === "gff") {
    const d = ins.filter(p => p.name === "D"), o = ins.filter(p => p.name !== "D"); left.push(...d, ...o);
  } else left.push(...ins);
  right.push(...outs);
  const nBody = Math.max(left.length, right.length, 1);
  let w = {mux: 58, gmux: 58, pmux: 66, arith: 64, cmp: 64, logic: 68, shift: 68, gate: 62, reg: 92, latch: 92, gff: 92, sub: 130, other: 110}[kind] || 100;
  const labelW = Math.min(240, (c.label.length * 7) + 24); if (kind === "sub" || kind === "other") w = Math.max(w, labelW);
  const bodyH = Math.max(kind === "reg" || kind === "gff" || kind === "latch" ? 56 : 40, nBody * CL.PINH + 14) + (bottom.length ? 10 : 0);
  let h = bodyH, bits = null;
  if (c.reg && expanded && expanded.has(c.id) && c.reg.width > 1) {
    const cols = Math.min(CL.BITROW, c.reg.width), rows = Math.ceil(c.reg.width / CL.BITROW);
    bits = {cols, rows, y0: bodyH + 22};
    h = bodyH + 22 + rows * 24 + 8; w = Math.max(w, cols * CL.BITW + 16);
  }
  return {w, h, bodyH, left, right, bottom, bits};
}

function clLayout(model, opts) {
  opts = opts || {};
  const expanded = opts.expanded || new Set(), nodes = [], byKey = new Map();
  const add = n => { nodes.push(n); byKey.set(n.key, n); return n; };
  for (const p of model.ports) if (p.dir === "input" || p.dir === "inout")
    add({key: "port:" + p.name, kind: "pin-in", label: p.name + (p.bits.length > 1 ? "[" + (p.bits.length - 1) + ":0]" : ""), port: p, w: Math.min(220, 28 + (p.name.length + (p.bits.length > 1 ? 8 : 0)) * 7), h: 26, bodyH: 26, left: [], right: [{name: p.name, dir: "output", bits: p.bits}], bottom: [], bits: null, dir: p.dir});
  for (const c of model.cells) { const s = clSize(c, expanded); add(Object.assign({key: "cell:" + c.id, kind: c.kind, label: c.label, cell: c}, s)); }
  for (const p of model.ports) if (p.dir === "output" || p.dir === "inout")
    add({key: "port-out:" + p.name, kind: "pin-out", label: p.name + (p.bits.length > 1 ? "[" + (p.bits.length - 1) + ":0]" : ""), port: p, w: Math.min(220, 28 + (p.name.length + (p.bits.length > 1 ? 8 : 0)) * 7), h: 26, bodyH: 26, left: [{name: p.name, dir: "input", bits: p.bits}], right: [], bottom: [], bits: null, dir: p.dir});

  // 연결(구간) 만들기: 모든 입력 핀 → 구동원
  const edges = [];
  for (const n of nodes) for (const pin of n.left.concat(n.bottom)) {
    pin.consts = []; pin.open = [];
    for (const s of nlSegments(model, pin.bits)) {
      if (s.kind === "const") pin.consts.push(s);
      else if (s.kind === "open") pin.open.push(s);
      else {
        const src = byKey.get(s.from.node);
        if (!src) { pin.open.push(s); continue; }
        edges.push({from: {key: s.from.node, pin: s.from.pin, lo: s.from.lo, hi: s.from.hi}, to: {key: n.key, pin: pin.name, lo: s.to.lo, hi: s.to.hi}, width: s.to.hi - s.to.lo + 1, bits: pin.bits.slice(s.to.lo, s.to.hi + 1)});
      }
    }
  }
  // 깊이: 레지스터 출력은 기점(깊이 0)처럼 취급해 되먹임(순환)을 끊는다.
  const isSeq = n => n.kind === "reg" || n.kind === "latch" || n.kind === "gff";
  const depth = new Map(nodes.map(n => [n.key, n.kind === "pin-in" ? 0 : 1]));
  const into = new Map(nodes.map(n => [n.key, []])); edges.forEach(e => into.get(e.to.key).push(e));
  for (let it = 0; it < nodes.length + 2; it++) {
    let ch = false;
    for (const n of nodes) {
      if (n.kind === "pin-in" || n.kind === "pin-out") continue;
      let d = 1;
      for (const e of into.get(n.key)) { const s = byKey.get(e.from.key); const ds = isSeq(s) ? 0 : depth.get(s.key); d = Math.max(d, ds + 1); }
      if (d > depth.get(n.key) && d <= nodes.length + 1) { depth.set(n.key, d); ch = true; }
    }
    if (!ch) break;
  }
  let maxD = 0; nodes.forEach(n => { if (n.kind !== "pin-out") maxD = Math.max(maxD, depth.get(n.key)); });
  nodes.forEach(n => { if (n.kind === "pin-out") depth.set(n.key, maxD + 1); });
  const cols = []; nodes.forEach(n => { const d = depth.get(n.key); n.col = d; (cols[d] = cols[d] || []).push(n); });
  // 세로 순서: 앞 열 구동원의 평균 위치(barycenter)
  let colX = [], x = CL.PAD;
  for (let c = 0; c < cols.length; c++) {
    if (!cols[c]) { cols[c] = []; }
    const list = cols[c];
    if (c > 0) {
      const prevIdx = new Map(); nodes.forEach(n => prevIdx.set(n.key, n.order == null ? 0 : n.order));
      list.forEach(n => { const es = into.get(n.key); n.bary = es.length ? es.reduce((a, e) => a + (byKey.get(e.from.key).order == null ? 0 : byKey.get(e.from.key).order), 0) / es.length : 0; });
      list.sort((a, b) => a.bary - b.bary);
    }
    let y = CL.PAD; list.forEach((n, i) => { n.order = y + n.h / 2; n.y = y; y += n.h + CL.GAPY; });
    const cw = list.reduce((m, n) => Math.max(m, n.w), 0); colX[c] = x; list.forEach(n => { n.x = x + (cw - n.w) / 2; n.colW = cw; }); x += cw + CL.GAPX;
  }
  // 핀 좌표
  for (const n of nodes) {
    const pl = n.left, pr = n.right, pb = n.bottom;
    pl.forEach((p, i) => { p.x = n.x; p.y = n.y + (i + 1) * n.bodyH / (pl.length + 1); p.side = "L"; });
    pr.forEach((p, i) => { p.x = n.x + n.w; p.y = n.y + (i + 1) * n.bodyH / (pr.length + 1); p.side = "R"; });
    pb.forEach((p, i) => { p.x = n.x + (i + 1) * n.w / (pb.length + 1); p.y = n.y + n.bodyH; p.side = "B"; });
  }
  const pinOf = (key, name, side) => { const n = byKey.get(key); const l = side === "out" ? n.right : n.left.concat(n.bottom); return l.find(p => p.name === name); };
  // 배선 경로
  let width = x - CL.GAPX + CL.PAD, bottom = 0; nodes.forEach(n => { bottom = Math.max(bottom, n.y + n.h); });
  const gapCount = new Map(); let lanes = 0;
  for (const e of edges) {
    const fn = byKey.get(e.from.key), tn = byKey.get(e.to.key), fp = pinOf(e.from.key, e.from.pin, "out"), tp = pinOf(e.to.key, e.to.pin, "in");
    e.fx = fp.x; e.fy = fp.y; e.tx = tp.x; e.ty = tp.y; e.fromNode = fn.key; e.toNode = tn.key;
    const span = tn.col - fn.col, back = span <= 0 && !(span === 0 && false);
    e.back = span < 1;
    const g = (fn.col) + ":" + (e.back ? "b" : "f"), k = gapCount.get(g) || 0; gapCount.set(g, k + 1);
    const off = (k % 5) * CL.LANE;
    if (span === 1) { const xm = colX[fn.col] + cols[fn.col].reduce((m, n) => Math.max(m, n.w), 0) + 10 + off; e.pts = [[e.fx, e.fy], [xm, e.fy], [xm, e.ty], [e.tx, e.ty]]; e.lane = null; }
    else {
      const xa = colX[fn.col] + cols[fn.col].reduce((m, n) => Math.max(m, n.w), 0) + 10 + off;
      const xb = colX[tn.col] - 10 - off, lane = lanes++;
      e.lane = lane; e.pts = [[e.fx, e.fy], [xa, e.fy], [xa, null], [xb, null], [xb, e.ty], [e.tx, e.ty]];
    }
  }
  const laneBase = bottom + 14;
  edges.forEach(e => { if (e.lane != null) { const ly = laneBase + e.lane * CL.LANE; e.pts[2][1] = ly; e.pts[3][1] = ly; } });
  const height = laneBase + lanes * CL.LANE + CL.PAD;
  return {nodes, edges, width: Math.max(width, 200), height: Math.max(height, 80), byKey, depth: maxD + 1};
}
if (typeof module !== "undefined" && module.exports) { const nlx = require("./netlist.js"); global.nlSegments = nlx.nlSegments; module.exports = {clLayout, clSize}; }
