import fs from 'fs';
import path from 'path';
import { createAgentSession, AuthStorage, ModelRegistry, SessionManager, createBashTool, createReadTool } from "@earendil-works/pi-coding-agent";

// Paths mapped to the docker container volume
const TEST_FILE = '/app/data/phase_2/test_p2.json';
const OUTPUT_FILE = '/app/outputs/result.csv';
const QUESTION_LIMIT = Number.parseInt(process.env.QUESTION_LIMIT || '5', 10);
const MAX_AGENT_LOOPS = Number.parseInt(process.env.MAX_AGENT_LOOPS || '40', 10);
const FINALIZE_AFTER_LOOPS = Number.parseInt(process.env.FINALIZE_AFTER_LOOPS || '28', 10);
const MAX_FINAL_ANSWER_RETRIES = Number.parseInt(process.env.MAX_FINAL_ANSWER_RETRIES || '3', 10);

// Load the test questions
const questions = JSON.parse(fs.readFileSync(TEST_FILE, 'utf8'));

const CANONICAL_EXTRA_FAULT_REASONS = [
    'VRRP dual-master configuration error'
];

function extractAllowedFaultReasons(questionText) {
    const reasons = new Set(CANONICAL_EXTRA_FAULT_REASONS);
    const blockRegex = /Fault reasons include:\s*([\s\S]*?)(?=If there are multiple fault reasons|Routing fault examples|Port fault examples|Please provide|$)/gi;
    let blockMatch;

    while ((blockMatch = blockRegex.exec(questionText)) !== null) {
        const block = blockMatch[1];
        const itemRegex = /\(\d+\)\s*([^;]+?)(?=\s*;\s*\(\d+\)|$)/g;
        let itemMatch;

        while ((itemMatch = itemRegex.exec(block)) !== null) {
            const reason = itemMatch[1]
                .replace(/\s+/g, ' ')
                .replace(/[.。]\s*$/, '')
                .trim();
            if (reason) {
                reasons.add(reason);
            }
        }
    }

    return [...reasons].sort((a, b) => a.localeCompare(b));
}

function buildAnswerRules(allowedReasons) {
    return `Final answer validation rules:
- Every non-path fault line must be exactly: fault-node;fault-interface-or-destination;fault-reason
- Use exactly two semicolons per non-path fault line.
- For multiple faults, put each fault on its own line inside one <FINAL_ANSWER> block.
- The fault-reason must exactly match one of the allowed strings below. Do not invent shorthand, camelCase, underscores, policy names, or merged words.
- Common rewrites: "dual-master" -> "VRRP dual-master configuration error"; "missing route" -> choose "missing static route" or "static route error" based on evidence; "securitypolicy", "securitypolicydeny", or a policy name -> "security policy rule not permitting corresponding users".

Allowed fault-reason strings:
${allowedReasons.map(reason => `- ${reason}`).join('\n')}`;
}

function buildInvestigationHints(questionText) {
    const hints = [];
    if (/GUEST|WIFI|CLIENT/i.test(questionText) && /data center|branch|SZ_|SH_|10\.2\.|10\.3\./i.test(questionText)) {
        hints.push('For guest/user traffic to data-center or branch prefixes, verify the client gateway and core route, then check FW_01/FW_02 route and security policy before deep endpoint or access-switch tracing.');
        hints.push('If the firewall has a deny rule or no permit for the source users to the destination prefix, finalize with the exact reason "security policy rule not permitting corresponding users".');
    }

    if (hints.length === 0) {
        return '';
    }

    return `Investigation priority hints:\n${hints.map(hint => `- ${hint}`).join('\n')}`;
}

function splitFinalAnswerLines(finalStr) {
    return finalStr
        .split(/\n|\\n/)
        .map(line => line.trim())
        .filter(Boolean);
}

