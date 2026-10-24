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
