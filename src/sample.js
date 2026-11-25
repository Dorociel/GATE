// 입력창 기본값으로 쓰는 예제 코드 (examples/basic_top_child.v 와 내용이 같아야 함 - test/check.js가 비교)
const SAMPLE = `// 예제: top이 child 모듈을 두 번 인스턴스화합니다.
module top (
  input        clk,
  input        rst_n,
  output [7:0] out_a,
  output [7:0] out_b
);
  // child u_old (.clk(clk));   <- 주석 처리된 인스턴스는 무시됩니다
  child u_child_0 (
    .clk   (clk),
    .rst_n (rst_n),
    .dout  (out_a)
  );

  /* 같은 모듈, 다른 인스턴스 */
  child #(.WIDTH(8)) u_child_1 (
    .clk   (clk),
    .rst_n (rst_n),
    .dout  (out_b)
  );
endmodule

module child (
  input            clk,
  input            rst_n,
  output reg [7:0] dout
);
  parameter WIDTH = 8;
  leaf u_leaf (.clk(clk));
  always @(posedge clk or negedge rst_n)
    if (!rst_n) dout <= 8'h00;
    else        dout <= dout + 1'b1;
endmodule

module leaf (input clk);
endmodule
`;

if (typeof module !== "undefined" && module.exports) module.exports = {SAMPLE};
