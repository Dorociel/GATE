// 테스트벤치 분석(제한된 간이 분석). DOM 에 의존하지 않는다.
//
// 이 분석은 코드를 읽을 뿐이며 시뮬레이션을 실행하지 않는다. 실행하지 않은 코드에 통과·실패를 붙이지 않는다.
// 지원하는 단순 Verilog 패턴: initial/always 블록, begin~end, #지연, @(이벤트), wait(조건), if/else, repeat/while/for/forever(본문은 시각 불명으로 표시),
//   대입(=, <=), 시스템 태스크($display/$finish/$stop/$error/$fatal/$dumpfile/$dumpvars 등), 클록 토글(#N clk = ~clk).
// 지원하지 않는 것은 숨기지 않고 ‘분석 미지원·추가 확인 필요’로 남긴다: task/function 정의와 호출, fork/join, case, generate, force/release, $random 등.
// 병렬로 실행되는 initial/always 블록은 하나의 순차 흐름으로 합치지 않고 블록별로 따로 보여 준다.
// 구분: level "code" = 코드에서 확인한 사실, level "inferred" = 이름·패턴에서 추정한 시험 의도(근거를 함께 적음).

const TB_TOK = (typeof tokenize !== "undefined") ? tokenize : require("./analyzer.js").tokenize;
const TB_STRIP = (typeof stripComments !== "undefined") ? stripComments : require("./analyzer.js").stripComments;
const TB_NETS = (typeof buildNets !== "undefined") ? buildNets : require("./nets.js").buildNets;

const TB_BANNER = "이 분석은 테스트벤치 코드를 읽은 결과입니다. 이 앱은 시뮬레이션을 실행하지 않으므로 통과·실패를 판정하지 않으며, 아래 내용은 코드에 적힌 내용입니다.";
const TB_SCOPE_NOTES = [
  "단순한 Verilog 패턴만 해석합니다: initial/always, begin~end, #지연, @(이벤트), wait(조건), if/else, 대입, $display/$finish 등 시스템 태스크, #N clk = ~clk 형태의 클록.",
  "task/function, fork/join, case, generate, force/release, $random 등은 해석하지 않고 ‘분석 미지원·추가 확인 필요’로 남깁니다.",
  "병렬 initial/always 블록은 하나의 순차 흐름으로 합치지 않고 블록별로 표시합니다. 블록 사이의 실행 순서·경쟁은 판단하지 않습니다.",
  "시각은 같은 initial 블록 안에서 #지연만 지나온 경우에만 계산하며(시작 0 기준), 이벤트 대기·반복문 이후는 ‘시각 불명’으로 둡니다.",
  "‘추정’ 표시는 이름(rst, clk 등)이나 패턴에서 짐작한 것이며 코드가 직접 밝힌 사실이 아닙니다.",
  "표시되는 시험 항목이 코드 전체의 동작을 모두 설명하지는 않습니다. 줄 번호는 해당 파일 기준입니다."
];

const tbNum = s => { const v = Number(String(s).replace(/_/g, "")); return Number.isFinite(v) && /^[\d_.]+$/.test(s) ? v : null; };

// 역할: roles = Map(fileId → "design"|"testbench"). 테스트벤치 후보 모듈 목록(역할 지정 + 패턴 힌트)
function tbCandidates(res, roles) {
  const out = [];
  for (const m of res.modules) {
    const roleTb = !!(roles && roles.get(m.fileId) === "testbench");
    const hints = [];
    if (roleTb) hints.push("테스트벤치 역할로 지정된 파일");
    if (m.ports.size === 0) hints.push("포트가 없음");
    if (m.always > 0) hints.push("initial/always 블록 있음");
    if (m.instances.length > 0) hints.push("하위 인스턴스 있음");
    const pattern = m.ports.size === 0 && m.always > 0 && m.instances.length > 0;
    if (roleTb || pattern) out.push({name: m.name, fileId: m.fileId, fileName: m.file.displayName, line: m.line, roleTb, pattern, hints});
  }
  return out;
}
// 파일 단위 힌트: 역할 지정 UI 에서 ‘테스트벤치로 보임(제안)’을 표시하는 데 쓴다(자동 확정 아님)
function tbFileHint(res, fileId) {
  return res.modules.some(m => m.fileId === fileId && m.ports.size === 0 && m.always > 0 && m.instances.length > 0);
}

