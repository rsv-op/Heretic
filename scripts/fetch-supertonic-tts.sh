#!/usr/bin/env bash
#
# fetch-supertonic-tts.sh — fetch the Supertonic ONNX TTS assets required by the
# HeretIc offline voice pipeline (Slot 3, `supertonic-tts-models.zip`).
#
# The official weights live in the archived Supertone Hugging Face namespace:
#   - Supertonic 1: supertone-oss-archive/supertonic
#   - Supertonic 2: supertone-oss-archive/supertonic-2
#   - Supertonic 3: supertone-oss-archive/supertonic-3
#
# Usage:
#   ./scripts/fetch-supertonic-tts.sh \
#       --out dist-voice-models/tts \
#       --zip dist-voice-models/supertonic-tts-models.zip
#
# Writes (ready for HeretIc → Voice → "Import TTS .zip" / "Pick TTS folder"):
#   <out>/duration_predictor.onnx
#   <out>/text_encoder.onnx
#   <out>/vector_estimator.onnx
#   <out>/vocoder.onnx
#   <out>/tts.json
#   <out>/unicode_indexer.json
#   <out>/voice_styles/{M1..M5,F1..F5}.json
#
# Options:
#   --out DIR        Output directory                       (default: ./supertonic-tts)
#   --zip PATH       Zip the output to PATH                 (default: <out>.zip)
#   --no-zip         Do not write a zip archive
#   --variant NAME   supertonic-1 | supertonic-2 | supertonic-3   (default: supertonic-1)
#   --revision REF   Pin a Hugging Face revision            (default: archived main)
#   --repo NAME      Override the Hugging Face repo id
#   --from-dir DIR   Validate + zip an existing model dir instead of downloading
#   -h, --help       Show this help
#
# Environment:
#   HF_ENDPOINT  Hugging Face endpoint (default https://huggingface.co; e.g. a mirror)
#   HF_TOKEN     Token for gated/private repos (optional)
set -euo pipefail

VARIANT="supertonic-1"
OUT_DIR=""
ZIP_OUT=""
NO_ZIP=0
REPO=""
REVISION=""
FROM_DIR=""

usage() {
  cat <<'USAGE'
fetch-supertonic-tts.sh — fetch the Supertonic ONNX TTS assets for the HeretIc
offline voice pipeline (Slot 3).

Usage:
  ./scripts/fetch-supertonic-tts.sh [options]

Options:
  --out DIR        Output directory                          (default: ./supertonic-tts)
  --zip PATH       Zip the output to PATH                    (default: <out>.zip)
  --no-zip         Do not write a zip archive
  --variant NAME   supertonic-1 | supertonic-2 | supertonic-3  (default: supertonic-1)
  --revision REF   Pin a Hugging Face revision               (default: archived main)
  --repo NAME      Override the Hugging Face repo id
  --from-dir DIR   Validate + zip an existing model dir instead of downloading
  -h, --help       Show this help
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --out)       OUT_DIR="$2"; shift 2 ;;
    --zip)       ZIP_OUT="$2"; shift 2 ;;
    --no-zip)    NO_ZIP=1; shift ;;
    --variant)   VARIANT="$2"; shift 2 ;;
    --revision)  REVISION="$2"; shift 2 ;;
    --repo)      REPO="$2"; shift 2 ;;
    --from-dir)  FROM_DIR="$2"; shift 2 ;;
    -h|--help)   usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

# --- resolve the archived Hugging Face repo + default revision --------------
case "$VARIANT" in
  supertonic-1) REPO="${REPO:-supertone-oss-archive/supertonic}";       REVISION="${REVISION:-main}" ;;
  supertonic-2) REPO="${REPO:-supertone-oss-archive/supertonic-2}";     REVISION="${REVISION:-main}" ;;
  supertonic-3) REPO="${REPO:-supertone-oss-archive/supertonic-3}";     REVISION="${REVISION:-aefc6e32416a594460b32413efc49d7fe4ce6d46}" ;;
  *) echo "Unknown variant: $VARIANT (use supertonic-1 | supertonic-2 | supertonic-3)" >&2; exit 2 ;;
esac

HF_ENDPOINT="${HF_ENDPOINT:-https://huggingface.co}"
ONNX_FILES="duration_predictor.onnx text_encoder.onnx vector_estimator.onnx vocoder.onnx tts.json unicode_indexer.json"
STYLE_IDS="M1 M2 M3 M4 M5 F1 F2 F3 F4 F5"

