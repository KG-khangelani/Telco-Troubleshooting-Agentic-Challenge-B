---
name: sketch-network-topology
description: Saves a Mermaid chart of the currently discovered network topology to a file. Use this right before providing your final answer.
---

# Network Topology Sketching Skill
You have access to a tool named `sketch_network_topology`. 

As you discover the network using LLDP or routing tables, you should mentally map out the connections.
Right before you submit your final answer to the problem, you MUST use the `sketch_network_topology` tool to draw the network graph of the path you have traced. 

**Mermaid Requirements:**
- Use standard Mermaid `graph TD` syntax.
- Do NOT include markdown code blocks (```) in the `mermaid_code` parameter. Just pass the raw syntax string.
- Example payload: `graph TD\n  Core_SW_01 --> Core_SW_02\n  Core_SW_01 --> PE1`

**Important:** Only call this tool ONCE per problem, immediately before you output your final answer. Do not waste your limited loops drawing the graph repeatedly.
