package ai.heretic.app.core

data class FileAssessment(
    val fileName: String,
    val relevance: String,
    val usefulness: Int,
    val whyNotUseful: String?,
    val rationale: String,
    val integrationSteps: List<String>,
    val targetModule: String,
    val kind: String,
)

private data class FileRule(
    val ext: List<String>,
    val kind: String,
    val relevance: String,
    val usefulness: Int,
    val target: String,
    val rationale: String,
    val why: String? = null,
    val steps: List<String>,
)

object FileAssessor {

    private val rules = listOf(
        FileRule(
            ext = listOf(".litertlm"),
            kind = "LiteRT-LM weight bundle",
            relevance = "WORKS",
            usefulness = 99,
            target = "context.filesDir/models",
            rationale = "A .litertlm container is what litertlm-android:0.18.0 loads natively: Gemma 4 E2B " +
                "(gemma-4-e2b-it-int4.litertlm, ~2.58 GB) is the default on 6 GB+ devices and Gemma 3n E2B " +
                "(gemma-3n-e2b-it-int4.litertlm, ~1.48 GB) is the automatic fallback.",
            steps = listOf(
                "Pick the file through ACTION_OPEN_DOCUMENT; MainActivity streams it into filesDir/models " +
                    "with copyUriToModelsDir and a .part file.",
                "Check LiteRtLmEngine.isArm64Device() first: litertlm-android 0.18.0 ships arm64-v8a only.",
                "Boot with Engine(EngineConfig(modelPath = file.absolutePath, backend = Backend.CPU())) " +
                    "on a background dispatcher, then createConversation().",
                "Keep the weights out of the APK: at this size they are a first-run import, never an asset.",
            ),
        ),
        FileRule(
            ext = listOf(".tflite", ".task"),
            kind = "LiteRT model",
            relevance = "WORKS",
            usefulness = 97,
            target = "app/src/main/assets/models",
            rationale = "Flatbuffer LiteRT model: litert:2.3.0 loads it directly and litert-gpu:2.3.0 attaches the GPU delegate with no conversion.",
            steps = listOf(
                "Copy to assets/models or stream into filesDir when larger than 40 MB.",
                "Declare litert:2.3.0 and litert-gpu:2.3.0 in app/build.gradle.kts.",
                "Open with Interpreter(mappedBuffer, options) trying GpuDelegate then CPU.",
                "Register an inference profile and record latency + RAM.",
            ),
        ),
        FileRule(
            ext = listOf(".gguf"),
            kind = "llama.cpp weights",
            relevance = "WORKS",
            usefulness = 88,
            target = "filesDir/models",
            rationale = "GGUF is consumed by the llama.cpp JNI layer; Q4_K_M and smaller fit a handset.",
            steps = listOf(
                "Keep outside the APK; copy into context.filesDir/models.",
                "Build llama.cpp for arm64-v8a and armeabi-v7a.",
                "Load with n_ctx <= 4096 and n_batch = 512 for thermals.",
                "Refuse float32 checkpoints with a clear message.",
            ),
        ),
        FileRule(
            ext = listOf(".zip"),
            kind = "Voice model bundle (.zip)",
            relevance = "WORKS",
            usefulness = 95,
            target = "filesDir/voice_models/{stt,tts}",
            rationale = "Parakeet TDT STT (parakeet-tdt-stt-models.zip) and Supertonic ONNX TTS " +
                "(supertonic-tts-models.zip) extract directly into app-private storage via SAF ZipInputStream.",
            steps = listOf(
                "Open Models tab and tap Import STT .zip or Import TTS .zip.",
                "VoiceModelConfigStore verifies ONNX weights, vocab.txt, tts.json, and voice_styles/*.json.",
                "Tap Activate Neural Engines to run offline STT and neural TTS.",
            ),
        ),
        FileRule(
            ext = listOf(".onnx"),
            kind = "ONNX model",
            relevance = "PARTIALLY MATCHES",
            usefulness = 61,
            target = "app/src/main/assets/models (converted)",
            rationale = "Runs only through onnxruntime-android, which adds ~20 MB per ABI; converting to LiteRT is smaller and already supported.",
            steps = listOf(
                "Prefer onnx2tf conversion to .tflite.",
                "If an op is lost, isolate ORT behind a single interface.",
                "Restrict abiFilters so only arm64-v8a ships ORT.",
                "Record the decision with its mandatory reasoning sentence.",
            ),
        ),
        FileRule(
            ext = listOf(".wav", ".pcm"),
            kind = "Audio sample",
            relevance = "WORKS",
            usefulness = 79,
            target = "app/src/main/assets/voice",
            rationale = "Usable as an STT regression fixture provided it is 16 kHz mono 16-bit PCM.",
            steps = listOf(
                "Verify with ffprobe; expect pcm_s16le 16000 Hz mono.",
                "Resample with ffmpeg -ar 16000 -ac 1 -sample_fmt s16.",
                "Add the expected transcript to the unit test fixture.",
            ),
        ),
        FileRule(
            ext = listOf(".kt", ".java"),
            kind = "Source file",
            relevance = "WORKS",
            usefulness = 92,
            target = "app/src/main/java/ai/heretic/app",
            rationale = "Native source drops straight into the module; the package must match the directory.",
            steps = listOf(
                "Place under ai/heretic/app/<layer>/ and align the package declaration.",
                "Add dependencies in app/build.gradle.kts.",
                "Expose new capability through HereticJsBridge if the WebView needs it.",
                "Run :app:compileDebugKotlin then the unit tests.",
            ),
        ),
        FileRule(
            ext = listOf(".bin", ".safetensors", ".pt", ".ckpt"),
            kind = "Unquantised weights",
            relevance = "NOT RELEVANT",
            usefulness = 12,
            target = "-",
            rationale = "Raw float checkpoints cannot be loaded on a handset without conversion.",
            why = "float16/float32 checkpoints are 4-8x larger than the Q4 equivalents and exceed the per-process heap ceiling.",
            steps = listOf(
                "Quantise with llama-quantize to Q4_K_M.",
                "Or convert to int8 .tflite with onnx2tf.",
                "Re-assess the produced file.",
            ),
        ),
        FileRule(
            ext = listOf(".pdf", ".docx", ".md", ".txt"),
            kind = "Document",
            relevance = "NOT RELEVANT",
            usefulness = 18,
            target = "-",
            rationale = "Documentation, not a runtime asset.",
            why = "There is no document parsing pipeline and shipping prose inflates the APK without adding capability.",
            steps = listOf("Store in docs/ and link from the README.", "Turn specs into milestones.", "Record decisions in the log."),
        ),
    )

