// 테스트벤치 예제: rtl_counter.v 의 counter_top(DUT)을 u_dut 로 인스턴스화합니다.
// 이 앱은 이 코드를 실행하지 않습니다. 분석 화면은 코드에 적힌 내용만 보여 주며 통과/실패를 판정하지 않습니다.
`timescale 1ns/1ps
module tb_counter;
  reg        clk;
  reg        rst_n;
  reg        en;
  wire [3:0] count;
  wire       done;

  counter_top u_dut (.clk(clk), .rst_n(rst_n), .en(en), .count(count), .done(done));

  // 클록
  initial clk = 1'b0;
  always #5 clk = ~clk;

  // 자극과 확인
  initial begin
    $dumpfile("tb_counter.vcd");
    $dumpvars(0, tb_counter);
    en = 1'bz;
    #10 rst_n = 1'b0;
    #5  en = 1'b0;
    #15 rst_n = 1'b1;
    #10 en = 1'b1;
    wait (done == 1'b1);
    if (count !== 4'd5) $display("FAIL: count=%d", count);
    else $display("PASS");
    check_range(4'd5);
    #20 $finish;
  end

  // 타임아웃 감시(별도 initial 블록: 위 블록과 병렬로 실행되는 코드입니다)
  initial begin
    #1000 $display("TIMEOUT");
    $finish;
  end

  task check_range;
    input [3:0] v;
    begin
      if (v > 4'd9) $display("range error");
    end
  endtask
endmodule
