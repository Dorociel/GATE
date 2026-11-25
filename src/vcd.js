// VCD(Value Change Dump) 읽기·값 조회·설계 경로 연결. DOM 에 의존하지 않는다.
//
// 이 모듈은 '이미 만들어진 VCD 파일'을 해석할 뿐이며 시뮬레이션을 실행하거나 값을 계산하지 않는다.
// 지원: $timescale, $scope/$upscope, $var(wire/reg/integer/real 등), #시간, 0/1/x/z 스칼라, b벡터, r실수, $dumpvars 류.
// 한계: 시간은 JS 숫자로 읽는다(2^53 초과 불가). 이벤트 수·크기 상한을 넘으면 앞부분만 읽고 '일부만 읽음'을 표시한다.
//       ‘이름이 같은 신호’ 규칙으로만 설계와 연결하며 generate 블록 이름·인스턴스 배열 등은 연결하지 못한다(미매핑 목록에 남는다).

const VCD_MAX_CHARS = 8 * 1024 * 1024;
const VCD_MAX_CHANGES = 1000000;
const VCD_PLAY_NOTE = "이미 만들어진 VCD 파일의 기록을 재생하는 기능입니다. 이 앱이 시뮬레이션을 실행하거나 계산한 값이 아닙니다.";

function vcdParse(text) {
  const out = {ok: false, error: null, warnings: [], timescale: null, version: "", date: "", vars: [], scopes: [], root: {name: "", path: [], children: [], vars: [], kind: "root"},
    recs: new Map(), startTime: null, endTime: 0, changeCount: 0, truncated: false};
  text = String(text || "");
  if (!text.trim()) { out.error = "비어 있는 파일입니다."; return out; }
  if (text.length > VCD_MAX_CHARS) { text = text.slice(0, VCD_MAX_CHARS); out.truncated = true; out.warnings.push("파일이 커서 앞 " + Math.round(VCD_MAX_CHARS / 1048576) + "MB(문자 수 기준)만 읽었습니다. 뒤쪽 시간대는 재생되지 않습니다."); }
  const re = /\S+/g;
  let m, inHeader = true, cur = out.root, t = 0, sawEnd = false;
  const next = () => { m = re.exec(text); return m ? m[0] : null; };
  const readUntilEnd = () => { const a = []; let x; while ((x = next()) !== null && x !== "$end") a.push(x); return a; };

  while ((m = re.exec(text)) !== null) {
    const tok = m[0];
    if (inHeader) {
      if (tok[0] !== "$") continue;
      if (tok === "$scope") {
        const a = readUntilEnd(); const sc = {name: a[1] || "?", kind: a[0] || "module", path: cur.path.concat(a[1] || "?"), children: [], vars: [], parent: cur};
        cur.children.push(sc); out.scopes.push(sc); cur = sc;
      } else if (tok === "$upscope") { readUntilEnd(); if (cur.parent) cur = cur.parent; else out.warnings.push("$upscope 가 $scope 보다 많습니다."); }
      else if (tok === "$var") {
        const a = readUntilEnd();
        if (a.length < 4) { out.warnings.push("읽을 수 없는 $var 선언을 건너뜀: " + a.join(" ")); continue; }
        const v = {idx: out.vars.length, type: a[0], size: parseInt(a[1], 10) || 1, code: a[2], name: a[3], range: a[4] || "", path: cur.path, scope: cur};
        out.vars.push(v); cur.vars.push(v);
        let rec = out.recs.get(v.code);
        if (!rec) { rec = {code: v.code, times: [], vals: [], size: v.size, type: v.type}; out.recs.set(v.code, rec); }
        v.rec = rec;
      }
      else if (tok === "$timescale") {
        const a = readUntilEnd().join("");
        const mm = /^(\d+)\s*(fs|ps|ns|us|ms|s)$/.exec(a);
        out.timescale = mm ? {num: +mm[1], unit: mm[2], text: mm[1] + " " + mm[2]} : null;
        if (!mm) out.warnings.push("시간 단위(" + a + ")를 해석하지 못했습니다. 시점은 단위 없이 숫자로만 표시합니다.");
      }
      else if (tok === "$version") out.version = readUntilEnd().join(" ");
      else if (tok === "$date") out.date = readUntilEnd().join(" ");
      else if (tok === "$enddefinitions") { readUntilEnd(); inHeader = false; sawEnd = true; }
      else readUntilEnd();    // $comment 등
      continue;
    }
    const c = tok[0];
    if (c === "#") { t = Number(tok.slice(1)); if (!Number.isFinite(t)) { out.warnings.push("읽을 수 없는 시점: " + tok); continue; } if (out.startTime === null) out.startTime = t; if (t > out.endTime) out.endTime = t; continue; }
    if (c === "$") continue;   // $dumpvars/$dumpall/$dumpon/$dumpoff/$end: 안의 값 변화는 그대로 읽는다
    let code, val;
    if (c === "b" || c === "B") { val = tok.slice(1).toLowerCase(); code = next(); }
    else if (c === "r" || c === "R") { val = tok.slice(1); code = next(); }
    else { val = c.toLowerCase(); code = tok.slice(1); }
    const rec = out.recs.get(code);
    if (!rec || code == null) { if (!out._unknown) out._unknown = new Set(); out._unknown.add(String(code)); continue; }
    if (out.startTime === null) out.startTime = t;
    const k = rec.times.length;
    if (k && rec.times[k - 1] === t) rec.vals[k - 1] = val;      // 같은 시점의 마지막 값을 쓴다
    else { rec.times.push(t); rec.vals.push(val); }
    if (++out.changeCount >= VCD_MAX_CHANGES) { out.truncated = true; out.warnings.push("값 변화가 " + VCD_MAX_CHANGES + "건을 넘어 여기까지만 읽었습니다(일부만 읽음)."); break; }
  }
  if (out._unknown) out.warnings.push("선언되지 않은 식별자의 값 변화를 무시했습니다(" + [...out._unknown].slice(0, 5).join(", ") + (out._unknown.size > 5 ? " 외 " + (out._unknown.size - 5) + "개" : "") + ").");
  if (!sawEnd) { out.error = "$enddefinitions 가 없어 VCD 형식으로 읽을 수 없습니다."; return out; }
  if (!out.vars.length) { out.error = "$var 신호 선언이 없습니다."; return out; }
  if (out.startTime === null) out.startTime = 0;
  out.ok = true;
  out.scopePaths = out.scopes.map(s => s.path);
  return out;
}