/* ---------- 문장 파서 ---------- */
function tbParseModule(ts, src, startIdx, endIdx, out) {
  let i = startIdx;
  const isId = (k, v) => k < endIdx && ts[k] && ts[k].t === "id" && !ts[k].esc && (v === undefined || ts[k].v === v);
  const isSym = (k, v) => k < endIdx && ts[k] && ts[k].t === "sym" && ts[k].v === v;
  const text = (a, b) => a >= b ? "" : src.slice(ts[a].pos, ts[b - 1].end).replace(/\s+/g, " ");
  const matchParen = k => { let d = 0; for (let j = k; j < endIdx; j++) { if (isSym(j, "(")) d++; else if (isSym(j, ")")) { d--; if (d === 0) return j + 1; } } return endIdx; };
  const untilSemi = k => { let d = 0; for (let j = k; j < endIdx; j++) { const s = ts[j]; if (s.t === "sym") { if ("([{".includes(s.v)) d++; else if (")]}".includes(s.v)) d--; else if (s.v === ";" && d <= 0) return j; } } return endIdx; };
  const skipTo = (k, words) => { for (let j = k; j < endIdx; j++) if (ts[j].t === "id" && words.includes(ts[j].v)) return j; return endIdx; };

  function stmt() {
    const t = ts[i];
    if (!t || i >= endIdx) return null;
    const line = t.line;
    if (isSym(i, ";")) { i++; return {t: "null", line}; }
    if (isId(i, "begin")) {
      i++; let name = null;
      if (isSym(i, ":") && ts[i + 1]) { name = ts[i + 1].v; i += 2; }
      const body = [];
      while (i < endIdx && !isId(i, "end")) { const before = i; const s = stmt(); if (!s) break; body.push(s); if (i === before) i++; }
      const endLine = ts[i] && i < endIdx ? ts[i].line : line; i++;
      return {t: "block", name, stmts: body, line, endLine};
    }
    if (isSym(i, "#")) {
      i++; let amt;
      if (ts[i] && ts[i].t === "num") { amt = {text: ts[i].v, value: tbNum(ts[i].v)}; i++; }
      else if (isSym(i, "(")) { const e = matchParen(i); amt = {text: text(i, e), value: null}; i = e; }
      else if (ts[i]) { amt = {text: ts[i].v, value: null}; i++; }
      else amt = {text: "?", value: null};
      if (ts[i] && ts[i].t === "id" && /^(fs|ps|ns|us|ms|s)$/.test(ts[i].v) && ts[i - 1].end === ts[i].pos) { amt.unit = ts[i].v; i++; }
      const inner = stmt();
      return {t: "delay", amt, stmt: inner, line};
    }
    if (isSym(i, "@")) {
      i++; let ctl;
      if (isSym(i, "(")) { const e = matchParen(i); ctl = text(i + 1, e - 1); i = e; }
      else if (isSym(i, "*")) { ctl = "*"; i++; }
      else if (ts[i]) { ctl = ts[i].v; i++; } else ctl = "?";
      const inner = stmt();
      return {t: "event", ctl, stmt: inner, line};
    }
    if (isId(i, "wait") && isSym(i + 1, "(")) {
      const e = matchParen(i + 1); const cond = text(i + 2, e - 1); i = e;
      return {t: "wait", cond, stmt: stmt(), line};
    }
    if (isId(i, "if") && isSym(i + 1, "(")) {
      const e = matchParen(i + 1); const cond = text(i + 2, e - 1); i = e;
      const th = stmt(); let el = null;
      if (isId(i, "else")) { i++; el = stmt(); }
      return {t: "if", cond, then: th, else: el, line};
    }
    if ((isId(i, "repeat") || isId(i, "while") || isId(i, "for")) && isSym(i + 1, "(")) {
      const kind = ts[i].v; const e = matchParen(i + 1); const head = text(i + 2, e - 1); i = e;
      return {t: "loop", kind, head, body: stmt(), line};
    }
    if (isId(i, "forever")) { i++; return {t: "loop", kind: "forever", head: "", body: stmt(), line}; }
    if (isId(i, "fork")) { const e = skipTo(i, ["join", "join_any", "join_none"]); const txt = text(i, Math.min(e + 1, endIdx)); i = Math.min(e + 1, endIdx); return {t: "unsupported", what: "fork/join(병렬 실행)", text: txt, line}; }
    if (isId(i, "case") || isId(i, "casex") || isId(i, "casez")) { const e = skipTo(i, ["endcase"]); const txt = text(i, Math.min(e + 1, endIdx)); i = Math.min(e + 1, endIdx); return {t: "unsupported", what: "case 문", text: txt, line}; }
    if (isId(i, "disable") || isId(i, "force") || isId(i, "release") || isId(i, "deassign") || isId(i, "assign")) {
      const e = untilSemi(i); const what = ts[i].v; const txt = text(i, e); i = Math.min(e + 1, endIdx);
      return {t: "unsupported", what: what + " 문", text: txt, line};
    }
    if (t.t === "sys") {
      const name = t.v; i++; let args = "";
      if (isSym(i, "(")) { const e = matchParen(i); args = text(i + 1, e - 1); i = e; }
      if (isSym(i, ";")) i++;
      return {t: "sys", name, args, line};
    }
    if (t.t === "id" || isSym(i, "{")) {
      // 대입(lhs = rhs / lhs <= rhs), task 호출(name(args);), 그 외
      const e = untilSemi(i);
      let eq = -1, nb = false, d = 0;
      for (let j = i; j < e; j++) {
        const s = ts[j];
        if (s.t === "sym" && "([{".includes(s.v)) d++; else if (s.t === "sym" && ")]}".includes(s.v)) d--;
        else if (d === 0 && s.t === "sym" && s.v === "=" && !(ts[j - 1] && ts[j - 1].t === "sym" && "=!<>".includes(ts[j - 1].v) && ts[j - 1].end === s.pos && ts[j - 1].v !== "<") && !(ts[j + 1] && ts[j + 1].t === "sym" && ts[j + 1].v === "=" && ts[j + 1].pos === s.end)) { eq = j; break; }
        else if (d === 0 && s.t === "sym" && s.v === "<" && ts[j + 1] && ts[j + 1].t === "sym" && ts[j + 1].v === "=" && ts[j + 1].pos === s.end) { eq = j + 1; nb = true; break; }
      }
      if (eq > i) {
        const lhsEnd = nb ? eq - 1 : eq;
        const node = {t: "assign", lhs: text(i, lhsEnd), op: nb ? "<=" : "=", rhs: text(eq + 1, e), line};
        i = Math.min(e + 1, endIdx);
        return node;
      }
      if (t.t === "id") {
        const name = t.v; const args = isSym(i + 1, "(") ? text(i + 2, matchParen(i + 1) - 1) : "";
        const node = {t: "call", name, args, line, text: text(i, e)};
        i = Math.min(e + 1, endIdx);
        return node;
      }
    }
    const e = untilSemi(i); const txt = text(i, Math.max(e, i + 1)); i = Math.min(Math.max(e, i) + 1, endIdx);
    return {t: "unsupported", what: "해석하지 못한 문장", text: txt, line};
  }

  while (i < endIdx) {
    const t = ts[i];
    if (isId(i, "initial") || isId(i, "always")) {
      const kind = t.v; const line = t.line; i++;
      const s = stmt();
      out.blocks.push({kind, line, stmt: s, endLine: tbLastLine(s, line)});
    } else if (isId(i, "always_comb") || isId(i, "always_ff") || isId(i, "always_latch")) {
      out.unsupported.push({what: t.v + "(SystemVerilog)", line: t.line, text: ""}); i = skipTo(i + 1, ["end"]) + 1;
    } else if (isId(i, "task") || isId(i, "function")) {
      const kw = t.v, line = t.line; const e = skipTo(i, [kw === "task" ? "endtask" : "endfunction"]);
      let nm = ""; for (let j = i + 1; j < Math.min(e, i + 8); j++) if (ts[j].t === "id" && !["automatic", "integer", "reg", "signed", "real", "input"].includes(ts[j].v) && ts[j + 1] && (ts[j + 1].v === ";" || ts[j + 1].v === "(")) { nm = ts[j].v; break; }
      out.defs.push({kind: kw, name: nm, line});
      i = Math.min(e + 1, endIdx);
    } else if (isId(i, "generate")) {
      out.unsupported.push({what: "generate 블록", line: t.line, text: ""}); i = skipTo(i, ["endgenerate"]) + 1;
    } else i++;
  }
}
function tbLastLine(node, dflt) {
  if (!node) return dflt;
  let m = node.endLine || node.line || dflt;
  for (const k of ["stmt", "then", "else", "body"]) if (node[k]) m = Math.max(m, tbLastLine(node[k], m));
  if (node.stmts) node.stmts.forEach(s => { m = Math.max(m, tbLastLine(s, m)); });
  return m;
}

