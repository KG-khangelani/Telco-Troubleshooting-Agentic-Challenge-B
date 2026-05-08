import fs from 'fs';
import path from 'path';
import { createAgentSession, AuthStorage, ModelRegistry, SessionManager, createBashTool, createReadTool } from "@earendil-works/pi-coding-agent";

// Paths mapped to the docker container volume
const TEST_FILE = '/app/data/phase_2/test_p2.json';
const OUTPUT_FILE = '/app/outputs/result.csv';

// Load the test questions
const questions = JSON.parse(fs.readFileSync(TEST_FILE, 'utf8'));

/**
 * Solves a single problem using the pi-agent SDK.
 */
async function solveProblem(problemId, questionText) {
    console.log(`\n[+] Starting Agent loop for Problem ID: ${problemId}`);
    
    // Configure API Key and Model Registry
    const authStorage = AuthStorage.create();
    const apiKey = process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY;
    if (apiKey) {
        // OpenRouter expects API keys per the custom models.json we created
        authStorage.setRuntimeApiKey("openrouter", apiKey);
    }
    
    // Load the custom models.json we created which defines OpenRouter
    const modelRegistry = ModelRegistry.create(authStorage, "/app/agent/.pi/agent/models.json");
    
    const modelName = process.env.LLM_MODEL || 'Qwen3.5-35B-A3B';
    const targetModel = modelRegistry.find("openrouter", modelName);
    
    if (!targetModel) {
        throw new Error(`Model ${modelName} not found in openrouter provider`);
    }

    // Load the system prompt rules
    const systemPromptText = fs.readFileSync('/app/AGENTS.md', 'utf8');

    // Set up session
    const { session } = await createAgentSession({
        cwd: '/app',
        agentDir: '/app/agent/.pi/agent',
        model: targetModel,
        tools: [createBashTool('/app'), createReadTool('/app')],
        sessionManager: SessionManager.inMemory(),
        systemPrompt: systemPromptText
    });

    // Subscribe to events for stdout visibility
    const unsubscribe = session.subscribe((event) => {
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
            process.stdout.write(event.assistantMessageEvent.delta);
        } else if (event.type === "tool_execution_start") {
            console.log(`\n    [Tool Execution] ${event.toolName}`);
        } else if (event.type === "tool_execution_end") {
            console.log(`    [Tool Result] ${event.isError ? "error" : "success"}\n`);
        }
    });

    try {
        let isDone = false;
        let loopCount = 0;
        let currentPrompt = `Solve this problem:\n${questionText}\n\nYou must use the provided 'bash' tool to execute network commands and gather data. You cannot solve this without gathering data first.\nWhen you have finally reached your conclusion, output the final answer wrapped in <FINAL_ANSWER> tags as instructed in your rules, and do not call any more tools.`;

        // Pre-import the executeNetworkCommand to run it natively without child_process overhead
        const { executeNetworkCommand } = await import('./tools/execute_network_command.js');

        while (!isDone) {
            loopCount++;
            await session.prompt(currentPrompt);
            
            // Get the last assistant message
            const messages = session.agent.state.messages;
            const lastMessage = messages[messages.length - 1];
            
            let answer = "ERROR: No answer found";
            if (session.agent.state.errorMessage) {
                console.error(`\n[!] Agent Error: ${session.agent.state.errorMessage}\n`);
                return "ERROR: " + session.agent.state.errorMessage;
            } else if (lastMessage && lastMessage.role === "assistant") {
                const content = lastMessage.content;
                if (typeof content === 'string') {
                    answer = content.trim();
                } else if (Array.isArray(content)) {
                    answer = content.map(c => c.text || '').join('\n').trim();
                } else {
                    answer = JSON.stringify(content);
                }
            }

            // 1. Check if the model has provided a final answer
            const finalAnswerMatch = answer.match(/<FINAL_ANSWER>([\s\S]*?)<\/FINAL_ANSWER>/);
            if (finalAnswerMatch) {
                const lines = finalAnswerMatch[1].split('\n').filter(line => line.trim().length > 0);
                if (lines.length > 0) {
                    if (loopCount <= 1) {
                        currentPrompt = `ERROR: You provided a <FINAL_ANSWER> without executing any network commands to gather data. You MUST execute commands to investigate the topology before reaching a conclusion. Continue gathering data.`;
                        continue;
                    }
                    
                    const finalStr = finalAnswerMatch[1].trim();
                    // Basic validation: the final answer should contain semi-colons or arrows, not "Starting investigation"
                    if (finalStr.includes(';') || finalStr.includes('->') || finalStr.toLowerCase().includes('error')) {
                        return finalStr.replace(/\n/g, '\\n'); // Return full string, formatted for CSV
                    } else {
                        // It hallucinates intermediate thoughts in the tag. Warn it and continue.
                        currentPrompt = `ERROR: You used the <FINAL_ANSWER> tag, but your answer ("${lines[0].trim()}...") does not match the required format (e.g., Device;Interface;FaultType or DeviceA->DeviceB). DO NOT use <FINAL_ANSWER> for intermediate thoughts like "Starting investigation". Only use it when you have the actual root cause. Continue gathering data.`;
                        continue;
                    }
                } else {
                    currentPrompt = `ERROR: You used empty <FINAL_ANSWER> tags. You must put the actual root cause inside the tags. Continue gathering data.`;
                    continue;
                }
            }
            
            // 2. Check if the model has provided a Markdown bash block to intercept
            const bashRegex = /```(?:bash|shell)\n([\s\S]*?)\n```/;
            let match = answer.match(bashRegex);
            
            // Fallback for hallucinated XML tags
            if (!match) {
                const xmlRegex = /<(?:bash|execute_network_command)>([\s\S]*?)<\/(?:bash|execute_network_command)>/;
                match = answer.match(xmlRegex);
            }
            
            if (match) {
                let commandToRun = match[1].trim();
                
                // If model put the awareness log inside the bash block, extract just the command line
                const cmdLines = commandToRun.split('\n').filter(l => l.includes('execute_network_command'));
                if (cmdLines.length > 0) {
                    commandToRun = cmdLines[0].trim();
                }

                // Strip any hallucinated --host or --command flags
                commandToRun = commandToRun.replace(/--host\s+/g, '').replace(/--command\s+/g, '');
                
                // Polyfill for Sketch Network Topology
                const catRegex = /cat\s+<<\s*['"]?EOF['"]?\s*>\s*([^\s]+)\s*\r?\n([\s\S]*?)\r?\nEOF/;
                const catMatch = commandToRun.match(catRegex);
                
                // Polyfill: Natively extract device and command, and run executeNetworkCommand directly
                const netCmdRegex = /execute_network_command(?:\.js)?\s+["']?([^"'\s]+)["']?\s+["'](.*)["']/;
                const netMatch = commandToRun.match(netCmdRegex);

                if (catMatch) {
                    const filePath = catMatch[1];
                    const fileContent = catMatch[2];
                    console.log(`\n    [Manual Tool Intercept] Saving Topology -> File: ${filePath}`);
                    try {
                        const targetPath = path.isAbsolute(filePath) ? filePath : path.join('/app', filePath);
                        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
                        fs.writeFileSync(targetPath, fileContent);
                        console.log(`    [Tool Result] success\n`);
                        currentPrompt = `Topology saved successfully to ${filePath}. Analyze the topology and decide your next step.`;
                    } catch (err) {
                        console.log(`    [Tool Result] error\n`);
                        currentPrompt = `Failed to save topology. Error: ${err.message}`;
                    }
                } else if (netMatch) {
                    const device = netMatch[1];
                    const cmd = netMatch[2];
                    console.log(`\n    [Manual Tool Intercept] Calling API -> Device: ${device}, Command: ${cmd}`);
                    
                    try {
                        const output = await executeNetworkCommand(device, cmd, problemId);
                        console.log(`    [Tool Result] success\n`);
                        currentPrompt = `Command Executed Successfully. Output:\n\`\`\`\n${output}\n\`\`\`\nAnalyze the output and decide your next step.`;
                    } catch (err) {
                        console.log(`    [Tool Result] error\n`);
                        currentPrompt = `Command Failed. Error:\n\`\`\`\n${err.message}\n\`\`\`\nPlease fix the command and try again.`;
                    }
                } else {
                    // It's a bash command but not a valid network command format.
                    console.log(`\n    [Manual Tool Intercept] Invalid command format: ${commandToRun}`);
                    currentPrompt = `ERROR: Invalid command format or forbidden local shell command.\nYou MUST use the exact format: \`execute_network_command.js <DEVICE_NAME> "<COMMAND>"\`.\nFor example: \`execute_network_command.js Core_SW_01 "display interface brief"\`.\nDo NOT explore the local filesystem or run commands like 'ls', 'find', or 'unzip'. All data must be gathered through the network command API.\nIf you are trying to save a topology, use the exact format:\ncat << 'EOF' > /app/outputs/topology_problem_${problemId}.md\n<content>\nEOF`;
                }
            } else {
                // The model output text but neither a bash block nor a FINAL_ANSWER tag.
                // We must prompt it to continue.
                currentPrompt = `You must execute a network command using a \`\`\`bash block. DO NOT use XML tags like <bash> or <execute_network_command> for commands. If you are finished, provide your final answer wrapped in <FINAL_ANSWER>...</FINAL_ANSWER> tags.`;
            }
        }
        
        // In case of infinite loops, we don't have a limit anymore based on user request.
        // Wait, if it never finds a FINAL_ANSWER, it will hang.
        // Returning ERROR since we removed the limit return at the bottom.
        // Wait, I should just remove the loop limit return if it's an infinite loop.
        
    } finally {
        unsubscribe();
    }
}

async function main() {
    console.log("=== Telco Troubleshooting Agent Evaluator ===");
    console.log(`Loaded ${questions.length} problems.`);

    // Ensure the output directory exists
    fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });

    // Initialize CSV with headers (Competition requires id,answer)
    fs.writeFileSync(OUTPUT_FILE, 'id,answer\n');

    // Process questions sequentially (For testing, let's just do 5)
    for (const item of questions.slice(0, 5)) {
        const id = item.task.id;
        const questionText = item.task.question;

        try {
            const answer = await solveProblem(id, questionText);
            fs.appendFileSync(OUTPUT_FILE, `${id},${answer}\n`);
            console.log(`\n[✔] Problem ${id} solved. Answer: ${answer}\n`);
        } catch (error) {
            console.error(`\n[X] System error processing Problem ${id}:`, error);
            fs.appendFileSync(OUTPUT_FILE, `${id},ERROR\n`);
        }
    }

    console.log("\n=== Evaluation Complete ===");
    console.log(`Results saved to: ${OUTPUT_FILE}`);
}

main();
