let leftEditor;
let rightEditor;

function prettyPrintResult(result) {
  if (typeof result === "string") {
    return result;
  }
  return JSON.stringify(result, null, 2);
}

function formatLexicalTable(rows) {
  if (!rows || rows.length === 0) return "No tokens.";
  const header = ["Idx", "Type", "Lexeme"];
  const idxW = Math.max(header[0].length, ...rows.map((r) => String(r.index).length));
  const typeW = Math.max(header[1].length, ...rows.map((r) => r.type.length));
  const valW = Math.max(header[2].length, ...rows.map((r) => r.value.length));

  const line = `+-${"-".repeat(idxW)}-+-${"-".repeat(typeW)}-+-${"-".repeat(Math.min(valW, 60))}-+`;
  const format = (a, b, c) =>
    `| ${String(a).padEnd(idxW)} | ${String(b).padEnd(typeW)} | ${String(c).slice(0, 60).padEnd(Math.min(valW, 60))} |`;

  const out = [line, format(header[0], header[1], header[2]), line];
  for (const r of rows) out.push(format(r.index, r.type, r.value));
  out.push(line);
  return out.join("\n");
}

function renderReadable(result) {
  if (!result || typeof result !== "object") return prettyPrintResult(result);

  const lines = [];

  if (Array.isArray(result.summary)) for (const s of result.summary) lines.push(`- ${s}`);
  if (Array.isArray(result.summary) && result.summary.length) lines.push("");

  if (result.functions) {
    lines.push("Functions");
    lines.push("---------");
    if (Array.isArray(result.functions.added) && result.functions.added.length) {
      lines.push(`Added (${result.functions.added.length}):`);
      for (const f of result.functions.added) lines.push(`  + ${f}`);
    }
    if (Array.isArray(result.functions.removed) && result.functions.removed.length) {
      lines.push(`Removed (${result.functions.removed.length}):`);
      for (const f of result.functions.removed) lines.push(`  - ${f}`);
    }
    if (Array.isArray(result.functions.changed) && result.functions.changed.length) {
      lines.push(`Changed (${result.functions.changed.length}):`);
      for (const c of result.functions.changed) {
        lines.push(`  * ${c.name}${c.reason ? ` [${c.reason}]` : ""}`);
        if (c.beforeSignatures?.length) lines.push(`    before: ${c.beforeSignatures.join(" | ")}`);
        if (c.afterSignatures?.length) lines.push(`    after : ${c.afterSignatures.join(" | ")}`);
      }
    }
    if (
      (!result.functions.added || result.functions.added.length === 0) &&
      (!result.functions.removed || result.functions.removed.length === 0) &&
      (!result.functions.changed || result.functions.changed.length === 0)
    ) {
      lines.push("No function-level structural differences detected.");
    }
    lines.push("");
  }

  if (result.classes) {
    lines.push("Classes / Structs");
    lines.push("-----------------");
    if (Array.isArray(result.classes.added) && result.classes.added.length) {
      lines.push(`Added (${result.classes.added.length}): ${result.classes.added.join(", ")}`);
    }
    if (Array.isArray(result.classes.removed) && result.classes.removed.length) {
      lines.push(`Removed (${result.classes.removed.length}): ${result.classes.removed.join(", ")}`);
    }
    if (
      (!result.classes.added || result.classes.added.length === 0) &&
      (!result.classes.removed || result.classes.removed.length === 0)
    ) {
      lines.push("No class/struct additions/removals detected.");
    }
    lines.push("");
  }

  if (result.topLevel) {
    lines.push("Top-Level Snippet Logic");
    lines.push("-----------------------");
    lines.push(result.topLevel.changed ? "Changed: yes" : "Changed: no");
    if (result.topLevel.left && result.topLevel.right) {
      const leftDecls = result.topLevel.left.variableDecls || [];
      const rightDecls = result.topLevel.right.variableDecls || [];
      lines.push(`Left declarations : ${leftDecls.length ? leftDecls.join(", ") : "none"}`);
      lines.push(`Right declarations: ${rightDecls.length ? rightDecls.join(", ") : "none"}`);
      lines.push(`Left features : ${JSON.stringify(result.topLevel.left.features)}`);
      lines.push(`Right features: ${JSON.stringify(result.topLevel.right.features)}`);
    }
    lines.push("");
  }

  if (result.complexity) {
    const left = result.complexity.left;
    const right = result.complexity.right;
    lines.push("Complexity (approx cyclomatic)");
    lines.push("------------------------------");
    if (left && right) {
      lines.push(`Left : functions=${left.totalFunctions}, max=${left.maxApproxCyclomatic}, total=${left.totalApproxCyclomatic}, lines=${left.nonEmptyLines}`);
      lines.push(`Right: functions=${right.totalFunctions}, max=${right.maxApproxCyclomatic}, total=${right.totalApproxCyclomatic}, lines=${right.nonEmptyLines}`);
      if (Array.isArray(left.top) && left.top.length) {
        lines.push("");
        lines.push("Top complex (Left):");
        for (const t of left.top) lines.push(`  - CC~${t.approximateCyclomatic}: ${t.signature}`);
      }
      if (Array.isArray(right.top) && right.top.length) {
        lines.push("");
        lines.push("Top complex (Right):");
        for (const t of right.top) lines.push(`  - CC~${t.approximateCyclomatic}: ${t.signature}`);
      }
    } else {
      lines.push(prettyPrintResult(result.complexity));
    }
    lines.push("");
  }

  if (result.phases?.left && result.phases?.right) {
    lines.push("1) Lexical");
    const leftLex = result.phases.left.lexical;
    const rightLex = result.phases.right.lexical;
    lines.push(`Left token count : ${leftLex.tokenCount}`);
    lines.push(`Right token count: ${rightLex.tokenCount}`);
    lines.push("Grouped lexemes (Left):");
    lines.push(`- keywords: ${(leftLex.groups?.keywords || []).join(", ") || "none"}`);
    lines.push(`- identifiers: ${(leftLex.groups?.identifiers || []).join(", ") || "none"}`);
    lines.push(`- literals: ${(leftLex.groups?.literals || []).join(", ") || "none"}`);
    lines.push(`- operators: ${(leftLex.groups?.operators || []).join(", ") || "none"}`);
    lines.push(`- punctuation: ${(leftLex.groups?.punctuation || []).join(", ") || "none"}`);
    lines.push("Grouped lexemes (Right):");
    lines.push(`- keywords: ${(rightLex.groups?.keywords || []).join(", ") || "none"}`);
    lines.push(`- identifiers: ${(rightLex.groups?.identifiers || []).join(", ") || "none"}`);
    lines.push(`- literals: ${(rightLex.groups?.literals || []).join(", ") || "none"}`);
    lines.push(`- operators: ${(rightLex.groups?.operators || []).join(", ") || "none"}`);
    lines.push(`- punctuation: ${(rightLex.groups?.punctuation || []).join(", ") || "none"}`);
    lines.push("Left token table:");
    lines.push(formatLexicalTable(leftLex.tableRows));
    if (leftLex.truncated) lines.push("(truncated)");
    lines.push("Right token table:");
    lines.push(formatLexicalTable(rightLex.tableRows));
    if (rightLex.truncated) lines.push("(truncated)");
    lines.push("");

    lines.push("2) Syntax Tree");
    lines.push("Left parse tree:");
    lines.push(result.phases.left.syntax.parseTreeDiagram || "Program");
    lines.push("");
    lines.push("Right parse tree:");
    lines.push(result.phases.right.syntax.parseTreeDiagram || "Program");
    lines.push("");

    lines.push("3) Semantic");
    lines.push("Left semantic checks:");
    for (const c of result.phases.left.semantic.checks || []) {
      lines.push(`- [${c.status}] ${c.check}: ${c.detail}`);
    }
    lines.push("Right semantic checks:");
    for (const c of result.phases.right.semantic.checks || []) {
      lines.push(`- [${c.status}] ${c.check}: ${c.detail}`);
    }
    lines.push("");

    lines.push("4) Complexity");
    lines.push(`Left : ${result.phases.left.complexity.bigO} (${result.phases.left.complexity.reason})`);
    lines.push(`Right: ${result.phases.right.complexity.bigO} (${result.phases.right.complexity.reason})`);
    lines.push("");
  }

  if (result.verdict) {
    lines.push("5) Better Program");
    lines.push(`Better program: ${result.verdict.betterProgram}`);
    lines.push(`Reason: ${result.verdict.reason}`);
    if (Array.isArray(result.verdict.differences) && result.verdict.differences.length) {
      lines.push("Key differences:");
      for (const d of result.verdict.differences) lines.push(`- ${d}`);
    }
    lines.push("");
  }

  if (Array.isArray(result.semanticDifference) && result.semanticDifference.length) {
    lines.push("Semantic Difference");
    lines.push("-------------------");
    for (const item of result.semanticDifference) lines.push(`- ${item}`);
    lines.push("");
  }

  if (Array.isArray(result.notes) && result.notes.length) {
    lines.push("Notes");
    for (const n of result.notes) lines.push(`- ${n}`);
  }

  return lines.join("\n").trim() || prettyPrintResult(result);
}

