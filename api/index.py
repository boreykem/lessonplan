import sys
import os

root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

from server import app

# Add handler for root /api and /api/
@app.route("/api", methods=["GET", "POST"])
@app.route("/api/", methods=["GET", "POST"])
def api_root_endpoint():
    from flask import jsonify
    return jsonify({
        "status": "ok",
        "service": "AI Lesson Plan Studio (Python/Flask)",
        "version": "2.5.0"
    })

# WSGI Middleware to ensure /api routes match accurately under Vercel serverless rewrites
class VercelPathMiddleware:
    def __init__(self, wsgi_app):
        self.wsgi_app = wsgi_app

    def __call__(self, environ, start_response):
        matched = environ.get("HTTP_X_MATCHED_PATH") or environ.get("REQUEST_URI") or environ.get("PATH_INFO", "")
        # Strip query parameters if present
        clean_path = matched.split("?")[0] if matched else ""
        
        if clean_path and clean_path.startswith("/api/"):
            environ["PATH_INFO"] = clean_path
        elif not environ.get("PATH_INFO", "").startswith("/api"):
            curr = environ.get("PATH_INFO", "")
            if curr and curr != "/":
                environ["PATH_INFO"] = "/api" + curr

        return self.wsgi_app(environ, start_response)

app.wsgi_app = VercelPathMiddleware(app.wsgi_app)
