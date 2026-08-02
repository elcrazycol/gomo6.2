#!/usr/bin/env bash
# =============================================================================
# sarif-to-issues.sh — конвертирует SARIF-отчёты сканеров в GitHub Issues.
#
# Для каждой находки (level = error/warning) создаёт отдельный Issue с меткой.
# Если уязвимость больше не встречается в свежем отчёте — старый Issue
# закрывается автоматически. Повторные запуски не плодят дубликаты.
#
# Использование:
#   sarif-to-issues.sh <sarif-файл-или-папка> <метка> <префикс-заголовка>
#
#   Примеры:
#     bash scripts/sarif-to-issues.sh sarif-results security/codeql CodeQL
#     bash scripts/sarif-to-issues.sh trivy-results.sarif security/trivy Trivy
#
# Требования: gh + jq (предустановлены на GitHub-hosted runners), GH_TOKEN.
#
# Настройка (переменные окружения):
#   SARIF_ISSUES_LEVELS — уровни, которые превращать в Issues (error,warning)
#   SARIF_ISSUES_IGNORE — regex путей, которые пропускать (vendor/node_modules)
# =============================================================================
set -euo pipefail

SARIF_PATH="${1:?Использование: sarif-to-issues.sh <sarif-файл-или-папка> <метка> <префикс>}"
LABEL="${2:?Укажите метку (label), например security/codeql}"
TOOL="${3:?Укажите префикс заголовка, например CodeQL}"

LEVELS="${SARIF_ISSUES_LEVELS:-error,warning}"
IGNORE_RE="${SARIF_ISSUES_IGNORE:-(^|/)(vendor|node_modules|bower_components)/}"