function validateFinalAnswer(finalStr, allowedReasons) {
    const errors = [];
    const allowedReasonSet = new Set(allowedReasons);
    const lines = splitFinalAnswerLines(finalStr);

    if (lines.length === 0) {
        return { isValid: false, errors: ['Final answer is empty.'] };
    }

    if (/```|<FINAL_ANSWER>|<\/FINAL_ANSWER>/i.test(finalStr)) {
        errors.push('Final answer must contain only answer lines, not markdown fences or nested tags.');
    }

    if (/starting|investigat|hypothesis|next action|analysis/i.test(finalStr)) {
        errors.push('Final answer contains investigation prose instead of only root-cause answer lines.');
    }

    if (finalStr.includes(',')) {
        errors.push('Final answer contains a comma, which will corrupt the CSV output.');
    }

    for (const line of lines) {
        if (line.includes('->')) {
            continue;
        }

        const fields = line.split(';').map(field => field.trim());
        if (fields.length !== 3) {
            errors.push(`Line "${line}" must have exactly 3 fields separated by exactly 2 semicolons.`);
            continue;
        }

        const [node, target, reason] = fields;
        if (!node || !target || !reason) {
            errors.push(`Line "${line}" has an empty node, target, or fault-reason field.`);
            continue;
        }

        if (!allowedReasonSet.has(reason)) {
            errors.push(`Fault reason "${reason}" is not an exact allowed fault-reason string.`);
        }
    }

    return { isValid: errors.length === 0, errors };
}

function buildFinalAnswerCorrectionPrompt(finalStr, validation, allowedReasons) {
    return `ERROR: Your <FINAL_ANSWER> was rejected by the evaluator.

Rejected answer:
\`\`\`
${finalStr}
\`\`\`

Validation errors:
${validation.errors.map(error => `- ${error}`).join('\n')}

Rewrite the final answer only if the evidence already supports it. If you need more evidence, run one focused network command.
Do not use shorthand. Do not include policy names as extra semicolon fields. Use one line per fault.

${buildAnswerRules(allowedReasons)}`;
}

function buildFinalizePrompt(answerRules) {
    return `You are near the investigation loop limit. Stop broad topology exploration.

Use the evidence already collected in this session to produce the minimal root cause set now.
Only run another command if it is absolutely required to distinguish between two exact allowed reasons.

If you can identify the root cause, respond with <FINAL_ANSWER> only and obey these rules:

${answerRules}`;
}

function selectQuestionsForRun(allQuestions) {
    const questionIds = (process.env.QUESTION_IDS || '')
        .split(',')
        .map(id => id.trim())
        .filter(Boolean);

    if (questionIds.length > 0) {
        const wanted = new Set(questionIds);
        return allQuestions.filter(item => wanted.has(String(item.task.id)));
    }

    return allQuestions.slice(0, QUESTION_LIMIT);
}

/**
 * Solves a single problem using the pi-agent SDK.
 */
async function solveProblem(problemId, questionText) {
    console.log(`\n[+] Starting Agent loop for Problem ID: ${problemId}`);
    const allowedReasons = extractAllowedFaultReasons(questionText);
    const answerRules = buildAnswerRules(allowedReasons);
    const investigationHints = buildInvestigationHints(questionText);
    const finalizeAfterLoop = Math.min(FINALIZE_AFTER_LOOPS, Math.max(2, MAX_AGENT_LOOPS - 4));
    
    // Set OpenRouter session tracking ID for the pi-agent SDK models.json header resolution
    process.env.OPENROUTER_SESSION_ID = `Problem-${problemId}`;
    process.env.CTBENCH_QUESTION_ID = String(problemId);
    
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
        let finalAnswerRetries = 0;
        const commandCache = new Map();
        let currentPrompt = `Solve this problem:\n${questionText}\n\n${answerRules}\n\n${investigationHints ? `${investigationHints}\n\n` : ''}You must use a markdown bash block to execute network commands and gather data. You cannot solve this without gathering data first.\nUse this exact command format inside the bash block: \`execute_network_command.js <DEVICE_NAME> "<COMMAND>"\`.\nKeep the investigation focused; once you have evidence for the minimal root cause set, stop collecting data.\nWhen you have finally reached your conclusion, output the final answer wrapped in <FINAL_ANSWER> tags as instructed in your rules, and do not call any more tools.`;

        // Pre-import the executeNetworkCommand to run it natively without child_process overhead
        const { executeNetworkCommand } = await import('./tools/execute_network_command.js');

        while (!isDone) {
            loopCount++;
            if (loopCount > MAX_AGENT_LOOPS) {
                return `ERROR: Exceeded max agent loops (${MAX_AGENT_LOOPS})`;
            }

            if (loopCount === finalizeAfterLoop) {
                currentPrompt = buildFinalizePrompt(answerRules);
            }

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

            // Extract and save Mermaid topologies
            const mermaidRegex = /```mermaid\n([\s\S]*?)\n```/;
            const mermaidMatch = answer.match(mermaidRegex);
            if (mermaidMatch) {
                const mermaidContent = "```mermaid\n" + mermaidMatch[1].trim() + "\n```\n";
                const filePath = `/app/outputs/topology_problem_${problemId}.md`;
                try {
                    fs.mkdirSync(path.dirname(filePath), { recursive: true });
                    fs.writeFileSync(filePath, mermaidContent);
                    console.log(`\n    [Manual Tool Intercept] Saved Topology -> File: ${filePath}`);
                } catch (err) {
                    console.error(`\n    [Manual Tool Intercept] Failed to save topology: ${err.message}`);
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
                    const validation = validateFinalAnswer(finalStr, allowedReasons);
                    if (validation.isValid) {
                        return finalStr.replace(/\n/g, '\\n'); // Return full string, formatted for CSV
                    }

                    finalAnswerRetries++;
                    if (finalAnswerRetries > MAX_FINAL_ANSWER_RETRIES) {
                        return `ERROR: Invalid final answer after ${MAX_FINAL_ANSWER_RETRIES} retries: ${validation.errors.join(' | ')}`;
                    }

                    currentPrompt = buildFinalAnswerCorrectionPrompt(finalStr, validation, allowedReasons);
                    continue;
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
                
                // Polyfill: Natively extract device and command, and run executeNetworkCommand directly
                const netCmdRegex = /execute_network_command(?:\.js)?\s+["']?([^"'\s]+)["']?\s+(.*)/;
                const netMatch = commandToRun.match(netCmdRegex);

                if (netMatch) {
                    const device = netMatch[1];
                    let cmd = netMatch[2].trim();
                    
                    // Extract content inside the first set of quotes, ignoring trailing bash redirects
                    const quoteMatch = cmd.match(/^["'](.*?)["']/);
                    if (quoteMatch) {
                        cmd = quoteMatch[1];
                    } else {
                        // Fallback: strip standard bash redirects if there were no quotes
                        cmd = cmd.split(' 2>')[0].split(' >')[0].trim();
                    }
                    
                    console.log(`\n    [Manual Tool Intercept] Calling API -> Device: ${device}, Command: ${cmd}`);
                    
                    try {
                        const cacheKey = `${device}\n${cmd}`;
                        let output;
                        const wasCached = commandCache.has(cacheKey);
                        if (wasCached) {
                            output = commandCache.get(cacheKey);
                            console.log(`    [Command Cache Hit] Reused previous output`);
                        } else {
                            output = await executeNetworkCommand(device, cmd, problemId);
                            commandCache.set(cacheKey, output);
                        }

                        console.log(`    [Tool Result] success\n`);
                        const repeatedCommandHint = wasCached
                            ? '\nYou repeated a command that was already run. Do not repeat it again; either run a different focused command or finalize with the evidence already collected.'
                            : '';
                        currentPrompt = `Command Executed Successfully. Output:\n\`\`\`\n${output}\n\`\`\`${repeatedCommandHint}\nAnalyze the output and decide your next step.`;
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
                currentPrompt = `You must execute a network command using a \`\`\`bash block. DO NOT use XML tags like <bash> or <execute_network_command> for commands. If you are finished, provide your final answer wrapped in <FINAL_ANSWER>...</FINAL_ANSWER> tags and obey these rules:\n\n${answerRules}`;
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

    // Process questions sequentially. Defaults to 5 for local smoke tests.
    for (const item of selectQuestionsForRun(questions)) {
        const id = item.task.id;
        const questionText = item.task.question;

        try {
            const answer = await solveProblem(id, questionText);
            fs.appendFileSync(OUTPUT_FILE, `${id},${answer}\n`);
            if (answer.startsWith('ERROR:')) {
                console.log(`\n[!] Problem ${id} ended without a valid answer. Result: ${answer}\n`);
                continue;
            }
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
