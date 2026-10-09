"""
AI Lesson Plan Studio - Python Backend Server (Flask)
Features:
- Dual file parsing (.docx using python-docx, .pdf using pypdf, .txt)
- AI Lesson Plan generation using Gemini Flash API or Smart Built-in Engine
- Official MoEYS Word (.docx) export generation
- Static file server for modern UI
"""

import os
import io
import json
import base64
import urllib.request
import urllib.error
import urllib.parse
import shutil
import threading
import random
import webbrowser
import hashlib
import asyncio
import re
from datetime import datetime
from flask import Flask, request, jsonify, send_file, send_from_directory, Response
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import nsdecls, qn
import pypdf

app = Flask(__name__, static_folder=None)
import tempfile
try:
    UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), "uploads")
    os.makedirs(UPLOAD_FOLDER, exist_ok=True)
except Exception:
    UPLOAD_FOLDER = os.path.join(tempfile.gettempdir(), "alps_uploads")
    try:
        os.makedirs(UPLOAD_FOLDER, exist_ok=True)
    except Exception:
        UPLOAD_FOLDER = tempfile.gettempdir()

# System Default Gemini API Key
DEFAULT_SYSTEM_GEMINI_KEY = os.environ.get("GEMINI_API_KEY") or base64.b64decode("QVEuQWI4Uk42S002TkRrb3BRTjZoRE84bzNwbDJVYzNHZ2NNOHplUG9LeHM2a0R1T2pTY3c=").decode("utf-8")

# Preset Templates Data
PRESET_TEMPLATES = {
    "moeys_standard_5step": {
        "id": "moeys_standard_5step",
        "name": "កិច្ចតែងការស្តង់ដារ ៥ ជំហាន (ក្រសួងអប់រំ)",
        "badge": "ផ្លូវការ MoEYS",
        "description": "ទម្រង់កិច្ចតែងការទូទៅ ៥ ជំហាន សម្រាប់អនុវិទ្យាល័យ និងវិទ្យាល័យ"
    },
    "flipped_learning_5step": {
        "id": "flipped_learning_5step",
        "name": "កិច្ចតែងការតាមបែបថ្នាក់រៀនត្រឡប់ (Flipped Learning ៥ ជំហាន: ៥%-១០%-១០%-៧០%-៥% + Pre-test QCM ១០ សំណួរ)",
        "badge": "ថ្នាក់រៀនត្រឡប់ Flipped",
        "description": "ទម្រង់ថ្នាក់រៀនត្រឡប់ (Pre-Class Self-Study, In-Class Active Learning 70%, Exit Ticket) ជាមួយវិញ្ញាសាស្ទង់សមត្ថភាពមុនម៉ោង QCM 10 សំណួរ (កម្រិត 2-6-2)"
    },
    "backward_design_ubd": {
        "id": "backward_design_ubd",
        "name": "កិច្ចតែងការតាមបែបត្រឡប់ (Backward Design / UbD ៣ ដំណាក់កាល)",
        "badge": "បែបត្រឡប់ UbD",
        "description": "ទម្រង់តាមបែបត្រឡប់ ៣ ដំណាក់កាល (លទ្ធផលរំពឹងទុក, ភស្តុតាងវាយតម្លៃ, ផែនការបង្រៀន) និយមប្រើនៅ TEC / គរុកោសល្យ"
    },
    "moeys_primary": {
        "id": "moeys_primary",
        "name": "កិច្ចតែងការបឋមសិក្សា (ថ្នាក់ទី ១ ដល់ ទី ៦)",
        "badge": "បឋមសិក្សា",
        "description": "ទម្រង់ងាយស្រួល ផ្ដោតលើការចូលរួម និងល្បែងសិក្សាសម្រាប់កុមារតូច"
    },
    "moeys_stem_inquiry": {
        "id": "moeys_stem_inquiry",
        "name": "កិច្ចតែងការបែប STEM / 5E (វិទ្យាសាស្ត្រ និងពិសោធន៍)",
        "badge": "STEM & 5E",
        "description": "ទម្រង់ផ្អែកលើការស្រាវជ្រាវ (Engage, Explore, Explain, Elaborate, Evaluate)"
    }
}

# ==============================================================================
# Helper Functions for File Parsing
# ==============================================================================
def extract_text_from_file_bytes(filename, file_bytes):
    ext = os.path.splitext(filename)[1].lower()
    text = ""

    if ext in [".txt", ".text", ".json", ".md"]:
        text = file_bytes.decode("utf-8", errors="replace")

    elif ext == ".docx":
        doc_stream = io.BytesIO(file_bytes)
        doc = Document(doc_stream)
        paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
        
        # Also extract table text
        table_texts = []
        for table in doc.tables:
            for row in table.rows:
                row_str = " | ".join(cell.text.strip() for cell in row.cells if cell.text.strip())
                if row_str:
                    table_texts.append(row_str)
        
        text = "\n".join(paragraphs)
        if table_texts:
            text += "\n\n[តារាងក្នុងឯកសារ]\n" + "\n".join(table_texts)

    elif ext in [".pptx", ".ppt"]:
        # Method 1: python-pptx (standard, extracts shapes, paragraphs, tables, notes)
        try:
            from pptx import Presentation
            prs = Presentation(io.BytesIO(file_bytes))
            slides_text = []
            for idx, slide in enumerate(prs.slides, 1):
                slide_parts = []
                for shape in slide.shapes:
                    if shape.has_text_frame:
                        for p in shape.text_frame.paragraphs:
                            t = p.text.strip()
                            if t:
                                slide_parts.append(t)
                    if shape.has_table:
                        for row in shape.table.rows:
                            row_t = " | ".join(c.text.strip() for c in row.cells if c.text.strip())
                            if row_t:
                                slide_parts.append(row_t)
                # Check for speaker notes
                if slide.has_notes_slide and slide.notes_slide.notes_text_frame:
                    note_t = slide.notes_slide.notes_text_frame.text.strip()
                    if note_t:
                        slide_parts.append(f"(កំណត់ចំណាំ: {note_t})")

                if slide_parts:
                    slides_text.append(f"[ស្លាយទី {idx}]\n" + "\n".join(slide_parts))

            res = "\n\n".join(slides_text).strip()
            if res:
                text = res
        except Exception:
            pass

        # Method 2: zipfile + regex fallback (100% immune to XML namespace / prefix errors)
        if not text:
            try:
                import zipfile
                import re
                slides_text = []
                with zipfile.ZipFile(io.BytesIO(file_bytes), 'r') as zf:
                    slide_names = [n for n in zf.namelist() if re.match(r'ppt/slides/slide\d+\.xml', n)]
                    slide_names.sort(key=lambda x: int(re.search(r'\d+', x).group()))
                    for idx, sname in enumerate(slide_names, 1):
                        xml_data = zf.read(sname).decode('utf-8', errors='ignore')
                        raw_texts = re.findall(r'<a:t[^>]*>(.*?)</a:t>', xml_data, re.DOTALL)
                        clean_texts = [
                            t.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>').replace('&quot;', '"').strip()
                            for t in raw_texts if t.strip()
                        ]
                        if clean_texts:
                            slides_text.append(f"[ស្លាយទី {idx}]\n" + "\n".join(clean_texts))
                text = "\n\n".join(slides_text).strip()
            except Exception as e:
                text = f"PowerPoint parsing notice: {e}"

    elif ext == ".pdf":
        pdf_stream = io.BytesIO(file_bytes)
        reader = pypdf.PdfReader(pdf_stream)
        pages_text = []
        for i, page in enumerate(reader.pages[:15]): # Read up to 15 pages
            p_txt = page.extract_text() or ""
            if p_txt.strip():
                pages_text.append(f"[ទំព័រ {i+1}]\n" + p_txt.strip())
        text = "\n\n".join(pages_text)

    else:
        # Only decode if printable text, otherwise ignore binary
        try:
            decoded = file_bytes.decode("utf-8")
            # If large proportion of nulls or unprintable, reject
            if decoded.count('\x00') == 0:
                text = decoded
            else:
                text = ""
        except Exception:
            text = ""

    return text.strip()


@app.route("/api/upload/lesson", methods=["POST"])
@app.route("/api/upload/template", methods=["POST"])
@app.route("/api/upload/parse", methods=["POST"])
def upload_and_parse_file():
    if "file" not in request.files:
        return jsonify({"success": False, "error": "No file uploaded"}), 400

    file = request.files["file"]
    if file.filename == "":
        return jsonify({"success": False, "error": "Empty filename"}), 400

    file_bytes = file.read()
    extracted_text = extract_text_from_file_bytes(file.filename, file_bytes)

    return jsonify({
        "success": True,
        "filename": file.filename,
        "text": extracted_text,
        "size": len(file_bytes)
    })


def get_khmer_date():
    khmer_nums = ["០", "១", "២", "៣", "៤", "៥", "៦", "៧", "៨", "៩"]
    months = ["មករា", "កុម្ភៈ", "មីនា", "មេសា", "ឧសភា", "មិថុនា", "កក្កដា", "សីហា", "កញ្ញា", "តុលា", "វិច្ឆិកា", "ធ្នូ"]
    now = datetime.now()
    d_str = "".join(khmer_nums[int(d)] for d in str(now.day))
    y_str = "".join(khmer_nums[int(y)] for y in str(now.year))
    m_str = months[now.month - 1]
    return f"ថ្ងៃទី {d_str} ខែ {m_str} ឆ្នាំ {y_str}"


def is_flipped_learning_request(data):
    tmpl_type = (data.get("templateType") or "").lower()
    if tmpl_type == "flipped_learning":
        return True
    preset_id = (data.get("presetId") or "").lower()
    if preset_id == "flipped_learning_5step":
        return True
    method = (data.get("method") or "").lower()
    if "flipped" in method or "ថ្នាក់រៀនត្រឡប់" in method or "ការរៀនបែបត្រឡប់" in method or "តាមបែបត្រឡប់" in method:
        return True
    custom_template = (data.get("customTemplate") or "").lower()
    custom_name = (data.get("customTemplateFileName") or "").lower()
    if "flipped" in custom_template or "ថ្នាក់រៀនត្រឡប់" in custom_template or "ការរៀនបែបត្រឡប់" in custom_template or ("តាមបែបត្រឡប់" in custom_template and "backward" not in custom_template and "ubd" not in custom_template):
        return True
    if "flipped" in custom_name or "ថ្នាក់រៀនត្រឡប់" in custom_name or "តាមបែបត្រឡប់" in custom_name or "កិច្ចតែងការ_តាមបែបត្រឡប់" in custom_name:
        return True
    return False


def is_backward_design_request(data):
    if is_flipped_learning_request(data):
        return False
    preset_id = (data.get("presetId") or "").lower()
    if preset_id == "backward_design_ubd":
        return True
    custom_template = (data.get("customTemplate") or "").lower()
    custom_name = (data.get("customTemplateFileName") or "").lower()
    if "backward" in custom_template or "ubd" in custom_template or "ដំណាក់កាល" in custom_template:
        return True
    if "backward" in custom_name or "ubd" in custom_name:
        return True
    return False


# Generate Google NotebookLM 5-Minute Video Micro-Lecture Script
def generate_notebooklm_script_python(subject, grade, lesson_title, main_points):
    p1 = main_points[0] if len(main_points) > 0 else f"គោលការណ៍គ្រឹះ និងនិយមន័យនៃ {lesson_title}"
    p2 = main_points[1] if len(main_points) > 1 else "រូបមន្តគន្លឹះ និងយន្តការដំណើរការ"
    p3 = main_points[2] if len(main_points) > 2 else "ការអនុវត្តជាក់ស្តែង និងឧទាហរណ៍គំរូ"

    return {
        "overviewTitle": f"វីដេអូបង្រៀន ៥ នាទី: «{lesson_title}» ({subject} {grade})",
        "format": "វីដេអូបង្រៀន Micro-Lecture / Explainer Video (៥ នាទី) - ភាសាខ្មែរ",
        "videoDuration": "៥ នាទី",
        "fontSpecification": "Kantumruy Pro (អក្សររត់ និងចំណងជើងក្នុងវីដេអូ)",
        "keyTakeaways": [
            f"ស្វែងយល់ពីនិយមន័យ និងគោលគំនិតចម្បង៖ {p1}",
            f"យន្តការដំណើរការ និងរូបមន្តគន្លឹះ៖ {p2}",
            f"ការផ្សារភ្ជាប់ទ្រឹស្តីទៅនឹងការដោះស្រាយបញ្ហាក្នុងជីវភាពជាក់ស្តែង៖ {p3}"
        ],
        "scriptSegments": [
            {
                "timestamp": "0:00 - 1:00",
                "sceneDescription": "ណែនាំមេរៀន & ចោទបញ្ហាគន្លឹះ",
                "narration": f"សួស្តីប្អូនៗទាំងអស់គ្នា! សូមស្វាគមន៍មកកាន់វីដេអូស្វ័យសិក្សាខ្លី ៥ នាទី នៃមេរៀន «{lesson_title}» ក្នុងមុខវិជ្ជា {subject} {grade}។ ថ្ងៃនេះយើងនឹងស្វែងយល់ពីគោលគំនិតចម្បង និងបញ្ហាគន្លឹះមុនពេលចូលរៀនក្នុងថ្នាក់!",
                "onScreenText": f"មេរៀន៖ {lesson_title} ({subject} {grade})"
            },
            {
                "timestamp": "1:00 - 2:30",
                "sceneDescription": "ពន្យល់ទ្រឹស្តី & រូបមន្តយន្តការស្នូល",
                "narration": f"ចំណុចស្នូលដែលប្អូនៗត្រូវយល់ឱ្យបានស៊ីជម្រៅ គឺ {p1}។ នៅពេលយើងពិនិត្យមើលលម្អិត យន្តការនេះកើតឡើងតាមរយៈ {p2} ដែលជាគន្លឹះមិនអាចខ្វះបានក្នុងការដោះស្រាយលំហាត់ និងកិច្ចការស្រាវជ្រាវ!",
                "onScreenText": f"យន្តការគន្លឹះ៖ {p2}"
            },
            {
                "timestamp": "2:30 - 4:00",
                "sceneDescription": "ឧទាហរណ៍ជាក់ស្តែង & ការផ្សារភ្ជាប់ជីវភាព",
                "narration": f"ឥឡូវនេះសូមក្រឡេកមកមើលការអនុវត្តជាក់ស្តែងក្នុងជីវភាពប្រចាំថ្ងៃ គឺទាក់ទងនឹង {p3}។ ការយល់ដឹងពីចំណុចនេះ នឹងជួយឱ្យប្អូនៗអាចផ្សារភ្ជាប់មេរៀនទៅនឹងសង្គមពិតបានយ៉ាងល្អប្រសើរ!",
                "onScreenText": f"ការអនុវត្តជាក់ស្តែង៖ {p3}"
            },
            {
                "timestamp": "4:00 - 5:00",
                "sceneDescription": "សង្ខេប បេសកកម្ម Muddiest Point & Pre-Test",
                "narration": "ជាចុងក្រោយ សូមប្អូនៗកត់ត្រាចំណុចដែលខ្លួននៅស្រពិចស្រពិល (Muddiest Point) យ៉ាងតិចមួយសំណួរ ព្រមទាំងឆ្លើយវិញ្ញាសា Pre-Test QCM ៥ សំណួរខាងក្រោម ដើម្បីត្រៀមខ្លួនសម្រាប់សកម្មភាពអនុវត្តជាក្រុមក្នុងថ្នាក់!",
                "onScreenText": "កត់ត្រា Muddiest Point & ឆ្លើយវិញ្ញាសា Pre-Test QCM ៥ សំណួរ"
            }
        ],
        "notebooklmPrompt": f"Generate an engaging 5-minute Educational Video Explainer / Micro-Lecture in 100% Khmer for '{lesson_title}' ({subject} {grade}). Key concepts: 1. {p1}, 2. {p2}, 3. {p3}. All on-screen captions and text overlays must run in Khmer using font 'Kantumruy Pro' exclusively. Include timestamps, scene descriptions, Khmer teacher narration, and Kantumruy Pro on-screen display text."
    }


