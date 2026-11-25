// 신호 연결(이름 기반) 분석과 계층 탐색 보조. DOM에 의존하지 않으며 Node(test/check.js)와 Electron 창 양쪽에서 쓴다.
//
// buildNets(modMap, modName): 모듈 하나의 본문을 대상으로, 그 모듈의 경계 포트와 직접 하위 인스턴스 포트 사이에서
//   단일 신호명(.포트(신호명))으로 연결된 항목을 신호별로 묶는다.
//   - 하위 모듈 안쪽으로 신호를 이어서 추적하지 않는다.
//   - assign/always 로 구동되는 신호는 분석하지 않는다. 그래서 '구동 포트 없음'이 아니라 '알려진 구동 포트 없음'이라고만 쓴다.
//   - 방향은 연결된 포트 하나하나의 선언 방향(input/output)만 근거로 한다. 확실하지 않으면 arrow = "none"(방향 없음).
//   - inout 은 연결 사실만 남기고(arrow = "none") 구동·수신 판정에서는 제외한다.
// indexTree(root): 계층 트리의 노드 id → {node, parent, path, pathText}. 같은 모듈의 여러 인스턴스를 id(전체 인스턴스 경로)로 구분한다.

const EXCLUDE_REASON = {
  select: "비트 선택 연결은 첫 버전에서 분석하지 않습니다",
  expr: "연산식·연결 연산(예: {a,b}, a+b)은 분석하지 않습니다",
  const: "상수 연결은 신호가 아니므로 분석하지 않습니다",
  open: "포트가 연결되지 않았습니다(빈 연결)",
  positional: "위치 기반 포트 연결은 추적하지 않습니다",
  implicit: ".* / .name 연결(SystemVerilog)은 추적하지 않습니다"
};

const NO_ARROW_REASON = {
  inout: "inout 포트: 연결 사실만 표시하고 구동·수신 판정에서 제외",
  "undef-module": "하위 모듈 정의 미제공: 포트 방향을 알 수 없음",
  "undef-port": "하위 모듈 정의에 없는 포트: 포트 방향을 알 수 없음",
  "no-dir": "포트 방향 선언을 찾지 못함"
};

// 하위 모듈 정의에서 포트 정보를 찾는다. 확실하지 않으면 dir 을 null 로 둔다.
function lookupPort(def, portName) {
  if (!def) return {dir: null, bits: null, range: null, why: "undef-module"};
  const p = def.ports.get(portName);
  if (!p) return {dir: null, bits: null, range: null, why: "undef-port"};
  if (!p.dir) return {dir: null, bits: null, range: p.range || null, why: "no-dir"};
  return {dir: p.dir, bits: p.bits, range: p.range || null, why: p.dir === "inout" ? "inout" : null};
}

// 포트 하나의 선언 방향 → 신호와의 관계. output(구동) → "to-net", input(수신) → "from-net", 그 외 "none"
const arrowOf = dir => dir === "output" ? "to-net" : dir === "input" ? "from-net" : "none";
// 선택 모듈 자신의 경계 포트는 안쪽에서 보면 방향이 반대다: input 포트가 내부 신호를 구동한다.
const boundaryArrowOf = dir => dir === "input" ? "to-net" : dir === "output" ? "from-net" : "none";

