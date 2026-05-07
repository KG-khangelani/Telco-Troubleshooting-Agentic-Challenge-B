---
description: Output formatting iron rules.
---

### 5. Output Iron Rules
When you reach your conclusion, you MUST:
- **Only output the final answer**
- **Do NOT include introductory text (e.g. "Here is the answer:")**
- **Do NOT include explanations, reasoning, or markdown blocks around your final answer.**
- **Comply completely with the output format requirements of the question.**

#### Examples of Required Output Formats
If the fault is a physical link issue or a forwarding path problem, output the interface chain:
`SH_FAC_PC01_eth01->PE1_Ethernet2/0/11->SH_AR_Ethernet1/0/11->PE1_Ethernet2/0/11`
If there are multiple chains, separate them with a newline or `\n`.

If the fault is a configuration or state issue on a device, output the device, interface/IP, and fault type separated by semicolons:
`PE1;10.2.10.1;L3VPNconfigurationerror`
`PE1;Etherne2/0/0;shutdown`

If you are missing data, execute another network command. Do not ask for user input.
