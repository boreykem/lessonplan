import sys
import os
from urllib.parse import parse_qs

root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

from server import app

# Add root /api handler
@app.route("/api", methods=["GET", "POST"])
@app.route("/api/", methods=["GET", "POST"])
def api_root_endpoint():
    from flask import jsonify
    return jsonify({
        "status": "ok",
        "service": "AI Lesson Plan Studio (Python/Flask)",
        "version": "2.5.0"
    })

# WSGI Middleware to restore PATH_INFO and clear SCRIPT_NAME under Vercel serverless
class VercelPathMiddleware:
    def __init__(self, wsgi_app):
        self.wsgi_app = wsgi_app

    def __call__(self, environ, start_response):
        qs = parse_qs(environ.get("QUERY_STRING", ""))
        v_path = qs.get("__vercel_path", [None])[0]
        
        # Clear SCRIPT_NAME mount point so Flask matches routes from root
        environ["SCRIPT_NAME"] = ""
        
        if v_path:
            v_clean = v_path.strip("/")
            environ["PATH_INFO"] = f"/api/{v_clean}" if v_clean else "/api"
        else:
            matched = environ.get("HTTP_X_MATCHED_PATH") or environ.get("REQUEST_URI") or environ.get("PATH_INFO", "")
            clean = matched.split("?")[0] if matched else ""
            if clean and clean.startswith("/api"):
                environ["PATH_INFO"] = clean
            elif environ.get("PATH_INFO") and environ.get("PATH_INFO") != "/":
                environ["PATH_INFO"] = "/api" + environ.get("PATH_INFO")

        return self.wsgi_app(environ, start_response)

app.wsgi_app = VercelPathMiddleware(app.wsgi_app)
