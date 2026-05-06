# Compiler Project

Semantic C++ comparison tool with:
- LLVM/Clang AST engine in C++
- Express backend API
- Monaco-based frontend UI

## Project structure

```text
compiler-project/
├── core/
│   ├── include/
│   └── src/
├── build/
├── backend/
├── frontend/
└── CMakeLists.txt
```

## Prerequisites (Windows)

1. LLVM installed at `C:\Program Files\LLVM`
2. CMake (>= 3.20)
3. Ninja
4. Node.js (>= 18)

Ensure `C:\Program Files\LLVM\bin` is in your `PATH`.

## Build core engine (Ninja only)

From `compiler-project`:

```powershell
cmake -S . -B build -G Ninja -DLLVM_DIR="C:/Program Files/LLVM/lib/cmake/llvm" -DClang_DIR="C:/Program Files/LLVM/lib/cmake/clang"
cmake --build build
```

This generates `build/compare.exe`.

## Run backend

```powershell
cd backend
npm install
$env:COMPARE_EXE = "..\build\compare.exe"
npm start
```

Backend starts at `http://localhost:3000`.

## Open frontend

The backend serves frontend files automatically:
- Open: `http://localhost:3000`

## API usage

### `GET /compare`

Input modes:
- Path mode: `leftPath`, `rightPath`
- Inline code mode: `leftCode`, `rightCode`

Examples:

```text
GET /compare?leftPath=C:\temp\a.cpp&rightPath=C:\temp\b.cpp
GET /compare?leftCode=<code1>&rightCode=<code2>
```

Response:

```json
{
  "ok": true,
  "executable": "C:\\...\\compare.exe",
  "left": "...",
  "right": "...",
  "result": {
    "addedFunctions": [],
    "removedFunctions": [],
    "changedFunctions": [],
    "addedClasses": [],
    "removedClasses": [],
    "changedClasses": [],
    "notes": []
  }
}
```
