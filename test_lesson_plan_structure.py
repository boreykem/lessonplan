"""
Comprehensive test script for verifying that all lesson plan templates adhere to:
- Only: Lesson Plan, Pre-test (5 questions), Post-test (5 questions), Signatures.
- Removed: ឯកសារយោង និង ឧបសម្ព័ន្ធ, 4b, 4c, VI, VII, and Self-Reflection.
"""
import requests
import json
import io
import docx

BASE_URL = "http://127.0.0.1:8765"

def test_api_health():
    res = requests.get(f"{BASE_URL}/api/health")
    assert res.status_code == 200, f"Health check failed: {res.status_code}"
    print("✅ PASS: /api/health is 200 OK")

def test_synthesizer_all_templates():
    templates = [
        {"id": "moeys_standard_5step", "type": "5_steps", "name": "Standard 5-Step"},
        {"id": "flipped_learning_5step", "type": "flipped_learning", "name": "Flipped Learning"},
        {"id": "backward_design_ubd", "type": "backward_design", "name": "Backward Design (UbD)"},
        {"id": "moeys_primary", "type": "5_steps", "name": "Primary School"},
        {"id": "moeys_stem_inquiry", "type": "5_steps", "name": "STEM / 5E"}
    ]

    for tmpl in templates:
        payload = {
            "templatePresetId": tmpl["id"],
            "templateType": tmpl["type"],
            "subject": "រូបវិទ្យា",
            "grade": "ថ្នាក់ទី ៨",
            "duration": "៥០ នាទី (១ ម៉ោងសិក្សា)",
            "lessonTitle": "ច្បាប់រក្សាថាមពល",
            "school": "វិទ្យាល័យ ហ៊ុន សែន",
            "teacher": "សុខ សាន",
            "lessonContent": "ថាមពលមេកានិច ច្បាប់រក្សាថាមពល ស៊ីនេទិច និងប៉ូតង់ស្យែល"
        }
        res = requests.post(f"{BASE_URL}/api/generate", json=payload)
        assert res.status_code == 200, f"Failed for {tmpl['name']}: {res.text}"
        data = res.json().get("data", {})

        # Verify Pre-Test QCM
        pre_test = data.get("preTestQCM")
        assert pre_test and len(pre_test) == 5, f"Expected 5 Pre-Test questions for {tmpl['name']}, got {len(pre_test) if pre_test else 0}"
        
        # Verify Post-Test MCQ
        post_test = data.get("postTestMCQ")
        assert post_test and len(post_test) == 5, f"Expected 5 Post-Test questions for {tmpl['name']}, got {len(post_test) if post_test else 0}"

        # Verify Lesson Plan Steps / Activities
        steps = data.get("steps") or (data.get("stage3", {}).get("learningActivities"))
        assert steps and len(steps) >= 3, f"Expected steps for {tmpl['name']}, got {len(steps) if steps else 0}"

        # Verify Strictly Removed Sections
        assert "notebooklmGuide" not in data, f"notebooklmGuide found in {tmpl['name']}"
        assert "preClassPhase" not in data, f"preClassPhase found in {tmpl['name']}"
        assert "differentiatedPlan" not in data, f"differentiatedPlan (4b) found in {tmpl['name']}"
        assert "activeRubric" not in data, f"activeRubric (4c) found in {tmpl['name']}"
        assert "exitTicket321" not in data, f"exitTicket321 (VI) found in {tmpl['name']}"
        assert "postClassPhase" not in data, f"postClassPhase (VII) found in {tmpl['name']}"
        assert "selfEvaluation" not in data, f"selfEvaluation found in {tmpl['name']}"

        print(f"✅ PASS: Template [{tmpl['name']}] contains ONLY Lesson Plan, Pre-Test (5 questions), Post-Test (5 questions)!")

        # Test DOCX Export endpoint
        export_res = requests.post(f"{BASE_URL}/api/export/docx", json=data)
        assert export_res.status_code == 200, f"Docx export failed for {tmpl['name']}: {export_res.status_code}"
        
        # Verify generated Word doc content
        doc = docx.Document(io.BytesIO(export_res.content))
        full_text = "\n".join([p.text for p in doc.paragraphs])
        
        assert "វិញ្ញាសាស្ទង់សមត្ថភាពមុនម៉ោង" in full_text, f"Pre-Test missing in docx for {tmpl['name']}"
        assert "វិញ្ញាសាវាយតម្លៃបញ្ចប់ Post-Test" in full_text, f"Post-Test missing in docx for {tmpl['name']}"
        assert "Google NotebookLM" not in full_text, f"NotebookLM found in docx for {tmpl['name']}"
        assert "IV.B" not in full_text, f"IV.B found in docx for {tmpl['name']}"
        assert "IV.C" not in full_text, f"IV.C found in docx for {tmpl['name']}"
        assert "Exit Ticket" not in full_text, f"Exit Ticket found in docx for {tmpl['name']}"
        assert "Post-Class" not in full_text, f"Post-Class found in docx for {tmpl['name']}"
        assert "ការស្វ័យវាយតម្លៃរបស់គ្រូ" not in full_text, f"Self-reflection found in docx for {tmpl['name']}"
        assert "បានឃើញ និងឯកភាព" in "\n".join([c.text for t in doc.tables for r in t.rows for c in r.cells]), f"Signatures missing in docx for {tmpl['name']}"

        print(f"✅ PASS: Word (.docx) export for [{tmpl['name']}] verified clean with 0 unwanted sections!")

if __name__ == "__main__":
    test_api_health()
    test_synthesizer_all_templates()
    print("\n🎉 ALL TESTS PASSED SUCCESSFULLY! All templates strictly have Lesson Plan, Pre-Test, and Post-Test!")
