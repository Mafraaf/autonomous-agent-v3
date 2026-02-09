/**
 * Deterministic Workflow Orchestrator v3.0
 * 
 * State machine that manages task execution lifecycle.
 * Executes tool calls deterministically — model invoked ONLY when
 * the classifier or planner explicitly requires it.
 * 
 * Architecture:
 *   User Input → Classifier (deterministic) → Planner (deterministic)
 *     → Orchestrator (this) → Tool Executors (deterministic)
 *     → Validation (deterministic) → Response (template or model)
 */

import { classify, planFromIntent } from './classifier.js';

// Workflow states
const STATES = {
  INIT: 'init',
  CLASSIFYING: 'classifying',
  PLANNING: 'planning',
  EXECUTING: 'executing',
  VALIDATING: 'validating',
  MODEL_FALLBACK: 'model_fallback',
  RESPONDING: 'responding',
  COMPLETE: 'complete',
  ERROR: 'error',
};

// Validation rules — deterministic output checks
const VALIDATORS = {
  file_read: (result) => {
    if (!result || result.error) return { valid: false, reason: result?.error || 'no_result' };
    return { valid: true };
  },
  file_write: (result) => {
    if (!result || result.error) return { valid: false, reason: result?.error || 'write_failed' };
    return { valid: true };
  },
  file_edit: (result) => {
    if (!result || result.error) return { valid: false, reason: result?.error || 'edit_failed' };
    return { valid: true };
  },
  shell_command: (result) => {
    if (!result) return { valid: false, reason: 'no_result' };
    if (result.exitCode !== 0 && result.exitCode !== undefined) {
      return { valid: false, reason: `exit_code_${result.exitCode}`, stderr: result.stderr };
    }
    return { valid: true };
  },
  http_request: (result) => {
    if (!result) return { valid: false, reason: 'no_result' };
    if (result.status >= 400) return { valid: false, reason: `http_${result.status}` };
    return { valid: true };
  },
  search: (result) => {
    if (!result) return { valid: false, reason: 'no_result' };
    return { valid: true };
  },
  default: (result) => {
    if (!result || result.error) return { valid: false, reason: result?.error || 'unknown_error' };
    return { valid: true };
  },
};

// Response templates — deterministic response generation for known outcomes
const RESPONSE_TEMPLATES = {
  file_read: {
    success: (result, plan) => `Contents of \`${plan.steps[0]?.args?.path || 'file'}\`:\n\n${result.content || result}`,
    error: (result, plan) => `Failed to read \`${plan.steps[0]?.args?.path || 'file'}\`: ${result.error || result.reason || 'unknown error'}`,
  },
  file_write: {
    success: (result, plan) => `✓ File written: \`${plan.steps[0]?.args?.path || 'file'}\``,
    error: (result, plan) => `✗ Failed to write \`${plan.steps[0]?.args?.path || 'file'}\`: ${result.error || 'unknown error'}`,
  },
  shell_command: {
    success: (result, plan) => {
      const cmd = plan.steps[0]?.args?.command || 'command';
      const output = result.stdout || result.output || '';
      return `\`${cmd}\` completed successfully${output ? ':\n\n' + output : '.'}`;
    },
    error: (result, plan) => {
      const cmd = plan.steps[0]?.args?.command || 'command';
      return `\`${cmd}\` failed (exit ${result.exitCode}):\n${result.stderr || result.error || 'unknown error'}`;
    },
  },
  http_request: {
    success: (result) => `HTTP ${result.status || 200} OK:\n\n${typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2)}`,
    error: (result) => `HTTP request failed: ${result.status || 'error'} — ${result.error || result.statusText || 'unknown'}`,
  },
  search: {
    success: (result) => {
      if (Array.isArray(result.matches) && result.matches.length > 0) {
        return `Found ${result.matches.length} match(es):\n\n${result.matches.map(m => `  ${m.file}:${m.line}: ${m.text}`).join('\n')}`;
      }
      return `Search complete: ${result.count || 0} results found.`;
    },
    error: (result) => `Search failed: ${result.error || 'unknown error'}`,
  },
  default: {
    success: (result) => `Task completed successfully.${result ? '\n\n' + JSON.stringify(result, null, 2) : ''}`,
    error: (result) => `Task failed: ${result?.error || result?.reason || 'unknown error'}`,
  },
};

