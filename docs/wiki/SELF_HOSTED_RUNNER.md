# Self-hosted раннер сборки (Mac)

Сборка образов идёт на этом Mac, а не на GitHub-hosted раннерах. Причина простая: между запусками живут тёплый
BuildKit-кэш (`$HOME/gomo6-buildx-cache/<service>`) и cache-mounts из Dockerfile'ов (`/root/.npm`,
`/root/.cache/go-build`). После первой сборки web-only коммит собирается за десятки секунд, тогда как на чистом
раннере те же `npm ci` и `go build` идут с нуля каждые три минуты.

## Что где выполняется

| Что | Где | Почему |
|---|---|---|
| Проверки CI (`ci.yml`) | GitHub-hosted `ubuntu-latest` | бесплатно, параллельно и не занимает Mac |
| Сборка и выкат (`deploy.yml` → `ship`) | self-hosted Mac | тёплый кэш |
| Полные тесты, сканеры безопасности | GitHub-hosted | по расписанию |

**Mac никогда не задействован в PR-прогонах.** PR-проверки идут на GitHub-hosted, а `ship` срабатывает только на
push в `main` или ручной запуск. Благодаря этому код из форка не может попасть на вашу машину. Не добавляйте
self-hosted раннер в job, который триггерится на `pull_request` — это откроет ровно ту дыру, которой здесь нет.

## Установка

Нужны: Docker Desktop (запущен), `gh`, авторизованный как владелец репозитория, и ~1 ГБ на диске на инстанс.

```bash
REPO=elcrazycol/gomo6.2
ROOT="$HOME/github-runner"
COUNT=4

export GH_TOKEN="$(gh auth token --user <владелец>)"
REG_TOKEN="$(gh api -X POST "repos/$REPO/actions/runners/registration-token" --jq .token)"
VER="$(gh api repos/actions/runner/releases/latest --jq '.tag_name' | sed 's/^v//')"

mkdir -p "$ROOT"
curl -fsSL -o "$ROOT/actions-runner-osx-arm64-$VER.tar.gz" \
  "https://github.com/actions/runner/releases/download/v$VER/actions-runner-osx-arm64-$VER.tar.gz"

for i in $(seq 1 "$COUNT"); do
  D="$ROOT/runner-$i"; mkdir -p "$D"
  tar xzf "$ROOT/actions-runner-osx-arm64-$VER.tar.gz" -C "$D"

  # launchd-агенту достаётся урезанный PATH без /usr/local/bin, где живёт docker.
  # runsvc.sh читает .path при старте — без него шаги падают на «docker: command not found».
  printf '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin\n' > "$D/.path"

  ( cd "$D" && ./config.sh \
      --url "https://github.com/$REPO" \
      --token "$REG_TOKEN" \
      --name "gomo6-mac-$i" \
      --work "_work" \
      --labels "gomo6-build" \
      --unattended --replace )

  ( cd "$D" && ./svc.sh install "$(whoami)" && ./svc.sh start )
done
```

Токен регистрации живёт час и годится для всех инстансов сразу — его можно получить через API, не заходя в веб.

Детали, которые важны:

- **`--unattended --replace`** — без интерактива и идемпотентно: повторный запуск перерегистрирует тот же инстанс,
  а не упадёт с «runner already exists».
- **`--work "_work"`** — свой рабочий каталог у каждого инстанса (он внутри `runner-N`).
- **`--labels "gomo6-build"`** добавляет метку; базовые `self-hosted`, `macOS`, `ARM64` GitHub проставляет сам. Именно
  их и ждёт `deploy.yml` (`runs-on: [self-hosted, macOS, ARM64]`).
- **`.path` обязателен.** `launchctl getenv PATH` пуст, то есть агенту достаётся `/usr/bin:/bin:/usr/sbin:/sbin`, а
  `docker` лежит в `/usr/local/bin`. `svc.sh install` умеет перезаписать `.path` текущим PATH вызывающего шелла — это
  тоже рабочий вариант, лишь бы `/usr/local/bin` там был.
- **`svc.sh install`** ставит LaunchAgent (`~/Library/LaunchAgents/actions.runner.<owner>-<repo>.<name>.plist`), а не
  демон: агент работает в пользовательской сессии и видит сокет Docker Desktop.

## Параллельность

Один процесс `actions-runner` выполняет один job за раз. `deploy.yml` — это matrix из четырёх сервисов, поэтому для
настоящей параллельности нужно четыре инстанса. С одним агентом matrix отработает последовательно: корректно, но
медленнее.

## Docker Desktop

Сборка использует локальный демон и `buildx`, поэтому Docker Desktop должен быть запущен. Его собственный автозапуск
на macOS может не регистрироваться (`AutoStartError: option disabled because operation is not permitted when
registering app service`), тогда добавьте приложение в объекты входа:

```bash
osascript -e 'tell application "System Events" to make login item at end with properties {path:"/Applications/Docker.app", hidden:true}'
```

## Проверка

```bash
# все инстансы онлайн и с правильными метками
gh api repos/elcrazycol/gomo6.2/actions/runners \
  --jq '.runners[] | "\(.name)\t\(.status)\t\([.labels[].name] | join(","))"'

# службы живы
for i in 1 2 3 4; do ( cd ~/github-runner/runner-$i && ./svc.sh status ); done

# .path действительно читается runsvc.sh
grep -n '\.path' ~/github-runner/runner-1/runsvc.sh

# PATH внутри живого процесса агента (docker должен находиться)
ps eww -p "$(pgrep -f 'runner-1/bin/Runner.Listener' | head -1)" | tr ' ' '\n' | grep '^PATH='
```

## Эксплуатация

```bash
D=~/github-runner/runner-2
(cd "$D" && ./svc.sh stop && ./svc.sh start)      # перезапуск
ls -t "$D"/_diag/*.log | head -1 | xargs tail -f  # логи агента
```

- **Автообновление.** Раннеры обновляют себя сами между джобами; `.path` — отдельный файл, апдейт его не затирает.
- **Не запускайте `config.sh` повторно на живом инстансе:** он меняет личность раннера и в GitHub останется
  фантомный оффлайн-агент. Порядок: `svc.sh stop` → `config.sh remove --token <fresh>` → `config.sh …` →
  `svc.sh install`.
- **`KeepAlive` в plist нет** (это стандарт GitHub). Если процесс упадёт, агент не поднимется сам до следующего входа
  в систему. Проверять `./svc.sh status`, поднимать `./svc.sh start`.
- **Диск.** Растут `$HOME/gomo6-buildx-cache` и `runner-*/_work`. Держите хотя бы 20 ГБ свободными:
  `docker builder prune -f && docker image prune -f` (хост-каталог buildx-кэша при этом цел, скорость сборок не
  теряется).
- **Старый `forgejo-runner`** (Codeberg) выведен из игры вместе с `.forgejo` → `.forgejo-old`: он больше не нужен,
  сборку и деплой ведёт GitHub.