# Generate Pre-Test QCM 5 Questions with strict 6-3-1 difficulty formula (3 Easy/Remember, 1 Medium/Apply, 1 Hard/Analyze)
def generate_pretest_qcm_python(subject, grade, lesson_title, main_points):
    p1 = main_points[0] if len(main_points) > 0 else f"និយមន័យ និងគោលការណ៍គ្រឹះនៃ {lesson_title}"
    p2 = main_points[1] if len(main_points) > 1 else f"លក្ខណៈសម្គាល់ និងរូបមន្តគន្លឹះក្នុង {subject}"
    p3 = main_points[2] if len(main_points) > 2 else "ការអនុវត្ត និងទំនាក់ទំនងបាតុភូតជាក់ស្តែង"
    p4 = main_points[3] if len(main_points) > 3 else "ក្បួនដោះស្រាយបញ្ហា និងការវិភាគ"

    return [
        # 3 Easy (60% - Remember & Understand)
        {
            "number": 1,
            "difficulty": "ងាយ (Easy)",
            "difficultyLevel": "easy",
            "question": f"តើអ្វីជាគោលគំនិតចម្បង ឬនិយមន័យត្រឹមត្រូវនៃ «{lesson_title}» ក្នុងមុខវិជ្ជា {subject}?",
            "options": {
                "A": f"ជាដំណើរការ ឬគោលការណ៍ដែលផ្សារភ្ជាប់ទៅនឹង {p1}",
                "B": f"ជាបាតុភូតដែលមិនទាក់ទងនឹង {subject} ឡើយ",
                "C": "ជាទ្រឹស្តីដែលប្រើប្រាស់តែក្នុងមន្ទីរពិសោធន៍ដាច់ដោយឡែក",
                "D": "ជាច្បាប់ដែលមិនមានការប្រែប្រួល និងគ្មានការអនុវត្ត"
            },
            "correctAnswer": "A",
            "explanation": f"ផ្អែកលើខ្លឹមសារមេរៀនស្វ័យសិក្សា និយមន័យស្នូលនៃ {lesson_title} គឺសំដៅលើ {p1}។"
        },
        {
            "number": 2,
            "difficulty": "ងាយ (Easy)",
            "difficultyLevel": "easy",
            "question": f"ក្នុងចំណោមជម្រើសខាងក្រោម តើមួយណាជាធាតុផ្សំ ឬកត្តាសម្គាល់សំខាន់នៃ «{lesson_title}»?",
            "options": {
                "A": "កត្តាទី១ និងកត្តាទី២ មិនពាក់ព័ន្ធ",
                "B": f"{p2}",
                "C": "កត្តាអសកម្មដែលគ្មានចលនា",
                "D": "ការបំផ្លាញទិន្នន័យទាំងស្រុង"
            },
            "correctAnswer": "B",
            "explanation": f"ចំណុចសម្គាល់ស្នូលដែលបានរៀបរាប់ក្នុងឯកសារស្វ័យសិក្សាគឺ {p2}។"
        },
        {
            "number": 3,
            "difficulty": "ងាយ (Easy)",
            "difficultyLevel": "easy",
            "question": f"នៅពេលពិនិត្យមើលយន្តការនៃ «{lesson_title}» តើដំណើរការប្រព្រឹត្តទៅតាមលំដាប់លំដោយដូចម្តេច?",
            "options": {
                "A": f"ចាប់ផ្តើមពីដំណាក់កាលទីមួយ បន្តទៅ {p1} រួចបង្កើតជាលទ្ធផលចុងក្រោយ",
                "B": "កើតឡើងដោយចៃដន្យគ្មានលំដាប់លំដោយ",
                "C": "បញ្ចប់មុនពេលចាប់ផ្តើមប្រតិកម្ម",
                "D": "កើតឡើងតែនៅពេលគ្មានថាមពលប៉ុណ្ណោះ"
            },
            "correctAnswer": "A",
            "explanation": "ដំណើរការស្តង់ដារតម្រូវឱ្យឆ្លងកាត់ដំណាក់កាលលំដាប់លំដោយច្បាស់លាស់ដើម្បីទទួលបានលទ្ធផល។"
        },
        # 1 Medium (30% - Apply)
        {
            "number": 4,
            "difficulty": "មធ្យម (Medium)",
            "difficultyLevel": "medium",
            "question": f"តើការអនុវត្តរូបមន្ត ឬទ្រឹស្តីនៃ «{lesson_title}» ក្នុងជីវភាពជាក់ស្តែង ត្រូវធ្វើឡើងតាមជំហានណា?",
            "options": {
                "A": f"កំណត់ទិន្នន័យ -> ជ្រើសរើសគោលការណ៍ស្រប ({p3}) -> ដោះស្រាយ និងផ្ទៀងផ្ទាត់លទ្ធផល",
                "B": "ទាយចម្លើយភ្លាមៗដោយមិនបាច់វិភាគ",
                "C": "ជំនួសលេខដោយមិនបាច់ប្តូរខ្នាត",
                "D": "ប្រើប្រាស់វិធីសាស្ត្រណាក៏បានដោយគ្មានលក្ខខណ្ឌ"
            },
            "correctAnswer": "A",
            "explanation": f"ការអនុវត្តជាក់ស្តែងតម្រូវឱ្យវិភាគទិន្នន័យ ប្រើគោលការណ៍ត្រូវស្របតាម {p3}។"
        },
        # 1 Hard (10% - Analyze & Solve)
        {
            "number": 5,
            "difficulty": "ពិបាក (Hard)",
            "difficultyLevel": "hard",
            "question": f"[ស្ថានភាពបញ្ហាស្មុគស្មាញ] ឧបមាថាមានទិន្នន័យមិនប្រក្រតី ឬបញ្ហាប្រឈមកើតឡើងក្នុង «{lesson_title}»។ តើអ្នកគួរវិភាគរកឫសគល់បញ្ហាយ៉ាងដូចម្តេច?",
            "options": {
                "A": f"កំណត់អថេរមិនប្រក្រតី -> ផ្ទៀងផ្ទាត់ជាមួយគោលការណ៍ {p1} & {p4} -> កែសម្រួលប៉ារ៉ាម៉ែត្រដើម្បីដោះស្រាយ",
                "B": "បោះបង់ការពិសោធន៍ និងសន្និដ្ឋានថាប្រព័ន្ធបរាជ័យ",
                "C": "ផ្លាស់ប្តូរទិន្នន័យតាមចិត្តដើម្បីឱ្យត្រូវនឹងទ្រឹស្តី",
                "D": "មិនអើពើចំពោះបញ្ហានោះឡើយ"
            },
            "correctAnswer": "A",
            "explanation": "ការដោះស្រាយបញ្ហាស្មុគស្មាញតម្រូវឱ្យមានការគិតបែបស៊ីជម្រៅ និងការវិភាគរកមូលហេតុឫសគល់។"
        }
    ]

def generate_posttest_mcq_python(subject, grade, lesson_title, main_points=None):
    if not main_points:
        main_points = []
    
    clean_title = lesson_title.strip() if lesson_title else "មេរៀន"
    subj = (subject or "").lower()
    p1 = main_points[0] if len(main_points) > 0 else f"ទ្រឹស្តី និងគោលការណ៍គ្រឹះនៃ {clean_title}"
    p2 = main_points[1] if len(main_points) > 1 else f"វិធីសាស្ត្រគណនា និងការអនុវត្ត {subject}"
    p3 = main_points[2] if len(main_points) > 2 else "ការដោះស្រាយបញ្ហាក្នុងជីវភាពជាក់ស្តែង"
    p4 = main_points[3] if len(main_points) > 3 else "ការវិភាគ និងការវាយតម្លៃកម្រិតខ្ពស់"

    # Standard Bloom 20-60-20 Formula (5 Questions: 1 Remember/Understand, 3 Apply/Analyze, 1 Evaluate/Create)
    return [
        # 1. Remember & Understand (20%)
        {
            "number": 1,
            "bloom": "Remember & Understand",
            "difficulty": "ងាយ (Easy)",
            "difficultyLevel": "easy",
            "question": f"តើគោលគំនិតស្នូល ឬច្បាប់គ្រឹះនៃ «{clean_title}» ក្នុងមុខវិជ្ជា {subject} ចែងអំពីអ្វីចម្បង?",
            "options": {
                "A": f"ជាគោលការណ៍គ្រឹះដែលកំណត់អំពី {p1}",
                "B": "ជាបាតុភូតដែលកើតឡើងដោយចៃដន្យគ្មានច្បាប់ទម្លាប់",
                "C": "ជាទ្រឹស្តីដែលមិនអាចយកមកអនុវត្តជាក់ស្តែងបានឡើយ",
                "D": "ជាការសន្មតដែលគ្មានមូលដ្ឋានវិទ្យាសាស្ត្រ"
            },
            "correctAnswer": "A",
            "explanation": f"គោលការណ៍គ្រឹះនៃ {clean_title} គឺកំណត់យ៉ាងច្បាស់អំពី {p1}។"
        },
        # 2. Apply (20%)
        {
            "number": 2,
            "bloom": "Apply",
            "difficulty": "មធ្យម (Medium)",
            "difficultyLevel": "medium",
            "question": f"នៅពេលអនុវត្តរូបមន្ត ឬក្បួនគន្លឹះនៃ «{clean_title}» ដើម្បីដោះស្រាយលំហាត់ជាក់ស្តែង តើត្រូវចាប់ផ្តើមពីចំណុចណា?",
            "options": {
                "A": f"កំណត់បម្រាប់ និងបំប្លែងខ្នាត -> ប្រើប្រាស់រូបមន្ត {p2} -> គណនារកលទ្ធផល",
                "B": "ទាយចម្លើយភ្លាមៗដោយមិនបាច់ពិនិត្យបម្រាប់",
                "C": "ប្រើរូបមន្តណាក៏បានដោយមិនបាច់ផ្ទៀងផ្ទាត់លក្ខខណ្ឌ",
                "D": "សរសេរតែចម្លើយចុងក្រោយដោយគ្មានដំណោះស្រាយ"
            },
            "correctAnswer": "A",
            "explanation": "ការអនុវត្តត្រឹមត្រូវតម្រូវឱ្យវិភាគបម្រាប់ ប្រើរូបមន្តស្រប និងគណនាផ្ទៀងផ្ទាត់ខ្នាត។"
        },
        # 3. Apply & Solve (20%)
        {
            "number": 3,
            "bloom": "Apply & Solve",
            "difficulty": "មធ្យម (Medium)",
            "difficultyLevel": "medium",
            "question": f"តើឧទាហរណ៍ជាក់ស្តែងមួយណាដែលឆ្លុះបញ្ចាំងពីការយក «{clean_title}» ទៅប្រើប្រាស់ក្នុងជីវភាព ឬបច្ចេកវិទ្យា?",
            "options": {
                "A": f"ការអនុវត្តជាក់ស្តែងស្របតាម {p3} ដើម្បីបង្កើនប្រសិទ្ធភាពការងារ",
                "B": "ការប្រើប្រាស់ដែលផ្ទុយនឹងគោលការណ៍វិទ្យាសាស្ត្រ",
                "C": "ការបោះបង់បច្ចេកវិទ្យាទំនើបចោលទាំងស្រុង",
                "D": "ការអនុវត្តដែលបង្កឱ្យមានការខាតបង់ថាមពល"
            },
            "correctAnswer": "A",
            "explanation": f"ការអនុវត្តជាក់ស្តែងនៃ {clean_title} ជួយដោះស្រាយបញ្ហា និងបង្កើនប្រសិទ្ធភាពស្របតាម {p3}។"
        },
        # 4. Analyze (20%)
        {
            "number": 4,
            "bloom": "Analyze",
            "difficulty": "មធ្យម (Medium)",
            "difficultyLevel": "medium",
            "question": f"នៅពេលធ្វើការវិភាគប្រៀបធៀបករណីសិក្សានៃ «{clean_title}» តើកត្តាស្នូលណាដែលកំណត់លទ្ធផល?",
            "options": {
                "A": f"ទំនាក់ទំនងរវាងអថេរ និងលក្ខខណ្ឌប្រតិបត្តិការស្របតាម {p4}",
                "B": "ការកើនឡើងនៃកត្តាចៃដន្យដែលមិនអាចគ្រប់គ្រងបាន",
                "C": "ការមិនអើពើចំពោះបម្រែបម្រួលបរិស្ថានជុំវិញ",
                "D": "ការសន្និដ្ឋានដោយផ្អែកលើការស្មានសុទ្ធសាធ"
            },
            "correctAnswer": "A",
            "explanation": "ការវិភាគបែបស៊ីជម្រៅតម្រូវឱ្យពិនិត្យទំនាក់ទំនងរវាងអថេរ និងលក្ខខណ្ឌជាក់ស្តែង។"
        },
        # 5. Evaluate & Create (20%)
        {
            "number": 5,
            "bloom": "Evaluate & Create",
            "difficulty": "ពិបាក (Hard)",
            "difficultyLevel": "hard",
            "question": f"[ការវាយតម្លៃ និងការដោះស្រាយបញ្ហា] ប្រសិនបើជួបប្រទះស្ថានភាពស្មុគស្មាញ ឬភាពយល់ច្រឡំ (Misconception) លើ «{clean_title}» តើគួរវាយតម្លៃ និងកែលម្អយ៉ាងដូចម្តេច?",
            "options": {
                "A": f"បង្កើតស្ថានភាព Cognitive Conflict -> ផ្ទៀងផ្ទាត់លើទឡ្ហីករណ៍ជាក់ស្តែង -> កែសម្រួល Schema ឱ្យត្រូវតាម {p1}",
                "B": "បដិសេធរាល់ការកែលម្អ និងរក្សាការយល់ខុសដដែល",
                "C": "សតីបន្ទោសអ្នករៀនដោយមិនផ្តល់ការពន្យល់",
                "D": "រំលងបញ្ហានោះចោលដោយមិនដោះស្រាយ"
            },
            "correctAnswer": "A",
            "explanation": "ការវាយតម្លៃកម្រិតខ្ពស់តម្រូវឱ្យវិភាគរកឫសគល់នៃកំហុស និងបង្កើតដំណោះស្រាយកែតម្រូវ Schema ឱ្យត្រឹមត្រូវ។"
        }
    ]

def generate_active_rubric_python(lesson_title, subject):
    return [
        {
            "criterion": "១. ការសហការ និងការចូលរួមក្នុងក្រុម (Collaboration & Engagement)",
            "levels": [
                "កម្រិត ១ (ត្រូវការកែលម្អ): អសកម្ម មិនសូវចូលរួមបញ្ចេញមតិ ឬធ្វើការតែម្នាក់ឯង។",
                "កម្រិត ២ (មធ្យម): ចូលរួមបំពេញកិច្ចការមួយចំនួន ប៉ុន្តែត្រូវការការរំលឹកជាប្រចាំ។",
                "កម្រិត ៣ (ល្អ): ចូលរួមយ៉ាងសកម្ម ស្តាប់មតិអ្នកដទៃ និងបំពេញតួនាទីបានល្អ។",
                "កម្រិត ៤ (ឆ្នើម): ដឹកនាំការពិភាក្សាលើកទឹកចិត្តសមាជិក និងជួយសម្របសម្រួលក្រុមបានល្អឥតខ្ចោះ។"
            ]
        },
        {
            "criterion": "២. ការត្រិះរិះ និងដោះស្រាយបញ្ហា (Critical Thinking & Problem Solving)",
            "levels": [
                "កម្រិត ១: ដោះស្រាយលំហាត់តាមលំនាំចាស់ មិនទាន់ចេះវិភាគឫសគល់បញ្ហា។",
                "កម្រិត ២: ចេះអនុវត្តរូបមន្តគ្រឹះ ប៉ុន្តែនៅជួបការលំបាកពេលជួបបញ្ហាស្មុគស្មាញ។",
                "កម្រិត ៣: វិភាគទិន្នន័យត្រឹមត្រូវ និងរកឃើញដំណោះស្រាយសមហេតុផល។",
                "កម្រិត ៤: បង្ហាញការវិភាគស៊ីជម្រៅ ច្នៃប្រឌិត និងរកឃើញដំណោះស្រាយពហុវិមាត្រ។"
            ]
        },
        {
            "criterion": "៣. គុណភាពនៃស្នាដៃ/ដំណោះស្រាយ (Quality of Output)",
            "levels": [
                "កម្រិត ១: ស្នាដៃមិនទាន់ពេញលេញ មានកំហុសច្រើនលើខ្លឹមសារស្នូល។",
                "កម្រិត ២: ស្នាដៃត្រឹមត្រូវកម្រិតមូលដ្ឋាន ប៉ុន្តែខ្វះរបៀបរៀបរយ និងភាពច្បាស់លាស់។",
                "កម្រិត ៣: ស្នាដៃត្រឹមត្រូវតាមស្តង់ដារ មានទឡ្ហីករណ៍ច្បាស់លាស់ និងស្អាតបាត។",
                "កម្រិត ៤: ស្នាដៃមានភាពសុក្រឹតឥតខ្ចោះ បង្ហាញការសំយោគកម្រិតខ្ពស់ និងទាក់ទាញខ្លាំង។"
            ]
        },
        {
            "criterion": "៤. ការធ្វើបទបង្ហាញ និងការពារទឡ្ហីករណ៍ (Presentation & Defense)",
            "levels": [
                "កម្រិត ១: ពិបាកបកស្រាយ មិនអាចឆ្លើយសំណួរដេញដោលរបស់មិត្តរួមថ្នាក់បាន។",
                "កម្រិត ២: បកស្រាយបានត្រឹមត្រូវមួយផ្នែក ប៉ុន្តែខ្វះភាពជឿជាក់ក្នុងការការពារគំនិត។",
                "កម្រិត ៣: ធ្វើបទបង្ហាញបានច្បាស់លាស់ សំឡេងឮច្បាស់ និងឆ្លើយសំណួរបានត្រឹមត្រូវ។",
                "កម្រិត ៤: ធ្វើបទបង្ហាញប្រកបដោយភាពជឿជាក់ខ្ពស់ ដេញដោលឆ្លើយតបបានយ៉ាងមុតស្រួច។"
            ]
        }
    ]


def generate_differentiated_plan_python(lesson_title, subject):
    return {
        "scaffolding": {
            "targetGroup": "ក្រុមសិស្សត្រូវការជំនួយ (ពិន្ទុ Pre-Test < 50%)",
            "strategies": [
                f"ផ្តល់សន្លឹកជំនួយគន្លឹះ (Formula & Step-by-Step Hint Cards) សម្រាប់មេរៀន «{lesson_title}»",
                "គ្រូដើរសម្របសម្រួលផ្ទាល់នៅតុក្រុម ចោទសួរសំណួរដាស់គំនិតជាជំហានៗ",
                "ចាត់តាំងសិស្សពូកែក្នុងក្រុមធ្វើជា Peer Tutor ជួយពន្យល់បន្ថែម"
            ]
        },
        "challenge": {
            "targetGroup": "ក្រុមសិស្សពូកែ/រហ័ស (ពិន្ទុ Pre-Test ≥ 80%)",
            "strategies": [
                f"ផ្តល់បេសកកម្មស្រាវជ្រាវស៊ីជម្រៅ (Advanced Challenge Scenario) អំពីការអនុវត្ត «{lesson_title}» ក្នុងសង្គមជាក់ស្តែង",
                "ឱ្យបង្កើតសំណួរដេញដោល ឬវិភាគករណីសិក្សាប្រៀបធៀបកម្រិតខ្ពស់",
                "ដើរតួជាអ្នកត្រួតពិនិត្យ និងផ្តល់មតិកែលម្អ (Peer Reviewers) ដល់ក្រុមផ្សេងៗ"
            ]
        }
    }


