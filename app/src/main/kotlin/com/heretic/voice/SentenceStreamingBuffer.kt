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
