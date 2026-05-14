```mermaid
graph TD
  GUEST_WIFI_CLIENT01[10.1.120.228] --> Core_SW_01[Core_SW_01]
  Core_SW_01 --> FW_01[FW_01]
  FW_01 -.blocked by deny_Guest_TO_SH_SZ rule.-> SZ_Server_Cluster2[10.3.20.1]
```