def generate_exit_ticket_321_python(lesson_title):
    return {
        "title": f"សន្លឹកឆ្លុះបញ្ចាំង Exit Ticket 3-2-1: «{lesson_title}»",
        "prompt3": "៣ ចំណុចដែលប្អូនបានយល់ដឹងច្បាស់បំផុតក្នុងម៉ោងរៀននេះ",
        "prompt2": "២ ចំណុចដែលប្អូនយល់ថាគួរឱ្យចាប់អារម្មណ៍ និងចង់យកទៅអនុវត្ត",
        "prompt1": "១ ចំណុចដែលប្អូននៅតែមានចម្ងល់ និងចង់ស្រាវជ្រាវបន្ថែម"
    }


# ==============================================================================
# Python Pedagogical Synthesizer (Offline & Fallback)
# ==============================================================================
def synthesize_lesson_plan_python(data):
    subject = data.get("subject", "រូបវិទ្យា")
    grade = data.get("grade", "ថ្នាក់ទី ៨")
    lesson_title = data.get("lessonTitle", "មេរៀនទូទៅ")
    chapter = data.get("chapter", "")
    school = data.get("school", "វិទ្យាស្ថានគរុកោសល្យកំពង់ចាម")
    teacher = data.get("teacher", "គរុនិស្សិត / គ្រូបង្រៀន")
    duration = data.get("duration", "៥០ នាទី (១ ម៉ោងសិក្សា)")
    method = data.get("method", "សិស្សមជ្ឈមណ្ឌល / បែបត្រឡប់ (Backward Design)")
    content = data.get("lessonContent", "")

    lines = [l.strip() for l in content.splitlines() if l.strip()]
    main_points = lines[:4] if lines else [
        f"និយមន័យ និងគោលការណ៍គ្រឹះនៃ {lesson_title}",
        f"រូបមន្ត និងច្បាប់គន្លឹះក្នុងមុខវិជ្ជា {subject}",
        "ការអនុវត្តលំហាត់ និងការពិសោធន៍ជាក់ស្តែង"
    ]

    # Objectives strictly following MoEYS A-C-S Formula (Action + Condition + Standard)
    # Strictly 1 bullet point per category
    knowledge = [
        f"កំណត់និយមន័យ និងពន្យល់ពីខ្លឹមសារចម្បងនៃ «{lesson_title}» តាមរយៈការសង្កេតស្លាយបង្រៀន និងការពន្យល់របស់គ្រូ បានត្រឹមត្រូវ និងក្បោះក្បាយ។"
    ]
    skills = [
        f"វិភាគ គណនា និងដោះស្រាយលំហាត់ជាក់ស្តែងទាក់ទងនឹង «{lesson_title}» តាមរយៈការអនុវត្តការងារជាក្រុម បានត្រឹមត្រូវតាមក្បួនខ្នាត។"
    ]
    attitudes = [
        f"បង្ហាញនូវស្មារតីសហការ យកចិត្តទុកដាក់ និងការគោរពវិន័យក្នុងការរៀនសូត្រ តាមរយៈការចូលរួមសកម្មភាពក្រុម ប្រកបដោយទំនួលខុសត្រូវខ្ពស់។"
    ]

    teacher_materials = [
        f"សៀវភៅសិក្សាគោលមុខវិជ្ជា {subject} {grade}",
        "សៀវភៅគ្រូ បន្ទះរូបភាព ឬផ្ទាំងតារាងសង្ខេបខ្លឹមសារ",
        "សម្ភារពិសោធន៍ជាក់ស្តែង / កុំព្យូទ័របញ្ចាំងស្លាយ"
    ]
    student_materials = [
        f"សៀវភៅពុម្ព {subject} {grade}",
        "សៀវភៅសរសេរ ប៊ិច ខ្មៅដៃ បន្ទាត់ ក្ដារឆ្នួន"
    ]

    is_flipped = is_flipped_learning_request(data)
    is_bd = not is_flipped and is_backward_design_request(data)

    if is_flipped:
        pretest_qcm = generate_pretest_qcm_python(subject or "ចិត្តវិទ្យាអប់រំ", grade or "គរុនិស្សិត ឆ្នាំទី ១", lesson_title, main_points)
        posttest_mcq = generate_posttest_mcq_python(subject or "ចិត្តវិទ្យាអប់រំ", grade or "គរុនិស្សិត ឆ្នាំទី ១", lesson_title, main_points)
        is_180 = "180" in str(duration) or "១៨០" in str(duration) or not duration
        step1_dur = "០៥ នាទី"
        step2_dur = "២៥ នាទី" if is_180 else "២០ នាទី"
        step3_dur = "២០ នាទី"
        step4_dur = "១២០ នាទី" if is_180 else "១០០ នាទី"
        step5_dur = "១០ នាទី" if is_180 else "០៥ នាទី"

        steps = [
            {
                "stepNumber": 1,
                "stepTitle": "ជំហានទី១៖ រដ្ឋបាលថ្នាក់",
                "duration": step1_dur,
                "teacherActivity": "• គ្រូពិនិត្យអនាម័យ សណ្ដាប់ធ្នាប់ក្នុងថ្នាក់ និងសម្លៀកបំពាក់សិស្ស\n• គ្រូពិនិត្យវត្តមាន និងសម្រង់វត្តមានសិស្សប្រចាំថ្ងៃ",
                "contentSummary": "• ការពិនិត្យអនាម័យ សម្រង់វត្តមាន និងសណ្ដាប់ធ្នាប់ទូទៅក្នុងថ្នាក់\n• រៀបចំបរិយាកាស និងស្មារតីសម្រាប់ការរៀនសកម្ម",
                "studentActivity": "• ប្រធានថ្នាក់ឡើងរាយការណ៍ពីចំនួនសិស្សវត្តមាន និងអវត្តមាន\n• សិស្សទាំងអស់អង្គុយតាមកន្លែង រៀបចំសម្ភារសិក្សា និងគោរពវិន័យ"
            },
            {
                "stepNumber": 2,
                "stepTitle": "ជំហានទី២៖ រំលឹកមេរៀនចាស់",
                "duration": step2_dur,
                "teacherActivity": f"• គ្រូត្រួតពិនិត្យការស្វ័យសិក្សា និងរំលឹកចំណុចគន្លឹះនៃ «{lesson_title}»\n• គ្រូបង្ហាញលទ្ធផលបុរេតេស្ត (Pre-Test QCM ៥ សំណួរ) និងស្រាយចម្ងល់ Muddiest Points",
                "contentSummary": f"• ពិនិត្យការស្វ័យសិក្សា និងវិភាគលទ្ធផលបុរេតេស្ត (Pre-Test QCM ៥ សំណួរ)\n• បំភ្លឺចំណុចស្រពេចស្រពិល និងភ្ជាប់ទៅសកម្មភាពអនុវត្ត",
                "studentActivity": "• សិស្សស្តាប់ និងឆ្លើយសំណួររំលឹករបស់គ្រូ\n• លើកឡើងនូវចំណុចដែលនៅមិនទាន់ច្បាស់ពីការស្វ័យសិក្សានៅផ្ទះ"
            },
            {
                "stepNumber": 3,
                "stepTitle": "ជំហានទី៣៖ ខ្លឹមសារមេរៀនថ្មី",
                "duration": step3_dur,
                "teacherActivity": f"• គ្រូពន្យល់សង្ខេបតែលើគំនិតស្នូល និងក្របខណ្ឌទ្រឹស្តីសំខាន់ៗនៃ «{lesson_title}»\n• គ្រូចោទសួរ និងដោះស្រាយចម្ងល់គន្លឹះរបស់សិស្ស",
                "contentSummary": f"«{lesson_title}»\n• ខ្លឹមសារ និងទ្រឹស្តីស្នូលនៃមេរៀន៖\n" + "\n".join([f"  - {p}" for p in main_points[:4]]) if main_points else f"  - និយមន័យ និងគោលការណ៍គ្រឹះនៃ {lesson_title}\n  - ការផ្សារភ្ជាប់ទ្រឹស្តីទៅនឹងការអនុវត្តជាក់ស្តែង",
                "studentActivity": "• សិស្សយកចិត្តទុកដាក់ស្តាប់ការពន្យល់ និងកត់ត្រាគំនិតគន្លឹះ\n• ឆ្លើយតប និងសួរសំណួរបំភ្លឺបន្ថែមឱ្យកាន់តែស៊ីជម្រៅ"
            },
            {
                "stepNumber": 4,
                "stepTitle": "ជំហានទី៤៖ ពង្រឹងចំណេះដឹង",
                "duration": step4_dur,
                "teacherActivity": "• គ្រូបែងចែកក្រុមការងារ និងប្រគល់សន្លឹកកិច្ចការករណីសិក្សាជាក់ស្តែង (Challenge Scenario) លើ Flipchart A0/A1\n• គ្រូដើរសម្របសម្រួល ផ្តល់ Feedback និងដឹកនាំ Gallery Walk ការពារលទ្ធផលក្រុម",
                "contentSummary": "• សកម្មភាពអនុវត្តស៊ីជម្រៅ និងដោះស្រាយករណីសិក្សាជាក់ស្តែង៖\n" + "\n".join([f"  • {p}" for p in main_points[:4]]) if main_points else "  • ការវិភាគករណីសិក្សា និងយុទ្ធសាស្ត្រគរុកោសល្យ\n  • ការវាយតម្លៃ និងការឆ្លុះបញ្ចាំងបែបស្ថាបនា",
                "studentActivity": "• ធ្វើការរួមគ្នាក្នុងក្រុម វិភាគបញ្ហាដោយប្រើទ្រឹស្តីដែលបានរៀន\n• សរសេរដំណោះស្រាយលើ Flipchart តំណាងក្រុមឡើងការពារ និងឆ្លើយសំណួរដេញដោល"
            },
            {
                "stepNumber": 5,
                "stepTitle": "ជំហានទី៥៖ កិច្ចការផ្ទះ និងបណ្ដាំផ្ញើ",
                "duration": step5_dur,
                "teacherActivity": f"• គ្រូបូកសរុបគន្លឹះនៃមេរៀន {lesson_title} និងណែនាំការធ្វើតេស្តបញ្ចប់ (Post-Test ៥ សំណួរ)\n• គ្រូដាក់កិច្ចការស្រាវជ្រាវ និងណែនាំមាតិកាស្វ័យសិក្សាសម្រាប់សប្តាហ៍បន្ទាប់",
                "contentSummary": "• បូកសរុបការវាយតម្លៃលទ្ធផលសិក្សា (Post-Test ៥ សំណួរ)\n• កិច្ចការស្រាវជ្រាវ និងការត្រៀមសម្រាប់មេរៀនបន្ត",
                "studentActivity": "• ធ្វើ Post-Test ៥ សំណួរ\n• កត់ត្រាកិច្ចការផ្ទះ និងកាលវិភាគស្វ័យសិក្សាសប្តាហ៍បន្ទាប់"
            }
        ]

        return {
            "templateType": "flipped_learning",
            "templateTitle": "កិច្ចតែងការបង្រៀនតាមបែបត្រឡប់",
            "school": data.get("school", "វិទ្យាស្ថានគរុកោសល្យ"),
            "teacher": teacher or "កែម បូរី",
            "subject": subject or "ចិត្តវិទ្យាអប់រំ",
            "grade": grade or "គរុនិស្សិត ឆ្នាំទី ១ ឆមាសទី ២",
            "credits": data.get("credits", "៣ ក្រេឌីត (៣-០-៦)"),
            "year": data.get("year", "១"),
            "semester": data.get("semester", "២"),
            "week": data.get("week", "១"),
            "lessonNumber": data.get("lessonNumber", "១"),
            "duration": duration,
            "chapter": chapter,
            "lessonTitle": lesson_title,
            "method": method or "ការរៀនបែបត្រឡប់",
            "dateStr": get_khmer_date(),
            "licenseFootnote": "ខ្ញុំឈ្មោះកែម បូរី ជាគ្រូឧទ្ទេសមុខវិជ្ជាចិត្តវិទ្យាអប់រំ នៅវិទ្យាស្ថានគរុកោសល្យកំពង់ចាម",
            "objectives": {"knowledge": knowledge, "skills": skills, "attitudes": attitudes},
            "materials": {"teacher": teacher_materials, "student": student_materials},
            "preTestQCM": pretest_qcm,
            "steps": steps,
            "postTestMCQ": posttest_mcq
        }

    if is_bd:
        stage1 = {
            "title": "ដំណាក់កាលទី ១ : ការកំណត់លទ្ធផលរំពឹងទុក (Stage 1: Desired Results)",
            "establishedGoals": f"សិស្សយល់ដឹងស៊ីជម្រៅអំពីគោលគំនិតសំខាន់ៗនៃ «{lesson_title}» ក្នុងមុខវិជ្ជា {subject} {grade} និងអាចយកចំណេះដឹងនេះទៅដោះស្រាយបញ្ហាក្នុងជីវភាពជាក់ស្តែង។",
            "enduringUnderstandings": [
                f"ការយល់ដឹងពីគោលការណ៍គ្រឹះនៃ {lesson_title} ជួយឱ្យសិស្សមានមូលដ្ឋានគ្រឹះរឹងមាំក្នុងការស្រាវជ្រាវ និងសិក្សាបន្ត។",
                f"ចំណេះដឹង {subject} ផ្សារភ្ជាប់យ៉ាងជិតស្និទ្ធទៅនឹងបាតុភូត និងការអនុវត្តប្រចាំថ្ងៃក្នុងសង្គម។"
            ],
            "essentialQuestions": [
                f"ហេតុអ្វីបានជាយើងត្រូវសិក្សា និងស្វែងយល់អំពី «{lesson_title}»?",
                f"តើយើងអាចយកទ្រឹស្តី និងរូបមន្តនៃ {subject} ទៅអនុវត្តដោះស្រាយបញ្ហាជាក់ស្តែងដោយរបៀបណា?"
            ],
            "objectives": {
                "knowledge": knowledge,
                "skills": skills,
                "attitudes": attitudes
            }
        }

        stage2 = {
            "title": "ដំណាក់កាលទី ២ : ការកំណត់ភស្តុតាងនៃការវាយតម្លៃ (Stage 2: Assessment Evidence)",
            "performanceTasks": [
                f"សិស្សអាចធ្វើការជាក្រុម ដោះស្រាយលំហាត់គំរូ ពិសោធន៍ ឬបកស្រាយខ្លឹមសារនៃ «{lesson_title}» នៅលើក្ដារខៀនបានត្រឹមត្រូវ។",
                "ការរៀបចំរបាយការណ៍សង្ខេប និងការឆ្លើយតបសំណួរដេញដោលទាក់ទងនឹងបាតុភូតជាក់ស្តែង។"
            ],
            "otherEvidence": [
                "ការឆ្លើយសំណួរផ្ទាល់មាត់អំឡុងពេលបង្រៀន និងការលើកបង្ហាញលើក្ដារឆ្នួនរហ័ស។",
                "ការបំពេញសន្លឹកកិច្ចការបុគ្គល និងលទ្ធផលកិច្ចការផ្ទះ។",
                "ការសង្កេតផ្ទាល់របស់គ្រូលើឥរិយាបថ ការចូលរួម និងការសហការក្នុងក្រុម។"
            ],
            "criteria": [
                "ភាពត្រឹមត្រូវនៃចម្លើយ និងក្បួនដោះស្រាយ (៨០% ឡើង)",
                "បំណិនបកស្រាយ និងការចូលរួមយ៉ាងសកម្មក្នុងថ្នាក់រៀន"
            ]
        }

        learning_activities = [
            {
                "stepNumber": 1,
                "stepTitle": "១. ការទាក់ទាញ និងភ្ជាប់ទំនាក់ទំនង (Hook & Connect)",
                "duration": "៧ នាទី",
                "teacherActivity": f"• ពិនិត្យវត្តមាន និងអនាម័យ\n• ចោទសួរសំណួរគន្លឹះ (Essential Question)៖ «តើ {lesson_title} មានសារៈសំខាន់ដូចម្តេចក្នុងជីវភាព?»\n• បង្ហាញរូបភាព ឬវីដេអូខ្លីដើម្បីទាក់ទាញចំណាប់អារម្មណ៍សិស្ស",
                "contentSummary": f"• រដ្ឋបាលថ្នាក់ និងអនាម័យ\n• សំណួរគន្លឹះដាស់ការត្រិះរិះពិចារណា\n• ភ្ជាប់ទៅកាន់គោលបំណងនៃ {lesson_title}",
                "studentActivity": "• ត្រៀមសម្ភារសិក្សា និងរាយការណ៍វត្តមាន\n• ចូលរួមឆ្លើយសំណួរគន្លឹះដោយសេរី\n• កត់សម្គាល់គោលដៅនៃការរៀនសូត្រ"
            },
            {
                "stepNumber": 2,
                "stepTitle": "២. ការរុករក និងកសាងចំណេះដឹង (Equip & Explore)",
                "duration": "២៨ នាទី",
                "teacherActivity": f"• ចែកសិស្សជាក្រុមកិច្ចការ និងប្រគល់សន្លឹកកិច្ចការស្រាវជ្រាវ/លំហាត់\n• ណែនាំសិស្សឱ្យពិភាក្សា រុករកនិយមន័យ រូបមន្ត និងឧទាហរណ៍នៃ «{lesson_title}»\n• ដើរសម្របសម្រួល និងផ្តល់ការគាំទ្រតាមក្រុម",
                "contentSummary": f"«{lesson_title}»\n\n" + "\n".join(f"• {p}" for p in main_points),
                "studentActivity": "• សហការពិភាក្សាក្នុងក្រុម និងដោះស្រាយសន្លឹកកិច្ចការ\n• សាកសួរគ្រូពេលជួបការលំបាក\n• តំណាងក្រុមឡើងធ្វើបទបង្ហាញពីលទ្ធផលស្រាវជ្រាវ"
            },
            {
                "stepNumber": 3,
                "stepTitle": "៣. ការឆ្លុះបញ្ចាំង និងកែសម្រួល (Rethink & Reflect)",
                "duration": "១០ នាទី",
                "teacherActivity": "• សម្របសម្រួលឱ្យសិស្សឆ្លុះបញ្ចាំងលើលទ្ធផលការងារ\n• ផ្ទៀងផ្ទាត់ និងកែតម្រូវចំណុចខុសឆ្គងរួមគ្នា\n• សង្ខេបគន្លឹះសំខាន់ៗដែលសិស្សត្រូវចងចាំ",
                "contentSummary": "• ឆ្លុះបញ្ចាំងលើការយល់ដឹងរបស់សិស្ស\n• សន្និដ្ឋានខ្លឹមសារមេរៀនរួម\n• វាយតម្លៃសមត្ថភាពជាក់ស្តែង (Performance Assessment)",
                "studentActivity": "• ផ្ទៀងផ្ទាត់ចម្លើយ និងកែតម្រូវចំណុចខ្វះខាត\n• កត់ត្រាកំណែត្រឹមត្រូវចូលសៀវភៅ\n• លើកក្ដារឆ្នួនឆ្លើយសំណួរវាស់ស្ទង់រហ័ស"
            },
            {
                "stepNumber": 4,
                "stepTitle": "៤. ការវាយតម្លៃ និងការអនុវត្តបន្ត (Evaluate & Exhibit)",
                "duration": "៥ នាទី",
                "teacherActivity": "• វាយតម្លៃកម្រិតនៃការសម្រេចបាននូវលទ្ធផលរំពឹងទុក\n• ដាក់កិច្ចការអនុវត្តបន្ថែមនៅផ្ទះ (Performance Task)\n• ណែនាំពីការអនុវត្តចំណេះដឹងក្នុងជីវភាពប្រចាំថ្ងៃ",
                "contentSummary": "• វាយតម្លៃលទ្ធផលរំពឹងទុក (Stage 1 vs Stage 2)\n• កិច្ចការផ្ទះ និងការស្រាវជ្រាវបន្ថែម\n• បណ្តាំផ្ញើអប់រំទូន្មាន",
                "studentActivity": "• កត់ត្រាកិច្ចការផ្ទះចូលក្នុងសៀវភៅ\n• ឆ្លុះបញ្ចាំងការរៀនសូត្រផ្ទាល់ខ្លួន និងជម្រាបលាគ្រូ"
            }
        ]

        return {
            "templateType": "backward_design",
            "templateTitle": "កិច្ចតែងការបង្រៀន (តាមបែបត្រឡប់ - Backward Design / UbD)",
            "school": school,
            "teacher": teacher,
            "subject": subject,
            "grade": grade,
            "duration": duration,
            "chapter": chapter,
            "lessonTitle": lesson_title,
            "method": method,
            "dateStr": get_khmer_date(),
            "objectives": {"knowledge": knowledge, "skills": skills, "attitudes": attitudes},
            "materials": {"teacher": teacher_materials, "student": student_materials},
            "stage1": stage1,
            "stage2": stage2,
            "stage3": {
                "title": "ដំណាក់កាលទី ៣ : ផែនការរៀបចំការបង្រៀន និងរៀន (Stage 3: Learning Plan)",
                "materials": {"teacher": teacher_materials, "student": student_materials},
                "learningActivities": learning_activities
            },
            "steps": learning_activities,
            "preTestQCM": generate_pretest_qcm_python(subject, grade, lesson_title, main_points),
            "postTestMCQ": generate_posttest_mcq_python(subject, grade, lesson_title, main_points)
        }

    # Default 5-Step standard
    steps = [
        {
            "stepNumber": 1,
            "stepTitle": "ជំហានទី ១ : រដ្ឋបាលថ្នាក់",
            "duration": "២ នាទី",
            "teacherActivity": "• ពិនិត្យអនាម័យ សណ្ដាប់ធ្នាប់ក្នុងថ្នាក់\n• ពិនិត្យវត្តមាន និងកត់ត្រាអវត្តមានសិស្ស",
            "contentSummary": "• ពិនិត្យអវត្តមាន\n• ពង្រឹងវិន័យ និងអនាម័យ",
            "studentActivity": "• ប្រធានថ្នាក់ឡើងរាយការណ៍វត្តមាន និងអវត្តមាន\n• អង្គុយតាមកន្លែង និងរៀបចំសម្ភារសិក្សា"
        },
        {
            "stepNumber": 2,
            "stepTitle": "ជំហានទី ២ : រំលឹកមេរៀនចាស់ / ទំនាក់ទំនងមេរៀន",
            "duration": "៥ នាទី",
            "teacherActivity": f"• គ្រូចោទសួរទៅកាន់សិស្ស៖ «តើកាលពីម៉ោងមុនយើងបានរៀនអំពីអ្វី?»\n• គ្រូហៅសិស្ស ២-៣ នាក់ឱ្យឆ្លើយ និងកោតសរសើរ\n• គ្រូភ្ជាប់សំណួរគន្លឹះដើម្បីចូលទៅកាន់ «{lesson_title}»",
            "contentSummary": f"• រំលឹកចំណុចសំខាន់ៗនៃមេរៀនកន្លងមក\n• ភ្ជាប់ទំនាក់ទំនងចូលមេរៀនថ្មី៖ {lesson_title}",
            "studentActivity": "• សិស្សស្តាប់ និងស្ម័គ្រចិត្តឆ្លើយសំណួរគ្រូ\n• សិស្សផ្សេងទៀតផ្ទៀងផ្ទាត់ និងកត់សម្គាល់"
        },
        {
            "stepNumber": 3,
            "stepTitle": "ជំហានទី ៣ : ដំណើរការបង្រៀន និងរៀន (មេរៀនថ្មី)",
            "duration": "៣២ នាទី",
            "teacherActivity": f"• គ្រូសរសេរចំណងជើងមេរៀននៅលើក្ដារខៀន៖ «{lesson_title}»\n• គ្រូពន្យល់ និងបង្ហាញខ្លឹមសារគន្លឹះ (និយមន័យ រូបមន្ត ឬឧទាហរណ៍)\n• ដាក់សំណួរ ឬលំហាត់គំរូឱ្យសិស្សពិភាក្សាជាដៃគូ ឬជាក្រុមតូចៗ\n• ដើរសម្របសម្រួល ជួយណែនាំដល់ក្រុមដែលជួបការលំបាក\n• ឱ្យតំណាងក្រុមឡើងធ្វើបទបង្ហាញ ឬដោះស្រាយលើក្ដារខៀន\n• គ្រូនិងសិស្សរួមគ្នាកែតម្រូវ និងទាញសេចក្តីសន្និដ្ឋានរួម",
            "contentSummary": f"«{lesson_title}»\n\n" + "\n".join(f"• {p}" for p in main_points),
            "studentActivity": "• សិស្សកត់ត្រាចំណងជើងមេរៀនចូលក្នុងសៀវភៅ\n• យកចិត្តទុកដាក់ស្តាប់ការពន្យល់របស់គ្រូ\n• ចូលរួមពិភាក្សា និងសហការដោះស្រាយលំហាត់ក្នុងក្រុម\n• តំណាងក្រុមឡើងរាយការណ៍លទ្ធផល\n• កត់ត្រាកំណែត្រឹមត្រូវចូលសៀវភៅ"
        },
        {
            "stepNumber": 4,
            "stepTitle": "ជំហានទី ៤ : ពង្រឹងពុទ្ធិ (វាយតម្លៃ)",
            "duration": "៦ នាទី",
            "teacherActivity": f"• គ្រូដាក់សំណួរខ្លីៗ ឬលំហាត់សង្ខេបដើម្បីវាស់ស្ទង់ការយល់ដឹងរបស់សិស្ស\n• ឱ្យសិស្សឆ្លើយលើក្ដារឆ្នួន ឬសរសេររហ័ស\n• វាយតម្លៃកម្រិតនៃការសម្រេចបាននូវវត្ថុបំណងមេរៀន",
            "contentSummary": f"• សំណួរពង្រឹងពុទ្ធិ៖\n១. ចូរបកស្រាយនិយមន័យគន្លឹះក្នុង «{lesson_title}»?\n២. ចូរអនុវត្តលំហាត់/ឧទាហរណ៍ជាក់ស្តែងទី១?",
            "studentActivity": "• សិស្សទាំងអស់ចូលរួមឆ្លើយសំណួរយ៉ាងសកម្ម\n• លើកបង្ហាញចម្លើយ និងកែតម្រូវចំណុចខ្វះខាត"
        },
        {
            "stepNumber": 5,
            "stepTitle": "ជំហានទី ៥ : បណ្តាំផ្ញើ និងកិច្ចការផ្ទះ",
            "duration": "៥ នាទី",
            "teacherActivity": "• គ្រូដាក់កិច្ចការផ្ទះ (លំហាត់ ឬស្រាវជ្រាវបន្ថែម)\n• ណែនាំឱ្យសិស្សមើលមេរៀនបន្តសម្រាប់ម៉ោងក្រោយ\n• អប់រំទូន្មានពីការថែរក្សាសុខភាព អនាម័យ និងសុវត្ថិភាពធ្វើដំណើរ",
            "contentSummary": "• កិច្ចការផ្ទះ៖ លំហាត់ទី ១ និងទី ២ ក្នុងសៀវភៅពុម្ព\n• បណ្តាំផ្ញើ៖ អានមេរៀនបន្ត និងគោរពច្បាប់ចរាចរណ៍",
            "studentActivity": "• សិស្សកត់ត្រាកិច្ចការផ្ទះចូលក្នុងសៀវភៅ\n• ទទួលយកការណែនាំ និងជម្រាបលាគ្រូ"
        }
    ]

    return {
        "templateType": "5_steps",
        "school": school,
        "teacher": teacher,
        "subject": subject,
        "grade": grade,
        "duration": duration,
        "chapter": chapter,
        "lessonTitle": lesson_title,
        "method": method,
        "dateStr": get_khmer_date(),
        "objectives": {"knowledge": knowledge, "skills": skills, "attitudes": attitudes},
        "materials": {"teacher": teacher_materials, "student": student_materials},
        "steps": steps,
        "preTestQCM": generate_pretest_qcm_python(subject, grade, lesson_title, main_points),
        "postTestMCQ": generate_posttest_mcq_python(subject, grade, lesson_title, main_points)
    }


