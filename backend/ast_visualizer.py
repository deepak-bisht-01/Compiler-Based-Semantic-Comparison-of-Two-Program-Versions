#!/usr/bin/env python3
"""
Advanced AST Visualizer for C++ Code
Generates clean, hierarchical Abstract Syntax Tree diagrams
"""

import re
import sys
from dataclasses import dataclass
from typing import List, Optional, Dict, Set
from enum import Enum


class NodeType(Enum):
    """AST Node Types"""
    PROGRAM = "Program"
    NAMESPACE = "Namespace"
    CLASS = "Class"
    STRUCT = "Struct"
    FUNCTION = "Function"
    DECLARATION = "Declaration"
    STATEMENT = "Statement"
    LOOP = "Loop"
    CONDITIONAL = "Conditional"
    RETURN = "Return"
    ASSIGNMENT = "Assignment"
    EXPRESSION = "Expression"
    CALL = "FunctionCall"
    LITERAL = "Literal"
    IDENTIFIER = "Identifier"
    OPERATOR = "Operator"


@dataclass
class ASTNode:
    """Represents an AST node"""
    node_type: NodeType
    name: str
    value: Optional[str] = None
    line_num: int = 0
    children: List['ASTNode'] = None
    metadata: Dict = None

    def __post_init__(self):
        if self.children is None:
            self.children = []
        if self.metadata is None:
            self.metadata = {}


