// src/providers.js — LLM Provider Abstraction Layer
// DigiMod AI Autonomous Agent v2.0 — Local-First Architecture
//
// Supports:
//   1. Ollama (local, zero cost, zero latency to network)
//   2. Any OpenAI-compatible endpoint (vLLM, LM Studio, LocalAI, etc.)
//   3. Anthropic Claude API (fallback / quality gate)
//
// The agent doesn't care WHERE the intelligence comes from.
// It cares about: tool_use responses it can parse and execute.

import { request as httpsRequest } from 'https';
import { request as httpRequest } from 'http';

// ─────────────────────────────────────────────
// PROVIDER: OLLAMA (Local)
// ─────────────────────────────────────────────
// Ollama exposes an OpenAI-compatible API at /v1/chat/completions
// with native tool/function calling support (Ollama ≥0.9.0).
// Models: qwen3-coder:30b, devstral, qwen3:30b-a3b, etc.

class OllamaProvider {
  constructor(config) {
    this.baseUrl = config.ollamaBaseUrl || 'http://localhost:11434';
    this.model = config.model || 'qwen3-coder:30b-a3b';
    this.name = 'ollama';
  }

  async chat(messages, tools, systemPrompt) {
    // Ollama's /api/chat supports tools natively since v0.9.0
    const payload = {
      model: this.model,
      messages: this._buildMessages(messages, systemPrompt),
      tools: tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      })),
      stream: false,
      options: {
        num_ctx: 32768,
        temperature: 0.3,
        top_p: 0.95,
      },
    };

    const response = await this._post('/api/chat', payload);

    // Normalize to our internal format
    return this._normalizeResponse(response);
  }

  _buildMessages(messages, systemPrompt) {
    const result = [];
    if (systemPrompt) {
      result.push({ role: 'system', content: systemPrompt });
    }

    for (const msg of messages) {
      if (msg.role === 'user' && Array.isArray(msg.content)) {
        // Tool results — Ollama expects them as tool messages
        for (const block of msg.content) {
          if (block.type === 'tool_result') {
            result.push({
              role: 'tool',
              content: block.content,
            });
          }
        }
      } else if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        // Assistant messages with tool calls
        const textParts = msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
        const toolCalls = msg.content.filter(b => b.type === 'tool_use').map(tc => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.input),
          },
        }));
        result.push({
          role: 'assistant',
          content: textParts || '',
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        });
      } else {
        result.push({
          role: msg.role,
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        });
      }
    }
    return result;
  }

  _normalizeResponse(raw) {
    const message = raw.message || {};
    const content = [];

    // Text content
    if (message.content) {
      content.push({ type: 'text', text: message.content });
    }

    // Tool calls
    if (message.tool_calls && message.tool_calls.length > 0) {
      for (const tc of message.tool_calls) {
        content.push({
          type: 'tool_use',
          id: tc.id || `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: tc.function.name,
          input: typeof tc.function.arguments === 'string'
            ? JSON.parse(tc.function.arguments)
            : tc.function.arguments,
        });
      }
    }

    return {
      content,
      stop_reason: message.tool_calls?.length > 0 ? 'tool_use' : 'end_turn',
      usage: {
        input_tokens: raw.prompt_eval_count || 0,
        output_tokens: raw.eval_count || 0,
      },
      model: raw.model,
      provider: 'ollama',
      eval_duration_ms: raw.eval_duration ? raw.eval_duration / 1e6 : 0,
      tokens_per_second: raw.eval_count && raw.eval_duration
        ? (raw.eval_count / (raw.eval_duration / 1e9)).toFixed(1)
        : 'N/A',
    };
  }

  async _post(path, body) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.baseUrl);
      const reqFn = url.protocol === 'https:' ? httpsRequest : httpRequest;

      const options = {
        method: 'POST',
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        headers: { 'Content-Type': 'application/json' },
        timeout: 300000, // 5 min — local models can be slow on first load
      };

      const req = reqFn(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Ollama response parse error: ${e.message}\nRaw: ${data.slice(0, 500)}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Ollama request timed out (300s)'));
      });

      req.write(JSON.stringify(body));
      req.end();
    });
  }

  async complete(systemPrompt, userInput) {
    const response = await this.chat(
      [{ role: 'user', content: userInput }],
      [],
      systemPrompt,
    );
    const text = response.content?.filter(b => b.type === 'text').map(b => b.text).join('\n');
    return text || '';
  }

  async processAgentLoop(input) {
    const systemPrompt = 'You are a helpful AI assistant. Answer the user\'s question directly and concisely.';
    const text = await this.complete(systemPrompt, input);
    return { response: text };
  }

  async healthCheck() {
    try {
      const res = await this._post('/api/tags', {});
      const models = (res.models || []).map(m => m.name);
      return { ok: true, models, provider: 'ollama' };
    } catch (e) {
      return { ok: false, error: e.message, provider: 'ollama' };
    }
  }
}

// ─────────────────────────────────────────────
// PROVIDER: OPENAI-COMPATIBLE (vLLM, LM Studio, LocalAI, etc.)
// ─────────────────────────────────────────────

class OpenAICompatibleProvider {
  constructor(config) {
    this.baseUrl = config.openaiBaseUrl || 'http://localhost:8000';
    this.model = config.model || 'qwen3-coder';
    this.apiKey = config.apiKey || 'not-needed';
    this.name = 'openai-compatible';
  }

  async chat(messages, tools, systemPrompt) {
    const payload = {
      model: this.model,
      messages: this._buildMessages(messages, systemPrompt),
      tools: tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      })),
      temperature: 0.3,
      max_tokens: 16384,
    };

    const response = await this._post('/v1/chat/completions', payload);
    return this._normalizeResponse(response);
  }

  _buildMessages(messages, systemPrompt) {
    const result = [];
    if (systemPrompt) {
      result.push({ role: 'system', content: systemPrompt });
    }

    for (const msg of messages) {
      if (msg.role === 'user' && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_result') {
            result.push({
              role: 'tool',
              tool_call_id: block.tool_use_id,
              content: block.content,
            });
          }
        }
      } else if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        const textParts = msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
        const toolCalls = msg.content.filter(b => b.type === 'tool_use').map(tc => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.input),
          },
        }));
        result.push({
          role: 'assistant',
          content: textParts || null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        });
      } else {
        result.push({
          role: msg.role,
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        });
      }
    }
    return result;
  }

  _normalizeResponse(raw) {
    const choice = raw.choices?.[0] || {};
    const message = choice.message || {};
    const content = [];

    if (message.content) {
      content.push({ type: 'text', text: message.content });
    }

    if (message.tool_calls?.length > 0) {
      for (const tc of message.tool_calls) {
        content.push({
          type: 'tool_use',
          id: tc.id || `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: tc.function.name,
          input: typeof tc.function.arguments === 'string'
            ? JSON.parse(tc.function.arguments)
            : tc.function.arguments,
        });
      }
    }

    return {
      content,
      stop_reason: message.tool_calls?.length > 0 ? 'tool_use' : 'end_turn',
      usage: raw.usage || {},
      model: raw.model,
      provider: 'openai-compatible',
    };
  }

  async _post(path, body) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.baseUrl);
      const reqFn = url.protocol === 'https:' ? httpsRequest : httpRequest;

      const options = {
        method: 'POST',
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        timeout: 300000,
      };

      const req = reqFn(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`OpenAI-compatible parse error: ${e.message}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
      req.write(JSON.stringify(body));
      req.end();
    });
  }

  async complete(systemPrompt, userInput) {
    const response = await this.chat(
      [{ role: 'user', content: userInput }],
      [],
      systemPrompt,
    );
    const text = response.content?.filter(b => b.type === 'text').map(b => b.text).join('\n');
    return text || '';
  }

  async processAgentLoop(input) {
    const systemPrompt = 'You are a helpful AI assistant. Answer the user\'s question directly and concisely.';
    const text = await this.complete(systemPrompt, input);
    return { response: text };
  }

  async healthCheck() {
    try {
      const res = await this._post('/v1/models', {});
      return { ok: true, models: res.data?.map(m => m.id) || [], provider: 'openai-compatible' };
    } catch (e) {
      return { ok: false, error: e.message, provider: 'openai-compatible' };
    }
  }
}

// ─────────────────────────────────────────────
// PROVIDER: ANTHROPIC CLAUDE (API fallback)
// ─────────────────────────────────────────────

class ClaudeProvider {
  constructor(config) {
    this.apiKey = config.apiKey;
    this.model = config.claudeModel || 'claude-sonnet-4-20250514';
    this.maxTokens = config.maxTokens || 16384;
    this.name = 'claude';
  }

  async chat(messages, tools, systemPrompt) {
    // Claude uses its own message format natively — pass through
    const payload = {
      model: this.model,
      max_tokens: this.maxTokens,
      system: systemPrompt,
      tools: tools,
      messages: messages,
    };

    const response = await this._post('/v1/messages', payload);

    return {
      content: response.content,
      stop_reason: response.stop_reason,
      usage: response.usage || {},
      model: response.model,
      provider: 'claude',
    };
  }

  async _post(path, body) {
    return new Promise((resolve, reject) => {
      const options = {
        method: 'POST',
        hostname: 'api.anthropic.com',
        path: path,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        timeout: 120000,
      };

      const req = httpsRequest(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) reject(new Error(`Claude API: ${parsed.error.message}`));
            else resolve(parsed);
          } catch (e) {
            reject(new Error(`Claude parse error: ${e.message}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Claude request timed out')); });
      req.write(JSON.stringify(body));
      req.end();
    });
  }

  async complete(systemPrompt, userInput) {
    const response = await this.chat(
      [{ role: 'user', content: userInput }],
      [],
      systemPrompt,
    );
    const text = response.content?.filter(b => b.type === 'text').map(b => b.text).join('\n');
    return text || '';
  }

  async processAgentLoop(input) {
    const systemPrompt = 'You are a helpful AI assistant. Answer the user\'s question directly and concisely.';
    const text = await this.complete(systemPrompt, input);
    return { response: text };
  }

  async healthCheck() {
    return { ok: !!this.apiKey, provider: 'claude', note: 'API key check only' };
  }
}

