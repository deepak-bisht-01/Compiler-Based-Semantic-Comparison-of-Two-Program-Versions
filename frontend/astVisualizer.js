/* global d3 */

(function () {
  function astChildren(node) {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node.inner)) return node.inner.filter((x) => x && typeof x === "object");
    return [];
  }

  function formatReturnTypeFromQualType(qualType) {
    if (typeof qualType !== "string") return null;
    const m = qualType.trim().match(/^(.+?)\s*\(/);
    return m ? m[1].trim() : qualType.trim();
  }

  function nodeLabel(d) {
    return nodeLabelFromData(d?.data || {});
  }

  function diffClass(d) {
    const t = d.data?.__diff;
    if (t === "added") return "ast-node-added";
    if (t === "removed") return "ast-node-removed";
    if (t === "modified") return "ast-node-modified";
    return "ast-node-same";
  }

  function nodeLabelFromData(n) {
    const kind = n?.kind || "Unknown";
    const name = n?.name || n?.qualifiedName || n?.mangledName || n?.value || "";

    // Hide internal fallback wrapper kind to keep UI clean.
    if (kind === "PseudoNode") {
      return name || "Node";
    }

    let label = kind;
    if (name) label += ` ${name}`;

    // Match clang textual style: for FunctionDecl (like main), show return type.
    if (kind.includes("FunctionDecl")) {
      const qualType = n?.type?.qualType || n?.type?.desugaredQualType || null;
      const ret = formatReturnTypeFromQualType(qualType);
      if (ret) label += ` : ${ret}`;
    }

    return label;
  }

  function renderTreeFallback(containerEl, rootData, titleText) {
    containerEl.innerHTML = "";
    const title = document.createElement("div");
    title.className = "ast-title";
    title.textContent = `${titleText} (fallback tree)`;
    containerEl.appendChild(title);

    const viewport = document.createElement("div");
    viewport.className = "ast-viewport";
    viewport.style.overflow = "auto";
    viewport.style.padding = "10px 12px";
    containerEl.appendChild(viewport);

    const pre = document.createElement("pre");
    pre.style.whiteSpace = "pre";
    pre.style.margin = "0";
    pre.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    pre.style.fontSize = "12px";
    viewport.appendChild(pre);

    const maxDepth = 22;
    const maxNodes = 1200;
    let nodeCount = 0;

    const lines = [];
    const rootNode = rootData || { kind: "Program", inner: [] };
    lines.push(nodeLabelFromData(rootNode));

    function walk(node, prefix, depth) {
      if (!node || typeof node !== "object") return;
      if (depth >= maxDepth) return;
      if (nodeCount >= maxNodes) return;

      const kids = astChildren(node);
      if (!kids.length) return;

      const truncatedKids = kids.length > 500 ? kids.slice(0, 500) : kids;
      for (let i = 0; i < truncatedKids.length; i += 1) {
        if (nodeCount >= maxNodes) break;
        nodeCount += 1;
        const k = truncatedKids[i];
        const lastChild = i === truncatedKids.length - 1;
        const branch = lastChild ? "└── " : "├── ";
        lines.push(`${prefix}${branch}${nodeLabelFromData(k)}`);
        const childPrefix = prefix + (lastChild ? "    " : "│   ");
        walk(k, childPrefix, depth + 1);
      }

      if (kids.length > truncatedKids.length && nodeCount < maxNodes) {
        lines.push(`${prefix}└── ... ${kids.length - truncatedKids.length} more nodes`);
      }
    }

    walk(rootNode, "", 0);
    if (nodeCount >= maxNodes) lines.push("... output truncated");
    pre.textContent = lines.join("\n");
  }

  function renderTree(containerEl, rootData, titleText) {
    containerEl.innerHTML = "";

    const title = document.createElement("div");
    title.className = "ast-title";
    title.textContent = titleText;
    containerEl.appendChild(title);

    const viewport = document.createElement("div");
    viewport.className = "ast-viewport";
    containerEl.appendChild(viewport);

    const width = viewport.clientWidth || 560;
    const height = viewport.clientHeight || 520;

    const svg = d3
      .select(viewport)
      .append("svg")
      .attr("width", "100%")
      .attr("height", "100%")
      .attr("viewBox", [0, 0, width, height])
      .attr("class", "ast-svg");

    const g = svg.append("g").attr("transform", "translate(30,30)");

    svg.call(
      d3
        .zoom()
        .scaleExtent([0.2, 3])
        .on("zoom", (event) => {
          g.attr("transform", event.transform);
        })
    );

    const root = d3.hierarchy(rootData, astChildren);
    root.x0 = 0;
    root.y0 = 0;

    // Start collapsed for readability (keep first 2 levels expanded).
    root.each((d) => {
      if (d.depth >= 2 && d.children) {
        d._children = d.children;
        d.children = null;
      }
    });

    const treeLayout = d3.tree().nodeSize([18, 180]);

    function update(source) {
      treeLayout(root);

      const nodes = root.descendants();
      const links = root.links();

      const minX = d3.min(nodes, (d) => d.x) ?? 0;
      const maxX = d3.max(nodes, (d) => d.x) ?? height;
      const maxY = d3.max(nodes, (d) => d.y) ?? width;

      svg.attr("viewBox", [0, minX - 40, Math.max(width, maxY + 120), maxX - minX + 80]);

      const link = g.selectAll("path.ast-link").data(links, (d) => d.target.data.id || nodeLabel(d.target));

      link
        .enter()
        .append("path")
        .attr("class", "ast-link")
        .attr("d", (d) => {
          const o = { x: source.x0, y: source.y0 };
          return `M${o.y},${o.x}C${(o.y + d.target.y) / 2},${o.x} ${(o.y + d.target.y) / 2},${d.target.x} ${d.target.y},${d.target.x}`;
        })
        .merge(link)
        .attr("d", (d) => `M${d.source.y},${d.source.x}C${(d.source.y + d.target.y) / 2},${d.source.x} ${(d.source.y + d.target.y) / 2},${d.target.x} ${d.target.y},${d.target.x}`);

      link.exit().remove();

      const node = g.selectAll("g.ast-node").data(nodes, (d) => d.data.id || nodeLabel(d));

      const nodeEnter = node
        .enter()
        .append("g")
        .attr("class", (d) => `ast-node ${diffClass(d)}`)
        .attr("transform", () => `translate(${source.y0},${source.x0})`)
        .on("click", (_event, d) => {
          if (d.children) {
            d._children = d.children;
            d.children = null;
          } else {
            d.children = d._children;
            d._children = null;
          }
          update(d);
        });

      nodeEnter.append("circle").attr("r", 5.5);

      nodeEnter
        .append("text")
        .attr("dy", "0.32em")
        .attr("x", 10)
        .text((d) => nodeLabel(d));

      node
        .merge(nodeEnter)
        .attr("class", (d) => `ast-node ${diffClass(d)}${d._children ? " ast-node-collapsed" : ""}`)
        .attr("transform", (d) => `translate(${d.y},${d.x})`);

      node.exit().remove();

      root.each((d) => {
        d.x0 = d.x;
        d.y0 = d.y;
      });
    }

    update(root);
  }

  function renderSideBySide(leftAst, rightAst) {
    const leftEl = document.getElementById("ast-left");
    const rightEl = document.getElementById("ast-right");
    if (!leftEl || !rightEl) throw new Error("AST containers not found in DOM.");

    if (typeof window.d3 === "undefined") {
      renderTreeFallback(leftEl, leftAst, "Left AST");
      renderTreeFallback(rightEl, rightAst, "Right AST");
      return;
    }

    renderTree(leftEl, leftAst, "Left AST");
    renderTree(rightEl, rightAst, "Right AST");
  }

  window.ASTVisualizer = {
    renderSideBySide
  };
})();

