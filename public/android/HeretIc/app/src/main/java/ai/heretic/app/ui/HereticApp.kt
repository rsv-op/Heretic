package ai.heretic.app.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import ai.heretic.app.core.HereticCore
import ai.heretic.app.voice.VoiceManager
import com.heretic.voice.VoicePipelineController
import kotlinx.coroutines.launch

private data class Turn(val role: String, val text: String)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HereticApp(
    core: HereticCore,
    voice: VoiceManager,
    voicePipeline: VoicePipelineController? = null,
    onPickGguf: (() -> Unit)? = null,
    onPickSttDir: (() -> Unit)? = null,
    onPickTtsDir: (() -> Unit)? = null,
    onSwitchToWebUi: (() -> Unit)? = null,
    initialTab: Int = 0,
) {
    val scope = rememberCoroutineScope()
    var tab by remember(initialTab) { mutableIntStateOf(initialTab) }
    val tabs = listOf("Voice", "Chat", "Errors", "Files", "Gates")

    Scaffold(topBar = {
        TopAppBar(
            title = { Text("HeretIc · native", fontFamily = FontFamily.Monospace) },
            actions = {
                if (onSwitchToWebUi != null) {
                    TextButton(onClick = onSwitchToWebUi) {
                        Text("Web UI", fontFamily = FontFamily.Monospace)
                    }
                } else {
                    Text(voice.sttEngine, style = MaterialTheme.typography.labelSmall)
                }
            },
        )
    }) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            ScrollableTabRow(selectedTabIndex = tab, edgePadding = 8.dp) {
                tabs.forEachIndexed { index, label ->
                    Tab(selected = tab == index, onClick = { tab = index }, text = { Text(label) })
                }
            }
            when (tab) {
                0 -> VoicePipelineScreen(
                    voicePipeline = voicePipeline,
                    onPickGguf = onPickGguf,
                    onPickSttDir = onPickSttDir,
                    onPickTtsDir = onPickTtsDir,
                )
                1 -> ChatScreen(core, voice, scope)
                2 -> ErrorScreen(core)
                3 -> FileScreen(core)
                else -> GateScreen(core)
            }
        }
    }
}

