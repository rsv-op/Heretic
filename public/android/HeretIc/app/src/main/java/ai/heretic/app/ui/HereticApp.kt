package ai.heretic.app.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.Slider
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import ai.heretic.app.core.Decision
import ai.heretic.app.core.ErrorAnalysis
import ai.heretic.app.core.ErrorEngine
import ai.heretic.app.core.FileAssessment
import ai.heretic.app.core.HereticCore
import ai.heretic.app.core.MilestoneItem
import ai.heretic.app.core.MilestoneKind
import ai.heretic.app.core.RepoAssessor
import ai.heretic.app.core.SolutionConfirmation
import ai.heretic.app.ml.LiteRtLmEngine
import ai.heretic.app.voice.VoiceManager
import com.heretic.voice.AssistantTurn
import com.heretic.voice.VoicePipelineController
import com.heretic.voice.VoicePipelineUiState
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HereticApp(
    core: HereticCore,
    voice: VoiceManager,
    voicePipeline: VoicePipelineController,
    liteRtEngine: LiteRtLmEngine? = null,
    onPickGguf: (() -> Unit)? = null,
    onPickLiteRtLm: (() -> Unit)? = null,
    onPickSttDir: (() -> Unit)? = null,
    onPickSttZip: (() -> Unit)? = null,
    onPickTtsDir: (() -> Unit)? = null,
    onPickTtsZip: (() -> Unit)? = null,
    onPickAnyFileForAssessor: (() -> Unit)? = null,
    externallyAssessedFile: FileAssessment? = null,
    initialTab: Int = 0,
) {
    val uiState by voicePipeline.state.collectAsState()
    var tab by remember(initialTab) { mutableIntStateOf(initialTab) }
    val tabs = listOf("Assistant", "Models", "Errors", "Files", "Repo", "Gates & ADR")

    LaunchedEffect(uiState.requestedTab) {
        val target = uiState.requestedTab
        if (target != null && target in tabs.indices) {
            tab = target
            voicePipeline.consumeTabNavigation()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            text = "Heretic · Voice Assistant",
                            style = MaterialTheme.typography.titleMedium,
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.Bold,
                        )
                        Text(
                            text = "100% OFFLINE · ARM64 · ZERO NETWORK",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.secondary,
                            fontFamily = FontFamily.Monospace,
                        )
                    }
                },
                actions = {
                    if (uiState.isPlaying || uiState.isListening) {
                        Button(
                            onClick = {
                                voicePipeline.stopPlayback()
                                if (uiState.isListening) voicePipeline.stopListening()
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                            modifier = Modifier.padding(end = 8.dp),
                        ) {
                            Text("SHAZ", fontFamily = FontFamily.Monospace)
                        }
                    }
                },
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .navigationBarsPadding()
                .imePadding(),
        ) {
            if (uiState.isBusy) {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            }
            ScrollableTabRow(selectedTabIndex = tab, edgePadding = 8.dp) {
                tabs.forEachIndexed { index, label ->
                    Tab(
                        selected = tab == index,
                        onClick = { tab = index },
                        text = { Text(label, fontFamily = FontFamily.Monospace) },
                    )
                }
            }
            when (tab) {
                0 -> AssistantHomeScreen(
                    uiState = uiState,
                    voicePipeline = voicePipeline,
                    onOpenModelsTab = { tab = 1 },
                )
                1 -> ModelsStudioScreen(
                    uiState = uiState,
                    voicePipeline = voicePipeline,
                    liteRtEngine = liteRtEngine,
                    onPickGguf = onPickGguf,
                    onPickLiteRtLm = onPickLiteRtLm,
                    onPickSttDir = onPickSttDir,
                    onPickSttZip = onPickSttZip,
                    onPickTtsDir = onPickTtsDir,
                    onPickTtsZip = onPickTtsZip,
                )
                2 -> ErrorLoopScreen(
                    core = core,
                    voicePipeline = voicePipeline,
                    initialAnalysis = uiState.lastErrorAnalysis,
                    initialConfirmation = uiState.lastSolutionConfirmation,
                )
                3 -> FileAssessorScreen(
                    core = core,
                    voicePipeline = voicePipeline,
                    externalAssessment = externallyAssessedFile ?: uiState.lastFileAssessment,
                    onPickFile = onPickAnyFileForAssessor,
                )
                4 -> RepoMilestoneScreen(
                    milestones = uiState.milestones,
                    onUpdateMilestones = { voicePipeline.updateMilestones(it) },
                    onSpeakSummary = { voicePipeline.speakTextAloud(it) },
                )
                else -> GatesAndDecisionsScreen(
                    core = core,
                    voicePipeline = voicePipeline,
                )
            }
        }
    }
}

