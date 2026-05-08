```mermaid
graph TD
  GUEST_WIFI_CLIENT03 --> ACCESS_SWITCH
  ACCESS_SWITCH --> Core_SW_01
  ACCESS_SWITCH --> Core_SW_02
  Core_SW_01 --> FW_01
  Core_SW_02 --> FW_02
  FW_01 --> Internet
  FW_02 --> Internet
  style Core_SW_01 fill:#ffcccc
  style Core_SW_02 fill:#ffcccc
  style ACCESS_SWITCH fill:#ffffcc
```
