#!/usr/bin/env bash
set -euo pipefail

# cleanup_old_builds.sh
# Deletes previous GitHub Releases (and their apk-run-* tags), uploaded GitHub Actions
# build artifacts, and historical GitHub Actions workflow runs in rsv-op/Heretic,
# while preserving all builds and artifacts belonging to the active Pull Request (#7).

REPO="${GITHUB_REPOSITORY:-}"
KEEP_PR="7"
KEEP_BRANCH=""
DRY_RUN=0

usage() {
    cat <<'USAGE'
Usage: ./cleanup_old_builds.sh [options]

Options:
  --repo <owner/name>     Target GitHub repository (default: auto-detected or rsv-op/Heretic)
  --keep-pr <number>      Pull request number whose builds/artifacts must be kept (default: 7)
  --keep-branch <branch>  Explicit branch name to preserve (overrides --keep-pr lookup)
  --dry-run               Preview items that would be kept/deleted without deleting anything
  -h, --help              Show this help message
USAGE
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --repo)
            REPO="$2"
            shift 2
            ;;
        --keep-pr)
            KEEP_PR="$2"
            shift 2
            ;;
        --keep-branch)
            KEEP_BRANCH="$2"
            shift 2
            ;;
        --dry-run)
            DRY_RUN=1
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown argument: $1" >&2
            usage >&2
            exit 1
            ;;
    esac
done

if ! command -v gh >/dev/null 2>&1; then
    echo "Error: GitHub CLI ('gh') is required." >&2
    exit 1
fi

if [[ -z "$REPO" ]]; then
    REPO="$(gh repo view --json nameWithOwner --jq '.nameWithOwner' 2>/dev/null || echo "rsv-op/Heretic")"
fi

if [[ -z "$KEEP_BRANCH" ]]; then
    KEEP_BRANCH="$(gh pr view "$KEEP_PR" --repo "$REPO" --json headRefName --jq '.headRefName' 2>/dev/null || echo "arena/8c2d238a-heretic")"
fi

if [[ -z "$KEEP_BRANCH" ]]; then
    echo "Error: Unable to determine branch to preserve." >&2
    exit 1
fi

CURRENT_RUN_ID="${GITHUB_RUN_ID:-}"

echo "============================================================"
echo "Repository   : $REPO"
echo "Preserving   : PR #$KEEP_PR (branch: $KEEP_BRANCH)"
echo "Mode         : $([[ "$DRY_RUN" -eq 1 ]] && echo "DRY-RUN (no deletions)" || echo "LIVE DELETE")"
echo "============================================================"

deleted_releases=0
kept_releases=0
failed_releases=0

deleted_artifacts=0
kept_artifacts=0
failed_artifacts=0

deleted_runs=0
kept_runs=0
failed_runs=0

# ---------------------------------------------------------------------------
# 1. Delete old GitHub Releases and their associated build tags
# ---------------------------------------------------------------------------
echo ""
echo "[1/3] Scanning GitHub Releases..."
while IFS=$'\t' read -r rel_id tag_name target_commitish rel_name; do
    [[ -z "$rel_id" ]] && continue
    if [[ "$target_commitish" == "$KEEP_BRANCH" ]]; then
        echo "  [KEEP]   Release id=$rel_id tag=$tag_name ($rel_name)"
        kept_releases=$((kept_releases + 1))
    else
        if [[ "$DRY_RUN" -eq 1 ]]; then
            echo "  [DRY]    Would delete Release id=$rel_id tag=$tag_name ($rel_name)"
            deleted_releases=$((deleted_releases + 1))
        else
            echo "  [DELETE] Release id=$rel_id tag=$tag_name ($rel_name)"
            if gh api -X DELETE "repos/$REPO/releases/$rel_id" >/dev/null 2>&1; then
                if [[ -n "$tag_name" ]]; then
                    gh api -X DELETE "repos/$REPO/git/refs/tags/$tag_name" >/dev/null 2>&1 || true
                fi
                deleted_releases=$((deleted_releases + 1))
            else
                echo "  [WARN]   Insufficient token permission to delete Release id=$rel_id"
                failed_releases=$((failed_releases + 1))
            fi
        fi
    fi
done < <(
    gh api --paginate "repos/$REPO/releases" \
        --jq '.[] | [.id, .tag_name, .target_commitish, .name] | @tsv'
)