function setLoading(isLoading) {
  const button = document.getElementById("compare-btn");
  const loading = document.getElementById("loading");
  button.disabled = isLoading;
  loading.classList.toggle("hidden", !isLoading);
}

function setResult(text) {
  document.getElementById("result-panel").textContent = text;
}

async function compareCode() {
  setLoading(true);
  setResult("Running comparison...");

  try {
    const params = new URLSearchParams({
      leftCode: leftEditor.getValue(),
      rightCode: rightEditor.getValue()
    });

    const response = await fetch(`/compare?${params.toString()}`);
    const data = await response.json();

    if (!response.ok || !data.ok) {
      setResult(`Error: ${data.error || "Unknown backend error."}`);
      return;
    }

    setResult(renderReadable(data.result));
  } catch (err) {
    setResult(`Request failed: ${err.message}`);
  } finally {
    setLoading(false);
  }
}

require.config({
  paths: {
    vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.49.0/min/vs"
  }
});

require(["vs/editor/editor.main"], function () {
  leftEditor = monaco.editor.create(document.getElementById("editor-left"), {
    value: `#include <string>
class User {
public:
  std::string name;
  int age;
  void setAge(int value) { age = value; }
};

int sum(int a, int b) { return a + b; }`,
    language: "cpp",
    theme: "vs-dark",
    minimap: { enabled: false },
    automaticLayout: true
  });

  rightEditor = monaco.editor.create(document.getElementById("editor-right"), {
    value: `#include <string>
class User {
public:
  std::string fullName;
  int age;
  void setAge(int value) { age = value; }
  void resetAge() { age = 0; }
};

int sum(int a, int b, int c) { return a + b + c; }`,
    language: "cpp",
    theme: "vs-dark",
    minimap: { enabled: false },
    automaticLayout: true
  });

  document.getElementById("compare-btn").addEventListener("click", compareCode);
});
