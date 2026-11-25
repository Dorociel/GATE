// 신호 연결 확인용 예제: counter_system 이 counter_channel 2개와 count_compare 1개를 연결합니다.
// 일부러 넣은 항목: 상수 연결(.enable(1'b1)), 비트 선택 연결(.b(count_b[7:0])).
module counter_system (
  input        clk,
  input        rst_n,
  input        enable,
  output [7:0] count_a_out,
  output       equal
);
  wire [7:0] count_a;
  wire [7:0] count_b;

  counter_channel u_channel_a (.clk(clk), .rst_n(rst_n), .enable(enable), .count(count_a));
  counter_channel u_channel_b (.clk(clk), .rst_n(rst_n), .enable(1'b1),   .count(count_b));
  count_compare   u_compare   (.a(count_a), .b(count_b[7:0]), .equal(equal));

  assign count_a_out = count_a;
endmodule

module counter_channel (
  input        clk,
  input        rst_n,
  input        enable,
  output [7:0] count
);
  wire [7:0] current_value;
  wire [7:0] next_value;

  incrementer u_incrementer (.value(current_value), .next_value(next_value));
  register8   u_register    (.clk(clk), .rst_n(rst_n), .enable(enable), .d(next_value), .q(current_value));

  assign count = current_value;
endmodule

module incrementer (
  input  wire [7:0] value,
  output wire [7:0] next_value
);
  assign next_value = value + 8'd1;
endmodule

module register8 (
  input            clk,
  input            rst_n,
  input            enable,
  input      [7:0] d,
  output reg [7:0] q
);
  always @(posedge clk or negedge rst_n)
    if (!rst_n) q <= 8'd0;
    else if (enable) q <= d;
endmodule

module count_compare (
  input  [7:0] a,
  input  [7:0] b,
  output       equal
);
  assign equal = (a == b);
endmodule