# ---------------------------------------------------------------------------
# 2. Delete old GitHub Actions APK / build artifacts (other than KEEP_BRANCH)
# ---------------------------------------------------------------------------
echo ""
echo "[2/3] Scanning GitHub Actions Artifacts..."
while IFS=$'\t' read -r art_id art_name art_branch art_expired art_run_id; do
    [[ -z "$art_id" ]] && continue
    if [[ "$art_branch" == "$KEEP_BRANCH" ]]; then
        echo "  [KEEP]   Artifact id=$art_id name=$art_name branch=$art_branch (run=$art_run_id)"
        kept_artifacts=$((kept_artifacts + 1))
    elif [[ "$art_expired" == "true" ]]; then
        echo "  [SKIP]   Artifact id=$art_id ($art_name) already expired"
    else
        if [[ "$DRY_RUN" -eq 1 ]]; then
            echo "  [DRY]    Would delete Artifact id=$art_id name=$art_name branch=$art_branch (run=$art_run_id)"
            deleted_artifacts=$((deleted_artifacts + 1))
        else
            echo "  [DELETE] Artifact id=$art_id name=$art_name branch=$art_branch (run=$art_run_id)"
            if gh api -X DELETE "repos/$REPO/actions/artifacts/$art_id" >/dev/null 2>&1; then
                deleted_artifacts=$((deleted_artifacts + 1))
            else
                echo "  [WARN]   Insufficient token permission to delete Artifact id=$art_id (requires actions:write)"
                failed_artifacts=$((failed_artifacts + 1))
            fi
        fi
    fi
done < <(
    gh api --paginate "repos/$REPO/actions/artifacts" \
        --jq '.artifacts[] | [.id, .name, (.workflow_run.head_branch // ""), .expired, (.workflow_run.id // 0)] | @tsv'
)

# ---------------------------------------------------------------------------
# 3. Delete old GitHub Actions Workflow Runs (other than KEEP_BRANCH)
# ---------------------------------------------------------------------------
echo ""
echo "[3/3] Scanning GitHub Actions Workflow Runs..."
while IFS=$'\t' read -r run_id run_branch run_status run_name run_created; do
    [[ -z "$run_id" ]] && continue
    if [[ "$run_branch" == "$KEEP_BRANCH" ]] || [[ -n "$CURRENT_RUN_ID" && "$run_id" == "$CURRENT_RUN_ID" ]]; then
        echo "  [KEEP]   Run id=$run_id branch=$run_branch ($run_name @ $run_created)"
        kept_runs=$((kept_runs + 1))
    else
        if [[ "$DRY_RUN" -eq 1 ]]; then
            echo "  [DRY]    Would delete Run id=$run_id branch=$run_branch status=$run_status ($run_name @ $run_created)"
            deleted_runs=$((deleted_runs + 1))
        else
            if [[ "$run_status" != "completed" ]]; then
                echo "  [CANCEL] Cancelling active Run id=$run_id branch=$run_branch"
                gh api -X POST "repos/$REPO/actions/runs/$run_id/cancel" >/dev/null 2>&1 || true
                sleep 2
            fi
            echo "  [DELETE] Run id=$run_id branch=$run_branch ($run_name @ $run_created)"
            if gh api -X DELETE "repos/$REPO/actions/runs/$run_id" >/dev/null 2>&1; then
                deleted_runs=$((deleted_runs + 1))
            else
                echo "  [WARN]   Insufficient token permission to delete Run id=$run_id (requires actions:write)"
                failed_runs=$((failed_runs + 1))
            fi
        fi
    fi
done < <(
    gh api --paginate "repos/$REPO/actions/runs" \
        --jq '.workflow_runs[] | [.id, (.head_branch // ""), .status, .name, .created_at] | @tsv'
)

echo ""
echo "============================================================"
echo "Cleanup Summary ($REPO)"
echo "  Releases : deleted=$deleted_releases, kept=$kept_releases, skipped=$failed_releases"
echo "  Artifacts: deleted=$deleted_artifacts, kept=$kept_artifacts, skipped=$failed_artifacts"
echo "  Runs     : deleted=$deleted_runs, kept=$kept_runs, skipped=$failed_runs"
echo "============================================================"
