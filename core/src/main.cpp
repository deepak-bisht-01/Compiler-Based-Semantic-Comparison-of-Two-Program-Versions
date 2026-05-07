#include "ASTComparator.h"

#include <exception>
#include <iostream>
#include <optional>
#include <string>
#include <system_error>

#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/FileSystem.h"
#include "llvm/Support/Program.h"

namespace {

std::optional<std::string> run_clang_ast_dump_json(const std::string& source_path, std::string& err) {
    auto clang_path = llvm::sys::findProgramByName("clang++");
    if (!clang_path) {
        err = "Unable to find clang++ in PATH.";
        return std::nullopt;
    }

    llvm::SmallString<128> temp;
    std::error_code ec = llvm::sys::fs::createTemporaryFile("ast-dump", "json", temp);
    if (ec) {
        err = "Failed to create temp file for AST output: " + ec.message();
        return std::nullopt;
    }
    const std::string out_path = std::string(temp.str());

    std::vector<llvm::StringRef> args;
    args.emplace_back("clang++");
    args.emplace_back("-std=c++17");
    args.emplace_back("-fsyntax-only");
    args.emplace_back("-fno-color-diagnostics");
    args.emplace_back("-Xclang");
    args.emplace_back("-ast-dump=json");
    args.emplace_back(source_path);

    // Capture stdout into a file (clang's AST dump is large).
    std::optional<llvm::StringRef> redirects[3];
    redirects[0] = llvm::StringRef(); // stdin
    redirects[1] = llvm::StringRef(out_path); // stdout -> file
    redirects[2] = llvm::StringRef(); // stderr

    int result = llvm::sys::ExecuteAndWait(*clang_path, args, llvm::StringRef(), redirects);
    if (result != 0) {
        err = "clang++ exited with code " + std::to_string(result) + " while dumping AST.";
        (void)llvm::sys::fs::remove(out_path);
        return std::nullopt;
    }

    auto buf_or_err = llvm::MemoryBuffer::getFile(out_path);
    if (!buf_or_err) {
        err = "Failed to read AST dump output file.";
        (void)llvm::sys::fs::remove(out_path);
        return std::nullopt;
    }

    std::string ast_json = (*buf_or_err)->getBuffer().str();
    (void)llvm::sys::fs::remove(out_path);
    return ast_json;
}

}  // namespace

int main(int argc, char* argv[]) {
    if (argc < 3 || argc > 4) {
        std::cerr << "Usage: compare <left_file.cpp> <right_file.cpp> [--json | --ast-json]\n";
        return 1;
    }

    const std::string left_file = argv[1];
    const std::string right_file = argv[2];
    enum class OutputMode { Text, CompareJson, AstJson };
    OutputMode mode = OutputMode::Text;
    if (argc == 4) {
        const std::string flag = argv[3];
        if (flag == "--json") {
            mode = OutputMode::CompareJson;
        } else if (flag == "--ast-json") {
            mode = OutputMode::AstJson;
        } else {
            std::cerr << "Unknown flag: " << argv[3] << "\n";
            std::cerr << "Supported optional flags: --json, --ast-json\n";
            return 1;
        }
    }

    try {
        semantic_compare::ASTComparator comparator;
        const semantic_compare::CompareResult result = comparator.compare_files(left_file, right_file);

        if (mode == OutputMode::CompareJson) {
            std::cout << semantic_compare::format_as_json(result) << "\n";
            return 0;
        }

        if (mode == OutputMode::AstJson) {
            std::string err;
            const auto left_ast = run_clang_ast_dump_json(left_file, err);
            if (!left_ast) {
                throw std::runtime_error("Left AST dump failed: " + err);
            }
            const auto right_ast = run_clang_ast_dump_json(right_file, err);
            if (!right_ast) {
                throw std::runtime_error("Right AST dump failed: " + err);
            }

            // Emit a single JSON object:
            // { "leftAST": <json>, "rightAST": <json>, "comparison": <json> }
            // The AST dumps are already JSON; comparison is JSON string from our formatter.
            const std::string comparison_json = semantic_compare::format_as_json(result);
            std::cout << "{\n"
                      << "  \"leftAST\": " << *left_ast << ",\n"
                      << "  \"rightAST\": " << *right_ast << ",\n"
                      << "  \"comparison\": " << comparison_json << "\n"
                      << "}\n";
            return 0;
        }

        // Text output
        {
            std::cout << semantic_compare::format_as_text(result) << "\n";
            return 0;
        }
    } catch (const std::exception& ex) {
        std::cerr << "Error: " << ex.what() << "\n";
        return 2;
    }
}