@Composable
private fun AssistantHomeScreen(
    uiState: VoicePipelineUiState,
    voicePipeline: VoicePipelineController,
    onOpenModelsTab: () -> Unit,
) {
    var input by remember { mutableStateOf("") }
    val listState = rememberLazyListState()

    LaunchedEffect(uiState.conversation.size) {
        if (uiState.conversation.isNotEmpty()) {
            listState.animateScrollToItem(uiState.conversation.lastIndex)
        }
    }

    fun sendCurrent() {
        val trimmed = input.trim()
        if (trimmed.isEmpty()) return
        voicePipeline.speakPrompt(trimmed)
        input = ""
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    text = uiState.statusMessage,
                    style = MaterialTheme.typography.bodySmall,
                    fontFamily = FontFamily.Monospace,
                )
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    AssistChip(
                        onClick = onOpenModelsTab,
                        label = {
                            Text(
                                text = "STT: ${uiState.activeSttLabel}",
                                style = MaterialTheme.typography.labelSmall,
                                fontFamily = FontFamily.Monospace,
                            )
                        },
                    )
                    AssistChip(
                        onClick = onOpenModelsTab,
                        label = {
                            Text(
                                text = "Brain: ${uiState.activeBrainLabel}",
                                style = MaterialTheme.typography.labelSmall,
                                fontFamily = FontFamily.Monospace,
                            )
                        },
                    )
                    AssistChip(
                        onClick = onOpenModelsTab,
                        label = {
                            Text(
                                text = "TTS: ${uiState.activeTtsLabel}",
                                style = MaterialTheme.typography.labelSmall,
                                fontFamily = FontFamily.Monospace,
                            )
                        },
                    )
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Button(
                        onClick = {
                            if (uiState.isListening) voicePipeline.stopListening() else voicePipeline.startListening()
                        },
                        colors = if (uiState.isListening) {
                            ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.secondary)
                        } else {
                            ButtonDefaults.buttonColors()
                        },
                        modifier = Modifier.weight(1.25f),
                    ) {
                        val micLabel = when {
                            uiState.isListening && uiState.sttNeuralActive -> "● Hands-Free Active (Tap Stop)"
                            uiState.isListening -> "● Listening… (Tap Stop)"
                            uiState.sttNeuralActive -> "● Start Hands-Free Mic"
                            else -> "● Push-to-Talk Mic"
                        }
                        Text(micLabel, maxLines = 1)
                    }

                    Button(
                        onClick = { voicePipeline.stopPlayback() },
                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                        modifier = Modifier.weight(0.75f),
                    ) {
                        Text("SHAZ · Flush", maxLines = 1)
                    }
                }
            }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            val quickCommands = listOf(
                "System status" to "system status",
                "Capabilities" to "what can you do",
                "Repo progress" to "repo progress",
                "Verify gates" to "verify gates",
                "List ADRs" to "list decisions",
                "Save .wav" to "save wav",
            )
            quickCommands.forEach { (label, cmd) ->
                AssistChip(
                    onClick = { voicePipeline.speakPrompt(cmd) },
                    label = { Text(label, fontFamily = FontFamily.Monospace) },
                )
            }
            if (uiState.conversation.size > 1) {
                AssistChip(
                    onClick = { voicePipeline.clearConversation() },
                    label = { Text("Clear Chat", fontFamily = FontFamily.Monospace) },
                )
            }
        }

        LazyColumn(
            state = listState,
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(uiState.conversation, key = { it.id }) { turn ->
                ConversationTurnCard(
                    turn = turn,
                    onReplay = {
                        val toSpeak = turn.spokenText.ifBlank { turn.text }
                        voicePipeline.speakTextAloud(toSpeak)
                    },
                )
            }
        }

        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            OutlinedTextField(
                value = input,
                onValueChange = { input = it },
                modifier = Modifier.weight(1f),
                label = { Text("Ask Heretic or speak a command…") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { sendCurrent() }),
            )
            Button(
                onClick = { sendCurrent() },
                enabled = input.isNotBlank(),
            ) {
                Text("Send")
            }
        }
    }
}

