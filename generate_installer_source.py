"""
AI Lesson Plan Studio - Professional Setup Installer Generator
Bundles all production application files into a standalone GUI Setup_AI_Lesson_Plan.exe.
Excludes keygen and private seller tools.
"""

import os
import sys
import zipfile
import base64
import tkinter as tk
from tkinter import ttk, filedialog, messagebox
import subprocess
import shutil
import threading

# List of files to bundle for customer installation
CUSTOMER_FILES = [
    "AI_Lesson_Plan_Studio.exe",
    "start_app.vbs",
    "silent_launcher.py",
    "index.html",
    "app.js",
    "style.css",
    "server.py",
    "license_engine.py",
    "requirements.txt",
    "start_app.bat",
    "open_offline_browser.bat",
    "create_desktop_shortcut.bat",
    "create_shortcut.ps1"
]


def create_customer_zip_bytes():
    """Compresses customer files in memory as bytes."""
    base_dir = os.path.dirname(os.path.abspath(__file__))
    zip_path = os.path.join(base_dir, "_customer_payload.zip")

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for fname in CUSTOMER_FILES:
            fpath = os.path.join(base_dir, fname)
            if os.path.exists(fpath):
                zf.write(fpath, arcname=fname)

    with open(zip_path, "rb") as f:
        data = f.read()

    try:
        os.remove(zip_path)
    except Exception:
        pass

    return data


