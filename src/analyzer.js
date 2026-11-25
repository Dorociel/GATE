// Verilog 간이 분석기: 주석 제거 → 토큰화 → 모듈/인스턴스 추출 → 계층 트리 구성
// DOM에 의존하지 않으며 Node(test/check.js)와 브라우저(Electron 창) 양쪽에서 쓴다.
const KW = new Set(("module macromodule endmodule input output inout wire reg tri tri0 tri1 wand wor triand trior trireg supply0 supply1 uwire " +
  "integer real realtime time event parameter localparam specparam genvar generate endgenerate assign deassign force release " +
  "always initial begin end if else for while forever repeat wait case casex casez endcase default fork join disable " +
  "function endfunction task endtask automatic signed unsigned vectored scalared defparam specify endspecify primitive endprimitive table endtable " +
  "posedge negedge or and nand nor xor xnor not buf bufif0 bufif1 notif0 notif1 nmos pmos cmos rnmos rpmos rcmos tran rtran tranif0 tranif1 rtranif0 rtranif1 pullup pulldown " +
  "small medium large strong0 strong1 pull0 pull1 weak0 weak1 highz0 highz1 config endconfig design instance cell use liblist library include incdir " +
  "logic bit byte int shortint longint typedef enum struct union interface endinterface package endpackage program endprogram class endclass " +
  "always_comb always_ff always_latch modport import export checker endchecker unique priority string var").split(" "));
const SV_KW = new Set("logic bit byte int shortint longint typedef enum struct union interface endinterface package endpackage program endprogram class endclass always_comb always_ff always_latch modport import export checker endchecker".split(" "));
const DIR_KW = new Set(["input", "output", "inout"]);
const NETD_KW = new Set("wire reg tri tri0 tri1 wand wor triand trior trireg supply0 supply1 uwire integer real realtime time".split(" "));
const SKIPSTMT_KW = new Set(["parameter", "localparam", "genvar", "event", "defparam", "specparam"]);
const HARMLESS_DIR = new Set(["`timescale", "`resetall", "`default_nettype", "`celldefine", "`endcelldefine"]);
const STMT_END_KW = new Set(["end", "endgenerate", "endfunction", "endtask", "endcase", "generate"]);

function stripComments(src, warnings) {
  let out = "", i = 0, bad = false;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== '"' && src[j] !== "\n") { if (src[j] === "\\") j++; j++; }
      out += src.slice(i, Math.min(j + 1, n)); i = j + 1;
    } else if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") i++;
    } else if (c === "/" && d === "*") {
      const j = src.indexOf("*/", i + 2);
      let seg;
      if (j < 0) { seg = src.slice(i); i = n; bad = true; } else { seg = src.slice(i, j + 2); i = j + 2; }
      out += seg.replace(/[^\n]/g, " ");
    } else { out += c; i++; }
  }
  if (bad) warnings.push("닫히지 않은 /* 주석이 있어 그 뒤의 코드는 모두 주석으로 처리되었습니다.");
  return out;
}

