/**
 * agent/pi-agent/evaluate.js
 * 
 * This is a boilerplate script demonstrating how to orchestrate the pi-agent framework
 * (or any custom LLM loop) to solve the challenge problems sequentially.
 * 
 * Usage:
 *   node evaluate.js
 */

import fs from 'fs';
import path from 'path';
import { executeNetworkCommand } from './tools/execute_network_command.js';

// Paths mapped to the docker container volume
const TEST_FILE = '/app/data/phase_2/test_p2.json';
const OUTPUT_FILE = '/app/outputs/result.csv';

// Load the test questions
const questions = JSON.parse(fs.readFileSync(TEST_FILE, 'utf8'));

/**
 * Simulates the Agent ReAct (Reason + Act) loop for a single problem.
 * This connects to a local LLM running an OpenAI-compatible API endpoint
 * (e.g., vLLM, LM Studio, or llama.cpp).
 */
async function solveProblem(problemId, questionText) {
    console.log(`\n[+] Starting Agent loop for Problem ID: ${problemId}`);
    
    // Config for your LLM (Local or Remote)
    // Docker Compose automatically loads these from your .env file
    const LLM_API_KEY = process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY;
    
    // Default to the local vLLM container if no endpoint is provided in .env
    const LLM_ENDPOINT = process.env.LLM_ENDPOINT || 'http://llm:8000/v1/chat/completions';
    const modelName = process.env.LLM_MODEL || 'qwen3.5-35b';

    // Load System Prompt dynamically from the modular prompts directory
    const promptsDir = '/app/agent/pi-agent/prompts';
    const promptFiles = fs.readdirSync(promptsDir).filter(f => f.endsWith('.md')).sort();
    let systemPrompt = '';
    for (const file of promptFiles) {
        systemPrompt += fs.readFileSync(path.join(promptsDir, file), 'utf8') + '\n\n';
    }

    let messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Solve this problem:\n${questionText}` }
    ];

    let headers = { 'Content-Type': 'application/json' };
    if (LLM_API_KEY) {
        headers['Authorization'] = `Bearer ${LLM_API_KEY}`;
        // Optional headers for specific services like OpenRouter
        headers['HTTP-Referer'] = 'http://localhost:3000';
        headers['X-Title'] = 'Telco-Troubleshooting-Agent';
    }

    let loopCount = 0;
    const maxLoops = 30; // Prevent infinite loops, increased for deeper topology discovery

    while (loopCount < maxLoops) {
        loopCount++;
        console.log(`    [Loop ${loopCount}] Agent is reasoning...`);

        try {
            const response = await fetch(LLM_ENDPOINT, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    model: modelName,
                    messages: messages,
                    tools: [
                        {
                            type: "function",
                            function: {
                                name: "execute_network_command",
                                description: "Executes a CLI command on a specific network device.",
                                parameters: {
                                    type: "object",
                                    properties: {
                                        host_awareness_log: { type: "string", description: "Mandatory scratchpad. State your current host, previous host, and your current hypothesis before running the command." },
                                        device_name: { type: "string", description: "Name of the device (e.g., Gamma-Aegis-01)" },
                                        command: { type: "string", description: "CLI command to run (e.g., display interface brief)" }
                                    },
                                    required: ["host_awareness_log", "device_name", "command"]
                                }
                            }
                        },
                        {
                            type: "function",
                            function: {
                                name: "sketch_network_topology",
                                description: "Saves a Mermaid chart of the currently discovered network topology to a file.",
                                parameters: {
                                    type: "object",
                                    properties: {
                                        mermaid_code: { type: "string", description: "The raw Mermaid syntax (e.g., graph TD\\n  A --> B)." }
                                    },
                                    required: ["mermaid_code"]
                                }
                            }
                        }
                    ],
                    tool_choice: "auto",
                    temperature: 0.1 // Keep it deterministic
                })
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`LLM API returned ${response.status}: ${errText}`);
            }

            const data = await response.json();
            const responseMessage = data.choices[0].message;
            messages.push(responseMessage); // Save AI's response to history

            // Did the AI decide to call a tool?
            if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
                if (responseMessage.content) {
                    const reasoning = responseMessage.content.trim().split('\n').map(line => '      ' + line).join('\n');
                    console.log(`    [Reasoning]\n${reasoning}`);
                }
                const toolCall = responseMessage.tool_calls[0];
                const args = JSON.parse(toolCall.function.arguments);
                const toolName = toolCall.function.name;
                
                let toolResult = "";

                if (toolName === "execute_network_command") {
                    if (args.host_awareness_log) {
                        const log = args.host_awareness_log.trim().split('\n').map(line => '      ' + line).join('\n');
                        console.log(`    [Host Awareness Log]\n${log}`);
                    }
                    console.log(`    -> Tool call: ${args.command} on ${args.device_name}`);
                    
                    toolResult = await executeNetworkCommand(args.device_name, args.command, problemId);

                    // Automatic Rollback Mechanism
                    const errorIndicators = ["API ERROR", "EXECUTION FAILED", "Unrecognized command", "Invalid input detected", "Error:", "not found"];
                    const isError = errorIndicators.some(indicator => toolResult.toLowerCase().includes(indicator.toLowerCase()));
                    
                    if (isError) {
                        toolResult += "\n\n[SYSTEM ROLLBACK HINT]: Command execution failed. ROLLBACK your hypothesis to your Previous Host. If you used a Huawei command on a Linux client (or vice versa), correct the syntax based on the OS Awareness rules.";
                    }
                } else if (toolName === "sketch_network_topology") {
                    console.log(`    -> Tool call: sketch_network_topology`);
                    try {
                        const topologyFile = `/app/outputs/topology_problem_${problemId}.md`;
                        fs.writeFileSync(topologyFile, `\`\`\`mermaid\n${args.mermaid_code}\n\`\`\``);
                        toolResult = `Successfully wrote topology to ${topologyFile}`;
                    } catch (err) {
                        toolResult = `Failed to write topology: ${err.message}`;
                    }
                }

                // Provide the tool result back to the LLM
                messages.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    name: toolCall.function.name,
                    content: toolResult
                });

            } else {
                // The AI decided it has the final answer
                const finalAnswer = responseMessage.content.trim();
                return finalAnswer;
            }

        } catch (error) {
            console.error(`    [!] LLM Connection Error: ${error.message}`);
            return "ERROR: Could not complete LLM loop";
        }
    }

    return "ERROR: Max loops exceeded";
}

