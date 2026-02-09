#!/usr/bin/env node

/**
 * Autonomous Agent v3.0 — Deterministic-First Architecture
 * 
 * 80–95% of tasks execute with ZERO model inference.
 * Model fallback only for genuinely ambiguous/novel requests.
 * 
 * Usage:
 *   node src/v3.js                                    # Deterministic only
 *   node src/v3.js --provider ollama                  # + Ollama fallback
 *   node src/v3.js --provider claude                  # + Claude fallback
 *   node src/v3.js --analyse "read file src/agent.js" # Single classification
 *   node src/v3.js --benchmark                        # Classifier benchmark
 */

import readline from 'readline';
import { classify, extractEntities } from './classifier.js';
import { WorkflowOrchestrator } from './orchestrator.js';
import { executeTool } from './tools.js';
import { loadConfig } from './config.js';
import { Logger } from './logger.js';

// ── Parse CLI args ──────────────────────────────────────────────────
const args = process.argv.slice(2);
const flags = {
  provider: null,
  analyse: null,
  benchmark: false,
  verbose: false,
};

for (let i = 0; i < args.length; i++) {
  if ((args[i] === '--provider') && args[i + 1]) flags.provider = args[++i];
  if ((args[i] === '--analyse' || args[i] === '--analyze') && args[i + 1]) flags.analyse = args[++i];
  if (args[i] === '--benchmark') flags.benchmark = true;
  if (args[i] === '--verbose' || args[i] === '-v') flags.verbose = true;
}

// ── ANSI colours ────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[34m',
  cyan: '\x1b[36m', red: '\x1b[31m', grey: '\x1b[90m',
};

// ── Single analysis mode ────────────────────────────────────────────
if (flags.analyse) {
  const result = classify(flags.analyse);
  const entities = extractEntities(flags.analyse);

  console.log(`\n${C.bold}Classification Analysis${C.reset}`);
  console.log(`${C.grey}─────────────────────────────────────${C.reset}`);
  console.log(`Input:      ${C.cyan}${flags.analyse}${C.reset}`);
  console.log(`Intent:     ${C.bold}${result.intent}${C.reset}`);
  console.log(`Confidence: ${result.confidence >= 0.4 ? C.green : C.yellow}${(result.confidence * 100).toFixed(0)}%${C.reset}`);
  console.log(`Model needed: ${result.needsModel ? C.yellow + 'YES' : C.green + 'NO'}${C.reset} (${result.reason})`);
  console.log(`Tools:      ${result.tools.join(', ') || 'none'}`);

  if (entities.filePaths.length) console.log(`Files:      ${entities.filePaths.join(', ')}`);
  if (entities.urls.length) console.log(`URLs:       ${entities.urls.join(', ')}`);
  if (entities.gitOps.length) console.log(`Git ops:    ${entities.gitOps.map(g => g.operation).join(', ')}`);
  if (entities.packages.length) console.log(`Packages:   ${entities.packages.join(', ')}`);

  if (result.allScores.length > 1) {
    console.log(`\n${C.dim}All scores:${C.reset}`);
    for (const s of result.allScores) {
      console.log(`  ${s.taskType}: ${(s.confidence * 100).toFixed(0)}% (${s.matchedPatterns}p/${s.matchedKeywords}k)`);
    }
  }
  console.log();
  process.exit(0);
}

// ── Benchmark mode ──────────────────────────────────────────────────
if (flags.benchmark) {
  runBenchmark();
  process.exit(0);
}

