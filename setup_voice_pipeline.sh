#!/usr/bin/env bash

mkdir -p app/src/main/cpp
mkdir -p app/src/main/kotlin/com/heretic/voice

cat << 'EOF' > app/src/main/cpp/CMakeLists.txt
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

# Resolve llama.cpp source tree across standard submodule locations
if(NOT DEFINED LLAMA_CPP_DIR)
    if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/llama.cpp/CMakeLists.txt")
        set(LLAMA_CPP_DIR "${CMAKE_CURRENT_SOURCE_DIR}/llama.cpp")
    elseif(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/../../../../llama.cpp/CMakeLists.txt")
        get_filename_component(LLAMA_CPP_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../../../llama.cpp" ABSOLUTE)
    elseif(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/../../../llama.cpp/CMakeLists.txt")
        get_filename_component(LLAMA_CPP_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../../llama.cpp" ABSOLUTE)
    else()
        message(FATAL_ERROR
            "llama.cpp source directory not found. Clone llama.cpp into "
            "app/src/main/cpp/llama.cpp (or ./llama.cpp at project root), "
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
EOF

cat << 'EOF' > app/src/main/cpp/llama_jni.cpp
#include <jni.h>
#include <android/log.h>

#include <algorithm>
#include <atomic>
#include <cstdint>
#include <cstring>
#include <mutex>
#include <string>
#include <vector>

#include "ggml.h"
#include "llama.h"

#define TAG "LlamaCppJNI"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, TAG, __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

namespace {

constexpr int32_t kDefaultThreads = 4;
constexpr uint32_t kDefaultCtxSize = 2048;
constexpr uint32_t kMaxBatchSize = 512;
constexpr uint32_t kMinCtxSize = 256;
constexpr uint32_t kCtxSafetyMargin = 4;

constexpr const char* kDefaultVoiceSystemPrompt =
    "You are a concise, helpful on-device voice assistant. "
    "Respond in natural spoken English using clear, brief sentences without markdown formatting.";

struct LlamaState {
    std::mutex mutex;
    llama_model* model = nullptr;
    llama_context* ctx = nullptr;
    const llama_vocab* vocab = nullptr;
    llama_sampler* smpl = nullptr;
    std::atomic<bool> cancelled{false};
    bool backend_initialized = false;
};

LlamaState g_state;

bool abortGenerationCallback(void* user_data) {
    auto* cancelled_flag = static_cast<std::atomic<bool>*>(user_data);
    return cancelled_flag != nullptr && cancelled_flag->load(std::memory_order_acquire);
}

void llamaAndroidLogCallback(enum ggml_log_level level, const char* text, void* /* user_data */) {
    if (text == nullptr || text[0] == '\0') {
        return;
    }
    switch (level) {
        case GGML_LOG_LEVEL_ERROR:
            __android_log_print(ANDROID_LOG_ERROR, TAG, "%s", text);
            break;
        case GGML_LOG_LEVEL_WARN:
            __android_log_print(ANDROID_LOG_WARN, TAG, "%s", text);
            break;
        case GGML_LOG_LEVEL_INFO:
            __android_log_print(ANDROID_LOG_INFO, TAG, "%s", text);
            break;
        default:
            break;
    }
}

void freeModelResourcesLocked() {
    if (g_state.smpl != nullptr) {
        llama_sampler_free(g_state.smpl);
        g_state.smpl = nullptr;
    }
    if (g_state.ctx != nullptr) {
        llama_free(g_state.ctx);
        g_state.ctx = nullptr;
    }
    if (g_state.model != nullptr) {
        llama_model_free(g_state.model);
        g_state.model = nullptr;
    }
    g_state.vocab = nullptr;
}

// Returns the byte count at the front of `bytes` that forms complete UTF-8 sequences.
// Any trailing incomplete multi-byte sequence (1 to 3 bytes at the end) is held back for the
// next token so Android's JNI bridge never receives split codepoints across BPE tokens.
size_t findCompleteUtf8PrefixLength(const std::string& bytes) {
    const size_t len = bytes.size();
    if (len == 0) {
        return 0;
    }

    size_t scan = len;
    const size_t min_index = len > 3 ? len - 3 : 0;
    while (scan > min_index) {
        const auto byte = static_cast<uint8_t>(bytes[scan - 1]);
        if ((byte & 0x80u) == 0x00u) {
            // Single-byte ASCII at the very end -> complete
            return len;
        }
        if ((byte & 0xC0u) != 0x80u) {
            // Found leading byte of a multi-byte sequence at position (scan - 1)
            size_t expected_seq_len = 1;
            if ((byte & 0xE0u) == 0xC0u) {
                expected_seq_len = 2;
            } else if ((byte & 0xF0u) == 0xE0u) {
                expected_seq_len = 3;
            } else if ((byte & 0xF8u) == 0xF0u) {
                expected_seq_len = 4;
            } else {
                // Invalid UTF-8 start byte -> flush so decoder emits U+FFFD
                return len;
            }

            const size_t available = len - (scan - 1);
            if (available < expected_seq_len) {
                return scan - 1;
            }
            return len;
        }
        --scan;
    }
    return len;
}

// Converts standard UTF-8 bytes (including 4-byte supplementary codepoints/emoji) into UTF-16
// code units for JNI NewString(), completely avoiding Android ART Modified-UTF-8 CheckJNI aborts.
jstring utf8BytesToJString(JNIEnv* env, const char* data, size_t len) {
    std::vector<jchar> utf16;
    utf16.reserve(len);

    size_t i = 0;
    while (i < len) {
        const uint8_t b0 = static_cast<uint8_t>(data[i]);
        uint32_t codepoint = 0xFFFDu;
        size_t advance = 1;

        if ((b0 & 0x80u) == 0x00u) {
            codepoint = b0;
            advance = 1;
        } else if ((b0 & 0xE0u) == 0xC0u && i + 1 < len) {
            const uint8_t b1 = static_cast<uint8_t>(data[i + 1]);
            if ((b1 & 0xC0u) == 0x80u) {
                const uint32_t candidate = ((static_cast<uint32_t>(b0 & 0x1Fu) << 6u) |
                                            static_cast<uint32_t>(b1 & 0x3Fu));
                if (candidate >= 0x80u) {
                    codepoint = candidate;
                    advance = 2;
                }
            }
        } else if ((b0 & 0xF0u) == 0xE0u && i + 2 < len) {
            const uint8_t b1 = static_cast<uint8_t>(data[i + 1]);
            const uint8_t b2 = static_cast<uint8_t>(data[i + 2]);
            if ((b1 & 0xC0u) == 0x80u && (b2 & 0xC0u) == 0x80u) {
                const uint32_t candidate = ((static_cast<uint32_t>(b0 & 0x0Fu) << 12u) |
                                            (static_cast<uint32_t>(b1 & 0x3Fu) << 6u) |
                                            static_cast<uint32_t>(b2 & 0x3Fu));
                if (candidate >= 0x800u && (candidate < 0xD800u || candidate > 0xDFFFu)) {
                    codepoint = candidate;
                    advance = 3;
                }
            }
        } else if ((b0 & 0xF8u) == 0xF0u && i + 3 < len) {
            const uint8_t b1 = static_cast<uint8_t>(data[i + 1]);
            const uint8_t b2 = static_cast<uint8_t>(data[i + 2]);
            const uint8_t b3 = static_cast<uint8_t>(data[i + 3]);
            if ((b1 & 0xC0u) == 0x80u && (b2 & 0xC0u) == 0x80u && (b3 & 0xC0u) == 0x80u) {
                const uint32_t candidate = ((static_cast<uint32_t>(b0 & 0x07u) << 18u) |
                                            (static_cast<uint32_t>(b1 & 0x3Fu) << 12u) |
                                            (static_cast<uint32_t>(b2 & 0x3Fu) << 6u) |
                                            static_cast<uint32_t>(b3 & 0x3Fu));
                if (candidate >= 0x10000u && candidate <= 0x10FFFFu) {
                    codepoint = candidate;
                    advance = 4;
                }
            }
        }

        if (codepoint <= 0xFFFFu) {
            utf16.push_back(static_cast<jchar>(codepoint));
        } else {
            const uint32_t adjusted = codepoint - 0x10000u;
            utf16.push_back(static_cast<jchar>(0xD800u + (adjusted >> 10u)));
            utf16.push_back(static_cast<jchar>(0xDC00u + (adjusted & 0x3FFu)));
        }
        i += advance;
    }

    return env->NewString(utf16.data(), static_cast<jsize>(utf16.size()));
}

bool hasExplicitChatMarkers(const std::string& prompt) {
    return prompt.find("<|im_start|>") != std::string::npos ||
           prompt.find("<|start_header_id|>") != std::string::npos ||
           prompt.find("<start_of_turn>") != std::string::npos ||
           prompt.find("[INST]") != std::string::npos ||
           prompt.find("<|user|>") != std::string::npos;
}

std::string buildModelPrompt(llama_model* model, const std::string& raw_prompt) {
    if (model == nullptr || raw_prompt.empty() || hasExplicitChatMarkers(raw_prompt)) {
        return raw_prompt;
    }

    const char* tmpl = llama_model_chat_template(model, nullptr);
    if (tmpl == nullptr || tmpl[0] == '\0') {
        return raw_prompt;
    }

    llama_chat_message messages[2];
    messages[0].role = "system";
    messages[0].content = kDefaultVoiceSystemPrompt;
    messages[1].role = "user";
    messages[1].content = raw_prompt.c_str();

    const size_t initial_alloc = (std::strlen(kDefaultVoiceSystemPrompt) + raw_prompt.size()) * 2 + 256;
    std::vector<char> formatted(initial_alloc);

    int32_t written = llama_chat_apply_template(
        tmpl,
        messages,
        2,
        true,
        formatted.data(),
        static_cast<int32_t>(formatted.size())
    );

    if (written > static_cast<int32_t>(formatted.size())) {
        formatted.resize(static_cast<size_t>(written) + 1);
        written = llama_chat_apply_template(
            tmpl,
            messages,
            2,
            true,
            formatted.data(),
            static_cast<int32_t>(formatted.size())
        );
    }

    if (written <= 0) {
        return raw_prompt;
    }

    return std::string(formatted.data(), static_cast<size_t>(written));
}

std::string tokenToBytes(const llama_vocab* vocab, llama_token token) {
    char stack_buf[256];
    const int32_t n = llama_token_to_piece(vocab, token, stack_buf, sizeof(stack_buf), 0, false);
    if (n > 0) {
        return std::string(stack_buf, static_cast<size_t>(n));
    }
    if (n < 0) {
        const int32_t needed = -n;
        std::vector<char> heap_buf(static_cast<size_t>(needed));
        const int32_t retry = llama_token_to_piece(vocab, token, heap_buf.data(), needed, 0, false);
        if (retry > 0) {
            return std::string(heap_buf.data(), static_cast<size_t>(retry));
        }
    }
    return std::string();
}

bool emitPieceToKotlin(
    JNIEnv* env,
    jobject callback_obj,
    jmethodID on_token_method,
    const char* utf8_data,
    size_t utf8_len
) {
    if (utf8_len == 0) {
        return true;
    }

    jstring jpiece = utf8BytesToJString(env, utf8_data, utf8_len);
    if (jpiece == nullptr) {
        if (env->ExceptionCheck()) {
            LOGE("JNI exception while allocating token string");
        }
        return false;
    }

    const jboolean keep_going = env->CallBooleanMethod(callback_obj, on_token_method, jpiece);
    const jboolean had_exception = env->ExceptionCheck();
    env->DeleteLocalRef(jpiece);

    if (had_exception) {
        LOGW("Kotlin callback threw exception; halting generation loop");
        return false;
    }

    return keep_going == JNI_TRUE;
}

} // namespace

extern "C" JNIEXPORT jboolean JNICALL
Java_com_heretic_voice_LlamaCppEngine_nativeLoadModel(
    JNIEnv* env,
    jobject /* thiz */,
    jstring modelPath,
    jint nThreads,
    jint nCtx
) {
    if (modelPath == nullptr) {
        LOGE("nativeLoadModel received null modelPath");
        return JNI_FALSE;
    }

    const char* raw_path = env->GetStringUTFChars(modelPath, nullptr);
    if (raw_path == nullptr) {
        LOGE("Failed to acquire UTF chars for modelPath");
        return JNI_FALSE;
    }
    const std::string path_str(raw_path);
    env->ReleaseStringUTFChars(modelPath, raw_path);

    if (path_str.empty()) {
        LOGE("Model path is empty");
        return JNI_FALSE;
    }

    g_state.cancelled.store(true, std::memory_order_release);
    std::lock_guard<std::mutex> lock(g_state.mutex);

    freeModelResourcesLocked();

    if (!g_state.backend_initialized) {
        llama_log_set(llamaAndroidLogCallback, nullptr);
        llama_backend_init();
        g_state.backend_initialized = true;
    }

    g_state.cancelled.store(false, std::memory_order_release);

    llama_model_params mparams = llama_model_default_params();
    mparams.n_gpu_layers = 0;

    g_state.model = llama_model_load_from_file(path_str.c_str(), mparams);
    if (g_state.model == nullptr) {
        LOGE("Failed to load GGUF model from path: %s", path_str.c_str());
        return JNI_FALSE;
    }

    g_state.vocab = llama_model_get_vocab(g_state.model);
    if (g_state.vocab == nullptr) {
        LOGE("Failed to retrieve model vocabulary");
        freeModelResourcesLocked();
        return JNI_FALSE;
    }

    const uint32_t resolved_ctx = nCtx > 0
        ? std::max(static_cast<uint32_t>(nCtx), kMinCtxSize)
        : kDefaultCtxSize;
    const int32_t resolved_threads = nThreads > 0 ? static_cast<int32_t>(nThreads) : kDefaultThreads;
    const uint32_t resolved_batch = std::min(resolved_ctx, kMaxBatchSize);

    llama_context_params cparams = llama_context_default_params();
    cparams.n_ctx = resolved_ctx;
    cparams.n_batch = resolved_batch;
    cparams.n_ubatch = resolved_batch;
    cparams.n_threads = resolved_threads;
    cparams.n_threads_batch = resolved_threads;
    cparams.abort_callback = abortGenerationCallback;
    cparams.abort_callback_data = &g_state.cancelled;

    g_state.ctx = llama_init_from_model(g_state.model, cparams);
    if (g_state.ctx == nullptr) {
        LOGE("Failed to initialize llama_context (n_ctx=%u, n_threads=%d)", resolved_ctx, resolved_threads);
        freeModelResourcesLocked();
        return JNI_FALSE;
    }

    llama_sampler_chain_params sparams = llama_sampler_chain_default_params();
    g_state.smpl = llama_sampler_chain_init(sparams);
    if (g_state.smpl == nullptr) {
        LOGE("Failed to initialize sampler chain");
        freeModelResourcesLocked();
        return JNI_FALSE;
    }

    llama_sampler_chain_add(g_state.smpl, llama_sampler_init_top_k(40));
    llama_sampler_chain_add(g_state.smpl, llama_sampler_init_top_p(0.95f, 1));
    llama_sampler_chain_add(g_state.smpl, llama_sampler_init_min_p(0.05f, 1));
    llama_sampler_chain_add(g_state.smpl, llama_sampler_init_temp(0.7f));
    llama_sampler_chain_add(g_state.smpl, llama_sampler_init_dist(LLAMA_DEFAULT_SEED));

    LOGI("llama.cpp model loaded (n_ctx=%u, n_batch=%u, threads=%d)",
         llama_n_ctx(g_state.ctx),
         llama_n_batch(g_state.ctx),
         resolved_threads);
    return JNI_TRUE;
}

extern "C" JNIEXPORT void JNICALL
Java_com_heretic_voice_LlamaCppEngine_nativeGenerate(
    JNIEnv* env,
    jobject /* thiz */,
    jstring promptStr,
    jobject tokenCallback
) {
    if (promptStr == nullptr || tokenCallback == nullptr) {
        LOGE("nativeGenerate received null promptStr or tokenCallback");
        return;
    }

    const char* raw_prompt = env->GetStringUTFChars(promptStr, nullptr);
    if (raw_prompt == nullptr) {
        LOGE("Failed to acquire UTF chars for promptStr");
        return;
    }
    const std::string user_prompt(raw_prompt);
    env->ReleaseStringUTFChars(promptStr, raw_prompt);

    if (user_prompt.empty()) {
        return;
    }

    jclass cb_class = env->GetObjectClass(tokenCallback);
    if (cb_class == nullptr) {
        LOGE("Failed to resolve TokenCallback class");
        return;
    }
    jmethodID on_token_method = env->GetMethodID(cb_class, "onToken", "(Ljava/lang/String;)Z");
    env->DeleteLocalRef(cb_class);
    if (on_token_method == nullptr) {
        LOGE("Failed to resolve TokenCallback.onToken(String): Boolean");
        return;
    }

    std::lock_guard<std::mutex> lock(g_state.mutex);
    if (g_state.ctx == nullptr || g_state.model == nullptr || g_state.vocab == nullptr || g_state.smpl == nullptr) {
        LOGE("Engine not initialized; aborting nativeGenerate");
        return;
    }

    g_state.cancelled.store(false, std::memory_order_release);

    const std::string formatted_prompt = buildModelPrompt(g_state.model, user_prompt);

    const int32_t required_tokens = -llama_tokenize(
        g_state.vocab,
        formatted_prompt.c_str(),
        static_cast<int32_t>(formatted_prompt.size()),
        nullptr,
        0,
        true,
        true
    );
    if (required_tokens <= 0) {
        LOGE("Failed to calculate prompt token count (code=%d)", required_tokens);
        return;
    }

    std::vector<llama_token> prompt_tokens(static_cast<size_t>(required_tokens));
    const int32_t tokenized_count = llama_tokenize(
        g_state.vocab,
        formatted_prompt.c_str(),
        static_cast<int32_t>(formatted_prompt.size()),
        prompt_tokens.data(),
        static_cast<int32_t>(prompt_tokens.size()),
        true,
        true
    );
    if (tokenized_count < 0) {
        LOGE("Failed to tokenize prompt (code=%d)", tokenized_count);
        return;
    }
    prompt_tokens.resize(static_cast<size_t>(tokenized_count));

    const uint32_t max_ctx = llama_n_ctx(g_state.ctx);
    const uint32_t max_prompt_tokens = max_ctx > (kCtxSafetyMargin + 16u)
        ? (max_ctx - kCtxSafetyMargin - 16u)
        : (max_ctx / 2u);
    if (prompt_tokens.size() > max_prompt_tokens && max_prompt_tokens > 1u) {
        LOGW("Prompt (%zu tokens) exceeds max prompt budget (%u); retaining BOS + tail tokens",
             prompt_tokens.size(),
             max_prompt_tokens);
        const llama_token bos_token = prompt_tokens.front();
        const size_t tail_keep = static_cast<size_t>(max_prompt_tokens - 1u);
        std::vector<llama_token> trimmed;
        trimmed.reserve(max_prompt_tokens);
        trimmed.push_back(bos_token);
        trimmed.insert(
            trimmed.end(),
            prompt_tokens.end() - static_cast<std::ptrdiff_t>(tail_keep),
            prompt_tokens.end()
        );
        prompt_tokens.swap(trimmed);
    }

    llama_memory_t memory = llama_get_memory(g_state.ctx);
    if (memory != nullptr) {
        llama_memory_clear(memory, true);
    }
    llama_sampler_reset(g_state.smpl);

    const uint32_t batch_limit = std::max<uint32_t>(1u, llama_n_batch(g_state.ctx));
    uint32_t n_past = 0;

    for (size_t offset = 0; offset < prompt_tokens.size(); offset += batch_limit) {
        if (g_state.cancelled.load(std::memory_order_acquire)) {
            return;
        }
        const int32_t chunk_len = static_cast<int32_t>(
            std::min<size_t>(batch_limit, prompt_tokens.size() - offset)
        );
        llama_batch batch = llama_batch_get_one(prompt_tokens.data() + offset, chunk_len);
        const int32_t rc = llama_decode(g_state.ctx, batch);
        if (rc != 0) {
            if (!g_state.cancelled.load(std::memory_order_acquire)) {
                LOGE("Prompt evaluation failed at offset %zu (rc=%d)", offset, rc);
            }
            return;
        }
        n_past += static_cast<uint32_t>(chunk_len);
    }

    std::string pending_utf8;
    llama_token curr_token = llama_sampler_sample(g_state.smpl, g_state.ctx, -1);

    while (!g_state.cancelled.load(std::memory_order_acquire) &&
           !llama_vocab_is_eog(g_state.vocab, curr_token) &&
           n_past + 1u < max_ctx) {
        const std::string piece_bytes = tokenToBytes(g_state.vocab, curr_token);
        if (!piece_bytes.empty()) {
            pending_utf8.append(piece_bytes);
            const size_t ready_len = findCompleteUtf8PrefixLength(pending_utf8);
            if (ready_len > 0) {
                const bool keep_going = emitPieceToKotlin(
                    env,
                    tokenCallback,
                    on_token_method,
                    pending_utf8.data(),
                    ready_len
                );
                pending_utf8.erase(0, ready_len);
                if (!keep_going) {
                    g_state.cancelled.store(true, std::memory_order_release);
                    break;
                }
            }
        }

        if (g_state.cancelled.load(std::memory_order_acquire)) {
            break;
        }

        llama_batch next_batch = llama_batch_get_one(&curr_token, 1);
        const int32_t decode_rc = llama_decode(g_state.ctx, next_batch);
        if (decode_rc != 0) {
            if (!g_state.cancelled.load(std::memory_order_acquire)) {
                LOGE("Decode error during token generation loop (rc=%d)", decode_rc);
            }
            break;
        }
        ++n_past;
        curr_token = llama_sampler_sample(g_state.smpl, g_state.ctx, -1);
    }

    // Flush any remaining trailing bytes if generation ended cleanly without cancellation
    if (!pending_utf8.empty() && !g_state.cancelled.load(std::memory_order_acquire)) {
        emitPieceToKotlin(
            env,
            tokenCallback,
            on_token_method,
            pending_utf8.data(),
            pending_utf8.size()
        );
    }
}

extern "C" JNIEXPORT void JNICALL
Java_com_heretic_voice_LlamaCppEngine_nativeStop(
    JNIEnv* /* env */,
    jobject /* thiz */
) {
    g_state.cancelled.store(true, std::memory_order_release);
}

extern "C" JNIEXPORT void JNICALL
Java_com_heretic_voice_LlamaCppEngine_nativeRelease(
    JNIEnv* /* env */,
    jobject /* thiz */
) {
    g_state.cancelled.store(true, std::memory_order_release);
    std::lock_guard<std::mutex> lock(g_state.mutex);

    freeModelResourcesLocked();

    if (g_state.backend_initialized) {
        llama_backend_free();
        g_state.backend_initialized = false;
    }

    LOGI("llama.cpp resources freed");
}
EOF

cat << 'EOF' > app/src/main/kotlin/com/heretic/voice/LlamaCppEngine.kt
package com.heretic.voice

import android.util.Log
import java.io.Closeable
import java.io.File

class LlamaCppEngine : Closeable {
    companion object {
        private const val TAG = "LlamaCppEngine"
        private const val MIN_CONTEXT_SIZE = 256

        @Volatile
        var isNativeLibraryLoaded: Boolean = false
            private set

        init {
            // Load transitive shared libraries first when built with BUILD_SHARED_LIBS=ON;
            // silently continue when statically linked into libllama_jni.so.
            val optionalSharedDeps = arrayOf("ggml-base", "ggml-cpu", "ggml", "llama")
            for (dep in optionalSharedDeps) {
                try {
                    System.loadLibrary(dep)
                } catch (_: UnsatisfiedLinkError) {
                    // Dependency is statically compiled into libllama_jni.so
                }
            }

            isNativeLibraryLoaded = try {
                System.loadLibrary("llama_jni")
                true
            } catch (e: UnsatisfiedLinkError) {
                Log.e(TAG, "Native library load failed for libllama_jni.so", e)
                false
            }
        }
    }

    fun interface TokenCallback {
        fun onToken(piece: String): Boolean
    }

    private val engineLock = Any()

    private external fun nativeLoadModel(modelPath: String, nThreads: Int, nCtx: Int): Boolean
    private external fun nativeGenerate(prompt: String, callback: TokenCallback)
    private external fun nativeStop()
    private external fun nativeRelease()

    @Volatile
    var isLoaded: Boolean = false
        private set

    fun load(modelPath: String, nThreads: Int = 4, nCtx: Int = 2048): Boolean {
        if (!isNativeLibraryLoaded) {
            Log.e(TAG, "Cannot load model: libllama_jni.so is not loaded")
            return false
        }
        val cleanPath = modelPath.trim()
        if (cleanPath.isEmpty()) {
            Log.e(TAG, "Cannot load model: modelPath is blank")
            return false
        }
        val modelFile = File(cleanPath)
        if (!modelFile.exists() || !modelFile.isFile || !modelFile.canRead()) {
            Log.e(TAG, "Cannot load model: file missing or unreadable at $cleanPath")
            return false
        }

        val maxCpuThreads = Runtime.getRuntime().availableProcessors().coerceAtLeast(1)
        val resolvedThreads = nThreads.coerceIn(1, maxCpuThreads)
        val resolvedCtx = nCtx.coerceAtLeast(MIN_CONTEXT_SIZE)

        synchronized(engineLock) {
            isLoaded = nativeLoadModel(modelFile.absolutePath, resolvedThreads, resolvedCtx)
            return isLoaded
        }
    }

    fun generate(prompt: String, onToken: (String) -> Boolean) {
        if (!isNativeLibraryLoaded || !isLoaded || prompt.isBlank()) {
            return
        }
        synchronized(engineLock) {
            if (!isLoaded) {
                return
            }
            nativeGenerate(prompt, TokenCallback { piece -> onToken(piece) })
        }
    }

    fun stop() {
        if (isNativeLibraryLoaded) {
            nativeStop()
        }
    }

    override fun close() {
        if (!isNativeLibraryLoaded) {
            isLoaded = false
            return
        }
        nativeStop()
        synchronized(engineLock) {
            nativeRelease()
            isLoaded = false
        }
    }
}
EOF

cat << 'EOF' > app/src/main/kotlin/com/heretic/voice/SentenceStreamingBuffer.kt
package com.heretic.voice

class SentenceStreamingBuffer(
    private val onSentenceReady: suspend (String) -> Unit
) {
    companion object {
        private val TERMINAL_PUNCTUATION = charArrayOf('.', '!', '?')
        private val TRAILING_CLOSERS = charArrayOf('"', '\'', '\u2019', '\u201D', ')', ']', '}')
        private const val SOFT_CLAUSE_SPLIT_LENGTH = 220
        private val CLAUSE_DELIMITERS = charArrayOf(';', ':', ',')

        private val ABBREVIATIONS = setOf(
            "mr.", "mrs.", "ms.", "dr.", "prof.", "sr.", "jr.", "st.",
            "vs.", "etc.", "e.g.", "i.e.", "u.s.", "u.k.", "fig.", "no."
        )
    }

    private val buffer = StringBuilder()

    suspend fun appendPiece(piece: String) {
        if (piece.isEmpty()) return
        synchronized(buffer) {
            buffer.append(piece)
        }
        drainCompleteSentences()
    }

    private suspend fun drainCompleteSentences() {
        while (true) {
            val nextSentence: String = synchronized(buffer) {
                val splitEndExclusive = findConfirmedBoundaryEnd(buffer)
                if (splitEndExclusive == -1) {
                    null
                } else {
                    val extracted = buffer.substring(0, splitEndExclusive).trim()
                    buffer.delete(0, splitEndExclusive)
                    extracted
                }
            } ?: break

            if (nextSentence.isNotBlank()) {
                onSentenceReady(nextSentence)
            }
        }
    }

    private fun findConfirmedBoundaryEnd(text: CharSequence): Int {
        val len = text.length
        var i = 0
        while (i < len) {
            val ch = text[i]
            if (ch == '\n') {
                var end = i + 1
                while (end < len && text[end] == '\n') {
                    end++
                }
                return end
            }

            if (ch in TERMINAL_PUNCTUATION) {
                // Consume consecutive terminal punctuation such as "..." or "?!"
                var punctEnd = i
                while (punctEnd + 1 < len && text[punctEnd + 1] in TERMINAL_PUNCTUATION) {
                    punctEnd++
                }

                // Consume immediately attached closing quotes or brackets
                var closerEnd = punctEnd
                while (closerEnd + 1 < len && text[closerEnd + 1] in TRAILING_CLOSERS) {
                    closerEnd++
                }

                // Wait for at least one lookahead character so decimals ("3." + "14") and
                // ellipses ("." + "..") split across adjacent tokens are never cut prematurely.
                if (closerEnd + 1 >= len) {
                    return -1
                }

                val nextChar = text[closerEnd + 1]

                // Guard decimal numbers such as 3.14
                val isDecimal = ch == '.' &&
                    punctEnd == i &&
                    i > 0 && text[i - 1].isDigit() &&
                    nextChar.isDigit()

                if (!isDecimal && nextChar.isWhitespace() && !endsWithAbbreviation(text, i)) {
                    return closerEnd + 1
                }

                i = closerEnd + 1
                continue
            }

            i++
        }

        // Low-latency fallback for long run-on clauses without terminal punctuation
        if (len >= SOFT_CLAUSE_SPLIT_LENGTH) {
            for (k in (len - 2) downTo (SOFT_CLAUSE_SPLIT_LENGTH / 2)) {
                if (text[k] in CLAUSE_DELIMITERS && text[k + 1].isWhitespace()) {
                    return k + 1
                }
            }
        }

        return -1
    }

    private fun endsWithAbbreviation(text: CharSequence, periodIndex: Int): Boolean {
        if (text[periodIndex] != '.') return false
        var wordStart = periodIndex
        while (wordStart > 0 && !text[wordStart - 1].isWhitespace()) {
            wordStart--
        }
        val token = text.subSequence(wordStart, periodIndex + 1)
            .toString()
            .trimStart('(', '[', '{', '"', '\'', '\u2018', '\u201C')
            .lowercase()

        if (token in ABBREVIATIONS) {
            return true
        }
        // Single-letter middle initial such as "J. R. R. Tolkien"
        if (token.length == 2 && token[0].isLetter() && token[1] == '.') {
            return true
        }
        return false
    }

    suspend fun flush() {
        val remaining = synchronized(buffer) {
            val snapshot = buffer.toString().trim()
            buffer.setLength(0)
            snapshot
        }
        if (remaining.isNotBlank()) {
            onSentenceReady(remaining)
        }
    }

    fun clear() {
        synchronized(buffer) {
            buffer.setLength(0)
        }
    }
}
EOF

cat << 'EOF' > app/src/main/kotlin/com/heretic/voice/UnifiedVoiceOrchestrator.kt
package com.heretic.voice

import android.content.Context
import android.util.Log
import com.brahmadeo.supertonic.tts.SupertonicTTS
import com.brahmadeo.supertonic.tts.utils.LexiconManager
import com.brahmadeo.supertonic.tts.utils.TextNormalizer
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.schabi.parakeetype.audio.AudioCaptureManager
import org.schabi.parakeetype.audio.SpeechEndpointer
import org.schabi.parakeetype.inference.InferenceRepository
import org.schabi.parakeetype.inference.ParakeetEngine
import org.schabi.parakeetype.inference.TranscriptResult
import java.io.File
import java.util.concurrent.atomic.AtomicLong

class UnifiedVoiceOrchestrator(
    private val context: Context,
    private val sttModelDir: File,
    private val ttsModelDir: File,
    private val llamaModelPath: String,
    private val voiceStylePath: String
) {
    companion object {
        private const val TAG = "UnifiedVoiceOrchestrator"
        private const val STOP_KEYWORD = "shaz"
        private const val ENDPOINTER_SILENCE_MS = 1200L
        private const val ENDPOINTER_MIN_LENGTH_MS = 256L
        private const val DEFAULT_LLAMA_THREADS = 4
        private const val DEFAULT_LLAMA_CTX = 2048
        private const val DEFAULT_ORT_THREADS = 4
        private const val DEFAULT_XNN_THREADS = 1
        private const val TTS_LANG = "en"
        private const val TTS_SPEED = 1.05f
        private const val TTS_STEPS = 5
        private const val TTS_GAIN = 2.5f
        private const val TTS_SIBILANCE_MODE = 1
    }

    private val appContext = context.applicationContext
    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())
    private val pipelineMutex = Mutex()
    private val generationCounter = AtomicLong(0L)

    private val textNormalizer = TextNormalizer()
    private val captureManager = AudioCaptureManager(appContext)
    private val parakeetEngine = ParakeetEngine()
    private val inferenceRepo = InferenceRepository(parakeetEngine)
    private val llamaEngine = LlamaCppEngine()

    @Volatile
    private var isSpeaking = false

    @Volatile
    private var isShutdown = false

    private var captureJob: Job? = null
    private var currentGenJob: Job? = null

    suspend fun init(): Boolean = withContext(Dispatchers.IO) {
        check(!isShutdown) { "UnifiedVoiceOrchestrator has already been shut down" }

        LexiconManager.load(appContext)

        if (!parakeetEngine.isLoaded) {
            parakeetEngine.load(sttModelDir)
        }

        val libPath = File(appContext.applicationInfo.nativeLibraryDir, "libonnxruntime.so").absolutePath
        val ttsReady = SupertonicTTS.initialize(
            ttsModelDir.absolutePath,
            libPath,
            DEFAULT_ORT_THREADS,
            DEFAULT_XNN_THREADS
        )
        if (!ttsReady) {
            Log.e(TAG, "SupertonicTTS failed to initialize from ${ttsModelDir.absolutePath}")
        }

        val llmReady = llamaEngine.load(
            modelPath = llamaModelPath,
            nThreads = DEFAULT_LLAMA_THREADS,
            nCtx = DEFAULT_LLAMA_CTX
        )
        if (!llmReady) {
            Log.e(TAG, "LlamaCppEngine failed to load model from $llamaModelPath")
        }

        parakeetEngine.isLoaded && ttsReady && llmReady
    }

    fun startListening(
        onFinalTranscript: (String) -> Unit,
        onTtsChunk: (ByteArray) -> Unit
    ) {
        if (isShutdown) {
            Log.w(TAG, "Ignoring startListening(): orchestrator is shut down")
            return
        }

        captureManager.stopCapture()
        captureJob?.cancel()

        captureJob = scope.launch(Dispatchers.IO) {
            var endpointer = newSpeechEndpointer()

            val audioFlow = captureManager.startCapture(
                vadEnabled = true,
                onSpeechProbability = { prob ->
                    when (endpointer.onFrame(prob)) {
                        SpeechEndpointer.Event.SpeechStart -> {
                            if (isSpeaking) {
                                Log.i(TAG, "VAD speech start detected during TTS; stopping playback")
                                stopPlayback()
                            }
                        }
                        SpeechEndpointer.Event.EndOfSpeech,
                        SpeechEndpointer.Event.NoSpeech -> {
                            endpointer = newSpeechEndpointer()
                        }
                        null -> Unit
                    }
                }
            )

            try {
                inferenceRepo.transcribe(audioFlow).collect { result ->
                    when (result) {
                        is TranscriptResult.Final -> {
                            val userText = result.text.trim()
                            if (userText.isBlank()) {
                                return@collect
                            }

                            onFinalTranscript(userText)

                            if (isStopCommand(userText)) {
                                Log.i(TAG, "Stop keyword detected in transcript; halting playback")
                                stopPlayback()
                                return@collect
                            }

                            runPipeline(userText, onTtsChunk)
                        }
                        is TranscriptResult.Failure -> {
                            Log.w(TAG, "STT stream reported failure", result.cause)
                        }
                        else -> Unit
                    }
                }
            } catch (ce: CancellationException) {
                throw ce
            } catch (e: SecurityException) {
                Log.e(TAG, "RECORD_AUDIO permission missing while starting audio capture", e)
            } catch (e: Exception) {
                Log.e(TAG, "Unexpected exception inside STT listening loop", e)
            }
        }
    }

    fun stopListening() {
        captureManager.stopCapture()
        captureJob?.cancel()
        captureJob = null
    }

    private fun runPipeline(prompt: String, onTtsChunk: (ByteArray) -> Unit) {
        val turnId = generationCounter.incrementAndGet()

        // Signal any in-flight LLM decode or TTS synthesis to abort immediately
        llamaEngine.stop()
        SupertonicTTS.setCancelled(true)
        currentGenJob?.cancel()

        currentGenJob = scope.launch(Dispatchers.IO) {
            pipelineMutex.withLock {
                if (!currentCoroutineContext().isActive || generationCounter.get() != turnId) {
                    return@withLock
                }

                isSpeaking = true
                val sentenceBuffer = SentenceStreamingBuffer { sentence ->
                    if (!currentCoroutineContext().isActive ||
                        SupertonicTTS.isCancelled() ||
                        generationCounter.get() != turnId
                    ) {
                        return@SentenceStreamingBuffer
                    }

                    val normalized = textNormalizer.normalize(sentence, TTS_LANG, false).trim()
                    if (normalized.isEmpty()) {
                        return@SentenceStreamingBuffer
                    }

                    val audio = SupertonicTTS.generateAudio(
                        text = normalized,
                        lang = TTS_LANG,
                        stylePath = voiceStylePath,
                        speed = TTS_SPEED,
                        steps = TTS_STEPS,
                        gain = TTS_GAIN,
                        sibilanceMode = TTS_SIBILANCE_MODE
                    )

                    if (audio != null &&
                        audio.isNotEmpty() &&
                        !SupertonicTTS.isCancelled() &&
                        currentCoroutineContext().isActive &&
                        generationCounter.get() == turnId
                    ) {
                        onTtsChunk(audio)
                    }
                }

                try {
                    SupertonicTTS.reset()
                    SupertonicTTS.setCancelled(false)

                    val pipelineJob = currentCoroutineContext()[Job]
                    llamaEngine.generate(prompt) { token ->
                        if (pipelineJob?.isActive == false ||
                            SupertonicTTS.isCancelled() ||
                            generationCounter.get() != turnId
                        ) {
                            false
                        } else {
                            runBlocking {
                                sentenceBuffer.appendPiece(token)
                            }
                            !SupertonicTTS.isCancelled() &&
                                pipelineJob?.isActive != false &&
                                generationCounter.get() == turnId
                        }
                    }

                    if (currentCoroutineContext().isActive &&
                        !SupertonicTTS.isCancelled() &&
                        generationCounter.get() == turnId
                    ) {
                        sentenceBuffer.flush()
                    } else {
                        sentenceBuffer.clear()
                    }
                } catch (ce: CancellationException) {
                    sentenceBuffer.clear()
                    throw ce
                } catch (e: Exception) {
                    sentenceBuffer.clear()
                    Log.e(TAG, "Error during LLM->TTS streaming pipeline", e)
                } finally {
                    if (generationCounter.get() == turnId) {
                        isSpeaking = false
                    }
                }
            }
        }
    }

    fun stopPlayback() {
        generationCounter.incrementAndGet()
        llamaEngine.stop()
        SupertonicTTS.setCancelled(true)
        currentGenJob?.cancel()
        currentGenJob = null
        isSpeaking = false
    }

    fun shutdown() {
        if (isShutdown) return
        isShutdown = true

        stopPlayback()
        stopListening()
        scope.cancel()

        try {
            parakeetEngine.close()
        } catch (e: Exception) {
            Log.w(TAG, "Error closing ParakeetEngine", e)
        }

        try {
            SupertonicTTS.release()
        } catch (e: Exception) {
            Log.w(TAG, "Error releasing SupertonicTTS", e)
        }

        try {
            llamaEngine.close()
        } catch (e: Exception) {
            Log.w(TAG, "Error closing LlamaCppEngine", e)
        }
    }

    private fun newSpeechEndpointer(): SpeechEndpointer =
        SpeechEndpointer(
            silenceMs = ENDPOINTER_SILENCE_MS,
            minimumLengthMs = ENDPOINTER_MIN_LENGTH_MS
        )

    private fun isStopCommand(transcript: String): Boolean {
        val stripped = transcript.trim().trim { !it.isLetterOrDigit() }.trim()
        if (stripped.isEmpty()) return false
        return stripped.equals(STOP_KEYWORD, ignoreCase = true) ||
            stripped.startsWith("$STOP_KEYWORD ", ignoreCase = true) ||
            stripped.endsWith(" $STOP_KEYWORD", ignoreCase = true)
    }
}
EOF