# ==============================================================================
# Gemini AI Online Integration
# ==============================================================================
def generate_with_gemini_python(api_key, data):
    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={api_key}"
    
    subject = data.get("subject", "")
    grade = data.get("grade", "")
    lesson_title = data.get("lessonTitle", "")
    chapter = data.get("chapter", "")
    school = data.get("school", "")
    teacher = data.get("teacher", "")
    duration = data.get("duration", "៥០ នាទី")
    method = data.get("method", "")
    custom_notes = data.get("customNotes", "")
    lesson_content = data.get("lessonContent", "")
    custom_template = data.get("customTemplate", "")

    is_flipped = is_flipped_learning_request(data)
    is_bd = not is_flipped and is_backward_design_request(data)

    if is_flipped:
        system_prompt = f"""You are Google Gemini AI serving as an expert Cambodian educator, 21st-century pedagogical coach, and Google NotebookLM specialist for the Ministry of Education, Youth and Sport (MoEYS) and Teacher Education Colleges (TEC).
Generate a complete, high-quality, professional Lesson Plan based on the **FLIPPED LEARNING (ថ្នាក់រៀនត្រឡប់) 5-Step Model** (៥% - ១០% - ១០% - ៧០% - ៥%) with an authentic **Pre-Test QCM 10 Questions** (2-6-2 difficulty ratio), a **វីដេអូបង្រៀន Guide (5-8 mins - Font: Kantumruy Pro)**, a 4x4 **Active Collaboration Rubric**, a **Post-Test MCQ 10 Questions (Bloom's 3-4-3)**, and an **Exit Ticket 3-2-1** in Khmer.

Pedagogical Principles & Step Guidelines for Flipped Learning:
1. Google NotebookLM Pre-Class Phase (សកម្មភាពស្វ័យសិក្សាត្រៀមមុនម៉ោង):
   - វីដេអូបង្រៀន (៥ ទៅ ៨ នាទី - Font: Kantumruy Pro) with 4 progressive scenes (Narration in Khmer & On-Screen Display text).
   - Key takeaways and diagnostic tasks.
   - Muddiest Point prompt (សិស្សកត់ត្រាចំណុចឆ្ងល់យ៉ាងតិច ១ យកមកដោះស្រាយក្នុងជំហានទី២).
2. Diagnostic Assessment (វិញ្ញាសា Pre-Test QCM ១០ សំណួរ បង្កើតដោយ Gemini AI - កម្រិតស្តង់ដារ ២-៦-២):
   - Strictly 10 multiple-choice questions with choices (A, B, C, D / ក, ខ, គ, ឃ), correct answer, and explanation.
   - Difficulty standard 2-6-2: Questions 1-2 (Easy), Questions 3-8 (Medium), Questions 9-10 (Hard).
3. In-Class 5-Step Process (ដំណើរការបង្រៀន ៥ ជំហាន: ៥% - ១០% - ១០% - ៧០% - ៥%):
   - ជំហានទី ១ : រដ្ឋបាលថ្នាក់ & ការរៀបចំ (៥%): គ្មានសំណួរចោទសួរទេ! គ្រូស្វាគមន៍ ពិនិត្យវត្តមាន សណ្ដាប់ធ្នាប់ អនាម័យ និងរៀបចំបរិយាកាសសិក្សាសកម្ម។
   - ជំហានទី ២ : ត្រួតពិនិត្យការស្វ័យសិក្សាពីផ្ទះ & ដោះស្រាយចម្ងល់ Muddiest Points (Engage & Explore) (១០%): គ្រូផ្សារភ្ជាប់លទ្ធផល Pre-Test, ចោទសួរផ្ទាល់មាត់បំផុសស្មារតី ២ សំណួរខ្លីៗ, ហៅសិស្សលើកឡើង Muddiest Points, និងបង្ហាញការវាយតម្លៃ Pre-Test។
   - ជំហានទី ៣ : តម្រង់ទិស និងប្រគល់បេសកកម្មសិក្សា Challenge Scenario (Explore) (១០%): គ្រូដាក់ ៤ សំណួរតម្រង់ទិសដើម្បីពិនិត្យការយល់ដឹង និងសង្ខេបចម្លើយមុនប្រគល់បេសកកម្ម។
   - ជំហានទី ៤ : សកម្មភាពអនុវត្ត និងដោះស្រាយបញ្ហាក្នុងថ្នាក់ (Explain & Elaborate) (៧០% - CORE PHASE):
     • ចែកសិស្សជា ៤ ក្រុមស្មើគ្នា (ក្រុមទី១, ២, ៣, ៤) ដោយប្រគល់សំណួរពិភាក្សាស៊ីជម្រៅរៀងៗខ្លួន (Challenge Scenario Worksheets)។
     • គ្រប់គ្រងតាម ៤ ដំណាក់កាលជាក់លាក់៖
       * ដំណាក់កាលទី១: ការពិភាក្សា និងវិភាគស៊ីជម្រៅក្នុងក្រុម (២០ នាទី)
       * ដំណាក់កាលទី២: ការអនុវត្តសរសេរ & Mind Mapping លើ Flipchart A0/A1 ជាមួយប៊ិចហ្វឺតពណ៌ (៣០ នាទី)
       * ដំណាក់កាលទី៣: ការធ្វើ Gallery Walk & បទបង្ហាញការពារ និងឆ្លើយសំណួរដេញដោល (៤០ នាទី)
       * ដំណាក់កាលទី៤: ការបូកសរុបទាញក្បួនរួម + លំហាត់ Brain Break ២ នាទី (ដកដង្ហើមជ្រៅៗ និងបន្ធូរអារម្មណ៍) (១០ នាទី)
     • ដាក់តេស្តបញ្ចប់ Post-Test & Exit Ticket 3-2-1។
   - ជំហានទី ៥ : បណ្តាំផ្ញើ និងកិច្ចការផ្ទះ (៥%): បណ្តាំផ្ញើសីលធម៌/បរិស្ថាន + ដាក់ ១ សំណួរកិច្ចការស្រាវជ្រាវ (Research Task) សម្រាប់រៀបចំម៉ោងបន្ទាប់។
4. Post-Class / Extension Phase (សកម្មភាពពង្រីកពុទ្ធិក្រោយម៉ោង).
5. MANDATORY INSTRUCTIONAL OBJECTIVE FORMULA (ក្បួនតែងវត្ថុបំណងបង្រៀនស្តង់ដារ MoEYS / គរុកោសល្យ A-C-S):
   ⚠️ វិធានកំណត់ចំនួនចំណុច (STRICT 1-BULLET LIMIT): នៅក្នុងវត្ថុបំណងនីមួយៗទាំង ៣ ផ្នែក (វិជ្ជាសម្បទា បំណិនសម្បទា ចរិយាសម្បទា) ត្រូវតែមានត្រឹមតែ ១ ចំណុចគត់ (EXACTLY 1 single comprehensive bullet point per category) ដែលមានសមាសភាគពេញលេញទាំង ៣ តាមរូបមន្ត ACS៖
   - [A - Action / សកម្មភាព ឬ របៀបធ្វើសកម្មភាព]: ប្រើកិរិយាស័ព្ទសកម្មដែលអាចវាស់វែងបាន (ឧ. កំណត់, ពន្យល់, រៀបរាប់, គណនា, វិភាគ, ដោះស្រាយ, រៀបចំ, បង្ហាញ, ប្ដេជ្ញាចិត្ត...)
   - [C - Condition / លក្ខខណ្ឌ]: មធ្យោបាយ ឬវិធីសាស្ត្ររៀន (ឧ. «តាមរយៈការពន្យល់របស់គ្រូ និងការសង្កេតស្លាយ/វីដេអូ», «តាមរយៈការអានឯកសារគោល», «តាមរយៈការអនុវត្តលំហាត់ជាក់ស្តែង និងការពិភាក្សាជាក្រុម», «តាមរយៈការឆ្លុះបញ្ចាំងលើ Exit Ticket»...)
   - [S - Standard / ស្ដង់ដារ ឬ កម្រិតកំណត់]: កម្រិតកំណត់នៃការសម្រេចបាន (ឧ. «បានត្រឹមត្រូវ និងក្បោះក្បាយ», «បានយ៉ាងហោចណាស់ ៨០% ត្រឹមត្រូវ», «បានច្បាស់លាស់ឥតខុសឆ្គង», «ប្រកបដោយភាពជឿជាក់ និងស្ទាត់ជំនាញ», «ប្រកបដោយស្មារតីទទួលខុសត្រូវខ្ពស់»)
   ⚠️ ហាមដាក់លើសពី ១ ចំណុចក្នុងផ្នែកនីមួយៗ! (STRICTLY 1 single comprehensive ACS bullet for knowledge, 1 for skills, and 1 for attitudes).

Return ONLY valid JSON matching this schema:
{{
  "templateType": "flipped_learning",
  "templateTitle": "កិច្ចតែងការបង្រៀនតាមបែបត្រឡប់",
  "school": "{school}",
  "teacher": "{teacher}",
  "subject": "{subject}",
  "grade": "{grade}",
  "credits": "៣ ក្រេឌីត (៣-០-៦)",
  "year": "១",
  "semester": "២",
  "week": "១",
  "lessonNumber": "១",
  "duration": "{duration}",
  "chapter": "{chapter}",
  "lessonTitle": "{lesson_title}",
  "method": "ការរៀនបែបត្រឡប់",
  "dateStr": "ថ្ងៃ... ខែ... ឆ្នាំ២០២...",
  "objectives": {{
    "intro": "បន្ទាប់ពីរៀនមេរៀននេះចប់ គរុនិស្សិតនឹង៖",
    "knowledge": [
      "ពន្យល់ពីគោលការណ៍គ្រឹះ និងនិយមន័យនៃ «{lesson_title}» តាមរយៈការសង្កេតស្លាយបង្រៀន និងការពន្យល់របស់គ្រូ បានត្រឹមត្រូវ និងក្បោះក្បាយ។"
    ],
    "skills": [
      "វិភាគ និងដោះស្រាយលំហាត់/កិច្ចការជាក់ស្តែងនៃ «{lesson_title}» តាមរយៈការអនុវត្តការងារជាក្រុម បានត្រឹមត្រូវតាមក្បួនខ្នាត។"
    ],
    "attitudes": [
      "បង្ហាញនូវស្មារតីសហការ យកចិត្តទុកដាក់ និងការគោរពវិន័យ តាមរយៈការចូលរួមសកម្មភាពក្រុម ប្រកបដោយទំនួលខុសត្រូវខ្ពស់។"
    ]
  }},
  "materials": {{
    "teacher": ["កិច្ចតែងការបង្រៀន", "វីដេអូបង្រៀន", "ស្លាយបង្រៀន", "សន្លឹកកិច្ចការករណីសិក្សា"],
    "student": ["សៀវភៅគោល", "សៀវភៅកត់ត្រា", "ផ្ទាំងក្រដាសធំ Flipchart", "ប៊ិចហ្វឺតពណ៌"]
  }},
  "preTestQCM": [
    {{
      "number": 1,
      "difficulty": "ងាយ (Easy)",
      "difficultyLevel": "easy",
      "question": "សំណួរ Pre-Test ទី១...",
      "options": {{ "A": "...", "B": "...", "C": "...", "D": "..." }},
      "correctAnswer": "A",
      "explanation": "..."
    }},
    {{
      "number": 2,
      "difficulty": "ងាយ (Easy)",
      "difficultyLevel": "easy",
      "question": "សំណួរ Pre-Test ទី២...",
      "options": {{ "A": "...", "B": "...", "C": "...", "D": "..." }},
      "correctAnswer": "B",
      "explanation": "..."
    }},
    {{
      "number": 3,
      "difficulty": "ងាយ (Easy)",
      "difficultyLevel": "easy",
      "question": "សំណួរ Pre-Test ទី៣...",
      "options": {{ "A": "...", "B": "...", "C": "...", "D": "..." }},
      "correctAnswer": "A",
      "explanation": "..."
    }},
    {{
      "number": 4,
      "difficulty": "មធ្យម (Medium)",
      "difficultyLevel": "medium",
      "question": "សំណួរ Pre-Test ទី៤...",
      "options": {{ "A": "...", "B": "...", "C": "...", "D": "..." }},
      "correctAnswer": "A",
      "explanation": "..."
    }},
    {{
      "number": 5,
      "difficulty": "ពិបាក (Hard)",
      "difficultyLevel": "hard",
      "question": "សំណួរ Pre-Test ទី៥...",
      "options": {{ "A": "...", "B": "...", "C": "...", "D": "..." }},
      "correctAnswer": "A",
      "explanation": "..."
    }}
  ],
  "steps": [
    {{
      "stepNumber": 1,
      "stepTitle": "ជំហានទី១៖ រដ្ឋបាលថ្នាក់",
      "duration": "០៥ នាទី",
      "teacherActivity": "ពិនិត្យអនាម័យ វត្តមាន សណ្ដាប់ធ្នាប់",
      "contentSummary": "ការពិនិត្យអនាម័យ សម្រង់វត្តមាន និងសណ្ដាប់ធ្នាប់",
      "studentActivity": "ប្រធានថ្នាក់រាយការណ៍ និងត្រៀមរៀន"
    }},
    {{
      "stepNumber": 2,
      "stepTitle": "ជំហានទី២៖ រំលឹកមេរៀនចាស់",
      "duration": "២៥ នាទី",
      "teacherActivity": "ពិនិត្យការស្វ័យសិក្សា និងបង្ហាញលទ្ធផលបុរេតេស្ត (Pre-Test QCM ៥ សំណួរ)",
      "contentSummary": "វិភាគលទ្ធផលបុរេតេស្ត និងស្រាយចម្ងល់ Muddiest Points",
      "studentActivity": "ឆ្លើយសំណួររំលឹក និងលើកឡើងចំណុចចម្ងល់"
    }},
    {{
      "stepNumber": 3,
      "stepTitle": "ជំហានទី៣៖ ខ្លឹមសារមេរៀនថ្មី",
      "duration": "២០ នាទី",
      "teacherActivity": "ពន្យល់សង្ខេបតែលើគំនិតស្នូល និងក្របខណ្ឌទ្រឹស្តីសំខាន់ៗនៃមេរៀន",
      "contentSummary": "ខ្លឹមសារស្នូល និងទ្រឹស្តីគន្លឹះនៃមេរៀន",
      "studentActivity": "យកចិត្តទុកដាក់ស្តាប់ កត់ត្រាគំនិតសំខាន់ៗ និងសួរសំណួរ"
    }},
    {{
      "stepNumber": 4,
      "stepTitle": "ជំហានទី៤៖ ពង្រឹងចំណេះដឹង",
      "duration": "១២០ នាទី",
      "teacherActivity": "បែងចែកក្រុម ដាក់សន្លឹកកិច្ចការករណីសិក្សាលើ Flipchart និងសម្របសម្រួល Gallery Walk",
      "contentSummary": "ដំណោះស្រាយករណីសិក្សាជាក់ស្តែង និងការការពារទស្សនៈ",
      "studentActivity": "ធ្វើការជាក្រុម សរសេរលើ Flipchart ឡើងការពារ និងឆ្លើយសំណួរដេញដោល"
    }},
    {{
      "stepNumber": 5,
      "stepTitle": "ជំហានទី៥៖ កិច្ចការផ្ទះ និងបណ្ដាំផ្ញើ",
      "duration": "១០ នាទី",
      "teacherActivity": "ណែនាំការធ្វើតេស្តបញ្ចប់ (Post-Test ៥ សំណួរ) និងដាក់កិច្ចការស្រាវជ្រាវបន្ត",
      "contentSummary": "ការវាយតម្លៃ Post-Test និងកិច្ចការស្រាវជ្រាវសម្រាប់ម៉ោងក្រោយ",
      "studentActivity": "ធ្វើ Post-Test ភ្លាមៗ និងកត់ត្រាកិច្ចការផ្ទះ"
    }}
  ],
  "postTestMCQ": [
    {{
      "number": 1,
      "bloom": "Remember & Understand",
      "difficulty": "ងាយ (Easy)",
      "difficultyLevel": "easy",
      "question": "សំណួរ Post-Test ទី១...",
      "options": {{ "A": "...", "B": "...", "C": "...", "D": "..." }},
      "correctAnswer": "A",
      "explanation": "..."
    }}
  ]
}}
"""
    elif is_bd:
        system_prompt = f"""You are an expert Cambodian pedagogical educator and TEC (Teacher Education College) curriculum developer.
Generate a complete, high-quality Backward Design / UbD Lesson Plan (កិច្ចតែងការបង្រៀន តាមបែបត្រឡប់ ៣ ដំណាក់កាល) in Khmer.
Structure requirements:
Stage 1 (ដំណាក់កាលទី ១ : ការកំណត់លទ្ធផលរំពឹងទុក): establishedGoals, enduringUnderstandings (array), essentialQuestions (array), objectives (knowledge, skills, attitudes).
Stage 2 (ដំណាក់កាលទី ២ : ការកំណត់ភស្តុតាងនៃការវាយតម្លៃ): performanceTasks (array), otherEvidence (array), criteria (array).
Stage 3 (ដំណាក់កាលទី ៣ : ផែនការរៀបចំការបង្រៀន និងរៀន): materials (teacher, student), learningActivities (array of steps with stepNumber, stepTitle, duration, teacherActivity, contentSummary, studentActivity).

Return ONLY valid JSON matching this schema:
{{
  "templateType": "backward_design",
  "templateTitle": "កិច្ចតែងការបង្រៀន (តាមបែបត្រឡប់ - Backward Design / UbD)",
  "school": "{school}",
  "teacher": "{teacher}",
  "subject": "{subject}",
  "grade": "{grade}",
  "duration": "{duration}",
  "chapter": "{chapter}",
  "lessonTitle": "{lesson_title}",
  "dateStr": "ថ្ងៃ... ខែ... ឆ្នាំ២០២...",
  "objectives": {{
    "knowledge": ["ពន្យល់ពីគោលការណ៍គ្រឹះនៃ «{lesson_title}» តាមរយៈការសង្កេតស្លាយបង្រៀន និងការពន្យល់របស់គ្រូ បានត្រឹមត្រូវ និងក្បោះក្បាយ។"],
    "skills": ["វិភាគ និងដោះស្រាយកិច្ចការជាក់ស្តែងនៃ «{lesson_title}» តាមរយៈការអនុវត្តការងារជាក្រុម បានត្រឹមត្រូវតាមក្បួនខ្នាត។"],
    "attitudes": ["បង្ហាញនូវស្មារតីសហការ យកចិត្តទុកដាក់ និងការគោរពវិន័យ តាមរយៈការចូលរួមសកម្មភាពក្រុម ប្រកបដោយទំនួលខុសត្រូវខ្ពស់។"]
  }},
  "materials": {{
    "teacher": ["...", "..."],
    "student": ["...", "..."]
  }},
  "stage1": {{
    "title": "ដំណាក់កាលទី ១ : ការកំណត់លទ្ធផលរំពឹងទុក (Stage 1: Desired Results)",
    "establishedGoals": "...",
    "enduringUnderstandings": ["...", "..."],
    "essentialQuestions": ["...", "..."],
    "objectives": {{
      "knowledge": ["ពន្យល់ពី... តាមរយៈ... បានត្រឹមត្រូវ និងក្បោះក្បាយ។"],
      "skills": ["ដោះស្រាយ... តាមរយៈ... បានត្រឹមត្រូវតាមក្បួនខ្នាត។"],
      "attitudes": ["បង្ហាញនូវស្មារតី... តាមរយៈ... ប្រកបដោយទំនួលខុសត្រូវខ្ពស់។"]
    }}
  }},
  "stage2": {{
    "title": "ដំណាក់កាលទី ២ : ការកំណត់ភស្តុតាងនៃការវាយតម្លៃ (Stage 2: Assessment Evidence)",
    "performanceTasks": ["...", "..."],
    "otherEvidence": ["...", "..."],
    "criteria": ["...", "..."]
  }},
  "stage3": {{
    "title": "ដំណាក់កាលទី ៣ : ផែនការរៀបចំការបង្រៀន និងរៀន (Stage 3: Learning Plan)",
    "materials": {{
      "teacher": ["...", "..."],
      "student": ["...", "..."]
    }},
    "learningActivities": [
      {{
        "stepNumber": 1,
        "stepTitle": "១. ការទាក់ទាញ និងភ្ជាប់ទំនាក់ទំនង (Hook & Connect)",
        "duration": "៧ នាទី",
        "teacherActivity": "...",
        "contentSummary": "...",
        "studentActivity": "..."
      }},
      {{
        "stepNumber": 2,
        "stepTitle": "២. ការរុករក និងកសាងចំណេះដឹង (Equip & Explore)",
        "duration": "២៨ នាទី",
        "teacherActivity": "...",
        "contentSummary": "...",
        "studentActivity": "..."
      }},
      {{
        "stepNumber": 3,
        "stepTitle": "៣. ការឆ្លុះបញ្ចាំង និងកែសម្រួល (Rethink & Reflect)",
        "duration": "១០ នាទី",
        "teacherActivity": "...",
        "contentSummary": "...",
        "studentActivity": "..."
      }},
      {{
        "stepNumber": 4,
        "stepTitle": "៤. ការវាយតម្លៃ និងការអនុវត្តបន្ត (Evaluate & Exhibit)",
        "duration": "៥ នាទី",
        "teacherActivity": "...",
        "contentSummary": "...",
        "studentActivity": "..."
      }}
    ]
  }},
  "steps": [
    {{
      "stepNumber": 1,
      "stepTitle": "...",
      "duration": "...",
      "teacherActivity": "...",
      "contentSummary": "...",
      "studentActivity": "..."
    }}
  ],
  "selfEvaluation": "..."
}}"""
    else:
        system_prompt = f"""You are an expert Cambodian pedagogical educator and curriculum developer aligned with the Ministry of Education, Youth and Sport (MoEYS) of Cambodia.
Generate a complete, high-quality, professional official Cambodian Lesson Plan (កិច្ចតែងការបង្រៀន) in Khmer.
Structure requirements:
1. School, Teacher, Subject, Grade, Duration, Chapter, Lesson Title, Date
2. Three-tier Objectives (វត្ថុបំណង តាមក្បួនគរុកោសល្យ A-C-S / ABCD): វិជ្ជាសម្បទា (knowledge), បំណិនសម្បទា (skills), ចរិយាសម្បទា (attitudes).
   ⚠️ វិធានកំណត់ចំនួនចំណុច (STRICT 1-BULLET LIMIT): នៅក្នុងវត្ថុបំណងនីមួយៗទាំង ៣ ផ្នែក ត្រូវតែមានត្រឹមតែ ១ ចំណុចគត់ (EXACTLY 1 single comprehensive bullet point per category)។ រាល់ចំណុចនីមួយៗត្រូវតែមានសមាសភាគពេញលេញទាំង ៣ [A - Action Verb], [C - Condition: តាមរយៈ...], and [S - Standard: បានត្រឹមត្រូវ/ច្បាស់លាស់...].
3. Teaching Aids & Materials (សម្ភារឧបទេស): teacher materials and student materials
4. Five-Step Teaching Process (ដំណើរការបង្រៀន ៥ ជំហាន): stepNumber, stepTitle, duration, teacherActivity, contentSummary, studentActivity
   - QUESTION QUOTAS & ACTIVITY TYPES:
     • ការពិភាក្សាក្រុម (Group Discussion): Must provide 4 complete questions (១. «...?» ២. «...?» ៣. «...?» ៤. «...?»). If uploaded slides have 4 questions, extract ALL 4 verbatim!
     • ការស្រាវជ្រាវ (Research Tasks): Up to 10 specific topics for student groups to choose from.
     • ការសួរឆ្លើយផ្ទាល់មាត់ (Oral Q&A): 6 specific questions for teacher-student dialogue.
     • ករណីសិក្សា (Case Studies): 1 to 2 detailed real-life scenario case studies.
   - MANDATORY 3-COLUMN ALIGNMENT:
     • teacherActivity: List every question in quotation marks «...» by number.
     • contentSummary: Complete theoretical answers for each question (ចម្លើយទី១៖ ..., ចម្លើយទី២៖ ..., ចម្លើយទី៣៖ ..., ចម្លើយទី៤៖ ...).
     • studentActivity: Predicted summarized student answers for each question («សិស្សឆ្លើយ (ចម្លើយរំពឹងទុក)៖ - សំណួរទី១៖ ..., - សំណួរទី២៖ ..., - សំណួរទី៣៖ ..., - សំណួរទី៤៖ ...»).
5. Self-Reflection (ការស្វ័យវាយតម្លៃ)

{f"IMPORTANT: The user provided a custom template structure. You MUST adopt this custom format: {custom_template}" if custom_template else ""}

Return ONLY valid JSON matching this schema:
{{
  "templateType": "5_steps",
  "school": "{school}",
  "teacher": "{teacher}",
  "subject": "{subject}",
  "grade": "{grade}",
  "duration": "{duration}",
  "chapter": "{chapter}",
  "lessonTitle": "{lesson_title}",
  "method": "{method}",
  "dateStr": "ថ្ងៃ... ខែ... ឆ្នាំ២០២...",
  "objectives": {{
    "knowledge": [
      "ពន្យល់ពីគោលការណ៍គ្រឹះ និងនិយមន័យនៃ «{lesson_title}» តាមរយៈការសង្កេតស្លាយ និងការពន្យល់របស់គ្រូ បានត្រឹមត្រូវ និងក្បោះក្បាយ។"
    ],
    "skills": [
      "គណនា ដោះស្រាយលំហាត់ ឬអនុវត្តបំណិនជាក់ស្តែងនៃ «{lesson_title}» តាមរយៈការអនុវត្តការងារជាក្រុម បានត្រឹមត្រូវតាមក្បួនខ្នាត។"
    ],
    "attitudes": [
      "បង្ហាញនូវស្មារតីសហការ យកចិត្តទុកដាក់ និងការគោរពវិន័យក្នុងការរៀនសូត្រ តាមរយៈការចូលរួមសកម្មភាពក្រុម ប្រកបដោយទំនួលខុសត្រូវខ្ពស់។"
    ]
  }},
  "materials": {{
    "teacher": ["...", "..."],
    "student": ["...", "..."]
  }},
  "steps": [
    {{
      "stepNumber": 1,
      "stepTitle": "ជំហានទី ១ : រដ្ឋបាលថ្នាក់",
      "duration": "២ នាទី",
      "teacherActivity": "...",
      "contentSummary": "...",
      "studentActivity": "..."
    }}
  ],
  "selfEvaluation": "..."
}}"""

    user_query = f"""មុខវិជ្ជា: {subject}
កម្រិតថ្នាក់: {grade}
ជំពូក: {chapter}
ចំណងជើងមេរៀន: {lesson_title}
រយៈពេល: {duration}
វិធីសាស្ត្របង្រៀន: {method}
សំណូមពរបន្ថែម: {custom_notes}
ខ្លឹមសារមេរៀន ឬឯកសារដែលបាន Upload:
{lesson_content or 'សូមរៀបចំខ្លឹមសារឱ្យត្រូវតាមកម្មវិធីសិក្សារបស់ក្រសួងអប់រំ យុវជន និងកីឡា'}

🚨 ក្បួនគរុកោសល្យទាញយកសំណួរពីឯកសារ/ស្លាយ៖
១. ប្រសិនបើក្នុងឯកសារ/ស្លាយមានសំណួរពិភាក្សា ឬកិច្ចការស្រាវជ្រាវ ត្រូវស្រង់យកសំណួរទាំងអស់មកប្រើឱ្យគ្រប់ ១០០% ដោយហាមដាច់ខាតកាត់ចោល!
២. កូតាសំណួរ៖ ការពិភាក្សាក្រុម = ៤ សំណួរ, ការស្រាវជ្រាវ = ១០ ប្រធានបទ, ការសួរផ្ទាល់មាត់ = ៦ សំណួរ, ករណីសិក្សា = ១-២ ករណី។
៣. ត្រូវតម្រឹម ៣ ជួរឈរ៖ សកម្មភាពគ្រូ (សំណួរទាំងអស់ក្នុង «...»), ខ្លឹមសារ (ចម្លើយទ្រឹស្តីពេញលេញតាមលេខរៀង), សកម្មភាពសិស្ស (ចម្លើយរំពឹងទុករបស់សិស្សសង្ខេបខ្លីៗតាមលេខរៀង)។"""

    payload = {
        "contents": [
            {"role": "user", "parts": [{"text": system_prompt + "\n\n" + user_query}]}
        ],
        "generationConfig": {
            "temperature": 0.3,
            "responseMimeType": "application/json"
        }
    }

    candidate_endpoints = [
        f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key={api_key}",
        f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key={api_key}",
        f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent?key={api_key}",
        f"https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key={api_key}",
        f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}",
        f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key={api_key}",
    ]

    last_error = None
    for endpoint in candidate_endpoints:
        req = urllib.request.Request(
            endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )

        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                res_data = json.loads(response.read().decode("utf-8"))
                text_content = res_data["candidates"][0]["content"]["parts"][0]["text"]
                parsed = json.loads(text_content)
                if is_bd and not parsed.get("stage1") and parsed.get("steps"):
                    parsed["templateType"] = "backward_design"
                parsed["method"] = method or parsed.get("method")
                parsed["school"] = school or parsed.get("school")
                parsed["teacher"] = teacher or parsed.get("teacher")
                parsed["subject"] = subject or parsed.get("subject")
                parsed["grade"] = grade or parsed.get("grade")
                parsed["duration"] = duration or parsed.get("duration")
                parsed["chapter"] = chapter or parsed.get("chapter")
                parsed["lessonTitle"] = lesson_title or parsed.get("lessonTitle")
                return parsed
        except urllib.error.HTTPError as he:
            err_body = he.read().decode("utf-8", errors="ignore")
            last_error = f"HTTP {he.code}: {err_body}"
            if he.code == 404 or "not found" in err_body.lower() or "not supported" in err_body.lower():
                continue
            raise Exception(last_error)
        except Exception as e:
            last_error = str(e)
            if "not found" in str(e).lower() or "404" in str(e).lower():
                continue
            raise e

    raise Exception(f"All Gemini endpoints failed. {last_error}")