// 경로(스코프 이름 배열)로 스코프 찾기. 빈 배열은 루트(최상위 스코프들의 부모)
function vcdScopeAt(vcd, path) {
  let s = vcd.root;
  for (const nm of path) { s = s.children.find(c => c.name === nm); if (!s) return null; }
  return s;
}
function vcdVarIn(scope, name) { return scope ? scope.vars.find(v => v.name === name) || null : null; }

// 시점 t 에서의 값(해당 시점 또는 그 이전의 마지막 변화). 첫 변화 이전이면 null
function vcdValueAt(rec, t) {
  const ts = rec.times; let lo = 0, hi = ts.length - 1, r = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (ts[mid] <= t) { r = mid; lo = mid + 1; } else hi = mid - 1; }
  return r < 0 ? null : rec.vals[r];
}
// 여러 신호(rec 배열)의 값 변경 시점을 합쳐 정렬한 배열
function vcdChangeTimes(recs) {
  const set = new Set();
  for (const r of recs) for (const x of r.times) set.add(x);
  return [...set].sort((a, b) => a - b);
}
function vcdStep(times, t, dir) {
  if (dir > 0) { for (let i = 0; i < times.length; i++) if (times[i] > t) return times[i]; return null; }
  for (let i = times.length - 1; i >= 0; i--) if (times[i] < t) return times[i];
  return null;
}

// 값 표시: {text, cls} cls = "0" | "1" | "x" | "z" | "v"(0/1 로만 이뤄진 벡터) | "r"(실수) | "n"(값 없음)
function vcdFormat(val, size, type) {
  if (val == null) return {text: "—", cls: "n"};
  if (type === "real" || type === "realtime") return {text: String(Number(val)), cls: "r"};
  const n = size || 1;
  if (n === 1) {
    const v = String(val).slice(-1);
    return v === "0" || v === "1" ? {text: v, cls: v} : v === "z" ? {text: "Z", cls: "z"} : {text: "X", cls: "x"};
  }
  let bits = String(val);
  if (bits.length < n) bits = (bits[0] === "1" ? "0" : bits[0]).repeat(n - bits.length) + bits;    // 왼쪽 확장(1 은 0 으로, x/z 는 그대로)
  if (bits.length > n) bits = bits.slice(bits.length - n);
  const hasX = /[^01z]/.test(bits), hasZ = bits.includes("z");
  if (/^[01]+$/.test(bits)) {
    return {text: n + "'h" + (n <= 64 ? hexOf(bits) : "…"), cls: "v", bits};
  }
  if (/^x+$/.test(bits)) return {text: "X", cls: "x", bits};
  if (/^z+$/.test(bits)) return {text: "Z", cls: "z", bits};
  const txt = n <= 8 ? n + "'b" + bits.toUpperCase().replace(/(.{4})(?=.)/g, "$1_") : n + "'h" + hexOf(bits);
  return {text: txt, cls: hasX ? "x" : hasZ ? "z" : "v", bits};
}
function hexOf(bits) {
  const pad = (4 - bits.length % 4) % 4;
  const b = "0".repeat(pad) + bits;
  let s = "";
  for (let i = 0; i < b.length; i += 4) {
    const q = b.slice(i, i + 4);
    if (/^[01]{4}$/.test(q)) s += parseInt(q, 2).toString(16).toUpperCase();
    else if (/^x{4}$/.test(q)) s += "x"; else if (/^z{4}$/.test(q)) s += "z";
    else s += /x/.test(q) ? "X" : "Z";
  }
  return s;
}

