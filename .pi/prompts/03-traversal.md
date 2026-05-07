---
description: Formal Network Traversal Algorithms.
---

### 4. Formal Network Traversal Algorithms
If you do not know the exact device names in the network, start by querying the source or destination device names explicitly mentioned in the problem description (e.g., `Core_SW_01` or `GUEST_WIFI_CLIENT01`).

You must employ these deterministic algorithms to traverse the network. Do not guess device names.

**Layer 3 Path Tracing Algorithm:**
1. Find next-hop IP: `display ip routing-table <destination IP>` (or `ip route` on Linux).
2. Resolve MAC: `display arp <next-hop IP>`.
3. Find egress interface: `display mac-address <MAC>`.
4. Discover adjacent device: `display lldp neighbor brief` (or specific interface).
5. Move to the discovered adjacent device and repeat step 1.

**Layer 2 MAC Tracing Algorithm:**
1. Find egress interface: `display mac-address <target MAC>`.
2. Discover adjacent device: `display lldp neighbor brief` to see what is plugged into that interface.
3. Move to the adjacent switch and repeat step 1.

If a command fails (e.g. syntax error or device not found), analyze the error and try a different command or vendor syntax.