class CppParser:
    """C++ Code Parser for AST Construction"""

    def __init__(self):
        self.lines = []
        self.pos = 0
        self.scope_depth = 0

    def parse(self, code: str) -> ASTNode:
        """Parse C++ code and return AST"""
        # Clean code
        code = self._clean_code(code)
        self.lines = code.split('\n')
        
        root = ASTNode(NodeType.PROGRAM, "root", line_num=0)
        
        for line_num, line in enumerate(self.lines, 1):
            line = line.strip()
            if not line or line.startswith('//'):
                continue
            
            node = self._parse_line(line, line_num)
            if node:
                root.children.append(node)
        
        return root

    def _clean_code(self, code: str) -> str:
        """Remove comments and normalize code"""
        # Remove multi-line comments
        code = re.sub(r'/\*[\s\S]*?\*/', '', code)
        # Remove single-line comments
        code = re.sub(r'//.*$', '', code, flags=re.MULTILINE)
        # Remove preprocessor directives
        code = re.sub(r'^\s*#.*$', '', code, flags=re.MULTILINE)
        return code

    def _parse_line(self, line: str, line_num: int) -> Optional[ASTNode]:
        """Parse individual line into AST node"""
        line = line.strip()
        if not line:
            return None

        # Function declaration
        if self._is_function_decl(line):
            return self._parse_function(line, line_num)
        
        # Class/Struct
        if re.match(r'^(class|struct)\s+\w+', line):
            return self._parse_class(line, line_num)
        
        # Namespace
        if re.match(r'^namespace\s+\w+', line):
            return self._parse_namespace(line, line_num)
        
        # Variable declaration
        if self._is_declaration(line):
            return self._parse_declaration(line, line_num)
        
        # Control flow
        if re.match(r'^(if|else if|else)\s*\(', line):
            return self._parse_conditional(line, line_num)
        
        if re.match(r'^(for|while)\s*\(', line):
            return self._parse_loop(line, line_num)
        
        if re.match(r'^return\b', line):
            return self._parse_return(line, line_num)
        
        # Assignment
        if '=' in line and not self._is_declaration(line):
            return self._parse_assignment(line, line_num)
        
        # Expression/Statement
        if line:
            return ASTNode(NodeType.STATEMENT, line, line_num=line_num)
        
        return None

    def _is_function_decl(self, line: str) -> bool:
        """Check if line is a function declaration"""
        return bool(re.match(
            r'^(static\s+)?(inline\s+)?(virtual\s+)?'
            r'(int|float|double|char|bool|string|void|std::\w+|\w+)\s+\w+\s*\(',
            line
        ))

    def _is_declaration(self, line: str) -> bool:
        """Check if line is a variable declaration"""
        return bool(re.match(
            r'^(const\s+)?(int|float|double|char|bool|string|std::\w+|long|short)\s+(\w+|\*)[\s\w*&]*[=;]',
            line
        ))

    def _parse_function(self, line: str, line_num: int) -> ASTNode:
        """Parse function declaration"""
        match = re.search(r'(\w+)\s*\(([^)]*)\)', line)
        name = match.group(1) if match else "function"
        params = match.group(2) if match else ""
        
        node = ASTNode(NodeType.FUNCTION, name, line_num=line_num)
        node.metadata['params'] = params
        node.metadata['signature'] = line
        return node

    def _parse_class(self, line: str, line_num: int) -> ASTNode:
        """Parse class/struct declaration"""
        match = re.search(r'(class|struct)\s+(\w+)', line)
        node_type = NodeType.CLASS if match.group(1) == 'class' else NodeType.STRUCT
        name = match.group(2) if match else "class"
        
        node = ASTNode(node_type, name, line_num=line_num)
        return node

    def _parse_namespace(self, line: str, line_num: int) -> ASTNode:
        """Parse namespace declaration"""
        match = re.search(r'namespace\s+(\w+)', line)
        name = match.group(1) if match else "namespace"
        
        node = ASTNode(NodeType.NAMESPACE, name, line_num=line_num)
        return node

    def _parse_declaration(self, line: str, line_num: int) -> ASTNode:
        """Parse variable declaration"""
        match = re.search(r'(\w+)\s+(\w+)', line)
        if match:
            var_type = match.group(1)
            var_name = match.group(2)
            node = ASTNode(NodeType.DECLARATION, var_name, line_num=line_num)
            node.metadata['type'] = var_type
            return node
        
        return ASTNode(NodeType.DECLARATION, line, line_num=line_num)

    def _parse_conditional(self, line: str, line_num: int) -> ASTNode:
        """Parse if/else conditional"""
        match = re.search(r'(if|else\s+if|else)\s*\(([^)]*)\)', line)
        cond = match.group(2) if match else ""
        keyword = match.group(1) if match else "if"
        
        node = ASTNode(NodeType.CONDITIONAL, keyword, line_num=line_num)
        node.metadata['condition'] = cond
        return node

    def _parse_loop(self, line: str, line_num: int) -> ASTNode:
        """Parse for/while loop"""
        match = re.search(r'(for|while)\s*\(([^)]*)\)', line)
        loop_type = match.group(1) if match else "loop"
        loop_expr = match.group(2) if match else ""
        
        node = ASTNode(NodeType.LOOP, loop_type, line_num=line_num)
        node.metadata['expression'] = loop_expr
        return node

    def _parse_return(self, line: str, line_num: int) -> ASTNode:
        """Parse return statement"""
        match = re.search(r'return\s*(.*?);?$', line)
        value = match.group(1) if match else ""
        
        node = ASTNode(NodeType.RETURN, "return", value=value, line_num=line_num)
        return node

    def _parse_assignment(self, line: str, line_num: int) -> ASTNode:
        """Parse assignment"""
        match = re.search(r'(\w+)\s*=\s*(.*)', line)
        if match:
            var = match.group(1)
            expr = match.group(2)
            node = ASTNode(NodeType.ASSIGNMENT, var, value=expr, line_num=line_num)
            return node
        
        return ASTNode(NodeType.STATEMENT, line, line_num=line_num)


