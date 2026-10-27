#!/usr/bin/env python3
"""Static dev server that disables HTTP caching, so edited JS / regenerated assets are never mixed with
stale cached copies.

Usage:
  python3 serve.py                      # http://127.0.0.1:8000 (this machine only)
  python3 serve.py 9000                 # another port
  python3 serve.py --host 0.0.0.0       # reachable from other devices on your network (e.g. a phone)
"""
import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


def main():
    ap = argparse.ArgumentParser(description="No-cache static file server for the current directory.")
    ap.add_argument("port", nargs="?", type=int, default=8000, help="port to listen on (default 8000)")
    ap.add_argument("--host", "-b", "--bind", dest="host", default="127.0.0.1",
                    help="address to bind (default 127.0.0.1; use 0.0.0.0 to serve on all interfaces)")
    args = ap.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), NoCache)
    shown = "localhost" if args.host in ("127.0.0.1", "0.0.0.0", "") else args.host
    print("Serving on http://%s:%d  (bound to %s)" % (shown, args.port, args.host or "all interfaces"))
    if args.host in ("0.0.0.0", ""):
        print("Warning: reachable by every device on your network; it serves this whole directory.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
