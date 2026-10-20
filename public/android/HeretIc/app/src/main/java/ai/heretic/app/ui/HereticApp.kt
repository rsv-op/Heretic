package ai.heretic.app.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import ai.heretic.app.core.HereticCore
import ai.heretic.app.voice.VoiceManager
import kotlinx.coroutines.launch

private data class Turn(val role: String, val text: String)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HereticApp(core: HereticCore, voice: VoiceManager) {
    val scope = rememberCoroutineScope()
    var tab by remember { mutableIntStateOf(0) }
    val tabs = listOf("Chat", "Errors", "Files", "Gates")

    Scaffold(topBar = {
        TopAppBar(
            title = { Text("HeretIc · native", fontFamily = FontFamily.Monospace) },
            actions = { Text(voice.sttEngine, style = MaterialTheme.typography.labelSmall) },
        )
    }) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            TabRow(selectedTabIndex = tab) {
                tabs.forEachIndexed { index, label ->
                    Tab(selected = tab == index, onClick = { tab = index }, text = { Text(label) })
                }
            }
            when (tab) {
                0 -> ChatScreen(core, voice, scope)
                1 -> ErrorScreen(core)
                2 -> FileScreen(core)
                else -> GateScreen(core)
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
