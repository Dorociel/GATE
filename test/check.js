// Node 로직 검사 (화면 없이 분석·계층·배치만 검사). 실행: npm test  또는  node test/check.js
// 이 검사는 Electron 창/DOM 렌더링을 검사하지 않는다.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {analyze, buildTree} = require("../src/analyzer.js");
const {layout, NODE_H} = require("../src/layout.js");
const {SAMPLE} = require("../src/sample.js");
const {toMarkdown, mdText, mdCode, collectNotes} = require("../src/markdown.js");
const {buildNets, indexTree} = require("../src/nets.js");
const {analyzeDesign, scopeOf, planAddFiles, checkExtension, moduleSource, instanceLocation} = require("../src/design.js");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  통과  " + name); }
  catch (e) { fail++; console.log("  실패  " + name + "\n        " + e.message.split("\n")[0]); }
}
const names = tree => { const o = []; (function f(n, d) { o.push("  ".repeat(d) + n.instance + ":" + n.module + (n.tag ? "[" + n.tag + "]" : "")); n.children.forEach(c => f(c, d + 1)); })(tree, 0); return o; };

console.log("[기본 예제]");
t("examples/basic_top_child.v 와 src/sample.js 내용이 같다", () => {
  assert.strictEqual(fs.readFileSync(path.join(__dirname, "..", "examples", "basic_top_child.v"), "utf8"), SAMPLE);
});
const r = analyze(SAMPLE);
t("모듈 top, child, leaf 를 인식한다", () => assert.deepStrictEqual(r.modules.map(m => m.name), ["top", "child", "leaf"]));
t("top 은 child 를 두 번 인스턴스화 (u_child_0, u_child_1)", () =>
  assert.deepStrictEqual(r.modMap.get("top").instances.map(i => i.name + "/" + i.module), ["u_child_0/child", "u_child_1/child"]));
t("주석 처리된 인스턴스(u_old)는 무시한다", () => assert.ok(!r.modMap.get("top").instances.some(i => i.name === "u_old")));
t("최상위 후보는 top 하나, 경고 없음", () => {
  assert.deepStrictEqual(r.roots, ["top"]);
  assert.strictEqual(r.warnings.length + r.modules.reduce((a, m) => a + m.warns.length, 0), 0);
});
const tr = buildTree(r.modMap, "top", 1500);
t("계층: top → (u_child_0 → u_leaf), (u_child_1 → u_leaf)", () =>
  assert.deepStrictEqual(names(tr.root), ["(최상위):top", "  u_child_0:child", "    u_leaf:leaf", "  u_child_1:child", "    u_leaf:leaf"]));
t("블록 5개, 같은 모듈도 인스턴스마다 별도 노드(ID 중복 없음)", () => {
  assert.strictEqual(tr.count, 5);
  const ids = []; (function f(n) { ids.push(n.id); n.children.forEach(f); })(tr.root);
  assert.strictEqual(new Set(ids).size, 5);
});
const L = layout(tr.root);
t("배치: 깊이 3열, 블록끼리 겹치지 않는다", () => {
  assert.strictEqual(L.depthCount, 3);
  for (const a of L.nodes) for (const b of L.nodes) if (a !== b)
    assert.ok(!(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + NODE_H && b.y < a.y + NODE_H), a.instance + " 와 " + b.instance + " 겹침");
});
t("배치: 상위는 왼쪽, 같은 깊이는 같은 x, 부모는 자식들의 세로 중앙", () => {
  const top = tr.root, [c0, c1] = top.children;
  assert.ok(top.x < c0.x && c0.x < c0.children[0].x);
  assert.strictEqual(c0.x, c1.x);
  assert.strictEqual(top.y, (c0.y + c1.y) / 2);
});

console.log("[예외·제한사항]");
t("빈 입력 → 오류 안내", () => assert.ok(analyze("   ").error));
t("module 이 없는 입력 → 오류 안내", () => assert.ok(analyze("foo bar baz;").error));
t("정의 없는 모듈은 '정의 미제공'이며 펼치지 않는다", () => {
  const q = analyze("module a(); b u(); endmodule");
  assert.deepStrictEqual(q.undef, ["b"]);
  assert.deepStrictEqual(names(buildTree(q.modMap, "a", 100).root), ["(최상위):a", "  u:b[정의 미제공]"]);
});
t("상호 재귀(a↔b)에서 멈추지 않고 '재귀'로 표시", () => {
  const q = analyze("module a; b u1(); endmodule module b; a u2(); endmodule");
  assert.deepStrictEqual(names(buildTree(q.modMap, "a", 100).root), ["(최상위):a", "  u1:b", "    u2:a[재귀]"]);
});
t("블록 수 제한을 넘으면 truncated", () => {
  const q = analyze("module t; k a(); k b(); k c(); k d(); endmodule module k; endmodule");
  assert.strictEqual(buildTree(q.modMap, "t", 3).truncated, true);
});
t("/* */ 와 // 주석 안의 인스턴스를 무시", () => {
  const q = analyze("module a; /* k u1(); */ // k u2();\n k u3(); endmodule module k; endmodule");
  assert.deepStrictEqual(q.modMap.get("a").instances.map(i => i.name), ["u3"]);
});
t("파라미터 오버라이드 #(...) 인스턴스 인식", () => {
  const q = analyze("module a; k #(.W(8)) u1 (.x(y)); endmodule module k; endmodule");
  assert.deepStrictEqual(q.modMap.get("a").instances.map(i => i.name + "/" + i.module), ["u1/k"]);
});
t("generate 내부 인스턴스는 인식하지 못했음을 경고로 알린다", () => {
  const q = analyze("module a; generate if (1) begin : g k u4 (.i(x)); end endgenerate endmodule module k; endmodule");
  assert.strictEqual(q.modMap.get("a").instances.length, 0);
  assert.ok(q.modMap.get("a").warns.some(w => w.includes("generate")));
  assert.ok(q.modMap.get("a").warns.some(w => w.includes("인식하지 못했습니다")));
});
t("매크로/지시어 사용을 경고한다 (`timescale 은 제외)", () => {
  assert.ok(analyze("`define X 1\nmodule a; endmodule").warnings.some(w => w.includes("지시어")));
  assert.strictEqual(analyze("`timescale 1ns/1ps\nmodule a; endmodule").warnings.length, 0);
});
t("위치 기반 포트 연결은 인스턴스를 인식하되 경고", () => {
  const q = analyze("module a; k u1 (x, y); endmodule module k; endmodule");
  assert.strictEqual(q.modMap.get("a").instances.length, 1);
  assert.ok(q.modMap.get("a").warns.some(w => w.includes("위치 기반")));
});
t("게이트 프리미티브(and 등)는 모듈 인스턴스로 보지 않는다", () => {
  const q = analyze("module a; and g1 (o, a1, b1); endmodule");
  assert.strictEqual(q.modMap.get("a").instances.length, 0);
});
t("SystemVerilog 키워드 감지 시 경고", () => {
  assert.ok(analyze("module a; logic x; endmodule").modMap.get("a").warns.some(w => w.includes("SystemVerilog")));
});
t("endmodule 누락 시 경고", () => {
  assert.ok(analyze("module a; k u(); ").modMap.get("a").warns.some(w => w.includes("endmodule")));
});

