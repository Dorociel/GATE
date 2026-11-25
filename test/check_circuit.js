// Yosys 변환 결과(저장된 JSON 고정본)를 읽어 회로 모델·배치를 검사한다. Yosys 없이 실행된다.
// 실행: node test/check_circuit.js
const assert = require("assert"), fs = require("fs"), path = require("path");
const N = require("../src/netlist.js"); const {clLayout} = require("../src/circlayout.js");
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log("  통과  " + name); } catch (e) { fail++; console.log("  실패  " + name + " :: " + e.message); } }
const fx = n => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", n + ".json"), "utf8"));
const types = m => m.cells.map(c => c.type).sort();

const crtl = N.nlModel(fx("comb_demo.rtl").json, "comb_demo"), cgate = N.nlModel(fx("comb_demo.gate").json, "comb_demo");
const krtl = N.nlModel(fx("counter_demo.rtl").json, "counter_demo"), kgate = N.nlModel(fx("counter_demo.gate").json, "counter_demo");

t("조합회로 RTL: MUX·비교기·가산기·논리 셀이 변환 결과의 셀 종류 그대로 나옴", () => {
  assert.deepStrictEqual(types(crtl), ["$add", "$and", "$eq", "$mux", "$xor"]);
  const k = Object.fromEntries(crtl.cells.map(c => [c.type, c.kind])); assert.strictEqual(k.$mux, "mux"); assert.strictEqual(k.$eq, "cmp"); assert.strictEqual(k.$add, "arith"); assert.strictEqual(k.$and, "logic");
});
t("셀 폭은 변환 결과 파라미터에서 읽음", () => { const a = crtl.cells.find(c => c.type === "$add"); assert.strictEqual(a.params.A_WIDTH, 4); assert.strictEqual(a.params.Y_WIDTH, 5); });
t("포트 방향·폭", () => { const p = Object.fromEntries(crtl.ports.map(x => [x.name, x])); assert.strictEqual(p.a.dir, "input"); assert.strictEqual(p.a.bits.length, 4); assert.strictEqual(p.s.dir, "output"); assert.strictEqual(p.s.bits.length, 5); });
t("원본 소스 위치(src)가 있는 셀은 파일·줄 정보를 가짐", () => { crtl.cells.forEach(c => { assert(c.src && c.src.file === "comb_demo.v" && c.src.line >= 1, c.id); }); });
t("src가 없는 셀은 '확인 불가'(null)로 두고 만들어 내지 않음", () => {
  const j = fx("comb_demo.rtl").json; const m = j.modules.comb_demo; Object.values(m.cells).forEach(c => { delete c.attributes.src; });
  const mm = N.nlModel(j, "comb_demo"); assert(mm.cells.every(c => c.src === null));
});
t("카운터 RTL: 8비트 레지스터는 $adff 셀로 확인되고 이름·폭을 가짐", () => {
  const r = krtl.cells.find(c => c.kind === "reg"); assert(r && r.type === "$adff"); assert.strictEqual(r.reg.width, 8); assert.strictEqual(r.reg.name, "q");
  assert.deepStrictEqual(r.reg.bitIdx, [0, 1, 2, 3, 4, 5, 6, 7]);
});
t("저장 셀이 없는 조합 회로에는 레지스터가 없음(reg 선언만으로 확정하지 않음)", () => { assert(!crtl.cells.some(c => c.reg)); });
t("게이트 보기: 범용 게이트와 1비트 FF로 나옴(레지스터 묶음 없음)", () => {
  assert(cgate.cells.every(c => c.kind === "gate" || c.kind === "gmux"));
  assert(kgate.cells.filter(c => c.kind === "gff").length === 8 && kgate.cells.every(c => !c.reg));
});
t("구간 분해: 상수·무연결을 배선으로 만들지 않음", () => {
  const add = krtl.cells.find(c => c.type === "$add"), b = add.pins.find(p => p.name === "B");
  const segs = N.nlSegments(krtl, b.bits); assert(segs.length === 1 && segs[0].kind === "const"); assert.strictEqual(segs[0].text, "8'b00000001");
  const fake = {driver: new Map()}; assert.strictEqual(N.nlSegments(fake, [99, 100])[0].kind, "open");
});
function check(layout) {
  const byCol = new Map(); layout.nodes.forEach(n => { (byCol.get(n.col) || byCol.set(n.col, []).get(n.col)).push(n); });
  for (const arr of byCol.values()) { arr.sort((a, b) => a.y - b.y); for (let i = 1; i < arr.length; i++) assert(arr[i].y >= arr[i - 1].y + arr[i - 1].h, "열 안 겹침"); }
  layout.edges.forEach(e => { assert(layout.byKey.get(e.fromNode) && layout.byKey.get(e.toNode)); assert(e.pts.every(p => p[0] != null && p[1] != null && isFinite(p[1])), "경로"); });
  layout.nodes.forEach(n => assert(n.x >= 0 && n.y >= 0 && n.x + n.w <= layout.width + 1 && n.y + n.h <= layout.height));
}
t("조합회로 배치: 겹침 없음, 모든 선의 양 끝이 실제 핀", () => { const L = clLayout(crtl); check(L); assert(L.edges.length >= 8); });
t("카운터 배치: 레지스터 출력→가산기 되먹임은 뒤로 가는 선(back)으로 구분", () => {
  const L = clLayout(krtl); check(L); assert(L.edges.some(e => e.back), "back 선 없음");
  const e = L.edges.find(e => e.back); assert(L.byKey.get(e.fromNode).cell.kind === "reg");
});
t("레지스터 비트 펼침: 8칸·실제 인덱스 기준, 접으면 요약", () => {
  const r = krtl.cells.find(c => c.kind === "reg"); const a = clLayout(krtl), b = clLayout(krtl, {expanded: new Set([r.id])});
  const na = a.byKey.get("cell:" + r.id), nb = b.byKey.get("cell:" + r.id);
  assert(!na.bits && nb.bits && nb.bits.cols === 8 && nb.bits.rows === 1); assert(nb.h > na.h); check(b);
});
t("32비트 레지스터는 32칸", () => {
  const j = JSON.parse(JSON.stringify(fx("counter_demo.rtl").json)); const m = j.modules.counter_demo;
  const w = 32, c = Object.values(m.cells).find(x => x.type === "$adff"); const q = Array.from({length: w}, (_, i) => 1000 + i);
  c.connections.Q = q; c.connections.D = q.map(b => b + 100); m.netnames.q.bits = q; c.parameters.WIDTH = "0".repeat(26) + "100000";
  const mm = N.nlModel(j, "counter_demo"), r = mm.cells.find(x => x.kind === "reg");
  assert.strictEqual(r.reg.width, 32); const L = clLayout(mm, {expanded: new Set([r.id])}); const n = L.byKey.get("cell:" + r.id);
  assert.strictEqual(n.bits.cols, 32); assert.strictEqual(n.bits.rows, 1); assert.strictEqual(r.reg.bitIdx[31], 31);
});
t("폭을 알 수 없으면(Q 없음) 비트 칸을 만들지 않음", () => {
  const j = JSON.parse(JSON.stringify(fx("counter_demo.rtl").json)); const c = Object.values(j.modules.counter_demo.cells).find(x => x.type === "$adff"); delete c.connections.Q;
  const mm = N.nlModel(j, "counter_demo"), r = mm.cells.find(x => x.kind === "reg"); assert(!r.reg); const L = clLayout(mm, {expanded: new Set([r.id])}); assert(!L.byKey.get("cell:" + r.id).bits);
});
t("없는 모듈은 오류 메시지를 돌려줌", () => { assert(N.nlModel(fx("counter_demo.rtl").json, "nope").error); });
t("하위 모듈 셀은 sub로 분류, 알 수 없는 셀은 other", () => {
  const mods = {sub1: {}}; assert.strictEqual(N.nlKind("sub1", mods), "sub"); assert.strictEqual(N.nlKind("$foo", mods), "other"); assert.strictEqual(N.nlKind("ghost", mods), "other");
});
console.log("결과: 통과 " + pass + " / 실패 " + fail); process.exit(fail ? 1 : 0);
