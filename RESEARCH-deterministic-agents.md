# Deterministic Agent Architecture: Eliminating Model Dependencies

**Research Synthesis — February 2026**
**DigiMod AI — Mr Fisher**

---

## Executive Summary

This document synthesises production evidence and academic research on replacing LLM inference with deterministic code in autonomous agent systems. The core finding: **80–95% of what agents do can be compiled to deterministic code that runs without any model at all**. The remaining 5–20% — genuine ambiguity, novel intent parsing, creative synthesis — is where models remain necessary.

This isn't theoretical. Salesforce's Agentforce ($500M ARR, 12,000 customers), Amazon's warehouse robotics, and regulated-industry deployments at Brain Co. are all shipping hybrid architectures that minimise model surface area.

---

## The Industry Reckoning (2025–2026)

### The Numbers

- **42%** of companies abandoned majority of AI initiatives in 2025, up from 17% in 2024 (S&P Global)
- Only **5%** achieve AI value at scale (BCG, 1,250 firms surveyed)
- 89% piloting generative AI, but only **15%** at enterprise scale
- Forrester projects GenAI will orchestrate **<1%** of core business processes in 2025; rule-based systems and RPA still do the heavy lifting

### Salesforce's Public Admission

Salesforce — the largest enterprise AI agent vendor — publicly acknowledged LLMs cannot reliably carry enterprise workloads:

> "We had more trust in the LLM a year ago" — Sanjna Parulekar, SVP Product Marketing

Key problems discovered:
- LLMs start **omitting instructions** when given >8 directives
- Surveys randomly not sent despite clear instructions
- Non-deterministic behaviour in business-critical processes

Their pivot: **hybrid reasoning** combining deterministic workflows (Flows, Apex, APIs) with LLM flexibility only for conversational tasks. The Agent Graph + Agent Script architecture lets developers specify exactly which workflow parts are rule-based vs LLM-driven.

**Source:** engineering.salesforce.com, salesforce.com/agentforce/five-levels-of-determinism

---

## Three-Tier Architecture for Eliminating Model Dependency

### Tier 1: LLM-Generated Rules Engines (Compile Once, Run Forever)

**Production implementation by Brain Co. for regulated industries (insurance, healthcare, compliance).**

Process:
1. Use LLM **once** to extract MECE (Mutually Exclusive, Collectively Exhaustive) IF-THEN rules from unstructured policy documents
2. Store rules as deterministic code (Python, JavaScript, decision trees)
3. Execute rules engine forever — zero inference cost, zero hallucinations, 100% auditable

Key findings:
- LLMs generated **more rules** than human experts and with **better single-shot accuracy**
- Segment documents into manageable chunks (LLM performance degrades with too many rules at once)
- Use Instructor + Pydantic for schema enforcement on LLM outputs
- Validate rules via exact/fuzzy matching against human expert labels

> "The nondeterministic nature of LLMs makes it challenging to achieve accuracy needed for critical decisions. Instead, what we need is business logic or a decision tree: rules that are mutually exclusive and collectively exhaustive."

**Production use cases:** insurance policy compliance, healthcare care pathway validation, financial fraud detection, legal document analysis.

**Source:** brain.co/blog — "LLM-Generated Rules Engines"

### Tier 2: Context Distillation Pipelines (Deterministic Preprocessing)

**Brain Co.'s EHR analysis: deterministic pipeline consistently outperformed latest agent frameworks on accuracy, latency, and cost.**

Architecture:
1. **Evidence Gathering (Pruning):** Deterministic extraction of relevant data types (lab values, medications, diagnosis codes)
2. **Normalise and Structure:** Token-set matching for medications, temporal fallbacks, category-specific limits
3. **Pass Pruned Context to Model:** Clean, compact input → deterministic decisions, minimised search space

Result: Split problem into two independently reviewable tasks:
- Evidence gathering: Is pruning comprehensive and concise? (Deterministic — reviewable, testable)
- Diagnosis: Can model make correct determination given proper evidence? (Minimal LLM surface area)

Performance finding: Agentic tool-use approaches **plateaued much earlier** than context distillation. Agents excel when external retrieval is needed; deterministic pipelines win when all information is already present.

**Source:** brain.co/blog — "When Deterministic Pipelines Outperform Agentic Wandering"

### Tier 3: Neurosymbolic AI (Hybrid Architecture)

Combines neural networks (pattern recognition, learning from raw data) with symbolic reasoning (logic, rules, knowledge graphs).

Key architectures:
- **NeuroSymbolicLoss:** Symbolic rules incorporated into loss function during training
- **Logic Tensor Networks (LTNs):** Implement fuzzy logic operations via t-norms and real-valued logic gates
- **Scallop:** Neurosymbolic programming language combining Datalog-based logic with differentiable reasoning

Production implementations:
- **Amazon:** Vulcan warehouse robots + Rufus shopping assistant (2025)
- **Salesforce:** Agent Graph runtime marries LLM intelligence with deterministic control
- **OpenAI:** Uses Temporal for Codex (durable execution for AI coding agents)

**Sources:** IEEE Xplore — "Neurosymbolic AI for Reasoning Over Knowledge Graphs: A Survey"; MDPI Mathematics — "AI Reasoning in Deep Learning Era"

---

## What CAN Be Compiled to Deterministic Code

