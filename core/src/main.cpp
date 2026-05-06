#include "ASTComparator.h"

#include <exception>
#include <iostream>
#include <string>

int main(int argc, char* argv[]) {
    if (argc < 3 || argc > 4) {
        std::cerr << "Usage: compare <left_file.cpp> <right_file.cpp> [--json]\n";
        return 1;
    }

    const std::string left_file = argv[1];
    const std::string right_file = argv[2];
    bool json_output = false;
    if (argc == 4) {
        json_output = std::string(argv[3]) == "--json";
        if (!json_output) {
            std::cerr << "Unknown flag: " << argv[3] << "\n";
            std::cerr << "Supported optional flag: --json\n";
            return 1;
        }
    }

    try {
        semantic_compare::ASTComparator comparator;
        const semantic_compare::CompareResult result = comparator.compare_files(left_file, right_file);
        if (json_output) {
            std::cout << semantic_compare::format_as_json(result) << "\n";
        } else {
            std::cout << semantic_compare::format_as_text(result) << "\n";
        }
        return 0;
    } catch (const std::exception& ex) {
        std::cerr << "Error: " << ex.what() << "\n";
        return 2;
    }
}