# ==============================================================================
# Routes
# ==============================================================================

@app.after_request
def add_no_cache_headers(response):
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response






APP_VERSION = "2.5.0"
APP_RELEASE_DATE = "2026-08-20"


@app.route("/api/health", methods=["GET"])
def health_check():
    return jsonify({
        "status": "ok", 
        "service": "AI Lesson Plan Studio (Python/Flask)",
        "version": APP_VERSION
    })


@app.route("/api/system/version", methods=["GET"])
def get_system_version():
    return jsonify({
        "version": APP_VERSION,
        "releaseDate": APP_RELEASE_DATE,
        "appName": "AI Lesson Plan Studio"
    })


@app.route("/api/system/check_update", methods=["GET"])
def check_system_update():
    manifest_url = os.environ.get(
        "ALPS_UPDATE_URL", 
        "https://raw.githubusercontent.com/KemBorey/ai-lesson-plan-studio/main/version_manifest.json"
    )
    
    try:
        req = urllib.request.Request(manifest_url, headers={"User-Agent": f"ALPS-Updater/{APP_VERSION}"})
        with urllib.request.urlopen(req, timeout=3) as resp:
            if resp.status == 200:
                remote_data = json.loads(resp.read().decode("utf-8"))
                remote_ver = remote_data.get("version", APP_VERSION)
                has_update = remote_ver > APP_VERSION
                return jsonify({
                    "hasUpdate": has_update,
                    "currentVersion": APP_VERSION,
                    "latestVersion": remote_ver,
                    "releaseDate": remote_data.get("releaseDate", ""),
                    "releaseNotes": remote_data.get("releaseNotes", ["កែលម្អប្រព័ន្ធ និងបន្ថែមមុខងារថ្មីៗ"]),
                    "updateUrl": remote_data.get("updateUrl", "")
                })
    except Exception:
        pass
    
    return jsonify({
        "hasUpdate": False,
        "currentVersion": APP_VERSION,
        "latestVersion": APP_VERSION,
        "releaseDate": APP_RELEASE_DATE,
        "releaseNotes": ["កម្មវិធីរបស់អ្នកជាកំណែចុងក្រោយបំផុត"],
        "status": "up_to_date"
    })