class ASTVisualizer:
    """Converts AST to visual representations"""

    @staticmethod
    def to_tree_string(node: ASTNode, prefix: str = "", is_last: bool = True) -> str:
        """Convert AST to Unicode tree string"""
        lines = []
        
        # Build current node line
        connector = "└── " if is_last else "├── "
        node_str = ASTVisualizer._format_node(node)
        lines.append(prefix + connector + node_str)
        
        # Add children
        if node.children:
            extension = "    " if is_last else "│   "
            for i, child in enumerate(node.children):
                is_last_child = (i == len(node.children) - 1)
                child_lines = ASTVisualizer.to_tree_string(
                    child, 
                    prefix + extension, 
                    is_last_child
                )
                lines.append(child_lines)
        
        return "\n".join(lines)

    @staticmethod
    def _format_node(node: ASTNode) -> str:
        """Format node for display"""
        node_type = node.node_type.value
        
        # Build basic representation
        if node.node_type == NodeType.PROGRAM:
            return f"📋 {node_type}"
        
        if node.node_type in [NodeType.CLASS, NodeType.STRUCT]:
            return f"🏗️  {node_type}: {node.name}"
        
        if node.node_type == NodeType.FUNCTION:
            params = node.metadata.get('params', '')
            return f"⚙️  {node_type}: {node.name}({params})"
        
        if node.node_type == NodeType.DECLARATION:
            var_type = node.metadata.get('type', 'var')
            return f"📦 {node_type}: {var_type} {node.name}"
        
        if node.node_type == NodeType.CONDITIONAL:
            cond = node.metadata.get('condition', '')
            return f"🔀 {node.name} ({cond})"
        
        if node.node_type == NodeType.LOOP:
            expr = node.metadata.get('expression', '')
            return f"🔁 {node.name}({expr})"
        
        if node.node_type == NodeType.RETURN:
            return f"↩️  return {node.value}" if node.value else "↩️  return"
        
        if node.node_type == NodeType.ASSIGNMENT:
            return f"➡️  {node.name} = {node.value}"
        
        return f"{node_type}: {node.name}"

    @staticmethod
    def to_detailed_view(node: ASTNode, indent: int = 0) -> str:
        """Generate detailed structured view"""
        lines = []
        prefix = "  " * indent
        
        # Node header
        node_info = ASTVisualizer._format_node(node)
        lines.append(f"{prefix}{node_info}")
        
        # Metadata
        if node.metadata:
            for key, val in node.metadata.items():
                if val and key not in ['condition', 'expression']:
                    lines.append(f"{prefix}  📌 {key}: {val}")
        
        # Line number
        if node.line_num > 0:
            lines.append(f"{prefix}  📍 Line: {node.line_num}")
        
        # Children
        if node.children:
            lines.append(f"{prefix}  └─ Children ({len(node.children)}):")
            for child in node.children:
                child_view = ASTVisualizer.to_detailed_view(child, indent + 2)
                lines.append(child_view)
        
        return "\n".join(lines)


class SemanticAnalyzer:
    """Analyze semantic properties of code"""

    @staticmethod
    def analyze(ast: ASTNode) -> Dict:
        """Perform semantic analysis on AST"""
        analysis = {
            'total_nodes': 0,
            'functions': [],
            'variables': [],
            'loops': 0,
            'conditionals': 0,
            'returns': 0,
            'complexity': 1
        }
        
        SemanticAnalyzer._traverse(ast, analysis)
        return analysis

    @staticmethod
    def _traverse(node: ASTNode, analysis: Dict):
        """Traverse AST and collect statistics"""
        analysis['total_nodes'] += 1
        
        if node.node_type == NodeType.FUNCTION:
            analysis['functions'].append(node.name)
        elif node.node_type == NodeType.DECLARATION:
            analysis['variables'].append(node.name)
        elif node.node_type == NodeType.LOOP:
            analysis['loops'] += 1
            analysis['complexity'] += 1
        elif node.node_type == NodeType.CONDITIONAL:
            analysis['conditionals'] += 1
            analysis['complexity'] += 1
        elif node.node_type == NodeType.RETURN:
            analysis['returns'] += 1
        
        for child in node.children:
            SemanticAnalyzer._traverse(child, analysis)


