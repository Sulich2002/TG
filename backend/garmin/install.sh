#!/usr/bin/env bash
# Build generates garmin-setup.sh with a verified embedded source bundle.
set -euo pipefail
umask 022
[[ ${EUID} == 0 ]] || { echo 'Нужен терминал root.' >&2; exit 1; }
tg_bundle_sha='@TG_BUNDLE_SHA@'
[[ "$tg_bundle_sha" =~ ^[0-9a-f]{64}$ ]] || { echo 'Используй собранный установщик garmin-setup.sh.' >&2; exit 1; }
tg_root=/opt/tg-garmin
tg_state=/var/lib/tg-garmin
tg_temp=$(mktemp -d /tmp/tg-garmin-install.XXXXXX)
trap 'rm -rf "$tg_temp"' EXIT
trap 'echo "Установка остановлена. Настройки VPN не изменялись; пришли текст ошибки без паролей." >&2' ERR
[[ -d /run/systemd/system ]] || { echo 'Нужна система с systemd.' >&2; exit 1; }
[[ ! -e "$tg_root" || -f "$tg_root/.diary-garmin" ]] || { echo 'Каталог /opt/tg-garmin уже занят.' >&2; exit 1; }
[[ ! -e "$tg_state" || -f "$tg_root/.diary-garmin" ]] || { echo 'Каталог данных Garmin уже занят.' >&2; exit 1; }
[[ ! -e /usr/local/bin/tg-garmin || -f "$tg_root/.diary-garmin" ]] || { echo 'Команда tg-garmin уже занята.' >&2; exit 1; }
if id tg-garmin >/dev/null 2>&1 && [[ ! -f "$tg_root/.diary-garmin" ]]; then
  echo 'Пользователь tg-garmin уже существует и не принадлежит этой установке.' >&2; exit 1
fi
python3 - "$tg_root/.diary-garmin" <<'PY'
import socket, shutil, sys
from pathlib import Path
if shutil.disk_usage('/opt').free < 700*1024**2:
    raise SystemExit('Нужно минимум 700 МБ свободного места в /opt.')
with socket.socket() as s:
    try:
        s.bind(('127.0.0.1',8765))
    except OSError:
        if Path(sys.argv[1]).is_file():
            sys.exit(0)
        raise SystemExit('Порт 127.0.0.1:8765 уже занят. Сначала проверь существующий Garmin-сервис.')
PY
for tg_name in api sync tunnel; do
  if [[ -e "/etc/systemd/system/tg-garmin-$tg_name.service" && ! -f "$tg_root/.diary-garmin" ]]; then
    echo 'Имя службы Garmin уже занято.' >&2; exit 1
  fi
done
echo 'Устанавливаю отдельный Garmin-сервис. Порты и службы VPN останутся прежними.'
# BEGIN_GARMIN_SOURCE
python3 - "$tg_temp/source" "$tg_bundle_sha" <<'PY_SOURCE'
import base64, gzip, hashlib, json, sys
from pathlib import Path
packed = base64.b64decode("@TG_BUNDLE_B64@", validate=True)
if hashlib.sha256(packed).hexdigest() != sys.argv[2]:
    raise SystemExit('Контрольная сумма установщика не совпала. Установка остановлена.')
files = json.loads(gzip.decompress(packed))
allowed = {'api.py','core.py','health.py','connector.py','requirements.txt','requirements-uv.txt'}
if set(files) != allowed or not all(isinstance(v,str) for v in files.values()):
    raise SystemExit('Неподходящие файлы в установщике.')
target = Path(sys.argv[1]); target.mkdir(mode=0o755, parents=True, exist_ok=True)
for name, text in files.items():
    path = target/name
    if path.is_symlink():
        raise SystemExit('Нельзя перезаписать символьную ссылку.')
    path.write_text(text, encoding='utf-8'); path.chmod(0o644)
PY_SOURCE
# END_GARMIN_SOURCE
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=l
apt-get update -qq
apt-get install -y --no-install-recommends ca-certificates curl python3-venv
mkdir -p "$tg_root/app"
touch "$tg_root/.diary-garmin"
for tg_file in api.py core.py health.py connector.py requirements.txt requirements-uv.txt; do
  [[ ! -L "$tg_root/app/$tg_file" ]] || { echo 'Нельзя перезаписать символьную ссылку.' >&2; exit 1; }
  install -m 0644 "$tg_temp/source/$tg_file" "$tg_root/app/$tg_file"