console.log("\n[Markdown 변환 (화면 DOM이 아닌 변환 함수만 검사)]");
const md = toMarkdown(r);
t("제목과 요약(모듈 3 · 인스턴스 선언 3 · 최상위 후보 1 · 확인 필요 0)", () => {
  assert.ok(md.startsWith("# Verilog 모듈 분석 결과\n"));
  assert.ok(md.includes("- 모듈 수: 3") && md.includes("- 인스턴스 선언 수: 3 ") && md.includes("- 최상위 후보 수: 1") && md.includes("- 확인 필요 건수: 0"));
});
t("최상위 후보·모듈별 정의 줄·인스턴스 표를 포함한다", () => {
  assert.ok(md.includes("- `top`"));
  assert.ok(md.includes("| `top` | " + r.modMap.get("top").line + " | 2 |"));
  assert.ok(md.includes("| 인스턴스명 | 모듈명 | 정의 여부 | 포트 연결 형식 | 줄 |"));
  assert.ok(/\| `u_child_0` \| `child` \| 정의됨 \| 이름 기반 \| \d+ \|/.test(md));
});
t("하위 인스턴스가 없는 모듈도 ‘인식된 인스턴스 없음’으로 표시", () => {
  assert.ok(md.includes("### `leaf`") && md.split("인식된 인스턴스 없음").length === 2);
});
t("계층도 블록 수를 넣지 않고, ‘검증 완료’·‘정확성 보장’ 문구가 없다", () => {
  assert.ok(!md.includes("블록") && !md.includes("검증 완료") && !md.includes("정확성 보장"));
});
t("확인 필요 건수가 화면 상태줄 계산식과 같다", () => {
  const q = analyze("module a; k u0(a1, b1); m u1(.x(y)); endmodule\nmodule c; generate endgenerate endmodule");
  const nW = q.warnings.length + q.modules.reduce((a, m) => a + m.warns.length, 0) + (q.undef.length ? 1 : 0);
  assert.ok(nW > 0 && collectNotes(q).length === nW);
  const m2 = toMarkdown(q);
  assert.ok(m2.includes("- 확인 필요 건수: " + nW) && m2.includes("위치 기반") && m2.includes("정의 미제공"));
});
t("표 안의 | 와 줄바꿈, 이름 속 백틱을 안전하게 처리", () => {
  assert.strictEqual(mdCode("a|b"), "`a\\|b`");
  assert.strictEqual(mdCode("a`b"), "``a`b``");
  assert.strictEqual(mdCode("`a"), "`` `a ``");
  assert.strictEqual(mdText("x|y\n*z*"), "x\\|y \\*z\\*");
});
t("분석 실패·빈 결과는 Markdown을 만들지 않고 오류를 낸다", () => {
  assert.throws(() => toMarkdown(analyze("")), /분석에 성공한/);
  assert.throws(() => toMarkdown(null), /분석에 성공한/);
});

console.log("\n[신호 연결 · 상세보기용 데이터 (nets.js, 화면 DOM 아님)]");
const CS = fs.readFileSync(path.join(__dirname, "..", "examples", "counter_system.v"), "utf8");
const rc = analyze(CS);
const codes = n => n.notes.map(x => x.code);
const netOf = (res, nm) => res.nets.find(n => n.name === nm);
const epOf = (net, label) => net.endpoints.find(e => (e.kind === "boundary" ? "경계:" + e.port : e.instance + "." + e.port) === label);

