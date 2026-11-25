// 작은 조합회로 예제: MUX, 비교기, 가산기, 논리 연산
module comb_demo(input [3:0] a, input [3:0] b, input sel, output [3:0] y, output eq, output [4:0] s);
  assign y = sel ? (a & b) : (a ^ b);
  assign eq = (a == b);
  assign s = a + b;
endmodule