    fun assess(fileName: String, sizeBytes: Long = 0L): FileAssessment {
        val name = fileName.substringAfterLast('/').substringAfterLast('\\')
        val ext = if (name.contains('.')) "." + name.substringAfterLast('.').lowercase() else ""
        val rule = rules.firstOrNull { ext in it.ext } ?: FileRule(
            ext = emptyList(),
            kind = "Unknown",
            relevance = "NOT RELEVANT",
            usefulness = 8,
            target = "-",
            rationale = "No rule matches this extension, so it is treated as inert.",
            why = "HereticCore only grades formats with an explicit integration path.",
            steps = listOf("Tell me what the file contains and I will re-grade it."),
        )

        var usefulness = rule.usefulness
        var rationale = rule.rationale
        val steps = rule.steps.toMutableList()
        if (sizeBytes > 400L * 1024 * 1024 && rule.relevance == "WORKS") {
            if (rule.kind == "LiteRT-LM weight bundle") {
                // A 1.5-2.6 GB bundle is the expected shape for .litertlm, and the
                // SAF -> filesDir/models streaming path is already implemented, so
                // the grade holds instead of being penalised for its size.
                rationale += " At ${sizeBytes / 1024 / 1024} MB it streams into filesDir/models on import " +
                    "(copyUriToModelsDir, .part file, free-space check); it is never an APK asset."
            } else {
                usefulness = maxOf(28, usefulness - 26)
                rationale += " At ${sizeBytes / 1024 / 1024} MB it must ship as a first-run download into filesDir, never as an asset."
                steps.add(0, "Stream into context.filesDir and verify free space before loading.")
            }
        }

        return FileAssessment(
            fileName = name,
            relevance = rule.relevance,
            usefulness = usefulness,
            whyNotUseful = if (rule.relevance == "NOT RELEVANT") rule.why ?: rationale else null,
            rationale = rationale,
            integrationSteps = steps,
            targetModule = rule.target,
            kind = rule.kind,
        )
    }
}