/* ---------- 분석 ---------- */
function analyzeTestbench(o) {
  const res = o.res, tbName = o.tb;
  const mod = res.modMap.get(tbName) || (res.defs.get(tbName) && res.defs.get(tbName)[0]);
  const out = {ok: false, error: null, module: tbName, file: null, line: null, endLine: null, timescale: null, dut: [], blocks: [], sections: {}, hasCompare: false, banner: TB_BANNER};
  const S = out.sections;
  for (const k of ["clock", "reset", "stimulus", "wait", "compare", "finish", "observe", "unsupported", "other"]) S[k] = [];
  if (!mod) { out.error = "모듈 ‘" + tbName + "’ 정의를 찾지 못했습니다."; return out; }
  if (res.defs.get(tbName) && res.defs.get(tbName).length > 1) { out.error = "‘" + tbName + "’ 모듈 정의가 충돌합니다. 충돌을 먼저 해결하세요."; return out; }
  const f = (o.files || []).find(x => x.id === mod.fileId);
  if (!f) { out.error = "정의 파일의 원문을 찾지 못했습니다."; return out; }
  out.file = {id: f.id, name: f.name, displayName: f.displayName || f.name}; out.line = mod.line; out.endLine = mod.endLine;
  const rawLines = String(f.text).split(/\r?\n/);
  const stripped = TB_STRIP(String(f.text), []);
  const ts = TB_TOK(stripped);
  let a = -1;
  for (let k = 0; k < ts.length - 1; k++) if (ts[k].t === "id" && (ts[k].v === "module" || ts[k].v === "macromodule") && ts[k].line === mod.line && ts[k + 1].v === mod.name) { a = k; break; }
  if (a < 0) { out.error = "모듈 본문 위치를 찾지 못했습니다."; return out; }
  let b = ts.length;
  for (let k = a + 1; k < ts.length; k++) if (ts[k].t === "id" && ts[k].v === "endmodule") { b = k; break; }
  // 시간 단위(`timescale): 모듈 앞쪽에서 가장 가까운 지시어
  const tsRe = /`timescale\s+([\d.]+\s*[a-z]+)\s*\/\s*([\d.]+\s*[a-z]+)/g; let mm;
  const pre = stripped.split("\n");
  for (let ln = 0; ln < mod.line; ln++) { tsRe.lastIndex = 0; mm = tsRe.exec(pre[ln] || ""); if (mm) out.timescale = {unit: mm[1].replace(/\s+/g, ""), precision: mm[2].replace(/\s+/g, ""), line: ln + 1}; }
  const unit = out.timescale ? (/[a-z]+$/.exec(out.timescale.unit) || [""])[0] : "";

  const parsed = {blocks: [], unsupported: [], defs: []};
  tbParseModule(ts, stripped, a + 1, b, parsed);

  const code = line => (rawLines[line - 1] || "").trim();
  let condDepth = 0;
  const COND_TAG = " [if 조건 안: 조건이 맞을 때만 실행되는 문장]";
  const ev = (cat, level, textv, line, extra) => { if (condDepth > 0 && cat !== "compare" && cat !== "other") textv += COND_TAG; const it = Object.assign({text: textv, level, file: out.file.displayName, line, code: code(line)}, extra || {}); S[cat].push(it); return it; };
  const atText = at => at.abs != null ? at.abs + (unit ? " " + unit : " (시간 단위 미지정)") + " (시뮬레이션 시작 기준)" : "시각 불명 — " + at.why;

  // 하위 인스턴스와 DUT 후보: buildNets 가 확인한 포트 방향만 사용
  let nets = null;
  try { nets = TB_NETS(res.modMap, tbName); } catch (e) { nets = null; }
  const outNets = new Map(), inNets = new Map();
  if (nets && !nets.error) nets.nets.forEach(nt => nt.endpoints.forEach(e => {
    if (e.kind !== "instance") return;
    if (e.arrow === "to-net") { if (!outNets.has(nt.name)) outNets.set(nt.name, []); outNets.get(nt.name).push(e.instance + "." + e.port); }
    if (e.arrow === "from-net") { if (!inNets.has(nt.name)) inNets.set(nt.name, []); inNets.get(nt.name).push(e.instance + "." + e.port); }
  }));
  const roles = o.roles || new Map();
  for (const x of mod.instances) {
    const defs = res.defs.get(x.module);
    const def = res.modMap.get(x.module);
    const helper = !!(def && roles.get(def.fileId) === "testbench");
    const conns = nets && !nets.error ? nets.nets.flatMap(nt => nt.endpoints.filter(e => e.kind === "instance" && e.instance === x.name).map(e => ({port: e.port, net: nt.name, dir: e.dir}))) : [];
    out.dut.push({instance: x.name, module: x.module, line: x.line, array: !!x.array, defined: !!def, conflict: !!(defs && defs.length > 1), helper,
      connected: conns.length, inputs: conns.filter(c => c.dir === "input").map(c => c.net), outputs: conns.filter(c => c.dir === "output").map(c => c.net),
      why: helper ? "테스트벤치 역할 파일에 정의된 모듈(보조 모델로 보임)" : !def ? "정의 미제공 모듈" : "설계 모듈의 인스턴스"});
  }
  const cands = out.dut.filter(d => d.defined && !d.helper);
  cands.forEach(d => { d.candidate = true; d.level = cands.length === 1 ? "inferred" : "inferred"; d.rank = cands.length === 1 ? "유일한 설계 모듈 인스턴스" : "설계 모듈 인스턴스 " + cands.length + "개 중 하나"; });

  // 블록 순회: 같은 블록 안의 순차 흐름만 시각을 계산한다
  const clocks = new Map(), resets = new Map();
  let blockNo = 0;
  const isToggle = node => node && node.t === "assign" && (new RegExp("^[~!]\\s*" + node.lhs.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$").test(node.rhs.trim()));
  const summarize = n => {
    if (!n) return "(동작 없음)";
    if (n.t === "sys") return n.name + (n.args ? "(" + n.args + ")" : "");
    if (n.t === "assign") return n.lhs + " " + n.op + " " + n.rhs;
    if (n.t === "block") return n.stmts.map(summarize).filter(s => s !== "(동작 없음)").join("; ") || "(동작 없음)";
    if (n.t === "delay") return "#" + n.amt.text + " " + summarize(n.stmt);
    if (n.t === "call") return n.name + "(" + n.args + ")";
    if (n.t === "null") return "(동작 없음)";
    return n.t;
  };
  const sysIn = n => { const r = []; (function w(x) { if (!x) return; if (x.t === "sys") r.push(x); ["stmt", "then", "else", "body"].forEach(k => w(x[k])); if (x.stmts) x.stmts.forEach(w); })(n); return r; };
  const FAILWORD = /fail|error|mismatch|wrong|bad|timeout/i;
  const idsIn = s => (s.match(/[A-Za-z_][A-Za-z0-9_$]*/g) || []);

  function walk(n, st, bi) {
    if (!n) return st;
    switch (n.t) {
      case "block": for (const s of n.stmts) st = walk(s, st, bi); return st;
      case "delay": {
        const v = n.amt.value;
        const nxt = (st.abs != null && v != null) ? {abs: st.abs + v} : {abs: null, why: st.abs == null ? st.why : "지연 값을 계산할 수 없음(#" + n.amt.text + ")"};
        if (isToggle(n.stmt)) {
          const sig = n.stmt.lhs;
          if (!clocks.has(sig)) clocks.set(sig, {sig, half: v, halfText: n.amt.text, line: n.line, block: bi, init: []});
          return nxt;
        }
        return walk(n.stmt, nxt, bi);
      }
      case "event": {
        ev("wait", "code", "이벤트 대기 @(" + n.ctl + ")", n.line, {block: bi, at: atText(st)});
        return walk(n.stmt, {abs: null, why: "@(" + n.ctl + ") 대기 이후"}, bi);
      }
      case "wait": {
        const outs = idsIn(n.cond).filter(x => outNets.has(x));
        ev("wait", "code", "조건 대기 wait (" + n.cond + ")" + (outs.length ? " — DUT 출력 " + outs.join(", ") + " 을(를) 기다림(연결: " + outs.map(x => outNets.get(x)[0]).join(", ") + ")" : ""), n.line, {block: bi, at: atText(st)});
        return walk(n.stmt, {abs: null, why: "wait (" + n.cond + ") 이후"}, bi);
      }
      case "if": {
        const hasCmp = /(===|!==|==|!=)/.test(n.cond);
        const outs = idsIn(n.cond).filter(x => outNets.has(x));
        const msgs = sysIn(n.then).concat(sysIn(n.else));
        const msgy = msgs.some(m => /^\$(display|write|error|fatal|stop|finish|monitor|strobe)$/.test(m.name));
        if (hasCmp && (outs.length || msgy)) {
          out.hasCompare = true;
          ev("compare", "code", "조건 (" + n.cond + ") 이 참이면 [" + summarize(n.then) + "], 아니면 [" + (n.else ? summarize(n.else) : "동작 없음") + "]" +
            (outs.length ? " — DUT 출력 " + outs.join(", ") + " 을(를) 비교(연결: " + outs.map(x => outNets.get(x)[0]).join(", ") + ")" : " — DUT 출력과의 연결은 확인하지 못함"), n.line,
            {block: bi, at: atText(st), note: "비교 결과는 실행해야 알 수 있으며 이 앱은 통과·실패를 판정하지 않습니다."});
        } else {
          ev("other", "code", "조건문 if (" + n.cond + ") — 출력 비교로 분류하지 않았습니다: [" + summarize(n.then) + "]" + (n.else ? " / [" + summarize(n.else) + "]" : ""), n.line, {block: bi, at: atText(st)});
        }
        condDepth++;
        const s1 = walk(n.then, st, bi), s2 = n.else ? walk(n.else, st, bi) : st;
        condDepth--;
        return (s1.abs === s2.abs) ? s1 : {abs: null, why: "if 분기에 따라 달라짐(줄 " + n.line + ")"};
      }
      case "loop": {
        ev("wait", "code", "반복 " + n.kind + (n.head ? " (" + n.head + ")" : "") + " — 본문은 반복되므로 시각을 계산하지 않음", n.line, {block: bi, at: atText(st)});
        walk(n.body, {abs: null, why: "반복문(" + n.kind + ") 안"}, bi);
        return {abs: null, why: "반복문(" + n.kind + ") 이후"};
      }
      case "assign": {
        const rec = {lhs: n.lhs, op: n.op, rhs: n.rhs, line: n.line, at: st, block: bi, kind: bi.kind, cond: condDepth > 0};
        bi.assigns.push(rec);
        return st;
      }
      case "sys": {
        const nm = n.name;
        const failMsg = FAILWORD.test(n.args || "");
        if (nm === "$finish" || nm === "$stop" || nm === "$fatal" || nm === "$error")
          ev("finish", "code", nm + (n.args ? "(" + n.args + ")" : "") + " 호출" + (nm === "$finish" ? " — 시뮬레이션 종료" : nm === "$stop" ? " — 시뮬레이션 정지" : " — 오류 보고"), n.line, {block: bi, at: atText(st)});
        else if (/^\$(display|write|monitor|strobe)$/.test(nm)) {
          if (failMsg) ev("finish", "code", nm + "(" + n.args + ") — 실패·오류·타임아웃을 뜻하는 문구를 출력", n.line, {block: bi, at: atText(st)});
          else ev("observe", "code", nm + "(" + n.args + ") — 로그 출력", n.line, {block: bi, at: atText(st)});
        }
        else if (nm === "$dumpfile" || nm === "$dumpvars" || nm === "$dumpon" || nm === "$dumpoff") ev("observe", "code", nm + (n.args ? "(" + n.args + ")" : "") + " — 파형(VCD) 기록 지정", n.line, {block: bi, at: atText(st)});
        else if (/^\$(random|urandom|urandom_range|dist_.*)$/.test(nm)) ev("unsupported", "code", nm + " 사용 — 난수 값은 해석하지 않습니다(분석 미지원·추가 확인 필요)", n.line, {block: bi, at: atText(st)});
        else if (/^\$(readmem[bh]|fopen|fscanf|fdisplay|fwrite|fclose|value\$plusargs|test\$plusargs)$/.test(nm)) ev("unsupported", "code", nm + " 사용 — 파일·인자 입출력은 해석하지 않습니다(분석 미지원·추가 확인 필요)", n.line, {block: bi, at: atText(st)});
        else ev("other", "code", nm + (n.args ? "(" + n.args + ")" : "") + " — 이 앱이 해석하지 않는 시스템 태스크", n.line, {block: bi, at: atText(st)});
        return st;
      }
      case "call": ev("unsupported", "code", "사용자 task 호출 " + n.text + " — task 본문은 해석하지 않습니다(분석 미지원·추가 확인 필요)", n.line, {block: bi, at: atText(st)}); return st;
      case "unsupported": ev("unsupported", "code", n.what + (n.text ? ": " + n.text.slice(0, 80) : "") + " — 분석 미지원·추가 확인 필요", n.line, {block: bi, at: atText(st)}); return st;
      default: return st;
    }
  }
  parsed.blocks.forEach((blk, k) => {
    const bi = {no: k + 1, kind: blk.kind, line: blk.line, endLine: blk.endLine, assigns: [], start: blk.kind === "initial" ? "시뮬레이션 시작(시각 0)에 실행" : "조건·지연이 반복될 때마다 실행(시각 불명)"};
    bi.title = (blk.kind === "initial" ? "initial" : "always") + " 블록 " + bi.no + " (줄 " + blk.line + "–" + blk.endLine + ")";
    out.blocks.push(bi);
    walk(blk.stmt, blk.kind === "initial" ? {abs: 0} : {abs: null, why: "always 블록은 반복 실행됨"}, bi);
  });
  blockNo = parsed.blocks.length;

  // 클록 · 리셋 · 입력 설정: 대입 기록에서 분류
  for (const bi of out.blocks) for (const as of bi.assigns) {
    const sig = as.lhs.replace(/\[.*$/, "").trim();
    if (clocks.has(sig)) { if (bi.kind === "initial" && as.at.abs === 0) clocks.get(sig).init.push(as); continue; }
    if (/rst|reset/i.test(sig)) { if (!resets.has(sig)) resets.set(sig, []); resets.get(sig).push(as); continue; }
    const toDut = inNets.get(sig);
    ev("stimulus", "code", sig + " " + as.op + " " + as.rhs + (toDut ? " — DUT 입력 " + toDut.join(", ") + " 으로 연결된 신호(연결 확인)" : bi.kind === "initial" ? "" : " (always 블록 안의 대입)") + (as.cond ? COND_TAG : ""), as.line,
      {block: bi, at: atText(as.at), signal: sig, dutInput: !!toDut});
  }
  const periodText = (c, un) => c.half != null ? "반주기 " + c.half + (un ? " " + un : "") + " → 주기 " + (2 * c.half) + (un ? " " + un : "") : "반주기 " + c.halfText + "(값 계산 불가)";
  for (const c of clocks.values()) {
    const initv = c.init.length ? ", 초기값 " + c.init.map(x => x.rhs).join("/") + "(줄 " + c.init.map(x => x.line).join(",") + ")" : "";
    const toDut = inNets.get(c.sig);
    ev("clock", "code", "클록 토글 패턴: " + c.sig + " = ~" + c.sig + " 을(를) #" + c.halfText + " 마다 반복 — " + periodText(c, unit) + initv + (toDut ? " — DUT 입력 " + toDut.join(", ") + " 에 연결" : ""), c.line, {block: c.block});
    ev("clock", "inferred", c.sig + " 은(는) 클록 생성용으로 보입니다(추정: #지연마다 값 반전)", c.line, {block: c.block});
  }
  for (const [sig, list] of resets) {
    const seq = list.map(x => "[" + atText(x.at).replace(" (시뮬레이션 시작 기준)", "") + "] " + x.rhs).join(" → ");
    const toDut = inNets.get(sig);
    ev("reset", "code", sig + " 대입 순서: " + seq + (toDut ? " — DUT 입력 " + toDut.join(", ") + " 에 연결" : ""), list[0].line, {block: list[0].block, at: ""});
    const vals = list.map(x => x.rhs.replace(/\s/g, "").replace(/^\d*'[bB]/, "")).join("");
    const act = /^0.*1$/.test(vals) ? "0 → 1 이어서 active-low 리셋 해제로 보임" : /^1.*0$/.test(vals) ? "1 → 0 이어서 active-high 리셋 해제로 보임" : "";
    ev("reset", "inferred", sig + " 은(는) 이름(rst/reset)으로 보아 리셋으로 추정" + (act ? "; 값 순서(" + act + ")" : ""), list[0].line, {block: list[0].block});
  }
  // DUT 출력 비교가 하나도 없으면 관찰용 안내(추정)
  const failMsgs = S.finish.some(x => /실패|오류|타임아웃/.test(x.text) && !/종료|정지/.test(x.text)) || S.finish.some(x => /\$(error|fatal)/.test(x.text));
  if (!out.hasCompare) ev("observe", "inferred", "자동 비교(출력과 기대값 비교) 조건을 찾지 못했습니다. 파형·로그 관찰용 테스트벤치일 수 있습니다(추정)" + (failMsgs ? " — 다만 오류를 뜻하는 출력문은 있습니다" : ""), mod.line, {});
  for (const d of parsed.defs) ev("unsupported", "code", d.kind + " " + (d.name || "(이름 확인 불가)") + " 정의 — task/function 본문은 해석하지 않습니다(분석 미지원·추가 확인 필요)", d.line, {});
  for (const u of parsed.unsupported) ev("unsupported", "code", u.what + " — 분석 미지원·추가 확인 필요", u.line, {});
  for (const k in S) S[k].sort((p, q) => p.line - q.line);
  if (!out.blocks.length) ev("unsupported", "code", "initial/always 블록을 찾지 못했습니다. 이 모듈이 테스트벤치가 아닐 수 있습니다.", mod.line, {});
  out.ok = true;
  return out;
}

if (typeof module !== "undefined" && module.exports) module.exports = {analyzeTestbench, tbCandidates, tbFileHint, TB_BANNER, TB_SCOPE_NOTES};
