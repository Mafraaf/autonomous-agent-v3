#!/usr/bin/env node
// src/index.js — CLI entry point (v2.0 — Local-First)
// DigiMod AI Autonomous Agent
//
// Default: Ollama (local, free) → auto-detects available providers

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { createInterface } from 'readline';
import { Agent } from './agent.js';
import { loadConfig } from './config.js';
import { Logger } from './logger.js';
import { createProvider, autoDetectProvider } from './providers.js';

// ─── CLI Arg Parsing ───
const args = process.argv.slice(2);
const flags = {};
const positional = [];

for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    const key = args[i].slice(2);
    if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
      flags[key] = args[++i];
    } else {
      flags[key] = true;
    }
  } else {
    positional.push(args[i]);
  }
}

// ─── Banner ───
function printBanner() {
  console.log(`
\x1b[36m\x1b[1m╔══════════════════════════════════════════════════════╗
║     DigiMod AI — Autonomous Agent v2.0 (Local-First) ║
║     Your GPU. Your intelligence. Zero API costs.      ║
╚══════════════════════════════════════════════════════╝\x1b[0m
`);
}

function printUsage() {
  console.log(`
\x1b[1mUsage:\x1b[0m
  node src/index.js "<brief>"                 Run a task (auto-detects local LLM)
  node src/index.js --brief <file>            Load brief from file
  node src/index.js --interactive             Interactive mode
  node src/index.js --health                  Check available providers
  node src/index.js --help                    Show this help

\x1b[1mProvider Options:\x1b[0m
  --provider <p>           ollama (default) | openai-compatible | vllm | lmstudio | claude
  --model <model>          Model name (default: qwen3-coder:30b-a3b for Ollama)
  --ollama-url <url>       Ollama base URL (default: http://localhost:11434)
  --openai-url <url>       OpenAI-compatible base URL (for vLLM, LM Studio, etc.)

\x1b[1mAgent Options:\x1b[0m
  --dir <path>             Working directory
  --sandbox                Block destructive commands
  --max-iterations <n>     Max agent loops (default: 50)
  --debug                  Verbose logging

\x1b[1mEnvironment:\x1b[0m
  AGENT_PROVIDER           Provider override
  AGENT_MODEL              Model override
  OLLAMA_BASE_URL          Ollama URL override
  OPENAI_BASE_URL          OpenAI-compatible URL override
  ANTHROPIC_API_KEY        Claude API key (fallback only)

\x1b[1mQuick Start (Local — FREE):\x1b[0m
  1. Install Ollama:        curl -fsSL https://ollama.com/install.sh | sh
  2. Pull a coding model:   ollama pull qwen3-coder:30b-a3b
  3. Run agent:             node src/index.js "Build a REST API with Express"

\x1b[1mRecommended Models (by GPU VRAM):\x1b[0m
  32GB (RTX 5090):   qwen3-coder:30b-a3b (234 tok/s, best quality)
  24GB (RTX 4090):   qwen3-coder:30b-a3b-q4 or devstral (24B)
  16GB:              qwen3:8b or gpt-oss:20b
  8GB:               qwen3:4b
  `);
}

// ─── Main ───
async function main() {
  printBanner();

  if (flags.help) { printUsage(); process.exit(0); }

  // Build config
  const configOverrides = {};
  if (flags.provider) configOverrides.provider = flags.provider;
  if (flags.model) configOverrides.model = flags.model;
  if (flags['ollama-url']) configOverrides.ollamaBaseUrl = flags['ollama-url'];
  if (flags['openai-url']) configOverrides.openaiBaseUrl = flags['openai-url'];
  if (flags.dir) configOverrides.workingDirectory = resolve(flags.dir);
  if (flags.sandbox) configOverrides.sandboxMode = true;
  if (flags['max-iterations']) configOverrides.maxIterations = parseInt(flags['max-iterations'], 10);
  if (flags.debug) configOverrides.logLevel = 'debug';

  const config = loadConfig(configOverrides);
  const log = new Logger(config);

  // Health check mode
  if (flags.health) {
    await runHealthCheck(config, log);
    process.exit(0);
  }

  // Resolve provider
  let provider;
  try {
    if (config.provider && config.provider !== 'auto') {
      provider = createProvider(config);
      const health = await provider.healthCheck();
      if (!health.ok && config.provider === 'ollama') {
        log.warn(`Ollama not reachable. Ensure it's running: ollama serve`);
        log.warn(`Then pull a model: ollama pull ${config.model}`);
        process.exit(1);
      }
      log.info(`🔌 Provider: ${provider.name} (${config.model})`);
    } else {
      const detected = await autoDetectProvider(config);
      provider = detected.provider;
      if (detected.warning) log.warn(detected.warning);
      log.info(`🔌 Auto-detected: ${detected.detected} (${config.model})`);
    }
  } catch (e) {
    log.error(e.message);
    process.exit(1);
  }

  // Determine mode
  if (flags.interactive) {
    await runInteractive(config, log, provider);
  } else {
    let brief = '';

    if (flags.brief) {
      const briefPath = resolve(flags.brief);
      if (!existsSync(briefPath)) {
        log.error(`Brief file not found: ${briefPath}`);
        process.exit(1);
      }
      brief = readFileSync(briefPath, 'utf-8');
    } else if (positional.length > 0) {
      brief = positional.join(' ');
    } else if (!process.stdin.isTTY) {
      brief = readFileSync('/dev/stdin', 'utf-8').trim();
    }

    if (!brief) {
      log.error('No task brief provided.');
      printUsage();
      process.exit(1);
    }

    const result = await runOnce(brief, config, log, provider);
    process.exit(result.status === 'complete' ? 0 : 1);
  }
}

