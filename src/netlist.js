// Yosys write_json 결과를 읽어 화면용 회로 모델로 정리한다(순수 함수, Node에서도 테스트 가능).
// 원칙: Yosys가 낸 셀·연결만 쓴다. 분석기 정보로 회로를 추정하지 않고, 원본 소스 대응(src 속성)이 없으면 "확인 불가"로 둔다.
function nlBin(s) { return typeof s === "string" && /^[01]+$/.test(s) ? parseInt(s, 2) : null; }

const NL_KIND = {
  "$mux": "mux", "$pmux": "pmux", "$bmux": "mux",
  "$add": "arith", "$sub": "arith", "$mul": "arith", "$div": "arith", "$mod": "arith", "$neg": "arith", "$pos": "arith",
  "$eq": "cmp", "$ne": "cmp", "$lt": "cmp", "$le": "cmp", "$gt": "cmp", "$ge": "cmp", "$eqx": "cmp", "$nex": "cmp",
  "$and": "logic", "$or": "logic", "$xor": "logic", "$xnor": "logic", "$not": "logic", "$logic_and": "logic", "$logic_or": "logic", "$logic_not": "logic",
  "$reduce_and": "logic", "$reduce_or": "logic", "$reduce_xor": "logic", "$reduce_xnor": "logic", "$reduce_bool": "logic",
  "$shl": "shift", "$shr": "shift", "$sshl": "shift", "$sshr": "shift",
  "$dff": "reg", "$adff": "reg", "$dffe": "reg", "$adffe": "reg", "$sdff": "reg", "$sdffe": "reg", "$sdffce": "reg", "$dffsr": "reg", "$aldff": "reg",
  "$dlatch": "latch", "$adlatch": "latch"
};
const NL_TEXT = {
  "$mux": "MUX", "$pmux": "MUX(다중 선택)", "$bmux": "MUX", "$add": "+", "$sub": "−", "$mul": "×", "$div": "÷", "$mod": "%", "$neg": "−x", "$pos": "+x",
  "$eq": "==", "$ne": "!=", "$lt": "<", "$le": "<=", "$gt": ">", "$ge": ">=", "$eqx": "===", "$nex": "!==",
  "$and": "AND", "$or": "OR", "$xor": "XOR", "$xnor": "XNOR", "$not": "NOT", "$logic_and": "&&", "$logic_or": "||", "$logic_not": "!",
  "$reduce_and": "&(축약)", "$reduce_or": "|(축약)", "$reduce_xor": "^(축약)", "$reduce_xnor": "~^(축약)", "$reduce_bool": "!=0",
  "$shl": "<<", "$shr": ">>", "$sshl": "<<<", "$sshr": ">>>",
  "$dff": "레지스터", "$adff": "레지스터(비동기 리셋)", "$dffe": "레지스터(Enable)", "$adffe": "레지스터(비동기 리셋·Enable)",
  "$sdff": "레지스터(동기 리셋)", "$sdffe": "레지스터(동기 리셋·Enable)", "$sdffce": "레지스터(동기 리셋·Enable)", "$dffsr": "레지스터(셋/리셋)", "$aldff": "레지스터(비동기 로드)",
  "$dlatch": "래치", "$adlatch": "래치(비동기 리셋)"
};
const NL_GATE = {"$_AND_": "AND", "$_NAND_": "NAND", "$_OR_": "OR", "$_NOR_": "NOR", "$_XOR_": "XOR", "$_XNOR_": "XNOR", "$_ANDNOT_": "ANDNOT", "$_ORNOT_": "ORNOT", "$_NOT_": "NOT", "$_BUF_": "BUF", "$_MUX_": "MUX"};

function nlKind(type, mods) {
  if (NL_KIND[type]) return NL_KIND[type];
  if (NL_GATE[type]) return type === "$_MUX_" ? "gmux" : "gate";
  if (/^\$_(S?DFF|DFFE|DFFSR|ALDFF|DLATCH)/.test(type) || /^\$_(SDFF|DFF|ALDFF|DLATCH)/.test(type)) return "gff";
  if (type[0] !== "$" && mods && mods[type]) return "sub";
  return "other";
}
function nlLabel(type, kind) { return NL_TEXT[type] || NL_GATE[type] || (kind === "gff" ? "FF " + type.replace(/^\$_|_$/g, "") : kind === "sub" ? type : type); }

// "file:l1.c1-l2.c2|file2:..." → 첫 위치
function nlSrc(attr) {
  if (!attr || typeof attr.src !== "string" || !attr.src) return null;
  const first = attr.src.split("|")[0], m = first.match(/^(.*):(\d+)\.(\d+)-(\d+)\.(\d+)$/) || first.match(/^(.*):(\d+)\.(\d+)$/);
  if (!m) return {raw: attr.src, file: null, line: null};
  return {raw: attr.src, file: m[1], line: +m[2], endLine: m[4] && m[5] ? +m[4] : +m[2]};
}

// bits 배열 → 표시용 폭 정보
const nlIsNet = b => typeof b === "number";

