// 메인 프로세스 전용: 사용자가 별도 폴더에 둔 Yosys(OSS CAD Suite)를 실행해 회로 변환 JSON을 얻는다.
// - 전역 PATH·레지스트리·관리자 권한을 바꾸지 않는다. 이 프로세스가 띄우는 자식 프로세스의 환경에만 PATH를 덧붙인다.
// - 도구를 다운로드·설치하지 않는다. 도구가 없으면 이유를 돌려준다.
// - 임시 폴더(os.tmpdir()/gvh-yosys-*)에만 쓰고, 끝나면 그 폴더만 지운다. 원본 파일은 건드리지 않는다.
const fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");

const TIMEOUT_MS = 60000, MAX_FILES = 200, MAX_TEXT = 8 * 1024 * 1024, MAX_JSON = 64 * 1024 * 1024;

// 도구 폴더 찾기: 환경변수 GVH_OSS_CAD → tools.local.json {"ossCadSuite": "..."} → 프로젝트 옆 Tools\oss-cad-suite-*\oss-cad-suite
function candidates(root) {
  const out = [];
  if (process.env.GVH_OSS_CAD) out.push(process.env.GVH_OSS_CAD);
  try { const j = JSON.parse(fs.readFileSync(path.join(root, "tools.local.json"), "utf8")); if (j && typeof j.ossCadSuite === "string") out.push(j.ossCadSuite); } catch (e) {}
  try {
    const tools = path.resolve(root, "..", "Tools");
    for (const d of fs.readdirSync(tools)) if (/^oss-cad-suite/i.test(d)) out.push(path.join(tools, d, "oss-cad-suite"), path.join(tools, d));
  } catch (e) {}
  return out;
}
function locate(root) {
  for (const c of candidates(root)) {
    try { const exe = path.join(c, "bin", "yosys.exe"); if (fs.existsSync(exe)) return {dir: c, exe}; } catch (e) {}
  }
  return null;
}
function childEnv(dir) {
  const env = Object.assign({}, process.env);
  env.YOSYSHQ_ROOT = dir + path.sep;
  env.PATH = path.join(dir, "bin") + path.delimiter + path.join(dir, "lib") + path.delimiter + (process.env.PATH || "");
  return env;
}
function run(exe, dir, args, cwd) {
  return new Promise(resolve => {
    let out = "", done = false;
    const p = cp.spawn(exe, args, {cwd, env: childEnv(dir), windowsHide: true});
    const kill = setTimeout(() => { if (!done) { try { p.kill(); } catch (e) {} out += "\n[시간 초과: " + TIMEOUT_MS / 1000 + "초]"; } }, TIMEOUT_MS);
    p.stdout.on("data", d => { out += d; if (out.length > 4e6) out = out.slice(-4e6); });
    p.stderr.on("data", d => { out += d; if (out.length > 4e6) out = out.slice(-4e6); });
    p.on("error", e => { done = true; clearTimeout(kill); resolve({code: -1, out: out + String(e)}); });
    p.on("close", code => { done = true; clearTimeout(kill); resolve({code, out}); });
  });
}
function safeName(n, i) { const b = path.basename(String(n || "")).replace(/[^A-Za-z0-9_.\-]/g, "_"); return (b && /\.(v|sv|vh|svh)$/i.test(b)) ? b : "src" + i + ".v"; }

// 변환 단계(화면에 그대로 표시한다)
const STAGES = {
  rtl: ["read_verilog -sv", "hierarchy -check -top", "proc", "opt_expr", "opt_clean"],
  gate: ["read_verilog -sv", "hierarchy -check -top", "proc", "opt -fast", "techmap", "opt", "abc -g AND,NAND,OR,NOR,XOR,XNOR,ANDNOT,ORNOT,MUX", "opt_clean"]
};
function script(mode, files, top, outFile) {
  const rd = "read_verilog -sv " + files.map(f => '"' + f + '"').join(" ");
  const h = "hierarchy -check -top " + top;
  if (mode === "gate") return [rd, h, "proc", "opt -fast", "techmap", "opt", "abc -g AND,NAND,OR,NOR,XOR,XNOR,ANDNOT,ORNOT,MUX", "opt_clean", 'write_json "' + outFile + '"'].join("; ");
  return [rd, h, "proc", "opt_expr", "opt_clean", 'write_json "' + outFile + '"'].join("; ");
}

// req: {files:[{name,text}], top, mode:"rtl"|"gate"}
async function convert(root, req) {
  const res = {ok: false, mode: req && req.mode === "gate" ? "gate" : "rtl", stages: null, version: null, log: "", error: null, json: null, files: []};
  res.stages = STAGES[res.mode];
  try {
    if (!req || !Array.isArray(req.files) || !req.files.length || req.files.length > MAX_FILES) { res.error = "변환할 소스 파일이 없거나 너무 많습니다."; return res; }
    if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(String(req.top || ""))) { res.error = "최상위 모듈 이름이 올바르지 않습니다."; return res; }
    let total = 0; for (const f of req.files) total += String(f.text || "").length; if (total > MAX_TEXT) { res.error = "소스가 너무 큽니다."; return res; }
    const tool = locate(root);
    if (!tool) { res.error = "Yosys를 찾지 못했습니다. tools.local.json의 ossCadSuite 경로 또는 환경변수 GVH_OSS_CAD를 확인하세요(자동 설치는 하지 않습니다)."; return res; }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gvh-yosys-"));
    try {
      const used = new Set(), names = [];
      req.files.forEach((f, i) => { let n = safeName(f.name, i); while (used.has(n)) n = "x" + i + "_" + n; used.add(n); fs.writeFileSync(path.join(tmp, n), String(f.text || ""), "utf8"); names.push(n); res.files.push({temp: n, name: f.name}); });
      const v = await run(tool.exe, tool.dir, ["-V"], tmp); res.version = (v.out.match(/Yosys\s+[^\r\n]+/) || [""])[0].trim() || null;
      const outFile = "out.json";
      const r = await run(tool.exe, tool.dir, ["-p", script(res.mode, names, req.top, outFile)], tmp);
      res.log = r.out.length > 20000 ? r.out.slice(0, 4000) + "\n...\n" + r.out.slice(-12000) : r.out;
      const op = path.join(tmp, outFile);
      if (r.code !== 0 || !fs.existsSync(op)) { res.error = "Yosys 변환 실패(종료 코드 " + r.code + "). " + (r.out.split(/\r?\n/).filter(l => /ERROR|error/.test(l)).slice(0, 3).join(" / ") || "로그를 확인하세요."); return res; }
      if (fs.statSync(op).size > MAX_JSON) { res.error = "변환 결과가 너무 커서 표시하지 않습니다."; return res; }
      res.json = JSON.parse(fs.readFileSync(op, "utf8")); res.ok = true;
    } finally { try { fs.rmSync(tmp, {recursive: true, force: true}); } catch (e) {} }
  } catch (e) { res.error = "변환 중 오류: " + (e && e.message); }
  return res;
}
module.exports = {convert, locate, STAGES};