def main():
    """Main entry point"""
    if len(sys.argv) > 1:
        # Read from file
        with open(sys.argv[1], 'r') as f:
            code = f.read()
    else:
        # Read from stdin
        code = sys.stdin.read()
    
    # Parse code
    parser = CppParser()
    ast = parser.parse(code)
    
    # Generate output
    print("=" * 70)
    print("ABSTRACT SYNTAX TREE (AST) VISUALIZATION")
    print("=" * 70)
    print()
    
    # Tree view
    print("📊 TREE VIEW:")
    print("-" * 70)
    print(ASTVisualizer.to_tree_string(ast))
    print()
    
    # Detailed view
    print("📝 DETAILED VIEW:")
    print("-" * 70)
    print(ASTVisualizer.to_detailed_view(ast))
    print()
    
    # Semantic analysis
    analysis = SemanticAnalyzer.analyze(ast)
    print("📈 SEMANTIC ANALYSIS:")
    print("-" * 70)
    print(f"  Total Nodes:        {analysis['total_nodes']}")
    print(f"  Functions:          {len(analysis['functions'])} {analysis['functions']}")
    print(f"  Variables:          {len(analysis['variables'])} {analysis['variables']}")
    print(f"  Loops:              {analysis['loops']}")
    print(f"  Conditionals:       {analysis['conditionals']}")
    print(f"  Returns:            {analysis['returns']}")
    print(f"  Cyclomatic Complexity: {analysis['complexity']}")
    print()

    # Graphviz output if requested via args
    import argparse
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument('--dot', help='Write DOT file to path', default=None)
    parser.add_argument('--graph', help='Render graph to image (png/svg). Requires `dot` in PATH', default=None)
    args, _ = parser.parse_known_args()

    def node_id(n: ASTNode) -> str:
        return f"n{abs(hash((n.node_type.value, n.name, n.line_num))) % (10**8)}"

    def escape(s: str) -> str:
        return s.replace('"', '\\"') if s else ''

    def to_dot(root: ASTNode) -> str:
        lines = ['digraph AST {', '  node [shape=box, fontname="Helvetica"];', '  rankdir=TB;']
        seen = set()

        def emit(n: ASTNode):
            nid = node_id(n)
            if nid in seen:
                return
            seen.add(nid)
            label = f"{n.node_type.value}: {n.name}" if n.name else n.node_type.value
            if n.line_num:
                label += f"\\nLine: {n.line_num}"
            lines.append(f'  {nid} [label="{escape(label)}"];')
            for c in n.children:
                cid = node_id(c)
                lines.append(f'  {nid} -> {cid};')
                emit(c)

        emit(root)
        lines.append('}')
        return "\n".join(lines)

    if args.dot or args.graph:
        dot_text = to_dot(ast)
        if args.dot:
            try:
                with open(args.dot, 'w', encoding='utf8') as f:
                    f.write(dot_text)
                print(f"DOT written to: {args.dot}")
            except Exception as e:
                print(f"Failed to write DOT: {e}")

        if args.graph:
            import shutil
            dot_bin = shutil.which('dot')
            out_path = args.graph
            if not dot_bin:
                print('Graphviz `dot` not found in PATH. Install Graphviz or provide DOT file and render manually.')
                try:
                    fallback_dot = out_path + '.dot'
                    with open(fallback_dot, 'w', encoding='utf8') as f:
                        f.write(dot_text)
                    print(f'Wrote DOT fallback to: {fallback_dot}')
                except Exception:
                    pass
            else:
                import subprocess
                fmt = 'png' if out_path.lower().endswith('.png') else ('svg' if out_path.lower().endswith('.svg') else 'png')
                try:
                    p = subprocess.run([dot_bin, f'-T{fmt}', '-o', out_path], input=dot_text.encode('utf8'), check=True)
                    print(f'Graph rendered to: {out_path}')
                except Exception as e:
                    print(f'Graph rendering failed: {e}')


if __name__ == "__main__":
    main()