// 입력 JSON의 모듈 하나를 모델로 바꾼다.
function nlModel(json, top) {
  const mods = json && json.modules; if (!mods || !mods[top]) return {error: "변환 결과에 모듈 '" + top + "'이(가) 없습니다."};
  const m = mods[top];
  const model = {name: top, ports: [], cells: [], bitName: new Map(), nets: [], driver: new Map(), subModules: Object.keys(mods).filter(k => k !== top), unknown: []};
  // 포트
  for (const [name, p] of Object.entries(m.ports || {})) model.ports.push({name, dir: p.direction, bits: p.bits.slice()});
  // 이름 있는 신호(hide_name=0): bit → {name, idx}
  for (const [name, n] of Object.entries(m.netnames || {})) {
    if (n.hide_name) continue;
    model.nets.push({name, bits: n.bits.slice()});
    n.bits.forEach((b, i) => { if (nlIsNet(b) && !model.bitName.has(b)) model.bitName.set(b, {name, idx: i, width: n.bits.length}); });
  }
  // 셀
  for (const [cname, c] of Object.entries(m.cells || {})) {
    const kind = nlKind(c.type, mods), pins = [];
    for (const [pn, bits] of Object.entries(c.connections || {})) pins.push({name: pn, dir: (c.port_directions || {})[pn] || null, bits: bits.slice()});
    const params = {};
    for (const [k, v] of Object.entries(c.parameters || {})) params[k] = /_WIDTH$|^WIDTH$|^WIDTH_|^S_WIDTH$/.test(k) && nlBin(v) != null ? nlBin(v) : (typeof v === "string" && /^[01]{32}$/.test(v) ? nlBin(v) : v);
    model.cells.push({id: cname, type: c.type, kind, label: nlLabel(c.type, kind), params, pins, src: nlSrc(c.attributes), hidden: !!c.hide_name});
  }
  // 입력 포트·셀 출력이 어떤 비트를 구동하는지
  for (const p of model.ports) if (p.dir === "input" || p.dir === "inout") p.bits.forEach((b, i) => { if (nlIsNet(b)) model.driver.set(b, {node: "port:" + p.name, pin: p.name, idx: i}); });
  for (const c of model.cells) for (const pin of c.pins) if (pin.dir === "output" || pin.dir === "inout") pin.bits.forEach((b, i) => { if (nlIsNet(b) && !model.driver.has(b)) model.driver.set(b, {node: "cell:" + c.id, pin: pin.name, idx: i}); });
  // 레지스터 요약(RTL): Yosys의 저장 셀(레지스터 계열)만 대상. reg 선언 여부로 판단하지 않는다.
  for (const c of model.cells) {
    if (c.kind !== "reg" && c.kind !== "latch") continue;
    const q = c.pins.find(p => p.name === "Q"); if (!q) continue;
    const w = q.bits.length;
    c.reg = {width: w, name: nlNameOf(model, q.bits), bitIdx: q.bits.map((b, i) => { const nm = model.bitName.get(b); return nm && nm.name === nlNameOf(model, q.bits) ? nm.idx : null; })};
  }
  return model;
}
// 비트 묶음 전체가 하나의 이름 있는 신호와 일치하면 그 이름
function nlNameOf(model, bits) {
  const first = nlIsNet(bits[0]) ? model.bitName.get(bits[0]) : null; if (!first) return null;
  const net = model.nets.find(n => n.name === first.name); if (!net || net.bits.length !== bits.length) return null;
  return net.bits.every((b, i) => b === bits[i]) ? first.name : null;
}
// 비트 목록을 "이름[hi:lo]"로 (이름 있는 신호로 확인되는 연속 구간만)
function nlSliceName(model, bits) {
  if (!bits.length) return "";
  const nm = nlIsNet(bits[0]) ? model.bitName.get(bits[0]) : null; if (!nm) return null;
  for (let i = 0; i < bits.length; i++) { const x = nlIsNet(bits[i]) ? model.bitName.get(bits[i]) : null; if (!x || x.name !== nm.name || x.idx !== nm.idx + i) return null; }
  const net = model.nets.find(n => n.name === nm.name);
  const lo = nm.idx, hi = nm.idx + bits.length - 1;
  return net && net.bits.length === 1 ? nm.name : nm.name + (lo === hi ? "[" + lo + "]" : "[" + hi + ":" + lo + "]");
}
// 상수 비트 목록 → "4'b0101" (x/z 포함 시 그대로)
function nlConst(bits) { return bits.length + "'b" + bits.slice().reverse().map(b => String(b)).join(""); }

// 각 셀 입력 핀(및 출력 포트)의 연결을 구동원 기준 구간으로 쪼갠다.
// 반환: [{kind:"wire", from:{node,pin,lo,hi}, to:{lo,hi}} | {kind:"const", to:{lo,hi}, text} | {kind:"open", to:{lo,hi}}]
function nlSegments(model, bits) {
  const segs = []; let i = 0;
  while (i < bits.length) {
    const b = bits[i];
    if (!nlIsNet(b)) {
      let j = i; while (j + 1 < bits.length && !nlIsNet(bits[j + 1])) j++;
      segs.push({kind: "const", to: {lo: i, hi: j}, text: nlConst(bits.slice(i, j + 1))}); i = j + 1; continue;
    }
    const d = model.driver.get(b);
    if (!d) { let j = i; while (j + 1 < bits.length && nlIsNet(bits[j + 1]) && !model.driver.get(bits[j + 1])) j++; segs.push({kind: "open", to: {lo: i, hi: j}}); i = j + 1; continue; }
    let j = i;
    while (j + 1 < bits.length) {
      const n = bits[j + 1], dn = nlIsNet(n) ? model.driver.get(n) : null;
      if (dn && dn.node === d.node && dn.pin === d.pin && dn.idx === model.driver.get(bits[j]).idx + 1) j++; else break;
    }
    segs.push({kind: "wire", from: {node: d.node, pin: d.pin, lo: d.idx, hi: model.driver.get(bits[j]).idx}, to: {lo: i, hi: j}}); i = j + 1;
  }
  return segs;
}
if (typeof module !== "undefined" && module.exports) module.exports = {nlModel, nlSegments, nlSliceName, nlConst, nlNameOf, nlKind, nlLabel, nlSrc, NL_GATE, NL_TEXT};
