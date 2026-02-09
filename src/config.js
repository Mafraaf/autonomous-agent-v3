// src/config.js — Agent configuration (v2.0 — Local-First)

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const DEFAULT_CONFIG = {
  // Provider selection: 'ollama' | 'openai-compatible' | 'vllm' | 'lmstudio' | 'claude'
  provider: 'ollama',

  // Model — meaning depends on provider
  // Ollama: 'qwen3-coder:30b-a3b', 'devstral', 'qwen3:30b-a3b'
  // vLLM/LM Studio: whatever model is loaded
  // Claude: 'claude-sonnet-4-20250514'
  model: 'qwen3-coder:30b-a3b',

  // Ollama settings
  ollamaBaseUrl: 'http://localhost:11434',

  // OpenAI-compatible settings (vLLM, LM Studio, LocalAI)
  openaiBaseUrl: 'http://localhost:8000',

  // Claude API (fallback only)
  apiKey: process.env.ANTHROPIC_API_KEY || '',
  claudeModel: 'claude-sonnet-4-20250514',

  // Generation
  maxTokens: 16384,

  // Agent behaviour
  maxIterations: 50,
  workingDirectory: process.cwd(),
  sandboxMode: false,

  // Logging
  logLevel: 'info',
  logDir: './logs',
  logToFile: true,

  // Safety
  blockedCommands: ['rm -rf /', 'mkfs', ':(){:|:&};:', 'dd if=/dev/zero', 'chmod -R 777 /'],
  maxFileSize: 10 * 1024 * 1024,
  httpTimeoutMs: 30000,

  // Git
  autoCommit: false,
  commitPrefix: '[agent]',
};

export function loadConfig(overrides = {}) {
  let fileConfig = {};
  const configPath = resolve(process.cwd(), 'agent.config.json');

  if (existsSync(configPath)) {
    try { fileConfig = JSON.parse(readFileSync(configPath, 'utf-8')); }
    catch (e) { console.warn(`⚠ Could not parse ${configPath}: ${e.message}`); }
  }

  const config = { ...DEFAULT_CONFIG, ...fileConfig, ...overrides };

  // Env overrides
  if (process.env.ANTHROPIC_API_KEY) config.apiKey = process.env.ANTHROPIC_API_KEY;
  if (process.env.AGENT_PROVIDER) config.provider = process.env.AGENT_PROVIDER;
  if (process.env.AGENT_MODEL) config.model = process.env.AGENT_MODEL;
  if (process.env.AGENT_MAX_ITERATIONS) config.maxIterations = parseInt(process.env.AGENT_MAX_ITERATIONS, 10);
  if (process.env.AGENT_SANDBOX === 'true') config.sandboxMode = true;
  if (process.env.OLLAMA_BASE_URL) config.ollamaBaseUrl = process.env.OLLAMA_BASE_URL;
  if (process.env.OPENAI_BASE_URL) config.openaiBaseUrl = process.env.OPENAI_BASE_URL;

  return config;
}

export default DEFAULT_CONFIG;
