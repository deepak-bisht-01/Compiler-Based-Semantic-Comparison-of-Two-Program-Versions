#include "ASTComparator.h"

#include <algorithm>
#include <fstream>
#include <map>
#include <set>
#include <sstream>
#include <stdexcept>
#include <utility>

#include "clang/AST/ASTContext.h"
#include "clang/AST/DeclCXX.h"
#include "clang/AST/RecursiveASTVisitor.h"
#include "clang/Frontend/ASTUnit.h"
#include "clang/Tooling/Tooling.h"
#include "llvm/Support/JSON.h"
#include "llvm/Support/raw_ostream.h"

namespace semantic_compare {
namespace {

struct FunctionInfo {
    std::string signature;
    std::string return_type;
    std::size_t parameter_count = 0;
};

struct ClassInfo {
    std::string name;
    std::set<std::string> methods;
    std::set<std::string> fields;
};

struct SymbolTable {
    std::map<std::string, FunctionInfo> functions;
    std::map<std::string, ClassInfo> classes;
};

class ASTCollector final : public clang::RecursiveASTVisitor<ASTCollector> {
public:
    explicit ASTCollector(clang::ASTContext& context) : context_(context) {}

    bool VisitFunctionDecl(clang::FunctionDecl* decl) {
        if (!decl->isThisDeclarationADefinition()) {
            return true;
        }
        if (decl->isImplicit()) {
            return true;
        }

        const std::string qualified_name = decl->getQualifiedNameAsString();
        if (qualified_name.empty()) {
            return true;
        }

        FunctionInfo info;
        info.signature = decl->getType().getAsString();
        info.return_type = decl->getReturnType().getAsString();
        info.parameter_count = decl->param_size();
        symbols_.functions[qualified_name] = std::move(info);
        return true;
    }

    bool VisitCXXRecordDecl(clang::CXXRecordDecl* decl) {
        if (!decl->isThisDeclarationADefinition()) {
            return true;
        }
        if (decl->isImplicit()) {
            return true;
        }

        const std::string class_name = decl->getQualifiedNameAsString();
        if (class_name.empty()) {
            return true;
        }

        ClassInfo info;
        info.name = class_name;

        for (const auto* method : decl->methods()) {
            if (method->isImplicit()) {
                continue;
            }
            info.methods.insert(method->getType().getAsString());
        }

        for (const auto* field : decl->fields()) {
            const std::string field_repr = field->getType().getAsString() + " " + field->getNameAsString();
            info.fields.insert(field_repr);
        }

        symbols_.classes[class_name] = std::move(info);
        return true;
    }

    const SymbolTable& symbols() const { return symbols_; }

private:
    clang::ASTContext& context_;
    SymbolTable symbols_;
};

std::string read_file(const std::string& path) {
    std::ifstream in(path);
    if (!in) {
        throw std::runtime_error("Unable to open file: " + path);
    }
    std::ostringstream buffer;
    buffer << in.rdbuf();
    return buffer.str();
}

SymbolTable parse_symbols_from_file(const std::string& path) {
    const std::string code = read_file(path);

    std::vector<std::string> args = {"-std=c++17", "-xc++"};
    std::unique_ptr<clang::ASTUnit> unit = clang::tooling::buildASTFromCodeWithArgs(code, args, path);
    if (!unit) {
        throw std::runtime_error("Failed to parse C++ source into AST: " + path);
    }

    clang::ASTContext& context = unit->getASTContext();
    ASTCollector collector(context);
    collector.TraverseDecl(context.getTranslationUnitDecl());
    return collector.symbols();
}

template <typename T>
void sort_vec(std::vector<T>& values) {
    std::sort(values.begin(), values.end());
}

}  // namespace

CompareResult ASTComparator::compare_files(const std::string& lhs_path, const std::string& rhs_path) const {
    SymbolTable lhs_symbols = parse_symbols_from_file(lhs_path);
    SymbolTable rhs_symbols = parse_symbols_from_file(rhs_path);

    CompareResult result;

    for (const auto& [name, fn] : lhs_symbols.functions) {
        const auto it = rhs_symbols.functions.find(name);
        if (it == rhs_symbols.functions.end()) {
            result.removed_functions.push_back(name);
            continue;
        }
        const FunctionInfo& rhs_fn = it->second;
        if (fn.signature != rhs_fn.signature || fn.return_type != rhs_fn.return_type ||
            fn.parameter_count != rhs_fn.parameter_count) {
            result.changed_functions.push_back(name);
        }
    }

    for (const auto& [name, _] : rhs_symbols.functions) {
        if (lhs_symbols.functions.find(name) == lhs_symbols.functions.end()) {
            result.added_functions.push_back(name);
        }
    }

    for (const auto& [name, lhs_class] : lhs_symbols.classes) {
        const auto it = rhs_symbols.classes.find(name);
        if (it == rhs_symbols.classes.end()) {
            result.removed_classes.push_back(name);
            continue;
        }
        const ClassInfo& rhs_class = it->second;
        if (lhs_class.methods != rhs_class.methods || lhs_class.fields != rhs_class.fields) {
            result.changed_classes.push_back(name);
        }
    }

    for (const auto& [name, _] : rhs_symbols.classes) {
        if (lhs_symbols.classes.find(name) == lhs_symbols.classes.end()) {
            result.added_classes.push_back(name);
        }
    }

    if (result.added_functions.empty() && result.removed_functions.empty() &&
        result.changed_functions.empty() && result.added_classes.empty() &&
        result.removed_classes.empty() && result.changed_classes.empty()) {
        result.notes.push_back("No semantic differences detected.");
    } else {
        result.notes.push_back("Semantic differences detected.");
    }

    sort_vec(result.added_functions);
    sort_vec(result.removed_functions);
    sort_vec(result.changed_functions);
    sort_vec(result.added_classes);
    sort_vec(result.removed_classes);
    sort_vec(result.changed_classes);

    return result;
}

std::string format_as_text(const CompareResult& result) {
    std::ostringstream out;
    out << "Semantic Comparison Result\n";
    out << "==========================\n";

    auto write_section = [&out](const std::string& title, const std::vector<std::string>& items) {
        out << "\n" << title << " (" << items.size() << ")\n";
        out << std::string(title.size() + 4, '-') << "\n";
        if (items.empty()) {
            out << "  - none\n";
            return;
        }
        for (const auto& item : items) {
            out << "  - " << item << "\n";
        }
    };

    write_section("Added Functions", result.added_functions);
    write_section("Removed Functions", result.removed_functions);
    write_section("Changed Functions", result.changed_functions);
    write_section("Added Classes", result.added_classes);
    write_section("Removed Classes", result.removed_classes);
    write_section("Changed Classes", result.changed_classes);

    out << "\nNotes\n-----\n";
    for (const auto& note : result.notes) {
        out << "  - " << note << "\n";
    }

    return out.str();
}

std::string format_as_json(const CompareResult& result) {
    llvm::json::Object obj;
    obj["addedFunctions"] = result.added_functions;
    obj["removedFunctions"] = result.removed_functions;
    obj["changedFunctions"] = result.changed_functions;
    obj["addedClasses"] = result.added_classes;
    obj["removedClasses"] = result.removed_classes;
    obj["changedClasses"] = result.changed_classes;
    obj["notes"] = result.notes;

    std::string json_str;
    llvm::raw_string_ostream stream(json_str);
    stream << llvm::formatv("{0:2}", llvm::json::Value(std::move(obj)));
    return stream.str();
}

}  // namespace semantic_compare
