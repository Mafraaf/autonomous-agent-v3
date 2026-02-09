/**
 * Deterministic Intent Classifier v3.0
 * 
 * Classifies user intent using pattern matching, keyword extraction,
 * and decision trees — NO model inference required for known task types.
 * 
 * Falls back to model only when confidence < threshold.
 */

// Task type definitions — compiled from domain knowledge
const TASK_TYPES = {
  FILE_READ: {
    id: 'file_read',
    patterns: [
      /\bread\b.*\bfile\b/i,
      /\bshow\b.*\b(contents?|file|code)\b/i,
      /\bcat\b\s+\S+/i,
      /\bview\b.*\b(file|source|code)\b/i,
      /\bopen\b.*\b(file|document)\b/i,
      /\bdisplay\b.*\b(file|contents?)\b/i,
      /\bwhat('?s| is) in\b.*\b(file|folder|directory)\b/i,
      /\blist\b.*\b(files?|directory|folder|dir)\b/i,
      /\bls\b\s/i,
    ],
    keywords: ['read', 'show', 'view', 'cat', 'display', 'contents', 'open', 'list', 'ls', 'dir'],
    tools: ['read_file', 'list_directory'],
    confidence_boost: 0.1, // boost when file path detected
  },

  FILE_WRITE: {
    id: 'file_write',
    patterns: [
      /\b(create|write|save|make)\b.*\bfile\b/i,
      /\bwrite\b.*\bto\b/i,
      /\bsave\b.*\b(as|to)\b/i,
      /\bcreate\b.*\b(file|script|module|component)\b/i,
      /\bgenerate\b.*\b(file|code|script)\b/i,
      /\badd\b.*\bfile\b/i,
      /\bnew\b.*\b(file|script)\b/i,
    ],
    keywords: ['create', 'write', 'save', 'generate', 'new file', 'make file'],
    tools: ['create_file'],
    confidence_boost: 0.1,
  },

  FILE_EDIT: {
    id: 'file_edit',
    patterns: [
      /\b(edit|modify|update|change|fix|patch|refactor)\b.*\b(file|code|function|class|line)\b/i,
      /\b(edit|fix|modify|update|patch)\b\s+\S+\.\w+/i,  // edit/fix + filename
      /\b(fix|debug)\b.*\b(bug|issue|error|problem)\b.*\b(in)\b/i,
      /\breplace\b.*\b(in|with)\b/i,
      /\binsert\b.*\b(into|at|before|after)\b/i,
      /\bremove\b.*\b(from|line|function)\b/i,
      /\bdelete\b.*\b(line|function|block)\b/i,
      /\bappend\b.*\bto\b/i,
    ],
    keywords: ['edit', 'modify', 'update', 'change', 'fix', 'refactor', 'replace', 'insert', 'append'],
    tools: ['edit_file', 'read_file'],
    confidence_boost: 0.2,
  },

  SHELL_COMMAND: {
    id: 'shell_command',
    patterns: [
      /\brun\b.*\b(command|script|npm|node|python|bash|shell)\b/i,
      /\bexecute\b/i,
      /\binstall\b.*\b(package|dependency|module|npm|pip)\b/i,
      /\bnpm\b\s+(install|run|start|test|build|init|publish|audit)/i,
      /\bpip\b\s+install/i,
      /\bgit\b\s+(clone|pull|push|commit|status|log|diff|branch|checkout)/i,
      /\bdocker\b\s+(build|run|compose|pull|push)/i,
      /\bcurl\b\s/i,
      /\bwget\b\s/i,
      /\bchmod\b/i,
      /\bmkdir\b/i,
      /\bnpx\b\s/i,
    ],
    keywords: ['run', 'execute', 'install', 'npm', 'pip', 'git', 'docker', 'curl', 'bash', 'shell', 'command'],
    tools: ['run_command'],
    confidence_boost: 0.2, // high boost — shell commands are very distinctive
  },

  HTTP_REQUEST: {
    id: 'http_request',
    patterns: [
      /\b(fetch|get|post|put|delete|patch)\b.*\b(api|endpoint|url|http)/i,
      /\bcall\b.*\b(api|endpoint|service)\b/i,
      /\brequest\b.*\b(to|from)\b.*\b(api|url|http)/i,
      /\bhttp[s]?:\/\//i,
      /\bapi\b.*\b(call|request|fetch)\b/i,
      /\bwebhook\b/i,
    ],
    keywords: ['fetch', 'api', 'endpoint', 'request', 'http', 'url', 'webhook', 'REST'],
    tools: ['http_request'],
    confidence_boost: 0.15,
  },

  CODE_ANALYSIS: {
    id: 'code_analysis',
    patterns: [
      /\b(analyse|analyze|review|inspect|audit|lint|check)\b.*\b(code|file|function|module|project)\b/i,
      /\bfind\b.*\b(bugs?|issues?|errors?|problems?)\b/i,
      /\bcode\b.*\b(review|quality|smell)\b/i,
      /\bwhat\b.*\b(does|is)\b.*\b(this|the)\b.*\b(code|function|class)\b/i,
      /\bexplain\b.*\b(code|function|class|module)\b/i,
      /\bdebug\b/i,
    ],
    keywords: ['analyse', 'review', 'inspect', 'audit', 'lint', 'debug', 'explain code', 'code review'],
    tools: ['read_file', 'search_files', 'run_command'],
    confidence_boost: 0.05,
  },

  PROJECT_SCAFFOLD: {
    id: 'project_scaffold',
    patterns: [
      /\b(scaffold|bootstrap|initialise|initialize|setup|set up|start)\b.*\b(project|app|application|repo|repository)\b/i,
      /\bnew\b.*\b(project|app|application)\b/i,
      /\bcreate\b.*\b(project|app|application|repo)\b/i,
      /\binit\b/i,
    ],
    keywords: ['scaffold', 'bootstrap', 'initialise', 'setup', 'new project', 'create app', 'init'],
    tools: ['run_command', 'create_file', 'run_command'],
    confidence_boost: 0.1,
  },

  SEARCH: {
    id: 'search',
    patterns: [
      /\b(search|find|grep|look for|locate)\b.*\b(in|for|across)\b/i,
      /\bwhere\b.*\b(is|are|does)\b/i,
      /\bgrep\b/i,
      /\bfind\b.*\b(file|function|class|variable|string|text|pattern)\b/i,
    ],
    keywords: ['search', 'find', 'grep', 'locate', 'where is'],
    tools: ['search_files', 'run_command'],
    confidence_boost: 0.1,
  },

  TESTING: {
    id: 'testing',
    patterns: [
      /\b(test|spec|assert|verify|validate)\b/i,
      /\brun\b.*\btests?\b/i,
      /\bwrite\b.*\b(test|spec)\b/i,
      /\bunit\s*test/i,
      /\bintegration\s*test/i,
      /\bcoverage\b/i,
    ],
    keywords: ['test', 'spec', 'assert', 'verify', 'coverage', 'unit test', 'integration test'],
    tools: ['run_command', 'create_file', 'read_file'],
    confidence_boost: 0.1,
  },

  DEPLOYMENT: {
    id: 'deployment',
    patterns: [
      /\b(deploy|release|publish|ship|push to)\b.*\b(production|staging|server|cloud|npm|docker)\b/i,
      /\bbuild\b.*\b(for|and)\b.*\b(production|deploy)/i,
      /\bci\/?cd\b/i,
      /\bpipeline\b/i,
    ],
    keywords: ['deploy', 'release', 'publish', 'ship', 'production', 'staging', 'CI/CD', 'pipeline'],
    tools: ['run_command', 'create_file'],
    confidence_boost: 0.1,
  },
};

// File path detection regex
const FILE_PATH_PATTERN = /(?:^|\s)((?:\.{0,2}\/)?(?:[\w.-]+\/)*[\w.-]+\.[\w]+)(?:\s|$)/;
const ABSOLUTE_PATH_PATTERN = /(?:^|\s)(\/(?:[\w.-]+\/)*[\w.-]+)(?:\s|$)/;
const URL_PATTERN = /https?:\/\/[^\s]+/i;

/**
 * Extract structured entities from user input — deterministic, no model needed
 */
function extractEntities(input) {
  const entities = {
    filePaths: [],
    urls: [],
    commands: [],
    packages: [],
    gitOps: [],
  };

  // Extract file paths
  const relMatches = input.match(new RegExp(FILE_PATH_PATTERN, 'g'));
  const absMatches = input.match(new RegExp(ABSOLUTE_PATH_PATTERN, 'g'));
  if (relMatches) entities.filePaths.push(...relMatches.map(m => m.trim()));
  if (absMatches) entities.filePaths.push(...absMatches.map(m => m.trim()));

  // Extract URLs
  const urlMatches = input.match(new RegExp(URL_PATTERN, 'g'));
  if (urlMatches) entities.urls.push(...urlMatches);

  // Extract npm/pip packages
  const npmMatch = input.match(/npm\s+install\s+([\w@/.-]+(?:\s+[\w@/.-]+)*)/i);
  const pipMatch = input.match(/pip\s+install\s+([\w.-]+(?:\s+[\w.-]+)*)/i);
  if (npmMatch) entities.packages.push(...npmMatch[1].split(/\s+/));
  if (pipMatch) entities.packages.push(...pipMatch[1].split(/\s+/));

  // Extract git operations
  const gitMatch = input.match(/git\s+(clone|pull|push|commit|status|log|diff|branch|checkout|merge|rebase|stash|tag)(?:\s+(.+?))?(?:\s*$)/i);
  if (gitMatch) {
    entities.gitOps.push({
      operation: gitMatch[1].toLowerCase(),
      args: gitMatch[2] ? gitMatch[2].trim() : '',
    });
  }

  return entities;
}

/**
 * Score each task type against the input — deterministic scoring
 */
function scoreTaskTypes(input) {
  const scores = [];
  const inputLower = input.toLowerCase();
  const entities = extractEntities(input);

  for (const [typeName, taskType] of Object.entries(TASK_TYPES)) {
    let score = 0;
    let matchedPatterns = 0;
    let matchedKeywords = 0;

    // Pattern matching (strongest signal — each pattern match = 0.3)
    for (const pattern of taskType.patterns) {
      if (pattern.test(input)) {
        score += 0.3;
        matchedPatterns++;
      }
    }

    // Keyword matching (weaker signal — each keyword = 0.1)
    for (const keyword of taskType.keywords) {
      if (inputLower.includes(keyword.toLowerCase())) {
        score += 0.1;
        matchedKeywords++;
      }
    }

    // Entity-based confidence boost
    if (entities.filePaths.length > 0 && ['file_read', 'file_write', 'file_edit', 'code_analysis'].includes(taskType.id)) {
      score += taskType.confidence_boost;
    }
    if (entities.urls.length > 0 && taskType.id === 'http_request') {
      score += taskType.confidence_boost;
    }
    if (entities.gitOps.length > 0 && taskType.id === 'shell_command') {
      score += taskType.confidence_boost;
    }
    if (entities.packages.length > 0 && taskType.id === 'shell_command') {
      score += taskType.confidence_boost;
    }

    // Normalise to 0–1 range (cap at 1.0)
    const confidence = Math.min(score, 1.0);

    if (confidence > 0) {
      scores.push({
        taskType: taskType.id,
        confidence,
        matchedPatterns,
        matchedKeywords,
        tools: taskType.tools,
        entities,
      });
    }
  }

  // Sort by confidence descending
  scores.sort((a, b) => b.confidence - a.confidence);
  return scores;
}

/**
 * Classify user intent — deterministic with confidence threshold
 * 
 * Returns { intent, confidence, needsModel, tools, entities }
 */
function classify(input, threshold = 0.4) {
  const scores = scoreTaskTypes(input);

  if (scores.length === 0) {
    return {
      intent: 'unknown',
      confidence: 0,
      needsModel: true,
      reason: 'no_pattern_match',
      tools: [],
      entities: extractEntities(input),
      allScores: [],
    };
  }

  const top = scores[0];

  // High confidence — deterministic classification
  if (top.confidence >= threshold) {
    // Check for ambiguity (top two scores very close)
    const isAmbiguous = scores.length > 1 && (top.confidence - scores[1].confidence) < 0.1;

    return {
      intent: top.taskType,
      confidence: top.confidence,
      needsModel: isAmbiguous, // model needed to disambiguate
      reason: isAmbiguous ? 'ambiguous_top_scores' : 'deterministic_match',
      tools: top.tools,
      entities: top.entities,
      allScores: scores.slice(0, 3), // top 3 for debugging
    };
  }

  // Low confidence — needs model
  return {
    intent: top.taskType,
    confidence: top.confidence,
    needsModel: true,
    reason: 'low_confidence',
    tools: top.tools,
    entities: top.entities,
    allScores: scores.slice(0, 3),
  };
}

/**
 * Generate a deterministic task plan from classified intent
 * Returns ordered list of tool calls to execute
 */
function planFromIntent(classification, input) {
  const { intent, entities } = classification;

  const plan = {
    intent,
    steps: [],
    requiresModelForPlanning: false,
  };

  switch (intent) {
    case 'file_read': {
      const target = entities.filePaths[0] || null;
      if (target) {
        plan.steps.push({ tool: 'read_file', args: { path: target } });
      } else {
        plan.steps.push({ tool: 'list_directory', args: { path: '.' } });
        plan.requiresModelForPlanning = true; // need model to determine which file
      }
      break;
    }

    case 'file_write': {
      const target = entities.filePaths[0] || null;
      if (target) {
        plan.steps.push({ tool: 'create_file', args: { path: target, content: null } });
        plan.requiresModelForPlanning = true; // need model to generate content
      } else {
        plan.requiresModelForPlanning = true; // need model for both path and content
      }
      break;
    }

    case 'file_edit': {
      const target = entities.filePaths[0] || null;
      if (target) {
        plan.steps.push({ tool: 'read_file', args: { path: target } });
        plan.steps.push({ tool: 'edit_file', args: { path: target, edits: null } });
        plan.requiresModelForPlanning = true; // need model to determine edits
      } else {
        plan.requiresModelForPlanning = true;
      }
      break;
    }

    case 'shell_command': {
      // Git operations can be fully deterministic
      if (entities.gitOps.length > 0) {
        const op = entities.gitOps[0];
        plan.steps.push({
          tool: 'run_command',
          args: { command: `git ${op.operation}${op.args ? ' ' + op.args : ''}` },
        });
      }
      // Package installs can be fully deterministic
      else if (entities.packages.length > 0) {
        const isNpm = /npm/i.test(input);
        const cmd = isNpm
          ? `npm install ${entities.packages.join(' ')}`
          : `pip install ${entities.packages.join(' ')}`;
        plan.steps.push({ tool: 'run_command', args: { command: cmd } });
      }
      // Other shell commands need model to compose
      else {
        plan.requiresModelForPlanning = true;
      }
      break;
    }

    case 'http_request': {
      const url = entities.urls[0] || null;
      if (url) {
        const method = /\b(post|put|patch|delete)\b/i.test(input)
          ? input.match(/\b(post|put|patch|delete)\b/i)[1].toUpperCase()
          : 'GET';
        plan.steps.push({
          tool: 'http_request',
          args: { url, method, body: null, headers: {} },
        });
      } else {
        plan.requiresModelForPlanning = true;
      }
      break;
    }

    case 'search': {
      const target = entities.filePaths[0] || '.';
      // Try to extract search term
      const searchMatch = input.match(/(?:search|find|grep|look for|locate)\s+(?:for\s+)?["']?(.+?)["']?\s+(?:in|across|within)/i);
      if (searchMatch) {
        plan.steps.push({
          tool: 'search_files',
          args: { path: target, pattern: searchMatch[1].trim() },
        });
      } else {
        plan.requiresModelForPlanning = true;
      }
      break;
    }

    case 'testing': {
      // "run tests" is deterministic
      if (/\brun\b.*\btests?\b/i.test(input)) {
        plan.steps.push({ tool: 'run_command', args: { command: 'npm test' } });
      } else {
        plan.requiresModelForPlanning = true; // writing tests needs model
      }
      break;
    }

    default:
      plan.requiresModelForPlanning = true;
  }

  return plan;
}

export {
  TASK_TYPES,
  classify,
  extractEntities,
  scoreTaskTypes,
  planFromIntent,
};
