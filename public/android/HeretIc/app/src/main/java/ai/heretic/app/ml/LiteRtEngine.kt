package ai.heretic.app.ml

import android.content.Context
import com.google.ai.edge.litert.Accelerator
import com.google.ai.edge.litert.CompiledModel

data class InferenceReport(
    val model: String,
    val backend: String,
    val latencyMs: Long,
    val ramMb: Long,
)

/**
 * On-device inference through the LiteRT 2.x CompiledModel API.
 *
 * com.google.ai.edge.litert:litert:2.3.0
 * com.google.ai.edge.litert:litert-gpu:2.3.0   (optional GPU acceleration)
 *
 * GPU is tried first; if the device or driver refuses it, the model is compiled
 * for the CPU instead, so a failed GPU probe costs one attempt.
 */
class LiteRtEngine(private val context: Context) {

    private var model: CompiledModel? = null
    private var modelName: String = ""
    private var backend: String = "cpu"

    /** Loads a .tflite model bundled under app/src/main/assets/models/. */
    fun load(assetPath: String): CompiledModel {
        close()
        val gpu = runCatching {
            CompiledModel.create(context.assets, assetPath, CompiledModel.Options(Accelerator.GPU), null)
        }
        val compiled = gpu.getOrNull() ?: CompiledModel.create(
            context.assets,
            assetPath,
            CompiledModel.Options(Accelerator.CPU),
            null,
        )
        backend = if (gpu.isSuccess) "gpu" else "cpu"
        modelName = assetPath
        model = compiled
        return compiled
    }

    /** Runs one inference. Each input array fills the matching input tensor. */
    fun run(input: Array<FloatArray>): InferenceReport {
        val m = model ?: error("Model not loaded; call load() first")
        val inputs = m.createInputBuffers()
        val outputs = m.createOutputBuffers()
        input.forEachIndexed { index, data -> inputs[index].writeFloat(data) }

        val runtime = Runtime.getRuntime()
        val before = (runtime.totalMemory() - runtime.freeMemory()) / 1024 / 1024
        val started = System.nanoTime()
        m.run(inputs, outputs)
        val latency = (System.nanoTime() - started) / 1_000_000
        val after = (runtime.totalMemory() - runtime.freeMemory()) / 1024 / 1024
        return InferenceReport(modelName, backend, latency, maxOf(0, after - before))
    }

    fun close() {
        model?.close()
        model = null
    }
}
