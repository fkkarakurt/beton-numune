# -*- coding: utf-8 -*-
"""Yerel geliştirme sunucusu — docs/ klasörünü doğru MIME türleriyle sunar.

Windows'ta python -m http.server, MIME türlerini sistem kayıt defterinden
okur ve .js/.mjs dosyalarını 'text/plain' olarak sunabilir; tarayıcılar ES
modüllerinde MIME türünü katı denetlediğinden uygulama açılmaz. Bu betik
türleri açıkça tanımlar. (GitHub/Cloudflare Pages'te bu sorun yoktur.)
"""
import http.server
import os

PORT = 8756
DIRECTORY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "docs")

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".pdf": "application/pdf",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def guess_type(self, path):
        ext = os.path.splitext(str(path))[1].lower()
        return MIME.get(ext) or super().guess_type(path)


if __name__ == "__main__":
    print(f"Beton Numune Değerlendirme -> http://127.0.0.1:{PORT}")
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
