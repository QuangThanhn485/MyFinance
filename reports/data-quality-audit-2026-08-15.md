# Finance data audit

- Backup: `D:\myfinance-backup-2026-08-15.json`
- Data updated at: `2026-08-15T08:30:44.508Z`
- Audit cutoff: `2026-08-15`
- Records: 907 expenses, 70 fixed costs, 23 savings transactions
- Findings: 0 errors, 12 warnings, 0 informational

## Findings

- **WARNING expenses.nominal_correction_values**: 3 expenses use nominal values of 100 VND or less and are likely corrections/placeholders rather than real cash outflow. Evidence: 2026-05-16: 1 d (Bữa chính 33k (cân bằng -33k)); 2026-05-16: 1 d (Sinh tố bơ (cân bằng -30k)); 2026-06-21: 1 d (Du lịch).
- **WARNING fixed_costs.payment_history_missing**: 2026-01 is locked but all fixed-cost paid amounts are zero. Historical cash balance cannot be reconstructed exactly. Evidence: 6 fixed-cost rows, 6.000.000 d planned.
- **WARNING fixed_costs.payment_history_missing**: 2026-02 is locked but all fixed-cost paid amounts are zero. Historical cash balance cannot be reconstructed exactly. Evidence: 5 fixed-cost rows, 5.000.000 d planned.
- **WARNING fixed_costs.payment_history_missing**: 2026-03 is locked but all fixed-cost paid amounts are zero. Historical cash balance cannot be reconstructed exactly. Evidence: 6 fixed-cost rows, 5.528.500 d planned.
- **WARNING fixed_costs.payment_history_missing**: 2026-04 is locked but all fixed-cost paid amounts are zero. Historical cash balance cannot be reconstructed exactly. Evidence: 6 fixed-cost rows, 5.557.900 d planned.
- **WARNING fixed_costs.payment_history_missing**: 2026-05 is locked but all fixed-cost paid amounts are zero. Historical cash balance cannot be reconstructed exactly. Evidence: 8 fixed-cost rows, 7.167.500 d planned.
- **WARNING fixed_costs.payment_history_missing**: 2026-06 is locked but all fixed-cost paid amounts are zero. Historical cash balance cannot be reconstructed exactly. Evidence: 8 fixed-cost rows, 7.290.100 d planned.
- **WARNING future.configuration_gap**: 2027-07 is an isolated future configuration after 2026-12. Evidence: Inherited settings and emergency opening cannot be treated as a continuous monthly ledger..
- **WARNING future.missing_fixed_costs**: 2026-12 has settings but no fixed costs although 2026-11 has 6. Evidence: Future reports for this month will overstate available money and savings..
- **WARNING reconciliation.legacy_without_snapshot**: Reconciliation 2026-07 has no immutable calculation snapshot. Evidence: saved as of 2026-07-26.
- **WARNING reconciliation.legacy_without_snapshot**: Reconciliation 2026-08 has no immutable calculation snapshot. Evidence: saved as of 2026-08-09.
- **WARNING savings.stale_auto_opening**: Auto emergency opening for 2026-09 is stale. Evidence: stored 30.254.711 d, recomputed 27.085.311 d, difference 3.169.400 d.

## Current cutoff control

- Budget used: 8.143.900 d = fixed plan 6.517.900 d + recorded variable spending 1.626.000 d.
- Actual recorded cash outflow: 7.913.900 d = fixed paid 6.287.900 d + recorded variable spending 1.626.000 d.
- Remaining variable budget: 1.856.100 d of 3.482.100 d.
- System balance: 27.315.311 d; independent cash-flow control: 27.315.311 d.
- Today: spent 83.000 d, cap 114.064 d, remaining 31.064 d. Next-period cap: 116.006 d for 16 days.

## Monthly ledger

| Month | Lock | Income | Fixed plan | Fixed paid | Variable spent | Savings target | Actual savings | Emergency opening | Fund movement | Emergency closing |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2026-01 | yes | 13.500.000 d | 6.000.000 d | 0 d | 3.570.000 d | 4.000.000 d | 3.930.000 d | 8.000.000 d | 0 d | 8.000.000 d |
| 2026-02 | yes | 16.800.000 d | 5.000.000 d | 0 d | 10.926.000 d | 880.000 d | 874.000 d | 7.000.000 d | 0 d | 7.000.000 d |
| 2026-03 | yes | 15.000.000 d | 5.528.500 d | 0 d | 3.668.000 d | 6.000.000 d | 5.803.500 d | 5.580.000 d | 0 d | 5.580.000 d |
| 2026-04 | yes | 14.000.000 d | 5.557.900 d | 0 d | 3.438.000 d | 5.000.000 d | 5.004.100 d | 12.108.614 d | -93.000 d | 12.015.614 d |
| 2026-05 | yes | 14.000.000 d | 7.167.500 d | 0 d | 3.647.502 d | 3.200.000 d | 3.184.998 d | 17.019.714 d | -6.060.900 d | 10.958.814 d |
| 2026-06 | yes | 14.000.000 d | 7.290.100 d | 0 d | 3.214.001 d | 3.500.000 d | 3.495.899 d | 14.143.812 d | -4.814.000 d | 9.329.812 d |
| 2026-07 | yes | 14.000.000 d | 6.838.500 d | 6.838.500 d | 3.181.000 d | 4.000.000 d | 3.980.500 d | 12.825.711 d | 4.765.000 d | 17.590.711 d |
| 2026-08 | no | 14.000.000 d | 6.517.900 d | 6.287.900 d | 1.626.000 d | 4.000.000 d | 5.856.100 d | 21.571.211 d | -342.000 d | 21.229.211 d |
| 2026-09 | no | 14.000.000 d | 5.838.500 d | 0 d | 0 d | 5.000.000 d | 8.161.500 d | 30.254.711 d | 0 d | 30.254.711 d |
| 2026-10 | no | 14.000.000 d | 5.838.500 d | 0 d | 0 d | 5.000.000 d | 8.161.500 d | 38.416.211 d | 0 d | 38.416.211 d |
| 2026-11 | no | 14.000.000 d | 5.838.500 d | 0 d | 0 d | 5.000.000 d | 8.161.500 d | 46.577.711 d | 0 d | 46.577.711 d |
| 2026-12 | no | 14.000.000 d | 0 d | 0 d | 0 d | 5.000.000 d | 14.000.000 d | 54.739.211 d | 0 d | 54.739.211 d |
| 2027-07 | no | 14.000.000 d | 0 d | 0 d | 0 d | 5.000.000 d | 14.000.000 d | 62.474.914 d | 0 d | 62.474.914 d |

## Metric semantics

- `fixed plan` is reserved monthly budget, not necessarily money already paid.
- `variable spent` is recorded expense cash flow only; unrecorded spending is absent until reconciliation.
- `actual savings` means income minus planned fixed costs minus recorded variable spending, including fixed over-plan. It is final only for a completed/locked month.
- Emergency-fund transactions are separate cash flow and are not counted as monthly expenses.

