package ai.heretic.app.core

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

data class Decision(
    val ref: String,
    val title: String,
    val context: String,
    val options: List<String>,
    val choice: String,
    val reasoning: String,
    val impact: String,
)

object DecisionRule {
    const val MIN_WORDS = 12

    fun validate(title: String, choice: String, reasoning: String): List<String> {
        val errors = mutableListOf<String>()
        val words = reasoning.trim().split(Regex("\\s+")).filter { it.isNotBlank() }
        if (title.trim().length < 4) errors += "A decision needs a title of at least 4 characters."
        if (choice.trim().length < 2) errors += "Record the option that was actually chosen."
        if (reasoning.isBlank()) errors += "The mandatory reasoning sentence is missing."
        else {
            if (!Regex("\\bbecause\\b", RegexOption.IGNORE_CASE).containsMatchIn(reasoning)) {
                errors += "The reasoning sentence must contain the word because."
            }
            if (words.size < MIN_WORDS) errors += "The reasoning sentence must be at least $MIN_WORDS words (currently ${words.size})."
        }
        return errors
    }
}

/** Append-only JSON lines store inside the app sandbox. Never synced. */
class DecisionLogger(context: Context) {

    private val file = File(context.filesDir, "decisions.jsonl")

    fun append(decision: Decision): Result<Decision> {
        val errors = DecisionRule.validate(decision.title, decision.choice, decision.reasoning)
        if (errors.isNotEmpty()) return Result.failure(IllegalStateException(errors.joinToString(" ")))
        val json = JSONObject().apply {
            put("ref", decision.ref)
            put("title", decision.title)
            put("context", decision.context)
            put("options", JSONArray(decision.options))
            put("choice", decision.choice)
            put("reasoning", decision.reasoning)
            put("impact", decision.impact)
            put("at", System.currentTimeMillis())
        }
        file.appendText(json.toString() + "\n")
        return Result.success(decision)
    }

    fun all(): List<Decision> = runCatching {
        file.readLines().filter { it.isNotBlank() }.map {
            val o = JSONObject(it)
            Decision(
                ref = o.getString("ref"),
                title = o.getString("title"),
                context = o.optString("context"),
                options = o.optJSONArray("options")?.let { a -> (0 until a.length()).map { a.getString(it) } } ?: emptyList(),
                choice = o.getString("choice"),
                reasoning = o.getString("reasoning"),
                impact = o.optString("impact"),
            )
        }
    }.getOrDefault(emptyList())
}