if [ -n "$FROM_DIR" ]; then OUT_DIR="$FROM_DIR"; fi
if [ -z "$OUT_DIR" ];    then OUT_DIR="$(pwd)/supertonic-tts"; fi
if [ "$NO_ZIP" -eq 0 ] && [ -z "$ZIP_OUT" ]; then ZIP_OUT="$OUT_DIR.zip"; fi

AUTH_HEADER=()
if [ -n "${HF_TOKEN:-}" ]; then AUTH_HEADER=(-H "Authorization: Bearer $HF_TOKEN"); fi

fetch() {
  local url="$1" dest="$2"
  echo ">>> Downloading $(basename "$dest") from $url"
  curl -fL --retry 5 --retry-delay 3 --connect-timeout 30 "${AUTH_HEADER[@]}" -o "$dest" "$url"
}

mkdir -p "$OUT_DIR/voice_styles"

if [ -z "$FROM_DIR" ]; then
  for f in $ONNX_FILES; do
    fetch "$HF_ENDPOINT/$REPO/resolve/$REVISION/onnx/$f" "$OUT_DIR/$f"
  done
  for sid in $STYLE_IDS; do
    fetch "$HF_ENDPOINT/$REPO/resolve/$REVISION/voice_styles/$sid.json" "$OUT_DIR/voice_styles/$sid.json"
  done
else
  echo ">>> Skipping download (--from-dir $FROM_DIR)"
fi

# --- verify sizes + JSON schema --------------------------------------------
python3 - "$OUT_DIR" <<'PY'
import json, os, sys

root = sys.argv[1]
required = ["duration_predictor.onnx", "text_encoder.onnx", "vector_estimator.onnx",
            "vocoder.onnx", "tts.json", "unicode_indexer.json"]
for name in required:
    p = os.path.join(root, name)
    if not os.path.isfile(p):
        raise SystemExit(f"Missing required file: {p}")

for name in ["duration_predictor.onnx", "text_encoder.onnx", "vector_estimator.onnx", "vocoder.onnx"]:
    p = os.path.join(root, name)
    sz = os.path.getsize(p)
    if sz < 100_000:
        raise SystemExit(f"Unexpectedly small Supertonic ONNX file {name}: {sz} bytes")
    print(f"  OK  {name:<22} {sz / 1048576:8.2f} MiB")

with open(os.path.join(root, "tts.json"), encoding="utf-8") as f:
    cfg = json.load(f)
if "ae" not in cfg or "ttl" not in cfg:
    raise SystemExit("tts.json missing ae/ttl keys")
print(f"  OK  tts.json (split={cfg.get('split')}, tts_version={cfg.get('tts_version')})")

with open(os.path.join(root, "unicode_indexer.json"), encoding="utf-8") as f:
    idx = json.load(f)
if not isinstance(idx, list) or len(idx) < 1000:
    raise SystemExit("unicode_indexer.json invalid")
print(f"  OK  unicode_indexer.json ({len(idx)} entries)")

for sid in ["M1", "M2", "M3", "M4", "M5", "F1", "F2", "F3", "F4", "F5"]:
    p = os.path.join(root, "voice_styles", f"{sid}.json")
    if not os.path.isfile(p):
        raise SystemExit(f"Missing voice style: {p}")
    with open(p, encoding="utf-8") as f:
        st = json.load(f)
    missing = [k for k in ("style_ttl", "style_dp") if k not in st]
    if missing:
        raise SystemExit(f"{sid}.json missing {missing}")
print("  OK  voice_styles/ (10 styles, style_ttl/style_dp present)")
PY

# --- optional zip ----------------------------------------------------------
if [ "$NO_ZIP" -eq 0 ] && [ -n "$ZIP_OUT" ]; then
  rm -f "$ZIP_OUT"
  (
    cd "$OUT_DIR"
    zip -0 -r -q "$ZIP_OUT" \
      duration_predictor.onnx \
      text_encoder.onnx \
      vector_estimator.onnx \
      vocoder.onnx \
      tts.json \
      unicode_indexer.json \
      voice_styles
  )
  echo ">>> Wrote archive: $ZIP_OUT ($(du -h "$ZIP_OUT" | awk '{print $1}'))"
fi

echo ">>> Done. Sideload-ready model directory: $OUT_DIR/"
