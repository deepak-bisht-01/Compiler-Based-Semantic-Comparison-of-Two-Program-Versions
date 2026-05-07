cmake_minimum_required(VERSION 3.20)
project(CompilerSemanticCompare LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

set(LLVM_DIR "C:/Program Files/LLVM/lib/cmake/llvm" CACHE PATH "Path to LLVM CMake config")
set(Clang_DIR "C:/Program Files/LLVM/lib/cmake/clang" CACHE PATH "Path to Clang CMake config")

find_package(LLVM REQUIRED CONFIG)
find_package(Clang REQUIRED CONFIG)

message(STATUS "Using LLVM ${LLVM_PACKAGE_VERSION}")
message(STATUS "LLVMConfig.cmake in: ${LLVM_DIR}")
message(STATUS "ClangConfig.cmake in: ${Clang_DIR}")

# Some LLVM prebuilt Windows packages hardcode an "Enterprise" DIA SDK path
# inside `LLVMExports.cmake`. If the machine has Visual Studio Professional,
# linking fails because that file doesn't exist. Provide a compatible fallback.
set(_DIA_PRO_DIAGUIDS "C:/Program Files/Microsoft Visual Studio/2022/Professional/DIA SDK/lib/amd64/diaguids.lib")
set(_DIA_ENTERPRISE_DIAGUIDS "C:/Program Files/Microsoft Visual Studio/2022/Enterprise/DIA SDK/lib/amd64/diaguids.lib")
if(EXISTS "${_DIA_PRO_DIAGUIDS}" AND NOT EXISTS "${_DIA_ENTERPRISE_DIAGUIDS}")
  foreach(_t
          LLVMSupport
          LLVMObject
          LLVMBinaryFormat
          LLVMDebugInfoCodeView
          LLVMDebugInfoMSF)
    if(TARGET ${_t})
      get_target_property(_libs ${_t} INTERFACE_LINK_LIBRARIES)
      if(_libs)
        string(REPLACE "${_DIA_ENTERPRISE_DIAGUIDS}" "${_DIA_PRO_DIAGUIDS}" _libs "${_libs}")
        set_target_properties(${_t} PROPERTIES INTERFACE_LINK_LIBRARIES "${_libs}")
      endif()
    endif()
  endforeach()
endif()

add_executable(compare
    core/src/main.cpp
    core/src/ASTComparator.cpp
)

target_include_directories(compare PRIVATE
    ${LLVM_INCLUDE_DIRS}
    ${CLANG_INCLUDE_DIRS}
    ${CMAKE_CURRENT_SOURCE_DIR}/core/include
)

target_compile_definitions(compare PRIVATE ${LLVM_DEFINITIONS})

target_link_libraries(compare PRIVATE
    clangAST
    clangBasic
    clangFrontend
    clangLex
    clangSerialization
    clangTooling
    LLVMCore
    LLVMSupport
)
