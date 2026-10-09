import urllib.request
import time

time.sleep(2)
try:
    served = urllib.request.urlopen('http://127.0.0.1:8765/app.js', timeout=10).read()
    text = served.decode('utf-8', errors='replace')
    count = text.count('openApiKeyModal')
    print(f"openApiKeyModal count in SERVED app.js: {count}")
    local = open('app.js', 'rb').read()
    print(f"Served size: {len(served)} bytes")
    print(f"Local size:  {len(local)} bytes")
    if count > 0:
        print("SUCCESS: Server is serving the UPDATED app.js with API Key modal!")
    else:
        print("FAIL: Server still serving OLD app.js without openApiKeyModal")
        # Show where served ends vs local
        local_text = local.decode('utf-8', errors='replace')
        print(f"Last 100 chars of SERVED: {repr(text[-100:])}")
except Exception as e:
    print(f"Error connecting to server: {e}")
