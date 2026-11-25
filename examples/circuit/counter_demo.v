// 카운터 예제: 8비트 레지스터(비동기 리셋·Enable), 가산기, MUX
module counter_demo(input clk, input rst_n, input en, output reg [7:0] q);
  always @(posedge clk or negedge rst_n) begin
    if (!rst_n) q <= 8'd0;
    else if (en) q <= q + 8'd1;
  end
endmodule
