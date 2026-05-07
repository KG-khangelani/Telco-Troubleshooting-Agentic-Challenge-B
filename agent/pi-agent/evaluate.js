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

        while (!isDone && loopCount < 40) {
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
                return lines[lines.length - 1].trim();
            }
            
            // 2. Check if the model has provided a Markdown bash block to intercept
            const bashRegex = /```(?:bash|shell)\n([\s\S]*?)\n```/;
            const match = answer.match(bashRegex);
            
            if (match) {
                let commandToRun = match[1].trim();
                
                // If model put the awareness log inside the bash block, extract just the command line
                const cmdLines = commandToRun.split('\n').filter(l => l.includes('execute_network_command'));
                if (cmdLines.length > 0) {
                    commandToRun = cmdLines[0].trim();
                }

                // Strip any hallucinated --host or --command flags
                commandToRun = commandToRun.replace(/--host\s+/g, '').replace(/--command\s+/g, '');
                
                // Polyfill: Natively extract device and command, and run executeNetworkCommand directly
                const netCmdRegex = /execute_network_command(?:\.js)?\s+["']?([^"'\s]+)["']?\s+["'](.*)["']/;
                const netMatch = commandToRun.match(netCmdRegex);

                if (netMatch) {
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
                    currentPrompt = `ERROR: Invalid command format or forbidden local shell command.\nYou MUST use the exact format: \`execute_network_command.js <DEVICE_NAME> "<COMMAND>"\`.\nFor example: \`execute_network_command.js Core_SW_01 "display interface brief"\`.\nDo NOT explore the local filesystem or run commands like 'ls', 'find', or 'unzip'. All data must be gathered through the network command API.`;
                }
            } else {
                // The model output text but neither a bash block nor a FINAL_ANSWER tag.
                // We must prompt it to continue.
                currentPrompt = `You must either execute a network command using a \`\`\`bash block, or provide your final answer wrapped in <FINAL_ANSWER>...</FINAL_ANSWER> tags.`;
            }
        }
        
        return "ERROR: Loop limit exceeded";
        
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

    // Process questions sequentially (For testing, let's just do 2)
    // The user can remove `.slice(0, 2)` later if they want all.
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
