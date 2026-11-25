// 테스트벤치 분석(tbanalyze.js) 검사. 실행: node test/check_tb.js
const assert = require("assert");
const fs = require("fs"), path = require("path");
const {analyzeDesign} = require("../src/design.js");
const {analyzeTestbench, tbCandidates, tbFileHint} = require("../src/tbanalyze.js");
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log("  통과  " + name); } catch (e) { fail++; console.log("  실패  " + name + " :: " + e.message); } }
const rd = n => fs.readFileSync(path.join(__dirname, "..", "examples", "sim_demo", n), "utf8");
const F = [["rtl_counter.v", "f0"], ["tb_counter.v", "f1"]].map(([n, id]) => ({id, name: n, displayName: n, text: rd(n), include: true}));
const res = analyzeDesign(F), roles = new Map([["f1", "testbench"]]);
const A = analyzeTestbench({res, files: F, roles, tb: "tb_counter"});
const has = (c, re, lv) => A.sections[c].some(x => re.test(x.text) && (!lv || x.level === lv));

t("후보: 역할 지정/패턴 힌트", () => {
  assert.strictEqual(tbCandidates(res, roles).length, 1);
  assert.strictEqual(tbCandidates(res, new Map()).length, 1);
  assert(tbFileHint(res, "f1") && !tbFileHint(res, "f0"));
});
t("분석 성공 · 병렬 블록 4개 분리 · timescale", () => {
  assert(A.ok); assert.strictEqual(A.blocks.length, 4); assert.strictEqual(A.timescale.unit, "1ns");
});
t("클록: 반주기 5 ns (15줄)", () => { assert(has("clock", /반주기 5 ns/, "code")); assert(A.sections.clock.some(x => x.line === 15)); assert(has("clock", /추정/, "inferred")); });
t("리셋: 10ns→30ns", () => assert(has("reset", /10 ns\] 1'b0.*30 ns\] 1'b1/, "code")));
t("입력 자극 en 시각", () => {
  const s = A.sections.stimulus.filter(x => x.signal === "en");
  assert.strictEqual(s.length, 3); assert(s[1].at.startsWith("15 ns")); assert(s[2].at.startsWith("40 ns"));
});
t("wait(done) 이후 시각 불명", () => { assert(has("wait", /wait \(done == 1'b1\)/)); assert(A.sections.compare[0].at.includes("시각 불명")); });
t("출력 비교 count, 통과·실패 판정 없음", () => {
  assert(A.hasCompare && has("compare", /count !== 4'd5/)); assert(/판정하지 않/.test(A.banner));
  assert(!/통과했|실패했|PASS 입니다/.test(Object.values(A.sections).flat().map(x => x.text).join("\n")));
});
t("$finish·타임아웃은 별도 initial 블록(1000 ns)", () => { assert(has("finish", /\$finish/)); assert(A.sections.finish.some(x => x.at.startsWith("1000 ns"))); });
t("task 정의·호출은 분석 미지원", () => {
  assert(has("unsupported", /check_range 정의/) && has("unsupported", /check_range\(4'd5\)/));
  assert(A.sections.unsupported.every(x => /분석 미지원/.test(x.text)));
});
t("모든 항목에 파일명·줄 번호", () => { for (const k in A.sections) A.sections[k].forEach(x => assert(x.file === "tb_counter.v" && x.line > 0)); });
t("DUT 후보와 연결 방향", () => { const d = A.dut[0]; assert(d.candidate && d.instance === "u_dut" && d.outputs.includes("done") && d.inputs.includes("clk")); });
t("자동 비교가 없으면 관찰용(추정)", () => {
  const src = "module t2; reg clk; wire [3:0] c; wire d; initial begin clk=0; #50 $finish; end counter_top u(.clk(clk),.rst_n(1'b1),.en(1'b1),.count(c),.done(d)); endmodule";
  const f2 = [F[0], {id: "f9", name: "t2.v", displayName: "t2.v", text: src, include: true}];
  const r = analyzeDesign(f2), a = analyzeTestbench({res: r, files: f2, roles: new Map(), tb: "t2"});
  assert(a.ok && !a.hasCompare && a.sections.observe.some(x => x.level === "inferred" && /관찰용/.test(x.text)));
});
t("없는 모듈은 오류 반환(예외 없음)", () => { const a = analyzeTestbench({res, files: F, roles, tb: "nope"}); assert(!a.ok && a.error); });
console.log("결과: 통과 " + pass + " / 실패 " + fail);
process.exit(fail ? 1 : 0);