async function runHealthCheck(config, log) {
  console.log('\x1b[1m🏥 Provider Health Check\x1b[0m\n');
  const { OllamaProvider, OpenAICompatibleProvider, ClaudeProvider } = await import('./providers.js');

  // Ollama
  const ollama = new OllamaProvider(config);
  const oh = await ollama.healthCheck();
  console.log(`  Ollama (${config.ollamaBaseUrl}): ${oh.ok ? '✅ Running' : '❌ Not available'}`);
  if (oh.ok && oh.models) {
    console.log(`    Models: ${oh.models.slice(0, 10).join(', ')}`);
  }

  // OpenAI-compatible
  if (config.openaiBaseUrl) {
    const oai = new OpenAICompatibleProvider(config);
    const oaih = await oai.healthCheck();
    console.log(`  OpenAI-compat (${config.openaiBaseUrl}): ${oaih.ok ? '✅ Running' : '❌ Not available'}`);
  }

  // Claude
  const hasKey = !!config.apiKey;
  console.log(`  Claude API: ${hasKey ? '✅ API key set' : '⚠️  No API key (optional fallback)'}`);

  console.log(`\n\x1b[1mRecommended:\x1b[0m`);
  if (oh.ok) {
    console.log(`  Your Ollama is running. Use: node src/index.js "your task"`);
  } else {
    console.log(`  Start Ollama: ollama serve`);
    console.log(`  Pull model:   ollama pull qwen3-coder:30b-a3b`);
  }
}

async function runOnce(brief, config, log, provider, context = '') {
  const agent = new Agent(config, provider);
  const result = await agent.run(brief, context);

  console.log('\n\x1b[1m' + '═'.repeat(60) + '\x1b[0m');
  console.log(`\x1b[1m  AGENT RESULT\x1b[0m`);
  console.log('\x1b[1m' + '═'.repeat(60) + '\x1b[0m');
  console.log(`  Status:      ${statusIcon(result.status)} ${result.status}`);
  console.log(`  Provider:    ${result.provider} (${result.model})`);
  console.log(`  Iterations:  ${result.iterations}`);
  console.log(`  Tool Calls:  ${result.toolCalls}`);
  console.log(`  Duration:    ${(result.durationMs / 1000).toFixed(1)}s`);
  console.log(`  Tokens:      ${result.tokens.inputTokens} in / ${result.tokens.outputTokens} out`);
  console.log(`  Cost:        ${result.costSaved}`);
  console.log(`  Summary:     ${result.summary || 'N/A'}`);
  console.log('\x1b[1m' + '═'.repeat(60) + '\x1b[0m');

  const resultPath = resolve(config.logDir || './logs', `result-${Date.now().toString(36)}.json`);
  try {
    mkdirSync(resolve(config.logDir || './logs'), { recursive: true });
    writeFileSync(resultPath, JSON.stringify(result, null, 2));
    log.info(`📄 Result saved: ${resultPath}`);
  } catch { /* swallow */ }

  return result;
}

async function runInteractive(config, log, provider) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '\n\x1b[36m\x1b[1magent>\x1b[0m ' });

  console.log(`\x1b[2mInteractive mode. Provider: ${provider.name} (${config.model})`);
  console.log('Commands: /quit, /health, /provider <p>, /model <m>, /sandbox on|off\x1b[0m');

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }

    if (input === '/quit' || input === '/exit') { process.exit(0); }
    if (input === '/health') { await runHealthCheck(config, log); rl.prompt(); return; }
    if (input.startsWith('/provider')) {
      const p = input.split(' ')[1];
      if (p) { config.provider = p; provider = (await import('./providers.js')).createProvider(config); console.log(`Provider: ${provider.name}`); }
      rl.prompt(); return;
    }
    if (input.startsWith('/model')) {
      config.model = input.split(' ')[1] || config.model;
      console.log(`Model: ${config.model}`);
      rl.prompt(); return;
    }
    if (input.startsWith('/sandbox')) {
      config.sandboxMode = input.includes('on');
      console.log(`Sandbox: ${config.sandboxMode ? 'ON' : 'OFF'}`);
      rl.prompt(); return;
    }
    if (input.startsWith('/dir')) {
      const d = input.split(' ')[1];
      if (d) { config.workingDirectory = resolve(d); console.log(`Dir: ${config.workingDirectory}`); }
      rl.prompt(); return;
    }

    await runOnce(input, config, log, provider);
    rl.prompt();
  });

  rl.on('close', () => process.exit(0));
}

function statusIcon(s) {
  return { complete: '✅', failed: '❌', error: '⚠️', running: '🔄' }[s] || '❓';
}

main().catch(err => { console.error(`\x1b[31mFatal: ${err.message}\x1b[0m`); process.exit(1); });
