#!/usr/bin/env bash
# delete-duplicate-repos.sh
#
# Borra todas las variantes "abaco-deep-*" para dejar UN SOLO repo.
# El usuario debe crear el repo nuevo "Abaco-deep-Core" después.
# ADVERTENCIA: ESTA ACCION ES IRREVERSIBLE.
#
# Conserva:
#   - Abaco-Universal-harnes-        (variante "universal")
#   - ABACO-DYNO-SCANNER-            (proyecto distinto)
#   - JOSECITO-                      (proyecto distinto)
#
# Requisitos: gh CLI autenticado (gh auth status).

set -euo pipefail

REPOS_TO_DELETE=(
    "Abaco-deep-Harnes"
    "abaco-deep-harnes-fork"
    "abaco-push-test"
)

echo "==============================================="
echo "  ABACO Deep Core - repo cleanup"
echo "==============================================="
echo ""
echo "Repos to DELETE (irreversible):"
for r in "${REPOS_TO_DELETE[@]}"; do
    echo "  - $r"
done
echo ""
echo "Repos to KEEP:"
echo "  - Abaco-Universal-harnes-"
echo "  - ABACO-DYNO-SCANNER-"
echo "  - JOSECITO-"
echo ""

read -rp "Confirm deletion? Type 'DELETE' to continue: " confirm
if [[ "$confirm" != "DELETE" ]]; then
    echo "Cancelled."
    exit 0
fi

# Step 1: local backup before any deletion.
BACKUP_DIR="$HOME/Desktop/abaco-backup-$(date +%Y%m%d-%H%M%S)"
echo ""
echo "→ Creating local backup at $BACKUP_DIR ..."
mkdir -p "$BACKUP_DIR"
if git clone --quiet "https://github.com/anthony-x507/Abaco-deep-Harnes.git" "$BACKUP_DIR/abaco-deep-harnes"; then
    echo "  ✓ backup cloned"
else
    echo "  ✗ clone failed (continuing anyway)"
fi

# Step 2: delete each repo.
for repo in "${REPOS_TO_DELETE[@]}"; do
    echo ""
    echo "→ Deleting $repo ..."
    if gh repo delete "anthony-x507/$repo" --yes; then
        echo "  ✓ $repo deleted"
    else
        echo "  ✗ error deleting $repo"
    fi
done

# Step 3: prompt the user to create the new repo.
echo ""
echo "==============================================="
echo "  Next steps"
echo "==============================================="
echo ""
echo "1. Open https://github.com/new"
echo ""
echo "2. Fill in the form with:"
echo "   - Repository name:    Abaco-deep-Core"
echo "   - Description:        Cross-platform desktop shell inspired by plugin-based agentic tooling."
echo "   - Visibility:         Public"
echo "   - DO NOT initialise with README, .gitignore, or license"
echo ""
echo "3. Then push the backup to the new repo:"
echo ""
echo "   cd $BACKUP_DIR/abaco-deep-harnes"
echo "   git remote remove origin"
echo "   git remote add origin https://github.com/anthony-x507/Abaco-deep-Core.git"
echo "   git push -u origin main"
echo ""
echo "4. Verify with:"
echo ""
echo "   gh repo list anthony-x507"
echo ""
echo "Backup location: $BACKUP_DIR"