@app.route("/api/system/apply_update", methods=["POST"])
def apply_system_update():
    data = request.json or {}
    files_to_update = data.get("files") or {}
    base_dir = os.path.dirname(os.path.abspath(__file__))
    
    updated_files = []
    try:
        for filename, content in files_to_update.items():
            safe_name = os.path.basename(filename)
            if safe_name in ["app.js", "index.html", "style.css", "server.py"]:
                target_path = os.path.join(base_dir, safe_name)
                # Create .bak backup
                if os.path.exists(target_path):
                    shutil.copy2(target_path, target_path + ".bak")
                with open(target_path, "w", encoding="utf-8") as f:
                    f.write(content)
                updated_files.append(safe_name)
                
        return jsonify({
            "success": True, 
            "message": f"បានអាប់ដេតឯកសារ {len(updated_files)} ដោយជោគជ័យ!",
            "updatedFiles": updated_files
        })
    except Exception as err:
        return jsonify({"success": False, "error": str(err)}), 500


@app.route("/api/upload/template", methods=["POST"])
def upload_template():
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    
    file = request.files["file"]
    if not file.filename:
        return jsonify({"error": "Empty filename"}), 400

    file_bytes = file.read()
    extracted_text = extract_text_from_file_bytes(file.filename, file_bytes)
    
    return jsonify({
        "filename": file.filename,
        "size": len(file_bytes),
        "text": extracted_text
    })


@app.route("/api/upload/lesson", methods=["POST"])
def upload_lesson():
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    
    file = request.files["file"]
    if not file.filename:
        return jsonify({"error": "Empty filename"}), 400

    file_bytes = file.read()
    extracted_text = extract_text_from_file_bytes(file.filename, file_bytes)
    word_count = len(extracted_text.split()) if extracted_text else 0
    
    return jsonify({
        "filename": file.filename,
        "size": len(file_bytes),
        "wordCount": word_count,
        "text": extracted_text
    })


def randomize_question_options(q):
    if not q or not isinstance(q, dict) or "options" not in q:
        return q
    
    opts = q.get("options", {})
    opt_a = opts.get("A", opts.get("ក", ""))
    opt_b = opts.get("B", opts.get("ខ", ""))
    opt_c = opts.get("C", opts.get("គ", ""))
    opt_d = opts.get("D", opts.get("ឃ", ""))
    
    raw_correct = str(q.get("correctAnswer", "A")).strip().upper()
    correct_text = opt_a
    if raw_correct in ["B", "ខ", "2", "២"] or raw_correct == opt_b:
        correct_text = opt_b
    elif raw_correct in ["C", "គ", "3", "៣"] or raw_correct == opt_c:
        correct_text = opt_c
    elif raw_correct in ["D", "ឃ", "4", "៤"] or raw_correct == opt_d:
        correct_text = opt_d
        
    items = [opt_a, opt_b, opt_c, opt_d]
    random.shuffle(items)
    
    keys = ["A", "B", "C", "D"]
    khmer_keys = ["ក", "ខ", "គ", "ឃ"]
    new_correct = "A"
    new_opts = {}
    for idx, item in enumerate(items):
        new_opts[keys[idx]] = item
        new_opts[khmer_keys[idx]] = item
        if item == correct_text:
            new_correct = keys[idx]
            
    q["options"] = new_opts
    q["correctAnswer"] = new_correct
    return q

def randomize_quiz_list(quiz_list):
    if not isinstance(quiz_list, list):
        return quiz_list
    return [randomize_question_options(q) for q in quiz_list]


@app.route("/api/generate", methods=["POST"])
def generate_lesson_plan():
    data = request.json or {}
    api_key = data.get("apiKey") or os.environ.get("GEMINI_API_KEY") or DEFAULT_SYSTEM_GEMINI_KEY

    try:
        if api_key:
            plan = generate_with_gemini_python(api_key, data)
        else:
            plan = synthesize_lesson_plan_python(data)
        
        if isinstance(plan, dict):
            if "preTestQCM" in plan and isinstance(plan["preTestQCM"], list):
                plan["preTestQCM"] = randomize_quiz_list(plan["preTestQCM"])
            if "postTestMCQ" in plan and isinstance(plan["postTestMCQ"], list):
                plan["postTestMCQ"] = randomize_quiz_list(plan["postTestMCQ"])

        return jsonify({"success": True, "data": plan})
    except Exception as e:
        print("Generation error:", e)
        # Fallback to local python synthesizer
        fallback = synthesize_lesson_plan_python(data)
        if isinstance(fallback, dict):
            if "preTestQCM" in fallback and isinstance(fallback["preTestQCM"], list):
                fallback["preTestQCM"] = randomize_quiz_list(fallback["preTestQCM"])
            if "postTestMCQ" in fallback and isinstance(fallback["postTestMCQ"], list):
                fallback["postTestMCQ"] = randomize_quiz_list(fallback["postTestMCQ"])
        return jsonify({"success": True, "data": fallback, "warning": str(e)})


# ==============================================================================
# Commercial License & Protection API Endpoints
# ==============================================================================
LICENSE_FILE = os.path.join(os.path.dirname(__file__), "license.json")
GLOBAL_APP_DIR = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "AI_Lesson_Plan_Studio")
GLOBAL_LICENSE_FILE = os.path.join(GLOBAL_APP_DIR, "license.json")
try:
    os.makedirs(GLOBAL_APP_DIR, exist_ok=True)
except Exception:
    pass

@app.route("/api/license/info", methods=["GET"])
def get_license_info():
    import license_engine
    machine_id = license_engine.get_hardware_uuid()
    trial = license_engine.get_trial_status(machine_id)
    
    is_active = False
    details = {}
    
    # Redundant Persistence: Auto-restore from Global AppData if local is missing after update
    if not os.path.exists(LICENSE_FILE) and os.path.exists(GLOBAL_LICENSE_FILE):
        try:
            shutil.copy2(GLOBAL_LICENSE_FILE, LICENSE_FILE)
        except Exception:
            pass

    # Redundant Persistence: Auto-backup to Global AppData if local exists
    if os.path.exists(LICENSE_FILE) and not os.path.exists(GLOBAL_LICENSE_FILE):
        try:
            shutil.copy2(LICENSE_FILE, GLOBAL_LICENSE_FILE)
        except Exception:
            pass

    active_license_path = LICENSE_FILE if os.path.exists(LICENSE_FILE) else (GLOBAL_LICENSE_FILE if os.path.exists(GLOBAL_LICENSE_FILE) else None)
    
    if active_license_path and os.path.exists(active_license_path):
        try:
            with open(active_license_path, "r", encoding="utf-8") as f:
                saved = json.load(f)
                valid, msg = license_engine.verify_license_key(
                    machine_id=machine_id,
                    license_key=saved.get("licenseKey", ""),
                    licensee_name=saved.get("licensee", "Customer"),
                    license_type=saved.get("type", "LIFETIME"),
                    expiry_timestamp=saved.get("expiryTimestamp", 0)
                )
                if valid:
                    is_active = True
                    details = saved
                    details["statusMsg"] = msg
                else:
                    details["statusMsg"] = msg
        except Exception as e:
            details["error"] = str(e)
            
    return jsonify({
        "machineId": machine_id,
        "isActivated": is_active,
        "trial": trial,
        "details": details
    })


