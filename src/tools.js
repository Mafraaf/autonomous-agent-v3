// src/tools.js — Tool definitions (Claude schema) + executors
// DigiMod AI Autonomous Agent v1.0

import { execSync, spawn } from 'child_process';
import {
  readFileSync, writeFileSync, existsSync, mkdirSync,
  readdirSync, statSync, unlinkSync, renameSync
} from 'fs';
import { resolve, dirname, relative, join } from 'path';
import { request as httpsRequest } from 'https';
import { request as httpRequest } from 'http';

// ─────────────────────────────────────────────
// TOOL DEFINITIONS (Claude API tool_use schema)
// ─────────────────────────────────────────────

export const TOOL_DEFINITIONS = [
  {
    name: 'create_file',
    description: 'Create or overwrite a file with the given content. Creates parent directories automatically.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path (relative to working directory or absolute)' },
        content: { type: 'string', description: 'Full file content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'read_file',
    description: 'Read the full content of a file. Returns the text content or an error.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to read' },
        line_range: {
          type: 'array',
          items: { type: 'integer' },
          minItems: 2, maxItems: 2,
          description: 'Optional [start, end] line numbers (1-indexed). Omit to read entire file.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'edit_file',
    description: 'Find and replace a unique string in a file. The search string must appear exactly once.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to edit' },
        old_str: { type: 'string', description: 'Exact string to find (must be unique in file)' },
        new_str: { type: 'string', description: 'Replacement string (empty string to delete)' },
      },
      required: ['path', 'old_str', 'new_str'],
    },
  },
  {
    name: 'run_command',
    description: 'Execute a shell command and return stdout/stderr. Use for: running scripts, installing packages, building, testing, etc.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
        cwd: { type: 'string', description: 'Working directory (optional, defaults to project root)' },
        timeout_ms: { type: 'integer', description: 'Timeout in milliseconds (default 60000)' },
      },
      required: ['command'],
    },
  },
  {
    name: 'http_request',
    description: 'Make an HTTP/HTTPS request to an API endpoint. Returns status code, headers, and body.',
    input_schema: {
      type: 'object',
      properties: {
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] },
        url: { type: 'string', description: 'Full URL including scheme' },
        headers: { type: 'object', description: 'Request headers as key-value pairs' },
        body: { type: 'string', description: 'Request body (for POST/PUT/PATCH)' },
      },
      required: ['method', 'url'],
    },
  },
  {
    name: 'list_directory',
    description: 'List files and directories at a path. Returns names, types, and sizes.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path to list' },
        recursive: { type: 'boolean', description: 'If true, list recursively (max 3 levels)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'delete_file',
    description: 'Delete a file or empty directory.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to delete' },
      },
      required: ['path'],
    },
  },
  {
    name: 'move_file',
    description: 'Move or rename a file.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Source path' },
        to: { type: 'string', description: 'Destination path' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'git',
    description: 'Execute a git command. Supports all git subcommands: status, add, commit, push, pull, branch, log, diff, etc.',
    input_schema: {
      type: 'object',
      properties: {
        args: { type: 'string', description: 'Git arguments (e.g., "status", "add .", "commit -m \\"message\\"", "push origin main")' },
        cwd: { type: 'string', description: 'Repository directory (optional)' },
      },
      required: ['args'],
    },
  },
  {
    name: 'search_files',
    description: 'Search for a pattern in files using grep. Returns matching lines with file paths and line numbers.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Search pattern (regex supported)' },
        path: { type: 'string', description: 'Directory or file to search in' },
        file_glob: { type: 'string', description: 'File glob pattern, e.g. "*.js", "*.py" (optional)' },
      },
      required: ['pattern', 'path'],
    },
  },
  {
    name: 'task_complete',
    description: 'Signal that the assigned task is DONE. Provide a summary of what was accomplished. The agent loop will stop after this.',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Summary of what was done, files changed, and any notes.' },
      },
      required: ['summary'],
    },
  },
  {
    name: 'task_failed',
    description: 'Signal that the task CANNOT be completed. Provide the reason and what was attempted.',
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Why the task failed.' },
        attempted: { type: 'string', description: 'What was tried before declaring failure.' },
      },
      required: ['reason'],
    },
  },
];

// ─────────────────────────────────────────────
// TOOL EXECUTORS
// ─────────────────────────────────────────────

function resolvePath(p, config) {
  if (!p) return config.workingDirectory;
  return resolve(config.workingDirectory, p);
}

function checkSafety(command, config) {
  if (config.sandboxMode) {
    const destructive = ['rm -rf', 'rm -r', 'rmdir', 'mkfs', 'dd ', 'format', 'fdisk'];
    for (const d of destructive) {
      if (command.toLowerCase().includes(d)) {
        throw new Error(`SANDBOX: Blocked destructive command containing "${d}"`);
      }
    }
  }
  for (const blocked of config.blockedCommands || []) {
    if (command.includes(blocked)) {
      throw new Error(`SAFETY: Command blocked by policy: "${blocked}"`);
    }
  }
}

