// src/logger.js — Structured logging with file + console output
// DigiMod AI Autonomous Agent v1.0

import { mkdirSync, appendFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const COLORS = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  magenta: '\x1b[35m',
};

export class Logger {
  constructor(config = {}) {
    this.level = LEVELS[config.logLevel] ?? LEVELS.info;
    this.logDir = config.logDir || './logs';
    this.logToFile = config.logToFile ?? true;
    this.sessionId = Date.now().toString(36);

    if (this.logToFile) {
      mkdirSync(resolve(this.logDir), { recursive: true });
      this.logFile = resolve(this.logDir, `agent-${this.sessionId}.jsonl`);
    }
  }

  _emit(level, message, meta = {}) {
    if (LEVELS[level] < this.level) return;

    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...meta,
    };

    // Console
    const color = COLORS[level] || COLORS.reset;
    const prefix = `${COLORS.dim}${entry.timestamp}${COLORS.reset} ${color}[${level.toUpperCase().padEnd(5)}]${COLORS.reset}`;
    console.log(`${prefix} ${message}`);
    if (meta && Object.keys(meta).length > 0 && level === 'debug') {
      console.log(`${COLORS.dim}  └─ ${JSON.stringify(meta)}${COLORS.reset}`);
    }

    // File
    if (this.logToFile && this.logFile) {
      try {
        appendFileSync(this.logFile, JSON.stringify(entry) + '\n');
      } catch { /* swallow file write errors */ }
    }
  }

  debug(msg, meta) { this._emit('debug', msg, meta); }
  info(msg, meta) { this._emit('info', msg, meta); }
  warn(msg, meta) { this._emit('warn', msg, meta); }
  error(msg, meta) { this._emit('error', msg, meta); }

  /** Pretty-print agent thinking / plan */
  plan(text) {
    console.log(`\n${COLORS.magenta}${COLORS.bold}🧠 AGENT THINKING${COLORS.reset}`);
    console.log(`${COLORS.dim}${'─'.repeat(60)}${COLORS.reset}`);
    console.log(text);
    console.log(`${COLORS.dim}${'─'.repeat(60)}${COLORS.reset}\n`);
  }

  /** Pretty-print tool execution */
  tool(name, input, result, durationMs) {
    const truncResult = typeof result === 'string' && result.length > 500
      ? result.slice(0, 500) + '...[truncated]'
      : result;
    console.log(`${COLORS.green}  🔧 ${name}${COLORS.reset} ${COLORS.dim}(${durationMs}ms)${COLORS.reset}`);
    if (this.level <= LEVELS.debug) {
      console.log(`${COLORS.dim}     input: ${JSON.stringify(input).slice(0, 200)}${COLORS.reset}`);
      console.log(`${COLORS.dim}     result: ${typeof truncResult === 'string' ? truncResult.slice(0, 200) : JSON.stringify(truncResult).slice(0, 200)}${COLORS.reset}`);
    }
  }

  /** Agent iteration banner */
  iteration(n, max) {
    console.log(`\n${COLORS.bold}${COLORS.cyan}━━━ Iteration ${n}/${max} ━━━${COLORS.reset}`);
  }
}