function vcdTimeText(vcd, t) {
  if (t == null) return "—";
  const ts = vcd.timescale;
  return ts ? (t * ts.num) + " " + ts.unit : t + " (시간 단위 미확인)";
}

// 스코프 목록(선택 상자용): 경로 문자열·변수 수
function vcdScopeList(vcd) {
  return vcd.scopes.map(s => ({path: s.path, text: s.path.join("."), vars: s.vars.length, kind: s.kind}));
}

// 기준 경로 제안: 설계의 인스턴스 경로(최상위 제외)를 VCD 스코프 아래에서 가장 많이 찾을 수 있는 스코프.
// 제안일 뿐이며 사용자가 바꿀 수 있다(점수가 낮으면 weak).
function vcdSuggestBase(vcd, relPaths, rootName) {
  let best = null;
  for (const s of vcd.scopes) {
    let score = 0;
    for (const rp of relPaths) if (rp.length && vcdScopeAt(vcd, s.path.concat(rp))) score++;
    const nameHit = rootName && s.name === rootName ? 1 : 0;
    const cand = {path: s.path, text: s.path.join("."), score, nameHit, depth: s.path.length};
    if (!best || cand.score > best.score || (cand.score === best.score && cand.nameHit > best.nameHit) ||
        (cand.score === best.score && cand.nameHit === best.nameHit && cand.depth < best.depth)) best = cand;
  }
  if (!best) return null;
  best.weak = best.score === 0;
  return best;
}

// 그래프 모델(netgraph 의 모델) ↔ VCD 연결.
// base: 기준 스코프 경로(설계 최상위에 해당하는 VCD 스코프), relPath: 대상 모듈 인스턴스의 최상위 기준 경로(최상위 제외)
// 반환 map: 키("s:신호명" / "r:인스턴스.포트") → {v: VCD 변수, widthWarn}, unmapped: 연결하지 못한 항목(사유 포함)
function vcdMapGraph(vcd, base, relPath, model) {
  const tpath = base.concat(relPath);
  const tScope = vcdScopeAt(vcd, tpath);
  const map = new Map(), unmapped = [];
  const note = (key, label, why) => unmapped.push({key, label, why});
  const tText = tpath.join(".") || "(최상위)";
  for (const s of model.signals) {
    if (!tScope) { note(s.key, "신호 " + s.net, "VCD 에 스코프 ‘" + tText + "’ 가 없음"); continue; }
    const v = vcdVarIn(tScope, s.net);
    if (!v) { note(s.key, "신호 " + s.net, "VCD 스코프 ‘" + tText + "’ 에 ‘" + s.net + "’ 신호가 없음"); continue; }
    map.set(s.key, {v, widthWarn: s.bits != null && v.size !== s.bits ? "설계 " + s.bits + "비트 / VCD " + v.size + "비트" : null});
  }
  for (const inst of model.instances) {
    const cText = tpath.concat(inst.name).join(".");
    const cScope = tScope ? tScope.children.find(c => c.name === inst.name) : null;
    for (const r of inst.rows) {
      if (r.kind !== "net") continue;
      const label = "포트 " + inst.name + "." + r.port;
      if (inst.array) { note(r.key, label, "인스턴스 배열은 VCD 경로를 연결하지 않음"); continue; }
      if (!cScope) { note(r.key, label, "VCD 에 스코프 ‘" + cText + "’ 가 없음" + (tScope ? "" : "(대상 스코프 없음)")); continue; }
      const v = vcdVarIn(cScope, r.port);
      if (!v) { note(r.key, label, "VCD 스코프 ‘" + cText + "’ 에 ‘" + r.port + "’ 신호가 없음"); continue; }
      map.set(r.key, {v, widthWarn: r.bits != null && v.size !== r.bits ? "설계 " + r.bits + "비트 / VCD " + v.size + "비트" : null});
    }
  }
  return {map, unmapped, targetScope: tScope ? tpath : null, targetText: tText};
}

if (typeof module !== "undefined" && module.exports) module.exports = {vcdParse, vcdScopeAt, vcdValueAt, vcdChangeTimes, vcdStep, vcdFormat, vcdTimeText, vcdScopeList, vcdSuggestBase, vcdMapGraph, VCD_PLAY_NOTE};