async function main() {
    console.log("=== Telco Troubleshooting Agent Evaluator ===");
    console.log(`Loaded ${questions.length} problems.`);

    // Ensure the output directory exists
    fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });

    // Initialize CSV with headers (Competition requires id,answer)
    fs.writeFileSync(OUTPUT_FILE, 'id,answer\n');

    // Process questions sequentially (Competition requirement)
    for (const item of questions) {
        const id = item.task.id;
        const questionText = item.task.question;

        try {
            // Wait for the agent to solve it
            const answer = await solveProblem(id, questionText);
            
            // Append to result.csv immediately to save progress
            fs.appendFileSync(OUTPUT_FILE, `${id},${answer}\n`);
            
            if (answer.startsWith("ERROR")) {
                console.error(`[!] Problem ${id} FAILED. Reason: ${answer}\n`);
            } else {
                console.log(`[✔] Problem ${id} solved. Answer: ${answer}\n`);
            }
        } catch (error) {
            console.error(`[X] System error processing Problem ${id}:`, error);
            // Append empty or error string so the row isn't missing
            fs.appendFileSync(OUTPUT_FILE, `${id},ERROR\n`);
        }
    }

    console.log("\n=== Evaluation Complete ===");
    console.log(`Results saved to: ${OUTPUT_FILE}`);
}

main();