@Composable
private fun ConversationTurnCard(
    turn: AssistantTurn,
    onReplay: () -> Unit,
) {
    val isUser = turn.role == "you"
    val bgColor = when (turn.role) {
        "you" -> MaterialTheme.colorScheme.surfaceVariant
        "action" -> MaterialTheme.colorScheme.surface
        else -> MaterialTheme.colorScheme.surface
    }
    Card(
        colors = CardDefaults.cardColors(containerColor = bgColor),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = turn.badge,
                    style = MaterialTheme.typography.labelSmall,
                    color = if (isUser) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.primary,
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.SemiBold,
                )
                if (!isUser) {
                    TextButton(onClick = onReplay) {
                        Text("▶ Speak", style = MaterialTheme.typography.labelSmall, fontFamily = FontFamily.Monospace)
                    }
                }
            }
            SelectionContainer {
                Text(
                    text = turn.text,
                    style = MaterialTheme.typography.bodyMedium,
                    fontFamily = FontFamily.Monospace,
                )
            }
        }
    }
}

@Composable
private fun ModelsStudioScreen(
    uiState: VoicePipelineUiState,
    voicePipeline: VoicePipelineController,
    liteRtEngine: LiteRtLmEngine?,
    onPickGguf: (() -> Unit)?,
    onPickLiteRtLm: (() -> Unit)?,
    onPickSttDir: (() -> Unit)?,
    onPickSttZip: (() -> Unit)?,
    onPickTtsDir: (() -> Unit)?,
    onPickTtsZip: (() -> Unit)?,
) {
    var ggufDraft by remember(uiState.paths.llamaModelPath) { mutableStateOf(uiState.paths.llamaModelPath) }
    var sttDraft by remember(uiState.paths.sttModelDir) { mutableStateOf(uiState.paths.sttModelDir) }
    var ttsDraft by remember(uiState.paths.ttsModelDir) { mutableStateOf(uiState.paths.ttsModelDir) }
    var styleDraft by remember(uiState.paths.voiceStylePath) { mutableStateOf(uiState.paths.voiceStylePath) }
    var speedSlider by remember(uiState.voiceSpeed) { mutableFloatStateOf(uiState.voiceSpeed) }
    var stepsSlider by remember(uiState.diffusionSteps) { mutableFloatStateOf(uiState.diffusionSteps.toFloat()) }
    var lexWord by remember { mutableStateOf("") }
    var lexPronounce by remember { mutableStateOf("") }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    text = "Modular Neural Engine Studio",
                    style = MaterialTheme.typography.titleSmall,
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    text = "Each slot activates independently. Any unconfigured slot automatically uses Heretic's built-in offline engine.",
                    style = MaterialTheme.typography.bodySmall,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    AssistChip(
                        onClick = {},
                        label = { Text(if (uiState.readiness.llmReady || uiState.liteRtActive) "Brain ✓" else "Brain · Core") },
                    )
                    AssistChip(
                        onClick = {},
                        label = { Text(if (uiState.readiness.sttReady) "Parakeet STT ✓" else "STT · System") },
                    )
                    AssistChip(
                        onClick = {},
                        label = { Text(if (uiState.readiness.ttsReady && uiState.readiness.styleReady) "Supertonic ✓" else "TTS · System") },
                    )
                }
                Button(
                    onClick = { voicePipeline.initialize() },
                    enabled = !uiState.isBusy,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Activate / Reload Verified Neural Engines", maxLines = 1)
                }
            }
        }

        // Slot 1: Brain (llama.cpp GGUF + LiteRT-LM)
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("1. Local LLM Brain (llama.cpp .gguf or LiteRT-LM .litertlm)", style = MaterialTheme.typography.labelLarge)
                OutlinedTextField(
                    value = ggufDraft,
                    onValueChange = { ggufDraft = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("GGUF model file path") },
                    supportingText = { Text(uiState.readiness.llmMessage) },
                    singleLine = true,
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (onPickGguf != null) {
                        OutlinedButton(
                            onClick = onPickGguf,
                            enabled = !uiState.isBusy,
                            modifier = Modifier.weight(1f),
                        ) {
                            Text("Pick .gguf File", maxLines = 1)
                        }
                    }
                    if (onPickLiteRtLm != null) {
                        OutlinedButton(
                            onClick = onPickLiteRtLm,
                            enabled = !uiState.isBusy,
                            modifier = Modifier.weight(1f),
                        ) {
                            Text("Pick .litertlm / .tflite", maxLines = 1)
                        }
                    }
                }
                if (liteRtEngine != null) {
                    val ramGb = String.format(Locale.US, "%.1f GB", liteRtEngine.totalRamBytes() / 1_073_741_824.0)
                    val rec = liteRtEngine.defaultModel()?.fileName ?: "arm64-v8a required"
                    Text(
                        text = if (uiState.liteRtActive) {
                            "LiteRT-LM active: ${uiState.liteRtModelLabel} ($ramGb RAM)"
                        } else {
                            "Device RAM: $ramGb · LiteRT-LM recommended bundle: $rec"
                        },
                        style = MaterialTheme.typography.bodySmall,
                        fontFamily = FontFamily.Monospace,
                    )
                }
                Text(
                    text = uiState.tfliteSummary,
                    style = MaterialTheme.typography.bodySmall,
                    fontFamily = FontFamily.Monospace,
                )
                TextButton(
                    onClick = { voicePipeline.resetLiteRtBackendCache() },
                    enabled = !uiState.isBusy,
                ) {
                    Text("Reset Cached LiteRT GPU/CPU Backend Probe", fontFamily = FontFamily.Monospace)
                }
            }
        }

        // Slot 2: Parakeet STT + Built-in Silero VAD v6 + Mic Calibration
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("2. Parakeet TDT STT (Silero VAD v6 Built-In)", style = MaterialTheme.typography.labelLarge)
                OutlinedTextField(
                    value = sttDraft,
                    onValueChange = { sttDraft = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Parakeet STT directory") },
                    supportingText = { Text(uiState.readiness.sttMessage) },
                    singleLine = true,
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (onPickSttDir != null) {
                        OutlinedButton(
                            onClick = onPickSttDir,
                            enabled = !uiState.isBusy,
                            modifier = Modifier.weight(1f),
                        ) {
                            Text("Pick STT Folder", maxLines = 1)
                        }
                    }
                    if (onPickSttZip != null) {
                        OutlinedButton(
                            onClick = onPickSttZip,
                            enabled = !uiState.isBusy,
                            modifier = Modifier.weight(1f),
                        ) {
                            Text("Import STT .zip", maxLines = 1)
                        }
                    }
                }
                OutlinedButton(
                    onClick = { voicePipeline.calibrateMicrophone() },
                    enabled = !uiState.isBusy,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Calibrate Microphone (16 kHz SNR & Fricative Check)", maxLines = 1)
                }
                uiState.micCalibration?.let { cal ->
                    Text(
                        text = "Mic Score: ${cal.qualityScore.toInt()}/100 · SNR ${String.format(Locale.US, "%.1f", cal.snrDb)} dB · HF ${(cal.hfFraction * 100).toInt()}%\n${cal.verdict}",
                        style = MaterialTheme.typography.bodySmall,
                        fontFamily = FontFamily.Monospace,
                    )
                }
            }
        }

        // Slot 3: Supertonic TTS + Voice Styles + Speed + WAV + Lexicon
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("3. Supertonic ONNX TTS + Speaker Voice Style", style = MaterialTheme.typography.labelLarge)
                OutlinedTextField(
                    value = ttsDraft,
                    onValueChange = { ttsDraft = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Supertonic TTS directory") },
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
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (onPickTtsDir != null) {
                        OutlinedButton(
                            onClick = onPickTtsDir,
                            enabled = !uiState.isBusy,
                            modifier = Modifier.weight(1f),
                        ) {
                            Text("Pick TTS Folder", maxLines = 1)
                        }
                    }
                    if (onPickTtsZip != null) {
                        OutlinedButton(
                            onClick = onPickTtsZip,
                            enabled = !uiState.isBusy,
                            modifier = Modifier.weight(1f),
                        ) {
                            Text("Import TTS .zip", maxLines = 1)
                        }
                    }
                }

                if (uiState.availableStyles.isNotEmpty()) {
                    Text("Speaker Voice Presets:", style = MaterialTheme.typography.labelMedium)
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        uiState.availableStyles.forEach { file ->
                            val selected = uiState.paths.voiceStylePath == file.absolutePath
                            FilterChip(
                                selected = selected,
                                onClick = {
                                    styleDraft = file.absolutePath
                                    voicePipeline.selectVoiceStyle(file)
                                },
                                label = { Text(file.nameWithoutExtension, fontFamily = FontFamily.Monospace) },
                            )
                        }
                    }
                }

                Text(
                    text = "Speech Speed: ${String.format(Locale.US, "%.2fx", speedSlider)} · Diffusion Steps: ${stepsSlider.toInt()}",
                    style = MaterialTheme.typography.labelMedium,
                    fontFamily = FontFamily.Monospace,
                )
                Slider(
                    value = speedSlider,
                    onValueChange = { speedSlider = it },
                    onValueChangeFinished = {
                        voicePipeline.updateSynthesisTuning(speedSlider, stepsSlider.toInt())
                    },
                    valueRange = 0.8f..1.4f,
                )
                Slider(
                    value = stepsSlider,
                    onValueChange = { stepsSlider = it },
                    onValueChangeFinished = {
                        voicePipeline.updateSynthesisTuning(speedSlider, stepsSlider.toInt())
                    },
                    valueRange = 2f..8f,
                    steps = 5,
                )

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
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Save Manual Paths", maxLines = 1)
                }
            }
        }

        // Custom Pronunciation Lexicon & Saved WAV Audio
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Pronunciation Lexicon & Saved WAV Replies", style = MaterialTheme.typography.labelLarge)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    OutlinedTextField(
                        value = lexWord,
                        onValueChange = { lexWord = it },
                        modifier = Modifier.weight(1f),
                        label = { Text("Word") },
                        singleLine = true,
                    )
                    OutlinedTextField(
                        value = lexPronounce,
                        onValueChange = { lexPronounce = it },
                        modifier = Modifier.weight(1f),
                        label = { Text("Pronounce as") },
                        singleLine = true,
                    )
                    Button(
                        onClick = {
                            voicePipeline.addLexiconRule(lexWord, lexPronounce)
                            lexWord = ""
                            lexPronounce = ""
                        },
                        enabled = lexWord.isNotBlank() && lexPronounce.isNotBlank(),
                    ) {
                        Text("Add")
                    }
                }
                uiState.lexiconRules.forEach { item ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("${item.term} → ${item.replacement}", fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
                        TextButton(onClick = { voicePipeline.removeLexiconRule(item.id) }) {
                            Text("Remove")
                        }
                    }
                }

                HorizontalDivider()
                OutlinedButton(
                    onClick = { voicePipeline.saveLastSynthesizedWav() },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Export Last Neural TTS Reply to .wav", maxLines = 1)
                }
                uiState.savedWavs.take(6).forEach { wav ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = "${wav.name} (${wav.length() / 1024} KB)",
                            style = MaterialTheme.typography.bodySmall,
                            fontFamily = FontFamily.Monospace,
                            modifier = Modifier.weight(1f),
                        )
                        TextButton(onClick = { voicePipeline.playSavedWav(wav) }) { Text("▶ Play") }
                        TextButton(onClick = { voicePipeline.deleteSavedWav(wav) }) { Text("Del") }
                    }
                }
            }
        }
    }
}