Based on production deployments:

| Domain | Deterministic Approach | Model Needed? |
|--------|----------------------|---------------|
| Task decomposition (known domains) | State machines, workflow graphs | No |
| Tool selection by task type | Decision trees, pattern matching | No |
| Workflow orchestration | State machines, dependency graphs | No |
| File operations, API calls, git | Direct code execution | No |
| Validation & compliance | Rule engines, schema validators | No |
| Template-based generation | String interpolation, document assembly | No |
| Classification (fixed criteria) | Decision trees, lookup tables | No |
| Pattern recognition (structured data) | Statistical rules, threshold engines | No |
| Fraud detection | Velocity checks, geolocation rules, blocklists | No |

## What STILL Needs the Model

| Domain | Why Deterministic Fails | Model Role |
|--------|------------------------|------------|
| Parsing ambiguous user intent | Natural language is unbounded | Intent classification |
| Novel requests outside rule patterns | Can't precompile unknown | Fallback reasoning |
| Semantic understanding of unstructured text | Context-dependent meaning | NLU |
| Creative synthesis & content generation | Requires generative capability | Text generation |
| Edge cases outside training distribution | Rules can't cover unknowns | Adaptive reasoning |

---

## The Hybrid Execution Pattern

```
User Input
  → Intent Parser
      ├─ Clear/known pattern? → Deterministic classifier (rules)
      └─ Ambiguous/novel?    → Model inference (minimal)
  → Task Router (deterministic decision tree)
  → Workflow Orchestrator (deterministic state machine)
  → Tool Executors (deterministic code)
  → Validation Engine (deterministic rules)
  → Response Generator
      ├─ Structured output? → Templates
      └─ Natural language?  → Model or templates
```

### Salesforce's Five Levels of Determinism

1. **Thoughtful Design** — Clear agent instructions, well-defined scope
2. **Data Grounding** — RAG with reasoning engine generating answers directly from retrieved data
3. **State Management** — Explicit persistent states, conversation tracking, goal anchoring
4. **Structured Workflows** — Agent Graph decomposes complex workflows into focused subagents
5. **Deterministic Execution** — Flows, Apex, APIs for rigid, unvarying execution

Principle: *"Let the model improvise around the edges of experience but keep core flows under explicit control."*

---

## Production Patterns from 1,200 LLM Deployments (ZenML 2025)

Key findings:
- Traditional ML models govern **when/whether** LLMs are invoked at all
- **DoorDash:** "Zero-Data Statistical Query Validation" — automated linting, EXPLAIN-based checking, statistical metadata checks WITHOUT exposing sensitive data to AI
- **Ramp:** "Autonomy slider" combines LLM decisions with deterministic rules (dollar limits, vendor blocklists, category restrictions)
- Pattern: **Safety logic moved OUT of prompts and INTO infrastructure**

**Source:** zenml.io/blog — "What 1,200 Production Deployments Reveal About LLMOps in 2025"

---

## Implementation Strategy for DigiMod AI Agent v3.0

### Phase 1: Compile Domain Knowledge

Use LLM **once** to extract deterministic rules from:
- Task type patterns → decision tree for routing
- Tool selection criteria → lookup table
- Validation rules → schema + threshold engine
- Error handling patterns → retry/fallback state machine

### Phase 2: Build Deterministic Engine

- **Intent Classifier:** Pattern matching + keyword extraction for known task types
- **Task Router:** Decision tree mapping intents to workflow templates
- **Workflow Orchestrator:** State machine managing task execution lifecycle
- **Tool Executors:** Direct function calls (file ops, shell, HTTP, git)
- **Validation Engine:** Schema validation, output checks, compliance rules

### Phase 3: Minimise Model Surface Area

Model invoked **only** when:
- Intent classifier confidence < threshold (ambiguous input)
- Task type not in known patterns (novel request)
- Output requires natural language generation (not template-fillable)

### Phase 4: Measure & Optimise

- Track % of tasks resolved without model inference
- Identify new patterns that can be compiled to rules
- Continuously shrink model dependency surface area

---

## Key Citations

| Source | Title | URL |
|--------|-------|-----|
| Brain Co. | LLM-Generated Rules Engines | brain.co/blog |
| Brain Co. | When Deterministic Pipelines Outperform Agentic Wandering | brain.co/blog |
| Salesforce | Agentforce Agent Graph: Toward Guided Determinism | engineering.salesforce.com |
| Salesforce | Five Levels of Determinism | salesforce.com/agentforce |
| ZenML | What 1,200 Production Deployments Reveal | zenml.io/blog |
| Mario Thomas | The Return of Traditional AI (Dec 2025) | mariothomas.com |
| arXiv | Blueprint First, Model Second | arxiv.org/pdf/2508.02721 |
| Thinking Machines | Defeating Nondeterminism in LLM Inference (Nov 2025) | thinkingmachines.ai/blog |
| LMSYS | Towards Deterministic Inference in SGLang | lmsys.org/blog |
| IEEE | Neurosymbolic AI for Reasoning Over Knowledge Graphs | ieeexplore.ieee.org |
| MDPI | AI Reasoning in Deep Learning Era | mdpi.com/2227-7390/13/11/1707 |

---

*Document version: 1.0 — 2026-02-09*
*Next review: When v3.0 deterministic engine performance data is available*
