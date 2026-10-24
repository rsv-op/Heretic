/**
 * The same assertions that `HereticCoreTest.kt` runs under
 * `gradle :app:testDebugUnitTest`, executed here against the TypeScript mirror
 * of the rule tables so a build run reports real pass/fail results.
 */
import { analyzeError, assessFile, confirmSolution, evaluateRepo, validateDecision } from "@/lib/engines";

export interface TestResult {
  suite: string;
  name: string;
  passed: boolean;
  detail: string;
}

const assert = (condition: boolean, detail: string) => ({ passed: condition, detail });

export function runCoreTests(): TestResult[] {
  const results: TestResult[] = [];
  const add = (suite: string, name: string, outcome: { passed: boolean; detail: string }) =>
    results.push({ suite, name, ...outcome });

  const linkLog = `FATAL EXCEPTION: main
java.lang.UnsatisfiedLinkError: dlopen failed: library "libheretic_jni.so" not found
\tat ai.heretic.app.ml.LiteRtEngine.load(LiteRtEngine.kt:41)`;
  const linkAnalysis = analyzeError(linkLog);
  add("ErrorEngineTest", "classifiesUnsatisfiedLinkAsNativeLibraryFailure", assert(
    linkAnalysis.rules.includes("unsatisfied-link") && linkAnalysis.severity === "critical" && linkAnalysis.what.includes("JNI"),
    `rules=${linkAnalysis.rules.join(",")} severity=${linkAnalysis.severity}`,
  ));
  add("ErrorEngineTest", "analysisAlwaysAwaitsPasteBack", assert(
    linkAnalysis.status === "AWAITING USER PASTE-BACK",
    `status=${linkAnalysis.status}`,
  ));
  add("ErrorEngineTest", "formattedBlockContainsWhatWhySolution", assert(
    linkAnalysis.formatted.includes("WHAT") && linkAnalysis.formatted.includes("WHY") && linkAnalysis.formatted.includes("REQUEST SOLUTION"),
    "formatted block complete",
  ));

  const pass = confirmSolution("Rebuilt with abiFilters, check passed, the .so is in lib/arm64-v8a now.");
  add("ErrorEngineTest", "pasteBackWithPassSignalClosesTheLoop", assert(pass.status === "CHECK PASSED", `verdict=${pass.status}`));

  const failVerdict = confirmSolution("Still failing: FATAL EXCEPTION main, Caused by: java.lang.OutOfMemoryError");
  add("ErrorEngineTest", "pasteBackWithFreshTraceKeepsTheLoopOpen", assert(failVerdict.status === "CHECK FAILED", `verdict=${failVerdict.status}`));

  add("ErrorEngineTest", "emptyPasteBackAwaitsTheUser", assert(confirmSolution("ok").status === "AWAITING USER PASTE-BACK", "verdict=AWAITING USER PASTE-BACK"));

  add("ErrorEngineTest", "gpuDelegateFailureIsRecognised", assert(
    analyzeError("IllegalArgumentException: GpuDelegate could not be created: OpenCL not available").rules.includes("litert-delegate"),
    "rules include litert-delegate",
  ));

  const litertlm = assessFile("gemma-4-e2b-it-int4.litertlm");
  add(
    "LiteRtLmFileAssessmentTest",
    "litertlmGradesAsWorksAt99Percent",
    assert(litertlm.relevance === "WORKS" && litertlm.usefulness === 99, `${litertlm.relevance} ${litertlm.usefulness}%`),
  );
  const litertlmFull = assessFile("gemma-4-e2b-it-int4.litertlm", 2_581_000_000);
  add(
    "LiteRtLmFileAssessmentTest",
    "fullSizeBundleKeepsItsGradeAndStreamsToFilesDir",
    assert(
      litertlmFull.usefulness === 99 && litertlmFull.rationale.includes("filesDir/models"),
      `${litertlmFull.usefulness}%`,
    ),
  );
  const tflite = assessFile("wake-word.tflite");
  add("FileAssessorTest", "tfliteGradesAsWorks", assert(tflite.relevance === "WORKS" && tflite.usefulness >= 90, `${tflite.relevance} ${tflite.usefulness}%`));

  const safetensors = assessFile("heretic-7b.safetensors");
  add("FileAssessorTest", "safetensorsGradesAsNotRelevantWithReason", assert(
    safetensors.relevance === "NOT RELEVANT" && Boolean(safetensors.whyNotUseful),
    `${safetensors.relevance} · ${safetensors.whyNotUseful?.slice(0, 48)}…`,
  ));

  const hugeGguf = assessFile("heretic-13b-q4.gguf", 700 * 1024 * 1024);
  add("FileAssessorTest", "hugeGgufIsWarnedAboutAssetShipping", assert(
    hugeGguf.relevance === "WORKS" && hugeGguf.rationale.includes("filesDir"),
    `usefulness=${hugeGguf.usefulness}%`,
  ));

  const evaluation = evaluateRepo([
    { title: "Wire WebView bridge", kind: "IMPLEMENT_NOW", done: true },
    { title: "Ship Vulkan path", kind: "DEFER", done: true },
    { title: "Fix R8 keep rules", kind: "CHANGES_NEEDED", done: false },
  ]);
  add("RepoAssessorTest", "deferredWorkCannotInflateProgress", assert(
    evaluation.progress < 80 && evaluation.health === "AT_RISK" && evaluation.blockers.includes("Fix R8 keep rules"),
    `progress=${evaluation.progress}% health=${evaluation.health}`,
  ));

  const rejected = validateDecision({
    title: "Use LiteRT",
    choice: "LiteRT 2.3.0",
    reasoning: "It is the smallest runtime available on device today",
  });
  add("DecisionRuleTest", "rejectsReasoningWithoutBecause", assert(!rejected.valid && rejected.errors.some((e) => e.includes("because")), rejected.errors.join(" ")));

  const accepted = validateDecision({
    title: "Use LiteRT with GPU delegate",
    choice: "litert:2.3.0 + litert-gpu:2.3.0",
    reasoning:
      "We chose LiteRT with the GPU delegate because it is the only runtime that loads our int8 models without adding a second inference stack to a 150 MB APK.",
  });
  add("DecisionRuleTest", "acceptsFullReasoningSentence", assert(accepted.valid, `words=${accepted.wordCount}`));

  const baselineAdrs = [
    {
      ref: "ADR-009",
      title: "Serve the web UI through WebViewAssetLoader instead of file://",
      choice: "WebViewAssetLoader on https://appassets.androidplatform.net",
      reasoning:
        "We serve app/src/main/assets through androidx.webkit WebViewAssetLoader because it gives the page a real https origin so ES module imports and wasm streaming work while allowFileAccess stays false, and a loopback server would have required the INTERNET permission this app refuses to declare.",
    },
    {
      ref: "ADR-010",
      title: "Package arm64-v8a and x86_64 only, dropping armeabi-v7a",
      choice: "abiFilters arm64-v8a + x86_64",
      reasoning:
        "We filter to arm64-v8a and x86_64 because litertlm-android 0.18.0 publishes no armeabi-v7a binaries, so a 32-bit device would install successfully and then die with UnsatisfiedLinkError the moment the engine loaded, which is far worse than a clean install refusal.",
    },
  ];
  for (const adr of baselineAdrs) {
    const checked = validateDecision(adr);
    add(
      "DecisionSeedTest",
      `${adr.ref} satisfies the mandatory reasoning rule`,
      assert(checked.valid && checked.hasBecause && checked.wordCount >= 12, `words=${checked.wordCount} ${checked.errors.join(" ")}`),
    );
  }

  return results;
}
