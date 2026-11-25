sim_demo: 설계(RTL) · 테스트벤치 · VCD 가 서로 대응되는 작은 예제

  rtl_counter.v   설계: counter_top(cnt4 + cmp_max)
  tb_counter.v    테스트벤치: tb_counter 가 counter_top 을 u_dut 로 사용
  tb_counter.vcd  VCD 파일 ※ 수작업 fixture 입니다. 실제 시뮬레이터가 출력한 파일이 아닙니다.

사용 방법(앱)
  1. + 새 분석 → 통합 설계 → 두 .v 파일 추가 (tb_counter.v 의 역할을 ‘테스트벤치’로 지정)
  2. 코드 분석 → 최상위 모듈 tb_counter → 계층도 생성
  3. u_dut 블록을 두 번 눌러 상세 → ‘이 모듈의 신호 연결 보기’ → [그래프]
  4. [VCD 불러오기] 로 tb_counter.vcd 선택, 기준 경로 tb_counter 확인 후 재생

VCD 는 tb_counter.v 의 동작(클록 반주기 5ns, 리셋 해제 30ns, en=1 40ns, done 85ns)을 손으로 따라가 작성했으며,
시간 단위는 1ns 입니다. 시작 시점(0ns)에는 일부 신호가 X(알 수 없음), en 이 Z(구동 없음)로 기록되어 있습니다.