function buildNets(modMap, modName) {
  const mod = modMap.get(modName);
  if (!mod) return {error: "모듈 '" + modName + "'의 정의가 입력 코드에 없습니다. 정의 미제공 모듈은 신호 연결을 분석할 수 없습니다.", undef: true};

  const nets = new Map();      // 신호명 → 신호 정보 (처음 나온 순서 유지)
  const excluded = [];

  const netInfo = name => {
    let nt = nets.get(name);
    if (nt) return nt;
    const port = mod.ports.get(name), decl = mod.nets.get(name);
    const src = port || decl || null;
    nt = {
      name,
      declared: port ? "port" : decl ? "net" : "none",
      bits: src ? src.bits : null,
      range: src ? (src.range || null) : null,
      endpoints: [],
      notes: []
    };
    if (port) {
      nt.endpoints.push({
        kind: "boundary", instance: null, module: mod.name, port: name, dir: port.dir || null,
        arrow: boundaryArrowOf(port.dir), bits: port.bits, range: port.range || null, line: port.line,
        why: port.dir === "inout" ? "inout" : port.dir ? null : "no-dir", array: false
      });
    }
    nets.set(name, nt);
    return nt;
  };

  for (const x of mod.instances) {
    const def = modMap.get(x.module);
    for (const c of x.conns) {
      if (c.kind !== "net") {
        excluded.push({
          instance: x.name, module: x.module, port: c.port, kind: c.kind, text: c.text || "",
          reason: EXCLUDE_REASON[c.kind] || "분석하지 않는 연결 형태입니다", line: x.line
        });
        continue;
      }
      const info = lookupPort(def, c.port);
      // 인스턴스 배열은 비트별로 나뉘어 연결될 수 있으므로 폭을 판단하지 않는다.
      const bits = x.array ? null : info.bits;
      netInfo(c.net).endpoints.push({
        kind: "instance", instance: x.name, module: x.module, port: c.port, dir: info.dir,
        arrow: arrowOf(info.dir), bits, range: info.range, line: x.line, why: info.why, array: x.array
      });
    }
  }

  const list = [];
  for (const nt of nets.values()) {
    for (const e of nt.endpoints) e.reason = e.why ? NO_ARROW_REASON[e.why] || null : null;   // 화살표를 붙이지 않은 이유(화면 표시용)
    const drivers = nt.endpoints.filter(e => e.arrow === "to-net").length;
    const loads = nt.endpoints.filter(e => e.arrow === "from-net").length;
    const undirected = nt.endpoints.filter(e => e.arrow === "none").length;
    nt.counts = {drivers, loads, undirected};
    const note = (level, code, text) => nt.notes.push({level, code, text});

    if (drivers >= 2) note("warn", "multi-driver", "구동하는 포트가 " + drivers + "개입니다. 트라이스테이트 등 의도한 경우가 아니면 확인이 필요합니다.");
    // 폭 비교: 신호 선언과 연결 포트 중 폭을 계산할 수 있는 값만 비교한다. 추측하지 않는다.
    const known = [];
    if (nt.declared !== "none" && nt.bits != null) known.push({label: "신호 선언", bits: nt.bits});
    for (const e of nt.endpoints) {
      if (e.kind === "boundary" && nt.declared === "port") continue;   // 경계 포트는 신호 선언과 같은 값
      if (e.bits != null) known.push({label: e.kind === "boundary" ? "경계 포트 " + e.port : e.instance + "." + e.port, bits: e.bits});
    }
    if (new Set(known.map(k => k.bits)).size > 1) {
      note("warn", "width-mismatch", "폭이 서로 다릅니다(확인 필요): " + known.map(k => k.label + " " + k.bits + "비트").join(", "));
    }
    const widthUnknown = nt.endpoints.some(e => e.bits == null) || (nt.declared !== "none" && nt.bits == null);
    if (widthUnknown) note("info", "width-unknown", "폭 미확인인 항목이 있습니다. (parameter 폭, 방향 선언 없음, 정의 미제공, 인스턴스 배열 등은 폭을 계산하지 않습니다)");
    if (undirected) note("info", "unknown-dir", "방향을 판정하지 않은 포트 " + undirected + "개 포함 (inout, 정의 미제공, 정의에 없는 포트 등). 구동·수신 판정에서 제외했습니다.");
    if (!drivers) note("info", "no-driver", "알려진 구동 포트 없음. assign/always 등 다른 구동원은 분석하지 않으므로 구동원이 없다는 뜻은 아닙니다.");
    if (!loads) note("info", "no-load", "알려진 수신 포트 없음.");
    if (nt.endpoints.length === 1) note("info", "single-endpoint", "이 신호에 연결된 다른 포트를 찾지 못했습니다.");
    if (nt.declared === "none") note("info", "undeclared", "신호 선언(포트·wire·reg)을 찾지 못했습니다. 암묵적 net이거나 parameter 이름일 수 있습니다.");
    nt.notes.sort((a, b) => (a.level === "warn" ? 0 : 1) - (b.level === "warn" ? 0 : 1));
    list.push(nt);
  }

  const used = new Set(list.map(n => n.name));
  const unusedBoundary = mod.portOrder.filter(nm => !used.has(nm)).map(nm => {
    const p = mod.ports.get(nm);
    return {name: nm, dir: p.dir || null, bits: p.bits, range: p.range || null};
  });

  return {
    module: mod.name,
    line: mod.line,
    nets: list,
    excluded,
    unusedBoundary,
    instanceCount: mod.instances.length,
    summary: {
      netCount: list.length,
      instancePortCount: list.reduce((a, n) => a + n.endpoints.filter(e => e.kind === "instance").length, 0),
      excludedCount: excluded.length
    }
  };
}

// 계층 트리의 모든 노드를 id(전체 인스턴스 경로 기반)로 찾을 수 있게 한다.
// path: 최상위 모듈명부터 인스턴스명을 이은 배열, pathText: 점(.)으로 이은 문자열
function indexTree(root) {
  const map = new Map();
  const st = [[root, null, []]];
  while (st.length) {
    const [n, parent, names] = st.pop();
    const path = names.concat(parent ? n.instance : n.module);
    map.set(n.id, {node: n, parent: parent ? parent.id : null, path, pathText: path.join(".")});
    for (let i = n.children.length - 1; i >= 0; i--) st.push([n.children[i], n, path]);
  }
  return map;
}

if (typeof module !== "undefined" && module.exports) module.exports = {buildNets, indexTree};