t("모듈 정의의 시작 줄과 endmodule 줄(endLine)을 기록한다", () => {
  for (const m of r.modules) assert.ok(m.terminated && m.endLine > m.line, m.name);
  const lines = CS.split(/\r?\n/);
  const m = rc.modMap.get("incrementer");
  assert.ok(lines[m.line - 1].includes("module incrementer") && lines[m.endLine - 1].includes("endmodule"));
  assert.strictEqual(analyze("module a; k u(); ").modMap.get("a").endLine, null);
});
t("예제 counter_system.v: 모듈 5개, 최상위 후보 1개, 경고 없음", () => {
  assert.deepStrictEqual(rc.modules.map(m => m.name), ["counter_system", "counter_channel", "incrementer", "register8", "count_compare"]);
  assert.deepStrictEqual(rc.roots, ["counter_system"]);
  assert.strictEqual(rc.warnings.length + rc.modules.reduce((a, m) => a + m.warns.length, 0), 0);
});
const nc = buildNets(rc.modMap, "counter_system");
t("신호 연결: 신호 6개(clk, rst_n, enable, count_a, count_b, equal)와 연결 포트 수", () => {
  assert.deepStrictEqual(nc.nets.map(n => n.name), ["clk", "rst_n", "enable", "count_a", "count_b", "equal"]);
  assert.strictEqual(nc.summary.netCount, 6);
  assert.strictEqual(nc.summary.instancePortCount, 9);
});
t("count_a: u_channel_a.count(output) → count_a → u_compare.a(input), 폭 8비트, 확인 항목 없음", () => {
  const n = netOf(nc, "count_a");
  assert.strictEqual(n.declared, "net");
  assert.strictEqual(n.bits, 8);
  const d = epOf(n, "u_channel_a.count"), l = epOf(n, "u_compare.a");
  assert.deepStrictEqual([d.dir, d.arrow, d.bits, d.module], ["output", "to-net", 8, "counter_channel"]);
  assert.deepStrictEqual([l.dir, l.arrow, l.bits, l.module], ["input", "from-net", 8, "count_compare"]);
  assert.deepStrictEqual(n.counts, {drivers: 1, loads: 1, undirected: 0});
  assert.deepStrictEqual(n.notes, []);
});
t("경계 포트 방향: 선택 모듈의 input 은 신호를 구동(to-net), output 은 신호를 받음(from-net)", () => {
  const clk = netOf(nc, "clk"), eq = netOf(nc, "equal");
  assert.deepStrictEqual([epOf(clk, "경계:clk").dir, epOf(clk, "경계:clk").arrow], ["input", "to-net"]);
  assert.deepStrictEqual(clk.counts, {drivers: 1, loads: 2, undirected: 0});
  assert.deepStrictEqual([epOf(eq, "경계:equal").dir, epOf(eq, "경계:equal").arrow], ["output", "from-net"]);
  assert.deepStrictEqual([epOf(eq, "u_compare.equal").arrow, eq.counts.drivers, eq.counts.loads], ["to-net", 1, 1]);
});
t("같은 모듈의 여러 인스턴스를 인스턴스 이름으로 구분 (u_channel_a / u_channel_b)", () => {
  const clk = netOf(nc, "clk");
  assert.ok(epOf(clk, "u_channel_a.clk") && epOf(clk, "u_channel_b.clk"));
  assert.ok(epOf(netOf(nc, "count_a"), "u_channel_a.count") && !epOf(netOf(nc, "count_a"), "u_channel_b.count"));
  assert.ok(epOf(netOf(nc, "count_b"), "u_channel_b.count") && !epOf(netOf(nc, "count_b"), "u_channel_a.count"));
});
t("분석 제외 연결: 상수(.enable(1'b1))와 비트 선택(.b(count_b[7:0]))을 사유와 함께 남긴다", () => {
  assert.deepStrictEqual(nc.excluded.map(x => x.instance + "." + x.port + ":" + x.kind), ["u_channel_b.enable:const", "u_compare.b:select"]);
  assert.strictEqual(nc.excluded[0].text, "1'b1");
  assert.strictEqual(nc.excluded[1].text, "count_b[7:0]");
  assert.ok(nc.excluded.every(x => x.reason.length > 0));
  assert.strictEqual(nc.summary.excludedCount, 2);
});
t("제외 연결 때문에 연결 상대가 없어진 신호는 ‘다른 포트 없음’으로 알린다 (count_b)", () => {
  const n = netOf(nc, "count_b");
  assert.strictEqual(n.endpoints.length, 1);
  assert.ok(codes(n).includes("single-endpoint") && codes(n).includes("no-load"));
});
t("인스턴스와 단일 신호명으로 연결되지 않은 경계 포트를 따로 알린다 (count_a_out)", () => {
  assert.deepStrictEqual(nc.unusedBoundary.map(p => p.name), ["count_a_out"]);
});
t("하위 계층을 관통하지 않는다: 대상 모듈의 직접 하위 인스턴스 포트만 나온다", () => {
  const all = nc.nets.flatMap(n => n.endpoints).filter(e => e.kind === "instance").map(e => e.instance);
  assert.ok(!all.includes("u_register") && !all.includes("u_incrementer"));
  const ch = buildNets(rc.modMap, "counter_channel");
  assert.deepStrictEqual(ch.nets.map(n => n.name), ["current_value", "next_value", "clk", "rst_n", "enable"]);
  assert.ok(epOf(netOf(ch, "current_value"), "u_incrementer.value") && epOf(netOf(ch, "current_value"), "u_register.q"));
  assert.strictEqual(epOf(netOf(ch, "current_value"), "u_register.q").arrow, "to-net");
});
t("정의 없는 모듈을 대상으로 하면 오류(정의 미제공)를 돌려준다", () => {
  const q = buildNets(rc.modMap, "no_such_module");
  assert.ok(q.error && q.undef === true);
});
t("정의 미제공 하위 모듈: 포트 방향·폭을 추측하지 않고 방향 없는 연결로 남긴다", () => {
  const q = analyze("module a; ghost u (.p(s)); k u2 (.q(s)); endmodule module k (output q); endmodule");
  const n = netOf(buildNets(q.modMap, "a"), "s");
  const g = epOf(n, "u.p");
  assert.deepStrictEqual([g.dir, g.arrow, g.why, g.bits], [null, "none", "undef-module", null]);
  assert.deepStrictEqual(n.counts, {drivers: 1, loads: 0, undirected: 1});
  assert.ok(codes(n).includes("unknown-dir") && codes(n).includes("width-unknown"));
});
t("정의에 없는 포트 이름도 방향 없는 연결로 남긴다", () => {
  const q = analyze("module a; k u (.zz(s)); endmodule module k (input x); endmodule");
  const g = epOf(netOf(buildNets(q.modMap, "a"), "s"), "u.zz");
  assert.deepStrictEqual([g.arrow, g.why], ["none", "undef-port"]);
});
t("inout: 연결 사실은 남기고 화살표 없이, 구동·수신 판정에서는 제외", () => {
  const q = analyze("module a; wire x; k u1 (.io(x)); k u2 (.io(x)); endmodule module k (inout io); endmodule");
  const n = netOf(buildNets(q.modMap, "a"), "x");
  assert.strictEqual(n.endpoints.length, 2);
  assert.ok(n.endpoints.every(e => e.dir === "inout" && e.arrow === "none" && e.why === "inout"));
  assert.deepStrictEqual(n.counts, {drivers: 0, loads: 0, undirected: 2});
  assert.ok(codes(n).includes("unknown-dir") && !codes(n).includes("multi-driver"));
});
t("구동 포트가 없을 때 ‘알려진 구동 포트 없음’이라고만 쓰고 ‘구동원 없음’으로 단정하지 않는다", () => {
  assert.ok(!codes(netOf(nc, "count_b")).includes("no-driver"));   // u_channel_b.count 가 구동하므로 해당 없음
  const m = analyze("module a; wire w; k u (.i(w)); endmodule module k (input i); endmodule");
  const note = netOf(buildNets(m.modMap, "a"), "w").notes.find(x => x.code === "no-driver");
  assert.ok(note && note.text.startsWith("알려진 구동 포트 없음") && note.text.includes("assign/always"));
  assert.ok(!note.text.includes("구동원 없음"));
});
t("구동 포트가 2개 이상이면 확인 필요(multi-driver) 경고", () => {
  const q = analyze("module a; k u1 (.o(w)); k u2 (.o(w)); endmodule module k (output o); endmodule");
  const n = netOf(buildNets(q.modMap, "a"), "w");
  assert.strictEqual(n.counts.drivers, 2);
  assert.ok(n.notes.find(x => x.code === "multi-driver").level === "warn");
});
t("폭: 계산할 수 있으면 비교(불일치 경고), 계산할 수 없으면 ‘폭 미확인’이며 추측하지 않는다", () => {
  const a = analyze("module a; wire [3:0] w; k u (.o(w)); endmodule module k (output [7:0] o); endmodule");
  const na = netOf(buildNets(a.modMap, "a"), "w");
  assert.ok(codes(na).includes("width-mismatch") && na.notes[0].level === "warn");
  const b = analyze("module a; wire [3:0] w; k u (.o(w)); endmodule module k (output [W-1:0] o); endmodule");
  const nb = netOf(buildNets(b.modMap, "a"), "w");
  assert.strictEqual(epOf(nb, "u.o").bits, null);
  assert.ok(codes(nb).includes("width-unknown") && !codes(nb).includes("width-mismatch"));
});
t("인스턴스 배열은 폭을 판단하지 않는다(폭 미확인)", () => {
  const q = analyze("module a; wire [3:0] w; k u [1:0] (.o(w)); endmodule module k (output o); endmodule");
  const e = epOf(netOf(buildNets(q.modMap, "a"), "w"), "u.o");
  assert.deepStrictEqual([e.array, e.bits], [true, null]);
});
t("선언 없는 신호는 ‘선언 없음’(암묵적 net 가능)으로 표시", () => {
  const q = analyze("module a; k u (.o(w)); endmodule module k (output o); endmodule");
  const n = netOf(buildNets(q.modMap, "a"), "w");
  assert.strictEqual(n.declared, "none");
  assert.ok(codes(n).includes("undeclared"));
});
t("분석 제외 종류별 사유: 비트 선택·연산식·상수·빈 연결·위치 기반·.*", () => {
  const q = analyze("module a; wire [1:0] a1; wire b1; k u1 (.p(a1[0]), .q({a1,b1}), .r(1'b0), .s()); k u2 (a1, b1); k u3 (.*); endmodule module k (input p, input q, input r, output s); endmodule");
  const ex = buildNets(q.modMap, "a").excluded;
  assert.deepStrictEqual(ex.map(x => x.kind), ["select", "expr", "const", "open", "positional", "positional", "implicit"]);
  assert.ok(ex.every(x => x.reason.length > 0 && x.instance));
});
t("계층 id 로 같은 모듈의 여러 인스턴스를 구분: 전체 인스턴스 경로가 다르다", () => {
  const tree = buildTree(rc.modMap, "counter_system", 1500).root, idx = indexTree(tree);
  const regs = [...idx.values()].filter(v => v.node.module === "register8");
  assert.strictEqual(regs.length, 2);
  assert.notStrictEqual(regs[0].node.id, regs[1].node.id);
  assert.deepStrictEqual(regs.map(v => v.pathText).sort(), ["counter_system.u_channel_a.u_register", "counter_system.u_channel_b.u_register"]);
  assert.strictEqual(idx.get(tree.id).pathText, "counter_system");
  assert.strictEqual(idx.size, 8);
  const kid = tree.children[0];
  assert.strictEqual(idx.get(kid.id).parent, tree.id);
});

