"""
AI Lesson Plan Studio - Professional Silent Background Launcher
Runs Python Server and opens the browser with ZERO black CMD console windows.
Auto-detects Python across system/local paths and ensures 100% startup reliability.
"""

import os
import sys
import glob
import time
import shutil
import subprocess
import webbrowser
import urllib.request
import tkinter as tk
from tkinter import messagebox


def get_base_dir():
    """Gets directory where application files are located."""
    if getattr(sys, 'frozen', False):
        return os.path.dirname(os.path.abspath(sys.executable))
    return os.path.dirname(os.path.abspath(__file__))


def is_server_running(url="http://127.0.0.1:8765"):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "ALPS-HealthCheck"})
        with urllib.request.urlopen(req, timeout=1.5) as res:
            return res.status == 200
    except Exception:
        return False


def find_python_exec():
    """Finds the best Python executable across PATH, LocalAppData, and ProgramFiles."""
    candidates = []

    # 1. Check sys.executable if not frozen
    if not getattr(sys, 'frozen', False) and sys.executable:
        candidates.append(sys.executable)

    # 2. Check which on PATH
    for name in ["pythonw", "pyw", "python", "py"]:
        path = shutil.which(name)
        if path and "WindowsApps" not in path:
            candidates.append(path)

    # 3. Check LocalAppData Python installations (Python 3.10 - 3.14)
    local_app_data = os.environ.get("LOCALAPPDATA", "")
    if local_app_data:
        # Pattern 1: AppData\Local\Python\pythoncore-*
        candidates.extend(glob.glob(os.path.join(local_app_data, "Python", "pythoncore-*", "pythonw.exe")))
        candidates.extend(glob.glob(os.path.join(local_app_data, "Python", "pythoncore-*", "python.exe")))
        # Pattern 2: AppData\Local\Programs\Python\Python*
        candidates.extend(glob.glob(os.path.join(local_app_data, "Programs", "Python", "Python*", "pythonw.exe")))
        candidates.extend(glob.glob(os.path.join(local_app_data, "Programs", "Python", "Python*", "python.exe")))

    # 4. Check ProgramFiles / C:\
    program_files = os.environ.get("ProgramFiles", "C:\\Program Files")
    candidates.extend(glob.glob(os.path.join(program_files, "Python*", "pythonw.exe")))
    candidates.extend(glob.glob(os.path.join(program_files, "Python*", "python.exe")))
    candidates.extend(glob.glob("C:\\Python*\\pythonw.exe"))
    candidates.extend(glob.glob("C:\\Python*\\python.exe"))

    # 5. Fallback standard names
    candidates.extend(["pythonw.exe", "pyw.exe", "python.exe", "py.exe"])

    # Test candidate executables
    for exe in candidates:
        if not exe:
            continue
        try:
            res = subprocess.run([exe, "-c", "import sys; print(sys.version)"], capture_output=True, text=True, timeout=2)
            if res.returncode == 0:
                # If python.exe was found, prefer pythonw.exe in the same folder for windowless execution
                if exe.lower().endswith("python.exe"):
                    w_variant = exe[:-10] + "pythonw.exe"
                    if os.path.exists(w_variant):
                        return w_variant
                return exe
        except Exception:
            continue

    return "python"


def ensure_dependencies(py_exec):
    """Ensure required packages (flask, python-docx, pypdf) are installed."""
    base_dir = get_base_dir()
    req_file = os.path.join(base_dir, "requirements.txt")
    if not os.path.exists(req_file):
        return

    CREATE_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0
    try:
        # Check if flask is installed
        check = subprocess.run([py_exec, "-c", "import flask"], capture_output=True, creationflags=CREATE_NO_WINDOW, timeout=3)
        if check.returncode != 0:
            cmd = [py_exec, "-m", "pip", "install", "-r", req_file, "--quiet", "--no-warn-script-location"]
            subprocess.run(cmd, creationflags=CREATE_NO_WINDOW, timeout=45)
    except Exception:
        pass


def start_server():
    base_dir = get_base_dir()
    server_py = os.path.join(base_dir, "server.py")
    if not os.path.exists(server_py):
        show_error(f"រកមិនឃើញឯកសារប្រព័ន្ធ server.py នៅក្នុងថត:\n{base_dir}")
        return False

    py_exec = find_python_exec()
    ensure_dependencies(py_exec)

    CREATE_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0
    try:
        subprocess.Popen(
            [py_exec, server_py],
            cwd=base_dir,
            creationflags=CREATE_NO_WINDOW,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL
        )
        return True
    except Exception as e:
        show_error(f"មិនអាចបើកដំណើរការ Server បានទេ:\n{e}")
        return False


def show_error(msg):
    try:
        root = tk.Tk()
        root.withdraw()
        messagebox.showerror("AI Lesson Plan Studio - កំហុសដំណើរការ", msg)
        root.destroy()
    except Exception:
        pass


def main():
    target_url = "http://127.0.0.1:8765"

    if not is_server_running(target_url):
        if not start_server():
            return

        # Wait up to 6 seconds for server to be responsive
        for _ in range(60):
            if is_server_running(target_url):
                break
            time.sleep(0.1)

    # Open Browser reliably in foreground
    if sys.platform == "win32":
        try:
            os.system(f'start "" "{target_url}"')
        except Exception:
            try:
                subprocess.Popen(["cmd.exe", "/c", "start", "", target_url], creationflags=0x08000000)
            except Exception:
                webbrowser.open(target_url)
    else:
        webbrowser.open(target_url)


if __name__ == "__main__":
    main()
