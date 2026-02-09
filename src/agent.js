// src/agent.js — Core autonomous agent loop (v2.0 — Local-First)
// DigiMod AI Autonomous Agent v2.0
//
// No hard dependency on any cloud API. The "intelligence" comes from
// whatever provider you configure: Ollama, vLLM, LM Studio, or Claude.

import { TOOL_DEFINITIONS, executeTool } from './tools.js';
import { Logger } from './logger.js';

const SYSTEM_PROMPT = `You are an autonomous execution agent. You receive a task brief and must complete it independently using the provided tools.

## OPERATING MODE
You are NOT a chatbot. You are an executor. Your job:
1. Analyse the brief and break it into concrete steps
2. Execute each step using tools
3. Evaluate results after each action
4. Adapt your plan based on what you find
5. Loop until the task is fully complete
6. Call task_complete with a summary when done

## PRINCIPLES
- ACT, don't ask. You have all the tools you need.
- Start by understanding the current state (list files, read existing code, check git status).
- Make a plan, then execute it step by step.
- If something fails, diagnose it, fix it, and retry — don't give up on first error.
- Write clean, production-quality code. No placeholders, no TODOs.
- Test your work: run the code, check for errors, verify output.
- When editing existing files, read them first to understand the full context.

## TOOL STRATEGY
- Use list_directory and read_file first to understand project structure.
- Use create_file for new files, edit_file for surgical changes.
- Use run_command for shell commands (npm, python, curl, etc.).
- Use search_files to find definitions or references.
- Use http_request to test APIs or fetch data.
- Use git to track your changes.

## COMPLETION
- Call task_complete when the entire brief has been fulfilled.
- Call task_failed only if the task is genuinely impossible.
- Never call task_complete until you've verified your work actually works.

## IMPORTANT
- Think before acting. State your plan briefly, then execute.
- Use multiple tools in parallel when they're independent.
- Time & AWST timezone. Currency: AUD unless specified.`;

export class Agent {
  constructor(config, provider) {
    this.config = config;
    this.provider = provider;
    this.log = new Logger(config);
    this.messages = [];
    this.iteration = 0;
    this.totalToolCalls = 0;
    this.startTime = null;
    this.status = 'idle';
    this.result = null;
    this.costEstimate = { inputTokens: 0, outputTokens: 0 };
  }

  async run(brief, context = '') {
    this.startTime = Date.now();
    this.status = 'running';

    this.log.info(`🚀 Agent started — provider: ${this.provider.name}, model: ${this.config.model}`);
    this.log.info(`📋 Brief: ${brief.slice(0, 200)}${brief.length > 200 ? '...' : ''}`);

    let userContent = `## TASK BRIEF\n\n${brief}`;
    if (context) userContent += `\n\n## ADDITIONAL CONTEXT\n\n${context}`;
    userContent += `\n\n## WORKING DIRECTORY: ${this.config.workingDirectory}`;

    this.messages.push({ role: 'user', content: userContent });

    try {
      while (this.iteration < this.config.maxIterations) {
        this.iteration++;
        this.log.iteration(this.iteration, this.config.maxIterations);

        const response = await this.provider.chat(this.messages, TOOL_DEFINITIONS, SYSTEM_PROMPT);

        const { textBlocks, toolUseBlocks } = this._parseResponse(response);

        if (textBlocks.length > 0) {
          this.log.plan(textBlocks.map(b => b.text).join('\n'));
        }

        // Log local model performance
        if (response.tokens_per_second && response.tokens_per_second !== 'N/A') {
          this.log.info(`⚡ Local inference: ${response.tokens_per_second} tok/s`);
        }

        if (response.usage) {
          this.costEstimate.inputTokens += response.usage.input_tokens || 0;
          this.costEstimate.outputTokens += response.usage.output_tokens || 0;
        }

        this.messages.push({ role: 'assistant', content: response.content });

        if (toolUseBlocks.length === 0 && response.stop_reason === 'end_turn') {
          this.log.warn('No tool calls — nudging agent to continue or finish.');
          this.messages.push({
            role: 'user',
            content: 'You responded without using any tools. Call task_complete if done, or use tools to continue.',
          });
          continue;
        }

        const toolResults = await this._executeTools(toolUseBlocks);

        for (const tr of toolResults) {
          if (tr._signal === 'COMPLETE') {
            this.status = 'complete';
            this.result = tr._summary;
            this.log.info(`✅ Task complete — ${this.iteration} iterations, ${this.totalToolCalls} tool calls`);
            return this._buildResult();
          }
          if (tr._signal === 'FAILED') {
            this.status = 'failed';
            this.result = tr._reason;
            this.log.error(`❌ Task failed: ${tr._reason}`);
            return this._buildResult();
          }
        }

        this.messages.push({
          role: 'user',
          content: toolResults.map(tr => ({
            type: 'tool_result',
            tool_use_id: tr.tool_use_id,
            content: tr.content,
          })),
        });
      }

      this.status = 'error';
      this.result = `Exceeded max iterations (${this.config.maxIterations})`;
      return this._buildResult();
    } catch (err) {
      this.status = 'error';
      this.result = err.message;
      this.log.error(`Agent error: ${err.message}`, { stack: err.stack });
      return this._buildResult();
    }
  }

  _parseResponse(response) {
    const content = response.content || [];
    return {
      textBlocks: content.filter(b => b.type === 'text'),
      toolUseBlocks: content.filter(b => b.type === 'tool_use'),
    };
  }

  async _executeTools(toolUseBlocks) {
    const results = [];
    for (const toolUse of toolUseBlocks) {
      this.totalToolCalls++;
      const start = Date.now();
      this.log.info(`🔧 Executing: ${toolUse.name}`);
      const result = await executeTool(toolUse.name, toolUse.input, this.config);
      this.log.tool(toolUse.name, toolUse.input, result, Date.now() - start);

      const tr = { tool_use_id: toolUse.id, content: JSON.stringify(result) };
      if (result.signal === 'COMPLETE') { tr._signal = 'COMPLETE'; tr._summary = result.summary; }
      if (result.signal === 'FAILED') { tr._signal = 'FAILED'; tr._reason = result.reason; }
      results.push(tr);
    }
    return results;
  }

  _buildResult() {
    const durationMs = Date.now() - this.startTime;
    const isLocal = this.provider.name !== 'claude';
    const claudeCost = (this.costEstimate.inputTokens / 1e6) * 3 + (this.costEstimate.outputTokens / 1e6) * 15;

    return {
      status: this.status,
      summary: this.result,
      iterations: this.iteration,
      toolCalls: this.totalToolCalls,
      durationMs,
      messageCount: this.messages.length,
      provider: this.provider.name,
      model: this.config.model,
      tokens: this.costEstimate,
      costSaved: isLocal ? `~$${claudeCost.toFixed(4)} AUD saved vs Claude API` : 'N/A (cloud provider)',
    };
  }
}
