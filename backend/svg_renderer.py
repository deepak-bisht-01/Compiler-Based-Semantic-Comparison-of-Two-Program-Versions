#!/usr/bin/env python3
"""
Pure Python AST to SVG Renderer
No external dependencies required
"""

import math
from typing import Dict, List, Tuple
from dataclasses import dataclass


@dataclass
class TreeNode:
    """Simple tree node"""
    id: str
    label: str
    children: List['TreeNode'] = None

    def __post_init__(self):
        if self.children is None:
            self.children = []


class TreeLayout:
    """Calculate hierarchical tree layout using improved algorithm"""

    def __init__(self, node_width=100, node_height=45, x_spacing=160, y_spacing=120):
        self.node_width = node_width
        self.node_height = node_height
        self.x_spacing = x_spacing
        self.y_spacing = y_spacing
        self.positions: Dict[str, Tuple[float, float]] = {}
        self.counter = 0

    def layout(self, root: TreeNode) -> Dict[str, Tuple[float, float]]:
        """Calculate positions for all nodes"""
        self.positions = {}
        self.counter = 0
        
        # First pass: count all descendants
        node_widths = {}
        self._count_nodes(root, node_widths)
        
        # Second pass: assign positions
        self._layout_node(root, 0, 0, node_widths)
        
        return self.positions

    def _count_nodes(self, node: TreeNode, widths: Dict) -> int:
        """Count nodes in subtree"""
        count = 1
        for child in node.children:
            count += self._count_nodes(child, widths)
        widths[node.id] = count
        return count

    def _layout_node(self, node: TreeNode, x: float, y: float, widths: Dict) -> Tuple[float, float]:
        """Recursively layout node and return its center position"""
        # Position this node
        self.positions[node.id] = (x, y)
        
        if not node.children:
            return (x, y)
        
        # Calculate space for children
        total_child_width = sum(widths.get(c.id, 1) for c in node.children) * self.x_spacing
        
        # Position children
        child_x = x - total_child_width / 2
        for child in node.children:
            child_width = widths.get(child.id, 1) * self.x_spacing
            child_center = child_x + child_width / 2
            self._layout_node(child, child_center, y + self.y_spacing, widths)
            child_x += child_width
        
        return (x, y)


class SVGBuilder:
    """Build SVG diagrams"""

    def __init__(self, width=1200, height=800, margin=40):
        self.width = width
        self.height = height
        self.margin = margin
        self.elements = []
        self.colors = {
            'Program': '#3498db',
            'Function': '#e74c3c',
            'Declaration': '#2ecc71',
            'Loop': '#f39c12',
            'Conditional': '#9b59b6',
            'Return': '#e67e22',
            'Assignment': '#1abc9c',
            'Class': '#34495e',
            'Statement': '#95a5a6',
        }

    def add_defs(self):
        """Add SVG definitions"""
        self.elements.append('''<defs>
    <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
      <polygon points="0 0, 10 3, 0 6" fill="#555"/>
    </marker>
    <style>
      .node-box { stroke: #333; stroke-width: 2; }
      .node-label { font-family: Arial, sans-serif; font-size: 11px; font-weight: bold; }
      .edge { stroke: #666; stroke-width: 1.5; fill: none; marker-end: url(#arrowhead); }
      .root-label { font-weight: bold; }
    </style>
  </defs>''')

    def add_node(self, node_id: str, x: float, y: float, label: str, color: str = None):
        """Add a node box"""
        # Extract node type from label
        node_type = label.split(':')[0].strip() if ':' in label else 'Statement'
        if color is None:
            color = self.colors.get(node_type, '#95a5a6')

        # Truncate long labels
        display_label = label[:40] + '...' if len(label) > 40 else label
        
        # Node dimensions
        w, h = 100, 50
        
        self.elements.append(f'''<g id="{node_id}">
    <rect class="node-box" x="{x - w/2}" y="{y - h/2}" width="{w}" height="{h}" fill="{color}" opacity="0.8" rx="4"/>
    <text class="node-label" x="{x}" y="{y}" text-anchor="middle" dominant-baseline="middle" fill="white">
      {self._escape(display_label)}
    </text>
  </g>''')

    def add_edge(self, x1: float, y1: float, x2: float, y2: float):
        """Add an edge between nodes"""
        self.elements.append(f'<line class="edge" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}"/>')

    def to_string(self) -> str:
        """Generate SVG string"""
        svg = f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="{self.width}" height="{self.height}" viewBox="0 0 {self.width} {self.height}">
  <rect width="{self.width}" height="{self.height}" fill="#f8f9fa"/>
  
