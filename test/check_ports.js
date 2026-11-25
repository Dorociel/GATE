// 블록 포트 표시 데이터·배치(portinfo.js, layout.js) 검사. 실행: node test/check_ports.js
const assert = require("assert");
const {analyze, buildTree} = require("../src/analyzer.js");
const P = require("../src/portinfo.js");
const {layout} = require("../src/layout.js");
const T = require("../src/treeview.js");
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log("  통과  " + name); } catch (e) { fail++; console.log("  실패  " + name + " :: " + e.message); } }

const SRC = `
module counter32(input clk, input rst_n, input enable, output reg [31:0] count, inout [3:0] io);
endmodule
module top(input clk, input rst_n, input enable_a, input enable_b, output [31:0] count_a, output [31:0] count_b);
  wire [3:0] bus_a, bus_b;
  counter32 u_a(.clk(clk), .rst_n(rst_n), .enable(enable_a), .count(count_a), .io(bus_a));
  counter32 u_b(.clk(clk), .rst_n(rst_n), .enable(enable_b), .count(count_b), .io(bus_b));
  counter32 u_c(clk, rst_n, 1'b1, , bus_a);
  ghost g0(.x(clk));
endmodule`;
const res = analyze(SRC), mm = res.modMap, top = mm.get("top");
const row = (b, p) => b.rows.find(r => r.port === p);

t("방향 분류: input 왼쪽, output·inout 오른쪽", () => {
  const b = P.piBlock(mm, "counter32", top, 0), L = P.piLayout(b, false);
  assert.deepStrictEqual(L.left.map(r => r.port), ["clk", "rst_n", "enable"]);
  assert.deepStrictEqual(L.right.map(r => r.port), ["count", "io"]);
  assert.strictEqual(row(b, "io").dir, "inout");
});
t("폭: [31:0]/32비트, 스칼라는 폭 표기 없음", () => {
  const b = P.piBlock(mm, "counter32", top, 0);
  assert.strictEqual(row(b, "count").bits, 32); assert.strictEqual(P.piLabel(row(b, "count"), false).name, "count[31:0]");
  assert.strictEqual(P.piLabel(row(b, "clk"), false).name, "clk");
});
t("포트명과 상위 신호 구분: enable ← enable_a", () => {
  const a = P.piBlock(mm, "counter32", top, 0);
  assert.strictEqual(row(a, "enable").signal, "enable_a"); assert.strictEqual(row(a, "enable").conn, "net");
  assert.strictEqual(P.piLabel(row(a, "enable"), false).sig, "enable_a");
  assert.notStrictEqual(row(a, "enable").port, row(a, "enable").signal);
});
t("같은 모듈의 다른 인스턴스는 각각 실제 연결 표시", () => {
  const a = P.piBlock(mm, "counter32", top, 0), b = P.piBlock(mm, "counter32", top, 1);
  assert.strictEqual(row(a, "enable").signal, "enable_a"); assert.strictEqual(row(b, "enable").signal, "enable_b");
  assert.strictEqual(row(a, "count").signal, "count_a"); assert.strictEqual(row(b, "count").signal, "count_b");
  assert.strictEqual(row(a, "io").signal, "bus_a"); assert.strictEqual(row(b, "io").signal, "bus_b");
});
t("순서 기반·상수·빈 연결을 단일 신호명과 구분", () => {
  const c = P.piBlock(mm, "counter32", top, 2);
  assert.strictEqual(row(c, "clk").conn, "positional");
  assert(/순서/.test(P.piLabel(row(c, "clk"), false).sig));
  assert(/순서 기반/.test(row(c, "clk").full));
});
t("정의 미제공 모듈은 포트를 만들어 내지 않음", () => {
  const g = P.piBlock(mm, "ghost", top, 3); assert(!g.defined && g.rows.length === 0 && P.piMetrics(g, false, false, 40, 6.7) === null);
});
t("최상위는 상위 연결 없음으로 표시", () => {
  const r = P.piBlock(mm, "top", null, 0); assert(r.root && r.rows.every(x => x.conn === "none"));
  assert.strictEqual(P.piLabel(r.rows[0], true).sig, "");
});
t("방향·폭을 모르면 미확인으로 둠(추정 없음)", () => {
  const b = {defined: true, total: 1, rows: [], inputs: [], outputs: [], inouts: [], unknown: []};
  const unk = {name: "p", dir: null, bits: null, range: null};
  const fake = new Map([["m", {ports: new Map([["p", unk]]), instances: []}]]);
  const bl = P.piBlock(fake, "m", null, 0);
  assert.strictEqual(bl.rows[0].dir, "unknown"); assert(/방향 미확인/.test(bl.rows[0].full)); assert(/폭 미확인/.test(bl.rows[0].full));
  assert.strictEqual(P.piLabel(bl.rows[0], true).name, "p[?]");
  assert.strictEqual(P.piLayout(bl, false).left.length, 1);   // 방향 미확인은 왼쪽 목록에 '미확인' 표시와 함께
});
t("포트가 많으면 접힌 요약 + 숨긴 개수, 전체 보기에서는 모두", () => {
  const ports = Array.from({length: 24}, (_, i) => (i < 12 ? "input a" + i : "output [7:0] y" + i)).join(", ");
  const r = analyze("module big(" + ports + "); endmodule\nmodule t(); big u(); endmodule");
  const b = P.piBlock(r.modMap, "big", r.modMap.get("t"), 0);
  assert.strictEqual(b.total, 24);
  const f = P.piLayout(b, false), full = P.piLayout(b, true);
  assert(f.folded && f.hidden > 0 && f.left.length + f.right.length + f.hidden === 24);
  assert(!full.folded && full.left.length + full.right.length === 24);
  assert(P.piMetrics(b, true, false, 40, 6.7).h > P.piMetrics(b, false, false, 40, 6.7).h);
});
t("블록 높이가 다른 노드도 열 안에서 겹치지 않음", () => {
  const {root} = buildTree(mm, "top", 1500);
  const v = T.tvView(root, new Set([root.id]));
  const st = [v]; while (st.length) { const n = st.pop(); n.h = n.id === "top" ? 150 : 60 + (n.instance.charCodeAt(2) % 3) * 40; n.minW = 200; st.push(...n.children); }
  const L = layout(v);
  const byDepth = new Map(); L.nodes.forEach(n => { (byDepth.get(n.depth) || byDepth.set(n.depth, []).get(n.depth)).push(n); });
  for (const arr of byDepth.values()) { arr.sort((a, b) => a.y - b.y); for (let i = 1; i < arr.length; i++) assert(arr[i].y >= arr[i - 1].y + arr[i - 1].h, "overlap"); }
  assert(L.nodes.every(n => n.w >= 200 && n.y >= 0) && L.height >= Math.max(...L.nodes.map(n => n.y + n.h)));
});
t("좁은 폭: 긴 이름이 있어도 최소 폭이 상한을 넘지 않음", () => {
  const long = "very_long_signal_name_that_keeps_going_" + "x".repeat(60);
  const r = analyze("module m(input " + long + "); endmodule\nmodule t(input " + long + "); m u(." + long + "(" + long + ")); endmodule");
  const b = P.piBlock(r.modMap, "m", r.modMap.get("t"), 0), pm = P.piMetrics(b, false, false, 40, 6.7);
  assert(pm.minW > 300);   // 레이아웃이 MAX_W_PORTS(520)로 제한하고 화면에서 말줄임 + 툴팁으로 전체 이름 제공
  assert(b.rows[0].full.includes(long));
});
console.log("결과: 통과 " + pass + " / 실패 " + fail);
process.exit(fail ? 1 : 0);
