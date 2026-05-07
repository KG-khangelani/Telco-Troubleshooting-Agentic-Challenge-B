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

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    device_name: deviceName,
                    command: command,
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
                return data.result;
            } else {
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
