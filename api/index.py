import sys
import os

root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

from server import (
    app,
    health_check,
    get_license_info,
    activate_license,
    export_docx,
    upload_lesson,
    upload_and_parse_file,
    generate_lesson_plan,
    get_system_version,
    check_system_update,
    tts_khmer_route
)
from flask import request, jsonify

# Vercel entry dispatcher for /api/index
@app.route("/api/index", methods=["GET", "POST", "OPTIONS"])
@app.route("/api", methods=["GET", "POST", "OPTIONS"])
def vercel_entry_dispatch():
    if request.method == "OPTIONS":
        return "", 204

    v_path = request.args.get("__vercel_path") or request.args.get("match") or "health"
    v_clean = v_path.strip("/")
    endpoint_path = f"/api/{v_clean}"

    # Try matching via Flask's URL adapter
    adapter = app.url_map.bind_to_environ(request.environ)
    try:
        endpoint, values = adapter.match(endpoint_path, method=request.method)
        return app.view_functions[endpoint](**values)
    except Exception:
        pass

    # Direct fallback routing
    if v_clean in ["health", ""]:
        return health_check()
    elif v_clean == "license/info":
        return get_license_info()
    elif v_clean == "license/activate":
        return activate_license()
    elif v_clean == "export/docx":
        return export_docx()
    elif v_clean in ["upload/lesson", "upload/template", "upload/parse"]:
        return upload_and_parse_file()
    elif v_clean == "generate":
        return generate_lesson_plan()
    elif v_clean == "system/version":
        return get_system_version()
    elif v_clean == "system/check_update":
        return check_system_update()
    elif v_clean == "tts/khmer":
        return tts_khmer_route()

    return jsonify({"error": f"Endpoint /{v_clean} not found"}), 404
