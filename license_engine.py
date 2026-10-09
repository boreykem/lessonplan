"""
AI Lesson Plan Studio - Cryptographic License Engine
Generates Hardware-Bound Unique Machine ID, validates HMAC-SHA256 License Keys,
and manages 10-Day Free Trial Protection.
"""

import hashlib
import hmac
import platform
import subprocess
import json
import os
import time
from datetime import datetime

# Secret salt only known to the Software Owner / Creator
SECRET_SALT = b"Antigravity_AI_Lesson_Plan_Studio_Cambodia_2026_MoEYS_Secure_Key"
TRIAL_DURATION_DAYS = 10
TRIAL_DURATION_SECONDS = TRIAL_DURATION_DAYS * 24 * 3600
TRIAL_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".trial_record.json")


def get_hardware_uuid():
    """Generates a stable hardware fingerprint based on Machine GUID / Motherboard / CPU."""
    raw_id = ""
    try:
        if platform.system() == "Windows":
            # Get Windows Machine GUID
            cmd = 'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid'
            output = subprocess.check_output(cmd, shell=True).decode()
            for line in output.splitlines():
                if "MachineGuid" in line:
                    raw_id += line.split()[-1].strip()

            # Get CPU Processor ID
            cpu_cmd = "wmic cpu get ProcessorId"
            cpu_out = subprocess.check_output(cpu_cmd, shell=True).decode()
            raw_id += "".join(cpu_out.split())
    except Exception:
        pass

    if not raw_id:
        raw_id = platform.node() + platform.processor() + platform.machine()

    # Generate 16-character Machine ID
    hash_digest = hashlib.sha256(raw_id.encode("utf-8")).hexdigest().upper()
    return f"{hash_digest[:4]}-{hash_digest[4:8]}-{hash_digest[8:12]}-{hash_digest[12:16]}"


def generate_license_key(machine_id, licensee_name="Customer", license_type="LIFETIME", expiry_timestamp=0, is_master=False, max_devices=0):
    """
    Generates a cryptographically verified license key.
    - max_devices: Number of allowed computer seats (0 = Unlimited / គ្មានកំណត់).
    - is_master: True for Multi-Device Master Key; False for single Machine ID locked key.
    Format: ALPS-XXXX-XXXX-XXXX-XXXX or ALPS-MST-XXXX-XXXX-XXXX
    """
    if is_master or not machine_id or machine_id.upper().startswith("MASTER"):
        machine_clean = "MASTER"
        prefix = "ALPS-MST"
    else:
        machine_clean = machine_id.replace("-", "").strip().upper()
        prefix = "ALPS"

    payload = f"{machine_clean}|{licensee_name.strip()}|{license_type}|{expiry_timestamp}|{max_devices}"
    signature = hmac.new(SECRET_SALT, payload.encode("utf-8"), hashlib.sha256).hexdigest().upper()
    
    if prefix == "ALPS-MST":
        k1 = signature[:4]
        k2 = signature[4:8]
        k3 = signature[8:12]
        formatted_key = f"ALPS-MST-{k1}-{k2}-{k3}"
    else:
        k1 = signature[:4]
        k2 = signature[4:8]
        k3 = signature[8:12]
        k4 = signature[12:16]
        formatted_key = f"ALPS-{k1}-{k2}-{k3}-{k4}"
    
    license_data = {
        "licenseKey": formatted_key,
        "machineId": "ALL_DEVICES_MASTER" if is_master else machine_id,
        "licensee": licensee_name,
        "type": f"{license_type}_MASTER" if is_master and not license_type.endswith("_MASTER") else license_type,
        "expiryTimestamp": expiry_timestamp,
        "maxDevices": max_devices,
        "maxDevicesStr": f"{max_devices} គ្រឿង" if max_devices > 0 else "គ្មានកំណត់ (Unlimited Devices)",
        "isMaster": is_master,
        "signature": signature
    }
    return license_data