console.log("\n[여러 파일 통합 (design.js, 화면 연결 전 — 데이터 로직만)]");
const F = (id, name, text, extra) => Object.assign({id, name, displayName: name, text, include: true}, extra || {});
const TOP_V = "module chip_top (input clk, output [7:0] out);\n  wire [7:0] w;\n  cpu u_cpu (.clk(clk), .dout(w));\n  memory u_mem (.clk(clk), .din(w), .q(out));\nendmodule\n";
const CPU_V = "// cpu\n// (주석 두 줄 뒤에서 시작)\nmodule cpu (input clk, output [7:0] dout);\n  alu u_alu (.clk(clk), .y(dout));\nendmodule\n";
const MEM_V = "\n\n\n\nmodule memory (input clk, input [7:0] din, output [7:0] q);\nendmodule\n";
const mk3 = () => [F("f1", "chip_top.v", TOP_V), F("f2", "cpu.v", CPU_V), F("f3", "memory.v", MEM_V)];
const D = analyzeDesign(mk3());

t("확장자: .v/.sv(대소문자 무시)만 허용, .vh·.txt·없음은 거부", () => {
  assert.ok(checkExtension("a.v").ok && checkExtension("A.V").ok && checkExtension("a.sv").ok);
  for (const n of ["a.vh", "a.txt", "a", "a.v.bak"]) assert.strictEqual(checkExtension(n).ok, false, n);
  assert.ok(checkExtension("a.vh").reason.includes(".vh"));
});
t(".sv 허용은 SystemVerilog 지원이 아니라는 경고를 붙이고, .v 에는 붙이지 않는다", () => {
  assert.ok(checkExtension("a.sv").note.includes("지원하지 않으며"));
  assert.strictEqual(checkExtension("a.v").note, null);
});
t("서로 다른 파일의 모듈을 모아 한 설계로: 모듈 3개, 최상위 chip_top, 정의 미제공 alu, 충돌 없음", () => {
  assert.deepStrictEqual(D.modules.map(m => m.name), ["chip_top", "cpu", "memory"]);
  assert.deepStrictEqual(D.roots, ["chip_top"]);
  assert.deepStrictEqual(D.undef, ["alu"]);
  assert.strictEqual(D.conflicts.length, 0);
  assert.strictEqual(D.instCount, 3);
  assert.ok(D.files.every(f => f.status === "ok" && f.moduleCount === 1));
});
t("모듈 줄 번호는 파일 기준이다(합친 가상 줄 번호 아님)", () => {
  const by = n => D.modMap.get(n);
  assert.deepStrictEqual([by("chip_top").line, by("chip_top").endLine, by("chip_top").fileName], [1, 5, "chip_top.v"]);
  assert.deepStrictEqual([by("cpu").line, by("cpu").endLine, by("cpu").fileName], [3, 5, "cpu.v"]);
  assert.deepStrictEqual([by("memory").line, by("memory").endLine, by("memory").fileName], [5, 6, "memory.v"]);
});
t("파일 간 부모·자식 연결: chip_top → cpu → alu(정의 미제공), 노드 id 는 전체 경로", () => {
  const tr = buildTree(D.modMap, "chip_top", 100).root;
  assert.deepStrictEqual(names(tr), ["(최상위):chip_top", "  u_cpu:cpu", "    u_alu:alu[정의 미제공]", "  u_mem:memory"]);
  assert.deepStrictEqual([...indexTree(tr).keys()], ["top", "top/u_cpu#0", "top/u_cpu#0/u_alu#0", "top/u_mem#1"]);
});
t("다른 파일의 하위 모듈 포트 방향·폭으로 신호 연결 분석 (cpu.dout output, memory.din input)", () => {
  const n = buildNets(D.modMap, "chip_top").nets.find(x => x.name === "w");
  const d = n.endpoints.find(e => e.instance === "u_cpu"), l = n.endpoints.find(e => e.instance === "u_mem");
  assert.deepStrictEqual([d.dir, d.arrow, d.bits, d.module], ["output", "to-net", 8, "cpu"]);
  assert.deepStrictEqual([l.dir, l.arrow, l.bits, l.module], ["input", "from-net", 8, "memory"]);
  assert.deepStrictEqual(n.counts, {drivers: 1, loads: 1, undirected: 0});
});
t("정의가 다른 파일에도 없는 하위 모듈(alu)은 방향 없음·정의 미제공으로 남긴다", () => {
  const n = buildNets(D.modMap, "cpu").nets.find(x => x.name === "clk");
  const e = n.endpoints.find(x => x.instance === "u_alu");
  assert.deepStrictEqual([e.arrow, e.why, e.dir], ["none", "undef-module", null]);
});
t("원본 소스: 해당 파일의 실제 내용과 파일 기준 줄 번호만 돌려준다", () => {
  const s = moduleSource(mk3(), D.modMap.get("cpu"));
  assert.strictEqual(s.fileName, "cpu.v");
  assert.deepStrictEqual(s.lines.map(l => l.no), [3, 4, 5]);
  assert.ok(s.lines[0].text.startsWith("module cpu") && s.lines[2].text === "endmodule");
  assert.ok(!s.lines.some(l => l.text.includes("chip_top")));
  assert.strictEqual(moduleSource([], D.modMap.get("cpu")), null);
});
t("인스턴스가 사용된 파일·줄: 부모 모듈의 파일 기준으로 구분한다", () => {
  const tr = buildTree(D.modMap, "chip_top", 100).root;
  const a = instanceLocation(D.modMap.get("chip_top"), 0), b = instanceLocation(D.modMap.get("cpu"), 0);
  assert.deepStrictEqual([a.fileName, a.line, a.instance, a.parentModule], ["chip_top.v", 3, "u_cpu", "chip_top"]);
  assert.deepStrictEqual([b.fileName, b.line, b.instance, b.parentModule], ["cpu.v", 4, "u_alu", "cpu"]);
  assert.strictEqual(instanceLocation(D.modMap.get("cpu"), 9), null);
  assert.strictEqual(tr.children[0].id, "top/u_cpu#0");
});
const EXTRA = F("f4", "extra.v", "\nmodule unused_mod; endmodule\n");
t("선택한 최상위에 포함되지 않는 모듈은 파일·줄과 함께 별도 목록으로 나온다", () => {
  const d = analyzeDesign(mk3().concat([EXTRA]));
  const s = scopeOf(d, "chip_top");
  assert.ok(s.ok);
  assert.deepStrictEqual(s.reachable.sort(), ["chip_top", "cpu", "memory"]);
  assert.deepStrictEqual(s.undef, ["alu"]);
  assert.deepStrictEqual(s.unreferenced.map(u => [u.name, u.fileName, u.line]), [["unused_mod", "extra.v", 2]]);
  const c = scopeOf(d, "cpu");
  assert.deepStrictEqual(c.unreferenced.map(u => u.name).sort(), ["chip_top", "memory", "unused_mod"]);
  assert.ok(d.roots.includes("unused_mod") && d.roots.includes("chip_top"));
});
t("연결해 주는 상위 코드가 없으면 임의 연결을 만들지 않는다 (memory 만 선택 → 하위 없음, 나머지는 미포함)", () => {
  const s = scopeOf(D, "memory");
  assert.deepStrictEqual(s.reachable, ["memory"]);
  assert.deepStrictEqual(s.unreferenced.map(u => u.name).sort(), ["chip_top", "cpu"]);
});
t("설계에 없는 최상위를 고르면 ok=false(undefined-top)", () => {
  const s = scopeOf(D, "nope");
  assert.deepStrictEqual([s.ok, s.reason, s.unreferenced], [false, "undefined-top", null]);
});
const MEM2 = F("f4", "memory2.v", "\nmodule memory (input clk);\nendmodule\n");
t("모듈명 충돌(다른 파일): 덮어쓰지 않고 파일·줄을 보여 주며 modMap 에서 뺀다", () => {
  const d = analyzeDesign(mk3().concat([MEM2]));
  assert.strictEqual(d.conflicts.length, 1);
  const c = d.conflicts[0];
  assert.deepStrictEqual([c.name, c.sameFile], ["memory", false]);
  assert.deepStrictEqual(c.defs.map(x => [x.fileName, x.line]), [["memory.v", 5], ["memory2.v", 2]]);
  assert.ok(!d.modMap.has("memory"));
  assert.strictEqual(d.defs.get("memory").length, 2);
});
t("충돌한 모듈에 도달하는 최상위는 계층도 생성 불가(conflict), 도달하지 않으면 그대로 가능", () => {
  const d = analyzeDesign(mk3().concat([MEM2]));
  const s = scopeOf(d, "chip_top");
  assert.deepStrictEqual([s.ok, s.reason, s.unreferenced], [false, "conflict", null]);
  assert.deepStrictEqual(s.conflicts.map(c => c.name), ["memory"]);
  assert.ok(s.message.includes("충돌"));
  const ok = scopeOf(d, "cpu");
  assert.ok(ok.ok && ok.conflicts.length === 0);
  assert.deepStrictEqual(ok.unreferenced.map(u => u.name + "@" + u.fileName).sort(), ["chip_top@chip_top.v", "memory@memory.v", "memory@memory2.v"]);
  assert.ok(ok.unreferenced.filter(u => u.name === "memory").every(u => u.conflict));
});
t("충돌한 이름이 최상위 자신이어도 막는다", () => {
  const d = analyzeDesign([F("f1", "a.v", "module t; endmodule"), F("f2", "b.v", "module t; endmodule")]);
  assert.strictEqual(scopeOf(d, "t").reason, "conflict");
});
t("한 파일 안의 중복 모듈 정의도 충돌로 남는다(첫 정의를 조용히 고르지 않음)", () => {
  const d = analyzeDesign([F("f1", "one.v", "module m;\nendmodule\n\nmodule m (input x);\nendmodule\n")]);
  assert.strictEqual(d.conflicts.length, 1);
  assert.deepStrictEqual([d.conflicts[0].sameFile, d.conflicts[0].defs.map(x => x.line)], [true, [1, 4]]);
  assert.ok(!d.modMap.has("m") && d.roots.includes("m"));
  assert.ok(!d.warnings.some(w => w.includes("먼저 나온 정의")));
  assert.strictEqual(scopeOf(d, "m").reason, "conflict");
});
t("충돌 파일을 분석에서 제외하면 충돌이 사라지고 제외 상태가 표시된다(파일은 지우지 않음)", () => {
  const fs2 = mk3().concat([Object.assign({}, MEM2, {include: false})]);
  const d = analyzeDesign(fs2);
  assert.strictEqual(d.conflicts.length, 0);
  assert.strictEqual(d.files.find(f => f.id === "f4").status, "excluded");
  assert.ok(scopeOf(d, "chip_top").ok);
  assert.strictEqual(fs2.length, 4);
});
t("서로 다른 분석 항목은 섞이지 않는다: 같은 모듈명·같은 파일 id 라도 결과 객체가 독립", () => {
  const A = analyzeDesign([F("f1", "x.v", "module cpu (input a);\nendmodule")]);
  const B = analyzeDesign([F("f1", "y.v", "module cpu (output b, output c);\nendmodule\nmodule other; endmodule")]);
  assert.notStrictEqual(A.modMap.get("cpu"), B.modMap.get("cpu"));
  assert.deepStrictEqual([A.modMap.get("cpu").fileName, B.modMap.get("cpu").fileName], ["x.v", "y.v"]);
  assert.deepStrictEqual([A.modules.length, B.modules.length], [1, 2]);
  assert.strictEqual(A.conflicts.length + B.conflicts.length, 0);
  A.modMap.get("cpu").ports.clear(); A.modules.length = 0; A.defs.clear();
  assert.strictEqual(B.modMap.get("cpu").ports.size, 2);
  assert.strictEqual(B.modules.length, 2);
  assert.ok(!scopeOf(A, "other").ok && scopeOf(B, "other").ok);
});
t("입력 파일 객체는 수정하지 않는다(분석은 읽기만)", () => {
  const src = mk3(), snap = JSON.stringify(src);
  analyzeDesign(src); scopeOf(analyzeDesign(src), "chip_top");
  assert.strictEqual(JSON.stringify(src), snap);
});
t("모듈이 없는 파일·빈 파일은 그 파일만 오류 상태로 남고 나머지는 분석된다", () => {
  const d = analyzeDesign(mk3().concat([F("f4", "empty.v", "  "), F("f5", "comment.v", "// 모듈 없음\n")]));
  assert.deepStrictEqual(d.files.filter(f => f.status === "error").map(f => f.name), ["empty.v", "comment.v"]);
  assert.ok(d.files.find(f => f.name === "empty.v").error.length > 0);
  assert.strictEqual(d.modules.length, 3);
  assert.ok(d.warnings.some(w => w.startsWith("[empty.v] 분석하지 못했습니다")));
  assert.strictEqual(d.error, null);
  const none = analyzeDesign([F("f1", "e.v", "")]);
  assert.ok(none.error && none.modules.length === 0);
});
t("`include·매크로: 경고를 파일명과 함께 보이고, include 대상이 자동 분석되지 않는다고 알린다", () => {
  const d = analyzeDesign([F("f1", "inc.v", "`include \"defs.vh\"\nmodule a;\nendmodule\n")]);
  const f = d.files[0];
  assert.ok(f.notes.some(n => n.includes("자동으로 찾거나 분석하지 않습니다")));
  assert.ok(f.warnings.some(w => w.includes("지시어")));
  assert.ok(d.warnings.some(w => w.startsWith("[inc.v] ") && w.includes("지시어")));
  assert.deepStrictEqual(d.files.map(x => x.status), ["ok"]);
  assert.ok(!analyzeDesign([F("f1", "n.v", "// `include 주석\nmodule a; endmodule")]).files[0].notes.some(n => n.includes("include")));
});
t(".sv 파일: 문법 미지원 경고 + 키워드 힌트(판정 아님). .v 의 SV 키워드도 힌트만", () => {
  const d = analyzeDesign([F("f1", "s.sv", "module a;\n  logic x;\nendmodule\n"), F("f2", "p.v", "module b; endmodule"), F("f3", "q.v", "// logic\nmodule c; endmodule")]);
  assert.ok(d.files[0].notes.some(n => n.includes("SystemVerilog 문법을 지원하지 않으며")));
  assert.deepStrictEqual(d.files[0].svHints, ["logic"]);
  assert.ok(d.files[0].notes.some(n => n.includes("힌트일 뿐")));
  assert.deepStrictEqual([d.files[1].notes.length, d.files[2].svHints.length], [0, 0]);
});
t("파일 추가: 허용하지 않는 확장자는 거부 사유와 함께 추가되지 않는다", () => {
  const r2 = planAddFiles([], [{name: "h.vh", text: "x"}, {name: "ok.v", text: "module a; endmodule"}, {name: "n.txt", text: ""}]);
  assert.deepStrictEqual(r2.rejected.map(x => x.name), ["h.vh", "n.txt"]);
  assert.deepStrictEqual(r2.files.map(f => f.name), ["ok.v"]);
  assert.ok(r2.rejected[0].reason.includes(".vh"));
});
const CPU_FILE = () => planAddFiles([], [{name: "cpu.v", text: CPU_V, size: 100, lastModified: 5}]).files;
t("같은 이름 파일: 일괄 거부하지 않고 결정 전에는 대기(pending)로 두며, 같은 파일이라고 확정하지 않는다", () => {
  const ex = CPU_FILE();
  const r2 = planAddFiles(ex, [{name: "cpu.v", text: "module cpu; endmodule", size: 21, lastModified: 9}]);
  assert.deepStrictEqual([r2.added.length, r2.skipped.length, r2.pending.length, r2.files.length], [0, 0, 1, 1]);
  const p = r2.pending[0];
  assert.deepStrictEqual([p.matches[0].sameText, p.matches[0].sameSize, p.matches[0].sameModified], [false, false, false]);
  assert.ok(p.note.includes("확정할 수 없습니다") && !/같은 파일입니다/.test(p.note));
});
t("이름·크기·수정 시각·내용이 모두 같아도 자동 건너뛰기·자동 확정하지 않고 사용자 결정을 기다린다", () => {
  const ex = CPU_FILE();
  const r2 = planAddFiles(ex, [{name: "cpu.v", text: CPU_V, size: 100, lastModified: 5}]);
  assert.strictEqual(r2.pending.length, 1);
  assert.deepStrictEqual([r2.pending[0].sameText, r2.pending[0].matches[0].sameSize, r2.pending[0].matches[0].sameModified], [true, true, true]);
  assert.ok(r2.pending[0].note.includes("내용이 완전히 같은 파일이 있지만") && r2.pending[0].note.includes("확정할 수 없습니다"));
  assert.strictEqual(r2.added.length, 0);
});
t("결정 '이번 추가 건너뛰기': 목록은 그대로, 건너뛴 항목만 기록", () => {
  const ex = CPU_FILE();
  const r2 = planAddFiles(ex, [{name: "cpu.v", text: "module cpu; endmodule"}], {0: "skip"});
  assert.deepStrictEqual([r2.files.length, r2.skipped.map(s => s.name), r2.pending.length], [1, ["cpu.v"], 0]);
});
t("결정 '별도 소스로 추가': 내부 ID·표시 이름으로 구분하고 원래 파일명·코드는 바꾸지 않는다", () => {
  const ex = CPU_FILE(), txt = "module cpu;\nendmodule\n";
  const r2 = planAddFiles(ex, [{name: "cpu.v", text: txt}], {0: "separate"});
  const a = r2.added[0];
  assert.deepStrictEqual([a.name, a.displayName, a.text], ["cpu.v", "cpu (2).v", txt]);
  assert.notStrictEqual(a.id, ex[0].id);
  assert.deepStrictEqual(r2.files.map(f => f.displayName), ["cpu.v", "cpu (2).v"]);
  const r3 = planAddFiles(r2.files, [{name: "cpu.v", text: "x"}], {0: "separate"});
  assert.strictEqual(r3.added[0].displayName, "cpu (3).v");
  assert.strictEqual(new Set(r3.files.map(f => f.id)).size, 3);
});
t("이름 비교는 대소문자를 구분하지 않는다(Windows 파일명), 기존 파일 객체는 바뀌지 않는다", () => {
  const ex = CPU_FILE(), snap = JSON.stringify(ex);
  const r2 = planAddFiles(ex, [{name: "CPU.V", text: "x"}]);
  assert.strictEqual(r2.pending.length, 1);
  assert.strictEqual(JSON.stringify(ex), snap);
});
t("한 번에 같은 이름 2개를 고르면 두 번째가 대기로 남는다", () => {
  const r2 = planAddFiles([], [{name: "a.v", text: "module a; endmodule"}, {name: "a.v", text: "module b; endmodule"}]);
  assert.deepStrictEqual([r2.added.length, r2.pending.map(p => p.index)], [1, [1]]);
});
t("파일명 중복과 모듈명 충돌은 별개: 이름이 같아도 모듈이 다르면 충돌 없음, 별도 추가한 같은 모듈은 충돌", () => {
  const a = planAddFiles([], [{name: "top.v", text: "module m1; endmodule"}]).files;
  const b = planAddFiles(a, [{name: "top.v", text: "module m2; endmodule"}], {0: "separate"}).files;
  const d1 = analyzeDesign(b);
  assert.deepStrictEqual([d1.conflicts.length, d1.modules.map(m => m.name)], [0, ["m1", "m2"]]);
  assert.deepStrictEqual(d1.modules.map(m => m.file.displayName), ["top.v", "top (2).v"]);
  const c = planAddFiles(a, [{name: "top.v", text: "module m1; endmodule"}], {0: "separate"}).files;
  const d2 = analyzeDesign(c);
  assert.deepStrictEqual(d2.conflicts.map(x => [x.name, x.defs.map(y => y.displayName)]), [["m1", ["top.v", "top (2).v"]]]);
  assert.deepStrictEqual(d2.conflicts[0].defs.map(y => y.fileName), ["top.v", "top.v"]);
});
t("파일별 줄 번호와 module 경고는 합쳐도 그대로 파일 기준이다", () => {
  const d = analyzeDesign([F("f1", "a.v", "\n\nmodule a;\n  b u1 (x, y);\nendmodule\n"), F("f2", "c.v", "module c;\n  d u2 (.p(q));\nendmodule\n")]);
  assert.strictEqual(d.modMap.get("a").instances[0].line, 4);
  assert.strictEqual(d.modMap.get("c").instances[0].line, 2);
  assert.ok(d.modMap.get("a").warns.some(w => w.startsWith("4줄")));
});

