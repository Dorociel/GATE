// 여러 Verilog 소스(파일)를 하나의 설계로 합치는 순수 로직 (DOM·파일 접근 없음, Node/Electron 공용)
// - 파서는 바꾸지 않는다: 파일마다 analyze() 를 그대로 호출하므로 모듈 줄 번호는 항상 "그 파일 기준"이다.
// - 연결은 모듈명·인스턴스 참조로만 한다. 파일명·신호 이름으로 추측하지 않는다.
// - 같은 모듈명이 둘 이상 정의되면 덮어쓰지 않고 충돌(conflicts)로 남기며, modMap 에는 넣지 않는다.
// - 이 파일은 화면(index.html)에 아직 연결하지 않았다. (다음 단계에서 연결)
// 의존: analyze() (analyzer.js). Node 에서는 require, 화면에서는 전역을 쓴다.

const DESIGN_ANALYZE = (typeof analyze !== "undefined") ? analyze : require("./analyzer.js").analyze;

const ALLOWED_EXT = [".v", ".sv"];
const SV_HINT_WORDS = ["logic", "bit", "byte", "int", "shortint", "longint", "typedef", "enum", "struct", "union", "interface",
  "package", "program", "class", "always_comb", "always_ff", "always_latch", "modport", "import"];
const SV_NOTE = "확장자 .sv 를 선택할 수 있다는 것이 SystemVerilog 문법을 지원한다는 뜻은 아닙니다. 이 프로그램은 SystemVerilog 문법을 지원하지 않으며 모듈·포트·연결이 누락되거나 잘못 인식될 수 있습니다.";
const INCLUDE_NOTE = "`include 가 있습니다. include 대상 파일은 자동으로 찾거나 분석하지 않습니다. 필요한 파일은 직접 추가해야 하며, 그 전까지 해당 내용은 분석에 포함되지 않습니다.";

function dzExt(name) {
  const m = /(\.[^.\\/]+)$/.exec(String(name || ""));
  return m ? m[1].toLowerCase() : "";
}

// 확장자 검사: .v, .sv 만 허용. (.vh 와 include 경로 해석은 이번 범위 밖)
function checkExtension(name) {
  const ext = dzExt(name);
  if (!ALLOWED_EXT.includes(ext)) {
    return {ok: false, ext, reason: "'" + name + "': 지원하는 확장자는 .v, .sv 입니다." + (ext === ".vh" ? " (.vh 헤더 파일과 include 경로 해석은 지원하지 않습니다.)" : "")};
  }
  return {ok: true, ext, note: ext === ".sv" ? SV_NOTE : null};
}

function dzStripComments(t) { return String(t).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, ""); }

