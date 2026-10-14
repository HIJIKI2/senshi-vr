#!/usr/bin/env python3
"""外部の人に一時的に試してもらうための公開スクリプト（Cloudflare Tunnel の Quick Tunnel）。

  python share.py

で、このフォルダをローカル HTTP で配信し、cloudflared が発行する https://xxxx.trycloudflare.com の URL を表示します。
URL は起動するたびに変わり、Ctrl+C で終了すると無効になります。正規の証明書が付くので PICO 4 / Quest のブラウザでそのまま開けます。
cloudflared は `winget install --id Cloudflare.cloudflared --source winget` で導入済み（Program Files (x86)\\cloudflared）。
"""
import os, re, shutil, signal, subprocess, sys, threading, time

try: sys.stdout.reconfigure(encoding='utf-8')   # コンソールの文字化け対策
except Exception: pass
PORT = 8080
ROOT = os.path.dirname(os.path.abspath(__file__))
CANDIDATES = [shutil.which('cloudflared'),
              r'C:\Program Files (x86)\cloudflared\cloudflared.exe',
              r'C:\Program Files\cloudflared\cloudflared.exe']
CLOUDFLARED = next((p for p in CANDIDATES if p and os.path.exists(p)), None)
if not CLOUDFLARED:
    sys.exit('cloudflared が見つかりません: winget install --id Cloudflare.cloudflared --source winget')

# 1) ローカル HTTP サーバー（127.0.0.1 のみ。外からは cloudflared 経由の HTTPS で届く）
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1', '--directory', ROOT],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.0)

# 2) Quick Tunnel
tun = subprocess.Popen([CLOUDFLARED, 'tunnel', '--url', f'http://127.0.0.1:{PORT}', '--no-autoupdate'],
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace')
url = None

def reader():
    global url
    for line in tun.stdout:
        m = re.search(r'https://[a-z0-9-]+\.trycloudflare\.com', line)
        if m and not url:
            url = m.group(0)
            print('\n' + '=' * 64)
            print('  公開 URL（相手に伝える）:  ' + url)
            print('  ブラウザで開いて「VR を開始」。終了は Ctrl+C（URL は無効になります）')
            print('=' * 64 + '\n', flush=True)
        if 'error' in line.lower() or 'failed' in line.lower():
            print(line.rstrip(), flush=True)

threading.Thread(target=reader, daemon=True).start()
print('トンネルを作成中 …（10 秒ほど）', flush=True)

def stop(*_):
    for p in (tun, srv):
        try: p.terminate()
        except Exception: pass
    print('\n公開を終了しました。')
    sys.exit(0)

signal.signal(signal.SIGINT, stop)
try:
    while True:
        if tun.poll() is not None:
            print('cloudflared が終了しました（ネットワークを確認して再実行してください）'); stop()
        if srv.poll() is not None:
            print(f'ローカルサーバーが終了しました（ポート {PORT} が使用中かもしれません）'); stop()
        time.sleep(1)
except KeyboardInterrupt:
    stop()