@Composable
private fun ErrorLoopScreen(
    core: HereticCore,
    voicePipeline: VoicePipelineController,
    initialAnalysis: ErrorAnalysis?,
    initialConfirmation: SolutionConfirmation?,
) {
    var rawLog by remember { mutableStateOf("") }
    var pasteBack by remember { mutableStateOf("") }
    var analysis by remember(initialAnalysis) { mutableStateOf(initialAnalysis) }
    var confirmation by remember(initialConfirmation) { mutableStateOf(initialConfirmation) }

    val presets = listOf(
        "JNI Missing" to "FATAL EXCEPTION: main\njava.lang.UnsatisfiedLinkError: dlopen failed: library \"libllama_jni.so\" not found",
        "LiteRT GPU" to "java.lang.IllegalStateException: LiteRT GpuDelegate failed to attach OpenCL context",
        "Audio Perm" to "java.lang.SecurityException: startRecording failed: RECORD_AUDIO permission denied",
        "Weights OOM" to "FATAL EXCEPTION: DefaultDispatcher\nCaused by: java.lang.OutOfMemoryError: bad_alloc mapping fp16 weights",
    )

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text("Error Identification & Paste-Back Loop", style = MaterialTheme.typography.titleSmall, fontFamily = FontFamily.Monospace)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            presets.forEach { (label, sample) ->
                AssistChip(
                    onClick = {
                        rawLog = sample
                        analysis = core.analyzeError(sample)
                        confirmation = null
                    },
                    label = { Text(label, fontFamily = FontFamily.Monospace) },
                )
            }
        }

        OutlinedTextField(
            value = rawLog,
            onValueChange = { rawLog = it },
            modifier = Modifier
                .fillMaxWidth()
                .height(130.dp),
            label = { Text("Paste raw logcat / stack trace") },
        )

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            Button(
                onClick = {
                    val res = core.analyzeError(rawLog)
                    analysis = res
                    confirmation = null
                },
                enabled = rawLog.isNotBlank(),
                modifier = Modifier.weight(1f),
            ) {
                Text("Analyze Error")
            }
            OutlinedButton(
                onClick = {
                    analysis?.let { a ->
                        voicePipeline.speakTextAloud("${a.severity} severity. ${a.what} ${a.why}")
                    }
                },
                enabled = analysis != null,
                modifier = Modifier.weight(1f),
            ) {
                Text("▶ Speak Diagnosis")
            }
        }

        analysis?.let { a ->
            Card(Modifier.fillMaxWidth()) {
                SelectionContainer {
                    Text(
                        text = ErrorEngine.format(a),
                        modifier = Modifier.padding(12.dp),
                        fontFamily = FontFamily.Monospace,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }

            OutlinedTextField(
                value = pasteBack,
                onValueChange = { pasteBack = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Paste post-fix output (e.g. 'check passed, build succeeded')") },
            )
            Button(
                onClick = {
                    val conf = core.confirmSolution(pasteBack)
                    confirmation = conf
                    voicePipeline.speakTextAloud("${conf.status.label}. ${conf.nextAction}")
                },
                enabled = pasteBack.isNotBlank(),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Confirm Solution Paste-Back")
            }
        }

        confirmation?.let { c ->
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("VERDICT: ${c.status.label}", fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold)
                    Text("Evidence: ${c.evidence.joinToString(", ").ifEmpty { "none" }}", fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
                    Text("Next: ${c.nextAction}", style = MaterialTheme.typography.bodySmall)
                    Text(c.note, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}

@Composable
private fun FileAssessorScreen(
    core: HereticCore,
    voicePipeline: VoicePipelineController,
    externalAssessment: FileAssessment?,
    onPickFile: (() -> Unit)?,
) {
    var name by remember { mutableStateOf("qwen2.5-0.5b-instruct-q4_k_m.gguf") }
    var assessment by remember(externalAssessment) {
        mutableStateOf(externalAssessment ?: core.assessFile("qwen2.5-0.5b-instruct-q4_k_m.gguf"))
    }

    val sampleFiles = listOf(
        "qwen2.5-0.5b-instruct-q4_k_m.gguf",
        "parakeet-tdt-stt-models.zip",
        "supertonic-tts-models.zip",
        "gemma-4-e2b-it-int4.litertlm",
        "silero_vad.onnx",
        "raw-weights-fp16.safetensors",
    )

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text("Offline File Relevance Assessor", style = MaterialTheme.typography.titleSmall, fontFamily = FontFamily.Monospace)

        if (onPickFile != null) {
            Button(onClick = onPickFile, modifier = Modifier.fillMaxWidth()) {
                Text("Pick Real File via SAF (Assess + Auto-Import)")
            }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            sampleFiles.forEach { sample ->
                AssistChip(
                    onClick = {
                        name = sample
                        assessment = core.assessFile(sample)
                    },
                    label = { Text(sample, fontFamily = FontFamily.Monospace) },
                )
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                modifier = Modifier.weight(1f),
                label = { Text("File name") },
                singleLine = true,
            )
            Button(onClick = {
                val res = core.assessFile(name)
                assessment = res
                voicePipeline.speakTextAloud("${res.fileName}: ${res.relevance}, ${res.usefulness} percent useful.")
            }) {
                Text("Assess")
            }
        }

        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    text = "${assessment.relevance} · ${assessment.usefulness}% (${assessment.kind})",
                    style = MaterialTheme.typography.titleSmall,
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold,
                )
                Text("Target: ${assessment.targetModule}", fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
                Text(assessment.rationale, style = MaterialTheme.typography.bodySmall)
                assessment.whyNotUseful?.let {
                    Text("Why not useful: $it", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }
                HorizontalDivider()
                assessment.integrationSteps.forEachIndexed { idx, step ->
                    Text("${idx + 1}. $step", fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}

@Composable
private fun RepoMilestoneScreen(
    milestones: List<MilestoneItem>,
    onUpdateMilestones: (List<MilestoneItem>) -> Unit,
    onSpeakSummary: (String) -> Unit,
) {
    val evaluation = remember(milestones) { RepoAssessor.evaluate(milestones) }
    var newTitle by remember { mutableStateOf("") }
    var selectedKind by remember { mutableStateOf(MilestoneKind.IMPLEMENT_NOW) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "${evaluation.health} · ${evaluation.progress}% Weighted",
                        style = MaterialTheme.typography.titleMedium,
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.Bold,
                    )
                    TextButton(
                        onClick = {
                            onSpeakSummary("Repository health is ${evaluation.health} at ${evaluation.progress} percent weighted progress. ${evaluation.nextAction}")
                        }
                    ) {
                        Text("▶ Speak", fontFamily = FontFamily.Monospace)
                    }
                }
                LinearProgressIndicator(
                    progress = { evaluation.progress / 100f },
                    modifier = Modifier.fillMaxWidth(),
                )
                Text(evaluation.verdict, style = MaterialTheme.typography.bodySmall)
                Text("Next: ${evaluation.nextAction}", fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
            }
        }

        milestones.forEachIndexed { idx, item ->
            Card(Modifier.fillMaxWidth()) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 10.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Checkbox(
                        checked = item.done,
                        onCheckedChange = { checked ->
                            val next = milestones.toMutableList().also { list ->
                                list[idx] = item.copy(done = checked)
                            }
                            onUpdateMilestones(next)
                        },
                    )
                    Column(Modifier.weight(1f)) {
                        Text(item.title, style = MaterialTheme.typography.bodyMedium)
                        Text(
                            text = "${item.kind.name.replace('_', ' ')} (weight ${item.kind.weight})",
                            style = MaterialTheme.typography.labelSmall,
                            fontFamily = FontFamily.Monospace,
                        )
                    }
                }
            }
        }

        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Add Graded Milestone", style = MaterialTheme.typography.labelLarge)
                OutlinedTextField(
                    value = newTitle,
                    onValueChange = { newTitle = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Milestone title") },
                    singleLine = true,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    MilestoneKind.entries.forEach { kind ->
                        FilterChip(
                            selected = selectedKind == kind,
                            onClick = { selectedKind = kind },
                            label = { Text(kind.name.replace('_', ' '), style = MaterialTheme.typography.labelSmall) },
                        )
                    }
                }
                Button(
                    onClick = {
                        if (newTitle.isNotBlank()) {
                            onUpdateMilestones(milestones + MilestoneItem(newTitle.trim(), selectedKind, false))
                            newTitle = ""
                        }
                    },
                    enabled = newTitle.isNotBlank(),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Add Milestone")
                }
            }
        }
    }
}

@Composable
private fun GatesAndDecisionsScreen(
    core: HereticCore,
    voicePipeline: VoicePipelineController,
) {
    var refreshTick by remember { mutableIntStateOf(0) }
    val entries = remember(refreshTick) { core.gates.entries() }
    val chainVerify = remember(refreshTick) { core.gates.verify() }
    val decisions = remember(refreshTick) { core.decisions.all() }

    var adrTitle by remember { mutableStateOf("") }
    var adrChoice by remember { mutableStateOf("") }
    var adrReasoning by remember { mutableStateOf("") }
    var adrFeedback by remember { mutableStateOf("") }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    text = if (chainVerify == -1) {
                        "SHA-256 Gate Audit Chain: VERIFIED (${entries.size} entries)"
                    } else {
                        "SHA-256 Gate Audit Chain: BROKEN AT INDEX $chainVerify"
                    },
                    style = MaterialTheme.typography.titleSmall,
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold,
                )
                OutlinedButton(
                    onClick = {
                        core.gates.clearInstanceGrants()
                        refreshTick++
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Revoke All Instance Grants & Reset Chain")
                }
            }
        }

        core.gates.catalog.filterNot { it.key == "webview.bridge" }.forEach { gate ->
            val isGranted = remember(refreshTick) { core.gates.granted(gate.key) }
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(gate.action, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                        Text(
                            text = if (isGranted) "GRANTED" else "DENIED",
                            fontFamily = FontFamily.Monospace,
                            color = if (isGranted) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.labelSmall,
                        )
                    }
                    Text("${gate.key} · risk: ${gate.risk} · ${gate.reason}", style = MaterialTheme.typography.bodySmall)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = {
                                core.gates.record(gate.key, "GRANTED", "compose")
                                refreshTick++
                            },
                            modifier = Modifier.weight(1f),
                        ) {
                            Text("Grant")
                        }
                        OutlinedButton(
                            onClick = {
                                core.gates.record(gate.key, "DENIED", "compose")
                                refreshTick++
                            },
                            modifier = Modifier.weight(1f),
                        ) {
                            Text("Deny")
                        }
                    }
                }
            }
        }

        HorizontalDivider()

        Text(
            text = "Architecture Decision Log (decisions.jsonl · Mandatory 'because' >= 12 words)",
            style = MaterialTheme.typography.titleSmall,
            fontFamily = FontFamily.Monospace,
        )

        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = adrTitle,
                    onValueChange = { adrTitle = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Decision title") },
                    singleLine = true,
                )
                OutlinedTextField(
                    value = adrChoice,
                    onValueChange = { adrChoice = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Chosen option") },
                    singleLine = true,
                )
                OutlinedTextField(
                    value = adrReasoning,
                    onValueChange = { adrReasoning = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Reasoning (must include 'because' & >= 12 words)") },
                )
                Button(
                    onClick = {
                        val nextRef = "ADR-%03d".format(decisions.size + 9)
                        val res = core.decisions.append(
                            Decision(
                                ref = nextRef,
                                title = adrTitle.trim(),
                                context = "Recorded in Heretic Voice Assistant",
                                options = listOf(adrChoice.trim(), "Alternative"),
                                choice = adrChoice.trim(),
                                reasoning = adrReasoning.trim(),
                                impact = "Appended to offline decisions.jsonl",
                            )
                        )
                        res.fold(
                            onSuccess = { saved ->
                                adrFeedback = "Saved ${saved.ref}: ${saved.title}"
                                adrTitle = ""
                                adrChoice = ""
                                adrReasoning = ""
                                refreshTick++
                                voicePipeline.speakTextAloud("Recorded ${saved.ref}.")
                            },
                            onFailure = { err ->
                                adrFeedback = err.message ?: "Validation failed"
                            },
                        )
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Append Decision to Offline Log")
                }
                if (adrFeedback.isNotBlank()) {
                    Text(adrFeedback, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
                }
            }
        }

        decisions.reversed().forEach { d ->
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("[${d.ref}] ${d.title}", fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold)
                    Text("Choice: ${d.choice}", fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
                    Text(d.reasoning, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        Spacer(Modifier.height(16.dp))
    }
}