/* ---------- 소스 파일 추가 (같은 이름 처리) ---------- */
// 브라우저 파일 선택(File)에서 실제로 얻을 수 있는 식별 정보: 이름, 크기, 마지막 수정 시각, (폴더 선택 시) 상대 경로.
// 디스크의 전체 경로와 파일 고유 ID는 얻을 수 없다. 따라서 이름·크기·수정 시각·내용이 같아도 "같은 파일"이라고 확정하지 않는다.
function dzNextIdNumber(files) {
  let max = 0;
  for (const f of files) { const m = /^f(\d+)$/.exec(f.id); if (m) max = Math.max(max, +m[1]); }
  return max + 1;
}
function dzDisplayName(name, files) {
  const used = new Set(files.map(f => f.displayName.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  const m = /^(.*?)(\.[^.\\/]+)?$/.exec(name);
  const base = m[1], ext = m[2] || "";
  for (let n = 2; ; n++) { const c = base + " (" + n + ")" + ext; if (!used.has(c.toLowerCase())) return c; }
}

// incoming: [{name, text, size?, lastModified?, origin?}]  decisions: {입력 순번: "skip" | "separate"}
// 같은 이름이 이미 있으면 결정이 있을 때까지 pending 으로 남기고 추가하지 않는다.
function planAddFiles(existing, incoming, decisions) {
  const dec = decisions || {};
  const files = existing.slice();
  const added = [], skipped = [], rejected = [], pending = [];
  let seq = dzNextIdNumber(files);
  incoming.forEach((inc, index) => {
    const ext = checkExtension(inc.name);
    if (!ext.ok) { rejected.push({index, name: inc.name, reason: ext.reason}); return; }
    const key = inc.name.toLowerCase();
    const same = files.filter(f => f.name.toLowerCase() === key);
    if (same.length && dec[index] !== "separate") {
      if (dec[index] === "skip") { skipped.push({index, name: inc.name}); return; }
      const size = inc.size != null ? inc.size : inc.text.length;
      const matches = same.map(f => ({
        id: f.id, displayName: f.displayName,
        sameText: f.text === inc.text,
        sameSize: f.size === size,
        sameModified: f.lastModified != null && inc.lastModified != null && f.lastModified === inc.lastModified
      }));
      const anyText = matches.some(m => m.sameText);
      pending.push({index, name: inc.name, matches, sameText: anyText,
        note: "같은 이름의 파일이 이미 있습니다. " + (anyText ? "내용이 완전히 같은 파일이 있지만, " : "") +
          "이 프로그램은 파일 경로를 알 수 없어 같은 파일인지 확정할 수 없습니다. '이번 추가 건너뛰기' 또는 '별도 소스로 추가'를 선택하세요."});
      return;
    }
    const rec = {
      id: "f" + (seq++), name: inc.name, displayName: dzDisplayName(inc.name, files), ext: ext.ext,
      text: inc.text, size: inc.size != null ? inc.size : inc.text.length,
      lastModified: inc.lastModified != null ? inc.lastModified : null,
      origin: inc.origin || "file", include: true, readNotes: inc.readNotes || []
    };
    files.push(rec); added.push(rec);
  });
  return {files, added, skipped, rejected, pending};
}

/* ---------- 통합 분석 ---------- */
// files: [{id, name, displayName?, text, include?}]  (include === false 이면 분석에서 제외)
// 반환: 기존 analyze() 와 같은 모양(modules, modMap, roots, undef, instCount, warnings) + files, defs, conflicts, error
//   - modules: 포함된 모든 파일의 모든 정의(충돌 정의 포함). 각 모듈에 file/fileId/fileName 이 붙고 line·endLine 은 그 파일 기준
//   - modMap: 충돌하지 않은 모듈명만. 충돌한 이름은 들어 있지 않다(임의 선택 없음)
function analyzeDesign(files) {
  const out = {files: [], modules: [], defs: new Map(), modMap: new Map(), conflicts: [], roots: [], undef: [], instCount: 0, warnings: [], error: null};
  for (const f of files) {
    const display = f.displayName || f.name;
    const rec = {id: f.id, name: f.name, displayName: display, ext: dzExt(f.name), included: f.include !== false,
      status: "ok", error: null, moduleCount: 0, warnings: [], notes: [], svHints: []};
    out.files.push(rec);
    if (!rec.included) { rec.status = "excluded"; continue; }
    const chk = checkExtension(f.name);
    if (!chk.ok) { rec.status = "error"; rec.error = chk.reason; continue; }
    if (chk.note) rec.notes.push(chk.note);
    const plain = dzStripComments(f.text);
    if (/`include\b/.test(plain)) rec.notes.push(INCLUDE_NOTE);
    rec.svHints = SV_HINT_WORDS.filter(w => new RegExp("\\b" + w + "\\b").test(plain));
    if (rec.svHints.length) rec.notes.push("SystemVerilog 키워드로 보이는 단어가 있습니다(" + rec.svHints.join(", ") + "). 힌트일 뿐 판정은 아니며, 지원하지 않는 문법이면 일부 내용이 인식되지 않을 수 있습니다.");
    let r;
    try { r = DESIGN_ANALYZE(f.text); } catch (e) { r = {error: "분석 중 예기치 않은 오류: " + e.message}; }
    // analyze() 의 "중복 정의 → 먼저 나온 정의 사용" 경고는 통합 분석에서 쓰지 않는다(충돌로 따로 보고)
    rec.warnings = (r.warnings || []).filter(w => !/중복 정의되었습니다/.test(w));
    if (r.error) { rec.status = "error"; rec.error = r.error; continue; }
    rec.moduleCount = r.modules.length;
    for (const m of r.modules) {
      m.file = {id: f.id, name: f.name, displayName: display};
      m.fileId = f.id; m.fileName = f.name;
      out.modules.push(m);
      if (!out.defs.has(m.name)) out.defs.set(m.name, []);
      out.defs.get(m.name).push(m);
    }
  }
  for (const rec of out.files) for (const w of rec.warnings) out.warnings.push("[" + rec.displayName + "] " + w);
  for (const rec of out.files) if (rec.status === "error") out.warnings.push("[" + rec.displayName + "] 분석하지 못했습니다: " + rec.error);

  for (const [name, defs] of out.defs) {
    if (defs.length === 1) { out.modMap.set(name, defs[0]); continue; }
    out.conflicts.push({
      name, sameFile: defs.every(d => d.fileId === defs[0].fileId),
      defs: defs.map(d => ({fileId: d.fileId, fileName: d.fileName, displayName: d.file.displayName, line: d.line, endLine: d.endLine}))
    });
  }
  const used = new Set();
  for (const m of out.modules) for (const x of m.instances) used.add(x.module);
  out.roots = [...out.defs.keys()].filter(nm => !used.has(nm));
  out.undef = [...used].filter(nm => !out.defs.has(nm));
  out.instCount = out.modules.reduce((a, m) => a + m.instances.length, 0);
  if (!out.modules.length) out.error = "분석할 수 있는 module ~ endmodule 이 없습니다. 파일 목록의 상태와 경고를 확인하세요.";
  return out;
}

// 선택한 최상위 기준의 범위: 도달 가능한 모듈명, 충돌, 정의 미제공, 포함되지 않는 모듈.
// 충돌한 모듈명에 도달하면 어느 정의인지 알 수 없으므로 ok=false(계층도 생성 불가)이며 그 아래로는 내려가지 않는다.
function scopeOf(design, top) {
  if (!design.defs.has(top)) return {ok: false, reason: "undefined-top", top, message: "'" + top + "' 모듈 정의가 이 설계에 없습니다.", reachable: [], conflicts: [], undef: [], unreferenced: null};
  const seen = new Set(), conflictHit = [], undef = [];
  const stack = [top];
  while (stack.length) {
    const nm = stack.pop();
    if (seen.has(nm)) continue;
    seen.add(nm);
    const defs = design.defs.get(nm);
    if (!defs) { undef.push(nm); continue; }
    if (defs.length > 1) { conflictHit.push(design.conflicts.find(c => c.name === nm)); continue; }
    for (const x of defs[0].instances) stack.push(x.module);
  }
  const reachable = [...seen].filter(nm => design.defs.has(nm));
  if (conflictHit.length) {
    return {ok: false, reason: "conflict", top, message: "선택한 최상위에서 도달하는 모듈 중 정의가 충돌하는 것이 있습니다. 충돌한 파일을 분석에서 제외하거나 목록에서 제거해 해결하세요.",
      reachable, conflicts: conflictHit, undef, unreferenced: null};
  }
  const unreferenced = [];
  for (const [name, defs] of design.defs) {
    if (seen.has(name)) continue;
    for (const d of defs) unreferenced.push({name, fileId: d.fileId, fileName: d.fileName, displayName: d.file.displayName, line: d.line, conflict: defs.length > 1});
  }
  return {ok: true, reason: null, top, message: "", reachable, conflicts: [], undef, unreferenced};
}

/* ---------- 원본 위치 ---------- */
// 모듈 정의의 실제 원본 텍스트(해당 파일 기준 줄 번호). 여러 파일을 합친 가상 줄 번호는 쓰지 않는다.
function moduleSource(files, mod) {
  const f = files.find(x => x.id === mod.fileId);
  if (!f) return null;
  const lines = f.text.split(/\r?\n/);
  const end = mod.endLine || lines.length;
  return {fileId: f.id, fileName: f.name, displayName: f.displayName || f.name, startLine: mod.line, endLine: end, terminated: !!mod.endLine,
    lines: lines.slice(mod.line - 1, end).map((text, i) => ({no: mod.line + i, text}))};
}
// 부모 모듈(parentMod)의 idx 번째 인스턴스가 선언된 파일·줄 (buildTree 노드 id 의 "#idx")
function instanceLocation(parentMod, idx) {
  const x = parentMod && parentMod.instances[idx];
  if (!x) return null;
  return {parentModule: parentMod.name, fileId: parentMod.fileId, fileName: parentMod.fileName,
    displayName: parentMod.file ? parentMod.file.displayName : parentMod.fileName, instance: x.name, line: x.line};
}

if (typeof module !== "undefined" && module.exports) module.exports = {analyzeDesign, scopeOf, planAddFiles, checkExtension, moduleSource, instanceLocation, ALLOWED_EXT};