# Template for the Installer GUI script
INSTALLER_SCRIPT_TEMPLATE = '''# -*- coding: utf-8 -*-
"""
AI Lesson Plan Studio - Setup Wizard
"""
import os
import sys
import zipfile
import io
import base64
import tkinter as tk
from tkinter import ttk, messagebox, filedialog
import threading
import subprocess

PAYLOAD_B64 = """__ZIP_PAYLOAD_B64__"""

class SetupWizard:
    def __init__(self, root):
        self.root = root
        self.root.title("AI Lesson Plan Studio - Setup Wizard")
        self.root.geometry("540x380")
        self.root.resizable(False, False)
        
        # Center Window
        self.root.eval('tk::PlaceWindow . center')
        
        # Default destination folder
        appdata = os.environ.get("LOCALAPPDATA", os.path.expanduser("~"))
        self.dest_dir = tk.StringVar(value=os.path.join(appdata, "AI_Lesson_Plan_Studio"))
        self.create_desktop_icon = tk.BooleanVar(value=True)
        self.launch_after = tk.BooleanVar(value=True)

        self.setup_ui()

    def setup_ui(self):
        # Header Banner
        header = tk.Frame(self.root, bg="#1e293b", height=70)
        header.pack(fill=tk.X)
        
        lbl_title = tk.Label(
            header, 
            text="AI Lesson Plan Studio Setup", 
            font=("Segoe UI", 13, "bold"), 
            fg="#ffffff", 
            bg="#1e293b"
        )
        lbl_title.pack(anchor="w", padx=20, pady=(12, 2))
        
        lbl_sub = tk.Label(
            header, 
            text="កម្មវិធីដំឡើងប្រព័ន្ធបង្កើតកិច្ចតែងការបង្រៀនស្វ័យប្រវត្តិ", 
            font=("Kantumruy Pro", 9), 
            fg="#94a3b8", 
            bg="#1e293b"
        )
        lbl_sub.pack(anchor="w", padx=20)

        # Body Container
        body = tk.Frame(self.root, padx=20, pady=15)
        body.pack(fill=tk.BOTH, expand=True)

        lbl_desc = tk.Label(
            body, 
            text="សូមស្វាគមន៍មកកាន់ផ្ទាំងដំឡើង AI Lesson Plan Studio!\\nកម្មវិធីនឹងដំឡើងឯកសារទាំងអស់ចូលទៅកាន់កុំព្យូទ័ររបស់អ្នក។", 
            font=("Kantumruy Pro", 9), 
            justify="left",
            wraplength=490
        )
        lbl_desc.pack(anchor="w", pady=(0, 10))

        # Folder Destination Selector
        lbl_folder = tk.Label(body, text="📁 ទីតាំងដំឡើងកម្មវិធី (Install Directory):", font=("Segoe UI", 9, "bold"))
        lbl_folder.pack(anchor="w")

        dir_frame = tk.Frame(body)
        dir_frame.pack(fill=tk.X, pady=4)

        ent_dir = tk.Entry(dir_frame, textvariable=self.dest_dir, font=("Segoe UI", 9))
        ent_dir.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 6))

        btn_browse = tk.Button(dir_frame, text="Browse...", command=self.browse_folder, font=("Segoe UI", 8))
        btn_browse.pack(side=tk.RIGHT)

        # Options
        chk_desktop = tk.Checkbutton(
            body, 
            text="បង្កើត Shortcut នៅលើ Desktop", 
            variable=self.create_desktop_icon, 
            font=("Kantumruy Pro", 9)
        )
        chk_desktop.pack(anchor="w", pady=4)

        chk_launch = tk.Checkbutton(
            body, 
            text="បើកដំណើរការកម្មវិធីភ្លាមៗក្រោយដំឡើងរួច", 
            variable=self.launch_after, 
            font=("Kantumruy Pro", 9)
        )
        chk_launch.pack(anchor="w")

        # Progress Bar
        self.progress = ttk.Progressbar(body, mode="indeterminate")
        self.progress.pack(fill=tk.X, pady=(10, 4))

        self.lbl_status = tk.Label(body, text="រួចរាល់សម្រាប់ការដំឡើង", font=("Kantumruy Pro", 8), fg="#64748b")
        self.lbl_status.pack(anchor="w")

        # Footer Buttons
        footer = tk.Frame(self.root, bg="#f1f5f9", height=50)
        footer.pack(fill=tk.X, side=tk.BOTTOM)

        self.btn_install = tk.Button(
            footer, 
            text="🚀 ដំឡើងឥឡូវនេះ (Install)", 
            command=self.start_installation, 
            bg="#2563eb", 
            fg="white", 
            font=("Segoe UI", 9, "bold"),
            padx=14, 
            pady=4,
            relief="flat",
            cursor="hand2"
        )
        self.btn_install.pack(side=tk.RIGHT, padx=15, pady=10)

        self.btn_cancel = tk.Button(
            footer, 
            text="បោះបង់ (Cancel)", 
            command=self.root.destroy, 
            bg="#e2e8f0", 
            font=("Segoe UI", 9),
            padx=10, 
            pady=4,
            relief="flat"
        )
        self.btn_cancel.pack(side=tk.RIGHT, padx=6, pady=10)

    def browse_folder(self):
        folder = filedialog.askdirectory(initialdir=self.dest_dir.get())
        if folder:
            self.dest_dir.set(os.path.join(folder, "AI_Lesson_Plan_Studio"))

    def start_installation(self):
        self.btn_install.config(state="disabled")
        self.btn_cancel.config(state="disabled")
        self.progress.start(10)
        self.lbl_status.config(text="កំពុងដំឡើងឯកសារ... សូមរង់ចាំ")
        
        thread = threading.Thread(target=self.install_process)
        thread.daemon = True
        thread.start()

    def install_process(self):
        target = self.dest_dir.get()
        try:
            os.makedirs(target, exist_ok=True)
            zip_bytes = base64.b64decode(PAYLOAD_B64)
            with zipfile.ZipFile(io.BytesIO(zip_bytes), "r") as zf:
                zf.extractall(target)

            # Auto-install dependencies if needed
            req_file = os.path.join(target, "requirements.txt")
            if os.path.exists(req_file):
                for py_cmd in ["py", "python", sys.executable]:
                    try:
                        res = subprocess.run([py_cmd, "-m", "pip", "install", "-r", req_file, "--quiet", "--no-warn-script-location"], capture_output=True, timeout=40)
                        if res.returncode == 0:
                            break
                    except Exception:
                        pass

            # Create Desktop Shortcut
            if self.create_desktop_icon.get():
                self.create_shortcut(target)

            self.root.after(0, self.installation_complete, True, "ដំឡើងជោគជ័យ!")
        except Exception as e:
            self.root.after(0, self.installation_complete, False, str(e))

    def create_shortcut(self, target_dir):
        try:
            desktop = os.path.join(os.environ.get("USERPROFILE", os.path.expanduser("~")), "Desktop")
            shortcut_path = os.path.join(desktop, "AI Lesson Plan Studio.lnk")

            target_exe = os.path.join(target_dir, "AI_Lesson_Plan_Studio.exe")
            target_vbs = os.path.join(target_dir, "start_app.vbs")

            if os.path.exists(target_exe):
                target_path = target_exe
                args = ""
                icon = f"{target_exe},0"
            else:
                target_path = "wscript.exe"
                args = f'`"{target_vbs}`"'
                icon = "shell32.dll,14"

            ps_cmd = f'$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut("{shortcut_path}"); $s.TargetPath = "{target_path}"; $s.Arguments = "{args}"; $s.WorkingDirectory = "{target_dir}"; $s.Description = "AI Lesson Plan Studio - កម្មវិធីបង្កើតកិច្ចតែងការបង្រៀនស្វ័យប្រវត្តិ"; $s.IconLocation = "{icon}"; $s.Save()'
            subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps_cmd], capture_output=True, text=True)
        except Exception as err:
            print("Shortcut error:", err)

    def installation_complete(self, success, msg):
        self.progress.stop()
        if success:
            self.lbl_status.config(text="🎉 ការដំឡើងត្រូវបានបញ្ចប់ដោយជោគជ័យ!", fg="#15803d")
            messagebox.showinfo("ជោគជ័យ", "🎉 ការដំឡើង AI Lesson Plan Studio ត្រូវបានបញ្ចប់ដោយជោគជ័យ!\\n\\nលោកអ្នកអាចបើកកម្មវិធីពី Shortcut នៅលើ Desktop ឬបើកភ្លាមៗបាន។")

            if self.launch_after.get():
                target_dir = self.dest_dir.get()
                exe_file = os.path.join(target_dir, "AI_Lesson_Plan_Studio.exe")
                vbs_file = os.path.join(target_dir, "start_app.vbs")
                if os.path.exists(exe_file):
                    subprocess.Popen([exe_file], cwd=target_dir)
                elif os.path.exists(vbs_file):
                    subprocess.Popen(["wscript.exe", vbs_file], cwd=target_dir)

            self.root.destroy()
        else:
            self.lbl_status.config(text=f"⚠️ បរាជ័យ: {msg}", fg="#dc2626")
            messagebox.showerror("បរាជ័យ", f"មានបញ្ហាក្នុងការដំឡើង:\\n{msg}")
            self.btn_install.config(state="normal")
            self.btn_cancel.config(state="normal")

if __name__ == "__main__":
    root = tk.Tk()
    app = SetupWizard(root)
    root.mainloop()
'''


def build_installer_source():
    zip_bytes = create_customer_zip_bytes()
    b64_payload = base64.b64encode(zip_bytes).decode("utf-8")
    
    installer_code = INSTALLER_SCRIPT_TEMPLATE.replace("__ZIP_PAYLOAD_B64__", b64_payload)
    
    script_path = os.path.join(os.path.dirname(__file__), "_installer_gen.py")
    with open(script_path, "w", encoding="utf-8") as f:
        f.write(installer_code)
        
    print(f"Generated standalone installer source: {script_path}")
    return script_path


if __name__ == "__main__":
    build_installer_source()
