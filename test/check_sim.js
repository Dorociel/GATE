// 신호 연결 그래프 · VCD · 테스트벤치 분석 검사 (Node, DOM 없음). 실행: node test/check_sim.js  (npm test 가 check.js 와 함께 실행)
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const rd = p => fs.readFileSync(path.join(ROOT, p), "utf8");
const {analyze} = require("../src/analyzer.js");
const {buildNets} = require("../src/nets.js");
const {ngBuildModel, ngLayout, NG_DISCLAIMER} = require("../src/netgraph.js");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  통과  " + name); }
  catch (e) { fail++; console.log("  실패  " + name + "\n        " + e.message.split("\n")[0]); }
}

console.log("[신호 연결 그래프 모델]");
const cs = analyze(rd("examples/counter_system.v"));
const csNets = buildNets(cs.modMap, "counter_system");
const gm = ngBuildModel(csNets, cs.modMap.get("counter_system"), cs.modMap);
t("신호·경계 포트·인스턴스가 모두 모델에 있다(연결 안 된 경계 포트 포함)", () => {
  assert.deepStrictEqual(gm.signals.map(s => s.net), ["clk", "rst_n", "enable", "count_a", "count_b", "equal"]);
  assert.deepStrictEqual(gm.boundary.map(b => b.port + ":" + b.used), ["clk:true", "rst_n:true", "enable:true", "equal:true", "count_a_out:false"]);
  assert.deepStrictEqual(gm.instances.map(i => i.name), ["u_channel_a", "u_channel_b", "u_compare"]);
});
t("분석 제외 연결(상수·비트 선택)은 숨기지 않고 ‘excluded’ 줄로 남는다", () => {
  const rows = gm.instances.flatMap(i => i.rows.filter(r => r.kind === "excluded").map(r => i.name + "." + r.port + ":" + r.reason.slice(0, 4)));
  assert.strictEqual(rows.length, 2);
  assert.ok(rows.some(x => x.startsWith("u_channel_b.enable")) && rows.some(x => x.startsWith("u_compare.b")));
  assert.strictEqual(gm.counts.excludedRows, csNets.excluded.length);
});
t("선은 분석된 연결 수와 같고, 방향은 확인된 포트 선언 방향에서만 나온다", () => {
  const epCount = csNets.nets.reduce((a, n) => a + n.endpoints.length, 0);
  assert.strictEqual(gm.edges.length, epCount);
  const e = k => gm.edges.find(x => x.key === k);
  assert.strictEqual(e("e:b:clk").arrow, "to-net");                 // input 경계 포트 → 내부 신호
  assert.strictEqual(e("e:r:u_channel_a.clk").arrow, "from-net");   // 신호 → 하위 input
  assert.strictEqual(e("e:r:u_channel_a.count").arrow, "to-net");   // 하위 output → 신호
  assert.strictEqual(e("e:b:equal").arrow, "from-net");             // output 경계 포트는 신호를 받는다
  assert.ok(gm.edges.every(x => x.directed === (x.arrow !== "none")));
});
t("방향을 모르는 연결(정의 미제공)은 방향 없음(점선)으로 남고 방향을 만들지 않는다", () => {
  const r2 = analyze("module top(input a);\n  wire w;\n  unknown_cell u (.p(a), .q(w));\nendmodule\n");
  const n2 = buildNets(r2.modMap, "top");
  const m2 = ngBuildModel(n2, r2.modMap.get("top"), r2.modMap);
  const inst = m2.instances[0];
  assert.strictEqual(inst.undef, true);
  const es = m2.edges.filter(x => x.kind === "instance");
  assert.strictEqual(es.length, 2);
  assert.ok(es.every(x => x.arrow === "none" && x.directed === false && x.reason));
});
t("inout 은 선만 남고 방향이 없다", () => {
  const r3 = analyze("module top(inout io);\n  pad u (.p(io));\nendmodule\nmodule pad(inout p);\nendmodule\n");
  const m3 = ngBuildModel(buildNets(r3.modMap, "top"), r3.modMap.get("top"), r3.modMap);
  assert.ok(m3.edges.length === 2 && m3.edges.every(x => !x.directed));
});
t("여러 구동원 경고가 신호 모델에 warn 으로 남는다", () => {
  const r4 = analyze("module top;\n  wire w;\n  drv u1 (.o(w));\n  drv u2 (.o(w));\nendmodule\nmodule drv(output o);\nendmodule\n");
  const m4 = ngBuildModel(buildNets(r4.modMap, "top"), r4.modMap.get("top"), r4.modMap);
  assert.strictEqual(m4.signals[0].warn.length, 1);
  assert.ok(/구동하는 포트가 2개/.test(m4.signals[0].warn[0]));
});
t("하위 인스턴스가 없는 모듈은 신호가 없고(그래프 없음) 오류 없이 모델이 만들어진다", () => {
  const r5 = analyze("module top(input a, output b);\n  assign b = a;\nendmodule\n");
  const m5 = ngBuildModel(buildNets(r5.modMap, "top"), r5.modMap.get("top"), r5.modMap);
  assert.strictEqual(m5.signals.length, 0);
  assert.strictEqual(m5.boundary.length, 2);
});
const lay = ngLayout(gm);
t("배치: 모든 선의 두 끝이 좌표를 가지고 서로 다른 열에 있다", () => {
  assert.strictEqual(lay.edges.size, gm.edges.length);
  for (const [, g] of lay.edges) { assert.ok(Number.isFinite(g.a.x + g.a.y + g.b.x + g.b.y)); assert.notStrictEqual(g.a.x, g.b.x); assert.ok(g.d.startsWith("M")); }
  assert.ok(lay.w > 500 && lay.h > 100);
});
t("배치: 방향 있는 선은 흐름 방향이 시작점 → 끝점이다(구동 → 신호 → 수신)", () => {
  const g = k => lay.edges.get(k);
  const sig = lay.sig.get("s:clk");
  assert.ok(g("e:b:clk").b.x === sig.x && g("e:b:clk").a.x < sig.x);                // 경계 포트 → 신호
  assert.ok(g("e:r:u_channel_a.clk").a.x === sig.x + sig.w);                         // 신호 → 인스턴스 포트
  assert.ok(g("e:r:u_channel_a.count").b.x === lay.sig.get("s:count_a").x + lay.sig.get("s:count_a").w);   // 인스턴스 출력 → 신호
});
t("경계 포트 상자는 같은 신호의 행과 같은 높이에 놓인다", () => {
  assert.strictEqual(lay.bnd.get("b:clk").y, lay.sig.get("s:clk").y);
});
t("방향 안내 문구가 ‘실제 시뮬레이션이 아님’을 밝힌다", () => {
  assert.ok(/실제 시뮬레이션이 아니며/.test(NG_DISCLAIMER) && /지연/.test(NG_DISCLAIMER));
});
t("계층도 레이아웃(layout.js)의 포함 관계 선 데이터는 그래프에 쓰이지 않는다", () => {
  assert.ok(!/layout\.js|buildTree/.test(rd("src/netgraph.js").replace(/\/\/.*$/gm, "")));
});