def verify_license_key(machine_id, license_key, licensee_name="Customer", license_type="LIFETIME", expiry_timestamp=0, max_devices=0):
    """
    Verifies whether the license key matches:
    1. Single-device Machine ID, OR
    2. School / Department / Teacher Universal Master Key with Device Seats.
    """
    key_clean = (license_key or "").strip().upper()
    if not key_clean:
        return False, "សូមបញ្ចូលលេខកូដ License Key"

    is_mst = key_clean.startswith("ALPS-MST-")
    
    # Candidate machines to test
    if is_mst:
        test_mids = [("MASTER", True)]
    else:
        clean_mid = (machine_id or "").replace("-", "").strip().upper()
        test_mids = [(clean_mid, False), (machine_id, False), ("MASTER", True)]

    # Candidate licensee names
    names = []
    for n in [licensee_name, "នាយកដ្ឋាន / Department User", "Department User", "Customer", "Valued Customer", 
              "Teacher", "School", "Department", "នាយកដ្ឋាន", "សាលារៀន", "លោកគ្រូ / អ្នកគ្រូ", 
              "Admin", "User", ""]:
        if n is not None and n not in names:
            names.append(n)

    # Candidate tiers/types
    clean_type = (license_type or "LIFETIME").replace("_MASTER", "").strip().upper()
    types = []
    for t in [clean_type, f"{clean_type}_MASTER", "TEACHER", "TEACHER_MASTER", "DEPARTMENT", "DEPARTMENT_MASTER",
              "SCHOOL", "SCHOOL_MASTER", "LIFETIME", "1_YEAR", "2_YEAR",
              "TEACHER_1_YEAR", "TEACHER_2_YEAR", "DEPARTMENT_1_YEAR", "DEPARTMENT_2_YEAR",
              "SCHOOL_1_YEAR", "SCHOOL_2_YEAR", "STANDARD", "PRO", "PREMIUM", "VIP", "ENTERPRISE", "EDUCATION"]:
        if t not in types:
            types.append(t)

    # Candidate device seat counts
    seats = []
    for d in [max_devices, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 500, 1000]:
        if d not in seats:
            seats.append(d)

    # Candidate expiries
    expiries = [expiry_timestamp, 0]

    # Fast validation loop
    for mid_val, is_m in test_mids:
        for name in names:
            for t in types:
                for d in seats:
                    for exp in expiries:
                        data = generate_license_key(mid_val, name, t, exp, is_master=is_m, max_devices=d)
                        if data["licenseKey"].upper() == key_clean:
                            if exp > 0 and time.time() > exp:
                                return False, "អាជ្ញាបណ្ណបានផុតកំណត់ហើយ (License Expired)"
                            if is_m or is_mst:
                                return True, "អាជ្ញាបណ្ណ Master Key ត្រឹមត្រូវ (Valid Multi-Device Master Key)"
                            return True, "អាជ្ញាបណ្ណត្រឹមត្រូវ (Valid Device License)"

    return False, "License Key មិនត្រឹមត្រូវសម្រាប់ម៉ាស៊ីននេះទេ (Invalid Key)"


# ==============================================================================
# 10-Day Free Trial Engine (Cryptographically Tamper-Protected)
# ==============================================================================
def get_trial_status(machine_id):
    """
    Computes 10-Day trial status for this machine.
    Returns: { isTrialActive, daysLeft, hoursLeft, isExpired, firstRunDate, percentLeft }
    """
    now = time.time()
    first_run = None

    if os.path.exists(TRIAL_FILE):
        try:
            with open(TRIAL_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                saved_mid = data.get("machineId")
                saved_ts = data.get("firstRunTimestamp")
                saved_sig = data.get("sig")
                
                # Verify HMAC signature
                expected_sig = hmac.new(SECRET_SALT, f"{saved_mid}:{saved_ts}".encode("utf-8"), hashlib.sha256).hexdigest()
                if saved_mid == machine_id and saved_sig == expected_sig:
                    first_run = float(saved_ts)
        except Exception:
            pass

    if first_run is None:
        # Initialize trial for the first time
        first_run = now
        sig = hmac.new(SECRET_SALT, f"{machine_id}:{first_run}".encode("utf-8"), hashlib.sha256).hexdigest()
        try:
            with open(TRIAL_FILE, "w", encoding="utf-8") as f:
                json.dump({"machineId": machine_id, "firstRunTimestamp": first_run, "sig": sig}, f)
        except Exception:
            pass

    elapsed = now - first_run
    remaining = max(0, TRIAL_DURATION_SECONDS - elapsed)
    
    days_left = int(remaining // 86400)
    hours_left = int((remaining % 86400) // 3600)
    is_expired = remaining <= 0
    percent_left = round((remaining / TRIAL_DURATION_SECONDS) * 100, 1)

    return {
        "isTrial": True,
        "isTrialActive": not is_expired,
        "isExpired": is_expired,
        "daysLeft": days_left,
        "hoursLeft": hours_left,
        "totalDays": TRIAL_DURATION_DAYS,
        "percentLeft": percent_left,
        "firstRunDate": datetime.fromtimestamp(first_run).strftime("%Y-%m-%d")
    }
