// 모듈 블록에 표시할 포트 정보(DOM 없음). 추측하지 않는다: 방향·폭을 알 수 없으면 "미확인"으로 둔다.
//   포트명(모듈 정의의 이름)과 상위에서 연결한 신호명(인스턴스 선언의 연결식)을 구분해서 가진다.
// 행: {port, dir: input|output|inout|unknown, bits(수|null), range(문자열|null), conn: net|expr|open|none, signal(문자열|null), full}
//   conn "net"=단일 신호명 연결 / "expr"=식·연결 연산 등 단일 신호명이 아님(원문 그대로) / "open"=빈 연결 ( .p() ) / "none"=연결 항목 없음
const PI_FOLD = 10;       // 포트가 이 수를 넘으면 접힌 요약으로 시작
const PI_FOLD_SHOW = 4;   // 접힌 요약에서 방향별로 보여 줄 포트 수

function piRow(p, c) {
  const dir = p && (p.dir === "input" || p.dir === "output" || p.dir === "inout") ? p.dir : "unknown";
  const row = {port: p.name, dir, bits: p.bits == null ? null : p.bits, range: p.range || null, conn: "none", signal: null, full: ""};
  if (c) {
    if (c.kind === "net") { row.conn = "net"; row.signal = c.net; }
    else if (c.kind === "open" || c.text === "" || c.text == null) { row.conn = "open"; row.signal = null; }
    else if (c.kind === "const") { row.conn = "const"; row.signal = c.text; }
    else if (c.kind === "positional") { row.conn = "positional"; row.signal = c.text; }   // 순서 기반 연결: 포트 선언 순서로 대응시킨 것
    else { row.conn = "expr"; row.signal = c.text; }
  }
  return row;
}
function piDescribe(r, isRoot) {
  const d = {input: "입력(input)", output: "출력(output)", inout: "양방향(inout)", unknown: "방향 미확인"}[r.dir];
  const w = r.bits == null ? "폭 미확인" : r.bits + "비트" + (r.range ? " " + r.range : "");
  const c = isRoot ? "(최상위 포트: 상위 연결 없음)" :
    r.conn === "net" ? "상위 신호 " + r.signal + " 연결" : r.conn === "const" ? "상수 " + r.signal + " 연결" : r.conn === "positional" ? "순서 기반 연결: " + r.signal + " (포트 선언 순서로 대응, 확인 필요)" : r.conn === "expr" ? "연결식 " + r.signal + " (단일 신호명 아님)" : r.conn === "open" ? "비어 있는 연결" : "연결 항목 없음(미연결로 보임)";
  return "모듈 포트 " + r.port + " · " + d + " · " + w + " · " + c;
}
// 한 인스턴스(또는 최상위)의 포트 행 목록. parentMod=null 이면 최상위(연결 없음).
function piBlock(modMap, moduleName, parentMod, instIndex) {
  const def = modMap.get(moduleName);
  if (!def) return {defined: false, rows: [], inputs: [], outputs: [], inouts: [], unknown: [], total: 0};
  const inst = parentMod && parentMod.instances[instIndex];
  const byPort = new Map();
  if (inst) {
    const order = [...def.ports.keys()];
    for (const c of inst.conns || []) {
      const key = c.port != null ? c.port : (c.kind === "positional" && c.index >= 1 ? order[c.index - 1] : null);
      if (key != null && !byPort.has(key)) byPort.set(key, c);
    }
  }
  const rows = [...def.ports.values()].map(p => piRow(p, parentMod ? byPort.get(p.name) || null : null));
  rows.forEach(r => { r.full = piDescribe(r, !parentMod); });
  return {defined: true, rows, total: rows.length, root: !parentMod,
    inputs: rows.filter(r => r.dir === "input"), outputs: rows.filter(r => r.dir === "output"),
    inouts: rows.filter(r => r.dir === "inout"), unknown: rows.filter(r => r.dir === "unknown")};
}
// 화면 행 구성: 왼쪽(input + 방향 미확인) / 오른쪽(output + inout). 접힌 요약이면 방향별로 일부만, 숨긴 개수를 알려 준다.
function piLayout(b, full) {
  const left = b.inputs.concat(b.unknown), right = b.outputs.concat(b.inouts);
  if (full || b.total <= PI_FOLD) return {left, right, hidden: 0, folded: false};
  const pick = a => a.slice(0, PI_FOLD_SHOW);
  const l = pick(b.inputs).concat(pick(b.unknown).slice(0, 2)), r = pick(b.outputs).concat(pick(b.inouts).slice(0, 2));
  return {left: l, right: r, hidden: b.total - l.length - r.length, folded: true};
}
// 행 하나의 화면 텍스트 (왼쪽: 입력 포트 ◂ 상위 신호 / 오른쪽: 출력 포트 ▸ 상위 신호)
function piLabel(r, isRoot) {
  const w = r.range ? r.range : r.bits == null ? "[?]" : "";
  const name = r.port + w;
  const sig = isRoot ? "" : r.conn === "net" ? r.signal : r.conn === "const" ? r.signal : r.conn === "positional" ? r.signal + "(순서)" : r.conn === "expr" ? "{식}" : r.conn === "open" ? "(빈 연결)" : "(미연결)";
  const glyph = r.dir === "input" ? "◂" : r.dir === "output" ? "▸" : r.dir === "inout" ? "◂▸" : "?";
  return {name, sig, glyph};
}
const PI_LINE = 16;
// 블록 높이/최소 폭 계산 (layout 이 사용). charW 는 고정폭 글자 폭 근사값.
function piMetrics(b, full, isRoot, headerH, charW) {
  if (!b || !b.defined || !b.total) return null;
  const L = piLayout(b, full);
  const rows = Math.max(L.left.length, L.right.length) + (L.folded || (full && b.total > PI_FOLD) ? 1 : 0);
  const lw = Math.max(0, ...L.left.map(r => { const t = piLabel(r, isRoot); return t.name.length + (t.sig ? t.sig.length + 3 : 0); }));
  const rw = Math.max(0, ...L.right.map(r => { const t = piLabel(r, isRoot); return t.name.length + (t.sig ? t.sig.length + 3 : 0); }));
  return {h: headerH + rows * PI_LINE + 8, minW: Math.ceil((lw + rw) * charW) + 56, layout: L, rows};
}

if (typeof module !== "undefined" && module.exports) module.exports = {piBlock, piLayout, piLabel, piMetrics, piDescribe, PI_FOLD, PI_FOLD_SHOW, PI_LINE};
