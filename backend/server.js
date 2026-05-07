const express = require("express");
const { execFile } = require("child_process");
const { spawnSync } = require("child_process");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Normalize temp env vars (some systems have trailing spaces).
if (process.env.TEMP) process.env.TEMP = String(process.env.TEMP).trim();
if (process.env.TMP) process.env.TMP = String(process.env.TMP).trim();

app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "../frontend")));

function resolveCompareExecutable() {
  if (process.env.COMPARE_EXE) {
    return process.env.COMPARE_EXE;
  }
  // Default build output path for Windows with Ninja.
  return path.resolve(__dirname, "../build/compare.exe");
}

function resolveClangXXExecutable() {
  if (process.env.CLANGXX) return process.env.CLANGXX;

  // Common default for Windows LLVM installer.
  const defaultPath = "C:\\Program Files\\LLVM\\bin\\clang++.exe";
  try {
    require("fs").accessSync(defaultPath);
    return defaultPath;
  } catch {
    // fall back to PATH
    return "clang++";
  }
}

let cachedVsDevEnv = null;

function getVsDevEnv() {
  if (cachedVsDevEnv) return cachedVsDevEnv;
  const vsDevCmdRaw = process.env.VSDEVCMD;
  if (!vsDevCmdRaw) return null;

  const vsDevCmd = String(vsDevCmdRaw).trim().replace(/^"+|"+$/g, "").replace(/\\"/g, "\"");
  // Capture environment after VsDevCmd initializes MSVC/SDK paths.
  const capture = spawnSync(
    "cmd.exe",
    [
      "/c",
      `call ""${vsDevCmd}"" -no_logo -arch=x64 -host_arch=x64 >nul && set`
    ],
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024, timeout: 60000 }
  );

  if (capture.error) throw capture.error;
  if (capture.status !== 0) {
    throw new Error(
      (capture.stderr || "").trim() ||
        `Failed to initialize VS dev environment (exit ${capture.status}).`
    );
  }

  const env = {};
  for (const line of (capture.stdout || "").split(/\r?\n/)) {
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const k = line.slice(0, idx);
    const v = line.slice(idx + 1);
    env[k] = v;
  }

  if (env.TEMP) env.TEMP = String(env.TEMP).trim();
  if (env.TMP) env.TMP = String(env.TMP).trim();

  cachedVsDevEnv = env;
  return cachedVsDevEnv;
}

async function writeTempCodeFile(code, suffix) {
  const fileName = `compare-${Date.now()}-${Math.random().toString(36).slice(2)}-${suffix}.cpp`;
  // On some Windows setups, %TEMP% can contain a trailing space, which breaks
  // file creation and downstream compiler invocations. Normalize it.
  const tmpDir = String(os.tmpdir() || "").trim();
  const filePath = path.join(tmpDir, fileName);
  await fs.writeFile(filePath, code, "utf8");
  return filePath;
}