console.log("\n[여러 파일 통합 · 화면 연결용 (Markdown · 범위 · 위치)]");
t("Markdown: 통합 설계 결과에는 정의 파일명과 파일 기준 줄 번호가 들어간다", () => {
  const md3 = toMarkdown(analyzeDesign(mk3()));
  assert.ok(md3.includes("정의 파일") && md3.includes(mdText("chip_top.v")) && md3.includes(mdText("cpu.v")) && md3.includes(mdText("memory.v")));
  assert.ok(md3.includes("파일 기준"));
});
t("Markdown: 단일 파일 결과(analyze)는 이전 형식 그대로다(파일 열 없음)", () => {
  assert.ok(!toMarkdown(analyze(SAMPLE)).includes("정의 파일"));
});
t("Markdown: 모듈명 충돌이 확인 필요 항목과 '정의 충돌'로 남는다", () => {
  const dd = analyzeDesign(mk3().concat([F("f9", "cpu_old.v", "module cpu(input clk);\nendmodule\n")]));
  const md4 = toMarkdown(dd);
  assert.ok(md4.includes("정의 충돌"));
  assert.ok(collectNotes(dd).some(n => n.text.includes("cpu") && n.text.includes("충돌")));
});
t("scopeOf: 충돌 모듈에 도달하는 최상위는 막히고 도달하지 않는 최상위는 막히지 않는다", () => {
  const dd = analyzeDesign(mk3().concat([F("f9", "cpu_old.v", "module cpu(input clk);\nendmodule\n")]));
  const tops = dd.roots;
  assert.ok(tops.length >= 1);
  const blocked = scopeOf(dd, tops[0]);
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(blocked.reason, "conflict");
});
t("분석 제외한 파일은 결과·충돌에서 빠지고 목록에는 남는다", () => {
  const fs3 = mk3().concat([F("f9", "cpu_old.v", "module cpu(input clk);\nendmodule\n", {include: false})]);
  const dd = analyzeDesign(fs3);
  assert.strictEqual(dd.conflicts.length, 0);
  assert.strictEqual(dd.files.find(f => f.id === "f9").status, "excluded");
});

console.log("\n결과: 통과 " + pass + " / 실패 " + fail);
process.exit(fail ? 1 : 0);