@Composable
private fun VoicePipelineScreen(
    voicePipeline: VoicePipelineController?,
    onPickGguf: (() -> Unit)?,
    onPickSttDir: (() -> Unit)?,
    onPickTtsDir: (() -> Unit)?,
) {
    if (voicePipeline == null) {
        Box(Modifier.fillMaxSize().padding(16.dp), contentAlignment = Alignment.Center) {
            Text("Voice pipeline controller unavailable in this context.", fontFamily = FontFamily.Monospace)
        }
        return
    }

    val uiState by voicePipeline.state.collectAsState()
    var ggufDraft by remember(uiState.paths.llamaModelPath) { mutableStateOf(uiState.paths.llamaModelPath) }
    var sttDraft by remember(uiState.paths.sttModelDir) { mutableStateOf(uiState.paths.sttModelDir) }
    var ttsDraft by remember(uiState.paths.ttsModelDir) { mutableStateOf(uiState.paths.ttsModelDir) }
    var styleDraft by remember(uiState.paths.voiceStylePath) { mutableStateOf(uiState.paths.voiceStylePath) }
    var testPrompt by remember { mutableStateOf("") }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    text = "Unified Offline Voice Pipeline",
                    style = MaterialTheme.typography.titleSmall,
                    fontFamily = FontFamily.Monospace,
                )
                Text(
                    text = uiState.statusMessage,
                    style = MaterialTheme.typography.bodySmall,
                    fontFamily = FontFamily.Monospace,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    AssistChip(
                        onClick = {},
                        label = { Text(if (uiState.readiness.llmReady) "LLM ✓" else "LLM ○") },
                    )
                    AssistChip(
                        onClick = {},
                        label = { Text(if (uiState.readiness.sttReady) "STT ✓" else "STT ○") },
                    )
                    AssistChip(
                        onClick = {},
                        label = { Text(if (uiState.readiness.ttsReady && uiState.readiness.styleReady) "TTS ✓" else "TTS ○") },
                    )
                }
            }
        }

        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("1. llama.cpp GGUF Model (.gguf)", style = MaterialTheme.typography.labelLarge)
                OutlinedTextField(
                    value = ggufDraft,
                    onValueChange = { ggufDraft = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("GGUF file path") },
                    supportingText = { Text(uiState.readiness.llmMessage) },
                    singleLine = true,
                )
                if (onPickGguf != null) {
                    OutlinedButton(onClick = onPickGguf, enabled = !uiState.isBusy) {
                        Text("Pick .gguf File (SAF)")
                    }
                }

                HorizontalDivider()

                Text("2. Parakeet TDT STT Directory (+ optional silero_vad.onnx)", style = MaterialTheme.typography.labelLarge)
                OutlinedTextField(
                    value = sttDraft,
                    onValueChange = { sttDraft = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Parakeet STT model folder") },
                    supportingText = { Text(uiState.readiness.sttMessage) },
                    singleLine = true,
                )
                if (onPickSttDir != null) {
                    OutlinedButton(onClick = onPickSttDir, enabled = !uiState.isBusy) {
                        Text("Pick Parakeet STT Folder (SAF)")
                    }
                }

                HorizontalDivider()

                Text("3. Supertonic TTS Directory + Voice Style", style = MaterialTheme.typography.labelLarge)
                OutlinedTextField(
                    value = ttsDraft,
                    onValueChange = { ttsDraft = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Supertonic TTS model folder") },
                    supportingText = { Text(uiState.readiness.ttsMessage) },
                    singleLine = true,
                )
                OutlinedTextField(
                    value = styleDraft,
                    onValueChange = { styleDraft = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Voice style JSON path (auto-detected if blank)") },
                    singleLine = true,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (onPickTtsDir != null) {
                        OutlinedButton(onClick = onPickTtsDir, enabled = !uiState.isBusy) {
                            Text("Pick Supertonic TTS Folder (SAF)")
                        }
                    }
                    Button(
                        onClick = {
                            voicePipeline.updatePaths(
                                llamaModelPath = ggufDraft,
                                sttModelDir = sttDraft,
                                ttsModelDir = ttsDraft,
                                voiceStylePath = styleDraft,
                            )
                        },
                        enabled = !uiState.isBusy,
                    ) {
                        Text("Save Paths")
                    }
                }
            }
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Button(
                onClick = { voicePipeline.initialize() },
                enabled = !uiState.isBusy && uiState.readiness.allReady,
                modifier = Modifier.weight(1f),
            ) {
                Text(if (uiState.isInitialized) "Reload Models" else "Initialize Pipeline")
            }

            Button(
                onClick = {
                    if (uiState.isListening) voicePipeline.stopListening() else voicePipeline.startListening()
                },
                enabled = !uiState.isBusy && (uiState.isInitialized || uiState.readiness.allReady),
                modifier = Modifier.weight(1f),
            ) {
                Text(if (uiState.isListening) "Stop Mic" else "Hands-Free Listen")
            }
        }

        Button(
            onClick = { voicePipeline.stopPlayback() },
            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("SHAZ · Pause & Flush AudioTrack Immediately")
        }

        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            OutlinedTextField(
                value = testPrompt,
                onValueChange = { testPrompt = it },
                modifier = Modifier.weight(1f),
                label = { Text("Speak prompt via llama.cpp → Supertonic") },
                singleLine = true,
            )
            Button(
                onClick = {
                    val p = testPrompt.trim()
                    if (p.isNotEmpty()) {
                        voicePipeline.speakPrompt(p)
                        testPrompt = ""
                    }
                },
                enabled = !uiState.isBusy && (uiState.isInitialized || uiState.readiness.allReady),
            ) {
                Text("Speak")
            }
        }

        if (uiState.transcriptHistory.isNotEmpty()) {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Live Voice Transcript", style = MaterialTheme.typography.labelLarge)
                    uiState.transcriptHistory.forEach { line ->
                        Text(line, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
}

@Composable
private fun ChatScreen(core: HereticCore, voice: VoiceManager, scope: kotlinx.coroutines.CoroutineScope) {
    var input by remember { mutableStateOf("") }
    var listening by remember { mutableStateOf(false) }
    val turns = remember { mutableStateListOf<Turn>() }

    LaunchedEffect(listening) {
        if (!listening) return@LaunchedEffect
        voice.startListening(
            onResult = { transcript -> input = transcript; listening = false },
            onError = { listening = false },
        )
    }

    fun send() {
        val prompt = input.trim()
        if (prompt.isEmpty()) return
        turns += Turn("you", prompt)
        val reply = core.reply(prompt)
        turns += Turn("heretic", reply.text)
        if (core.gates.granted("tts.speak")) voice.speak(reply.speak)
        input = ""
    }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(turns) { turn ->
                Card(colors = CardDefaults.cardColors(
                    containerColor = if (turn.role == "you") MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.surface,
                )) {
                    Text(turn.text, Modifier.padding(12.dp), fontFamily = FontFamily.Monospace)
                }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            IconButton(onClick = { listening = !listening }) { Text(if (listening) "■" else "●") }
            OutlinedTextField(
                value = input,
                onValueChange = { input = it },
                modifier = Modifier.weight(1f),
                label = { Text("Command Heretic") },
                keyboardActions = KeyboardActions(onSend = { send() }),
                singleLine = true,
            )
            Button(onClick = { scope.launch { send() } }) { Text("Send") }
        }
    }
}

@Composable
private fun ErrorScreen(core: HereticCore) {
    var raw by remember { mutableStateOf("") }
    var output by remember { mutableStateOf("") }
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(raw, { raw = it }, Modifier.fillMaxWidth().height(160.dp), label = { Text("Paste logcat") })
        Button(onClick = { output = ai.heretic.app.core.ErrorEngine.format(core.analyzeError(raw)) }) { Text("Analyse") }
        SelectionContainer { Text(output, fontFamily = FontFamily.Monospace) }
    }
}

@Composable
private fun FileScreen(core: HereticCore) {
    var name by remember { mutableStateOf("model-q4_k_m.gguf") }
    var output by remember { mutableStateOf("") }
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(name, { name = it }, Modifier.fillMaxWidth(), label = { Text("File name") })
        Button(onClick = {
            val a = core.assessFile(name)
            output = "${a.relevance} · ${a.usefulness}%\n${a.rationale}\n\n" + a.integrationSteps.mapIndexed { i, s -> "${i + 1}. $s" }.joinToString("\n")
        }) { Text("Assess") }
        SelectionContainer { Text(output, fontFamily = FontFamily.Monospace) }
    }
}

@Composable
private fun GateScreen(core: HereticCore) {
    LazyColumn(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        items(core.gates.catalog) { gate ->
            Card {
                Column(Modifier.padding(12.dp)) {
                    Text(gate.action, style = MaterialTheme.typography.titleSmall)
                    Text(gate.reason, style = MaterialTheme.typography.bodySmall)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { core.gates.record(gate.key, "GRANTED", "compose") }) { Text("Allow once") }
                        OutlinedButton(onClick = { core.gates.record(gate.key, "DENIED", "compose") }) { Text("Deny") }
                    }
                }
            }
        }
    }
}

@Composable
private fun SelectionContainer(content: @Composable () -> Unit) {
    androidx.compose.foundation.text.selection.SelectionContainer(content = content)
}