function tokenize(s) {
  const toks = [], n = s.length;
  const res = [
    ["dir", /`[A-Za-z_]\w*/y],
    ["id", /[A-Za-z_][A-Za-z0-9_$]*/y],
    ["esc", /\\\S+/y],
    ["sys", /\$[A-Za-z_][\w$]*/y],
    ["str", /"(?:[^"\\\n]|\\.)*"/y],
    ["num", /(?:\d[\d_]*)?'[sS]?[bBoOdDhH]\s*[0-9a-fA-FxXzZ?_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?/y]
  ];
  let i = 0, line = 1;
  while (i < n) {
    const c = s[i];
    if (c === "\n") { line++; i++; continue; }
    if (c === " " || c === "\t" || c === "\r" || c === "\f" || c === "\v") { i++; continue; }
    let hit = false;
    for (const [t, r] of res) {
      r.lastIndex = i;
      const m = r.exec(s);
      if (m) {
        const len = m[0].length;
        if (t === "esc") toks.push({t: "id", v: m[0].slice(1), line, esc: true, pos: i, end: i + len});
        else toks.push({t, v: m[0], line, pos: i, end: i + len});
        i += len; hit = true; break;
      }
    }
    if (!hit) { toks.push({t: "sym", v: c, line, pos: i, end: i + 1}); i++; }
  }
  return toks;
}

const bitsOf = r => {
  if (!r) return null;
  const m = /^\[(\d+):(\d+)\]$/.exec(r);
  return m ? Math.abs(+m[1] - +m[2]) + 1 : null;
};
const isSymTok = (t, v) => !!t && t.t === "sym" && t.v === v;

function splitTop(tokens) {
  const parts = []; let cur = [], d = 0;
  for (const t of tokens) {
    if (t.t === "sym") {
      if ("([{".includes(t.v)) d++;
      else if (")]}".includes(t.v)) d--;
      else if (t.v === "," && d === 0) { parts.push(cur); cur = []; continue; }
    }
    cur.push(t);
  }
  parts.push(cur);
  return parts;
}

// 선언 목록(포트·wire·reg) 해석: 'input [7:0] a, b' / 'output reg q' / ANSI 헤더 전체
function parseDeclList(tokens, clean) {
  const items = [], uses = new Set();
  let dir = null, range = null, seen = false, i = 0;
  const n = tokens.length;
  while (i < n) {
    const t = tokens[i];
    if (t.t === "id" && !t.esc && DIR_KW.has(t.v)) { dir = t.v; range = null; seen = false; i++; continue; }
    if (t.t === "id" && !t.esc && KW.has(t.v)) { if (NETD_KW.has(t.v) && !seen) range = null; i++; continue; }
    if (isSymTok(t, "[")) {
      let d = 0, j = i;
      for (; j < n; j++) {
        if (isSymTok(tokens[j], "[")) d++;
        else if (isSymTok(tokens[j], "]")) { d--; if (d === 0) break; }
      }
      if (j >= n) break;
      if (!seen) range = clean.slice(t.pos, tokens[j].end).replace(/\s+/g, "");
      i = j + 1; continue;
    }
    if (t.t === "id" && !seen) { items.push({name: t.v, dir, range, line: t.line}); seen = true; i++; continue; }
    if (isSymTok(t, "=")) {
      if (items.length) uses.add(items[items.length - 1].name);
      let d = 0; i++;
      for (; i < n; i++) {
        const u = tokens[i];
        if (u.t === "sym") {
          if ("([{".includes(u.v)) d++;
          else if (")]}".includes(u.v)) d--;
          else if (u.v === "," && d === 0) break;
        } else if (u.t === "id" && !KW.has(u.v)) uses.add(u.v);
      }
      continue;
    }
    if (isSymTok(t, ",")) { seen = false; i++; continue; }
    i++;
  }
  return {items, uses};
}

function analyze(src) {
  const warnings = [];
  if (!src.trim()) return {error: "입력창이 비어 있습니다. Verilog 코드를 붙여넣으세요."};
  if (src.length > 300000) return {error: "코드가 너무 큽니다. (최대 약 30만 자) 필요한 모듈만 붙여넣으세요."};

  const clean = stripComments(src, warnings);
  const toks = tokenize(clean);
  const n = toks.length;
  const isSym = (k, v) => k >= 0 && k < n && toks[k].t === "sym" && toks[k].v === v;
  const isName = t => !!t && t.t === "id" && (t.esc || !KW.has(t.v));
  const skipParen = k => {
    let d = 0;
    for (let m = k; m < n; m++) {
      if (isSym(m, "(")) d++;
      else if (isSym(m, ")")) { d--; if (d === 0) return m + 1; }
    }
    return -1;
  };
  const raw = tk => tk.length ? clean.slice(tk[0].pos, tk[tk.length - 1].end).replace(/\s+/g, " ") : "";

  const dirs = toks.filter(t => t.t === "dir" && !HARMLESS_DIR.has(t.v));
  if (dirs.length) {
    const names = [...new Set(dirs.map(d => d.v))].slice(0, 6).join(", ");
    warnings.push("컴파일러 지시어/매크로(" + names + ") " + dirs.length + "건 감지 (첫 위치 " + dirs[0].line + "줄): 처리하지 않으므로 포트·인스턴스·연결이 누락되거나 잘못 인식될 수 있습니다.");
  }

  function classify(inner) {
    if (!inner.length) return {kind: "open", text: ""};
    const text = raw(inner);
    if (inner.length === 1 && inner[0].t === "id") return {kind: "net", net: inner[0].v, text};
    if (inner.length === 1 && inner[0].t === "num") return {kind: "const", text};
    if (inner.length >= 4 && inner[0].t === "id" && isSymTok(inner[1], "[") && isSymTok(inner[inner.length - 1], "]")) {
      let d = 0, close = -1;
      for (let j = 1; j < inner.length; j++) {
        if (isSymTok(inner[j], "[")) d++;
        else if (isSymTok(inner[j], "]")) { d--; if (d === 0) { close = j; break; } }
      }
      if (close === inner.length - 1) return {kind: "select", net: inner[0].v, text};
    }
    return {kind: "expr", text};
  }

  function parseConns(pt) {
    const conns = []; let pos = 0;
    for (const p of splitTop(pt)) {
      if (!p.length) continue;
      if (isSymTok(p[0], ".")) {
        if (isSymTok(p[1], "*")) { conns.push({port: null, kind: "implicit", text: ".*"}); continue; }
        const nm = p[1];
        if (!nm || nm.t !== "id") { conns.push({port: null, kind: "expr", text: raw(p)}); continue; }
        if (p.length === 2) { conns.push({port: nm.v, kind: "implicit", text: "." + nm.v}); continue; }
        if (!isSymTok(p[2], "(")) { conns.push({port: nm.v, kind: "expr", text: raw(p.slice(2))}); continue; }
        let d = 0, e = -1;
        for (let j = 2; j < p.length; j++) {
          if (isSymTok(p[j], "(")) d++;
          else if (isSymTok(p[j], ")")) { d--; if (d === 0) { e = j; break; } }
        }
        const c = classify(p.slice(3, e < 0 ? p.length : e));
        c.port = nm.v;
        conns.push(c);
      } else { pos++; conns.push({port: null, kind: "positional", text: raw(p), index: pos}); }
    }
    return conns;
  }

  function matchInstance(k) {
    let j = k + 1;
    if (isSym(j, "#")) {
      if (!isSym(j + 1, "(")) return null;
      const e = skipParen(j + 1);
      if (e < 0) return null;
      j = e;
    }
    const insts = [];
    for (;;) {
      const nameTok = toks[j];
      if (!isName(nameTok)) return null;
      j++;
      let array = false;
      if (isSym(j, "[")) {
        let d = 0, m = j;
        for (; m < n; m++) { if (isSym(m, "[")) d++; else if (isSym(m, "]")) { d--; if (d === 0) break; } }
        if (m >= n) return null;
        j = m + 1; array = true;
      }
      if (!isSym(j, "(")) return null;
      const e = skipParen(j);
      if (e < 0) return null;
      insts.push({module: toks[k].v, name: nameTok.v, line: nameTok.line, array, conns: parseConns(toks.slice(j + 1, e - 1))});
      j = e;
      if (isSym(j, ",")) { j++; continue; }
      break;
    }
    if (!isSym(j, ";")) return null;
    return {insts, next: j + 1};
  }

  function addPort(mod, it, fromHeader) {
    let p = mod.ports.get(it.name);
    if (!p) { p = {name: it.name, dir: null, range: null, bits: null, line: it.line}; mod.ports.set(it.name, p); mod.portOrder.push(it.name); }
    if (it.dir) { p.dir = it.dir; p.range = it.range; p.declared = true; }
    else if (!fromHeader && it.range && !p.range) p.range = it.range;
  }

  const modules = [];
  let i = 0;
  while (i < n) {
    const t = toks[i];
    if (!(t.t === "id" && !t.esc && (t.v === "module" || t.v === "macromodule"))) { i++; continue; }
    const nameTok = toks[i + 1];
    if (!nameTok || nameTok.t !== "id") {
      warnings.push(t.line + "줄: module 뒤에서 모듈 이름을 찾지 못했습니다.");
      i++; continue;
    }
    const mod = {name: nameTok.v, line: t.line, endLine: null, instances: [], warns: [], terminated: false,
      ports: new Map(), portOrder: [], nets: new Map(), uses: new Set(), assigns: 0, always: 0};
    let k = i + 2;
    if (isSym(k, "#") && isSym(k + 1, "(")) { const e = skipParen(k + 1); k = e < 0 ? n : e; }
    if (isSym(k, "(")) {
      const e = skipParen(k);
      if (e < 0) k = n;
      else {
        const inner = toks.slice(k + 1, e - 1);
        if (inner.length) for (const it of parseDeclList(inner, clean).items) addPort(mod, it, true);
        k = e;
      }
    }
    if (isSym(k, ";")) k++;
    else mod.warns.push("모듈 헤더의 끝(;)을 찾지 못했습니다. 헤더 형식을 확인하세요.");

    const svSeen = new Set();
    let genSeen = false, inFn = false;
    while (k < n) {
      const b = toks[k];
      if (b.t === "id" && !b.esc) {
        if (b.v === "endmodule") { mod.terminated = true; mod.endLine = b.line; k++; break; }
        if (b.v === "module" || b.v === "macromodule") break;
        if (b.v === "generate" || b.v === "genvar") genSeen = true;
        if (SV_KW.has(b.v)) svSeen.add(b.v);
        if (b.v === "assign") mod.assigns++;
        if (b.v === "always" || b.v === "initial") mod.always++;
        if (b.v === "function" || b.v === "task") inFn = true;
        if (b.v === "endfunction" || b.v === "endtask") inFn = false;
      }
      if (inFn) { if (isName(b)) mod.uses.add(b.v); k++; continue; }

      const prev = toks[k - 1];
      const startOk = prev && ((prev.t === "sym" && prev.v === ";") || (prev.t === "id" && !prev.esc && STMT_END_KW.has(prev.v)));
      if (startOk && b.t === "id" && !b.esc && (DIR_KW.has(b.v) || NETD_KW.has(b.v) || SKIPSTMT_KW.has(b.v))) {
        let e = k;
        while (e < n && !isSym(e, ";")) e++;
        if (!SKIPSTMT_KW.has(b.v)) {
          const r = parseDeclList(toks.slice(k, e), clean);
          for (const it of r.items) {
            if (it.dir) addPort(mod, it, false);
            else mod.nets.set(it.name, {name: it.name, range: it.range, line: it.line});
          }
          r.uses.forEach(u => mod.uses.add(u));
        }
        k = e + 1; continue;
      }
      if (isName(b)) {
        if (startOk) {
          const r = matchInstance(k);
          if (r) {
            for (const x of r.insts) mod.instances.push(x);
            if (r.insts.length > 1) mod.warns.push(b.line + "줄: 한 선언문에 인스턴스가 여러 개(쉼표)입니다. 첫 버전 범위 밖이므로 확인하세요.");
            k = r.next; continue;
          }
        }
        if ((isName(toks[k + 1]) && (isSym(k + 2, "(") || isSym(k + 2, "["))) || (isSym(k + 1, "#") && isSym(k + 2, "("))) {
          mod.warns.push(b.line + "줄 '" + b.v + (isName(toks[k + 1]) ? " " + toks[k + 1].v : " #(…)") + " …': 인스턴스처럼 보이지만 인식하지 못했습니다. (generate 내부 등) 직접 확인하세요.");
        }
        mod.uses.add(b.v);
      }
      k++;
    }
    if (!mod.terminated) mod.warns.push("endmodule을 찾지 못했습니다. 이 모듈의 범위가 부정확할 수 있습니다.");
    if (genSeen) mod.warns.push("generate/genvar 구문 감지: 그 내부의 인스턴스·연결은 인식하지 못할 수 있습니다.");
    if (svSeen.size) mod.warns.push("SystemVerilog 키워드 감지(" + [...svSeen].join(", ") + "): 지원 범위 밖이라 결과가 부정확할 수 있습니다.");

    // 포트 폭 확정 (non-ANSI: 'output q; reg [7:0] q;' 병합)
    for (const p of mod.ports.values()) {
      if (!p.range && mod.nets.has(p.name) && mod.nets.get(p.name).range) p.range = mod.nets.get(p.name).range;
      p.bits = p.dir ? (p.range ? bitsOf(p.range) : 1) : null;
    }
    for (const nt of mod.nets.values()) nt.bits = nt.range ? bitsOf(nt.range) : 1;

    const seen = new Set();
    for (const x of mod.instances) {
      if (seen.has(x.name)) mod.warns.push("같은 모듈 안에 인스턴스 이름 '" + x.name + "'이(가) 중복됩니다.");
      seen.add(x.name);
      if (x.conns.some(c => c.kind === "positional")) mod.warns.push(x.line + "줄 " + x.name + ": 위치 기반 포트 연결은 추적하지 않습니다.");
      if (x.conns.some(c => c.kind === "implicit")) mod.warns.push(x.line + "줄 " + x.name + ": .* / .name 연결(SystemVerilog)은 추적하지 않습니다.");
      if (x.array) mod.warns.push(x.line + "줄 " + x.name + ": 인스턴스 배열입니다. 블록 1개로 표시합니다.");
    }
    modules.push(mod);
    i = k;
  }

  if (!modules.length) return {error: "module ~ endmodule 구조를 찾지 못했습니다. 코드를 확인하세요.", warnings};

  const modMap = new Map();
  for (const m of modules) {
    if (modMap.has(m.name)) warnings.push("모듈 '" + m.name + "'이(가) 중복 정의되었습니다. 먼저 나온 정의(" + modMap.get(m.name).line + "줄)를 사용합니다.");
    else modMap.set(m.name, m);
  }
  const used = new Set();
  for (const m of modules) for (const x of m.instances) used.add(x.module);
  const roots = [...modMap.keys()].filter(nm => !used.has(nm));
  const undef = [...used].filter(nm => !modMap.has(nm));
  const instCount = modules.reduce((a, m) => a + m.instances.length, 0);
  return {modules, modMap, roots, undef, instCount, warnings};
}

function buildTree(modMap, topName, cap) {
  let count = 0, truncated = false;
  function make(modName, instName, chain, path) {
    count++;
    const node = {id: path, module: modName, instance: instName, children: [], tag: "", kind: "normal"};
    const def = modMap.get(modName);
    if (!def) { node.kind = "undef"; node.tag = "정의 미제공"; return node; }
    if (chain.includes(modName)) { node.kind = "recursive"; node.tag = "재귀"; return node; }
    const nc = chain.concat(modName);
    def.instances.forEach((inst, idx) => {
      if (truncated) return;
      if (count >= cap) { truncated = true; node.tag = "일부 생략"; return; }
      node.children.push(make(inst.module, inst.name, nc, path + "/" + inst.name + "#" + idx));
    });
    return node;
  }
  const root = make(topName, "(최상위)", [], "top");
  return {root, count, truncated};
}


if (typeof module !== "undefined" && module.exports) module.exports = {analyze, buildTree, tokenize, stripComments};