function runBenchmark() {
  const testCases = [
    // Fully deterministic — should NOT need model
    { input: 'read file src/agent.js', expect: { det: true, intent: 'file_read' } },
    { input: 'cat package.json', expect: { det: true, intent: 'file_read' } },
    { input: 'show contents of README.md', expect: { det: true, intent: 'file_read' } },
    { input: 'list files in src/', expect: { det: true, intent: 'file_read' } },
    { input: 'create file config.yaml', expect: { det: true, intent: 'file_write' } },
    { input: 'write a new file called utils.js', expect: { det: true, intent: 'file_write' } },
    { input: 'edit src/index.js', expect: { det: true, intent: 'file_edit' } },
    { input: 'fix the bug in src/tools.js', expect: { det: true, intent: 'file_edit' } },
    { input: 'run npm install express', expect: { det: true, intent: 'shell_command' } },
    { input: 'git status', expect: { det: true, intent: 'shell_command' } },
    { input: 'git commit -m "initial commit"', expect: { det: true, intent: 'shell_command' } },
    { input: 'npm test', expect: { det: false, intent: 'shell_command' } },
    { input: 'curl https://api.example.com/data', expect: { det: true, intent: 'http_request' } },
    { input: 'fetch data from https://api.example.com/users', expect: { det: true, intent: 'http_request' } },
    { input: 'search for "TODO" in src/', expect: { det: true, intent: 'search' } },
    { input: 'find all files containing "export" in src', expect: { det: true, intent: 'search' } },
    { input: 'run the tests', expect: { det: true, intent: 'testing' } },
    { input: 'analyse the code in src/agent.js', expect: { det: true, intent: 'code_analysis' } },
    { input: 'review the code quality of src/', expect: { det: true, intent: 'code_analysis' } },

    // Should need model — ambiguous or creative
    { input: 'help me build a REST API', expect: { det: false } },
    { input: 'what do you think about this architecture?', expect: { det: false } },
    { input: 'explain how async/await works', expect: { det: false } },
    { input: 'refactor the entire codebase for better performance', expect: { det: false } },
  ];

  console.log(`\n${C.bold}═══ CLASSIFIER BENCHMARK ═══${C.reset}\n`);

  let pass = 0;
  let fail = 0;

  for (const tc of testCases) {
    const result = classify(tc.input);
    const isDet = !result.needsModel;
    const intentOk = !tc.expect.intent || result.intent === tc.expect.intent;
    const detOk = isDet === tc.expect.det;
    const passed = intentOk && detOk;

    if (passed) {
      pass++;
      if (flags.verbose) {
        console.log(`  ${C.green}✓${C.reset} ${tc.input}`);
        console.log(`    ${C.dim}→ ${result.intent} (${(result.confidence * 100).toFixed(0)}%) det=${isDet}${C.reset}`);
      }
    } else {
      fail++;
      console.log(`  ${C.red}✗${C.reset} ${tc.input}`);
      console.log(`    ${C.red}Expected: intent=${tc.expect.intent || 'any'} det=${tc.expect.det}${C.reset}`);
      console.log(`    ${C.red}Got:      intent=${result.intent} det=${isDet} (${(result.confidence * 100).toFixed(0)}%, ${result.reason})${C.reset}`);
    }
  }

  const total = pass + fail;
  const rate = ((pass / total) * 100).toFixed(1);
  const colour = rate >= 90 ? C.green : rate >= 75 ? C.yellow : C.red;

  console.log(`\n${C.bold}Results: ${colour}${pass}/${total} passed (${rate}%)${C.reset}`);

  // Deterministic coverage
  const detCases = testCases.filter(t => t.expect.det);
  const detPass = detCases.filter(tc => {
    const r = classify(tc.input);
    return !r.needsModel && (!tc.expect.intent || r.intent === tc.expect.intent);
  }).length;
  console.log(`Deterministic accuracy: ${C.bold}${detPass}/${detCases.length}${C.reset}`);
  console.log();
}

// ── Interactive REPL mode ───────────────────────────────────────────
async function main() {
  const config = loadConfig();
  const logger = new Logger(config);

  // Wrap executeTool with config baked in
  const execute = async (toolName, toolArgs) => {
    return executeTool(toolName, toolArgs, config);
  };

  // Set up model provider if requested
  let modelProvider = null;
  if (flags.provider) {
    try {
      const { createProvider } = await import('./providers.js');
      const providerConfig = {
        ...config,
        provider: flags.provider,
        model: config.ollamaModel || config.model || 'qwen3-coder:30b',
      };
      modelProvider = createProvider(providerConfig);
      console.log(`${C.dim}Model fallback: ${flags.provider}${C.reset}`);
    } catch (err) {
      console.log(`${C.yellow}Warning: Could not init ${flags.provider}: ${err.message}${C.reset}`);
      console.log(`${C.dim}Running deterministic-only.${C.reset}`);
    }
  }

  // Create orchestrator
  const orchestrator = new WorkflowOrchestrator(execute, modelProvider, {
    confidenceThreshold: 0.4,
    logger,
  });

  console.log(`
${C.bold}${C.cyan}╔══════════════════════════════════════════════════╗
║  Autonomous Agent v3.0 — Deterministic Engine    ║
║  Model: ${(flags.provider || 'NONE (pure deterministic)').padEnd(39)}║
╚══════════════════════════════════════════════════╝${C.reset}

${C.dim}Commands: /metrics  /trace  /classify <input>  /quit${C.reset}
`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${C.green}▶${C.reset} `,
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }

    // Meta commands
    if (input === '/quit' || input === '/exit') {
      console.log(orchestrator.printMetrics());
      rl.close();
      return;
    }

    if (input === '/metrics') {
      console.log(orchestrator.printMetrics());
      rl.prompt();
      return;
    }

    if (input.startsWith('/classify ')) {
      const query = input.slice(10);
      const result = classify(query);
      console.log(`\n${C.dim}Intent: ${C.bold}${result.intent}${C.reset}${C.dim} | Confidence: ${(result.confidence * 100).toFixed(0)}% | Model: ${result.needsModel ? 'YES' : 'NO'} (${result.reason})${C.reset}\n`);
      rl.prompt();
      return;
    }

    if (input === '/trace') {
      flags.verbose = !flags.verbose;
      console.log(`${C.dim}Trace: ${flags.verbose ? 'ON' : 'OFF'}${C.reset}`);
      rl.prompt();
      return;
    }

    // Process through deterministic orchestrator
    try {
      const result = await orchestrator.process(input);

      if (flags.verbose && result.trace) {
        console.log(`${C.grey}[trace] ${JSON.stringify(result.trace, null, 2)}${C.reset}`);
      }

      const badge = result.deterministic
        ? `${C.green}■ deterministic${C.reset}`
        : `${C.yellow}■ model-assisted${C.reset}`;

      console.log(`\n${badge}`);
      console.log(result.response);
      console.log();

    } catch (err) {
      console.error(`${C.red}Error: ${err.message}${C.reset}`);
    }

    rl.prompt();
  });

  rl.on('close', () => {
    console.log(`${C.dim}Agent terminated.${C.reset}`);
    process.exit(0);
  });
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
