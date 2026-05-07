---
name: sketch-network-topology
description: Saves a Mermaid chart of the currently discovered network topology to a file.
---

# Sketch Network Topology

You must use this skill to document your findings visually as you traverse the network.

## Usage

Use your built-in bash terminal to run the helper script or write directly to a file:

```bash
cat << 'EOF' > /app/outputs/topology_problem_current.md
```mermaid
graph TD
  Core_SW_01 --> Core_SW_02
```
EOF
```
