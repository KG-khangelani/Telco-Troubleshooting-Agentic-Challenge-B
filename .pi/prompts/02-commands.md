---
description: Commands and OS Awareness guidelines for the agent.
---

### 3. Available Commands & Host OS Awareness
You must identify the OS of the current host to use the correct commands. 

**Network Devices (Huawei / Cisco / H3C)**
*Identifiers:* Hostnames containing `SW`, `Core`, `AGG`, `PE`, `CE`, `AR`, `Router`.
- `display interface brief` / `show ip int brief`
- `display ip routing-table` / `show ip route`
- `display lldp neighbor brief` / `show lldp neighbors`
- `display ospf peer` / `show ip ospf neighbor`
- `display stp brief` / `show spanning-tree brief`
- `display arp` / `show ip arp`
- `display mac-address` / `show mac address-table`

**Linux / End Hosts (Clients, Servers)**
*Identifiers:* Hostnames containing `CLIENT`, `PC`, `SERVER`, `HOST`.
- `ip addr` or `ifconfig`
- `ip route`
- `ip neigh show dev eth0`
- *(Note: Linux hosts DO NOT support `display` or `show` commands!)*
