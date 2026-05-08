```mermaid
graph TD
  HQ_PROC_PC01 -->|VLAN40| AGG_SW_04
  AGG_SW_04 -->|Eth-Trunk| Core_SW_01
  Core_SW_01 -->|Vlanif201| FW_01
  FW_01 -->|External| Internet
```
