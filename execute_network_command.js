#!/usr/bin/env node
import { executeNetworkCommand } from './agent/pi-agent/tools/execute_network_command.js';

const [deviceName, ...commandParts] = process.argv.slice(2);

if (!deviceName || commandParts.length === 0) {
    console.error('Usage: execute_network_command.js <DEVICE_NAME> "<COMMAND>"');
    process.exit(2);
}

const command = commandParts.join(' ');
const questionNumber = process.env.CTBENCH_QUESTION_ID || process.env.PROBLEM_ID || '1';

try {
    const output = await executeNetworkCommand(deviceName, command, questionNumber);
    process.stdout.write(output.endsWith('\n') ? output : `${output}\n`);
} catch (error) {
    console.error(error?.message || String(error));
    process.exit(1);
}
