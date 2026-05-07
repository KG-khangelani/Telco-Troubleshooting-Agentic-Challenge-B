---
name: execute-network-command
description: Executes a CLI command on a specific network device to gather state, configuration, or routing information. MUST be used to trace the network topology or debug faults.
---

# Execute Network Command

You must use this skill to interact with the Telco Sandbox and run commands on routers, switches, and hosts.

## IMPORTANT Rules Before Executing:
Before you run the command, you must maintain a strict "Host Awareness Log" so you do not lose track of where you are in the network.
Always output this exact structure as text in your reasoning before running the bash command:

### Host Awareness Log
* Current Investigating Host: <hostname>
* Previous Host: <hostname>
* Current Hypothesis: <what you are testing/looking for>
* Next Action: <what command you are about to run and why>

## Usage

You MUST use the `bash` tool function provided to you to run the helper script. Do not just write markdown blocks. Call the tool!

```bash
node /app/agent/pi-agent/tools/execute_network_command.js <device_name> "<command>"
```

### Examples

Check routing table on Core_SW_01:
```bash
node /app/agent/pi-agent/tools/execute_network_command.js Core_SW_01 "display ip routing-table"
```

Check interface on a Linux PC:
```bash
node /app/agent/pi-agent/tools/execute_network_command.js GUEST_WIFI_CLIENT01 "ip addr"
```
