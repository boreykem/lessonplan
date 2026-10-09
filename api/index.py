import sys
import os

root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

from server import app

# Debug route to see exact Vercel environ headers
@app.route("/api", methods=["GET", "POST"])
@app.route("/api/", methods=["GET", "POST"])
def debug_environ():
    from flask import request, jsonify
    return jsonify({
        "path": request.path,
        "query": request.query_string.decode('utf-8', errors='ignore'),
        "x_matched_path": request.headers.get("X-Matched-Path"),
        "x_now_route_matches": request.headers.get("X-Now-Route-Matches"),
        "x_vercel_path": request.headers.get("X-Vercel-Forwarded-For"),
        "environ_path_info": request.environ.get("PATH_INFO"),
        "environ_request_uri": request.environ.get("REQUEST_URI"),
        "environ_interesting": {k: str(v) for k, v in request.environ.items() if any(w in k.upper() for w in ['PATH', 'URI', 'URL', 'VERCEL', 'MATCH', 'ROUTE'])}
    })

# Also register routes without /api prefix as aliases
# (e.g. /health -> /api/health, /license/info -> /api/license/info)
try:
    for rule in list(app.url_map.iter_rules()):
        if rule.rule.startswith("/api/"):
            alt_rule = rule.rule[4:] # remove /api
            if alt_rule not in [r.rule for r in app.url_map.iter_rules()]:
                app.add_url_rule(alt_rule, endpoint=f"alt_{rule.endpoint}", view_func=app.view_functions[rule.endpoint], methods=rule.methods)
except Exception as e:
    print("Route alias notice:", e)