class WorkflowOrchestrator {
  constructor(executeToolFn, modelProvider = null, options = {}) {
    this.executeTool = executeToolFn; // function(name, args) => result
    this.model = modelProvider; // null = fully deterministic mode
    this.confidenceThreshold = options.confidenceThreshold || 0.4;
    this.maxRetries = options.maxRetries || 2;
    this.logger = options.logger || console;

    // Metrics tracking
    this.metrics = {
      totalTasks: 0,
      deterministicTasks: 0,
      modelFallbacks: 0,
      modelCallsForPlanning: 0,
      modelCallsForResponse: 0,
      errors: 0,
      byIntent: {},
    };
  }

  /**
   * Process a user input through the full deterministic pipeline.
   * Returns { response, metrics, trace }
   */
  async process(input) {
    this.metrics.totalTasks++;
    const trace = [];
    let state = STATES.INIT;

    try {
      // ── CLASSIFY (deterministic) ──────────────────────────────────
      state = STATES.CLASSIFYING;
      const classification = classify(input, this.confidenceThreshold);
      trace.push({
        state,
        intent: classification.intent,
        confidence: classification.confidence,
        needsModel: classification.needsModel,
        reason: classification.reason,
      });

      this._trackIntent(classification.intent);

      // If classifier can't determine intent, fall back to model
      if (classification.needsModel && classification.reason === 'no_pattern_match') {
        return await this._modelFallback(input, classification, trace);
      }

      // ── PLAN (deterministic where possible) ───────────────────────
      state = STATES.PLANNING;
      const plan = planFromIntent(classification, input);
      trace.push({
        state,
        steps: plan.steps.length,
        requiresModel: plan.requiresModelForPlanning,
      });

      // If plan needs model (e.g., generating file content, composing commands)
      if (plan.requiresModelForPlanning) {
        if (!this.model) {
          // No model available — return what we can
          return {
            response: `I identified this as a "${classification.intent}" task, but I need a model to complete the planning. ` +
              `Run with --provider ollama or --provider claude to enable model-assisted planning.`,
            metrics: this._snapshot(),
            trace,
            deterministic: false,
          };
        }

        this.metrics.modelCallsForPlanning++;
        const modelPlan = await this._modelAssistPlan(input, classification, plan);
        trace.push({ state: 'model_plan_assist', modelSteps: modelPlan.steps?.length || 0 });

        // Execute model-assisted plan through the standard agent loop
        return await this._executeModelPlan(input, modelPlan, classification, trace);
      }

      // ── EXECUTE (deterministic) ───────────────────────────────────
      state = STATES.EXECUTING;
      const results = [];

      for (const step of plan.steps) {
        try {
          const result = await this.executeTool(step.tool, step.args);
          results.push({ tool: step.tool, args: step.args, result, success: true });
        } catch (err) {
          results.push({ tool: step.tool, args: step.args, error: err.message, success: false });
        }
      }

      trace.push({ state, stepsExecuted: results.length, successes: results.filter(r => r.success).length });

      // ── VALIDATE (deterministic) ──────────────────────────────────
      state = STATES.VALIDATING;
      const validator = VALIDATORS[classification.intent] || VALIDATORS.default;
      const lastResult = results[results.length - 1];
      const validation = validator(lastResult?.result || lastResult);
      trace.push({ state, valid: validation.valid, reason: validation.reason });

      // ── RESPOND (template-based, no model) ────────────────────────
      state = STATES.RESPONDING;
      const templates = RESPONSE_TEMPLATES[classification.intent] || RESPONSE_TEMPLATES.default;
      const response = validation.valid
        ? templates.success(lastResult?.result || lastResult, plan)
        : templates.error({ ...lastResult, ...validation }, plan);

      this.metrics.deterministicTasks++;

      return {
        response,
        metrics: this._snapshot(),
        trace,
        deterministic: true,
        classification,
        results,
      };

    } catch (err) {
      this.metrics.errors++;
      return {
        response: `Error in ${state}: ${err.message}`,
        metrics: this._snapshot(),
        trace,
        deterministic: false,
        error: err.message,
      };
    }
  }

