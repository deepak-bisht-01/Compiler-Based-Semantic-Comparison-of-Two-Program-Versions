#pragma once

#include <string>
#include <vector>

namespace semantic_compare {

struct CompareResult {
    std::vector<std::string> added_functions;
    std::vector<std::string> removed_functions;
    std::vector<std::string> changed_functions;
    std::vector<std::string> added_classes;
    std::vector<std::string> removed_classes;
    std::vector<std::string> changed_classes;
    std::vector<std::string> notes;
};

class ASTComparator {
public:
    CompareResult compare_files(const std::string& lhs_path, const std::string& rhs_path) const;
};

std::string format_as_text(const CompareResult& result);
std::string format_as_json(const CompareResult& result);

}  // namespace semantic_compare
