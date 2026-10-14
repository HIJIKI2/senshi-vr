"""HTTPS 開発サーバー（WebXR は HTTPS 必須）

使い方:  python serve.py [port]
Quest 3 のブラウザで  https://<このPCのIPアドレス>:8443/  を開く
"""
import http.server
import mimetypes
import os
import socket
import ssl
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8443
ROOT = os.path.dirname(os.path.abspath(__file__))
CERT = os.path.join(ROOT, "certs", "cert.pem")
KEY = os.path.join(ROOT, "certs", "key.pem")

# Windows はレジストリ由来で .js が text/plain になることがあるため明示
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("image/svg+xml", ".svg")


class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"   # keep-alive（ブラウザの多数の同時リクエストでハンドシェイク回数を減らす）

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def handle(self):
        # TLS ハンドシェイクは接続ごとのスレッドで行う（accept ループを塞がない）
        try:
            self.connection.do_handshake()
        except (ssl.SSLError, OSError):
            return
        super().handle()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))
        sys.stderr.flush()


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 64

    def get_request(self):
        # 受け付けたソケットを個別に TLS 化（ハンドシェイクは遅延実行）
        sock, addr = self.socket.accept()
        return ctx.wrap_socket(sock, server_side=True, do_handshake_on_connect=False), addr


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


if not (os.path.exists(CERT) and os.path.exists(KEY)):
    sys.exit("certs/cert.pem, certs/key.pem がありません。README の手順で作成してください。")

ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(CERT, KEY)
httpd = Server(("0.0.0.0", PORT), Handler)
print(f"配信中:  https://{lan_ip()}:{PORT}/   (Ctrl+C で停止)", flush=True)
print("Quest 側で証明書の警告が出たら「詳細設定」→「アクセスする」を選択してください。", flush=True)
try:
    httpd.serve_forever()
except KeyboardInterrupt:
    pass