'''
        svg += '\n'.join(self.elements)
        svg += '\n</svg>'
        return svg

    @staticmethod
    def _escape(text: str) -> str:
        return text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')


def parse_dot_file(filepath: str) -> TreeNode:
    """Parse simplified DOT and build tree"""
    with open(filepath, 'r') as f:
        content = f.read()

    nodes = {}
    edges = []

    # Extract nodes - look for pattern: nNNNNNNN [label="..."]
    import re
    node_pattern = r'(\w+)\s*\[label="([^"]+)"\]'
    for match in re.finditer(node_pattern, content):
        node_id = match.group(1)
        label = match.group(2)
        nodes[node_id] = TreeNode(node_id, label)

    # Extract edges - look for pattern: nNNNNNNN -> nNNNNNNN
    edge_pattern = r'(\w+)\s*->\s*(\w+)'
    for match in re.finditer(edge_pattern, content):
        parent_id = match.group(1)
        child_id = match.group(2)
        if parent_id in nodes and child_id in nodes:
            edges.append((parent_id, child_id))

    print(f"  Found {len(nodes)} nodes, {len(edges)} edges")

    # Build tree
    for parent_id, child_id in edges:
        nodes[parent_id].children.append(nodes[child_id])

    # Find root (node with no incoming edges)
    all_children = {child_id for _, child_id in edges}
    root_candidates = [nid for nid in nodes if nid not in all_children]
    
    if root_candidates:
        root_id = root_candidates[0]
    else:
        root_id = next(iter(nodes.keys())) if nodes else None
    
    if root_id and root_id in nodes:
        return nodes[root_id]
    
    # Fallback
    return next(iter(nodes.values())) if nodes else TreeNode("empty", "Empty")


def render_dot_to_svg(dot_filepath: str, svg_filepath: str):
    """Convert DOT file to SVG visualization"""
    print(f"📊 Parsing DOT graph from {dot_filepath}")
    root = parse_dot_file(dot_filepath)

    print(f"🎨 Building SVG layout")
    layout = TreeLayout(x_spacing=150, y_spacing=100)
    positions = layout.layout(root)

    print(f"📐 Calculating bounds for {len(positions)} nodes")
    
    # Calculate bounds
    if positions:
        xs = [p[0] for p in positions.values()]
        ys = [p[1] for p in positions.values()]
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        
        # Scale to fit with margins
        padding = 100
        width = int(max_x - min_x + padding * 2)
        height = int(max_y - min_y + padding * 2)
        offset_x = padding - min_x
        offset_y = padding - min_y
    else:
        width, height = 800, 600
        offset_x, offset_y = 400, 300

    print(f"📐 Canvas size: {width}x{height}")
    builder = SVGBuilder(width, height)
    builder.add_defs()

    # First pass: draw all edges
    print(f"🔗 Drawing edges")
    def draw_edges(node: TreeNode):
        if node.id not in positions:
            return
        
        x1, y1 = positions[node.id]
        x1 += offset_x
        y1 += offset_y
        
        for child in node.children:
            if child.id in positions:
                x2, y2 = positions[child.id]
                x2 += offset_x
                y2 += offset_y
                builder.add_edge(x1, y1, x2, y2)
            draw_edges(child)

    draw_edges(root)

    # Second pass: draw all nodes
    print(f"🎨 Drawing {len(positions)} nodes")
    def draw_nodes(node: TreeNode):
        if node.id in positions:
            x, y = positions[node.id]
            x += offset_x
            y += offset_y
            builder.add_node(node.id, x, y, node.label)
        
        for child in node.children:
            draw_nodes(child)

    draw_nodes(root)

    svg_content = builder.to_string()
    with open(svg_filepath, 'w', encoding='utf8') as f:
        f.write(svg_content)

    print(f"✅ SVG diagram saved to: {svg_filepath}")
    print(f"📂 Contains {len(positions)} nodes")
    print(f"📏 Canvas: {width}x{height}px")


if __name__ == '__main__':
    import sys
    
    dot_file = sys.argv[1] if len(sys.argv) > 1 else 'ast.png.dot'
    svg_file = sys.argv[2] if len(sys.argv) > 2 else 'ast_diagram.svg'
    
    render_dot_to_svg(dot_file, svg_file)
