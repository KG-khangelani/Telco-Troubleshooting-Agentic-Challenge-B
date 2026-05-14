/**
 * tools/execute_network_command.js
 * 
 * This tool allows the pi-agent to execute CLI commands against the simulated
 * network devices running in the Telco Troubleshooting Challenge server.
 * 
 * Expected payload:
 * {
 *   "device_name": "String (e.g., 'Gamma-Aegis-01')",
 *   "command": "String (e.g., 'display interface brief')",
 *   "question_number": "String (e.g., '1')"
 * }
 */

/**
 * Executes a network command on the simulated server.
 * 
 * @param {string} deviceName - The name of the node (e.g., Gamma-Aegis-01)
 * @param {string} command - The CLI command (e.g., display interface brief)
 * @param {number|string} questionNumber - The current question ID / scenario ID
 * @returns {Promise<string>} The CLI string output from the device
 */

// Persistent cache for topology discovery (LLDP) across problems
const lldpCache = new Map();

function normalizeCommand(cmd) {
    let normalized = cmd.trim();
    // Normalize pipe spaces
    normalized = normalized.replace(/\s+\|\s+/g, ' | ');
    // The challenge API exposes pre-collected command outputs, not a shell.
    // Strip local filtering/specific lookup variants to their supported base commands.
    if (normalized.includes('|')) {
        normalized = normalized.split('|')[0].trim();
    }

    const parameterlessCommands = [
        'display ip routing-table',
        'display mac-address',
        'display interface brief',
        'display interface description',
        'display lldp neighbor brief',
        'display current-configuration',
        'display ip interface brief',
        'display stp brief',
        'display arp',
        'show ip route',
        'show ip arp',
        'show ip interface brief',
        'show lldp neighbors',
        'show mac address-table',
        'show running-config'
    ];

    const lowered = normalized.toLowerCase();
    for (const base of parameterlessCommands) {
        if (lowered.startsWith(`${base.toLowerCase()} `)) {
            return base;
        }
    }

    return normalized;
}

export async function executeNetworkCommand(deviceName, command, questionNumber) {
    // Bypass self-signed cert errors if the competition URL is a direct IP address via HTTPS
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

    // The Remote Challenge Sandbox API or local mock server
    const API_URL = process.env.COMPETITION_API_URL || 'http://server:7860/api/agent/execute';
    const COMPETITION_API_TOKEN = process.env.COMPETITION_API_TOKEN;

    let headers = {
        'Content-Type': 'application/json'
    };
    
    // Attach the phase 2 execution token if provided
    if (COMPETITION_API_TOKEN) {
        headers['Authorization'] = `Bearer ${COMPETITION_API_TOKEN}`;
    }

    const maxRetries = 5;
    const baseDelayMs = 2000;

    const normalizedCmd = normalizeCommand(command);
    const apiCommand = normalizedCmd;
    const isLldp = normalizedCmd.includes('lldp neighbor');
    const cacheKey = `${deviceName}:${normalizedCmd}`;

    if (isLldp && lldpCache.has(cacheKey)) {
        console.log(`    [Cache Hit] Returning cached LLDP data for ${deviceName}`);
        return lldpCache.get(cacheKey);
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    device_name: deviceName,
                    command: apiCommand,
                    question_number: String(questionNumber)
                })
            });

            if (response.status === 429) {
                console.log(`    [Rate Limit] 429 Too Many Requests. Retrying in ${baseDelayMs * attempt}ms (Attempt ${attempt}/${maxRetries})...`);
                await new Promise(resolve => setTimeout(resolve, baseDelayMs * attempt));
                continue;
            }

            if (!response.ok) {
                // For example, 403 No Permission or 404 No Data
                const errorBody = await response.json();
                return `API ERROR (${response.status}): ${JSON.stringify(errorBody)}`;
            }

            const data = await response.json();
            
            if (data.status === 'success') {
                if (isLldp) {
                    lldpCache.set(cacheKey, data.result);
                }
                return data.result;
            } else {
                // Vendor Normalization fallback: if command fails due to syntax and contains a pipe, retry without pipe
                if ((data.message?.toLowerCase().includes('unrecognized') || 
                     data.message?.toLowerCase().includes('syntax') ||
                     JSON.stringify(data).toLowerCase().includes('error')) && 
                     normalizedCmd.includes('|')) {
                    
                    const cmdWithoutPipe = normalizedCmd.split('|')[0].trim();
                    console.log(`    [Vendor Normalization] Command failed with pipe filter. Retrying without pipe: ${cmdWithoutPipe}`);
                    // Execute without pipe
                    const retryResponse = await fetch(API_URL, {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify({
                            device_name: deviceName,
                            command: cmdWithoutPipe,
                            question_number: String(questionNumber)
                        })
                    });
                    
                    if (retryResponse.ok) {
                        const retryData = await retryResponse.json();
                        if (retryData.status === 'success') {
                            return retryData.result + "\n\n[Note: Pipe filter was stripped due to device syntax error. Full output provided.]";
                        }
                    }
                }
                
                return `EXECUTION FAILED: ${data.message || JSON.stringify(data)}`;
            }

        } catch (error) {
            if (attempt === maxRetries) {
                return `NETWORK REQUEST FAILED: ${error.message}`;
            }
            console.log(`    [Network Error] ${error.message}. Retrying in ${baseDelayMs * attempt}ms (Attempt ${attempt}/${maxRetries})...`);
            await new Promise(resolve => setTimeout(resolve, baseDelayMs * attempt));
        }
    }
    
    return `NETWORK REQUEST FAILED: Max retries exceeded`;
}
