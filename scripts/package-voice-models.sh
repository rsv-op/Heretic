#!/usr/bin/env bash
# Downloads, verifies (SHA-256 + magic headers + JSON schema), and packages all three
# offline model bundles required by the HeretIc Unified Voice Pipeline:
#   1. qwen2.5-0.5b-instruct-q4_k_m.gguf   (Slot 1: llama.cpp GGUF LLM)
#   2. parakeet-tdt-stt-models.zip         (Slot 2: Parakeet TDT INT8 STT + Silero VAD v6)
#   3. supertonic-tts-models.zip           (Slot 3: Supertonic ONNX TTS + 10 Voice Styles)
#   4. SHA256SUMS.txt
set -euo pipefail

OUT_DIR="${1:-$(pwd)/dist-voice-models}"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

mkdir -p "$OUT_DIR"

fetch() {
  local url="$1"
  local dest="$2"
  echo ">>> Downloading $(basename "$dest") from $url"
  curl -fL --retry 5 --retry-delay 3 --connect-timeout 30 -o "$dest" "$url"
}

verify_sha256() {
  local file="$1"
  local expected="$2"
  local actual
  actual="$(sha256sum "$file" | awk '{print $1}')"
  if [ "$actual" != "$expected" ]; then
    echo "ERROR: SHA-256 mismatch for $file (expected $expected, got $actual)" >&2
    exit 1
  fi
  echo "    SHA-256 verified: $(basename "$file") ($actual)"
}

# ==============================================================================
# 1. Slot 1 — llama.cpp Quantized GGUF Model (Qwen2.5-0.5B-Instruct Q4_K_M)
# ==============================================================================
GGUF_NAME="qwen2.5-0.5b-instruct-q4_k_m.gguf"
GGUF_OUT="$OUT_DIR/$GGUF_NAME"
GGUF_URL="https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf"

fetch "$GGUF_URL" "$GGUF_OUT"

python3 - "$GGUF_OUT" <<'PY'
import os, sys
path = sys.argv[1]
size = os.path.getsize(path)
with open(path, "rb") as f:
    magic = f.read(4)
if magic != b"GGUF":
    raise SystemExit(f"Invalid GGUF magic header in {path}: {magic!r}")
if size < 100 * 1024 * 1024:
    raise SystemExit(f"Unexpectedly small GGUF file ({size} bytes): {path}")
print(f"    Verified GGUF header and size ({size / 1048576:.2f} MiB): {os.path.basename(path)}")
PY

# ==============================================================================
# 2. Slot 2 — Parakeet TDT Ultra INT8 STT + Silero VAD v6 Bundle
# ==============================================================================
STT_STAGE="$WORK_DIR/stt"
mkdir -p "$STT_STAGE"

PARAKEET_ZIP_URL="https://github.com/theScrabi/Parakeetype/releases/download/v0.4.0/parakeetype_models.zip"
PARAKEET_RAW_ZIP="$WORK_DIR/parakeetype_upstream.zip"

if fetch "$PARAKEET_ZIP_URL" "$PARAKEET_RAW_ZIP"; then
  unzip -q -j "$PARAKEET_RAW_ZIP" -d "$STT_STAGE"
else
  PARAKEET_HF_BASE="https://huggingface.co/mldecode/parakeet-ultra-onnx-int8/resolve/3282a6e32885b431c1543d58c7710e6e3412eac0"
  fetch "$PARAKEET_HF_BASE/encoder.int8.onnx" "$STT_STAGE/encoder.int8.onnx"
  fetch "$PARAKEET_HF_BASE/decoder.int8.onnx" "$STT_STAGE/decoder.int8.onnx"
  fetch "$PARAKEET_HF_BASE/joiner.int8.onnx"  "$STT_STAGE/joiner.int8.onnx"
  fetch "$PARAKEET_HF_BASE/tokens.txt"        "$STT_STAGE/vocab.txt"
  fetch "https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx/resolve/main/nemo128.onnx" "$STT_STAGE/nemo128.onnx"
  fetch "https://raw.githubusercontent.com/snakers4/silero-vad/master/src/silero_vad/data/silero_vad.onnx" "$STT_STAGE/silero_vad_v6.onnx"
fi

verify_sha256 "$STT_STAGE/encoder.int8.onnx" "181382735a719c75076d13658dc4418de4b566aef39935ca0f8f55da16928f4e"
verify_sha256 "$STT_STAGE/decoder.int8.onnx" "0ba8ace2de04bb2d9a6b20ed2d67138c23df4a385f268438df0ff200502de77a"
verify_sha256 "$STT_STAGE/joiner.int8.onnx"  "20ae4350c2484ba607d94f08ef25ae3ead762d8aaf70753758ffcc504e255ebb"
verify_sha256 "$STT_STAGE/vocab.txt"         "d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d"
verify_sha256 "$STT_STAGE/nemo128.onnx"      "a9fde1486ebfcc08f328d75ad4610c67835fea58c73ba57e3209a6f6cf019e9f"
verify_sha256 "$STT_STAGE/silero_vad_v6.onnx" "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3"

cp "$STT_STAGE/silero_vad_v6.onnx" "$STT_STAGE/silero_vad.onnx"

STT_ZIP_OUT="$OUT_DIR/parakeet-tdt-stt-models.zip"
rm -f "$STT_ZIP_OUT"
(
  cd "$STT_STAGE"
  zip -0 -q "$STT_ZIP_OUT" \
    encoder.int8.onnx \
    decoder.int8.onnx \
    joiner.int8.onnx \
    nemo128.onnx \
    vocab.txt \
    silero_vad.onnx \
    silero_vad_v6.onnx
)
echo "    Packaged Slot 2 archive: $STT_ZIP_OUT ($(du -h "$STT_ZIP_OUT" | awk '{print $1}'))"

# ==============================================================================
# 3. Slot 3 — Supertonic ONNX TTS + 10 Speaker Voice Styles Bundle
#    Fetched, verified and zipped by scripts/fetch-supertonic-tts.sh
#    (archived Hugging Face namespace: supertone-oss-archive/supertonic)
# ==============================================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TTS_STAGE="$WORK_DIR/tts"
TTS_ZIP_OUT="$OUT_DIR/supertonic-tts-models.zip"

"$SCRIPT_DIR/fetch-supertonic-tts.sh" \
  --variant supertonic-1 \
  --out "$TTS_STAGE" \
  --zip "$TTS_ZIP_OUT" \
  | sed 's/^/    /'

echo "    Packaged Slot 3 archive: $TTS_ZIP_OUT ($(du -h "$TTS_ZIP_OUT" | awk '{print $1}'))"

# ==============================================================================
# 4. SHA-256 Manifest
# ==============================================================================
(
  cd "$OUT_DIR"
  sha256sum \
    "$GGUF_NAME" \
    "parakeet-tdt-stt-models.zip" \
    "supertonic-tts-models.zip" > SHA256SUMS.txt
)

echo "=== Completed packaging all HeretIc Voice Pipeline model bundles ==="
ls -lh "$OUT_DIR"
cat "$OUT_DIR/SHA256SUMS.txt"
