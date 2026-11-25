// 설계(RTL) 예제: counter_top 은 4비트 카운터(cnt4)와 비교기(cmp_max)를 연결합니다.
// 테스트벤치 tb_counter.v, VCD tb_counter.vcd 와 함께 쓰는 작은 예제입니다.
module counter_top (
  input        clk,
  input        rst_n,
  input        en,
  output [3:0] count,
  output       done
);
  cnt4    u_cnt (.clk(clk), .rst_n(rst_n), .en(en), .q(count));
  cmp_max u_cmp (.value(count), .hit(done));
endmodule

module cnt4 (
  input            clk,
  input            rst_n,
  input            en,
  output reg [3:0] q
);
  always @(posedge clk or negedge rst_n)
    if (!rst_n) q <= 4'd0;
    else if (en) q <= q + 4'd1;
endmodule

module cmp_max (
  input  [3:0] value,
  output       hit
);
  assign hit = (value == 4'd5);
endmodule
