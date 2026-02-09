# DigiMod AI — Autonomous Agent v3.0

**Deterministic-First Architecture: 80–95% of tasks execute with zero model inference.**

## The Architecture

```
User Input
  → Intent Classifier (deterministic — regex + keyword scoring)
      ├─ Known task type, high confidence → Deterministic execution
      └─ Unknown/ambiguous → Model fallback (Ollama/Claude)
  → Task Planner (deterministic — decision tree)
  → Tool Executor (deterministic — direct function calls)
  → Output Validator (deterministic — rules engine)
  → Response Generator (template-based or model-assisted)
```

### Why?

Production evidence from Salesforce ($500M ARR), Brain Co., and 1,200+ deployments shows most agent tasks don't need a model at all. File operations, shell commands, git operations, HTTP requests, search, and validation are all deterministic. The model is only needed for genuinely ambiguous tasks.

See `RESEARCH-deterministic-agents.md` for the full evidence base.

## Versions

| Version | Architecture | Model Required | Entry Point |
|---------|-------------|---------------|-------------|
| v1.0 | Cloud-only (Claude API) | Always | `src/index.js` |
| v2.0 | Multi-provider (Ollama/OpenAI/Claude) | Always | `src/index.js --provider ollama` |
| **v3.0** | **Deterministic-first + model fallback** | **Only when needed** | **`src/v3.js`** |

## Quick Start

```bash
# Pure deterministic mode (no model, no API costs)
node src/v3.js

# With Ollama fallback for ambiguous tasks
node src/v3.js --provider ollama

# With Claude fallback
node src/v3.js --provider claude

# Classify a single input
node src/v3.js --analyse "read file src/agent.js"

# Run classifier benchmark
node src/v3.js --benchmark --verbose
```

## REPL Commands

| Command | Action |
|---------|--------|
| `/metrics` | Show deterministic vs model-assisted counts |
| `/trace` | Toggle execution trace |
| `/classify X` | Classify input without executing |
| `/quit` | Exit with final metrics |

## Benchmark: 23/23 (100%)

Deterministic accuracy: 18/18 known task types correctly classified.

## File Structure

```
src/
├── v3.js           # v3.0 — deterministic-first entry point
├── classifier.js   # Intent classifier — pattern + keyword scoring
├── orchestrator.js # Workflow state machine — execution lifecycle
├── tools.js        # Tool executors — file I/O, shell, HTTP, git, search
├── providers.js    # Model providers — Ollama, OpenAI-compat, Claude
├── config.js       # Configuration
├── logger.js       # Structured logging
├── agent.js        # v2.0 model-driven agent loop
└── index.js        # v1.0/v2.0 CLI entry point
```

## How It Works

1. **Classify** — Pattern matching scores input against 10 task types
2. **Plan** — Decision tree maps intent to tool calls (no model for known tasks)
3. **Execute** — Direct function calls (fs, child_process, http)
4. **Validate** — Rule-based output checking
5. **Respond** — Templates for known outcomes, model only for novel responses
6. **Fallback** — Model invoked only when confidence < 0.4 or no pattern match

## Research

Full evidence base in `RESEARCH-deterministic-agents.md` covering Salesforce Agentforce pivot, Brain Co. rules engines, ZenML production patterns, neurosymbolic AI, and agent distillation research.

---

*DigiMod AI — Perth, WA — Agent v3.0*