const executors = {
  create_file(input, config) {
    const fullPath = resolvePath(input.path, config);
    const content = input.content || '';
    if (Buffer.byteLength(content) > config.maxFileSize) {
      return { success: false, error: `File exceeds max size of ${config.maxFileSize} bytes` };
    }
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, 'utf-8');
    return { success: true, path: fullPath, bytes: Buffer.byteLength(content) };
  },

  read_file(input, config) {
    const fullPath = resolvePath(input.path, config);
    if (!existsSync(fullPath)) return { success: false, error: `File not found: ${fullPath}` };
    const content = readFileSync(fullPath, 'utf-8');
    if (input.line_range) {
      const lines = content.split('\n');
      const [start, end] = input.line_range;
      const slice = lines.slice(Math.max(0, start - 1), end === -1 ? undefined : end);
      return { success: true, content: slice.join('\n'), totalLines: lines.length };
    }
    return { success: true, content, totalLines: content.split('\n').length };
  },

  edit_file(input, config) {
    const fullPath = resolvePath(input.path, config);
    if (!existsSync(fullPath)) return { success: false, error: `File not found: ${fullPath}` };
    let content = readFileSync(fullPath, 'utf-8');
    const count = content.split(input.old_str).length - 1;
    if (count === 0) return { success: false, error: 'Search string not found in file' };
    if (count > 1) return { success: false, error: `Search string found ${count} times — must be unique` };
    content = content.replace(input.old_str, input.new_str);
    writeFileSync(fullPath, content, 'utf-8');
    return { success: true, path: fullPath };
  },

  run_command(input, config) {
    checkSafety(input.command, config);
    const cwd = input.cwd ? resolvePath(input.cwd, config) : config.workingDirectory;
    const timeout = input.timeout_ms || 60000;
    try {
      const stdout = execSync(input.command, {
        cwd,
        timeout,
        maxBuffer: 5 * 1024 * 1024,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { success: true, stdout: stdout?.slice(0, 50000) || '', exitCode: 0 };
    } catch (err) {
      return {
        success: false,
        stdout: err.stdout?.slice(0, 20000) || '',
        stderr: err.stderr?.slice(0, 20000) || '',
        exitCode: err.status ?? 1,
        error: err.message?.slice(0, 500),
      };
    }
  },

  async http_request(input, config) {
    return new Promise((resolveP) => {
      const url = new URL(input.url);
      const reqFn = url.protocol === 'https:' ? httpsRequest : httpRequest;
      const options = {
        method: input.method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers: input.headers || {},
        timeout: config.httpTimeoutMs || 30000,
      };

      const req = reqFn(options, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          resolveP({
            success: true,
            statusCode: res.statusCode,
            headers: res.headers,
            body: body.slice(0, 50000),
          });
        });
      });

      req.on('error', (err) => resolveP({ success: false, error: err.message }));
      req.on('timeout', () => {
        req.destroy();
        resolveP({ success: false, error: 'Request timed out' });
      });

      if (input.body && ['POST', 'PUT', 'PATCH'].includes(input.method)) {
        req.write(input.body);
      }
      req.end();
    });
  },

  list_directory(input, config) {
    const fullPath = resolvePath(input.path, config);
    if (!existsSync(fullPath)) return { success: false, error: `Path not found: ${fullPath}` };

    function listDir(dir, depth = 0, maxDepth = 3) {
      if (depth > maxDepth) return [];
      const entries = [];
      try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
          const entryPath = join(dir, entry.name);
          const relPath = relative(config.workingDirectory, entryPath);
          if (entry.isDirectory()) {
            entries.push({ name: relPath + '/', type: 'dir' });
            if (input.recursive) entries.push(...listDir(entryPath, depth + 1, maxDepth));
          } else {
            const st = statSync(entryPath);
            entries.push({ name: relPath, type: 'file', size: st.size });
          }
        }
      } catch { /* permission errors etc */ }
      return entries;
    }

    return { success: true, entries: listDir(fullPath) };
  },

  delete_file(input, config) {
    const fullPath = resolvePath(input.path, config);
    if (config.sandboxMode) return { success: false, error: 'SANDBOX: delete_file blocked' };
    if (!existsSync(fullPath)) return { success: false, error: 'Path not found' };
    unlinkSync(fullPath);
    return { success: true, deleted: fullPath };
  },

  move_file(input, config) {
    const from = resolvePath(input.from, config);
    const to = resolvePath(input.to, config);
    if (!existsSync(from)) return { success: false, error: 'Source not found' };
    mkdirSync(dirname(to), { recursive: true });
    renameSync(from, to);
    return { success: true, from, to };
  },

  git(input, config) {
    const cwd = input.cwd ? resolvePath(input.cwd, config) : config.workingDirectory;
    try {
      const stdout = execSync(`git ${input.args}`, {
        cwd,
        timeout: 30000,
        maxBuffer: 2 * 1024 * 1024,
        encoding: 'utf-8',
      });
      return { success: true, output: stdout?.slice(0, 30000) || '' };
    } catch (err) {
      return {
        success: false,
        output: (err.stdout || '').slice(0, 10000),
        error: (err.stderr || err.message || '').slice(0, 5000),
      };
    }
  },

  search_files(input, config) {
    const fullPath = resolvePath(input.path, config);
    let cmd = `grep -rn "${input.pattern.replace(/"/g, '\\"')}" "${fullPath}"`;
    if (input.file_glob) cmd += ` --include="${input.file_glob}"`;
    cmd += ' 2>/dev/null | head -100';
    try {
      const stdout = execSync(cmd, {
        timeout: 15000,
        maxBuffer: 2 * 1024 * 1024,
        encoding: 'utf-8',
      });
      return { success: true, matches: stdout.trim().slice(0, 30000) };
    } catch {
      return { success: true, matches: '' };
    }
  },

  // Terminal signals — these don't "execute" anything, the agent loop handles them
  task_complete(input) { return { success: true, signal: 'COMPLETE', summary: input.summary }; },
  task_failed(input) { return { success: true, signal: 'FAILED', reason: input.reason, attempted: input.attempted }; },
};

/**
 * Execute a tool by name.
 * @returns {Promise<object>} Result object
 */
export async function executeTool(name, input, config) {
  const executor = executors[name];
  if (!executor) return { success: false, error: `Unknown tool: ${name}` };
  try {
    const result = await executor(input, config);
    return result;
  } catch (err) {
    return { success: false, error: err.message };
  }
}
