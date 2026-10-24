cmake_minimum_required(VERSION 3.22.1)

project("llama_jni" VERSION 1.0.0 LANGUAGES C CXX)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS OFF)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# Android 15/16+ (API 35/36) ARM64 16 KB ELF page size compatibility and dead-code stripping
if(ANDROID)
    add_compile_options(-ffunction-sections -fdata-sections)
    add_link_options(
        "-Wl,-z,max-page-size=16384"
        "-Wl,--gc-sections"
    )
endif()

# Mandatory Android ARM64 ggml / llama.cpp build flags
set(GGML_OPENMP          OFF CACHE BOOL "Disable OpenMP on Android NDK" FORCE)
set(GGML_LLAMAFILE       OFF CACHE BOOL "Disable llamafile kernels on Android ARM64" FORCE)
set(GGML_NATIVE          OFF CACHE BOOL "Disable host -march=native during cross-compilation" FORCE)
set(GGML_BACKEND_DL      OFF CACHE BOOL "Statically register CPU backend into ggml" FORCE)
set(GGML_CPU_KLEIDIAI    OFF CACHE BOOL "Disable network FetchContent during offline builds" FORCE)
set(GGML_CUDA            OFF CACHE BOOL "Disable CUDA backend" FORCE)
set(GGML_METAL           OFF CACHE BOOL "Disable Metal backend" FORCE)
set(GGML_VULKAN          OFF CACHE BOOL "Disable Vulkan backend" FORCE)
set(GGML_OPENCL          OFF CACHE BOOL "Disable OpenCL backend" FORCE)
set(GGML_SYCL            OFF CACHE BOOL "Disable SYCL backend" FORCE)
set(GGML_RPC             OFF CACHE BOOL "Disable RPC backend" FORCE)
set(GGML_BUILD_TESTS     OFF CACHE BOOL "Disable ggml tests" FORCE)
set(GGML_BUILD_EXAMPLES  OFF CACHE BOOL "Disable ggml examples" FORCE)

set(LLAMA_BUILD_COMMON   OFF CACHE BOOL "Disable llama common utilities" FORCE)
set(LLAMA_BUILD_TESTS    OFF CACHE BOOL "Disable llama tests" FORCE)
set(LLAMA_BUILD_TOOLS    OFF CACHE BOOL "Disable llama CLI tools" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "Disable llama examples" FORCE)
set(LLAMA_BUILD_SERVER   OFF CACHE BOOL "Disable llama HTTP server" FORCE)
set(LLAMA_BUILD_APP      OFF CACHE BOOL "Disable llama standalone binary" FORCE)
set(LLAMA_OPENSSL        OFF CACHE BOOL "Disable OpenSSL dependency on Android" FORCE)
set(LLAMA_CURL           OFF CACHE BOOL "Disable libcurl dependency on Android" FORCE)

# Build static archives into a single self-contained libllama_jni.so unless explicitly overridden
if(NOT DEFINED BUILD_SHARED_LIBS)
    set(BUILD_SHARED_LIBS OFF CACHE BOOL "Build static llama/ggml archives into libllama_jni.so" FORCE)
endif()

# Enable ARMv8.2-A NEON dot-product and FP16 instructions on arm64-v8a
if(DEFINED ANDROID_ABI AND ANDROID_ABI STREQUAL "arm64-v8a")
    if(NOT DEFINED GGML_CPU_ARM_ARCH)
        set(GGML_CPU_ARM_ARCH "armv8.2-a+dotprod+fp16" CACHE STRING "Target ARM64 ISA for Android" FORCE)
    endif()
endif()

# Resolve llama.cpp source tree across standard checkout locations
if(NOT DEFINED LLAMA_CPP_DIR)
    if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/llama.cpp/CMakeLists.txt")
        set(LLAMA_CPP_DIR "${CMAKE_CURRENT_SOURCE_DIR}/llama.cpp")
    elseif(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/../../../../llama.cpp/CMakeLists.txt")
        get_filename_component(LLAMA_CPP_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../../../llama.cpp" ABSOLUTE)
    elseif(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../../../llama.cpp/CMakeLists.txt")
        get_filename_component(LLAMA_CPP_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../../../llama.cpp" ABSOLUTE)
    else()
        message(FATAL_ERROR
            "llama.cpp source directory not found. Clone llama.cpp into "
            "public/android/HeretIc/app/src/main/cpp/llama.cpp, "
            "or pass -DLLAMA_CPP_DIR=/path/to/llama.cpp")
    endif()
endif()

message(STATUS "Using llama.cpp source tree at: ${LLAMA_CPP_DIR}")
add_subdirectory("${LLAMA_CPP_DIR}" "${CMAKE_CURRENT_BINARY_DIR}/build-llama" EXCLUDE_FROM_ALL)

# Strip SONAME versioning if shared libraries were explicitly requested on Android
if(ANDROID AND BUILD_SHARED_LIBS)
    foreach(_llama_tgt llama ggml ggml-base ggml-cpu)
        if(TARGET ${_llama_tgt})
            set_target_properties(${_llama_tgt} PROPERTIES VERSION "" SOVERSION "")
        endif()
    endforeach()
endif()

add_library(llama_jni SHARED
    llama_jni.cpp
)

target_include_directories(llama_jni PRIVATE
    "${LLAMA_CPP_DIR}/include"
    "${LLAMA_CPP_DIR}/ggml/include"
)

target_compile_options(llama_jni PRIVATE
    -Wall
    -Wextra
    -O3
)

find_library(LOG_LIB log REQUIRED)
find_library(ANDROID_LIB android REQUIRED)

# Link both llama and ggml (plus split ggml-base/ggml-cpu targets when present) to prevent
# unresolved symbol errors under Android NDK lld (--no-allow-shlib-undefined) on ARM64.
target_link_libraries(llama_jni PRIVATE
    llama
    ggml
    $<$<TARGET_EXISTS:ggml-cpu>:ggml-cpu>
    $<$<TARGET_EXISTS:ggml-base>:ggml-base>
    ${LOG_LIB}
    ${ANDROID_LIB}
)