function runCompare(compareExePath, leftPath, rightPath) {
  return new Promise((resolve, reject) => {
    execFile(compareExePath, [leftPath, rightPath, "--json"], { timeout: 15000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

function countMatches(regex, text) {
  let count = 0;
  regex.lastIndex = 0;
  while (regex.exec(text) !== null) {
    count += 1;
  }
  return count;
}

function approximateCyclomaticComplexity(functionBody) {
  // Very common cyclomatic contributors. This is intentionally conservative.
  const decisions =
    countMatches(/\bif\b/g, functionBody) +
    countMatches(/\bfor\b/g, functionBody) +
    countMatches(/\bwhile\b/g, functionBody) +
    countMatches(/\bcase\b/g, functionBody) +
    countMatches(/\bcatch\b/g, functionBody) +
    countMatches(/\?\s*[^:]+:/g, functionBody) +
    countMatches(/&&/g, functionBody) +
    countMatches(/\|\|/g, functionBody);
  return 1 + decisions;
}

function normalizeBodyForComparison(body) {
  return body
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripComments(code) {
  return code.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function maskRanges(input, ranges) {
  if (!ranges.length) return input;
  const chars = input.split("");
  for (const [start, end] of ranges) {
    for (let i = start; i <= end && i < chars.length; i += 1) {
      chars[i] = " ";
    }
  }
  return chars.join("");
}

function collectBlockRanges(code, headerRegex) {
  const ranges = [];
  let match;
  while ((match = headerRegex.exec(code)) !== null) {
    const openBraceIndex = match.index + match[0].lastIndexOf("{");
    const closeBraceIndex = findMatchingBrace(code, openBraceIndex);
    if (closeBraceIndex !== -1) {
      ranges.push([match.index, closeBraceIndex]);
    }
  }
  return ranges;
}

function extractTopLevelBlock(code) {
  // Mask full function/class blocks (brace-aware) to keep only true top-level statements.
  const functionHeaderRegex =
    /\b(?:inline\s+)?(?:static\s+)?(?:virtual\s+)?(?:[\w:<>~*&]+\s+)+[\w:~]+\s*\(([^;{}]*)\)\s*(?:const)?\s*\{/g;
  const classHeaderRegex = /\b(class|struct)\s+[A-Za-z_]\w*[^;{]*\{/g;
  const namespaceHeaderRegex = /\bnamespace\s+[A-Za-z_]\w*\s*\{/g;

  const ranges = [
    ...collectBlockRanges(code, functionHeaderRegex),
    ...collectBlockRanges(code, classHeaderRegex),
    ...collectBlockRanges(code, namespaceHeaderRegex)
  ];

  const masked = maskRanges(code, ranges);
  return masked
    .replace(/^\s*#.*$/gm, " ") // ignore includes/defines
    .replace(/^\s*using\s+namespace\s+[^;]+;/gm, " ") // ignore using namespace
    .replace(/\s+/g, " ")
    .trim();
}

function runClangAstDumpJsonFromCode(clangxx, code, filenameHint = "input.cpp") {
  const vsEnv = process.platform === "win32" ? getVsDevEnv() : null;

  // Prefer clang-cl on Windows when VS env is available (handles MSVC headers/libs).
  const clangCl =
    process.env.CLANGCL ||
    (typeof clangxx === "string" && clangxx.toLowerCase().endsWith("clang++.exe")
      ? clangxx.slice(0, -("clang++.exe".length)) + "clang-cl.exe"
      : null);

  const useClangCl = Boolean(vsEnv && clangCl);

  const result = spawnSync(
    useClangCl ? clangCl : clangxx,
    useClangCl
      ? [
          "-std=c++17",
          "-Xclang",
          "-ast-dump=json",
          "-fsyntax-only",
          "-fno-color-diagnostics",
          "-xc++",
          "-"
        ]
      : ["-std=c++17", "-Xclang", "-ast-dump=json", "-fsyntax-only", "-fno-color-diagnostics", "-xc++", "-"],
    {
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
      timeout: 20000,
      env: (() => {
        const base = vsEnv ? { ...process.env, ...vsEnv } : { ...process.env };
        if (base.TEMP) base.TEMP = String(base.TEMP).trim();
        if (base.TMP) base.TMP = String(base.TMP).trim();
        return base;
      })(),
      input: code
    }
  );

  if (result.error) throw result.error;
  if (result.status !== 0) {
    const msg =
      (result.stderr || "").trim() ||
      `clang AST dump exited with code ${result.status}${
        useClangCl ? " (clang-cl + VS env)" : ""
      }`;
    throw new Error(msg);
  }

  const raw = (result.stdout || "").trim();
  if (!raw) throw new Error("clang++ produced empty AST output.");
  return JSON.parse(raw);
}

function getAstChildren(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node.inner)) return node.inner.filter((x) => x && typeof x === "object");
  return [];
}

function nodeLoc(node) {
  const loc = node.loc || node.range?.begin || node.range?.end || null;
  if (!loc || typeof loc !== "object") return null;
  return {
    file: loc.file || "",
    line: typeof loc.line === "number" ? loc.line : null,
    col: typeof loc.col === "number" ? loc.col : null
  };
}

function nodeName(node) {
  if (!node || typeof node !== "object") return "";
  return (
    node.name ||
    node.mangledName ||
    node.qualifiedName ||
    node.value ||
    node.opcode ||
    node.tagUsed ||
    ""
  );
}

function nodeKey(node) {
  const kind = node?.kind || "Unknown";
  const name = nodeName(node);
  const loc = nodeLoc(node);
  const locPart = loc ? `${loc.file}:${loc.line ?? ""}:${loc.col ?? ""}` : "";
  return `${kind}|${name}|${locPart}`;
}

function nodeSignature(node) {
  const loc = nodeLoc(node);
  return JSON.stringify({
    kind: node?.kind || null,
    name: nodeName(node) || null,
    type: node?.type?.qualType || node?.type || null,
    loc
  });
}

function indexAst(root) {
  const index = new Map(); // key -> signature
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    const key = nodeKey(node);
    if (!index.has(key)) index.set(key, nodeSignature(node));
    const kids = getAstChildren(node);
    for (let i = kids.length - 1; i >= 0; i -= 1) stack.push(kids[i]);
  }
  return index;
}

function annotateAstWithDiff(root, diffMap) {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    const key = nodeKey(node);
    const diff = diffMap.get(key);
    if (diff) node.__diff = diff;
    const kids = getAstChildren(node);
    for (let i = kids.length - 1; i >= 0; i -= 1) stack.push(kids[i]);
  }
}

function diffAsts(leftAst, rightAst) {
  const leftIdx = indexAst(leftAst);
  const rightIdx = indexAst(rightAst);

  const removed = [];
  const added = [];
  const modified = [];

  for (const [k, sig] of leftIdx.entries()) {
    if (!rightIdx.has(k)) removed.push(k);
    else if (rightIdx.get(k) !== sig) modified.push(k);
  }
  for (const k of rightIdx.keys()) {
    if (!leftIdx.has(k)) added.push(k);
  }

  const leftDiff = new Map();
  for (const k of removed) leftDiff.set(k, "removed");
  for (const k of modified) leftDiff.set(k, "modified");

  const rightDiff = new Map();
  for (const k of added) rightDiff.set(k, "added");
  for (const k of modified) rightDiff.set(k, "modified");

  annotateAstWithDiff(leftAst, leftDiff);
  annotateAstWithDiff(rightAst, rightDiff);

  return { added, removed, modified };
}

function summarizeTopLevelSemantics(code) {
  const clean = stripComments(code);
  const topLevel = extractTopLevelBlock(clean);
  const normalized = topLevel.replace(/\s+/g, " ").trim();

  const variableDecls = [];
  const declRegex = /\b(?:int|long|short|float|double|char|bool|string|std::string)\s+([A-Za-z_]\w*)\s*(?:=[^;]+)?;/g;
  let dm;
  while ((dm = declRegex.exec(topLevel)) !== null) {
    variableDecls.push(dm[1]);
  }

  const hasFor = /\bfor\s*\(/.test(topLevel);
  const hasWhile = /\bwhile\s*\(/.test(topLevel);
  const hasIf = /\bif\s*\(/.test(topLevel);
  const hasModulo = /%/.test(topLevel);
  const hasMultiplication = /\*/.test(topLevel);
  const hasDivision = /\//.test(topLevel);
  const hasOutput = /\bcout\b|printf\s*\(/.test(topLevel);

  return {
    normalized,
    variableDecls: [...new Set(variableDecls)].sort(),
    features: {
      hasFor,
      hasWhile,
      hasIf,
      hasModulo,
      hasMultiplication,
      hasDivision,
      hasOutput
    }
  };
}

function tokenizeCpp(code) {
  const clean = stripComments(code);
  const tokenRegex =
    /"([^"\\]|\\.)*"|'([^'\\]|\\.)*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]\w*\b|==|!=|<=|>=|\+\+|--|&&|\|\||<<|>>|->|::|[{}()[\];,=+\-*/%<>!&|^~?:.]/g;
  const keywords = new Set([
    "int",
    "float",
    "double",
    "char",
    "bool",
    "string",
    "std",
    "if",
    "else",
    "for",
    "while",
    "do",
    "switch",
    "case",
    "return",
    "class",
    "struct",
    "void",
    "long",
    "short",
    "include",
    "using",
    "namespace"
  ]);

  const tokens = [];
  let m;
  while ((m = tokenRegex.exec(clean)) !== null) {
    const value = m[0];
    let type = "symbol";
    if (/^"/.test(value) || /^'/.test(value)) type = "literal";
    else if (/^\d/.test(value)) type = "number";
    else if (/^[A-Za-z_]\w*$/.test(value)) type = keywords.has(value) ? "keyword" : "identifier";
    else if (/^(==|!=|<=|>=|\+\+|--|&&|\|\||<<|>>|->|::|=|\+|-|\*|\/|%|<|>|!|&|\||\^|~|\?|:)$/.test(value)) type = "operator";
    else if (/^[{}()[\];,.]$/.test(value)) type = "punctuation";
    tokens.push({ type, value });
  }
  return tokens;
}

function buildPseudoParseTree(code) {
  const clean = stripComments(code);
  const lines = clean.split(/\r?\n/);
  const tree = ["Program"];
  let indent = 0;

  function pushNode(label) {
    const prefix = indent > 0 ? `${"|  ".repeat(indent - 1)}|- ` : "|- ";
    tree.push(`${prefix}${label}`);
  }

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    if (line.startsWith("}")) indent = Math.max(0, indent - 1);

    if (/^(int|float|double|char|bool|string|std::string|long|short)\s+/.test(line) && /\(/.test(line) && /\{?$/.test(line)) {
      pushNode(`FunctionDecl: ${line}`);
    } else if (/^for\s*\(/.test(line)) {
      pushNode(`Loop(for): ${line}`);
    } else if (/^while\s*\(/.test(line)) {
      pushNode(`Loop(while): ${line}`);
    } else if (/^if\s*\(/.test(line)) {
      pushNode(`Branch(if): ${line}`);
    } else if (/^else\b/.test(line)) {
      pushNode(`Branch(else): ${line}`);
    } else if (/^(int|float|double|char|bool|string|std::string|long|short)\s+/.test(line)) {
      pushNode(`Declaration: ${line}`);
    } else if (/^return\b/.test(line)) {
      pushNode(`Return: ${line}`);
    } else if (/\bcout\b|printf\s*\(/.test(line)) {
      pushNode(`Output: ${line}`);
    } else if (/\bcin\b|scanf\s*\(/.test(line)) {
      pushNode(`Input: ${line}`);
    } else if (/=/.test(line)) {
      pushNode(`Assignment: ${line}`);
    } else {
      pushNode(`Statement: ${line}`);
    }

    if (line.endsWith("{")) indent += 1;
  }

  return tree.join("\n");
}

function buildPseudoAstFromCode(code) {
  const diagram = buildPseudoParseTree(code).split(/\r?\n/).filter(Boolean);
  const root = { kind: "Program", name: "Program", inner: [] };
  const stack = [root];

  for (const line of diagram.slice(1)) {
    const m = line.match(/^((?:\|\s\s)*)\|-\s(.*)$/);
    if (!m) continue;
    const depth = (m[1] ? m[1].length / 3 : 0) + 1;
    const label = m[2].trim();
    const node = { kind: "PseudoNode", name: label, inner: [] };
    while (stack.length > depth) stack.pop();
    stack[stack.length - 1].inner.push(node);
    stack.push(node);
  }
  return root;
}

function mergeLlvmAndPhaseResult(llvmResult, phaseResult) {
  const out = { ...phaseResult };

  const added = Array.isArray(llvmResult?.addedFunctions) ? llvmResult.addedFunctions : out.functions?.added || [];
  const removed = Array.isArray(llvmResult?.removedFunctions) ? llvmResult.removedFunctions : out.functions?.removed || [];
  const changedNames = Array.isArray(llvmResult?.changedFunctions) ? llvmResult.changedFunctions : [];
  const prevChanged = Array.isArray(out.functions?.changed) ? out.functions.changed : [];
  const prevMap = new Map(prevChanged.map((c) => [c.name, c]));

  out.functions = {
    ...out.functions,
    added,
    removed,
    changed: changedNames.map((name) => prevMap.get(name) || { name, reason: "LLVM AST-reported change" })
  };

  out.classes = {
    ...out.classes,
    added: Array.isArray(llvmResult?.addedClasses) ? llvmResult.addedClasses : out.classes?.added || [],
    removed: Array.isArray(llvmResult?.removedClasses) ? llvmResult.removedClasses : out.classes?.removed || []
  };

  const llvmSummary = [
    `LLVM semantic summary: +${out.functions.added.length} function(s), -${out.functions.removed.length} function(s), ~${out.functions.changed.length} function(s).`,
    `LLVM semantic summary: +${out.classes.added.length} class/struct(s), -${out.classes.removed.length} class/struct(s).`
  ];
  out.summary = [...llvmSummary, ...(Array.isArray(out.summary) ? out.summary : [])];

  out.notes = [
    ...(Array.isArray(llvmResult?.notes) ? llvmResult.notes : []),
    ...(Array.isArray(out.notes) ? out.notes : [])
  ];

  return out;
}

function buildSyntaxTreeWithPython(code) {
  const scriptPath = path.join(__dirname, "syntax_tree.py");
  const run = spawnSync("python", [scriptPath], {
    input: code,
    encoding: "utf8",
    timeout: 2000
  });
  if (run.status === 0 && run.stdout && run.stdout.trim()) return run.stdout.trim();

  const runPy = spawnSync("py", [scriptPath], {
    input: code,
    encoding: "utf8",
    timeout: 2000
  });
  if (runPy.status === 0 && runPy.stdout && runPy.stdout.trim()) return runPy.stdout.trim();

  return buildPseudoParseTree(code);
}

function runSemanticChecks(code) {
  const clean = stripComments(code).replace(/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/g, " ");
  const normalized = clean.replace(/[{}]/g, "\n").replace(/;/g, ";\n");
  const lines = normalized.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const declared = new Set();
  const checks = [];
  const declLineRegex = /\b(?:int|float|double|char|bool|string|std::string|long|short)\s+([^;()]+);/;

  // Pass 1: collect all declarations conservatively.
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const dlm = line.match(declLineRegex);
    if (dlm) {
      const parts = dlm[1].split(",");
      for (const p of parts) {
        const nameMatch = p.trim().match(/^([A-Za-z_]\w*)/);
        if (!nameMatch) continue;
        const name = nameMatch[1];
        if (declared.has(name)) checks.push({ phase: "semantic", check: "duplicate declaration", status: "warn", detail: `${name} redeclared at statement ${i + 1}` });
        declared.add(name);
      }
    }
  }

  // Pass 2: undeclared usages in executable statements.
  const identifierRegex = /\b([A-Za-z_]\w*)\b/g;
  const ignore = new Set(["if", "for", "while", "return", "cout", "cin", "std", "string", "int", "float", "double", "char", "bool", "long", "short", "include", "using", "namespace", "main", "else", "printf", "endl"]);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (declLineRegex.test(line)) continue;
    let idm;
    while ((idm = identifierRegex.exec(line)) !== null) {
      const id = idm[1];
      if (!ignore.has(id) && !declared.has(id) && !/^#/.test(line)) {
        checks.push({ phase: "semantic", check: "undeclared usage", status: "warn", detail: `${id} used without clear declaration (statement ${i + 1})` });
      }
    }
  }

  if (checks.length === 0) {
    checks.push({ phase: "semantic", check: "basic symbol checks", status: "pass", detail: "No obvious undeclared or duplicate symbols detected." });
  }
  return checks;
}

function estimateTimeComplexity(code) {
  const clean = stripComments(code);
  const loopHeaders = [...clean.matchAll(/\b(for|while)\s*\(/g)];
  const loopCount = loopHeaders.length;
  let maxNesting = 1;
  const nestedLoopPattern = /\b(for|while)\s*\([^)]*\)\s*\{[\s\S]{0,1200}\b(for|while)\s*\(/m;
  if (nestedLoopPattern.test(clean)) maxNesting = 2;

  if (loopCount === 0) return { bigO: "O(1)", reason: "No loops detected." };
  if (maxNesting <= 1) return { bigO: "O(n)", reason: "Single loop detected." };
  if (maxNesting === 2) return { bigO: "O(n^2)", reason: "Two nested loops detected." };
  return { bigO: `O(n^${maxNesting})`, reason: `${maxNesting} nested loops detected.` };
}

function analyzeCompilerPhases(code) {
  const tokens = tokenizeCpp(code);
  const groupedLexemes = {
    keywords: [...new Set(tokens.filter((t) => t.type === "keyword").map((t) => t.value))].sort(),
    identifiers: [...new Set(tokens.filter((t) => t.type === "identifier").map((t) => t.value))].sort(),
    literals: [...new Set(tokens.filter((t) => t.type === "literal" || t.type === "number").map((t) => t.value))].sort(),
    operators: [...new Set(tokens.filter((t) => t.type === "operator").map((t) => t.value))].sort(),
    punctuation: [...new Set(tokens.filter((t) => t.type === "punctuation").map((t) => t.value))].sort()
  };
  const syntaxTree = buildSyntaxTreeWithPython(code);
  const semanticChecks = runSemanticChecks(code);
  const complexity = estimateTimeComplexity(code);

  return {
    lexical: {
      tokenCount: tokens.length,
      tokens: tokens.slice(0, 300),
      truncated: tokens.length > 300,
      groups: groupedLexemes,
      tableRows: tokens.slice(0, 300).map((t, idx) => ({ index: idx + 1, type: t.type, value: t.value }))
    },
    syntax: {
      parseTreeDiagram: syntaxTree
    },
    semantic: {
      checks: semanticChecks
    },
    complexity
  };
}

function findMatchingBrace(code, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function extractSemanticShape(code) {
  const functionsByName = new Map(); // name -> { signatures: Set<string>, entries: Array<...> }
  const classes = new Set();

  const classRegex = /\b(class|struct)\s+([A-Za-z_]\w*)\b/g;
  let classMatch;
  while ((classMatch = classRegex.exec(code)) !== null) {
    classes.add(classMatch[2]);
  }

  // Basic C++ function detection for fallback mode.
  const functionRegex =
    /\b(?:inline\s+)?(?:static\s+)?(?:virtual\s+)?(?:[\w:<>~*&]+\s+)+([\w:~]+)\s*\(([^;{}]*)\)\s*(?:const)?\s*\{/g;

  let match;
  while ((match = functionRegex.exec(code)) !== null) {
    const name = match[1];
    if (name === "if" || name === "for" || name === "while" || name === "switch" || name === "catch") {
      continue;
    }

    const params = match[2].trim();
    const signature = `${name}(${params})`;
    const openBraceIndex = match.index + match[0].lastIndexOf("{");
    const closeBraceIndex = findMatchingBrace(code, openBraceIndex);
    const body = closeBraceIndex !== -1 ? code.slice(openBraceIndex + 1, closeBraceIndex) : "";
    const normalizedBody = normalizeBodyForComparison(body);

    const entry = {
      name,
      signature,
      approximateCyclomatic: approximateCyclomaticComplexity(body),
      bodyLength: body.length,
      normalizedBody
    };

    const existing = functionsByName.get(name) || { signatures: new Set(), entries: [] };
    existing.signatures.add(signature);
    existing.entries.push(entry);
    functionsByName.set(name, existing);
  }

  const nonEmptyLines = code.split(/\r?\n/).filter((l) => l.trim().length > 0).length;

  return {
    classes,
    functionsByName,
    summary: {
      nonEmptyLines,
      functionCount: [...functionsByName.values()].reduce((acc, v) => acc + v.entries.length, 0),
      classCount: classes.size
    }
  };
}

async function runFallbackCompare(leftPath, rightPath) {
  const [leftCode, rightCode] = await Promise.all([
    fs.readFile(leftPath, "utf8"),
    fs.readFile(rightPath, "utf8")
  ]);

  const left = extractSemanticShape(leftCode);
  const right = extractSemanticShape(rightCode);

  const addedClasses = [...right.classes].filter((c) => !left.classes.has(c)).sort();
  const removedClasses = [...left.classes].filter((c) => !right.classes.has(c)).sort();

  const leftNames = new Set(left.functionsByName.keys());
  const rightNames = new Set(right.functionsByName.keys());
  const addedFunctionNames = [...rightNames].filter((n) => !leftNames.has(n)).sort();
  const removedFunctionNames = [...leftNames].filter((n) => !rightNames.has(n)).sort();

  const changedFunctions = [];
  const commonNames = [...leftNames].filter((n) => rightNames.has(n)).sort();
  for (const name of commonNames) {
    const leftInfo = left.functionsByName.get(name);
    const rightInfo = right.functionsByName.get(name);
    const leftSigs = leftInfo.signatures;
    const rightSigs = rightInfo.signatures;
    const same = leftSigs.size === rightSigs.size && [...leftSigs].every((s) => rightSigs.has(s));
    if (!same) {
      changedFunctions.push({
        name,
        reason: "function signature/overload changed",
        beforeSignatures: [...leftSigs].sort(),
        afterSignatures: [...rightSigs].sort()
      });
      continue;
    }

    // Signature is same, so compare behavior proxy from normalized function body.
    const leftBodies = new Set(leftInfo.entries.map((e) => `${e.signature}::${e.normalizedBody}`));
    const rightBodies = new Set(rightInfo.entries.map((e) => `${e.signature}::${e.normalizedBody}`));
    const sameBodies = leftBodies.size === rightBodies.size && [...leftBodies].every((b) => rightBodies.has(b));
    if (!sameBodies) {
      changedFunctions.push({
        name,
        reason: "function body/logic changed",
        beforeSignatures: [...leftSigs].sort(),
        afterSignatures: [...rightSigs].sort()
      });
    }
  }

  function complexitySummary(shape) {
    const allEntries = [];
    for (const { entries } of shape.functionsByName.values()) {
      allEntries.push(...entries);
    }
    allEntries.sort((a, b) => b.approximateCyclomatic - a.approximateCyclomatic);
    const top = allEntries.slice(0, 10).map((e) => ({
      signature: e.signature,
      approximateCyclomatic: e.approximateCyclomatic
    }));
    const total = allEntries.reduce((acc, e) => acc + e.approximateCyclomatic, 0);
    const max = allEntries[0]?.approximateCyclomatic ?? 0;
    return { totalFunctions: allEntries.length, totalApproxCyclomatic: total, maxApproxCyclomatic: max, top };
  }

  const complexity = {
    left: { ...left.summary, ...complexitySummary(left) },
    right: { ...right.summary, ...complexitySummary(right) }
  };

  const topLevelLeft = summarizeTopLevelSemantics(leftCode);
  const topLevelRight = summarizeTopLevelSemantics(rightCode);
  const topLevelHasSignal = topLevelLeft.normalized.length > 0 || topLevelRight.normalized.length > 0;
  const topLevelChanged = topLevelHasSignal && topLevelLeft.normalized !== topLevelRight.normalized;

  const summaryLines = [];
  if (addedFunctionNames.length) summaryLines.push(`Added ${addedFunctionNames.length} function(s): ${addedFunctionNames.join(", ")}`);
  if (removedFunctionNames.length) summaryLines.push(`Removed ${removedFunctionNames.length} function(s): ${removedFunctionNames.join(", ")}`);
  if (changedFunctions.length) {
    summaryLines.push(
      `Changed ${changedFunctions.length} function(s): ${changedFunctions
        .map((c) => `${c.name} [${c.reason}]`)
        .join(", ")}`
    );
  }
  if (addedClasses.length) summaryLines.push(`Added ${addedClasses.length} class/struct(s): ${addedClasses.join(", ")}`);
  if (removedClasses.length) summaryLines.push(`Removed ${removedClasses.length} class/struct(s): ${removedClasses.join(", ")}`);
  if (topLevelChanged) summaryLines.push("Top-level code logic changed (snippet-level operations differ).");
  if (!summaryLines.length) summaryLines.push("No structural differences detected by fallback comparator.");

  const leftPhases = analyzeCompilerPhases(leftCode);
  const rightPhases = analyzeCompilerPhases(rightCode);

  const complexityRank = { "O(1)": 1, "O(log n)": 2, "O(n)": 3, "O(n log n)": 4, "O(n^2)": 5, "O(n^3)": 6 };
  const leftRank = complexityRank[leftPhases.complexity.bigO] ?? 10;
  const rightRank = complexityRank[rightPhases.complexity.bigO] ?? 10;
  let better = "equal";
  if (leftRank < rightRank) better = "left";
  if (rightRank < leftRank) better = "right";
  if (better === "equal") {
    const leftCC = complexity.left.maxApproxCyclomatic ?? 0;
    const rightCC = complexity.right.maxApproxCyclomatic ?? 0;
    if (leftCC < rightCC) better = "left";
    if (rightCC < leftCC) better = "right";
  }

  const semanticDiff = [];
  if (leftPhases.semantic.checks.length !== rightPhases.semantic.checks.length) {
    semanticDiff.push(
      `Semantic warnings differ: left=${leftPhases.semantic.checks.length}, right=${rightPhases.semantic.checks.length}`
    );
  }
  if (leftPhases.complexity.bigO !== rightPhases.complexity.bigO) {
    semanticDiff.push(`Time complexity differs: left=${leftPhases.complexity.bigO}, right=${rightPhases.complexity.bigO}`);
  } else {
    semanticDiff.push(`Both have same estimated time complexity: ${leftPhases.complexity.bigO}`);
  }

  return {
    summary: summaryLines,
    functions: {
      added: addedFunctionNames,
      removed: removedFunctionNames,
      changed: changedFunctions
    },
    classes: {
      added: addedClasses,
      removed: removedClasses
    },
    topLevel: {
      changed: topLevelChanged,
      left: topLevelLeft,
      right: topLevelRight
    },
    complexity,
    phases: {
      left: leftPhases,
      right: rightPhases
    },
    verdict: {
      betterProgram: better,
      reason:
        better === "equal"
          ? "Both sides have similar estimated complexity and control-flow complexity."
          : better === "left"
            ? `Left is better by estimated complexity (${leftPhases.complexity.bigO} vs ${rightPhases.complexity.bigO}).`
            : `Right is better by estimated complexity (${rightPhases.complexity.bigO} vs ${leftPhases.complexity.bigO}).`,
      differences: summaryLines
    },
    semanticDifference: semanticDiff,
    notes: [
      "Fallback mode: regex-based structural comparison + approximate cyclomatic complexity.",
      "Install LLVM + build compare.exe for AST-accurate semantics (types, renames, templates, etc.)."
    ]
  };
}

app.get("/compare", async (req, res) => {
  const { leftPath, rightPath, leftCode, rightCode } = req.query;

  let localLeft = leftPath;
  let localRight = rightPath;
  const tempFiles = [];

  try {
    if (!localLeft || !localRight) {
      if (!leftCode || !rightCode) {
        return res.status(400).json({
          ok: false,
          error: "Provide either leftPath/rightPath or leftCode/rightCode."
        });
      }
      localLeft = await writeTempCodeFile(leftCode, "left");
      localRight = await writeTempCodeFile(rightCode, "right");
      tempFiles.push(localLeft, localRight);
    }

    const compareExe = resolveCompareExecutable();
    let result;
    let mode = "llvm";
    let executable = compareExe;

    try {
      const rawOutput = await runCompare(compareExe, localLeft, localRight);
      const llvmParsed = JSON.parse(rawOutput);
      const phaseResult = await runFallbackCompare(localLeft, localRight);
      result = mergeLlvmAndPhaseResult(llvmParsed, phaseResult);
    } catch (llvmError) {
      if (llvmError.message.includes("ENOENT")) {
        mode = "fallback";
        executable = null;
        result = await runFallbackCompare(localLeft, localRight);
      } else {
        throw llvmError;
      }
    }

    return res.json({
      ok: true,
      mode,
      executable,
      left: localLeft,
      right: localRight,
      result
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message || "Comparison failed."
    });
  } finally {
    await Promise.all(
      tempFiles.map(async (file) => {
        try {
          await fs.unlink(file);
        } catch {
          // Best effort cleanup.
        }
      })
    );
  }
});

app.post("/ast", async (req, res) => {
  const { leftPath, rightPath, leftCode, rightCode } = req.body || {};

  let localLeft = leftPath;
  let localRight = rightPath;
  const tempFiles = [];

  try {
    if (!localLeft || !localRight) {
      if (!leftCode || !rightCode) {
        return res.status(400).json({
          ok: false,
          error: "Provide either leftPath/rightPath or leftCode/rightCode."
        });
      }
      localLeft = await writeTempCodeFile(leftCode, "left");
      localRight = await writeTempCodeFile(rightCode, "right");
      tempFiles.push(localLeft, localRight);
    }

    // Semantic comparison via existing compare.exe workflow.
    const compareExe = resolveCompareExecutable();
    let comparison;
    try {
      const rawOutput = await runCompare(compareExe, localLeft, localRight);
      comparison = JSON.parse(rawOutput);
    } catch (e) {
      throw new Error(
        `compare.exe failed. Build core engine and set COMPARE_EXE if needed. Details: ${e.message}`
      );
    }

    // AST dumps via clang++ ast-dump=json.
    const clangxx = resolveClangXXExecutable();
    let leftAST;
    let rightAST;
    let astMode = "clang";
    let astWarning = null;
    try {
      const leftSource =
        typeof leftCode === "string" ? leftCode : await fs.readFile(localLeft, "utf8");
      const rightSource =
        typeof rightCode === "string" ? rightCode : await fs.readFile(localRight, "utf8");

      leftAST = runClangAstDumpJsonFromCode(clangxx, leftSource, localLeft || "left.cpp");
      rightAST = runClangAstDumpJsonFromCode(clangxx, rightSource, localRight || "right.cpp");
    } catch (e) {
      const leftSource =
        typeof leftCode === "string" ? leftCode : await fs.readFile(localLeft, "utf8");
      const rightSource =
        typeof rightCode === "string" ? rightCode : await fs.readFile(localRight, "utf8");
      leftAST = buildPseudoAstFromCode(leftSource);
      rightAST = buildPseudoAstFromCode(rightSource);
      astMode = "fallback";
      astWarning = `clang++ AST dump failed, using pseudo AST fallback. Details: ${e.message}`;
    }

    const astDiff = diffAsts(leftAST, rightAST);

    return res.json({
      ok: true,
      leftAST,
      rightAST,
      comparison,
      astDiff,
      astMode,
      astWarning
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message || "AST generation failed."
    });
  } finally {
    await Promise.all(
      tempFiles.map(async (file) => {
        try {
          await fs.unlink(file);
        } catch {
          // Best effort cleanup.
        }
      })
    );
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Backend running at http://localhost:${PORT}`);
});
