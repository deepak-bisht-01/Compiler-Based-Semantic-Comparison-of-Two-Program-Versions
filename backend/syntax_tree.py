import re
import sys


def classify(line: str) -> str:
    if re.match(r"^(int|float|double|char|bool|string|std::string|long|short)\s+.*\(.*\)\s*\{?$", line):
        return f"FunctionDecl: {line}"
    if re.match(r"^for\s*\(", line):
        return f"Loop(for): {line}"
    if re.match(r"^while\s*\(", line):
        return f"Loop(while): {line}"
    if re.match(r"^if\s*\(", line):
        return f"Branch(if): {line}"
    if re.match(r"^else\b", line):
        return f"Branch(else): {line}"
    if re.match(r"^(int|float|double|char|bool|string|std::string|long|short)\s+", line):
        return f"Declaration: {line}"
    if re.match(r"^return\b", line):
        return f"Return: {line}"
    if "cout" in line or "printf(" in line:
        return f"Output: {line}"
    if "cin" in line or "scanf(" in line:
        return f"Input: {line}"
    if "=" in line:
        return f"Assignment: {line}"
    return f"Statement: {line}"


def build_tree(code: str) -> str:
    code = re.sub(r"//.*$", "", code, flags=re.M)
    code = re.sub(r"/\*[\s\S]*?\*/", "", code)
    lines = [ln.strip() for ln in code.splitlines() if ln.strip() and not ln.strip().startswith("#")]

    out = ["Program"]
    depth = 0

    for line in lines:
        if line.startswith("}"):
            depth = max(0, depth - 1)
        prefix = ("|  " * max(0, depth - 1)) + "|- "
        out.append(prefix + classify(line))
        if line.endswith("{"):
            depth += 1

    return "\n".join(out)


if __name__ == "__main__":
    source = sys.stdin.read()
    print(build_tree(source))
