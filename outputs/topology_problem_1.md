```mermaid
graph TD
  Core_SW_01 --> Core_SW_02
  Core_SW_01 --> AGG_SW_01
  Core_SW_01 --> AGG_SW_02
  Core_SW_01 --> AGG_SW_03
  Core_SW_01 --> AGG_SW_04
  Core_SW_01 --> FW_01
  Core_SW_01 --> FW_02
  AGG_SW_01 --> HQ_MKT_PC01
  AGG_SW_01 --> HQ_MKT_AP01
  AGG_SW_01 --> HQ_MKT_Client01
  AGG_SW_02 --> HQ_FIN_PC01
  AGG_SW_02 --> HQ_FIN_Client01
  AGG_SW_03 --> HQ_HR_PC01
  AGG_SW_03 --> HQ_HR_AP01
  AGG_SW_04 --> HQ_PROC_PC01
  AGG_SW_04 --> HQ_PROC_AP01
```