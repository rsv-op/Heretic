package org.schabi.parakeetype.inference

interface GrammarCorrector {
    fun correct(text: String, language: String = "en"): String
    fun close()
}

object NoOpGrammarCorrector : GrammarCorrector {
    override fun correct(text: String, language: String): String = text
    override fun close() = Unit
}