// ─────────────────────────────────────────────
// FACTORY: Create the right provider from config
// ─────────────────────────────────────────────

/**
 * Provider priority (configurable):
 *   1. Ollama — free, fast, local, private
 *   2. OpenAI-compatible — vLLM, LM Studio, etc.
 *   3. Claude API — paid, highest quality fallback
 *
 * The agent can also chain providers: use local for routine work,
 * escalate to Claude for complex reasoning (configurable).
 */
export function createProvider(config) {
  const provider = config.provider || 'ollama';

  switch (provider) {
    case 'ollama':
      return new OllamaProvider(config);
    case 'openai':
    case 'openai-compatible':
    case 'vllm':
    case 'lmstudio':
      return new OpenAICompatibleProvider(config);
    case 'claude':
    case 'anthropic':
      return new ClaudeProvider(config);
    default:
      throw new Error(`Unknown provider: ${provider}. Use: ollama, openai-compatible, claude`);
  }
}

/**
 * Auto-detect available providers and return the best one.
 * Tries Ollama first, then OpenAI-compatible, then Claude.
 */
export async function autoDetectProvider(config) {
  // Try Ollama
  const ollama = new OllamaProvider(config);
  const ollamaHealth = await ollama.healthCheck();
  if (ollamaHealth.ok) {
    // Check if the requested model is available
    const modelBase = (config.model || 'qwen3-coder').split(':')[0];
    const hasModel = ollamaHealth.models?.some(m => m.includes(modelBase));
    if (hasModel) {
      return { provider: ollama, detected: 'ollama', models: ollamaHealth.models };
    }
    return {
      provider: ollama,
      detected: 'ollama',
      models: ollamaHealth.models,
      warning: `Model "${config.model}" not found. Available: ${ollamaHealth.models.join(', ')}`,
    };
  }

  // Try OpenAI-compatible
  if (config.openaiBaseUrl) {
    const oai = new OpenAICompatibleProvider(config);
    const oaiHealth = await oai.healthCheck();
    if (oaiHealth.ok) {
      return { provider: oai, detected: 'openai-compatible', models: oaiHealth.models };
    }
  }

  // Fall back to Claude
  if (config.apiKey) {
    const claude = new ClaudeProvider(config);
    return { provider: claude, detected: 'claude', note: 'Falling back to Claude API (paid)' };
  }

  throw new Error(
    'No LLM provider available.\n' +
    '  • Start Ollama: ollama serve && ollama pull qwen3-coder:30b-a3b\n' +
    '  • Or set --provider openai-compatible --openai-base-url http://...\n' +
    '  • Or set ANTHROPIC_API_KEY for Claude fallback'
  );
}

export { OllamaProvider, OpenAICompatibleProvider, ClaudeProvider };