done
printf '%s\n' "$tg_bundle_sha" > "$tg_root/source-sha256"
python3 -m venv "$tg_root/bootstrap"
"$tg_root/bootstrap/bin/python" -m pip install --disable-pip-version-check --cache-dir "$tg_root/cache/pip" --require-hashes -r "$tg_root/app/requirements-uv.txt"
export UV_PYTHON_INSTALL_DIR="$tg_root/python"
export UV_CACHE_DIR="$tg_root/cache"
export UV_SYSTEM_CERTS=true
export UV_PYTHON_BIN_DIR="$tg_root/bin"
"$tg_root/bootstrap/bin/uv" python install 3.12.14 --no-bin
"$tg_root/bootstrap/bin/uv" venv "$tg_root/venv" --python 3.12.14 --managed-python --allow-existing
"$tg_root/bootstrap/bin/uv" pip sync --python "$tg_root/venv/bin/python" --require-hashes "$tg_root/app/requirements.txt"
case $(uname -m) in
  x86_64) tg_arch=amd64; tg_cloud_sha=d33ff2d14475178d2012c2c56beba87389ac5ded27649519f198a7d3134a99db ;;
  aarch64|arm64) tg_arch=arm64; tg_cloud_sha=e6422b9d4f72d3194bc5a38676f13667c06666523217b842a877d72a80b5ac08 ;;
  *) echo 'Поддерживаются серверы x86_64 и arm64.' >&2; exit 1 ;;
esac
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  "https://github.com/cloudflare/cloudflared/releases/download/2026.10.0/cloudflared-linux-$tg_arch" -o "$tg_temp/cloudflared"
echo "$tg_cloud_sha  $tg_temp/cloudflared" | sha256sum --check --status
install -m 0755 "$tg_temp/cloudflared" "$tg_root/cloudflared.new"
mv -f "$tg_root/cloudflared.new" "$tg_root/cloudflared"
if ! id tg-garmin >/dev/null 2>&1; then
  useradd --system --user-group --home-dir "$tg_state" --shell /usr/sbin/nologin tg-garmin
fi
install -d -m 0700 -o tg-garmin -g tg-garmin "$tg_state"
install -d -m 0555 /var/empty/tg-garmin
cat > /usr/local/bin/tg-garmin <<'EOF'
#!/bin/sh
exec /opt/tg-garmin/venv/bin/python /opt/tg-garmin/app/connector.py "$@"
EOF
chmod 0755 /usr/local/bin/tg-garmin
for tg_component in api sync tunnel; do
  case "$tg_component" in api) tg_command=serve; tg_type=simple; tg_memory=128M ;; sync) tg_command=sync; tg_type=oneshot; tg_memory=384M ;; tunnel) tg_command=tunnel; tg_type=simple; tg_memory=192M ;; esac
  tg_unit="/etc/systemd/system/tg-garmin-$tg_component.service"
  if [[ -L "$tg_unit" ]]; then echo 'Файл службы оказался символьной ссылкой.' >&2; exit 1; fi
  cat > "$tg_unit" <<EOF
[Unit]
Description=Personal diary Garmin $tg_component
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=600
StartLimitBurst=5

[Service]
Type=$tg_type
User=tg-garmin
Group=tg-garmin
WorkingDirectory=/opt/tg-garmin/app
ExecStart=/opt/tg-garmin/venv/bin/python /opt/tg-garmin/app/connector.py $tg_command
Environment=TG_GARMIN_STATE=/var/lib/tg-garmin
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/tg-garmin
MemoryMax=$tg_memory
TasksMax=64
TimeoutStartSec=240

[Install]
WantedBy=multi-user.target
EOF
  if [[ "$tg_type" == simple ]]; then
    sed -i '/^Type=/a Restart=on-failure\nRestartSec=30' "$tg_unit"
  fi
done
cat > /etc/systemd/system/tg-garmin-sync.timer <<'EOF'
[Unit]
Description=Check personal Garmin activities every 15 minutes
[Timer]
OnBootSec=3min
OnUnitActiveSec=15min
RandomizedDelaySec=45
Unit=tg-garmin-sync.service
[Install]
WantedBy=timers.target
EOF
systemd-analyze verify /etc/systemd/system/tg-garmin-{api,sync,tunnel}.service /etc/systemd/system/tg-garmin-sync.timer
systemctl daemon-reload
"$tg_root/venv/bin/python" -c 'from garminconnect import Garmin; import curl_cffi; print("Garmin-клиент установлен.")'
echo 'Теперь введи данные Garmin. Не присылай снимки экрана с паролями.'
/usr/local/bin/tg-garmin connect
echo 'Через минуту выполни: tg-garmin status'