command -v gh >/dev/null 2>&1 || { echo "gh не установлен" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq не установлен" >&2; exit 1; }

# gh с явным репозиторием (в GitHub Actions всегда есть GITHUB_REPOSITORY)
ghr() {
  if [[ -n "${GITHUB_REPOSITORY:-}" ]]; then
    gh --repo "$GITHUB_REPOSITORY" "$@"
  else
    gh "$@"
  fi
}

# ── Собираем список SARIF-файлов ─────────────────────────────────────────────
SARIF_FILES=()
if [[ -d "$SARIF_PATH" ]]; then
  for f in "$SARIF_PATH"/*.sarif; do
    [[ -f "$f" ]] && SARIF_FILES+=("$f")
  done
else
  SARIF_FILES+=("$SARIF_PATH")
fi

if [[ ${#SARIF_FILES[@]} -eq 0 ]]; then
  echo "Нет SARIF-файлов в «$SARIF_PATH» — пропускаем."
  exit 0
fi

# ── Метки: общая `security` + метка инструмента (создаём, если их нет) ──────
ghr label create security --force --color b60205 \
  --description "Безопасность: уязвимости и авто-issues сканеров" >/dev/null 2>&1 || true
ghr label create "$LABEL" --force --color d73a4a \
  --description "Автоматические Issues от $TOOL" >/dev/null 2>&1 || true

# ── Временные файлы ──────────────────────────────────────────────────────────
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
OPEN_JSON="$TMP_DIR/open.json"
OPEN_TITLES="$TMP_DIR/open-titles.txt"
CURRENT_TITLES="$TMP_DIR/current-titles.txt"
: > "$CURRENT_TITLES"

# Открытые Issues с нашей меткой — для дедупликации и авто-закрытия.
# Лимит большой, но если открытых Issues больше — дубликаты возможны.
ghr issue list --label "$LABEL" --state open --limit 1000 \
  --json number,title > "$OPEN_JSON" 2>/dev/null || true
jq -r '.[].title' "$OPEN_JSON" 2>/dev/null > "$OPEN_TITLES" || true

created=0
skipped=0
closed=0
parsed=0   # сколько SARIF-файлов реально прочитано

# ── Проходим по всем SARIF-файлам ────────────────────────────────────────────
for sarif in "${SARIF_FILES[@]}"; do
  echo "Обрабатываю: $sarif"
  [[ -s "$sarif" ]] || { echo "  пусто или нет файла — пропуск"; continue; }
  if ! jq -e '.runs | length > 0' "$sarif" >/dev/null 2>&1; then
    echo "  не похоже на SARIF — пропуск"
    continue
  fi
  parsed=$((parsed + 1))

  # ruleId → helpUri (ссылка на документацию правила / CVE)
  RULES_FILE="$TMP_DIR/rules.tsv"
  jq -r '.runs[].tool.driver.rules[]? | [.id, (.helpUri // "")] | @tsv' \
    "$sarif" > "$RULES_FILE" 2>/dev/null || true

  # Каждая находка → отдельный Issue
  while IFS= read -r res; do
    [[ -n "$res" ]] || continue

    rule="$(jq -r '.ruleId // "unknown"' <<<"$res")"
    level="$(jq -r '.level // "warning"' <<<"$res")"
    msg="$(jq -r '.message.text // ""' <<<"$res")"
    uri="$(jq -r '.locations[0].physicalLocation.artifactLocation.uri // ""' <<<"$res")"
    line="$(jq -r '.locations[0].physicalLocation.region.startLine // 0' <<<"$res")"

    # Фильтры: уровень + шумные пути (vendor/node_modules)
    [[ ",$LEVELS," == *",$level,"* ]] || continue
    uri="${uri#file://}"
    [[ -n "$uri" && "$uri" =~ $IGNORE_RE ]] && continue
    [[ -n "$uri" ]] || uri="unknown"

    if [[ "$line" != "0" && "$line" != "null" ]]; then
      location="${uri}:${line}"
    else
      location="$uri"
    fi

    title="[$TOOL] ${rule} — ${location}"
    echo "$title" >> "$CURRENT_TITLES"

    # Дедупликация: такой Issue уже открыт?
    if grep -Fqx "$title" "$OPEN_TITLES"; then
      skipped=$((skipped + 1))
      continue
    fi

    BODY="$TMP_DIR/body.md"
    help_uri="$(awk -F '\t' -v id="$rule" '$1 == id { print $2; exit }' "$RULES_FILE")"
    {
      # Та же структура, что в .github/ISSUE_TEMPLATE/security-vulnerability.yml
      echo "| **Сканер** | ${TOOL} |"
      echo "| **Severity** | ${level} |"
      echo "| **Правило** | \`${rule}\` |"
      echo "| **Место** | \`${location}\` |"
      echo
      if [[ -n "$msg" ]]; then
        echo "## Что нашлось"
        echo
        echo "${msg}"
        echo
      fi
      if [[ -n "$help_uri" ]]; then
        echo "## Подробнее"
        echo
        echo "[Документация правила]($help_uri)"
        echo
      fi
      echo "---"
      echo "_Автоматически создано ${TOOL}. Заголовок — ключ дедупликации, не редактируйте его._"
    } > "$BODY"

    ghr issue create --title "$title" --body-file "$BODY" \
      --label security --label "$LABEL"
    created=$((created + 1))
  done < <(jq -c '.runs[].results[]?' "$sarif")
done

# ── Авто-закрытие: уязвимость больше не обнаружена ───────────────────────────
# Только если хотя бы один SARIF реально прочитан — иначе (все файлы битые)
# скрипт массово закрыл бы все Issues, хотя сканер ничего не сообщил.
if [[ "$parsed" -gt 0 ]]; then
  sort -u "$CURRENT_TITLES" -o "$CURRENT_TITLES"
  while IFS=$'\t' read -r num t; do
    [[ -n "$num" ]] || continue
    if ! grep -Fqx "$t" "$CURRENT_TITLES"; then
      ghr issue close "$num" \
        --comment "Больше не обнаружено сканером — закрываю автоматически."
      closed=$((closed + 1))
    fi
  done < <(jq -r '.[] | [.number, .title] | @tsv' "$OPEN_JSON" 2>/dev/null || true)
else
  echo "Ни один SARIF-файл не прочитан — авто-закрытие пропущено."
fi

# ── Итог ─────────────────────────────────────────────────────────────────────
echo
echo "Итог ${TOOL}: создано ${created}, уже открыто ${skipped}, закрыто ${closed}."
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo "## ${TOOL} → Issues"
    echo
    echo "- Создано: **${created}**"
    echo "- Уже было: **${skipped}**"
    echo "- Закрыто (исправлено): **${closed}**"
  } >> "$GITHUB_STEP_SUMMARY"
fi