@app.route("/api/license/activate", methods=["POST"])
def activate_license():
    import license_engine
    data = request.json or {}
    machine_id = license_engine.get_hardware_uuid()
    license_key = (data.get("licenseKey") or "").strip().upper()
    licensee = (data.get("licensee") or "Customer").strip()
    license_type = (data.get("type") or "LIFETIME").strip()
    expiry_time = data.get("expiryTimestamp") or 0

    valid, msg = license_engine.verify_license_key(
        machine_id=machine_id,
        license_key=license_key,
        licensee_name=licensee,
        license_type=license_type,
        expiry_timestamp=expiry_time
    )

    if not valid:
        # Check against common institution / generic names
        for default_name in [licensee, "Customer", "Valued Customer", "Teacher", "School", "Department", "នាយកដ្ឋាន", "សាលារៀន", "លោកគ្រូ / អ្នកគ្រូ"]:
            for t in [license_type, "DEPARTMENT", "SCHOOL", "TEACHER", "LIFETIME", "1_YEAR", "2_YEAR"]:
                v, m = license_engine.verify_license_key(machine_id, license_key, default_name, t, expiry_time)
                if v:
                    valid = True
                    licensee = default_name
                    license_type = t
                    msg = m
                    break
            if valid:
                break

    if valid:
        license_record = {
            "licenseKey": license_key,
            "machineId": machine_id,
            "licensee": licensee,
            "type": license_type,
            "expiryTimestamp": expiry_time,
            "activatedAt": datetime.now().isoformat()
        }
        
        # Save to both local directory and permanent Windows LocalAppData
        try:
            with open(LICENSE_FILE, "w", encoding="utf-8") as f:
                json.dump(license_record, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

        try:
            with open(GLOBAL_LICENSE_FILE, "w", encoding="utf-8") as f:
                json.dump(license_record, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

        return jsonify({
            "success": True,
            "message": "🎉 កម្មវិធីត្រូវបាន Activate ជោគជ័យ! សូមរីករាយជាមួយការប្រើប្រាស់។",
            "license": license_record
        })
    else:
        return jsonify({
            "success": False,
            "message": "⚠️ License Key មិនត្រឹមត្រូវសម្រាប់កុំព្យូទ័រនេះទេ! សូមទាក់ទងអ្នកផ្គត់ផ្គង់។"
        }), 400


@app.route("/api/tts/khmer", methods=["GET", "POST"])
def get_khmer_tts():
    if request.method == "POST":
        data = request.json or {}
        text = data.get("text", "")
    else:
        text = request.args.get("text", "")

    text = text.strip()
    if not text:
        return jsonify({"error": "No text provided"}), 400

    try:
        url = "https://translate.google.com/translate_tts?ie=UTF-8&tl=km&client=tw-ob&q=" + urllib.parse.quote(text[:200])
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            audio_data = resp.read()

        return send_file(
            io.BytesIO(audio_data),
            mimetype="audio/mpeg",
            as_attachment=False
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def apply_khmer_os_siemreap_to_all(doc):
    """
    Enforces Khmer OS Siemreap font across all ASCII, HAnsi, EastAsia, 
    and Complex Script (w:cs) XML nodes in Microsoft Word.
    """
    font_name = "Khmer OS Siemreap"
    
    # 1. Normal Style
    try:
        normal = doc.styles["Normal"]
        normal.font.name = font_name
        normal.font.size = Pt(11)
        rPr = normal.element.get_or_add_rPr()
        rFonts = OxmlElement("w:rFonts")
        rFonts.set(qn("w:ascii"), font_name)
        rFonts.set(qn("w:hAnsi"), font_name)
        rFonts.set(qn("w:cs"), font_name)
        rFonts.set(qn("w:eastAsia"), font_name)
        rPr.append(rFonts)
    except Exception:
        pass

    # 2. Body Paragraphs
    for p in doc.paragraphs:
        for r in p.runs:
            r.font.name = font_name
            rPr = r._r.get_or_add_rPr()
            for child in list(rPr):
                if child.tag.endswith("rFonts"):
                    rPr.remove(child)
            rFonts = OxmlElement("w:rFonts")
            rFonts.set(qn("w:ascii"), font_name)
            rFonts.set(qn("w:hAnsi"), font_name)
            rFonts.set(qn("w:cs"), font_name)
            rFonts.set(qn("w:eastAsia"), font_name)
            rPr.append(rFonts)

    # 3. Table Cells
    for tbl in doc.tables:
        for row in tbl.rows:
            for cell in row.cells:
                for p in cell.paragraphs:
                    for r in p.runs:
                        r.font.name = font_name
                        rPr = r._r.get_or_add_rPr()
                        for child in list(rPr):
                            if child.tag.endswith("rFonts"):
                                rPr.remove(child)
                        rFonts = OxmlElement("w:rFonts")
                        rFonts.set(qn("w:ascii"), font_name)
                        rFonts.set(qn("w:hAnsi"), font_name)
                        rFonts.set(qn("w:cs"), font_name)
                        rFonts.set(qn("w:eastAsia"), font_name)
                        rPr.append(rFonts)


def synthesize_video_scenes_with_gemini(api_key, data):
    subject = data.get("subject", "មុខវិជ្ជា")
    grade = data.get("grade", "ថ្នាក់ទី")
    lesson_title = data.get("lessonTitle", "មេរៀន")
    duration = data.get("duration", "៥០ នាទី")
    lesson_content = data.get("lessonContent", "")
    objectives = data.get("objectives", {})
    key_takeaways = data.get("keyTakeaways", [])

    system_prompt = f"""You are an elite Educational Video Producer, MoEYS Pedagogical Coach, and Scriptwriter for វីដេអូបង្រៀនs in Cambodia.
Generate a structured, in-depth **10-SCENE Micro-Lecture Educational Video Script (5 to 8 minutes total)** in 100% fluent, engaging, and professional pedagogical Khmer for:
- Lesson Title: «{lesson_title}»
- Subject & Grade: {subject} {grade}
- Duration: {duration}
- Reference Material / Summary: {lesson_content[:3000]}
- Objectives: {json.dumps(objectives, ensure_ascii=False)}

CRITICAL DURATION & NARRATION LENGTH REQUIREMENT (៥ ទៅ ៦ នាទី យ៉ាងតិច):
- The entire video micro-lecture across all 10 scenes MUST have a total speaking time of at least 5 to 6 minutes.
- For EVERY scene, the "narration" property MUST be rich, extensive, and comprehensive (at least 5 to 8 full sentences in pedagogical Khmer, approximately 70 to 100 words per scene).
- It must provide deep teacher explanations, step-by-step logic, real-world examples, and actionable guidance so each scene speaks naturally for 30 to 45 seconds.
- Do NOT provide short 1-2 sentence summaries; write full, immersive, spoken Khmer teacher explanations.

MANDATORY 10 SCENES STRUCTURE (100% Khmer, Font: Kantumruy Pro compatible):
1. Scene 1 (0:00 - 0:45): 🎯 សេចក្តីផ្តើម & គោលបំណង (Engaging hook question, real-world puzzle, 2-3 clear lesson objectives)
2. Scene 2 (0:45 - 1:30): 🔬 ទ្រឹស្តីស្នូល & និយមន័យគ្រឹះ (Core theory & foundational definitions)
3. Scene 3 (1:30 - 2:15): 📖 ការបកស្រាយនិយមន័យ & យន្តការ (Deep explanation of definitions & scientific mechanisms)
4. Scene 4 (2:15 - 3:00): 📐 បង្ហាញលម្អិតទ្រឹស្តី & រូបមន្តគន្លឹះ (Detailed breakdown of principles, formulas & laws)
5. Scene 5 (3:00 - 3:45): 🧠 ការពន្យល់ស៊ីជម្រៅ & ការផ្សារភ្ជាប់ (Deep conceptual connections, analogies & logic)
6. Scene 6 (3:45 - 4:30): 📌 ចំណុចសំខាន់ៗបន្ថែមក្នុងមេរៀន (Essential additional concepts & key takeaways)
7. Scene 7 (4:30 - 5:15): ⚡ ការវិភាគបាតុភូត & ដំណើរការ (Phenomena analysis & step-by-step process breakdown)
8. Scene 8 (5:15 - 6:00): ⚠️ គន្លឹះចងចាំ & ចំណុចងាយយល់ច្រឡំ (Memory tips, common pitfalls & misconceptions to avoid)
9. Scene 9 (6:00 - 7:00): 💡 ឧទាហរណ៍ជាក់ស្តែង & ការអនុវត្តដោះស្រាយ (Worked practical examples & problem-solving walkthrough)
10. Scene 10 (7:00 - 8:00): 📝 សង្ខេបមេរៀន & ការត្រៀម Pre-Test (Synthesis, Flipped Learning in-class prep & 10-Question Pre-Test QCM Call-to-Action via Google Form)

Return ONLY a valid JSON array of exactly 10 scene objects. Every object MUST have these properties:
- "id": integer 1 to 10
- "name": string (e.g. "ឈុតទី ១: សេចក្តីផ្តើម & គោលបំណង")
- "timeRange": string (e.g. "0:00 - 0:45")
- "badge": string (e.g. "🎯 សេចក្តីផ្តើម")
- "title": string (short punchy slide title in Khmer)
- "subtitle": string (subheading in Khmer)
- "bullets": array of exactly 3 strings (crisp Khmer bullet points for slide)
- "narration": string (long, extensive, in-depth spoken Khmer explanation with 70-100 words for ~35 seconds speech)
- "colorTheme": string (hex color, e.g. "#0284c7")
"""

    payload = {
        "contents": [
            {
                "parts": [
                    {"text": system_prompt}
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.4,
            "responseMimeType": "application/json"
        }
    }

    candidate_endpoints = [
        f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key={api_key}",
        f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key={api_key}",
        f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent?key={api_key}",
        f"https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key={api_key}",
        f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
    ]

    last_error = None
    for endpoint in candidate_endpoints:
        try:
            req = urllib.request.Request(
                endpoint,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=60) as response:
                res_data = json.loads(response.read().decode("utf-8"))
                text_content = res_data["candidates"][0]["content"]["parts"][0]["text"]
                
                # Robust parsing
                clean = text_content.strip()
                if clean.startswith("```"):
                    clean = clean.split("\n", 1)[1].rsplit("\n", 1)[0]
                first_b = clean.find("[")
                last_b = clean.rfind("]")
                if first_b != -1 and last_b != -1:
                    clean = clean[first_b:last_b+1]
                parsed = json.loads(clean)
                if isinstance(parsed, list) and len(parsed) >= 5:
                    return parsed
                elif isinstance(parsed, dict) and "scenes" in parsed:
                    return parsed["scenes"]
        except Exception as e:
            last_error = str(e)
            continue

    raise Exception(f"Failed to generate 10-scene video script via Gemini: {last_error}")


@app.route("/api/ai/video-script", methods=["POST"])
def generate_ai_video_script_route():
    data = request.json or {}
    api_key = data.get("apiKey") or os.environ.get("GEMINI_API_KEY") or DEFAULT_SYSTEM_GEMINI_KEY
    
    if not api_key:
        return jsonify({"error": "No Gemini API Key provided"}), 400

    try:
        scenes = synthesize_video_scenes_with_gemini(api_key, data)
        return jsonify({"success": True, "scenes": scenes})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
import tempfile
try:
    TTS_CACHE_DIR = os.path.join(BASE_DIR, "scratch", "tts_cache")
    os.makedirs(TTS_CACHE_DIR, exist_ok=True)
except Exception:
    TTS_CACHE_DIR = os.path.join(tempfile.gettempdir(), "alps_tts_cache")
    try:
        os.makedirs(TTS_CACHE_DIR, exist_ok=True)
    except Exception:
        pass

async def generate_edge_tts_bytes(text, voice="km-KH-PisethNeural", rate="+12%", pitch="+0Hz"):
    import edge_tts
    communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
    audio_bytes = bytearray()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio_bytes.extend(chunk["data"])
    return bytes(audio_bytes)

@app.route("/api/tts/khmer", methods=["GET", "POST"])
def tts_khmer_route():
    text = ""
    voice_key = "piseth"
    rate_val = "+12%"
    pitch_val = "+0Hz"
    
    if request.method == "POST":
        data = request.json or {}
        text = data.get("text", "")
        voice_key = data.get("voice", "piseth")
        rate_val = data.get("rate", "+12%")
        pitch_val = data.get("pitch", "+0Hz")
    else:
        text = request.args.get("text", "")
        voice_key = request.args.get("voice", "piseth")
        rate_val = request.args.get("rate", "+12%")
        pitch_val = request.args.get("pitch", "+0Hz")
    
    text = text.strip()
    if not text:
        return jsonify({"error": "No text provided"}), 400

    # Determine neural voice & pitch character mapping
    voice_key_str = str(voice_key).lower().strip()
    voice_name = "km-KH-PisethNeural"
    
    if voice_key_str in ["sreymom", "female", "female_teacher"]:
        voice_name = "km-KH-SreymomNeural"
        if pitch_val == "+0Hz":
            pitch_val = "+0Hz"
    elif voice_key_str in ["storyteller", "expressive_storyteller"]:
        voice_name = "km-KH-SreymomNeural"
        if pitch_val == "+0Hz":
            pitch_val = "-4Hz"
        if rate_val == "+12%":
            rate_val = "+2%"
    elif voice_key_str in ["young_student", "student"]:
        voice_name = "km-KH-PisethNeural"
        if pitch_val == "+0Hz":
            pitch_val = "+26Hz"
        if rate_val == "+12%":
            rate_val = "+16%"
    elif voice_key_str in ["elder_scholar", "scholar", "elder"]:
        voice_name = "km-KH-PisethNeural"
        if pitch_val == "+0Hz":
            pitch_val = "-16Hz"
        if rate_val == "+12%":
            rate_val = "-6%"
    elif voice_key_str in ["commercial_pro", "broadcaster"]:
        voice_name = "km-KH-PisethNeural"
        if pitch_val == "+0Hz":
            pitch_val = "+6Hz"
        if rate_val == "+12%":
            rate_val = "+18%"
    elif "sreymom" in voice_key_str or "ស្រីមុំ" in str(voice_key):
        voice_name = "km-KH-SreymomNeural"
    elif "piseth" in voice_key_str or "ពិសិដ្ឋ" in str(voice_key):
        voice_name = "km-KH-PisethNeural"

    # MD5 Caching for instant sub-millisecond response
    cache_key = hashlib.md5(f"{voice_name}_{rate_val}_{pitch_val}_{text}".encode("utf-8")).hexdigest()
    cache_path = os.path.join(TTS_CACHE_DIR, f"{cache_key}.mp3")
    if os.path.exists(cache_path) and os.path.getsize(cache_path) > 1000:
        with open(cache_path, "rb") as f:
            audio_data = f.read()
        response = Response(audio_data, mimetype="audio/mpeg")
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Cache-Control"] = "public, max-age=86400"
        return response

    try:
        # High quality Edge Neural TTS (Piseth & Sreymom with dynamic pitch/rate profiles)
        audio_data = asyncio.run(generate_edge_tts_bytes(text, voice_name, rate=rate_val, pitch=pitch_val))
        if audio_data and len(audio_data) > 500:
            try:
                with open(cache_path, "wb") as f:
                    f.write(audio_data)
            except Exception:
                pass
            response = Response(audio_data, mimetype="audio/mpeg")
            response.headers["Access-Control-Allow-Origin"] = "*"
            response.headers["Cache-Control"] = "public, max-age=86400"
            return response
    except Exception as edge_err:
        print("[Edge TTS Notice, falling back to Google TTS]", edge_err)

    # Fallback to Google TTS if needed
    try:
        chunks = []
        current = ""
        sentences = re.split(r'([។\n!?]+)', text)
        for part in sentences:
            if not part:
                continue
            if len(current) + len(part) < 140:
                current += part
            else:
                if current.strip():
                    chunks.append(current.strip())
                current = part
        if current.strip():
            chunks.append(current.strip())
        
        if not chunks:
            chunks = [text[:140]]

        all_bytes = bytearray()
        for chunk in chunks:
            if not chunk.strip():
                continue
            url = "https://translate.google.com/translate_tts?ie=UTF-8&tl=km&client=tw-ob&q=" + urllib.parse.quote(chunk)
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
            with urllib.request.urlopen(req, timeout=12) as resp:
                all_bytes.extend(resp.read())

        audio_data = bytes(all_bytes)
        if audio_data:
            try:
                with open(cache_path, "wb") as f:
                    f.write(audio_data)
            except Exception:
                pass
        response = Response(audio_data, mimetype="audio/mpeg")
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Cache-Control"] = "public, max-age=86400"
        return response
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/export/docx", methods=["POST"])
def export_docx():
    data = request.json or {}
    if not data:
        return jsonify({"error": "No lesson plan data provided"}), 400

    doc = Document()
    
    # Page setup (margins 0.6 inch)
    for section in doc.sections:
        section.top_margin = Inches(0.6)
        section.bottom_margin = Inches(0.6)
        section.left_margin = Inches(0.6)
        section.right_margin = Inches(0.6)

    # National Motto
    p_motto1 = doc.add_paragraph()
    p_motto1.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r1 = p_motto1.add_run("ព្រះរាជាណាចក្រកម្ពុជា")
    r1.bold = True
    r1.font.size = Pt(14)

    p_motto2 = doc.add_paragraph()
    p_motto2.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r2 = p_motto2.add_run("ជាតិ សាសនា ព្រះមហាក្សត្រ\n***")
    r2.bold = True
    r2.font.size = Pt(12)

    is_flipped = is_flipped_learning_request(data) or data.get("templateType") == "flipped_learning"
    is_bd = not is_flipped and (is_backward_design_request(data) or data.get("templateType") == "backward_design" or bool(data.get("stage1")))

    if not is_flipped:
        # Meta Table (School, Teacher, Subject, Date)
        meta_table = doc.add_table(rows=2, cols=2)
        meta_table.alignment = WD_TABLE_ALIGNMENT.CENTER
        meta_table.autofit = True
        
        # Row 0
        c00 = meta_table.cell(0, 0)
        c00.text = f"គ្រឹះស្ថានសិក្សា៖ {data.get('school', '')}\nគ្រូបង្រៀន៖ {data.get('teacher', '')}"
        
        c01 = meta_table.cell(0, 1)
        p01 = c01.paragraphs[0]
        p01.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        p01.text = f"{data.get('dateStr', '')}\nរយៈពេល៖ {data.get('duration', '')}"

        # Row 1
        c10 = meta_table.cell(1, 0)
        c10.text = f"មុខវិជ្ជា៖ {data.get('subject', '')} | កម្រិត៖ {data.get('grade', '')}"
        
        doc.add_paragraph()

        # Main Title
        p_title = doc.add_paragraph()
        p_title.alignment = WD_ALIGN_PARAGRAPH.CENTER
        title_text = data.get("templateTitle") or ("កិច្ចតែងការបង្រៀន (តាមបែបត្រឡប់ - Backward Design / UbD)" if is_bd else "កិច្ចតែងការបង្រៀន")
        r_title = p_title.add_run(title_text)
        r_title.bold = True
        r_title.underline = True
        r_title.font.size = Pt(15)

        if data.get("chapter"):
            p_ch = doc.add_paragraph()
            p_ch.alignment = WD_ALIGN_PARAGRAPH.CENTER
            r_ch = p_ch.add_run(f"« {data.get('chapter')} »")
            r_ch.bold = True
            r_ch.font.size = Pt(12)

        p_les = doc.add_paragraph()
        p_les.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r_les = p_les.add_run(f"{data.get('lessonTitle', '')}")
        r_les.bold = True
        r_les.font.size = Pt(13)

    # Pre-Test QCM Builder
    def _add_docx_pretest():
        qcm_list = data.get("preTestQCM") or data.get("preTest") or generate_pretest_qcm_python(data.get("subject", ""), data.get("grade", ""), data.get("lessonTitle", ""), data.get("mainPoints", []))
        p_qcm_h = doc.add_paragraph()
        r_qcm_h = p_qcm_h.add_run("វិញ្ញាសាស្ទង់សមត្ថភាពមុនម៉ោង (Pre-Test QCM ៥ សំណួរ)")
        r_qcm_h.bold = True
        r_qcm_h.font.size = Pt(12)

        p_form = doc.add_paragraph()
        p_form.add_run("វិញ្ញាសាស្ទង់សមត្ថភាពចំណេះដឹងគន្លឹះ និងគោលគំនិតបុរេលក្ខខណ្ឌ").italic = True

        answer_keys = []
        for idx, q in enumerate(qcm_list):
            q_num = q.get("number", idx + 1)
            opts = q.get("options", {})
            answer_keys.append(f"ស.{q_num}: {q.get('correctAnswer', 'A')}")

            p_q = doc.add_paragraph()
            p_q.add_run(f"សំណួរទី {q_num} : ").bold = True
            p_q.add_run(q.get("question", ""))

            doc.add_paragraph(f"    ក. {opts.get('A', opts.get('ក', ''))}        ខ. {opts.get('B', opts.get('ខ', ''))}")
            doc.add_paragraph(f"    គ. {opts.get('C', opts.get('គ', ''))}        ឃ. {opts.get('D', opts.get('ឃ', ''))}")
            if q.get("explanation"):
                p_exp = doc.add_paragraph(f"    💡 ពន្យល់៖ {q.get('explanation')}")
                p_exp.italic = True

        p_ans = doc.add_paragraph()
        p_ans.add_run(f"🔑 បន្ទះចម្លើយត្រឹមត្រូវ (Pre-Test Answer Keys)៖ {' | '.join(answer_keys)}").bold = True
        doc.add_paragraph()

    # Post-Test MCQ Builder
    def _add_docx_posttest():
        post_test_list = data.get("postTestMCQ") or data.get("postTest") or generate_posttest_mcq_python(data.get("subject", ""), data.get("grade", ""), data.get("lessonTitle", ""), data.get("mainPoints", []))
        p_post_h = doc.add_paragraph()
        p_post_h.add_run("វិញ្ញាសាវាយតម្លៃបញ្ចប់ Post-Test (MCQ ៥ សំណួរ)").bold = True
        p_post_h.runs[0].font.size = Pt(12)

        p_post_form = doc.add_paragraph()
        p_post_form.add_run("វិញ្ញាសាវាយតម្លៃកម្រិតវាស់ស្ទង់សមត្ថភាពក្រោយរៀន (Post-Test Learning Assessment)").italic = True

        post_answer_keys = []
        for idx, q in enumerate(post_test_list):
            q_num = q.get("number", idx + 1)
            opts = q.get("options", {})
            post_answer_keys.append(f"ស.{q_num}: {q.get('correctAnswer', 'A')}")

            p_q = doc.add_paragraph()
            p_q.add_run(f"សំណួរទី {q_num} : ").bold = True
            p_q.add_run(q.get("question", ""))

            doc.add_paragraph(f"    ក. {opts.get('A', opts.get('ក', ''))}        ខ. {opts.get('B', opts.get('ខ', ''))}")
            doc.add_paragraph(f"    គ. {opts.get('C', opts.get('គ', ''))}        ឃ. {opts.get('D', opts.get('ឃ', ''))}")
            if q.get("explanation"):
                p_exp = doc.add_paragraph(f"    💡 ពន្យល់៖ {q.get('explanation')}")
                p_exp.italic = True

        p_post_ans = doc.add_paragraph()
        p_post_ans.add_run(f"🔑 បន្ទះចម្លើយត្រឹមត្រូវ Post-Test (Answer Keys)៖ {' | '.join(post_answer_keys)}").bold = True
        doc.add_paragraph()

    if is_flipped:
        steps = data.get("steps", [])
        objectives = data.get("objectives", {})

        # Main Title
        p_title = doc.add_paragraph()
        p_title.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r_title = p_title.add_run("កិច្ចតែងការបង្រៀនតាមបែបត្រឡប់")
        r_title.bold = True
        r_title.underline = True
        r_title.font.size = Pt(15)

        # Higher-Ed Metadata Table
        meta_table = doc.add_table(rows=1, cols=2)
        meta_table.alignment = WD_TABLE_ALIGNMENT.CENTER
        c0 = meta_table.cell(0, 0)
        c0.text = f"មុខវិជ្ជា៖ {data.get('subject', 'ចិត្តវិទ្យាអប់រំ')}\nចំនួនក្រេឌីត៖ {data.get('credits', '៣ ក្រេឌីត (៣-០-៦)')}\nឆ្នាំទី៖ {data.get('year', '១')}   ឆមាសទី៖ {data.get('semester', '២')}\nសប្តាហ៍ទី៖ {data.get('week', '១')}   មេរៀនទី៖ {data.get('lessonNumber', '១')}"
        c1 = meta_table.cell(0, 1)
        c1.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.RIGHT
        c1.text = f"រយៈពេល៖ {data.get('duration', '១៨០ នាទី')}\nគ្រូឧទ្ទេស៖ {data.get('teacher', 'កែម បូរី')}\n{data.get('dateStr', '')}"
        doc.add_paragraph()

        # Lesson Title
        p_les = doc.add_paragraph()
        r_les = p_les.add_run(f"ចំណងជើងមេរៀន៖ {data.get('lessonTitle', '')}")
        r_les.bold = True
        r_les.font.size = Pt(13)
        doc.add_paragraph()

        # Section 1: Objectives
        p_obj_h = doc.add_paragraph()
        r_obj_h = p_obj_h.add_run("១. វត្ថុបំណង")
        r_obj_h.bold = True
        r_obj_h.font.size = Pt(12)
        doc.add_paragraph("បន្ទាប់ពីរៀនមេរៀននេះចប់ គរុនិស្សិតនឹង៖").italic = True

        doc.add_paragraph().add_run("• វិជ្ជាសម្បទា៖").bold = True
        for k in objectives.get("knowledge", []):
            doc.add_paragraph(f"  • {k}")

        doc.add_paragraph().add_run("• បំណិនសម្បទា៖").bold = True
        for s in objectives.get("skills", []):
            doc.add_paragraph(f"  • {s}")

        doc.add_paragraph().add_run("• ចរិយាសម្បទា៖").bold = True
        for a in objectives.get("attitudes", []):
            doc.add_paragraph(f"  • {a}")
        doc.add_paragraph()

        # Section 2: Materials
        p_mat_h = doc.add_paragraph()
        p_mat_h.add_run("២. សម្ភារឧបទេស").bold = True
        p_mat_h.runs[0].font.size = Pt(12)
        doc.add_paragraph("កិច្ចតែងការបង្រៀន វីដេអូបង្រៀន បុរេតេស្ត តេស្តបញ្ចប់ និងកិច្ចការផ្ទះ")
        mats = data.get("materials", {})
        doc.add_paragraph(f"• សម្រាប់គ្រូ៖ {', '.join(mats.get('teacher', []))}")
        doc.add_paragraph(f"• សម្រាប់និស្សិត៖ {', '.join(mats.get('student', []))}")
        doc.add_paragraph()

        # Section 3: Method
        p_mth_h = doc.add_paragraph()
        p_mth_h.add_run("៣. វិធីសាស្រ្ដបង្រៀន").bold = True
        p_mth_h.runs[0].font.size = Pt(12)
        doc.add_paragraph("     - ការរៀនបែបត្រឡប់")
        doc.add_paragraph()

        # Section 4: In-Class Process (3 Columns)
        p_proc_h = doc.add_paragraph()
        p_proc_h.add_run(f"៤. ដំណើរការបង្រៀន ({data.get('duration', '១៨០ នាទី')})").bold = True
        p_proc_h.runs[0].font.size = Pt(12)

        # 3-column table
        step_table = doc.add_table(rows=1 + (len(steps) * 2), cols=3)
        step_table.alignment = WD_TABLE_ALIGNMENT.CENTER
        step_table.style = 'Table Grid'
        headers = ["សកម្មភាពគ្រូ", "ខ្លឹមសារ", "សកម្មភាពសិស្ស"]
        for hi, htext in enumerate(headers):
            cell = step_table.cell(0, hi)
            cell.text = htext
            cell.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
            cell.paragraphs[0].runs[0].bold = True

        current_row = 1
        for step in steps:
            # Merged Header Row across 3 cols
            header_cell = step_table.cell(current_row, 0)
            c_merge = header_cell.merge(step_table.cell(current_row, 2))
            c_merge.text = f"{step.get('stepTitle', '')} ({step.get('duration', '')})"
            c_merge.paragraphs[0].runs[0].bold = True

            # Content Row (3 cells)
            content_row = current_row + 1
            step_table.cell(content_row, 0).text = step.get("teacherActivity", "")
            c_cnt = step_table.cell(content_row, 1)
            c_cnt.text = step.get("contentSummary", "")
            if c_cnt.paragraphs[0].runs:
                c_cnt.paragraphs[0].runs[0].bold = True
            step_table.cell(content_row, 2).text = step.get("studentActivity", "")

            current_row += 2

        doc.add_paragraph()

        if data.get("preTestQCM"):
            _add_docx_pretest()
        if data.get("postTestMCQ"):
            _add_docx_posttest()

        # Signatures
        sig_table = doc.add_table(rows=1, cols=2)
        sig_table.alignment = WD_TABLE_ALIGNMENT.CENTER
        sc0 = sig_table.cell(0, 0)
        sc0.text = "បានឃើញ និងឯកភាព\nប្រធានដេប៉ាតឺម៉ង់ / គណៈគ្រប់គ្រង\n\n\n"
        sc0.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
        sc1 = sig_table.cell(0, 1)
        sc1.text = f"{data.get('dateStr', '')}\nហត្ថលេខាគ្រូឧទ្ទេស\n\n\n{data.get('teacher', 'កែម បូរី')}"
        sc1.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
        doc.add_paragraph()

        # Footnote License
        p_foot = doc.add_paragraph()
        r_foot = p_foot.add_run("* អាជ្ញាបណ្ណ និងកម្មសិទ្ធិ (License)： ខ្ញុំឈ្មោះកែម បូរី ជាគ្រូឧទ្ទេសមុខវិជ្ជាចិត្តវិទ្យាអប់រំ នៅវិទ្យាស្ថានគរុកោសល្យកំពង់ចាម")
        r_foot.italic = True
        r_foot.font.size = Pt(9.5)

    

    elif is_bd:
        stage1 = data.get("stage1", {})
        stage2 = data.get("stage2", {})
        stage3 = data.get("stage3", {})
        activities = stage3.get("learningActivities") or data.get("steps", [])

        # Stage 1
        p_s1 = doc.add_paragraph()
        p_s1.add_run("I. ដំណាក់កាលទី ១ : ការកំណត់លទ្ធផលរំពឹងទុក (Stage 1: Desired Results)").bold = True
        p_s1.runs[0].font.size = Pt(12)
        if stage1.get("establishedGoals"):
            doc.add_paragraph(f"១. គោលបំណងចម្បង៖ {stage1.get('establishedGoals')}")
        
        doc.add_paragraph().add_run("២. ការយល់ដឹងស្នូល & សំណួរគន្លឹះ៖").bold = True
        for u in stage1.get("enduringUnderstandings", []):
            doc.add_paragraph(f"  • {u}")
        for q in stage1.get("essentialQuestions", []):
            doc.add_paragraph(f"  • {q}")

        # Stage 2
        p_s2 = doc.add_paragraph()
        p_s2.add_run("II. ដំណាក់កាលទី ២ : ការកំណត់ភស្តុតាងនៃការវាយតម្លៃ (Stage 2: Assessment Evidence)").bold = True
        p_s2.runs[0].font.size = Pt(12)
        for pt in stage2.get("performanceTasks", []):
            doc.add_paragraph(f"  • {pt}")

        # Stage 3
        p_s3 = doc.add_paragraph()
        p_s3.add_run("III. ដំណាក់កាលទី ៣ : ផែនការរៀបចំការបង្រៀន និងរៀន (Stage 3: Learning Plan)").bold = True
        p_s3.runs[0].font.size = Pt(12)
        mats = stage3.get("materials") or data.get("materials", {})
        doc.add_paragraph(f"• សម្ភារឧបទេស៖ គ្រូ៖ {', '.join(mats.get('teacher', []))} | សិស្ស៖ {', '.join(mats.get('student', []))}")

        # Table
        step_table = doc.add_table(rows=1 + len(activities), cols=4)
        step_table.alignment = WD_TABLE_ALIGNMENT.CENTER
        step_table.style = 'Table Grid'
        headers = ["ដំណាក់កាល/ពេល", "សកម្មភាពគ្រូ", "ខ្លឹមសារមេរៀន", "សកម្មភាពសិស្ស"]
        for hi, htext in enumerate(headers):
            cell = step_table.cell(0, hi)
            cell.text = htext
            cell.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
            cell.paragraphs[0].runs[0].bold = True

        for row_idx, step in enumerate(activities, start=1):
            c0 = step_table.cell(row_idx, 0)
            c0.text = f"{step.get('stepTitle', '')}\n({step.get('duration', '')})"
            c0.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
            c0.paragraphs[0].runs[0].bold = True

            c1 = step_table.cell(row_idx, 1)
            c1.text = step.get("teacherActivity", "")

            c2 = step_table.cell(row_idx, 2)
            c2.text = step.get("contentSummary", "")
            if c2.paragraphs[0].runs:
                c2.paragraphs[0].runs[0].bold = True

            c3 = step_table.cell(row_idx, 3)
            c3.text = step.get("studentActivity", "")

        doc.add_paragraph()
        # Post-Test
        _add_docx_posttest()

    else:
        # Standard 5-Step & Flipped
        steps = data.get("steps", [])
        objectives = data.get("objectives", {})

        # Section I: Objectives
        p_obj_h = doc.add_paragraph()
        r_obj_h = p_obj_h.add_run("I. វត្ថុបំណង (Objectives)")
        r_obj_h.bold = True
        r_obj_h.font.size = Pt(12)

        doc.add_paragraph().add_run("១. វិជ្ជាសម្បទា (ចំណេះដឹង)៖").bold = True
        for k in objectives.get("knowledge", []):
            doc.add_paragraph(f"  • {k}")

        doc.add_paragraph().add_run("២. បំណិនសម្បទា (បំណិន)៖").bold = True
        for s in objectives.get("skills", []):
            doc.add_paragraph(f"  • {s}")

        doc.add_paragraph().add_run("៣. ចរិយាសម្បទា (ឥរិយាបថ)៖").bold = True
        for a in objectives.get("attitudes", []):
            doc.add_paragraph(f"  • {a}")

        # Section II: Materials
        p_mat_h = doc.add_paragraph()
        p_mat_h.add_run("II. សម្ភារឧបទេស (Materials)").bold = True
        mats = data.get("materials", {})
        doc.add_paragraph(f"• សម្រាប់គ្រូ៖ {', '.join(mats.get('teacher', []))}")
        doc.add_paragraph(f"• សម្រាប់សិស្ស៖ {', '.join(mats.get('student', []))}")

        # In-Class Process Table
        p_steps_h = doc.add_paragraph()
        p_steps_h.add_run("IV. ដំណើរការបង្រៀន និងរៀនក្នុងថ្នាក់ (Teaching Process)").bold = True
        p_steps_h.runs[0].font.size = Pt(12)

        step_table = doc.add_table(rows=1 + len(steps), cols=4)
        step_table.alignment = WD_TABLE_ALIGNMENT.CENTER
        step_table.style = 'Table Grid'
        headers = ["ជំហាន/ពេល", "សកម្មភាពគ្រូ", "ខ្លឹមសារមេរៀន", "សកម្មភាពសិស្ស"]
        for hi, htext in enumerate(headers):
            cell = step_table.cell(0, hi)
            cell.text = htext
            cell.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
            cell.paragraphs[0].runs[0].bold = True

        for row_idx, step in enumerate(steps, start=1):
            c0 = step_table.cell(row_idx, 0)
            c0.text = f"{step.get('stepTitle', '')}\n({step.get('duration', '')})"
            c0.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
            c0.paragraphs[0].runs[0].bold = True

            c1 = step_table.cell(row_idx, 1)
            c1.text = step.get("teacherActivity", "")

            c2 = step_table.cell(row_idx, 2)
            c2.text = step.get("contentSummary", "")
            if c2.paragraphs[0].runs:
                c2.paragraphs[0].runs[0].bold = True

            c3 = step_table.cell(row_idx, 3)
            c3.text = step.get("studentActivity", "")

        doc.add_paragraph()
        if data.get("preTestQCM"):
            _add_docx_pretest()
        if data.get("postTestMCQ"):
            _add_docx_posttest()

    if not is_flipped:
        # Signatures Table
        sig_table = doc.add_table(rows=1, cols=2)
        sig_table.alignment = WD_TABLE_ALIGNMENT.CENTER

        sig_left = sig_table.cell(0, 0)
        p_sl = sig_left.paragraphs[0]
        p_sl.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p_sl.add_run("បានឃើញ និងឯកភាព\nនាយក/នាយិកាវិទ្យាស្ថាន / សាលា\n\n\n\n\n").bold = True

        sig_right = sig_table.cell(0, 1)
        p_sr = sig_right.paragraphs[0]
        p_sr.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p_sr.add_run(f"{data.get('dateStr', '')}\nហត្ថលេខាគ្រូបង្រៀន\n\n\n\n\n{data.get('teacher', '')}").bold = True

    # Enforce 100% Khmer OS Siemreap Font across all Word elements
    apply_khmer_os_siemreap_to_all(doc)

    # Save to memory stream
    output_stream = io.BytesIO()
    doc.save(output_stream)
    output_stream.seek(0)

    filename = f"LessonPlan_{data.get('subject', 'Lesson')}_{data.get('grade', '')}.docx"
    return send_file(
        output_stream,
        as_attachment=True,
        download_name=filename,
        mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )


# Vercel Serverless Dispatcher
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


if __name__ == "__main__":
    @app.route("/<path:filename>", methods=["GET"])
    def serve_static_files(filename):
        resp = send_from_directory(".", filename)
        resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        resp.headers["Pragma"] = "no-cache"
        resp.headers["Expires"] = "0"
        return resp

    port = int(os.environ.get("PORT", 8765))
    print(f"🚀 AI Lesson Plan Studio running on http://127.0.0.1:{port}")
    
    # Auto-open browser in 0.8s
    def _open_ui():
        time_to_wait = 0.8
        try:
            import time
            time.sleep(time_to_wait)
            webbrowser.open(f"http://127.0.0.1:{port}")
        except Exception:
            pass

    threading.Thread(target=_open_ui, daemon=True).start()
    app.run(host="0.0.0.0", port=port, debug=False)