console.log("\n[VCD 읽기·값 조회·설계 연결]");
const {vcdParse, vcdScopeAt, vcdValueAt, vcdChangeTimes, vcdStep, vcdFormat, vcdTimeText, vcdSuggestBase, vcdMapGraph, VCD_PLAY_NOTE} = require("../src/vcd.js");
const {analyzeDesign} = require("../src/design.js");
const {buildTree} = require("../src/analyzer.js");
const {indexTree} = require("../src/nets.js");
const vtxt = rd("examples/sim_demo/tb_counter.vcd");
const vd = vcdParse(vtxt);
t("예제 VCD: 수작업 fixture 임을 파일 안에 밝힌다(실제 시뮬레이터 출력 아님)", () => {
  assert.ok(/수작업/.test(vtxt) && /not simulator output/.test(vtxt) && /실제 시뮬레이터가 출력한 파일이 아닙니다/.test(vtxt));
  assert.ok(/수작업 fixture/.test(rd("examples/sim_demo/README.txt")));
});
t("VCD 헤더: 시간 단위·스코프 계층·변수(별칭은 같은 기록을 공유)", () => {
  assert.ok(vd.ok && vd.error === null);
  assert.strictEqual(vd.timescale.text, "1 ns");
  assert.deepStrictEqual(vd.scopes.map(s => s.path.join(".")), ["tb_counter", "tb_counter.u_dut", "tb_counter.u_dut.u_cnt", "tb_counter.u_dut.u_cmp"]);
  assert.strictEqual(vd.vars.length, 16);
  const a = vcdScopeAt(vd, ["tb_counter"]).vars.find(v => v.name === "count"), b = vcdScopeAt(vd, ["tb_counter", "u_dut", "u_cnt"]).vars.find(v => v.name === "q");
  assert.strictEqual(a.rec, b.rec);
  assert.strictEqual(vd.startTime, 0); assert.strictEqual(vd.endTime, 105);
  assert.deepStrictEqual(vd.warnings, []);
});
const rec = n => vcdScopeAt(vd, ["tb_counter"]).vars.find(v => v.name === n);
t("값 조회: 시점 이전·경계·이후, 같은 시점은 그 시점의 값", () => {
  const c = rec("count");
  assert.strictEqual(vcdValueAt(c.rec, 0), "xxxx");
  assert.strictEqual(vcdValueAt(c.rec, 9), "xxxx");
  assert.strictEqual(vcdValueAt(c.rec, 10), "0000");
  assert.strictEqual(vcdValueAt(c.rec, 44.9), "0000");
  assert.strictEqual(vcdValueAt(c.rec, 45), "0001");
  assert.strictEqual(vcdValueAt(c.rec, 999), "0111");
  assert.strictEqual(vcdValueAt(c.rec, -1), null);
  assert.strictEqual(vcdValueAt(rec("en").rec, 0), "z");
  assert.strictEqual(vcdValueAt(rec("rst_n").rec, 5), "x");
  assert.strictEqual(vcdValueAt(rec("done").rec, 85), "1");
  assert.strictEqual(vcdValueAt(rec("done").rec, 95), "0");
});
t("값 표시: 0/1/X/Z/벡터/부분 X 를 구분한다", () => {
  assert.deepStrictEqual([vcdFormat("0", 1).cls, vcdFormat("1", 1).cls, vcdFormat("x", 1).cls, vcdFormat("z", 1).cls], ["0", "1", "x", "z"]);
  assert.strictEqual(vcdFormat("x", 1).text, "X"); assert.strictEqual(vcdFormat("z", 1).text, "Z");
  assert.deepStrictEqual([vcdFormat("0101", 4).text, vcdFormat("0101", 4).cls], ["4'h5", "v"]);
  assert.strictEqual(vcdFormat("xxxx", 4).cls, "x"); assert.strictEqual(vcdFormat("zzzz", 4).cls, "z");
  assert.strictEqual(vcdFormat("01xz", 4).text, "4'b01XZ"); assert.strictEqual(vcdFormat("01xz", 4).cls, "x");
  assert.strictEqual(vcdFormat("0011111111", 10).text, "10'h0FF");
  assert.strictEqual(vcdFormat("1", 4).text, "4'h1");          // 짧은 벡터는 왼쪽을 0 으로 확장
  assert.strictEqual(vcdFormat(null, 4).cls, "n");
  assert.deepStrictEqual([vcdFormat("3.5", 64, "real").text, vcdFormat("3.5", 64, "real").cls], ["3.5", "r"]);
});
const allRecs = vd.vars.map(v => v.rec);
const ctimes = vcdChangeTimes(allRecs);
t("값 변경 시점 목록과 이전/다음 이동", () => {
  assert.deepStrictEqual(ctimes.slice(0, 6), [0, 5, 10, 15, 20, 25]);
  assert.strictEqual(vcdStep(ctimes, 0, -1), null);
  assert.strictEqual(vcdStep(ctimes, 12, 1), 15); assert.strictEqual(vcdStep(ctimes, 12, -1), 10);
  assert.strictEqual(vcdStep(ctimes, 105, 1), null);
  const cnt = [vcdScopeAt(vd, ["tb_counter"]).vars.find(v => v.name === "count").rec];
  assert.deepStrictEqual(vcdChangeTimes(cnt), [0, 10, 45, 55, 65, 75, 85, 95, 105]);
});
t("시간 표시: 단위와 현재 시점", () => {
  assert.strictEqual(vcdTimeText(vd, 45), "45 ns");
  const v2 = vcdParse("$timescale 10 ps $end\n$scope module a $end\n$var wire 1 ! s $end\n$upscope $end\n$enddefinitions $end\n#0\n0!\n#7\n1!\n");
  assert.strictEqual(vcdTimeText(v2, 7), "70 ps");
  const v3 = vcdParse("$scope module a $end\n$var wire 1 ! s $end\n$upscope $end\n$enddefinitions $end\n#0\n0!\n");
  assert.strictEqual(v3.timescale, null); assert.ok(/미확인/.test(vcdTimeText(v3, 3)));
});
// 설계 ↔ VCD
const simFiles = [["f1", "rtl_counter.v"], ["f2", "tb_counter.v"]].map(([id, nm]) => ({id, name: nm, displayName: nm, text: rd("examples/sim_demo/" + nm), include: true}));
const sd = analyzeDesign(simFiles);
t("예제 RTL+테스트벤치: 오류 없이 분석되고 최상위는 tb_counter 하나", () => {
  assert.strictEqual(sd.error, null);
  assert.deepStrictEqual(sd.roots, ["tb_counter"]);
  assert.deepStrictEqual(sd.modules.map(m => m.name).sort(), ["cmp_max", "cnt4", "counter_top", "tb_counter"]);
});
const stree = buildTree(sd.modMap, "tb_counter", 1500), sidx = indexTree(stree.root);
const dutNets = buildNets(sd.modMap, "counter_top");
const dutModel = ngBuildModel(dutNets, sd.modMap.get("counter_top"), sd.modMap);
const relPaths = [...sidx.values()].map(x => x.path.slice(1));
t("기준 경로 제안: 테스트벤치 아래 DUT 구조와 맞는 VCD 스코프를 고른다(제안일 뿐)", () => {
  const sg = vcdSuggestBase(vd, relPaths, "tb_counter");
  assert.strictEqual(sg.text, "tb_counter"); assert.strictEqual(sg.score, 3); assert.strictEqual(sg.weak, false);
  const weak = vcdSuggestBase(vcdParse("$scope module zzz $end\n$var wire 1 ! s $end\n$upscope $end\n$enddefinitions $end\n#0\n0!\n"), relPaths, "tb_counter");
  assert.strictEqual(weak.weak, true);
});
t("그래프 연결: 기준 tb_counter → DUT 신호 5개 + 하위 포트 6개 모두 연결", () => {
  const m = vcdMapGraph(vd, ["tb_counter"], ["u_dut"], dutModel);
  assert.strictEqual(m.map.size, 11); assert.strictEqual(m.unmapped.length, 0);
  assert.strictEqual(m.map.get("s:count").v.size, 4);
  assert.strictEqual(m.map.get("r:u_cnt.q").v.rec, m.map.get("s:count").v.rec);
});
t("연결하지 못한 항목은 임의로 연결하지 않고 사유와 함께 목록으로 남는다", () => {
  const bad = vcdMapGraph(vd, ["nope"], ["u_dut"], dutModel);
  assert.strictEqual(bad.map.size, 0); assert.strictEqual(bad.unmapped.length, 11); assert.strictEqual(bad.targetScope, null);
  assert.ok(bad.unmapped.every(u => /스코프/.test(u.why)));
  const noHit = vcdParse(vtxt.replace("$var wire 1 % hit $end\n", ""));
  const m = vcdMapGraph(noHit, ["tb_counter"], ["u_dut"], dutModel);
  assert.deepStrictEqual(m.unmapped.map(u => u.label), ["포트 u_cmp.hit"]);
  assert.ok(/‘hit’ 신호가 없음/.test(m.unmapped[0].why));
  const wrongBase = vcdMapGraph(vd, ["tb_counter", "u_dut"], ["u_dut"], dutModel);   // 기준을 잘못 고르면 연결되지 않는다
  assert.strictEqual(wrongBase.map.size, 0);
});
t("폭이 다르면 연결은 하되 폭 불일치를 표시한다", () => {
  const w = vcdParse(vtxt.replace("$var wire 4 $ count [3:0] $end\n$var wire 1 % done $end\n$scope module u_cnt", "$var wire 8 $ count [7:0] $end\n$var wire 1 % done $end\n$scope module u_cnt"));
  const m = vcdMapGraph(w, ["tb_counter"], ["u_dut"], dutModel);
  assert.ok(m.map.get("s:count").widthWarn && /설계 4비트 \/ VCD 8비트/.test(m.map.get("s:count").widthWarn));
});
t("형식 오류: 빈 파일·헤더 없음·$var 없음은 오류로 거부(기존 재생 상태를 건드리지 않음)", () => {
  assert.strictEqual(vcdParse("").ok, false);
  assert.strictEqual(vcdParse("hello world").ok, false);
  assert.ok(/enddefinitions/.test(vcdParse("$scope module a $end\n$var wire 1 ! s $end\n#0\n0!\n").error));
  assert.ok(/\$var/.test(vcdParse("$enddefinitions $end\n#0\n").error));
});
t("선언 없는 식별자의 값은 무시하고 경고, 같은 시점 값은 마지막 값", () => {
  const w = vcdParse("$scope module a $end\n$var wire 1 ! s $end\n$upscope $end\n$enddefinitions $end\n#0\n0!\n1?\n#5\n0!\n1!\n");
  assert.ok(w.ok && w.warnings.some(x => /선언되지 않은 식별자/.test(x)));
  assert.strictEqual(vcdValueAt(w.vars[0].rec, 5), "1");
});
t("재생 화면 문구: 시뮬레이션을 실행한 것처럼 표현하지 않는다", () => {
  assert.ok(/이 앱이 시뮬레이션을 실행하거나 계산한 값이 아닙니다/.test(VCD_PLAY_NOTE));
  const src = rd("src/playback.js");
  assert.ok(/VCD_PLAY_NOTE/.test(src) && !/시뮬레이션 (실행|결과)를 (실행|계산)했/.test(src));
});

// <<TESTS-END>>

console.log("\n결과: 통과 " + pass + " / 실패 " + fail);
process.exit(fail ? 1 : 0);
