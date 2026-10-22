package ai.heretic.app.core

data class MilestoneItem(
    val title: String,
    val kind: MilestoneKind,
    val done: Boolean,
)

enum class MilestoneKind(val weight: Int) {
    IMPLEMENT_NOW(3),
    CHANGES_NEEDED(2),
    DEFER(1),
}

data class RepoEvaluation(
    val progress: Int,
    val health: String,
    val counts: Map<MilestoneKind, Int>,
    val done: Int,
    val total: Int,
    val blockers: List<String>,
    val nextAction: String,
    val verdict: String,
)

object RepoAssessor {

    fun evaluate(items: List<MilestoneItem>): RepoEvaluation {
        if (items.isEmpty()) {
            return RepoEvaluation(0, "EMPTY", MilestoneKind.entries.associateWith { 0 }, 0, 0, emptyList(), "Add the first milestone.", "No milestones recorded.")
        }
        val counts = MilestoneKind.entries.associateWith { kind -> items.count { it.kind == kind } }
        val possible = items.sumOf { it.kind.weight }
        val earned = items.filter { it.done }.sumOf { it.kind.weight }
        val progress = if (possible == 0) 0 else Math.round(earned * 100f / possible)
        val blockers = items.filter { !it.done && it.kind != MilestoneKind.DEFER }.map { it.title }
        val done = items.count { it.done }

        val health = when {
            progress == 100 -> "SHIPPED"
            counts[MilestoneKind.IMPLEMENT_NOW]!! > 0 && progress < 34 -> "BLOCKED"
            counts[MilestoneKind.CHANGES_NEEDED]!! > 0 -> "AT_RISK"
            else -> "ON_TRACK"
        }

        val nextAction = items.firstOrNull { !it.done && it.kind == MilestoneKind.CHANGES_NEEDED }
            ?.let { "Resolve CHANGES NEEDED: ${it.title}" }
            ?: items.firstOrNull { !it.done && it.kind == MilestoneKind.IMPLEMENT_NOW }
                ?.let { "Ship IMPLEMENT NOW: ${it.title}" }
            ?: "Only deferred work remains - promote it or drop it."

        val verdict = when (health) {
            "SHIPPED" -> "Every graded milestone is complete; release candidate quality."
            "BLOCKED" -> "Core IMPLEMENT NOW work has not started; no usable APK yet."
            "AT_RISK" -> "Unresolved CHANGES NEEDED items drag weighted progress below plan."
            else -> "Weighted progress is advancing with no blocking items."
        }

        return RepoEvaluation(progress, health, counts, done, items.size, blockers.take(6), nextAction, verdict)
    }
}
