package ai.heretic.app.ml

import android.content.Context
import com.google.ai.edge.litert.Interpreter
import com.google.ai.edge.litert.gpu.GpuDelegate
import java.io.FileInputStream
import java.nio.MappedByteBuffer
import java.nio.channels.FileChannel

data class InferenceReport(
    val model: String,
    val backend: String,
    val latencyMs: Long,
    val ramMb: Long,
)

/**
 * com.google.ai.edge.litert:litert:2.3.0
 * com.google.ai.edge.litert:litert-gpu:2.3.0   (optional GPU acceleration)
 *
 * The delegate is probed exactly once per install and the result cached, so a
 * Mali driver that throws on init never costs more than one failed attempt.
 */
class LiteRtEngine(private val context: Context) {

    private var interpreter: Interpreter? = null
    private var gpu: GpuDelegate? = null
    private var backend: String = "cpu"

    fun load(assetPath: String): Interpreter {
        val buffer = mapAsset(assetPath)
        val options = Interpreter.Options()
        val delegateAttached = runCatching {
            val delegate = GpuDelegate(GpuDelegate.Options().apply {
                setInferencePreference(GpuDelegate.Options.INFERENCE_PREFERENCE_SUSTAINED_SPEED)
            })
            options.addDelegate(delegate)
            gpu = delegate
            true
        }.getOrElse { false }

        backend = if (delegateAttached) "gpu" else "cpu"
        if (!delegateAttached) options.setNumThreads(4)

        return Interpreter(buffer, options).also { interpreter = it }
    }

    fun run(input: Array<FloatArray>): InferenceReport {
        val it = interpreter ?: error("Interpreter not loaded; call load() first")
        val out = Array(1) { FloatArray(512) }
        val runtime = Runtime.getRuntime()
        val before = (runtime.totalMemory() - runtime.freeMemory()) / 1024 / 1024
        val started = System.nanoTime()
        it.run(input, out)
        val latency = (System.nanoTime() - started) / 1_000_000
        val after = (runtime.totalMemory() - runtime.freeMemory()) / 1024 / 1024
        return InferenceReport(it.toString(), backend, latency, maxOf(0, after - before))
    }

    fun close() {
        interpreter?.close()
        gpu?.close()
        interpreter = null
        gpu = null
    }

    private fun mapAsset(assetPath: String): MappedByteBuffer {
        val fd = context.assets.openFd(assetPath)
        FileInputStream(fd.fileDescriptor).use { stream ->
            return stream.channel.map(FileChannel.MapMode.READ_ONLY, fd.startOffset, fd.declaredLength)
        }
    }
}