  /**
   * Full model fallback — used when deterministic pipeline can't handle the task
   */
  async _modelFallback(input, classification, trace) {
    this.metrics.modelFallbacks++;

    if (!this.model) {
      return {
        response: `I couldn't classify this task deterministically (confidence: ${classification.confidence.toFixed(2)}). ` +
          `Enable a model provider (--provider ollama or --provider claude) for general-purpose tasks.`,
        metrics: this._snapshot(),
        trace,
        deterministic: false,
      };
    }

    trace.push({ state: STATES.MODEL_FALLBACK, reason: 'classifier_no_match' });

    // Delegate to the full agentic loop (v2.0 agent)
    const result = await this.model.processAgentLoop(input);

    this.metrics.modelCallsForResponse++;

    return {
      response: result.response || result,
      metrics: this._snapshot(),
      trace,
      deterministic: false,
      modelUsed: true,
    };
  }

  /**
   * Model-assisted planning — model fills in the gaps the deterministic planner can't
   */
  async _modelAssistPlan(input, classification, partialPlan) {
    const systemPrompt = `You are a task planner. Given the user's request and a partial plan, fill in the missing details.
The task type is: ${classification.intent}
Available tools: ${classification.tools.join(', ')}
Partial plan steps: ${JSON.stringify(partialPlan.steps)}

Respond with ONLY a JSON object containing the complete plan:
{
  "steps": [
    { "tool": "tool_name", "args": { ... } }
  ]
}`;

    try {
      const response = await this.model.complete(systemPrompt, input);
      const json = response.match(/\{[\s\S]*\}/)?.[0];
      if (json) {
        return JSON.parse(json);
      }
    } catch (err) {
      this.logger.warn(`Model plan assist failed: ${err.message}`);
    }

    return partialPlan;
  }

  /**
   * Execute a model-generated plan through tool executors
   */
  async _executeModelPlan(input, plan, classification, trace) {
    const results = [];

    for (const step of (plan.steps || [])) {
      try {
        const result = await this.executeTool(step.tool, step.args);
        results.push({ tool: step.tool, args: step.args, result, success: true });
      } catch (err) {
        results.push({ tool: step.tool, args: step.args, error: err.message, success: false });
      }
    }

    trace.push({ state: STATES.EXECUTING, modelAssisted: true, steps: results.length });

    // Use template if available, otherwise ask model for response
    const templates = RESPONSE_TEMPLATES[classification.intent] || RESPONSE_TEMPLATES.default;
    const lastResult = results[results.length - 1];
    const response = lastResult?.success
      ? templates.success(lastResult.result || lastResult, plan)
      : templates.error(lastResult || { error: 'no results' }, plan);

    return {
      response,
      metrics: this._snapshot(),
      trace,
      deterministic: false,
      modelUsedForPlanning: true,
      results,
    };
  }

  /**
   * Track intent distribution for metrics
   */
  _trackIntent(intent) {
    this.metrics.byIntent[intent] = (this.metrics.byIntent[intent] || 0) + 1;
  }

  /**
   * Return current metrics snapshot
   */
  _snapshot() {
    const total = this.metrics.totalTasks || 1;
    return {
      ...this.metrics,
      deterministicRate: ((this.metrics.deterministicTasks / total) * 100).toFixed(1) + '%',
      modelFallbackRate: ((this.metrics.modelFallbacks / total) * 100).toFixed(1) + '%',
    };
  }

  /**
   * Print metrics summary
   */
  printMetrics() {
    const m = this._snapshot();
    return [
      `\n═══ ORCHESTRATOR METRICS ═══`,
      `Total tasks:        ${m.totalTasks}`,
      `Deterministic:      ${m.deterministicTasks} (${m.deterministicRate})`,
      `Model fallbacks:    ${m.modelFallbacks} (${m.modelFallbackRate})`,
      `  - For planning:   ${m.modelCallsForPlanning}`,
      `  - For response:   ${m.modelCallsForResponse}`,
      `Errors:             ${m.errors}`,
      `Intent distribution: ${JSON.stringify(m.byIntent, null, 2)}`,
      `═══════════════════════════\n`,
    ].join('\n');
  }
}

export { WorkflowOrchestrator, STATES, VALIDATORS, RESPONSE_TEMPLATES };
