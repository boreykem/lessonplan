/**
 * AI Lesson Plan Studio - Main Application Logic
 * Supports dual file uploads (Docx/PDF/TXT), AI generation via Gemini or Smart Local Synthesizer,
 * live A4 preview & inline editing, Word (.docx) export, and PDF/Print.
 */

// System Default Gemini API Key (teachers can provide their own key or use Smart Local Synthesizer)
const SYSTEM_DEFAULT_GEMINI_KEY = '';

// ==============================================================================
// 🔐 Universal Multi-Layer Persistent Key Vault
// Stores and synchronizes across 4 independent persistent storage layers:
// 1. localStorage (Synchronous, instant)
// 2. Cookie (10-Year Long-Lived Session, survives cache/history clearing)
// 3. IndexedDB (Persistent Structured Storage, immune to simple cookie clear)
// 4. Local PC Backend (Survives 100% browser data reset when running locally)
// With automatic self-healing: if key exists in ANY layer, it restores all layers!
// ONLY clears when user explicitly clicks "🔄 សម្អាត Key" in the modal.
// ==============================================================================

const PersistentKeyVault = {
  DB_NAME: 'AI_Lesson_Plan_Permanent_Vault',
  DB_VERSION: 1,
  STORE_NAME: 'user_security_credentials',

  getSync() {
    try {
      const fromLocal = (localStorage.getItem('gemini_api_key') || '').trim();
      if (fromLocal) return fromLocal;
      const fromCookie = this.getCookie('gemini_api_key') || this.getCookie('persistent_api_key');
      if (fromCookie) {
        try { localStorage.setItem('gemini_api_key', fromCookie); } catch (e) {}
        return fromCookie;
      }
    } catch (e) {}
    return '';
  },

  getProviderSync() {
    try {
      const fromLocal = localStorage.getItem('ai_provider');
      if (fromLocal) return fromLocal;
      const fromCookie = this.getCookie('ai_provider');
      if (fromCookie) {
        try { localStorage.setItem('ai_provider', fromCookie); } catch (e) {}
        return fromCookie;
      }
    } catch (e) {}
    return 'gemini';
  },

  setCookie(name, val) {
    try {
      const isHttps = window.location.protocol === 'https:';
      const secureFlag = isHttps ? '; Secure' : '';
      document.cookie = `${name}=${encodeURIComponent(val)}; max-age=315360000; path=/; SameSite=Lax${secureFlag}`;
    } catch (e) {}
  },

  getCookie(name) {
    try {
      const match = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
      return match ? decodeURIComponent(match[1]).trim() : '';
    } catch (e) {
      return '';
    }
  },

  deleteCookie(name) {
    try {
      document.cookie = `${name}=; max-age=0; path=/;`;
    } catch (e) {}
  },

  openDB() {
    return new Promise((resolve) => {
      if (!window.indexedDB) return resolve(null);
      try {
        const req = indexedDB.open(this.DB_NAME, this.DB_VERSION);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(this.STORE_NAME)) {
            db.createObjectStore(this.STORE_NAME);
          }
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  },

  async getFromIndexedDB(keyName) {
    try {
      const db = await this.openDB();
      if (!db) return null;
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(this.STORE_NAME, 'readonly');
          const store = tx.objectStore(this.STORE_NAME);
          const req = store.get(keyName);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => resolve(null);
        } catch (e) {
          resolve(null);
        }
      });
    } catch (e) {
      return null;
    }
  },

  async setToIndexedDB(keyName, value) {
    try {
      const db = await this.openDB();
      if (!db) return false;
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(this.STORE_NAME, 'readwrite');
          const store = tx.objectStore(this.STORE_NAME);
          store.put(value, keyName);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        } catch (e) {
          resolve(false);
        }
      });
    } catch (e) {
      return false;
    }
  },

  async deleteFromIndexedDB(keyName) {
    try {
      const db = await this.openDB();
      if (!db) return false;
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(this.STORE_NAME, 'readwrite');
          const store = tx.objectStore(this.STORE_NAME);
          store.delete(keyName);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        } catch (e) {
          resolve(false);
        }
      });
    } catch (e) {
      return false;
    }
  },

  async requestPersistentStorage() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        const isPersisted = await navigator.storage.persisted();
        if (!isPersisted) {
          await navigator.storage.persist();
        }
      }
    } catch (e) {}
  },

  async save(key, provider) {
    const cleanKey = (key || '').trim();
    const cleanProv = (provider || 'gemini').trim();

    if (!cleanKey) {
      await this.clear();
      return;
    }

    try {
      localStorage.setItem('gemini_api_key', cleanKey);
      localStorage.setItem('ai_provider', cleanProv);
    } catch (e) {}

    this.setCookie('gemini_api_key', cleanKey);
    this.setCookie('persistent_api_key', cleanKey);
    this.setCookie('ai_provider', cleanProv);

    await this.setToIndexedDB('gemini_api_key', cleanKey);
    await this.setToIndexedDB('ai_provider', cleanProv);

    this.requestPersistentStorage();

    try {
      fetch('/api/key/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: cleanKey, provider: cleanProv })
      }).catch(() => {});
    } catch (e) {}
  },

  async clear() {
    try {
      localStorage.removeItem('gemini_api_key');
      localStorage.removeItem('ai_provider');
    } catch (e) {}

    this.deleteCookie('gemini_api_key');
    this.deleteCookie('persistent_api_key');
    this.deleteCookie('ai_provider');

    await this.deleteFromIndexedDB('gemini_api_key');
    await this.deleteFromIndexedDB('ai_provider');

    try {
      fetch('/api/key/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }).catch(() => {});
    } catch (e) {}
  },

  async restore() {
    let key = this.getSync();
    let provider = this.getProviderSync();

    if (!key) {
      key = await this.getFromIndexedDB('gemini_api_key');
      provider = (await this.getFromIndexedDB('ai_provider')) || provider;
    }

    if (!key) {
      try {
        const resp = await fetch('/api/key/get').catch(() => null);
        if (resp && resp.ok) {
          const data = await resp.json().catch(() => ({}));
          if (data && data.key) {
            key = data.key.trim();
            provider = data.provider || provider;
          }
        }
      } catch (e) {}
    }

    if (key && key.trim()) {
      state.geminiApiKey = key.trim();
      state.aiProvider = provider || 'gemini';
      await this.save(key.trim(), provider);
      return true;
    }

    return false;
  }
};
window.PersistentKeyVault = PersistentKeyVault;

function getActiveGeminiApiKey() {
  if (typeof state !== 'undefined' && state && state.geminiApiKey && state.geminiApiKey.trim()) {
    return state.geminiApiKey.trim();
  }
  const fromVault = PersistentKeyVault.getSync();
  if (fromVault && fromVault.trim()) {
    if (typeof state !== 'undefined' && state) state.geminiApiKey = fromVault.trim();
    return fromVault.trim();
  }
  try {
    const fromLocal = (localStorage.getItem('gemini_api_key') || sessionStorage.getItem('gemini_api_key') || '').trim();
    if (fromLocal) {
      if (typeof state !== 'undefined' && state) state.geminiApiKey = fromLocal;
      return fromLocal;
    }
  } catch (e) {}
  return '';
}

const state = {
  templateMode: 'preset', // 'preset' | 'saved' | 'custom'
  selectedPresetId: 'moeys_standard_5step',
  savedTemplates: [],
  selectedSavedTemplateId: null,
  customTemplateText: '',
  customTemplateFileName: '',
  lessonSourceMode: 'upload', // 'upload' | 'saved'
  savedLessons: [],
  selectedSavedLessonId: null,
  savedPlans: [],
  selectedSavedPlanId: null,
  lessonFileName: '',
  lessonContent: '',
  currentZoom: 1.0,
  language: localStorage.getItem('app_language') || 'km',
  aiProvider: PersistentKeyVault.getProviderSync(),
  geminiApiKey: PersistentKeyVault.getSync(),
  generatedPlanData: null
};

// Storage Keys
const SAVED_TEMPLATES_STORAGE_KEY = 'saved_custom_templates';
const ADMIN_STORAGE_KEY = 'saved_admin_profile';
const SAVED_LESSONS_STORAGE_KEY = 'saved_lesson_materials';
const LIBRARY_INIT_FLAG = 'saved_lessons_vault_v2_initialized';
const SAVED_PLANS_STORAGE_KEY = 'saved_generated_lesson_plans';

// Preset Official MoEYS Lesson Plan Templates & Sample Lessons

const PRESET_TEMPLATES = {
  moeys_standard_5step: {
    id: "moeys_standard_5step",
    name: "កិច្ចតែងការស្តង់ដារ ៥ ជំហាន (ក្រសួងអប់រំ)",
    badge: "ផ្លូវការ MoEYS",
    description: "ទម្រង់កិច្ចតែងការទូទៅ ៥ ជំហាន សម្រាប់អនុវិទ្យាល័យ និងវិទ្យាល័យ",
    structure: {
      type: "5_steps",
      steps: [
        { id: 1, name: "ជំហានទី ១ : រដ្ឋបាលថ្នាក់", duration: "២ នាទី", description: "ពិនិត្យអវត្តមាន អនាម័យ និងវិន័យសណ្តាប់ធ្នាប់" },
        { id: 2, name: "ជំហានទី ២ : រំលឹកមេរៀនចាស់ / ទំនាក់ទំនងមេរៀន", duration: "៥ នាទី", description: "សួរសំណួររំលឹក និងភ្ជាប់ទៅកាន់មេរៀនថ្មី" },
        { id: 3, name: "ជំហានទី ៣ : ដំណើរការបង្រៀន និងរៀន (មេរៀនថ្មី)", duration: "៣៥ នាទី", description: "សកម្មភាពគ្រូ ខ្លឹមសារមេរៀន និងសកម្មភាពសិស្ស" },
        { id: 4, name: "ជំហានទី ៤ : ពង្រឹងពុទ្ធិ (វាយតម្លៃ)", duration: "៥ នាទី", description: "សំណួរវាយតម្លៃ ឬលំហាត់សង្ខេបដើម្បីវាស់ស្ទង់ការយល់ដឹង" },
        { id: 5, name: "ជំហានទី ៥ : បណ្តាំផ្ញើ និងកិច្ចការផ្ទះ", duration: "៣ នាទី", description: "ដាក់កិច្ចការផ្ទះ និងណែនាំឱ្យអានមេរៀនបន្ត" }
      ]
    }
  },
  moeys_primary: {
    id: "moeys_primary",
    name: "កិច្ចតែងការបឋមសិក្សា (ថ្នាក់ទី ១ ដល់ ទី ៦)",
    badge: "បឋមសិក្សា",
    description: "ទម្រង់ងាយស្រួល ផ្ដោតលើការចូលរួម និងល្បែងសិក្សាសម្រាប់កុមារតូច",
    structure: {
      type: "primary_5step",
      steps: [
        { id: 1, name: "ជំហានទី ១ : ត្រួតពិនិត្យ និងរដ្ឋបាល", duration: "៣ នាទី", description: "ស្វាគមន៍ ច្រៀងចម្រៀង ពិនិត្យអនាម័យ" },
        { id: 2, name: "ជំហានទី ២ : រំលឹកចំណេះដឹងចាស់", duration: "៥ នាទី", description: "ល្បែងពាក្យ ឬសំណួរខ្លីៗ" },
        { id: 3, name: "ជំហានទី ៣ : បង្រៀនមេរៀនថ្មី", duration: "២៥ នាទី", description: "ការបង្ហាញរូបភាព វត្ថុជាក់ស្តែង និងការអនុវត្តជាក់ស្តែង" },
        { id: 4, name: "ជំហានទី ៤ : ពង្រឹងចំណេះដឹង", duration: "១០ នាទី", description: "ការប្រកួតប្រជែងជាក្រុម ឬឆ្លើយលើក្ដារឆ្នួន" },
        { id: 5, name: "ជំហានទី ៥ : កិច្ចការផ្ទះ និងអនុវត្ត", duration: "២ នាទី", description: "កិច្ចការស្រួលៗសម្រាប់អនុវត្តនៅផ្ទះ" }
      ]
    }
  },
  moeys_stem_inquiry: {
    id: "moeys_stem_inquiry",
    name: "កិច្ចតែងការបែប STEM / 5E (វិទ្យាសាស្ត្រ និងពិសោធន៍)",
    badge: "STEM & 5E",
    description: "ទម្រង់ផ្អែកលើការស្រាវជ្រាវ (Engage, Explore, Explain, Elaborate, Evaluate)",
    structure: {
      type: "5e_model",
      steps: [
        { id: 1, name: "ដំណាក់កាលទី ១ : ចូលរួម (Engage)", duration: "៥ នាទី", description: "ចោទបញ្ហា ឬបង្ហាញបាតុភូតជាក់ស្តែងដើម្បីទាក់ទាញចំណាប់អារម្មណ៍" },
        { id: 2, name: "ដំណាក់កាលទី ២ : រុករក និងពិសោធ (Explore)", duration: "១៥ នាទី", description: "សិស្សធ្វើការជាក្រុម សង្កេត ពិសោធន៍ ឬប្រមូលទិន្នន័យ" },
        { id: 3, name: "ដំណាក់កាលទី ៣ : ពន្យល់ និងបកស្រាយ (Explain)", duration: "១០ នាទី", description: "សិស្សរាយការណ៍លទ្ធផល គ្រូជួយសម្របសម្រួល និងពន្យល់ក្បួនច្បាប់" },
        { id: 4, name: "ដំណាក់កាលទី ៤ : ពង្រីកចំណេះដឹង (Elaborate)", duration: "១០ នាទី", description: "អនុវត្តចំណេះដឹងលើបរិបទថ្មី ឬបញ្ហាពិតក្នុងសង្គម" },
        { id: 5, name: "ដំណាក់កាលទី ៥ : វាយតម្លៃ (Evaluate)", duration: "១០ នាទី", description: "វាយតម្លៃលើលទ្ធផលការងារ និងការឆ្លុះបញ្ចាំង" }
      ]
    }
  },
  backward_design_ubd: {
    id: "backward_design_ubd",
    name: "កិច្ចតែងការតាមបែបត្រឡប់ (Backward Design / UbD ៣ ដំណាក់កាល)",
    badge: "បែបត្រឡប់ UbD",
    description: "ទម្រង់តាមបែបត្រឡប់ ៣ ដំណាក់កាល (លទ្ធផលរំពឹងទុក, ភស្តុតាងវាយតម្លៃ, ផែនការបង្រៀន) និយមប្រើនៅ TEC / គរុកោសល្យ",
    structure: {
      type: "backward_design",
      stages: [
        { id: 1, name: "ដំណាក់កាលទី ១ : ការកំណត់លទ្ធផលរំពឹងទុក (Stage 1: Desired Results)", description: "គោលបំណងចម្បង, ការយល់ដឹងស្នូល, សំណួរគន្លឹះ, វត្ថុបំណង ៣ ផ្នែក" },
        { id: 2, name: "ដំណាក់កាលទី ២ : ការកំណត់ភស្តុតាងនៃការវាយតម្លៃ (Stage 2: Assessment Evidence)", description: "ភារកិច្ចវាស់ស្ទង់សមត្ថភាព, ភស្តុតាងផ្សេងទៀត, លក្ខណៈវិនិច្ឆ័យវាយតម្លៃ" },
        { id: 3, name: "ដំណាក់កាលទី ៣ : ផែនការរៀបចំការបង្រៀន និងរៀន (Stage 3: Learning Plan)", description: "សកម្មភាពបង្រៀនតាមលំដាប់លំដោយ (ទាក់ទាញ, រុករក, ឆ្លុះបញ្ចាំង, វាយតម្លៃ)" }
      ]
    }
  },
  flipped_learning_5step: {
    id: "flipped_learning_5step",
    name: "កិច្ចតែងការតាមបែបត្រឡប់ (Flipped Learning)",
    badge: "ថ្នាក់រៀនត្រឡប់ (៥%-១០%-១០%-៧០%-៥%)",
    description: "ទម្រង់កិច្ចតែងការបង្រៀនតាមបែបត្រឡប់ ជាមួយ Pre-test QCM ៥ សំណួរ និង Post-test MCQ ៥ សំណួរ",
    structure: {
      type: "flipped_learning",
      steps: [
        { id: 1, name: "ជំហានទី ១ : រដ្ឋបាលថ្នាក់", duration: "០៥ នាទី", description: "ពិនិត្យអនាម័យ សម្រង់វត្តមាន និងសណ្ដាប់ធ្នាប់" },
        { id: 2, name: "ជំហានទី ២ : កែកិច្ចការផ្ទះ & ពិនិត្យការស្វ័យសិក្សា", duration: "២០ នាទី", description: "កែកិច្ចការផ្ទះសប្តាហ៍មុន ពិនិត្យការមើលវីដេអូ បង្ហាញលទ្ធផលបុរេតេស្ត (Pre-Test QCM ៥ សំណួរ ៦-៣-១) និងកត់ត្រាចម្ងល់ Muddiest Point" },
        { id: 3, name: "ជំហានទី ៣ : ខ្លឹមសារមេរៀនថ្មី & ដោះស្រាយចម្ងល់", duration: "២០ នាទី", description: "គ្រូសំយោគទ្រឹស្តីស្នូល បំភ្លឺចំណុចខុសក្នុង Pre-Test និងដោះស្រាយចម្ងល់ Muddiest Points (គ្មានការពិភាក្សាក្រុមឡើយ)" },
        { id: 4, name: "ជំហានទី ៤ : ពង្រឹងចំណេះដឹង & បេសកកម្មក្រុមស៊ីជម្រៅ", duration: "១០០-១២០ នាទី", description: "សកម្មភាពក្រុម Challenge Scenario លើផ្ទាំងក្រដាសធំ A0/A1, Gallery Walk, បទបង្ហាញការពារ, Brain Break ២ នាទី, និង Post-Test (${numQuestions} សំណួរ)" },
        { id: 5, name: "ជំហានទី ៥ : បណ្ដាំផ្ញើ និងកិច្ចការស្រាវជ្រាវ", duration: "០៥-១០ នាទី", description: "ដាក់កិច្ចការស្រាវជ្រាវសម្រាប់សប្តាហ៍បន្ទាប់ ណែនាំការស្វ័យសិក្សា និងអប់រំទូន្មានសីលធម៌" }
      ]
    }
  }
};

const SAMPLE_LESSONS = [
  {
    title: "កិច្ចតែងការបង្រៀនតាមបែបត្រឡប់: ចិត្តវិទ្យាអប់រំ (៣ ក្រេឌីត ១៨០នាទី)",
    subject: "ចិត្តវិទ្យាអប់រំ",
    grade: "គរុនិស្សិត ឆ្នាំទី ១ ឆមាសទី ២ (៣ ក្រេឌីត ៣-០-៦)",
    teacher: "កែម បូរី",
    school: "វិទ្យាស្ថានគរុកោសល្យ",
    duration: "១៨០ នាទី",
    chapter: "ជំពូកទី ២: ទ្រឹស្តីនៃការលូតលាស់របស់កុមារ",
    lesson: "មេរៀនទី ១: ដំណាក់កាលទាំង ៤ នៃការលូតលាស់ការយល់ដឹង (Piaget's Cognitive Development)",
    method: "ការរៀនបែបត្រឡប់",
    content: `ខ្លឹមសារមេរៀនចិត្តវិទ្យាអប់រំ (ស្វ័យសិក្សា និងសកម្មភាពក្នុងថ្នាក់ ១៨០ នាទី)៖
- ចំនួនក្រេឌីត: ៣ ក្រេឌីត (៣-០-៦), ឆ្នាំទី ១ ឆមាសទី ២, រយៈពេល ១៨០ នាទី, គ្រូឧទ្ទេស: កែម បូរី
- សេចក្តីផ្តើមអំពីទ្រឹស្តី Piaget (Schemas, Assimilation, Accommodation, Equilibration)
- ដំណាក់កាលទាំង ៤ នៃការលូតលាស់ការយល់ដឹង៖
  ១. ដំណាក់កាលឥន្ទ្រិយ-ចលករ (Sensorimotor: ០ - ២ ឆ្នាំ): ការស្វែងយល់តាមរយៈញាណ និងចលនា, អត្ថិភាពនៃវត្ថុ (Object Permanence)។
  ២. ដំណាក់កាលប្រតិបត្តិការបឋម (Preoperational: ២ - ៧ ឆ្នាំ): ការប្រើប្រាស់និមិត្តសញ្ញា ភាសា, ភាពអត្មានិយម (Egocentrism), ការខ្វះការយល់ដឹងពីការរក្សាបរិមាណ (Lack of Conservation)។
  ៣. ដំណាក់កាលប្រតិបត្តិការរូបិយ (Concrete Operational: ៧ - ១១ ឆ្នាំ): ការគិតបែបតក្កវិជ្ជាលើវត្ថុជាក់ស្តែង, ច្បាប់រក្សាភាពថេរ (Conservation), ការចាត់ថ្នាក់ និងរៀបលំដាប់។
  ៤. ដំណាក់កាលប្រតិបត្តិការផ្លូវការ (Formal Operational: ១២ ឆ្នាំឡើង): ការគិតបែបអរូបី, សម្មតិកម្ម និងការដោះស្រាយបញ្ហាស្មុគស្មាញ។
- ការអនុវត្តទ្រឹស្តីក្នុងថ្នាក់រៀន: ការរៀបចំសកម្មភាពបង្រៀនឱ្យស្របតាមកម្រិតអាយុ និងការយល់ដឹងរបស់សិស្ស (Developmentally Appropriate Practice)។
- កិច្ចការស្វ័យសិក្សាពីផ្ទះ (Pre-Class): គរុនិស្សិតស្តាប់ Google NotebookLM Deep Dive Audio Overview (៥-៧ នាទី), អានឯកសារយោង និងឆ្លើយវិញ្ញាសាបុរេតេស្ត (Pre-Test QCM) ១០ សំណួរ មុនចូលរៀន។`
  },
  {
    title: "រូបវិទ្យា ថ្នាក់ទី ៨: ច្បាប់រក្សាថាមពល",
    subject: "រូបវិទ្យា",
    grade: "ថ្នាក់ទី ៨",
    duration: "៥០ នាទី (១ ម៉ោងសិក្សា)",
    chapter: "ជំពូកទី ៣: ការងារ និងថាមពល",
    lesson: "មេរៀនទី ២: ថាមពលមេកានិច និងច្បាប់រក្សាថាមពល",
    method: "សិស្សមជ្ឈមណ្ឌល និងការពិសោធន៍ជាក់ស្តែង",
    content: `ខ្លឹមសារមេរៀនដកស្រង់ចេញពីសៀវភៅសិក្សាគោល៖
- និយមន័យថាមពលស៊ីនេទិច (Kinetic Energy): $Ec = 1/2 * m * v^2$ ជាថាមពលដែលកើតមានដោយសារចលនារបស់អង្គធាតុ។
- និយមន័យថាមពលប៉ូតង់ស្យែលទំនាញ (Potential Energy): $Ep = m * g * h$ ជាថាមពលដែលអង្គធាតុមានដោយសារទីតាំងកម្ពស់របស់វាធៀបនឹងផ្ទៃយោង។
- ថាមពលមេកានិចសរុប: $Em = Ec + Ep$
- ច្បាប់រក្សាថាមពលមេកានិច: ក្នុងប្រព័ន្ធដែលគ្មានកម្លាំងកកិត ឬកម្លាំងក្រៅ ថាមពលមេកានិចរក្សាតម្លៃថេរជានិច្ច (Em = ថេរ)។ ថាមពលមិនអាចបង្កើតថ្មី ឬបំផ្លាញបានឡើយ គឺវាគ្រាន់តែបំប្លែងពីទម្រង់មួយទៅទម្រង់មួយទៀតប៉ុណ្ណោះ។
- ឧទាហរណ៍ជាក់ស្តែង: ការទម្លាក់បាល់ពីទីខ្ពស់ រថភ្លើងរំកិល (Roller Coaster) និងប៉ោលទោល។`
  },
  {
    title: "ភាសាខ្មែរ ថ្នាក់ទី ៧: វេយ្យាករណ៍ សម្ព័ន្ធនាម និងគុណនាម",
    subject: "ភាសាខ្មែរ",
    grade: "ថ្នាក់ទី ៧",
    duration: "៥០ នាទី (១ ម៉ោងសិក្សា)",
    chapter: "ជំពូកទី ២: ការអភិវឌ្ឍភាសា",
    lesson: "មេរៀនទី ១: កំណត់សម្គាល់សម្ព័ន្ធនាម និងគុណនាមក្នុងប្រយោគ",
    method: "ពិភាក្សាក្រុម និងការអនុវត្តលំហាត់",
    content: `ខ្លឹមសារមេរៀនដកស្រង់៖
- សម្ព័ន្ធនាម គឺជាពាក្យដែលប្រើសម្រាប់ភ្ជាប់នាម ទៅនឹងនាមមួយទៀត ឬភ្ជាប់ឃ្លាដើម្បីបញ្ជាក់លក្ខណៈ ឬកម្មសិទ្ធិ (ឧទាហរណ៍៖ នៃ, របស់, ឯ...)។
- គុណនាម គឺជាពាក្យដែលបញ្ជាក់លក្ខណៈ បរិមាណ គុណភាព ពណ៌សម្បុរ ទំហំ ដល់នាម ឬកិរិយាសព្ទ (ឧទាហរណ៍៖ ធំ, ល្អ, ស្អាត, ខ្ពស់, ឧស្សាហ៍...)។
- ការវិភាគប្រយោគគំរូ: "សៀវភៅរបស់សិស្សពូកែមានគម្របពណ៌ខៀវស្រស់" -> រកសម្ព័ន្ធនាម និងគុណនាម។`
  },
  {
    title: "គណិតវិទ្យា ថ្នាក់ទី ៩: សមីការដឺក្រេទី ២ មានមួយអញ្ញាត",
    subject: "គណិតវិទ្យា",
    grade: "ថ្នាក់ទី ៩",
    duration: "៥០ នាទី",
    chapter: "ជំពូកទី ៤: សមីការ និងវិសមីការ",
    lesson: "មេរៀនទី ២: ដោះស្រាយសមីការ ax² + bx + c = 0 ដោយប្រើឌីសគ្រីមីណង់ (Δ)",
    method: "ការពន្យល់គំរូ និងការដោះស្រាយលំហាត់ជាដៃគូ",
    content: `ខ្លឹមសារមេរៀន៖
- ទម្រង់ទូទៅ: ax² + bx + c = 0 (ដែល a ≠ 0)
- រូបមន្តឌីសគ្រីមីណង់: Δ = b² - 4ac
- ករណីទី ១: បើ Δ > 0 សមីការមានឫសពីរផ្សេងគ្នា x₁ = (-b - √Δ) / 2a, x₂ = (-b + √Δ) / 2a
- ករណីទី ២: បើ Δ = 0 សមីការមានឫសឌុប x₁ = x₂ = -b / 2a
- ករណីទី ៣: បើ Δ < 0 សមីការគ្មានឫសក្នុងសំណុំចំនួនពិត R ឡើយ។`
  },
  {
    title: "ចិត្តវិទ្យាអប់រំ: ទ្រឹស្តីការលូតលាស់ការយល់ដឹងរបស់ Jean Piaget",
    subject: "ចិត្តវិទ្យាអប់រំ",
    grade: "គរុកោសល្យ / វិទ្យាល័យ",
    duration: "៩០ នាទី (២ ម៉ោងសិក្សា)",
    chapter: "ជំពូកទី ២: ទ្រឹស្តីនៃការលូតលាស់របស់កុមារ",
    lesson: "មេរៀនទី ១: ដំណាក់កាលទាំង ៤ នៃការលូតលាស់ការយល់ដឹង (Piaget's Cognitive Development)",
    method: "ការវិភាគករណីសិក្សា និងការពិភាក្សាជាក្រុម",
    content: `ខ្លឹមសារមេរៀនចិត្តវិទ្យាអប់រំ៖
១. សេចក្តីផ្តើមអំពីទ្រឹស្តី Piaget (Schemas, Assimilation, Accommodation)
២. ដំណាក់កាលទាំង ៤ នៃការលូតលាស់៖
  - ដំណាក់កាលឥន្ទ្រិយ-ចលករ (Sensorimotor: ០ - ២ ឆ្នាំ): រៀនសូត្រតាមរយៈការប៉ះពាល់ សកម្មភាព និងការយល់ដឹងពីអត្ថិភាពនៃវត្ថុ (Object Permanence)។
  - ដំណាក់កាលប្រតិបត្តិការបឋម (Preoperational: ២ - ៧ ឆ្នាំ): ការប្រើប្រាស់និមិត្តសញ្ញា ភាសា ប៉ុន្តែនៅមានភាពអត្មានិយម (Egocentrism)។
  - ដំណាក់កាលប្រតិបត្តិការរូបិយ (Concrete Operational: ៧ - ១១ ឆ្នាំ): ចាប់ផ្តើមចេះគិតបែបសមហេតុផលលើវត្ថុជាក់ស្តែង និងយល់ពីការរក្សាបរិមាណ (Conservation)។
  - ដំណាក់កាលប្រតិបត្តិការផ្លូវការ (Formal Operational: ១២ ឆ្នាំឡើង): ចេះគិតបែបអរូបី សម្មតិកម្ម និងការដោះស្រាយបញ្ហាស្មុគស្មាញ។
៣. ការអនុវត្តទ្រឹស្តីក្នុងថ្នាក់រៀន: ការរៀបចំសកម្មភាពបង្រៀនឱ្យស្របតាមកម្រិតអាយុ និងការយល់ដឹងរបស់សិស្ស។`
  },
  {
    title: "ព័ត៌មានវិទ្យា: មូលដ្ឋានគ្រឹះក្បួនដោះស្រាយ (Algorithm & Flowchart)",
    subject: "ព័ត៌មានវិទ្យា",
    grade: "ថ្នាក់ទី ១០",
    duration: "៥០ នាទី",
    chapter: "ជំពូកទី ៣: ការសរសេរកម្មវិធី និងក្បួនដោះស្រាយ",
    lesson: "មេរៀនទី ១: ស្វែងយល់ពីក្បួនដោះស្រាយ និងការគូរប្លង់ដ្យាក្រាម (Flowchart)",
    method: "ការពន្យល់ បង្ហាញគំរូ និងការអនុវត្តជាក់ស្តែងលើកុំព្យូទ័រ",
    content: `ខ្លឹមសារមេរៀនព័ត៌មានវិទ្យា៖
១. និយមន័យ Algorithm: ជាលំដាប់លំដោយនៃជំហានច្បាស់លាស់សម្រាប់ដោះស្រាយបញ្ហា ឬដំណើរការកិច្ចការជាក់លាក់មួយ។
២. និមិត្តសញ្ញាស្តង់ដារក្នុង Flowchart:
  - រាងពងក្រពើ (Oval): Start / End
  - រាងចតុកោណកែង (Rectangle): Process / ការគណនា
  - រាងប្រលេឡូក្រាម (Parallelogram): Input / Output
  - រាងពេជ្រ (Diamond): Decision / លក្ខខណ្ឌ (Yes / No)
  - ព្រួញ (Arrows): ទិសដៅលំហូរទិន្នន័យ (Flow direction)
៣. ឧទាហរណ៍ជាក់ស្តែង: ក្បួនដោះស្រាយសម្រាប់ស្វែងរកផលបូកចំនួនពីរ និងការពិនិត្យមើលពិន្ទុជាប់ ឬធ្លាក់ (If/Else)។`
  },
  {
    title: "គីមីវិទ្យា ថ្នាក់ទី ៩: អាស៊ីត បាស និងអំបិល (pH & Indicators)",
    subject: "គីមីវិទ្យា",
    grade: "ថ្នាក់ទី ៩",
    duration: "៥០ នាទី",
    chapter: "ជំពូកទី ៣: អាស៊ីត បាស និងអំបិល",
    lesson: "មេរៀនទី ១: លក្ខណៈសម្បត្តិអាស៊ីត-បាស និងមាត្រដ្ឋាន pH",
    method: "ការពិសោធន៍បង្ហាញ និងការសង្កេត",
    content: `ខ្លឹមសារមេរៀនគីមីវិទ្យា៖
១. លក្ខណៈអាស៊ីត (Acid): មានរសជាតិជូរ ប្តូរក្រដាសលីសមុសពីខៀវទៅក្រហម និងមាន pH < 7 (ឧទាហរណ៍៖ HCl, H2SO4, CH3COOH)។
២. លក្ខណៈបាស (Base): មានរសជាតិចត់ រអិលដូចសាប៊ូ ប្តូរក្រដាសលីសមុសពីក្រហមទៅខៀវ និងមាន pH > 7 (ឧទាហរណ៍៖ NaOH, Ca(OH)2, KOH)។
៣. សូលុយស្យុងណឺត: មាន pH = 7 (ដូចជា ទឹកសុទ្ធ H2O, ទឹកអំបិល NaCl)។
៤. ប្រតិកម្មបន្សាប: អាស៊ីត + បាស -> អំបិល + ទឹក (Acid + Base -> Salt + Water)។`
  },
  {
    title: "គណិតវិទ្យា ថ្នាក់ទី ១២: ធរណីមាត្រក្នុងលំហ (Vectors & Planes)",
    subject: "គណិតវិទ្យា",
    grade: "ថ្នាក់ទី ១២",
    duration: "៥០ នាទី",
    chapter: "ជំពូកទី ៤: ធរណីមាត្រក្នុងលំហ",
    lesson: "មេរៀនទី ២: សមីការប្លង់ក្នុងលំហ (Equation of a Plane)",
    method: "ការគិត-ជាដៃគូ-ចែករំលែក (Think-Pair-Share)",
    content: `ខ្លឹមសារមេរៀនគណិតវិទ្យាថ្នាក់ទី ១២៖
១. និយមន័យវ៉ិចទ័រណរម៉ាល់ (Normal Vector n = (a, b, c)): ជាវ៉ិចទ័រមិនសូន្យដែលកែងនឹងប្លង់ (P)។
២. សមីការទូទៅនៃប្លង់ (P): a(x - x₀) + b(y - y₀) + c(z - z₀) = 0 ឬ ax + by + cz + d = 0។
៣. រូបមន្តចម្ងាយពីចំណុច M₀(x₀, y₀, z₀) ទៅប្លង់ (P): d(M₀, P) = |ax₀ + by₀ + cz₀ + d| / √(a² + b² + c²)។
៤. លំហាត់អនុវត្ត: កំណត់សមីការប្លង់កាត់តាមចំណុច A(1, 2, -1) និងមានវ៉ិចទ័រណរម៉ាល់ n=(2, -3, 4)។`
  },
  {
    title: "ភាសាខ្មែរ ថ្នាក់ទី ១១: អក្សរសិល្ប៍រឿង «រាមកេរ្តិ៍» និងការវិភាគតួអង្គ",
    subject: "ភាសាខ្មែរ",
    grade: "ថ្នាក់ទី ១១",
    duration: "៥០ នាទី",
    chapter: "ជំពូកទី ៣: អក្សរសិល្ប៍បុរាណ",
    lesson: "មេរៀនទី ១: ការវិភាគតម្លៃអប់រំ និងតួអង្គក្នុងរឿងរាមកេរ្តិ៍",
    method: "ការរិះគិតត្រិះរិះពិចារណា (Critical Thinking)",
    content: `ខ្លឹមសារមេរៀនអក្សរសិល្ប៍ខ្មែរ៖
១. ប្រភព និងប្រវត្តិនៃរឿងរាមកេរ្តិ៍ខ្មែរ (ដកស្រង់ពីវីរកថា រាមាយណៈ ឥណ្ឌា)។
២. តួអង្គសំខាន់ៗ:
  - ព្រះរាម: តំណាងឱ្យព្រះមហាក្សត្រប្រកបដោយទសពិធរាជធម៌ សច្ចធម៌ និងកាតព្វកិច្ច។
  - នាងសិតា: តំណាងឱ្យស្ត្រីខ្មែរមានភក្តីភាព បរិសុទ្ធ និងអំណត់ព្យាយាម។
  - ហនុមាន: តំណាងឱ្យសេនាដ៏ស្មោះត្រង់ ក្លាហាន និងមានប្រាជ្ញាវាងវៃ។
  - ក្រុងរាពណ៍: តំណាងឱ្យអំណាចអវិជ្ជា តណ្ហា និងមោហៈដែលនាំទៅរកការវិនាស។
៣. តម្លៃអប់រំ: សច្ចធម៌ឈ្នះអធម្មធម៌ ភក្តីភាពក្នុងគ្រួសារ និងការរួបរួមសាមគ្គី។`
  },
  {
    title: "ប្រវត្តិវិទ្យា ថ្នាក់ទី ៩: អរិយធម៌សម័យអង្គរ និងប្រព័ន្ធធារាសាស្ត្រ",
    subject: "ប្រវត្តិវិទ្យា",
    grade: "ថ្នាក់ទី ៩",
    duration: "៥០ នាទី",
    chapter: "ជំពូកទី ២: សម័យមហានគរ (ស.វ ទី ៩ - ១៥)",
    lesson: "មេរៀនទី ២: សេដ្ឋកិច្ច និងប្រព័ន្ធធារាសាស្ត្រសម័យអង្គរ (បារាយណ៍)",
    method: "ការវិភាគឯកសារប្រវត្តិសាស្ត្រ និងរូបភាព",
    content: `ខ្លឹមសារមេរៀនប្រវត្តិវិទ្យា៖
១. មូលដ្ឋានសេដ្ឋកិច្ចសម័យអង្គរ: ពឹងផ្អែកលើកសិកម្មស្រូវទឹក និងការនេសាទជុំវិញបឹងទន្លេសាប។
២. ប្រព័ន្ធធារាសាស្ត្រមហាសាល:
  - បារាយណ៍ខាងលិច (បារាយណ៍ទឹកថ្លា), បារាយណ៍ខាងកើត (យសោធរតដាក), បារាយណ៍ជ័យតដាក (នាគព័ន្ធ)។
  - តួនាទី: ស្តុកទឹកទុកសម្រាប់ស្រោចស្រពកសិកម្មរដូវប្រាំង ការពារទឹកជំនន់រដូវវស្សា និងជានិមិត្តរូបសាសនា (មហាសមុទ្រជុំវិញភ្នំព្រះសុមេរុ)។
៣. ស្ថាបត្យកម្មប្រាសាទបុរាណ: ប្រាសាទអង្គរវត្ត បាយ័ន បន្ទាយស្រី និងកិត្តិសព្ទរបស់ព្រះបាទជ័យវរ្ម័នទី ៧។`
  },
  {
    title: "ភូមិវិទ្យា ថ្នាក់ទី ៨: ធនធានទឹក និងប្រព័ន្ធទន្លេមេគង្គកម្ពុជា",
    subject: "ភូមិវិទ្យា",
    grade: "ថ្នាក់ទី ៨",
    duration: "៥០ នាទី",
    chapter: "ជំពូកទី ៣: ជលសាស្ត្រ និងធនធានធម្មជាតិកម្ពុជា",
    lesson: "មេរៀនទី ១: ប្រព័ន្ធទន្លេមេគង្គ បឹងទន្លេសាប និងរបបទឹក",
    method: "ការសិក្សាផែនទី និងកិច្ចការជាក្រុម",
    content: `ខ្លឹមសារមេរៀនភូមិវិទ្យា៖
១. ប្រព័ន្ធទន្លេមេគង្គ: ប្រភពពីខ្ពង់រាបទីបេ ហូរកាត់ប្រទេស ៦ និងចូលកម្ពុជាត្រង់ខេត្តស្ទឹងត្រែង។
២. បាតុភូតចម្លែកនៃទន្លេសាប:
  - រដូវវស្សា (ឧសភា - តុលា): ទឹកទន្លេមេគង្គហក់ឡើងខ្ពស់ ច្រានទឹកទន្លេសាបឱ្យហូរបញ្ច្រាសចូលបឹងទន្លេសាប។
  - រដូវប្រាំង (វិច្ឆិកា - មេសា): ទឹកបឹងទន្លេសាបហូរត្រឡប់ចូលទន្លេមេគង្គវិញ។
៣. សារៈសំខាន់: ផ្តល់ដីល្បាប់ជីជាតិសម្រាប់ការដាំដុះ ជម្រកមច្ឆជាតិដ៏ធំ និងប្រភពទឹកប្រើប្រាស់ប្រចាំថ្ងៃ។`
  },
  {
    title: "ពលរដ្ឋវិទ្យា ថ្នាក់ទី ១០: សិទ្ធិមនុស្ស និងនីតិរដ្ឋក្នុងសង្គមប្រជាធិបតេយ្យ",
    subject: "ពលរដ្ឋវិទ្យា",
    grade: "ថ្នាក់ទី ១០",
    duration: "៥០ នាទី",
    chapter: "ជំពូកទី ២: សិទ្ធិ និងកាតព្វកិច្ចពលរដ្ឋ",
    lesson: "មេរៀនទី ១: សេចក្តីប្រកាសជាសកលស្តីពីសិទ្ធិមនុស្ស និងរដ្ឋធម្មនុញ្ញកម្ពុជា",
    method: "ការជជែកដេញដោលបែបស្ថាបនា (Constructive Debate)",
    content: `ខ្លឹមសារមេរៀនពលរដ្ឋវិទ្យា៖
១. និយមន័យសិទ្ធិមនុស្ស (Human Rights): ជាសិទ្ធិពីកំណើតរបស់មនុស្សគ្រប់រូប ដោយមិនប្រកាន់ពូជសាសន៍ ពណ៌សម្បុរ ភេទ ភាសា ឬសាសនាឡើយ។
២. ប្រភេទនៃសិទ្ធិជាមូលដ្ឋាន:
  - សិទ្ធិរស់រានមានជីវិត សិទ្ធិសេរីភាព និងសន្តិសុខផ្ទាល់ខ្លួន។
  - សិទ្ធិទទួលបានការអប់រំ សិទ្ធិទទួលបានការថែទាំសុខភាព និងសិទ្ធិការងារ។
  - សេរីភាពក្នុងការបញ្ចេញមតិ សេរីភាពខាងជំនឿសាសនា។
៣. ទំនាក់ទំនងរវាងសិទ្ធិ និងកាតព្វកិច្ច: ការគោរពច្បាប់រដ្ឋ ការការពារផលប្រយោជន៍សាធារណៈ និងការមិនរំលោភលើសិទ្ធិអ្នកដទៃ។`
  },
  {
    title: "រូបវិទ្យា ថ្នាក់ទី ១២: ច្បាប់ចលនាញូតុនទាំង ៣ (Newton's Laws of Motion)",
    subject: "រូបវិទ្យា",
    grade: "ថ្នាក់ទី ១២",
    duration: "៥០ នាទី",
    chapter: "ជំពូកទី ១: ឌីណាមិចនៃចលនាត្រង់",
    lesson: "មេរៀនទី ១: ច្បាប់ញូតុនទាំងបី និងការអនុវត្តលើចលនាអង្គធាតុ",
    method: "ការពិសោធន៍គំរូ និងការដោះស្រាយលំហាត់ស្មុគស្មាញ",
    content: `ខ្លឹមសារមេរៀនរូបវិទ្យាថ្នាក់ទី ១២៖
១. ច្បាប់ទី ១ ញូតុន (ច្បាប់និចលភាព): អង្គធាតុមួយរក្សាភាពនៅស្ងៀម ឬចលនាត្រង់ស្មើ លុះត្រាតែគ្មានកម្លាំងក្រៅមានអំពើលើវា (ΣF = 0 => a = 0)។
២. ច្បាប់ទី ២ ញូតុន (ច្បាប់គ្រឹះឌីណាមិច): សំទុះនៃអង្គធាតុសមាមាត្រនឹងផលបូកកម្លាំង និងច្រាសសមាមាត្រនឹងម៉ាស (ΣF = m * a)។
៣. ច្បាប់ទី ៣ ញូតុន (ច្បាប់សកម្មភាព និងប្រតិកម្ម): រាល់កម្លាំងសកម្មភាពតែងតែមានកម្លាំងប្រតិកម្មស្មើទំហំ មានទិសដៅផ្ទុយ និងមានអំពើលើអង្គធាតុពីរផ្សេងគ្នា (F_AB = -F_BA)។
៤. ការអនុវត្ត: កម្លាំងកកិត ចលនាលើប្លង់ទ្រេត និងចលនាប្រព័ន្ធរ៉ក។`
  },
  {
    title: "គីមីវិទ្យា ថ្នាក់ទី ១១: គីមីសរីរាង្គ អ៊ីដ្រូកាបួ (Alkanes, Alkenes, Alkynes)",
    subject: "គីមីវិទ្យា",
    grade: "ថ្នាក់ទី ១១",
    duration: "៥០ នាទី",
    chapter: "ជំពូកទី ៤: គីមីសរីរាង្គ",
    lesson: "មេរៀនទី ១: រចនាសម្ព័ន្ធ និងនាមវលីនៃអ៊ីដ្រូកាបួឆ្អែត និងមិនឆ្អែត",
    method: "ការសង់ម៉ូដែលម៉ូលេគុល 3D និងការដាក់ឈ្មោះ IUPAC",
    content: `ខ្លឹមសារមេរៀនគីមីវិទ្យា៖
១. អាល់កាន (Alkanes): រូបមន្តទូទៅ CnH2n+2 (សម្ព័ន្ធទោល C-C ឆ្អែត) ដូចជា មេតាន CH4, អេតាន C2H6, ប្រូបាន C3H8។
២. អាល់សែន (Alkenes): រូបមន្តទូទៅ CnH2n (សម្ព័ន្ធភ្លោះ C=C មិនឆ្អែត) ដូចជា អេតែន C2H4, ប្រូពែន C3H6។
៣. អាល់ស៊ីន (Alkynes): រូបមន្តទូទៅ CnH2n-2 (សម្ព័ន្ធបី C≡C) ដូចជា អេទីន (អាសេទីឡែន) C2H2។
៤. វិធាននាមវលី IUPAC: ការរាប់ខ្សែច្រវាក់កាបូនវែងជាងគេ និងការកំណត់ទីតាំងសម្ព័ន្ធ ឬប្រទាក់។`
  },
  {
    title: "ជីវវិទ្យា ថ្នាក់ទី ១២: ហ្សែន និងការសំយោគប្រូតេអ៊ីន (DNA to Protein)",
    subject: "ជីវវិទ្យា",
    grade: "ថ្នាក់ទី ១២",
    duration: "៥០ នាទី",
    chapter: "ជំពូកទី ១: ហ្សែន និងព័ត៌មានតំណពូជ",
    lesson: "មេរៀនទី ២: ស្វ័យតម្រងទ្វេ DNA ការចម្លងក្រម (Transcription) និងការបកប្រែក្រម (Translation)",
    method: "ចលនារូបភាពគំនូរជីវចល និងការដោះស្រាយលំហាត់ហ្សែន",
    content: `ខ្លឹមសារមេរៀនជីវវិទ្យាថ្នាក់ទី ១២៖
១. រចនាសម្ព័ន្ធ DNA: ច្រវាក់ទ្វេបត់ជារាងគូទខ្យង (Double Helix) ផ្សំពីនុយក្លេអូទីត ៤ ប្រភេទគឺ A, T, C, G តាមគោលការណ៍បំពេញបាស A=T, C≡G។
២. ការចម្លងក្រម (Transcription): ដំណើរការសំយោគ mRNA ចេញពីច្រវាក់ពុម្ព DNA ក្នុងស្នូលកោសិកា (A ផ្គុំ U, T ផ្គុំ A, C ផ្គុំ G, G ផ្គុំ C)។
៣. ការបកប្រែក្រម (Translation): ដំណើរការសំយោគច្រវាក់ប៉ូលីប៉ិបទីតនៅត្រង់រីបូសូម ដោយ tRNA នាំយកអាស៊ីតអាមីណូតាមកូដុងលើ mRNA។
៤. លំហាត់ហ្សែន: ការគណនាប្រវែង DNA, ចំនួននុយក្លេអូទីតសរុប, និងចំនួនអាស៊ីតអាមីណូក្នុងប្រូតេអ៊ីន។`
  },
  {
    title: "ផែនដីវិទ្យា ថ្នាក់ទី ៨: បន្ទះផ្លាកតិចតូនិច និងការកកើតរញ្ជួយដី",
    subject: "ផែនដីវិទ្យា",
    grade: "ថ្នាក់ទី ៨",
    duration: "៥០ នាទី",
    chapter: "ជំពូកទី ២: ផ្លាកតិចតូនិច និងភូគព្ភសាស្ត្រ",
    lesson: "មេរៀនទី ១: ចលនានៃផ្លាកតិចតូនិច និងមូលហេតុនៃរញ្ជួយដី",
    method: "ការពិសោធន៍គំរូ និងការវិភាគវីដេអូ",
    content: `ខ្លឹមសារមេរៀនផែនដីវិទ្យា៖
១. រចនាសម្ព័ន្ធផែនដី: សំបកផែនដី (Crust), ម៉ង់តូ (Mantle), ស្នូលក្រៅ និងស្នូលក្នុង (Core)។
២. ប្រភេទចលនានៃផ្លាកតិចតូនិច:
  - ចលនារំកិលចេញពីគ្នា (Divergent Boundary): បង្កើតជួរភ្នំក្រោមបាតសមុទ្រ។
  - ចលនារំកិលចូលគ្នា (Convergent Boundary): បង្កើតជួរភ្នំខ្ពស់ៗ និងលេណដ្ឋានក្រោមសមុទ្រ។
  - ចលនារអិលកកិតកាត់គ្នា (Transform Boundary): បង្កើតស្នាមប្រេះ និងការរញ្ជួយដីខ្លាំង។
៣. រញ្ជួយដី (Earthquake): កើតឡើងដោយសារការរំដោះថាមពលភ្លាមៗនៅតាមបណ្តោយស្នាមប្រេះផែនដី (Fault Line)។`
  },
  {
    title: "ភាសាអង់គ្លេស ថ្នាក់ទី ៨: Past Simple vs Present Perfect Tenses",
    subject: "ភាសាអង់គ្លេស",
    grade: "ថ្នាក់ទី ៨",
    duration: "៥០ នាទី",
    chapter: "Unit 4: Experiences & Past Events",
    lesson: "Lesson 2: Differentiating Past Simple and Present Perfect in Daily Communication",
    method: "Communicative Language Teaching (CLT) & Pair Work",
    content: `Lesson Core Content (English Grammar & Usage):
1. Past Simple Tense (Subject + V2 / ed): Used for completed actions at a specific time in the past (e.g. yesterday, last week, in 2020). Example: "I visited Angkor Wat last year."
2. Present Perfect Tense (Subject + have/has + V3 / Past Participle): Used for actions that occurred at an unspecified time, life experiences, or actions starting in the past continuing to present (e.g. already, yet, ever, never, since, for). Example: "I have lived in Phnom Penh for 5 years."
3. Comparison & Key Time Markers:
  - Past Simple: ago, yesterday, in 2018, when I was young.
  - Present Perfect: already, just, yet, ever, since, for.
4. Guided Practice: Gap filling, pair dialogue roleplay about travel experiences.`
  },
  {
    title: "គរុកោសល្យ និងវិធីសាស្ត្របង្រៀន: ការគ្រប់គ្រងថ្នាក់រៀនសតវត្សរ៍ទី ២១",
    subject: "គរុកោសល្យ",
    grade: "គរុនិស្សិត TEC (១២+៤)",
    duration: "៩០ នាទី",
    chapter: "ជំពូកទី ៣: យុទ្ធសាស្ត្រគ្រប់គ្រងថ្នាក់រៀនបែបសកម្ម",
    lesson: "មេរៀនទី ១: បច្ចេកទេសបង្កើតបរិយាកាសសិក្សាវិជ្ជមាន និងការដោះស្រាយបញ្ហាវិន័យ",
    method: "ការពិភាក្សាផ្អែកលើករណីសិក្សាជាក់ស្តែង (Case-based Learning)",
    content: `ខ្លឹមសារគរុកោសល្យវិជ្ជាជីវៈគ្រូបង្រៀន៖
១. គោលការណ៍គ្រប់គ្រងថ្នាក់រៀនសតវត្សរ៍ទី ២១: ការផ្លាស់ប្តូរពីការដាក់ទណ្ឌកម្ម មកជាការលើកទឹកចិត្ត និងការទទួលខុសត្រូវខ្លួនឯង (Positive Reinforcement)។
២. យុទ្ធសាស្ត្រ 4Cs ក្នុងថ្នាក់រៀន:
  - Critical Thinking (ការត្រិះរិះពិចារណា)
  - Communication (ទំនាក់ទំនងស្ថាបនា)
  - Collaboration (ការសហការជាក្រុម)
  - Creativity (ភាពច្នៃប្រឌិត)
៣. ការបង្កើតបទបញ្ជាផ្ទៃក្នុងថ្នាក់ដោយមានការចូលរួមពីសិស្ស (Co-created Class Norms)។
៤. ការដោះស្រាយសិស្សរំខានក្នុងថ្នាក់រៀនដោយប្រើវិធានការអហិង្សា និងការសន្ទនាឯកជន។`
  },
  {
    title: "គណិតវិទ្យា បឋមសិក្សា (ថ្នាក់ទី ៥): ប្រភាគ និងវិធីគុណ-ចែកប្រភាគ",
    subject: "គណិតវិទ្យា",
    grade: "ថ្នាក់ទី ៥",
    duration: "៤០ នាទី",
    chapter: "ជំពូកទី ៣: ប្រភាគ និងចំនួនទសភាគ",
    lesson: "មេរៀនទី ២: វិធីគុណប្រភាគ និងការសម្រួលប្រភាគឱ្យទៅជាប្រភាគសម្រួលរួច",
    method: "ការប្រើប្រាស់រូបភាពជាក់ស្តែង និងក្ដារឆ្នួន",
    content: `ខ្លឹមសារមេរៀនគណិតវិទ្យាបឋមសិក្សា៖
១. និយមន័យប្រភាគ: ភាគយក (ចំនួនផ្នែកដែលយក) និង ភាគបែង (ចំនួនផ្នែកស្មើៗគ្នាសរុប)។
២. វិធានគុណប្រភាគ: គុណភាគយក និងភាគយក ហើយគុណភាគបែង និងភាគបែង (a/b * c/d = (a*c)/(b*d))។
៣. ការសម្រួលប្រភាគ: ចែកភាគយក និងភាគបែងនឹងតួចែករួមធំបំផុត (GCD)។
៤. លំហាត់គំរូ: ២/៣ * ៣/៤ = ៦/១២ = ១/២។
៥. លំហាត់ចំណោទជាក់ស្តែង: ការចែកនំខេក និងការវាស់ប្រវែងដី។`
  },
  {
    title: "ភាសាខ្មែរ បឋមសិក្សា (ថ្នាក់ទី ៣): ការតែងប្រយោគ និងការប្រើសញ្ញាខណ្ឌ",
    subject: "ភាសាខ្មែរ",
    grade: "ថ្នាក់ទី ៣",
    duration: "៤០ នាទី",
    chapter: "ជំពូកទី ២: ការអាន និងការសរសេរ",
    lesson: "មេរៀនទី ១: សមាសភាគប្រយោគ (ប្រធាន + កិរិយា + កម្មបទ) និងសញ្ញាខណ្ឌ (។)",
    method: "ការរៀបចំកាតពាក្យ និងការសរសេរលើក្ដារឆ្នួន",
    content: `ខ្លឹមសារមេរៀនភាសាខ្មែរបឋមសិក្សា៖
១. រចនាសម្ព័ន្ធប្រយោគសាមញ្ញ:
  - ប្រធាន (នរណា?): ខ្ញុំ, ប្អូនស្រី, សិស្ស, គោ...
  - កិរិយា (ធ្វើអ្វី?): អាន, សរសេរ, ញ៉ាំ, ដើរ...
  - កម្មបទ (ទទួលអំពើអ្វី?): សៀវភៅ, បាយ, បាល់...
២. ឧទាហរណ៍: "ប្អូនស្រីរបស់ខ្ញុំអានសៀវភៅរឿង។"
៣. សញ្ញាខណ្ឌ (។): ប្រើនៅចុងបញ្ចប់នៃប្រយោគនីមួយៗដើម្បីបញ្ជាក់ថាគំនិតនោះចប់សព្វគ្រប់។`
  },
  {
    title: "វិទ្យាសាស្ត្រ បឋមសិក្សា (ថ្នាក់ទី ៦): ប្រព័ន្ធរំលាយអាហាររបស់មនុស្ស",
    subject: "វិទ្យាសាស្ត្រ",
    grade: "ថ្នាក់ទី ៦",
    duration: "៤០ នាទី",
    chapter: "ជំពូកទី ១: សារពាង្គកាយមនុស្ស",
    lesson: "មេរៀនទី ១: សរីរាង្គរំលាយអាហារ និងសារៈសំខាន់នៃអាហារូបត្ថម្ភ",
    method: "ការសង្កេតគំនូរបំព្រួញ និងការធ្វើការជាក្រុម",
    content: `ខ្លឹមសារមេរៀនវិទ្យាសាស្ត្របឋមសិក្សា៖
១. ដំណើរការនៃប្រព័ន្ធរំលាយអាហារ:
  - មាត់ (Mouth): ធ្មេញទំពារបំបែកអាហារ និងអង់ស៊ីមក្នុងទឹកមាត់រំលាយម្សៅ។
  - បំពង់អាហារ (Esophagus): រុញអាហារចុះទៅក្រពះ។
  - ក្រពះ (Stomach): បញ្ចេញទឹកអាស៊ីតក្រពះកិន និងរំលាយប្រូតេអ៊ីន។
  - ពោះវៀនតូច (Small Intestine): រំលាយ និងស្រូបយកជីវជាតិចូលក្នុងឈាម។
  - ពោះវៀនធំ (Large Intestine): ស្រូបយកជាតិទឹក និងបញ្ចេញកាកសំណល់ជាលាមក។
២. ទម្លាប់ល្អសម្រាប់សុខភាព: ទំពារអាហារឱ្យម៉ត់ ផឹកទឹកឱ្យបានច្រើន និងបរិភោគបន្លែផ្លែឈើ។`
  },
  {
    title: "សេដ្ឋកិច្ចវិទ្យា ថ្នាក់ទី ១១: ច្បាប់តម្រូវការ និងការផ្គត់ផ្គង់ (Supply & Demand)",
    subject: "សេដ្ឋកិច្ចវិទ្យា",
    grade: "ថ្នាក់ទី ១១",
    duration: "៥០ នាទី",
    chapter: "ជំពូកទី ២: យន្តការទីផ្សារ",
    lesson: "មេរៀនទី ១: តម្រូវការ ការផ្គត់ផ្គង់ និងតុល្យភាពទីផ្សារ",
    method: "ការក្លែងធ្វើទីផ្សារជាក់ស្តែង (Market Simulation)",
    content: `ខ្លឹមសារមេរៀនសេដ្ឋកិច្ចវិទ្យា៖
១. ច្បាប់តម្រូវការ (Law of Demand): កាលណាថ្លៃទំនិញកើនឡើង បរិមាណតម្រូវការថយចុះ ហើយកាលណាថ្លៃធ្លាក់ចុះ បរិមាណតម្រូវការកើនឡើង (ទំនាក់ទំនងច្រាស)។
២. ច្បាប់ផ្គត់ផ្គង់ (Law of Supply): កាលណាថ្លៃទំនិញកើនឡើង បរិមាណផ្គត់ផ្គង់កើនឡើង ហើយកាលណាថ្លៃធ្លាក់ចុះ បរិមាណផ្គត់ផ្គង់ថយចុះ (ទំនាក់ទំនងស្រប)។
៣. ថ្លៃតុល្យភាពទីផ្សារ (Equilibrium Price): ជាចំណុចប្រសព្វរវាងខ្សែបន្ទាត់តម្រូវការ និងខ្សែបន្ទាត់ផ្គត់ផ្គង់ (Demand = Supply)។
៤. កត្តាជះឥទ្ធិពល: ចំណូលអ្នកប្រើប្រាស់ ថ្លៃទំនិញជំនួស និងបច្ចេកវិទ្យាផលិតកម្ម។`
  },
  {
    title: "កីឡា និងអប់រំកាយ ថ្នាក់ទី ៩: ច្បាប់ និងបច្ចេកទេសមូលដ្ឋាននៃកីឡាបាល់ទះ",
    subject: "អប់រំកាយ និងកីឡា",
    grade: "ថ្នាក់ទី ៩",
    duration: "៥០ នាទី",
    chapter: "ជំពូកទី ២: កីឡាបាល់ទះ",
    lesson: "មេរៀនទី ១: បច្ចេកទេសប៉ះសេបាល់ (Overhand Pass) និងការកាងបាល់ក្រោម (Dig/Forearm Pass)",
    method: "ការបង្ហាញគំរូ និងការហ្វឹកហាត់ជាគូជាក់ស្តែងនៅលើទីលាន",
    content: `ខ្លឹមសារមេរៀនអប់រំកាយ និងកីឡា៖
១. ការកម្តៅសាច់ដុំ និងចលនាសន្លាក់មុនពេលលេងកីឡា (Warm-up)។
២. បច្ចេកទេសកាងបាល់ក្រោម (Forearm Pass / Bump): ជើងទាំងពីរទន្ទឹមបន្ទន់ជង្គង់ ដៃទាំងពីរសណ្តូកត្រង់ផ្គុំចូលគ្នា វាយបាល់ត្រង់កំភួនដៃ។
៣. បច្ចេកទេសលើកបាល់លើ (Overhand Set): ម្រាមដៃទាំងដប់បើកទូលាយរាងជាចានគោម ប៉ះបាល់នៅពីលើថ្ងាស រុញដោយកម្លាំងកដៃ និងម្រាមដៃ។
៤. ច្បាប់មូលដ្ឋាន: ការបង្វិលជុំកីឡាករ (Rotation) ចំនួនប៉ះបាល់អតិបរមា ៣ ដងក្នុងម្ខាង និងការមិនប៉ះសំណាញ់។`
  },
  {
    title: "សីលធម៌-ពលរដ្ឋវិទ្យា ថ្នាក់ទី ៧: វប្បធម៌សន្តិភាព និងការដោះស្រាយទំនាស់ដោយអហិង្សា",
    subject: "សីលធម៌-ពលរដ្ឋ",
    grade: "ថ្នាក់ទី ៧",
    duration: "៥០ នាទី",
    chapter: "ជំពូកទី ៣: សន្តិភាព និងសាមគ្គីភាព",
    lesson: "មេរៀនទី ២: វិធីសាស្ត្រដោះស្រាយទំនាស់ដោយសន្តិវិធី និងការយោគយល់អធ្យាស្រ័យ",
    method: "ការដើរតួសម្តែង (Role-playing) និងការឆ្លុះបញ្ចាំងគំនិត",
    content: `ខ្លឹមសារមេរៀនសីលធម៌-ពលរដ្ឋវិទ្យា៖
១. និយមន័យនៃទំនាស់ (Conflict): ជាការខ្វែងគំនិត ឬការមិនយល់ស្របគ្នាលើផលប្រយោជន៍ ឬទស្សនៈ។
២. ផលវិបាកនៃការដោះស្រាយទំនាស់ដោយហិង្សា: បង្កការឈឺចាប់ បាត់បង់មិត្តភាព និងបំផ្លាញសេចក្តីសុខសាន្តក្នុងសង្គម។
៣. ជំហានដោះស្រាយទំនាស់ដោយសន្តិវិធី:
  - ជំហានទី ១: រក្សាភាពស្ងប់ស្ងាត់ និងគ្រប់គ្រងអារម្មណ៍ខឹង។
  - ជំហានទី ២: ជួបពិភាក្សាដោយស្មោះត្រង់ និងស្តាប់ទស្សនៈភាគីម្ខាងទៀតដោយការគោរព។
  - ជំហានទី ៣: ស្វែងរកចំណុចកណ្តាល (Win-Win Solution) និងការអភ័យទោសឱ្យគ្នាទៅវិញទៅមក។`
  }
];



// ==========================================================================
// 🌐 Bilingual i18n System (Khmer 🇰🇭 & English 🇬🇧)
// ==========================================================================
const I18N_DICTIONARY = {
  km: {
    appTitle: "AI Lesson Plan Studio",
    appSubtitle: "ប្រព័ន្ធបង្កើតកិច្ចតែងការបង្រៀនស្វ័យប្រវត្តិឆ្លាតវៃ",
    btnInstall: "ដំឡើងលើអេក្រង់",
    langLabel: "🇰🇭 ខ្មែរ",
    langTooltip: "ប្តូរទៅជាភាសាអង់គ្លេស / Switch to English",

    // Header buttons
    headerWheel: "បង្វិលកង",
    headerWheelTitle: "បង្វិលកងចៃដន្យ (Lucky Wheel & Group Maker)",
    headerHistory: "ប្រវត្តិ",
    headerHistoryTitle: "ប្រវត្តិកិច្ចតែងការ (History Dashboard)",
    headerLicense: "អាជ្ញាបណ្ណ",
    headerLicenseTitle: "ព័ត៌មានអាជ្ញាបណ្ណ និងការ Activate កម្មវិធី",
    headerApiKey: "API Key",
    headerApiKeyTitle: "កំណត់ ឬពិនិត្យ API Key (Gemini, Groq, OpenRouter)",
    headerUpdateTitle: "ពិនិត្យមើលកំណែអាប់ដេតថ្មី (Cloud Auto-Updater)",
    headerThemeTitle: "ប្តូរពណ៌ Theme",
    demoSelectDefault: "✨ ជ្រើសរើសមេរៀនគំរូ (Quick Demos)...",

    stepBadge1: "១",
    stepBadge2: "២",
    stepBadge3: "៣",

    templateDropPrimary: 'ទម្លាក់ឯកសារ Template នៅទីនេះ ឬ <span class="browse-link">ចុចដើម្បីរើសឯកសារ</span>',
    templateDropHint: "គាំទ្រឯកសារ Word (.docx), PDF (.pdf), PowerPoint (.pptx), ឬ Text (.txt)",

    emptyStateDesc: "សូមជ្រើសរើសទម្រង់ Upload ឯកសារមេរៀន ឬជ្រើសរើស <strong>គំរូរហ័ស</strong> នៅខាងលើ ហើយចុចប៊ូតុង <strong>បង្កើតកិច្ចតែងការស្វ័យប្រវត្តិ</strong>។",
    btnEmptyQuickDemo: "សាកល្បងជាមួយមេរៀនគំរូភ្លាមៗ",

    loadingTitle: "AI កំពុងវិភាគឯកសារ និងរៀបចំកិច្ចតែងការ...",
    loadingDesc: "កំពុងបង្កើតវត្ថុបំណង ៣ ផ្នែក សម្ភារឧបទេស និងដំណើរការបង្រៀន ៥ ជំហាន",

    // Step 1
    step1Title: "ទម្រង់កិច្ចតែងការ (Template)",
    step1Desc: "ជ្រើសរើសប្រភេទកិច្ចតែងការស្តង់ដារ MoEYS",
    labelPresetTemplate: "ជ្រើសរើសប្រភេទកិច្ចតែងការ MoEYS៖",
    optPresetStandard: "កិច្ចតែងការស្តង់ដារ ៥ ជំហាន (ទូទៅ / មធ្យមសិក្សា)",
    optPresetFlipped: "⚡ កិច្ចតែងការតាមបែបត្រឡប់ (Flipped Learning)",
    optPresetUbD: "កិច្ចតែងការតាមបែបត្រឡប់ (Backward Design / UbD ៣ ដំណាក់កាល)",
    optPresetPrimary: "កិច្ចតែងការបឋមសិក្សា (ថ្នាក់ទី ១-៦)",
    optPresetStem: "កិច្ចតែងការបែប STEM / 5E (វិទ្យាសាស្ត្រ និងពិសោធន៍)",

    // Step 2
    step2Title: "ឯកសារ និងខ្លឹមសារមេរៀន (Lesson Material)",
    step2Desc: "Upload ឬបញ្ចូលឯកសារមេរៀន ស្លាយ ឬអត្ថបទ",
    dropPrimary: 'ទម្លាក់ឯកសារមេរៀន/ស្លាយ/រូបភាព នៅទីនេះ ឬ <span class="browse-link">ចុចដើម្បីរើសឯកសារ</span>',
    dropHint: "គាំទ្រ PowerPoint (.pptx), Word (.docx), PDF (.pdf), រូបភាពថតសៀវភៅ (.png, .jpg), TXT",
    lessonContentLabel: "ខ្លឹមសារមេរៀន / ចំណុចសំខាន់ៗ",
    lessonContentPlaceholder: "បញ្ចូល ឬបិទភ្ជាប់ខ្លឹមសារមេរៀន និយមន័យ រូបមន្ត លំហាត់ ឧទាហរណ៍ ឬអត្ថបទដកស្រង់ពីសៀវភៅពុម្ពនៅទីនេះ...",

    // Step 3
    step3Title: "ព័ត៌មានរដ្ឋបាល និងវិធីសាស្ត្របង្រៀន",
    step3Desc: "កំណត់ព័ត៌មានលម្អិតសម្រាប់ក្បាលកិច្ចតែងការ",
    btnSaveAdminInfo: "រក្សាទុក",
    schoolLabel: "ឈ្មោះសាលារៀន",
    schoolPlaceholder: "ឧ. វិទ្យាស្ថានគរុកោសល្យកំពង់ចាម / វិទ្យាល័យ...",
    teacherLabel: "ឈ្មោះគ្រូបង្រៀន",
    teacherPlaceholder: "ឧ. លោកគ្រូ / អ្នកគ្រូ...",
    degreeLabel: "កម្រិតសិក្សា / ស្ថាប័នអប់រំ (Study Degree / Institute)",
    gradeLabel: "កម្រិតថ្នាក់ / ឆ្នាំសិក្សា (Grade / Class)",
    gradePlaceholder: "ឧ. ថ្នាក់ទី ៨ ក / ថ្នាក់ទី ១២A1 / ជំនាន់ទី ១៥...",
    subjectLabel: "មុខវិជ្ជា",
    durationLabel: "រយៈពេលបង្រៀន (Teaching Duration)",
    durationPlaceholder: "ឧ. ៦០ នាទី / ៣ ម៉ោង / ២ សប្តាហ៍...",
    methodLabel: "វិធីសាស្ត្របង្រៀនចម្បង",
    rememberAdminLabel: "ចងចាំព័ត៌មានរដ្ឋបាលនេះសម្រាប់លើកក្រោយ (Remember for next time)",
    chapterLabel: "ជំពូក",
    chapterPlaceholder: "ឧ. ជំពូកទី ៣: ការងារ និងថាមពល",
    lessonTitleLabel: "ចំណងជើងមេរៀន",
    lessonTitlePlaceholder: "ឧ. មេរៀនទី ២: ថាមពលមេកានិច",
    customNotesLabel: "ចំណាំ ឬសំណូមពរបន្ថែម (Prompt Customization)",
    customNotesPlaceholder: "ឧ. សុំផ្ដោតលើការពិសោធន៍ជាក់ស្ដែង និងមានល្បែងពង្រឹងពុទ្ធិ...",

    // Action buttons
    btnGenerate: "បង្កើតកិច្ចតែងការស្វ័យប្រវត្តិ (Generate)",
    btnReset: "សម្អាត",

    // Preview
    previewBadgeTitle: "សន្លឹកកិច្ចតែងការ",
    previewBadgeSub: "(Live A4)",
    editHintText: "Edit ផ្ទាល់លើសន្លឹកបាន",
    btnDownloadDocx: "Word (.docx)",
    btnDownloadPdf: "PDF",
    btnCopy: "ចម្លង",
    btnPrint: "បោះពុម្ព",
    btnCreateVideo: "🎬 វីដេអូ Micro-Lecture",

    // Footer
    partnerTag: "ដៃគូសហការផ្លូវការ (Official Partner)",
    ipCopyright: "© 2026 <strong>AI Lesson Plan Studio™</strong> & <strong>AC Mart</strong> - រក្សាសិទ្ធិគ្រប់យ៉ាង",
    ipSubtext: "បច្ចេកវិទ្យា និងទម្រង់គរុកោសល្យត្រូវបានការពារដោយច្បាប់ស្ដីពីកម្មសិទ្ធិបញ្ញានៃព្រះរាជាណាចក្រកម្ពុជា",

    // Modals
    modalHistoryTitle: "ប្រវត្តិកិច្ចតែងការ និងស្ថិតិ (Local History Dashboard)",
    modalHistoryTotalPlans: "កិច្ចតែងការសរុប",
    modalHistoryAvgGain: "មធ្យមភាគ Learning Gain (g)",
    modalHistoryRecentList: "បញ្ជីកិច្ចតែងការចុងក្រោយ (រក្សាទុកក្នុងកុំព្យូទ័រនេះ)",
    modalHistoryClearAll: "លុបប្រវត្តិទាំងអស់",

    modalPptxTitle: "បង្កើតស្លាយ PowerPoint (Gemini AI Studio)",
    modalPptxDesc: "ប្រព័ន្ធនឹងអានកិច្ចតែងការ ឬឯកសារយោង រួចរៀបចំ Master Prompt កម្រិតខ្ពស់សម្រាប់យកទៅបង្កើតស្លាយក្នុង Google Gemini (Web) ខាងក្រៅដោយស្វ័យប្រវត្តិ។",
    modalPptxSourceLabel: "ជ្រើសរើសឯកសារយោង (Source / Attachment):",
    modalPptxBtnUpload: "បង្ហោះឯកសារថ្មី",
    modalPptxNumSlidesLabel: "ចំនួនស្លាយ (Number of Slides):",
    modalPptxImagesLabel: "បញ្ចូលរូបភាពស្វ័យប្រវត្តិ? (Auto-Pictures):",
    modalPptxImagesHint: 'ជម្រើស "បង្កើតរូបភាពដោយ AI" នឹងបង្កើតរូបគំនូរអប់រំ និងដ្យាក្រាមស្របតាមខ្លឹមសារស្លាយនីមួយៗដោយស្វ័យប្រវត្តិ។',
    modalPptxThemeLabel: "រចនាបទពណ៌ (Theme Color):",
    modalPptxBtnCancel: "បោះបង់",
    modalPptxBtnGenerate: "បង្កើតស្លាយជាមួយ Gemini Web",

    modalUpdateTitle: "ប្រព័ន្ធអាប់ដេតស្វ័យប្រវត្ត (Cloud Auto-Updater)",
    modalUpdateInstalledVersion: "កំណែកម្មវិធីបច្ចុប្បន្ន (Installed Version):",
    modalUpdateBtnCheckNow: "ពិនិត្យមើលឥឡូវនេះ",
    modalUpdateBtnApply: "⚡ អាប់ដេតឥឡូវនេះ (Update Now)",

    modalLicenseTitle: "គ្រប់គ្រងអាជ្ញាបណ្ណកម្មសិទ្ធិបញ្ញា (License Activation)",
    modalLicenseMachineIdLabel: "កូដសម្គាល់កុំព្យូទ័ររបស់អ្នក (Customer Machine ID)",
    modalLicenseBtnCopyId: "ចម្លង",
    modalLicenseBtnSendTg: "✈️ ផ្ញើតាម Telegram",
    modalLicenseTgHelp: '💡 ចុចប៊ូតុង <strong>«✈️ ផ្ញើតាម Telegram»</strong> ដើម្បីផ្ញើ Machine ID នេះទៅកាន់អ្នកលក់ភ្លាមៗ ដើម្បីទទួលបានលេខកូដ License Key។',
    modalLicenseKeyLabel: "បញ្ចូលលេខកូដអាជ្ញាបណ្ណ (Enter License Key)",
    modalLicenseBtnActivate: "ធ្វើឱ្យសកម្ម (Activate)",

    modalSavedPlansTitle: "បណ្ណាល័យកិច្ចតែងការដែលបានរក្សាទុក (Saved Lesson Plans)",
    modalSavedPlansSearchPlaceholder: "ស្វែងរកតាមចំណងជើងមេរៀន មុខវិជ្ជា ថ្នាក់ ឬកាលបរិច្ឆេទ...",
    modalSavedPlansFilterAll: "-- គ្រប់មុខវិជ្ជា --",

    // Learning Gain Modal
    modalLearningGainTitle: "ម៉ាស៊ីនគណនា Learning Gain (Hake's Normalized Gain)",
    gainPreTestLabel: "ពិន្ទុមធ្យម Pre-Test (% ឬពិន្ទុ)",
    gainPostTestLabel: "ពិន្ទុមធ្យម Post-Test (% ឬពិន្ទុ)",
    gainResultLabel: "អត្រាកំណើននៃការរៀនសូត្រ (Normalized Gain - g)",
    btnApplyGain: "បញ្ចូលក្នុងកិច្ចតែងការ",
    btnClose: "បិទ",

    msgMissingInfo: "សូមបញ្ចូលចំណងជើងមេរៀន ឬខ្លឹមសារមេរៀនជាមុនសិន!",
    msgLangSwitched: "បានប្តូរទៅជាភាសាខ្មែរ 🇰🇭"
  },
  en: {
    appTitle: "AI Lesson Plan Studio",
    appSubtitle: "Intelligent Automated Lesson Plan Generator",
    btnInstall: "Install App",
    langLabel: "🇬🇧 English",
    langTooltip: "Switch to Khmer / ប្តូរជាភាសាខ្មែរ",

    // Header buttons
    headerWheel: "Lucky Wheel",
    headerWheelTitle: "Lucky Wheel & Random Selector",
    headerHistory: "History",
    headerHistoryTitle: "Lesson Plan History Dashboard",
    headerLicense: "License",
    headerLicenseTitle: "License Information & App Activation",
    headerApiKey: "API Key",
    headerApiKeyTitle: "Configure or check AI API Key (Gemini, Groq, OpenRouter)",
    headerUpdateTitle: "Check for Updates (Cloud Auto-Updater)",
    headerThemeTitle: "Toggle Light / Dark Theme",
    demoSelectDefault: "✨ Select Demo Lesson (Quick Demos)...",

    stepBadge1: "1",
    stepBadge2: "2",
    stepBadge3: "3",

    templateDropPrimary: 'Drop template file here or <span class="browse-link">browse files</span>',
    templateDropHint: "Supports Word (.docx), PDF (.pdf), PowerPoint (.pptx), or TXT (.txt)",

    dropPrimary: 'Drop lesson files/slides/images here or <span class="browse-link">browse files</span>',
    dropHint: "Supports PowerPoint (.pptx), Word (.docx), PDF (.pdf), Book photos (.png, .jpg), TXT",

    emptyStateDesc: "Select a lesson format, upload lesson materials or excerpts, and click <strong>Generate Lesson Plan</strong>.",
    btnEmptyQuickDemo: "Try with Demo Lesson Now",

    loadingTitle: "AI is analyzing materials and structuring lesson plan...",
    loadingDesc: "Formulating 3-domain learning objectives, teaching aids, and 5-step active pedagogy",

    // Step 1
    step1Title: "Lesson Plan Template",
    step1Desc: "Select MoEYS Standard Official Template",
    labelPresetTemplate: "Select Lesson Plan Format:",
    optPresetStandard: "Standard 5-Step Lesson Plan (General / Secondary)",
    optPresetFlipped: "⚡ Flipped Learning Lesson Plan",
    optPresetUbD: "Backward Design / UbD (3-Stage Framework)",
    optPresetPrimary: "Primary School Lesson Plan (Grades 1-6)",
    optPresetStem: "STEM / 5E Inquiry Lesson Plan (Science & Experiments)",

    // Step 2
    step2Title: "Lesson Material & Content",
    step2Desc: "Upload or paste lesson files, slides, or textbook excerpts",
    dropPrimary: 'Drop lesson files/slides/images here or <span class="browse-link">browse files</span>',
    dropHint: "Supports PowerPoint (.pptx), Word (.docx), PDF (.pdf), Book photos (.png, .jpg), TXT",
    lessonContentLabel: "Lesson Content / Key Concepts",
    lessonContentPlaceholder: "Enter or paste lesson text, definitions, formulas, exercises, examples, or textbook excerpts here...",

    // Step 3
    step3Title: "Administrative Details & Teaching Method",
    step3Desc: "Configure lesson header information and class details",
    btnSaveAdminInfo: "Save Profile",
    schoolLabel: "School / Institution Name",
    schoolPlaceholder: "e.g., Preah Sisowath High School / Institute...",
    teacherLabel: "Teacher Name",
    teacherPlaceholder: "e.g., Mr. Borey Kem / Teacher...",
    degreeLabel: "Education Level / Institution Type",
    gradeLabel: "Grade Level / Academic Year",
    gradePlaceholder: "e.g., Grade 8 A / Grade 12 A1 / Batch 15...",
    subjectLabel: "Subject",
    durationLabel: "Teaching Duration",
    durationPlaceholder: "e.g., 60 mins / 3 periods / 2 weeks...",
    methodLabel: "Primary Teaching Methodology",
    rememberAdminLabel: "Remember administrative info for next time",
    chapterLabel: "Chapter / Unit",
    chapterPlaceholder: "e.g., Chapter 3: Work and Energy",
    lessonTitleLabel: "Lesson Title",
    lessonTitlePlaceholder: "e.g., Lesson 2: Mechanical Energy",
    customNotesLabel: "Notes or Custom Prompt Instructions",
    customNotesPlaceholder: "e.g., Focus on hands-on inquiry, gamified formative assessments...",

    // Action buttons
    btnGenerate: "Generate Lesson Plan (AI Studio)",
    btnReset: "Reset Form",

    // Preview
    previewBadgeTitle: "Lesson Plan Document",
    previewBadgeSub: "(Live A4)",
    editHintText: "Direct Inline Editing Enabled",
    btnDownloadDocx: "Word (.docx)",
    btnDownloadPdf: "PDF",
    btnCopy: "Copy",
    btnPrint: "Print",
    btnCreateVideo: "🎬 Create Video",

    // Footer
    partnerTag: "Official Partner (ដៃគូសហការផ្លូវការ)",
    ipCopyright: "© 2026 <strong>AI Lesson Plan Studio™</strong> & <strong>AC Mart</strong> - All Rights Reserved",
    ipSubtext: "Educational technology & pedagogical structure protected by Intellectual Property law of Cambodia",

    // Modals
    modalHistoryTitle: "Lesson Plan History & Statistics (Local Dashboard)",
    modalHistoryTotalPlans: "Total Lesson Plans",
    modalHistoryAvgGain: "Average Learning Gain (g)",
    modalHistoryRecentList: "Recent Lesson Plans (Saved on this device)",
    modalHistoryClearAll: "Clear All History",

    modalPptxTitle: "PowerPoint Slides Studio (Gemini AI)",
    modalPptxDesc: "The system reads your lesson plan or attached document to craft an advanced Master Prompt, copies it to clipboard, and opens Gemini Web automatically.",
    modalPptxSourceLabel: "Select Reference Source / Attachment:",
    modalPptxBtnUpload: "Upload New File",
    modalPptxNumSlidesLabel: "Number of Slides:",
    modalPptxImagesLabel: "Auto-Include Visuals? (Auto-Pictures):",
    modalPptxImagesHint: 'The "AI Generated Images" option will automatically generate educational diagrams and illustrations aligned with each slide topic.',
    modalPptxThemeLabel: "Theme Color:",
    modalPptxBtnCancel: "Cancel",
    modalPptxBtnGenerate: "Generate Slides via Gemini Web",

    modalUpdateTitle: "Cloud Auto-Updater System",
    modalUpdateInstalledVersion: "Installed App Version:",
    modalUpdateBtnCheckNow: "Check Now",
    modalUpdateBtnApply: "⚡ Update Now",

    modalLicenseTitle: "License & Commercial Activation",
    modalLicenseMachineIdLabel: "Your Customer Machine ID",
    modalLicenseBtnCopyId: "Copy",
    modalLicenseBtnSendTg: "✈️ Send via Telegram",
    modalLicenseTgHelp: '💡 Click <strong>"✈️ Send via Telegram"</strong> to send this Machine ID to vendor immediately to receive your License Key.',
    modalLicenseKeyLabel: "Enter License Key",
    modalLicenseBtnActivate: "Activate License",

    modalSavedPlansTitle: "Saved Lesson Plans Library",
    modalSavedPlansSearchPlaceholder: "Search by lesson title, subject, grade, or date...",
    modalSavedPlansFilterAll: "-- All Subjects --",

    // Learning Gain Modal
    modalLearningGainTitle: "Learning Gain Calculator (Hake's Normalized Gain)",
    gainPreTestLabel: "Average Pre-Test Score (% or points)",
    gainPostTestLabel: "Average Post-Test Score (% or points)",
    gainResultLabel: "Normalized Learning Gain (g)",
    btnApplyGain: "Insert into Lesson Plan",
    btnClose: "Close",

    // Alerts
    msgMissingInfo: "Please enter a lesson title or lesson content first!",
    msgLangSwitched: "Switched to English language 🇬🇧"
  }
};

function setLanguage(lang, showNotification = false) {
  if (lang !== 'en' && lang !== 'km') lang = 'km';
  state.language = lang;
  try {
    localStorage.setItem('app_language', lang);
  } catch (e) {}

  document.documentElement.lang = (lang === 'en') ? 'en' : 'km';
  const dict = I18N_DICTIONARY[lang] || I18N_DICTIONARY.km;
  const isEn = (lang === 'en');

  // 1. Update Language Switcher Button Label & Title
  const langLabel = document.getElementById('langSwitchLabel');
  const btnLang = document.getElementById('btnLanguageToggle');
  if (langLabel) langLabel.textContent = dict.langLabel;
  if (btnLang) btnLang.title = dict.langTooltip;

  // 2. Translate elements with data-i18n
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (dict[key] !== undefined) {
      el.innerHTML = dict[key];
    }
  });

  // 3. Header Buttons (Lucky Wheel, History, License, Updates, Demos)
  const btnWheel = document.getElementById('btnWheel');
  const headerWheelLabel = document.getElementById('headerWheelLabel');
  if (btnWheel) btnWheel.title = dict.headerWheelTitle;
  if (headerWheelLabel) headerWheelLabel.textContent = dict.headerWheel;

  const btnHeaderHist = document.getElementById('btnHeaderHistory');
  const headerHistLabel = document.getElementById('headerHistoryLabel');
  if (btnHeaderHist) btnHeaderHist.title = dict.headerHistoryTitle;
  if (headerHistLabel) headerHistLabel.textContent = dict.headerHistory;

  const btnLicense = document.getElementById('btnOpenLicenseModal');
  const headerLicenseLabel = document.getElementById('headerLicenseLabel');
  if (btnLicense) btnLicense.title = dict.headerLicenseTitle;
  if (headerLicenseLabel) headerLicenseLabel.textContent = dict.headerLicense;

  const btnApiKeyEl = document.getElementById('btnApiKey');
  const headerApiKeyLabel = document.getElementById('headerApiKeyLabel');
  if (btnApiKeyEl) btnApiKeyEl.title = dict.headerApiKeyTitle;
  if (headerApiKeyLabel) headerApiKeyLabel.textContent = dict.headerApiKey;

  const btnCheckUpdate = document.getElementById('btnCheckUpdate');
  if (btnCheckUpdate) btnCheckUpdate.title = dict.headerUpdateTitle;

  const btnTheme = document.getElementById('btnThemeToggle');
  if (btnTheme) btnTheme.title = dict.headerThemeTitle;

  const sampleLessonsSelect = document.getElementById('sampleLessonsSelect');
  if (sampleLessonsSelect && sampleLessonsSelect.options.length > 0) {
    sampleLessonsSelect.options[0].text = dict.demoSelectDefault;
  }

  // 4. Translate placeholders
  const placeholderMap = {
    inputSchool: dict.schoolPlaceholder,
    inputTeacher: dict.teacherPlaceholder,
    inputCustomGradeText: dict.gradePlaceholder,
    inputCustomDurationText: dict.durationPlaceholder,
    inputChapter: dict.chapterPlaceholder,
    inputLessonTitle: dict.lessonTitlePlaceholder,
    inputCustomNotes: dict.customNotesPlaceholder,
    lessonContentText: dict.lessonContentPlaceholder
  };
  Object.keys(placeholderMap).forEach((id) => {
    const el = document.getElementById(id);
    if (el && placeholderMap[id]) el.placeholder = placeholderMap[id];
  });

  // 5. Translate Dropzone Text
  const dropPrimary = document.getElementById('dropPrimaryText');
  const dropHint = document.getElementById('dropHintText');
  if (dropPrimary) dropPrimary.innerHTML = dict.dropPrimary;
  if (dropHint) dropHint.textContent = dict.dropHint;

  // 6. Translate Preset Template Select
  const presetSelect = document.getElementById('presetTemplateSelect');
  if (presetSelect && presetSelect.options.length >= 2) {
    presetSelect.options[0].text = dict.optPresetStandard;
    presetSelect.options[1].text = dict.optPresetFlipped;
    if (presetSelect.options.length >= 5) {
      presetSelect.options[2].text = dict.optPresetUbD;
      presetSelect.options[3].text = dict.optPresetPrimary;
      presetSelect.options[4].text = dict.optPresetStem;
    }
  }

  // 7. Translate Degree Select
  const degreeSelect = document.getElementById('inputDegree');
  if (degreeSelect && degreeSelect.options.length >= 9) {
    const degreesEn = [
      "🏫 Lower Secondary (Grades 7-9)",
      "🎓 Upper Secondary (Grades 10-12)",
      "📚 Primary Education (Grades 1-6)",
      "🌱 Kindergarten / Early Childhood",
      "🏛️ TEC Kampong Cham Institute",
      "👨‍🏫 Teacher Training & NIE",
      "🏛️ Higher Education / University",
      "🛠️ TVET / Vocational Training",
      "✏️ Custom / Other"
    ];
    const degreesKm = [
      "🏫 អនុវិទ្យាល័យ (Lower Secondary: ថ្នាក់ទី ៧-៩)",
      "🎓 វិទ្យាល័យ (Upper Secondary: ថ្នាក់ទី ១០-១២)",
      "📚 បឋមសិក្សា (Primary: ថ្នាក់ទី ១-៦)",
      "🌱 មត្តេយ្យសិក្សា (Kindergarten)",
      "🏛️ វិទ្យាស្ថានគរុកោសល្យកំពង់ចាម (TEC Kampong Cham)",
      "👨‍🏫 គរុកោសល្យ និង NIE (Teacher Training)",
      "🏛️ ឧត្តមសិក្សា / បរិញ្ញាបត្រ (Higher Education)",
      "🛠️ បណ្តុះបណ្តាលវិជ្ជាជីវៈ (TVET / Vocational)",
      "✏️ ផ្សេងៗ / បញ្ចូលផ្ទាល់ (Custom)"
    ];
    const targetDegrees = isEn ? degreesEn : degreesKm;
    for (let i = 0; i < targetDegrees.length; i++) {
      if (degreeSelect.options[i]) degreeSelect.options[i].text = targetDegrees[i];
    }
  }

  // 8. Translate Subjects
  const subjectSelect = document.getElementById('inputSubject');
  if (subjectSelect && subjectSelect.options.length >= 12) {
    const subjectsEn = [
      "Physics", "Mathematics", "Khmer Literature", "Educational Psychology",
      "Computer Science (ICT)", "Chemistry", "Biology", "History",
      "Geography", "Civics & Morality", "English", "Earth Science"
    ];
    const subjectsKm = [
      "រូបវិទ្យា", "គណិតវិទ្យា", "ភាសាខ្មែរ", "ចិត្តវិទ្យាអប់រំ",
      "ព័ត៌មានវិទ្យា (ICT / Computer)", "គីមីវិទ្យា", "ជីវវិទ្យា", "ប្រវត្តិវិទ្យា",
      "ភូមិវិទ្យា", "ពលរដ្ឋវិជ្ជា", "ភាសាអង់គ្លេស", "ផែនដីវិទ្យា"
    ];
    const targetSubjects = isEn ? subjectsEn : subjectsKm;
    for (let i = 0; i < targetSubjects.length; i++) {
      if (subjectSelect.options[i]) subjectSelect.options[i].text = targetSubjects[i];
    }
  }

  // 9. Translate Duration
  const durSelect = document.getElementById('inputDurationSelect');
  if (durSelect && durSelect.options.length >= 9) {
    const durEn = [
      "50 mins (1 period)", "45 mins (1 period)", "90 mins (2 periods)",
      "100 mins (2 periods)", "135 mins (3 periods)", "150 mins (3 periods)",
      "180 mins (4 periods / workshop)", "240 mins (1 day / short course)", "✏️ Custom"
    ];
    const durKm = [
      "៥០ នាទី (១ ម៉ោងសិក្សា)", "៤៥ នាទី (១ ម៉ោងសិក្សា)", "៩០ នាទី (២ ម៉ោងសិក្សា)",
      "១០០ នាទី (២ ម៉ោងសិក្សា)", "១៣៥ នាទី (៣ ម៉ោងសិក្សា)", "១៥០ នាទី (៣ ម៉ោងសិក្សា)",
      "១៨០ នាទី (៤ ម៉ោងសិក្សា / សិក្ខាសាលា)", "២៤០ នាទី (១ ថ្ងៃ / វគ្គខ្លី)", "✏️ ផ្សេងៗ / បញ្ចូលផ្ទាល់ (Custom)"
    ];
    const targetDur = isEn ? durEn : durKm;
    for (let i = 0; i < targetDur.length; i++) {
      if (durSelect.options[i]) durSelect.options[i].text = targetDur[i];
    }
  }

  // 10. Translate Methods
  const methodSelect = document.getElementById('inputMethod');
  if (methodSelect && methodSelect.options.length >= 5) {
    const methodsEn = [
      "Student-Centered Active Learning Approach",
      "Advanced Collaborative Methods (Jigsaw, Concept Mapping, Role-Play)",
      "Inquiry-Based & 5E STEM Model",
      "Group Discussion & Problem-Based Learning",
      "Direct Instruction & Practical Demonstration"
    ];
    const methodsKm = [
      "សិស្សមជ្ឈមណ្ឌល (Student-Centered Approach)",
      "វិធីសាស្ត្រសហការកម្រិតខ្ពស់ (Jigsaw, Concept Mapping, Role-Play)",
      "ការរិះរក និងពិសោធន៍ តាមបែប 5E (Inquiry-based / STEM)",
      "ការពិភាក្សាជាក្រុម និងការដោះស្រាយបញ្ហា (Problem-Based)",
      "ការពន្យល់បង្ហាញ និងអនុវត្តជាក់ស្តែង (Direct Instruction)"
    ];
    const targetMethods = isEn ? methodsEn : methodsKm;
    for (let i = 0; i < targetMethods.length; i++) {
      if (methodSelect.options[i]) methodSelect.options[i].text = targetMethods[i];
    }
  }

  // 11. Saved Profile Badge
  const savedProfileBadge = document.getElementById('savedProfileBadge');
  if (savedProfileBadge) {
    savedProfileBadge.innerHTML = `<i class="fa-solid fa-check"></i> ${isEn ? 'Saved' : 'បានចងចាំ'}`;
  }

  // 12. Re-populate localized grades based on current degree
  if (degreeSelect) {
    const currentGrade = document.getElementById('inputGrade') ? document.getElementById('inputGrade').value : null;
    updateGradeOptions(degreeSelect.value, currentGrade);
  }

  // 13. PPTX Modal Controls & Options
  const pptxSrc = document.getElementById('pptxSourceSelect');
  if (pptxSrc && pptxSrc.options.length >= 4) {
    pptxSrc.options[0].text = isEn ? "📄 Current Lesson Plan" : "📄 កិច្ចតែងការបច្ចុប្បន្ន (Current Lesson Plan)";
    pptxSrc.options[1].text = isEn ? "📂 Uploaded Lesson File" : "📂 ឯកសារមេរៀនដែលបានផ្ទុកឡើង (Uploaded Lesson File)";
    pptxSrc.options[2].text = isEn ? "📋 Saved Plan from History" : "📋 កិច្ចតែងការពីប្រវត្តិ (Saved Plan from History)";
    pptxSrc.options[3].text = isEn ? "📤 Newly Attached File" : "📤 ឯកសារដែលទើបបង្ហោះ (Newly Attached File)";
  }

  const pptxUploadLabel = document.getElementById('pptxUploadedFileLabel');
  if (pptxUploadLabel) pptxUploadLabel.textContent = isEn ? "Attached File" : "ឯកសារភ្ជាប់";

  const pptxSlides = document.getElementById('pptxNumSlides');
  if (pptxSlides && pptxSlides.options.length >= 7) {
    const slidesEn = [
      "4 Slides (Quick Summary)",
      "6 Slides (Short Overview)",
      "8 Slides (Standard 45-50 mins / MoEYS)",
      "10 Slides (Comprehensive Lesson)",
      "12 Slides (Detailed Multi-Section)",
      "15 Slides (Deep Dive Workshop)",
      "20 Slides (Full Master Lecture)"
    ];
    const slidesKm = [
      "៤ ស្លាយ (សង្ខេបខ្លីបំផុត / Quick Summary)",
      "៦ ស្លាយ (ខ្លីល្មម / Short Overview)",
      "៨ ស្លាយ (ស្តង់ដារ ៤៥-៥០ នាទី / Standard MoEYS)",
      "១០ ស្លាយ (ទូទៅទូលំទូលាយ / Comprehensive Lesson)",
      "១២ ស្លាយ (វែង និងលម្អិត / Detailed Multi-Section)",
      "១៥ ស្លាយ (កម្រិតខ្ពស់ / Deep Dive Workshop)",
      "២០ ស្លាយ (មេរៀនធំទូលាយពេញលេញ / Full Master Lecture)"
    ];
    const targetSlides = isEn ? slidesEn : slidesKm;
    for (let i = 0; i < targetSlides.length; i++) {
      if (pptxSlides.options[i]) pptxSlides.options[i].text = targetSlides[i];
    }
  }

  const pptxImg = document.getElementById('pptxIncludeImages');
  if (pptxImg && pptxImg.options.length >= 3) {
    pptxImg.options[0].text = isEn ? "🎨 AI Generated Images (Educational AI / Pollinations)" : "🎨 បង្កើតរូបភាពដោយ AI (AI Image Generator - Pollinations / Educational AI)";
    pptxImg.options[1].text = isEn ? "🌐 Web Stock Photos" : "🌐 ទាញយករូបភាពពីអ៊ីនធឺណិត (Web Stock Photos)";
    pptxImg.options[2].text = isEn ? "📄 Text Only (No Images)" : "📄 ទេ (ស្លាយអក្សរសុទ្ធ / Text Only)";
  }

  const pptxTheme = document.getElementById('pptxTheme');
  if (pptxTheme && pptxTheme.options.length >= 4) {
    pptxTheme.options[0].text = isEn ? "Modern Blue (MoEYS Standard)" : "Modern Blue (ខៀវទំនើប - ស្តង់ដារ MoEYS)";
    pptxTheme.options[1].text = isEn ? "Eco Green (Nature / Biology)" : "Eco Green (បៃតងធម្មជាតិ - ជីវវិទ្យា/បរិស្ថាន)";
    pptxTheme.options[2].text = isEn ? "Dark Mode (Modern High-Tech)" : "Dark Mode (ស្រមោលងងឹត - ទំនើប/បច្ចេកវិទ្យា)";
    pptxTheme.options[3].text = isEn ? "Simple Light (Clean Print)" : "Simple Light (ស/ស្អាត - ងាយស្រួលបោះពុម្ព)";
  }

  if (typeof refreshPptxSourceAlert === 'function') {
    refreshPptxSourceAlert();
  }

  // 14. Saved Plans Modal Filters & Search
  const searchPlans = document.getElementById('searchSavedPlansInput');
  const filterSubj = document.getElementById('filterSavedPlansSubject');
  if (searchPlans) searchPlans.placeholder = dict.modalSavedPlansSearchPlaceholder;
  if (filterSubj && filterSubj.options.length > 0) filterSubj.options[0].text = dict.modalSavedPlansFilterAll;

  // 15. History Modal if active
  const histModal = document.getElementById('historyModal');
  if (histModal && histModal.classList.contains('active') && typeof renderHistoryList === 'function') {
    renderHistoryList();
  }

  // Recalculate learning gain for current language
  if (typeof calculateLearningGain === 'function') {
    calculateLearningGain();
  }

  // Update word counter
  updateWordCount();

  // 16. Translate tooltips and action buttons
  const btnWord = document.getElementById('btnExportWord');
  const btnPdf = document.getElementById('btnPrintPdf');
  const btnCopy = document.getElementById('btnCopyText');
  const btnNblm = document.getElementById('btnOpenNotebookLM');
  const btnGain = document.getElementById('btnOpenLearningGainModal');
  const btnInstall = document.getElementById('btnInstallApp');
  const btnReset = document.getElementById('btnReset');
  const btnPptx = document.getElementById('btnExportPptx');
  const btnPre = document.getElementById('btnToolbarPreTest');
  const btnPost = document.getElementById('btnToolbarPostTest');

  if (btnWord) btnWord.title = isEn ? "Download Microsoft Word (.docx)" : "ទាញយកជាឯកសារ Microsoft Word (.docx)";
  if (btnPdf) btnPdf.title = isEn ? "Print or Save as PDF" : "បោះពុម្ព ឬរក្សាទុកជា PDF";
  if (btnCopy) btnCopy.title = isEn ? "Copy All Text" : "ចម្លងអត្ថបទទាំងអស់";
  if (btnNblm) btnNblm.title = isEn ? "Open Google NotebookLM for AI Audio/Video" : "បើក Google NotebookLM ដើម្បីបង្កើត AI Audio Overview / Video";
  if (btnGain) btnGain.title = isEn ? "Calculate Hake's Normalized Learning Gain" : "គណនាអត្រាកំណើននៃការរៀនសូត្រ (Hake's Normalized Learning Gain)";
  if (btnInstall) btnInstall.title = isEn ? "Install Application on Screen (PWA)" : "ដំឡើងកម្មវិធីលើអេក្រង់កុំព្យូទ័រ ឬទូរស័ព្ទ (Install App)";
  if (btnReset) btnReset.title = isEn ? "Reset Form Inputs" : "កំណត់ទិន្នន័យឡើងវិញ";
  if (btnPptx) btnPptx.title = isEn ? "Generate & Download PowerPoint (.pptx)" : "បង្កើត និងទាញយកស្លាយ PowerPoint (.pptx)";
  if (btnPre) btnPre.title = isEn ? "Generate Diagnostic Pre-Test (QCM)" : "បង្កើតបុរេតេស្ត (Pre-Test QCM)";
  if (btnPost) btnPost.title = isEn ? "Generate Mastery Post-Test (MCQ)" : "បង្កើតបច្ឆាតេស្ត (Post-Test MCQ)";

  // If a document is currently active on screen, re-render headers with new language
  const printDoc = document.getElementById('printableDoc');
  if (printDoc && printDoc.style.display !== 'none' && state.generatedPlanData) {
    renderLessonPlanToA4(state.generatedPlanData);
  }

  if (showNotification && typeof showToast === 'function') {
    showToast(dict.msgLangSwitched, 'success');
  }
}

function toggleLanguage() {
  const currentLang = state.language || localStorage.getItem('app_language') || 'km';
  const newLang = (currentLang === 'en') ? 'km' : 'en';
  setLanguage(newLang, true);
}
window.setLanguage = setLanguage;
window.toggleLanguage = toggleLanguage;

// Study Degrees & Grades Dictionary
const STUDY_DEGREES = {
  lower_sec: {
    id: "lower_sec",
    name: "🏫 អនុវិទ្យាល័យ (Lower Secondary: ថ្នាក់ទី ៧-៩)",
    shortName: "អនុវិទ្យាល័យ",
    grades: ["ថ្នាក់ទី ៧", "ថ្នាក់ទី ៨", "ថ្នាក់ទី ៩"]
  },
  upper_sec: {
    id: "upper_sec",
    name: "🎓 វិទ្យាល័យ (Upper Secondary: ថ្នាក់ទី ១០-១២)",
    shortName: "វិទ្យាល័យ",
    grades: ["ថ្នាក់ទី ១០", "ថ្នាក់ទី ១១", "ថ្នាក់ទី ១២"]
  },
  primary: {
    id: "primary",
    name: "📚 បឋមសិក្សា (Primary: ថ្នាក់ទី ១-៦)",
    shortName: "បឋមសិក្សា",
    grades: ["ថ្នាក់ទី ១", "ថ្នាក់ទី ២", "ថ្នាក់ទី ៣", "ថ្នាក់ទី ៤", "ថ្នាក់ទី ៥", "ថ្នាក់ទី ៦"]
  },
  kindergarten: {
    id: "kindergarten",
    name: "🌱 មត្តេយ្យសិក្សា (Kindergarten)",
    shortName: "មត្តេយ្យសិក្សា",
    grades: [
      "មត្តេយ្យកម្រិតទាប (អាយុ ៣ ឆ្នាំ)",
      "មត្តេយ្យកម្រិតមធ្យម (អាយុ ៤ ឆ្នាំ)",
      "មត្តេយ្យកម្រិតខ្ពស់ (អាយុ ៥ ឆ្នាំ)"
    ]
  },
  tec_kampongcham: {
    id: "tec_kampongcham",
    name: "🏛️ វិទ្យាស្ថានគរុកោសល្យកំពង់ចាម (TEC Kampong Cham)",
    shortName: "វិទ្យាស្ថានគរុកោសល្យកំពង់ចាម",
    grades: [
      "គរុនិស្សិត ឆ្នាំទី ១ (បរិញ្ញាបត្រអប់រំ ១២+៤)",
      "គរុនិស្សិត ឆ្នាំទី ២ (បរិញ្ញាបត្រអប់រំ ១២+៤)",
      "គរុនិស្សិត ឆ្នាំទី ៣ (បរិញ្ញាបត្រអប់រំ ១២+៤)",
      "គរុនិស្សិត ឆ្នាំទី ៤ (បរិញ្ញាបត្រអប់រំ ១២+៤)",
      "គរុសិស្សមូលដ្ឋាន (១២+២ / អនុវិទ្យាល័យ)",
      "គរុសិស្សបឋមសិក្សា (១២+២ / បឋមសិក្សា)",
      "គរុសិស្សមត្តេយ្យសិក្សា",
      "វគ្គបណ្តុះបណ្តាលវិក្រឹតការ / អភិវឌ្ឍវិជ្ជាជីវៈ"
    ]
  },
  teacher_training: {
    id: "teacher_training",
    name: "👨‍🏫 គរុកោសល្យ និង NIE (Teacher Training & NIE)",
    shortName: "គរុកោសល្យ",
    grades: [
      "គរុកោសល្យមត្តេយ្យ",
      "គរុសិស្សបឋមសិក្សា (១២+២)",
      "គរុសិស្សមូលដ្ឋាន (១២+២ / គរុកោសល្យភូមិភាគ)",
      "គរុនិស្សិត TEC (១២+៤ / វិទ្យាស្ថានគរុកោសល្យ)",
      "គរុសិស្សជាន់ខ្ពស់ (១២+៤ / NIE)"
    ]
  },
  higher_ed: {
    id: "higher_ed",
    name: "🏛️ ឧត្តមសិក្សា / បរិញ្ញាបត្រ (Higher Education)",
    shortName: "ឧត្តមសិក្សា",
    grades: [
      "បរិញ្ញាបត្រ ឆ្នាំទី ១ (ឆ្នាំសិក្សាមូលដ្ឋាន)",
      "បរិញ្ញាបត្រ ឆ្នាំទី ២",
      "បរិញ្ញាបត្រ ឆ្នាំទី ៣",
      "បរិញ្ញាបត្រ ឆ្នាំទី ៤",
      "ថ្នាក់អនុបណ្ឌិត (Master's Degree)",
      "ថ្នាក់បណ្ឌិត (Doctorate / PhD)"
    ]
  },
  tvet: {
    id: "tvet",
    name: "🛠️ បណ្តុះបណ្តាលវិជ្ជាជីវៈ (TVET / Vocational)",
    shortName: "បណ្តុះបណ្តាលវិជ្ជាជីវៈ",
    grades: [
      "វិញ្ញាបនបត្របច្ចេកទេស និងវិជ្ជាជីវៈ (C1/C2/C3)",
      "សញ្ញាបត្រជាន់ខ្ពស់បច្ចេកទេស (Higher Diploma)",
      "វគ្គបណ្តុះបណ្តាលខ្លី"
    ]
  },
  custom: {
    id: "custom",
    name: "✏️ ផ្សេងៗ / បញ្ចូលផ្ទាល់ (Custom)",
    shortName: "ផ្សេងៗ",
    grades: []
  }
};

// Populate Grades Dropdown based on Selected Study Degree
function updateGradeOptions(degreeKey, preselectGrade = null) {
  const gradeSelect = document.getElementById('inputGrade');
  const customWrap = document.getElementById('customGradeInputWrap');
  const customText = document.getElementById('inputCustomGradeText');
  const degree = STUDY_DEGREES[degreeKey];

  if (!gradeSelect) return;
  gradeSelect.innerHTML = '';

  if (!degree || degreeKey === 'custom') {
    const opt = document.createElement('option');
    opt.value = 'custom';
    opt.textContent = (state.language === 'en') ? '-- Enter Custom Grade... --' : '-- បញ្ចូលថ្នាក់រៀនផ្ទាល់ខ្លួន... --';
    opt.selected = true;
    gradeSelect.appendChild(opt);
    if (customWrap) customWrap.style.display = 'block';
    if (preselectGrade && customText) customText.value = preselectGrade;
    return;
  }

    let matched = false;
  degree.grades.forEach((g, idx) => {
    let displayText = g;
    if (state.language === 'en') {
      displayText = g.replace('ថ្នាក់ទី ', 'Grade ')
                     .replace('មត្តេយ្យ', 'Kindergarten ')
                     .replace('គរុនិស្សិត ឆ្នាំទី ', 'Pre-service Teacher Year ')
                     .replace('គរុសិស្ស', 'Teacher Trainee ')
                     .replace('បរិញ្ញាបត្រ ឆ្នាំទី ', 'Bachelor Year ')
                     .replace('ឆ្នាំទី ', 'Year ');
    }
    const opt = document.createElement('option');
    opt.value = g;
    opt.textContent = displayText;
    if (preselectGrade && preselectGrade === g) {
      opt.selected = true;
      matched = true;
    } else if (!preselectGrade && idx === 0) {
      opt.selected = true;
      matched = true;
    }
    gradeSelect.appendChild(opt);
  });

  // Add custom fallback option at the bottom
  const customOpt = document.createElement('option');
  customOpt.value = 'custom';
  customOpt.textContent = (state.language === 'en') ? '-- Enter Other Grade... --' : '-- បញ្ចូលថ្នាក់រៀនផ្សេងទៀត... --';
  gradeSelect.appendChild(customOpt);

  if (preselectGrade && !matched) {
    customOpt.selected = true;
    if (customWrap) customWrap.style.display = 'block';
    if (customText) customText.value = preselectGrade;
  } else {
    if (customWrap) customWrap.style.display = 'none';
  }
}

// Get Grade Value helper (Handles Preset + Custom)
function getGradeValue() {
  const select = document.getElementById('inputGrade');
  if (!select) return '';
  if (select.value === 'custom') {
    const customText = document.getElementById('inputCustomGradeText');
    return customText ? customText.value.trim() : '';
  }
  return select.value;
}

// Get Duration Value helper (Handles Preset + Custom)
function getDurationValue() {
  const select = document.getElementById('inputDurationSelect');
  if (!select) return '៥០ នាទី (១ ម៉ោងសិក្សា)';
  if (select.value === 'custom') {
    const customText = document.getElementById('inputCustomDurationText');
    return (customText && customText.value.trim()) ? customText.value.trim() : '៥០ នាទី (១ ម៉ោងសិក្សា)';
  }
  return select.value;
}

// Convert Khmer numerals to English
function khmerToEnDigits(str) {
  if (!str) return '';
  const map = { '០':'0', '១':'1', '២':'2', '៣':'3', '៤':'4', '៥':'5', '៦':'6', '៧':'7', '៨':'8', '៩':'9' };
  return String(str).replace(/[០-៩]/g, d => map[d] || d);
}

// Convert English numerals to Khmer
function toKhmerNumber(num) {
  const map = ['០', '១', '២', '៣', '៤', '៥', '៦', '៧', '៨', '៩'];
  return String(num).split('').map(d => map[d] !== undefined ? map[d] : d).join('');
}

// Parse any duration text into total integer minutes
function parseDurationToMinutes(durationStr) {
  if (!durationStr) return 50;
  const cleanStr = khmerToEnDigits(durationStr).toLowerCase();

  // If contains hours e.g. "2 ម៉ោង" or "2 hours" or "1.5 ម៉ោង"
  const hourMatch = cleanStr.match(/(\d+(?:\.\d+)?)\s*(?:ម៉ោង|hour|h|hr)/);
  if (hourMatch && !cleanStr.includes('នាទី') && !cleanStr.includes('min')) {
    return Math.round(parseFloat(hourMatch[1]) * 60);
  }

  // Look for minutes e.g. "90 នាទី", "40 នាទី", "100 នាទី", "45mn"
  const minMatch = cleanStr.match(/(\d+)\s*(?:នាទី|mn|min|m)/);
  if (minMatch) {
    return parseInt(minMatch[1], 10);
  }

  // Extract first integer
  const numMatch = cleanStr.match(/\d+/);
  if (numMatch) {
    const val = parseInt(numMatch[0], 10);
    if (val <= 6) return val * 50; // e.g. 2 -> 100
    return val;
  }
  return 50;
}

// Calculate proportional minutes for each step based on total duration & pedagogical percentage
function calculateStepDurations(durationStr, mode = 'flipped') {
  const totalMin = parseDurationToMinutes(durationStr);

  if (mode === 'flipped') {
    // 5% - 10% - 10% - 70% - 5%
    if (totalMin === 150) {
      return {
        total: 150,
        step1: `០៨ នាទី`,
        step2: `១៥ នាទី`,
        step3: `១៥ នាទី`,
        step4: `១០៤ នាទី`,
        step5: `០៨ នាទី`
      };
    }
    if (totalMin === 180) {
      return {
        total: 180,
        step1: `០៥ នាទី`,
        step2: `២៥ នាទី`,
        step3: `២០ នាទី`,
        step4: `១២០ នាទី`,
        step5: `១០ នាទី`
      };
    }
    const s1 = Math.max(1, Math.round(totalMin * 0.05));
    const s2 = Math.max(2, Math.round(totalMin * 0.10));
    const s3 = Math.max(2, Math.round(totalMin * 0.10));
    const s5 = Math.max(1, Math.round(totalMin * 0.05));
    const s4 = Math.max(5, totalMin - (s1 + s2 + s3 + s5));
    return {
      total: totalMin,
      step1: `${toKhmerNumber(s1)} នាទី`,
      step2: `${toKhmerNumber(s2)} នាទី`,
      step3: `${toKhmerNumber(s3)} នាទី`,
      step4: `${toKhmerNumber(s4)} នាទី`,
      step5: `${toKhmerNumber(s5)} នាទី`
    };
  } else if (mode === 'backward_design') {
    // UbD: Hook 15%, Explore 70%, Reflect 15%
    const s1 = Math.max(3, Math.round(totalMin * 0.15));
    const s3 = Math.max(3, Math.round(totalMin * 0.15));
    const s2 = Math.max(10, totalMin - (s1 + s3));
    return {
      total: totalMin,
      step1: `១៥% (~${toKhmerNumber(s1)} នាទី)`,
      step2: `៧០% (~${toKhmerNumber(s2)} នាទី)`,
      step3: `១៥% (~${toKhmerNumber(s3)} នាទី)`
    };
  } else {
    // Standard 5-Step MoEYS: ~5% - ~10% - ~70% - ~10% - ~5%
    const s1 = Math.max(1, Math.round(totalMin * 0.05));
    const s2 = Math.max(2, Math.round(totalMin * 0.10));
    const s4 = Math.max(2, Math.round(totalMin * 0.10));
    const s5 = Math.max(1, Math.round(totalMin * 0.05));
    const s3 = Math.max(5, totalMin - (s1 + s2 + s4 + s5)); // Main core teaching
    return {
      total: totalMin,
      step1: `${toKhmerNumber(s1)} នាទី`,
      step2: `${toKhmerNumber(s2)} នាទី`,
      step3: `${toKhmerNumber(s3)} នាទី`,
      step4: `${toKhmerNumber(s4)} នាទី`,
      step5: `${toKhmerNumber(s5)} នាទី`
    };
  }
}

// Set Duration Value helper (Handles Preset + Custom)
function setDurationValue(val) {
  const select = document.getElementById('inputDurationSelect');
  const customWrap = document.getElementById('customDurationWrap');
  const customText = document.getElementById('inputCustomDurationText');
  if (!select) return;

  if (!val) {
    select.selectedIndex = 0;
    if (customWrap) customWrap.style.display = 'none';
    return;
  }

  let found = false;
  for (let i = 0; i < select.options.length; i++) {
    if (select.options[i].value === val) {
      select.selectedIndex = i;
      found = true;
      break;
    }
  }

  if (found) {
    if (customWrap) customWrap.style.display = 'none';
  } else {
    select.value = 'custom';
    if (customWrap) customWrap.style.display = 'block';
    if (customText) customText.value = val;
  }
  if (typeof syncDurationChipsFromSelect === 'function') {
    syncDurationChipsFromSelect();
  }
}

// ==========================================================================
// Modern SaaS UI Helper Functions (Option B)
// ==========================================================================

function syncDurationChipsFromSelect() {
  const select = document.getElementById('inputDurationSelect');
  const activeLabel = document.getElementById('activeDurationLabel');
  if (!select) return;

  const curVal = select.value;
  document.querySelectorAll('.duration-chip').forEach(chip => {
    const chipDur = chip.getAttribute('data-duration');
    chip.classList.toggle('active', chipDur === curVal);
  });

  if (activeLabel) {
    if (curVal === 'custom') {
      const customText = document.getElementById('inputCustomDurationText');
      activeLabel.textContent = (customText && customText.value.trim()) ? `🕒 ${customText.value.trim()}` : '✏️ ផ្សេងៗ / បញ្ចូលផ្ទាល់';
    } else {
      activeLabel.textContent = curVal.split('(')[0].trim();
    }
  }
}
window.syncDurationChipsFromSelect = syncDurationChipsFromSelect;

function selectDurationChip(val) {
  const select = document.getElementById('inputDurationSelect');
  const customWrap = document.getElementById('customDurationWrap');
  const customText = document.getElementById('inputCustomDurationText');
  const activeLabel = document.getElementById('activeDurationLabel');

  if (select) {
    select.value = val;
    select.dispatchEvent(new Event('change'));
  }

  document.querySelectorAll('.duration-chip').forEach(chip => {
    chip.classList.toggle('active', chip.getAttribute('data-duration') === val);
  });

  if (val === 'custom') {
    if (customWrap) customWrap.style.display = 'block';
    if (customText) customText.focus();
    if (activeLabel) activeLabel.textContent = '✏️ ផ្សេងៗ / បញ្ចូលផ្ទាល់';
  } else {
    if (customWrap) customWrap.style.display = 'none';
    if (activeLabel) {
      activeLabel.textContent = val.split('(')[0].trim();
    }
  }

  const chkAuto = document.getElementById('chkAutoRememberAdmin');
  if (chkAuto && chkAuto.checked) {
    saveAdminProfile(true);
  }
}
window.selectDurationChip = selectDurationChip;

function toggleTeacherProfileFields() {
  const fields = document.getElementById('teacherProfileFields');
  const btnText = document.getElementById('btnToggleProfileEditText');
  if (!fields) return;
  const isHidden = fields.style.display === 'none' || fields.style.display === '';
  fields.style.display = isHidden ? 'flex' : 'none';
  if (btnText) {
    btnText.textContent = isHidden ? 'បង្រួម' : 'កែប្រែ';
  }
}
window.toggleTeacherProfileFields = toggleTeacherProfileFields;

function updateTeacherProfileSummaryLive() {
  const teacherInput = document.getElementById('inputTeacher');
  const schoolInput = document.getElementById('inputSchool');
  const degreeSelect = document.getElementById('inputDegree');
  const gradeSelect = document.getElementById('inputGrade');
  const customGrade = document.getElementById('inputCustomGradeText');

  const teacherName = (teacherInput && teacherInput.value.trim()) ? teacherInput.value.trim() : 'លោកគ្រូ / អ្នកគ្រូ';
  const schoolName = (schoolInput && schoolInput.value.trim()) ? schoolInput.value.trim() : 'ឈ្មោះសាលារៀន ឬស្ថាប័ន';

  let degreeText = 'អនុវិទ្យាល័យ';
  if (degreeSelect && degreeSelect.selectedIndex >= 0) {
    degreeText = degreeSelect.options[degreeSelect.selectedIndex].text.replace(/^[^\w\u1780-\u17FF]+/, '').split('(')[0].trim();
  }

  let gradeText = 'ថ្នាក់ទី ៨';
  if (gradeSelect) {
    if (gradeSelect.value === 'custom' && customGrade && customGrade.value.trim()) {
      gradeText = customGrade.value.trim();
    } else if (gradeSelect.value !== 'custom') {
      gradeText = gradeSelect.value;
    }
  }

  const summaryName = document.getElementById('summaryTeacherName');
  const summarySchool = document.getElementById('summarySchoolName');
  const summaryMeta = document.getElementById('summaryDegreeGrade');

  if (summaryName) summaryName.textContent = teacherName;
  if (summarySchool) summarySchool.textContent = schoolName;
  if (summaryMeta) summaryMeta.textContent = `${degreeText} • ${gradeText}`;
}
window.updateTeacherProfileSummaryLive = updateTeacherProfileSummaryLive;

function switchLessonMaterialTab(mode) {
  const uploadTab = document.getElementById('tabBtnUploadMode');
  const textTab = document.getElementById('tabBtnTextMode');
  const dropzoneWrap = document.getElementById('dropzoneContainerWrapper');
  const textareaWrap = document.getElementById('lessonTextareaWrapper');

  if (mode === 'upload') {
    if (uploadTab) uploadTab.classList.add('active');
    if (textTab) textTab.classList.remove('active');
    if (dropzoneWrap) dropzoneWrap.style.display = 'block';
    if (textareaWrap) textareaWrap.style.display = 'none';
  } else {
    if (textTab) textTab.classList.add('active');
    if (uploadTab) uploadTab.classList.remove('active');
    if (dropzoneWrap) dropzoneWrap.style.display = 'none';
    if (textareaWrap) textareaWrap.style.display = 'block';
    const ta = document.getElementById('lessonContentText');
    if (ta) ta.focus();
  }
}
window.switchLessonMaterialTab = switchLessonMaterialTab;

async function pasteToLessonContent() {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      const ta = document.getElementById('lessonContentText');
      if (ta) {
        ta.value = text;
        ta.dispatchEvent(new Event('input'));
        showToast('📋 បានបិទភ្ជាប់អត្ថបទពី Clipboard រួចរាល់!', 'success');
      }
    }
  } catch (err) {
    showToast('សូមចុច Ctrl+V ដើម្បីបិទភ្ជាប់អត្ថបទ', 'info');
  }
}
window.pasteToLessonContent = pasteToLessonContent;

function findDegreeKeyForGrade(gradeName) {
  if (!gradeName) return 'lower_sec';
  for (const [key, def] of Object.entries(STUDY_DEGREES)) {
    if (def.grades.includes(gradeName)) return key;
  }
  if (gradeName.includes('កំពង់ចាម') || gradeName.includes('TEC')) return 'tec_kampongcham';
  if (gradeName.includes('គរុកោសល្យ') || gradeName.includes('គរុសិស្ស') || gradeName.includes('គរុនិស្សិត')) return 'teacher_training';
  if (gradeName.includes('ថ្នាក់ទី ១០') || gradeName.includes('ថ្នាក់ទី ១១') || gradeName.includes('ថ្នាក់ទី ១២')) return 'upper_sec';
  if (gradeName.includes('ថ្នាក់ទី ៧') || gradeName.includes('ថ្នាក់ទី ៨') || gradeName.includes('ថ្នាក់ទី ៩')) return 'lower_sec';
  if (gradeName.includes('ថ្នាក់ទី ១') || gradeName.includes('ថ្នាក់ទី ២') || gradeName.includes('ថ្នាក់ទី ៣') || gradeName.includes('ថ្នាក់ទី ៤') || gradeName.includes('ថ្នាក់ទី ៥') || gradeName.includes('ថ្នាក់ទី ៦')) return 'primary';
  if (gradeName.includes('មត្តេយ្យ')) return 'kindergarten';
  if (gradeName.includes('បរិញ្ញាបត្រ') || gradeName.includes('អនុបណ្ឌិត')) return 'higher_ed';
  if (gradeName.includes('វិជ្ជាជីវៈ') || gradeName.includes('បច្ចេកទេស')) return 'tvet';
  return 'lower_sec';
}

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  try { initPdfJs(); } catch (e) { console.error('initPdfJs err:', e); }
  try { initEventListeners(); } catch (e) { console.error('initEventListeners err:', e); }
  try { initDropzones(); } catch (e) { console.error('initDropzones err:', e); }
  try { PersistentKeyVault.requestPersistentStorage(); } catch (e) {}
  try {
    PersistentKeyVault.restore().then((restored) => {
      if (restored) {
        checkApiKeyStatus();
        updateEmptyStateApiStatus();
      }
    });
  } catch (e) {
    console.error('PersistentKeyVault restore err:', e);
  }
  try { checkApiKeyStatus(); } catch (e) { console.error('checkApiKeyStatus err:', e); }
  try { updateEmptyStateApiStatus(); } catch (e) { console.error('updateEmptyStateApiStatus err:', e); }
  try { setLanguage(state.language || 'km', false); } catch(e) { console.error('setLanguage err:', e); }
  try { updateWordCount(); } catch (e) { console.error('updateWordCount err:', e); }
  try { loadSavedAdminProfile(); } catch (e) { console.error('loadSavedAdminProfile err:', e); }
  try { loadSavedTemplates(); } catch (e) { console.error('loadSavedTemplates err:', e); }
  try { loadSavedLessons(); } catch (e) { console.error('loadSavedLessons err:', e); }
  try { loadSavedPlans(); } catch (e) { console.error('loadSavedPlans err:', e); }
  try { checkBackendHealth(); } catch (e) { console.error('checkBackendHealth err:', e); }
  try { checkLicenseStatus(); } catch (e) { console.error('checkLicenseStatus err:', e); }

  // Restore active lesson content if remembered
  try {
    const activeContent = localStorage.getItem('active_lesson_content');
    const lessonTextarea = document.getElementById('lessonContentText');
    if (activeContent && lessonTextarea && !lessonTextarea.value.trim()) {
      lessonTextarea.value = activeContent;
      state.lessonContent = activeContent;
      updateWordCount();
      const badge = document.getElementById('savedLessonBadge');
      if (badge) badge.style.display = 'inline-flex';
    }
  } catch (e) {
    console.error('Error restoring active lesson content:', e);
  }
});

// Configure PDF.js worker
function initPdfJs() {
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }
}

// Event Listeners
function initEventListeners() {
  // Theme Toggle
  const btnThemeToggle = document.getElementById('btnThemeToggle');
  btnThemeToggle.addEventListener('click', () => {
    document.body.classList.toggle('theme-dark');
    document.body.classList.toggle('theme-light');
    const isDark = document.body.classList.contains('theme-dark');
    btnThemeToggle.innerHTML = isDark ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
  });

  // Template Mode Radio Change
  const templateRadios = document.querySelectorAll('input[name="templateMode"]');
  templateRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      state.templateMode = e.target.value;
      const isPreset = state.templateMode === 'preset';
      const isSaved = state.templateMode === 'saved';
      const isCustom = state.templateMode === 'custom';

      const presetWrapper = document.getElementById('presetTemplateWrapper');
      const savedWrapper = document.getElementById('savedTemplateWrapper');
      const customWrapper = document.getElementById('customTemplateWrapper');

      if (presetWrapper) presetWrapper.style.display = isPreset ? 'block' : 'none';
      if (savedWrapper) savedWrapper.style.display = isSaved ? 'block' : 'none';
      if (customWrapper) customWrapper.style.display = isCustom ? 'block' : 'none';
      
      if (isSaved) {
        renderSelectedSavedTemplateDetails();
      }

      document.querySelectorAll('#radioCardPreset, #radioCardSaved, #radioCardCustom').forEach(card => {
        if (card) card.classList.remove('active');
      });
      const activeCard = e.target.closest('.radio-card');
      if (activeCard) activeCard.classList.add('active');
    });
  });

  // Saved Template Selector Change
  const savedTemplateSelect = document.getElementById('savedTemplateSelect');
  if (savedTemplateSelect) {
    savedTemplateSelect.addEventListener('change', (e) => {
      state.selectedSavedTemplateId = e.target.value;
      renderSelectedSavedTemplateDetails();
    });
  }

  // Delete Saved Template Button
  const btnDeleteSaved = document.getElementById('btnDeleteSavedTemplate');
  if (btnDeleteSaved) {
    btnDeleteSaved.addEventListener('click', () => {
      if (state.selectedSavedTemplateId) {
        deleteSavedTemplate(state.selectedSavedTemplateId);
      }
    });
  }

  // Quick navigation to upload from saved library
  const btnGoToUpload = document.getElementById('btnGoToUploadTemplate');
  const btnUploadShortcut = document.getElementById('btnUploadNewTemplateShortcut');
  [btnGoToUpload, btnUploadShortcut].forEach(btn => {
    if (btn) {
      btn.addEventListener('click', () => {
        const customRadio = document.querySelector('input[name="templateMode"][value="custom"]');
        if (customRadio) {
          customRadio.checked = true;
          customRadio.dispatchEvent(new Event('change'));
        }
      });
    }
  });

  // Save Custom Template Button (from file upload bar)
  const btnSaveCustomTmpl = document.getElementById('btnSaveCustomTemplate');
  if (btnSaveCustomTmpl) {
    btnSaveCustomTmpl.addEventListener('click', () => {
      const nameInput = document.getElementById('inputCustomTemplateName');
      const name = nameInput ? nameInput.value.trim() : '';
      saveCustomTemplate(name, state.customTemplateText, state.customTemplateFileName);
    });
  }

  // Save Text Area Template Button
  const btnSaveTextTmpl = document.getElementById('btnSaveTextTemplate');
  if (btnSaveTextTmpl) {
    btnSaveTextTmpl.addEventListener('click', () => {
      const text = document.getElementById('customTemplateText').value;
      const name = prompt('សូមបញ្ចូលឈ្មោះសម្រាប់ Template នេះ៖', 'ទម្រង់កិច្ចតែងការផ្ទាល់ខ្លួន');
      if (name !== null) {
        saveCustomTemplate(name, text, 'custom_text_template.txt');
      }
    });
  }

  // Listen to custom template textarea typing to show save options
  const customTmplText = document.getElementById('customTemplateText');
  if (customTmplText) {
    customTmplText.addEventListener('input', (e) => {
      state.customTemplateText = e.target.value;
      const hasText = !!e.target.value.trim();
      const saveTextBtn = document.getElementById('btnSaveTextTemplate');
      const saveActionWrap = document.getElementById('saveCustomTemplateActionWrap');
      if (saveTextBtn) saveTextBtn.style.display = hasText ? 'inline-flex' : 'none';
      if (saveActionWrap && !state.customTemplateFileName) saveActionWrap.style.display = hasText ? 'flex' : 'none';
    });
  }

  // Preset Template Select Change
  document.getElementById('presetTemplateSelect').addEventListener('change', (e) => {
    state.selectedPresetId = e.target.value;
  });

  // ==========================================================================
  // Lesson Material Mode Switcher & Handlers
  // ==========================================================================
  const lessonSourceRadios = document.querySelectorAll('input[name="lessonSourceMode"]');
  lessonSourceRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      state.lessonSourceMode = e.target.value;
      const isUpload = state.lessonSourceMode === 'upload';
      const isSaved = state.lessonSourceMode === 'saved';

      const uploadWrapper = document.getElementById('uploadLessonWrapper');
      const savedWrapper = document.getElementById('savedLessonsWrapper');

      if (uploadWrapper) uploadWrapper.style.display = isUpload ? 'block' : 'none';
      if (savedWrapper) savedWrapper.style.display = isSaved ? 'block' : 'none';

      if (isSaved) {
        renderSelectedSavedLessonDetails();
      }

      document.querySelectorAll('#radioCardLessonUpload, #radioCardLessonSaved').forEach(card => {
        if (card) card.classList.remove('active');
      });
      const activeCard = e.target.closest('.radio-card');
      if (activeCard) activeCard.classList.add('active');
    });
  });

  // Saved Lesson Selector Change
  const savedLessonSelect = document.getElementById('savedLessonSelect');
  if (savedLessonSelect) {
    savedLessonSelect.addEventListener('change', (e) => {
      state.selectedSavedLessonId = e.target.value;
      renderSelectedSavedLessonDetails();
    });
  }

  // Apply Saved Lesson Button
  const btnApplyLesson = document.getElementById('btnApplySavedLesson');
  if (btnApplyLesson) {
    btnApplyLesson.addEventListener('click', () => {
      if (state.selectedSavedLessonId) {
        applySavedLesson(state.selectedSavedLessonId);
      }
    });
  }

  // Delete Saved Lesson Button
  const btnDeleteLesson = document.getElementById('btnDeleteSavedLesson');
  if (btnDeleteLesson) {
    btnDeleteLesson.addEventListener('click', () => {
      if (state.selectedSavedLessonId) {
        deleteSavedLesson(state.selectedSavedLessonId);
      }
    });
  }

  // Lesson Search Input
  const searchSavedLessonsInput = document.getElementById('searchSavedLessonsInput');
  if (searchSavedLessonsInput) {
    searchSavedLessonsInput.addEventListener('input', (e) => {
      updateSavedLessonsUI(e.target.value);
    });
  }

  // Add New Lesson Shortcut
  const btnAddNewLessonShortcut = document.getElementById('btnAddNewLessonShortcut');
  if (btnAddNewLessonShortcut) {
    btnAddNewLessonShortcut.addEventListener('click', () => {
      const uploadRadio = document.querySelector('input[name="lessonSourceMode"][value="upload"]');
      if (uploadRadio) {
        uploadRadio.checked = true;
        uploadRadio.dispatchEvent(new Event('change'));
      }
      const lessonText = document.getElementById('lessonContentText');
      if (lessonText) lessonText.focus();
    });
  }

  // Export Saved Lessons Backup
  const btnExportSavedLessons = document.getElementById('btnExportSavedLessons');
  if (btnExportSavedLessons) {
    btnExportSavedLessons.addEventListener('click', exportSavedLessonsAsJson);
  }

  // Import Saved Lessons Backup
  const btnImportSavedLessonsTrigger = document.getElementById('btnImportSavedLessonsTrigger');
  const importSavedLessonsFile = document.getElementById('importSavedLessonsFile');
  if (btnImportSavedLessonsTrigger && importSavedLessonsFile) {
    btnImportSavedLessonsTrigger.addEventListener('click', () => importSavedLessonsFile.click());
    importSavedLessonsFile.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        importSavedLessonsFromJson(file);
      }
    });
  }

  // Shortcut from empty state to upload lesson
  const btnGoToUploadLesson = document.getElementById('btnGoToUploadLesson');
  if (btnGoToUploadLesson) {
    btnGoToUploadLesson.addEventListener('click', () => {
      const uploadRadio = document.querySelector('input[name="lessonSourceMode"][value="upload"]');
      if (uploadRadio) {
        uploadRadio.checked = true;
        uploadRadio.dispatchEvent(new Event('change'));
      }
    });
  }

  // Save Lesson Button
  const btnSaveLesson = document.getElementById('btnSaveLessonMaterial');
  if (btnSaveLesson) {
    btnSaveLesson.addEventListener('click', () => {
      const nameInput = document.getElementById('inputSaveLessonName');
      const name = nameInput ? nameInput.value.trim() : '';
      saveCurrentLessonMaterial(name);
    });
  }

  // Study Degree Select Change (Cascade to Grade selector)
  const inputDegree = document.getElementById('inputDegree');
  const inputGrade = document.getElementById('inputGrade');
  const customGradeWrap = document.getElementById('customGradeInputWrap');
  const customGradeText = document.getElementById('inputCustomGradeText');
  const chkAutoRemember = document.getElementById('chkAutoRememberAdmin');

  if (inputDegree) {
    inputDegree.addEventListener('change', (e) => {
      updateGradeOptions(e.target.value);
      if (e.target.value === 'tec_kampongcham') {
        const schoolInput = document.getElementById('inputSchool');
        if (schoolInput && (!schoolInput.value || schoolInput.value.trim() === '')) {
          schoolInput.value = 'វិទ្យាស្ថានគរុកោសល្យកំពង់ចាម';
        }
      }
    });
    // Initial populate of grades based on default selected degree
    updateGradeOptions(inputDegree.value);
  }

  if (inputGrade) {
    inputGrade.addEventListener('change', (e) => {
      if (e.target.value === 'custom') {
        customGradeWrap.style.display = 'block';
        customGradeText.focus();
      } else {
        customGradeWrap.style.display = 'none';
      }
      if (chkAutoRemember && chkAutoRemember.checked) {
        saveAdminProfile(true);
      }
    });
  }

  // Duration Select & Custom input change handlers
  const durationSelect = document.getElementById('inputDurationSelect');
  const customDurationWrap = document.getElementById('customDurationWrap');
  const customDurationText = document.getElementById('inputCustomDurationText');

  if (durationSelect) {
    durationSelect.addEventListener('change', (e) => {
      if (e.target.value === 'custom') {
        if (customDurationWrap) customDurationWrap.style.display = 'block';
        if (customDurationText) customDurationText.focus();
      } else {
        if (customDurationWrap) customDurationWrap.style.display = 'none';
      }
      if (chkAutoRemember && chkAutoRemember.checked) {
        saveAdminProfile(true);
      }
    });
  }

  if (customDurationText) {
    customDurationText.addEventListener('input', () => {
      if (chkAutoRemember && chkAutoRemember.checked) {
        saveAdminProfile(true);
      }
    });
  }

  // Admin Info Save & Clear Profile Buttons
  const btnSaveAdmin = document.getElementById('btnSaveAdminInfo');
  const btnClearAdmin = document.getElementById('btnClearAdminInfo');

  if (btnSaveAdmin) {
    btnSaveAdmin.addEventListener('click', () => {
      saveAdminProfile(false);
    });
  }

  if (btnClearAdmin) {
    btnClearAdmin.addEventListener('click', () => {
      clearSavedAdminProfile();
    });
  }

  // Auto-save admin profile when inputs change (if remember checkbox is checked)
  ['inputSchool', 'inputTeacher', 'inputDegree', 'inputSubject', 'inputMethod'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', () => {
        if (chkAutoRemember && chkAutoRemember.checked) {
          saveAdminProfile(true);
        }
      });
    }
  });

  if (customGradeText) {
    customGradeText.addEventListener('input', () => {
      if (chkAutoRemember && chkAutoRemember.checked) {
        saveAdminProfile(true);
      }
    });
  }

  // Sample Pickers
  document.getElementById('samplePicker').addEventListener('change', (e) => {
    const idx = e.target.value;
    if (idx !== '') {
      loadSampleLesson(parseInt(idx, 10));
    }
  });

  const btnEmptyQuickDemo = document.getElementById('btnEmptyQuickDemo');
  if (btnEmptyQuickDemo) {
    btnEmptyQuickDemo.addEventListener('click', () => {
      loadSampleLesson(0);
      document.getElementById('samplePicker').value = '0';
      showToast('បានផ្ទុកមេរៀនគំរូរូបវិទ្យា ថ្នាក់ទី ៨ រួចរាល់!', 'info');
    });
  }

  // Lesson Content textarea word count and auto-remember
  const lessonTextarea = document.getElementById('lessonContentText');
  if (lessonTextarea) {
    lessonTextarea.addEventListener('input', (e) => {
      state.lessonContent = e.target.value;
      updateWordCount();

      // Show manual save bar if text is entered
      const saveLessonBar = document.getElementById('saveLessonActionBar');
      if (saveLessonBar) {
        saveLessonBar.style.display = e.target.value.trim().length > 10 ? 'flex' : 'none';
      }

      // Cache active content to localStorage
      localStorage.setItem('active_lesson_content', e.target.value);

      // Auto-remember / save lesson material
      const chkAutoRemember = document.getElementById('chkAutoRememberLesson');
      if (chkAutoRemember && chkAutoRemember.checked && e.target.value.trim().length > 15) {
        clearTimeout(window._lessonAutoRememberTimer);
        window._lessonAutoRememberTimer = setTimeout(() => {
          saveCurrentLessonMaterial('', true);
        }, 1200);
      }
    });
  }

  // Lesson content textarea input listener
  const lessonContentTextarea = document.getElementById('lessonContentText');
  if (lessonContentTextarea) {
    lessonContentTextarea.addEventListener('input', (e) => {
      state.lessonContent = e.target.value;
      updateWordCount();
      const nameInput = document.getElementById('inputSaveLessonName');
      if (nameInput && !nameInput.value.trim() && e.target.value.trim()) {
        const title = document.getElementById('inputLessonTitle')?.value;
        const subj = document.getElementById('inputSubject')?.value || 'មេរៀន';
        nameInput.value = title ? `${subj} - ${title}` : `មេរៀន ${subj} ថ្មី`;
      }
    });
  }

  // Auto-remember lesson checkbox change
  const chkAutoRememberLesson = document.getElementById('chkAutoRememberLesson');
  if (chkAutoRememberLesson) {
    chkAutoRememberLesson.addEventListener('change', (e) => {
      if (e.target.checked && state.lessonContent && state.lessonContent.trim().length > 15) {
        saveCurrentLessonMaterial('', true);
      }
    });
  }

  // Generate Button
  document.getElementById('btnGenerate').addEventListener('click', handleGenerateLessonPlan);

  // Reset Button
  document.getElementById('btnReset').addEventListener('click', handleResetForm);

  // ==========================================================================
  // Saved Lesson Plans Modal & Save Plan Action Handlers
  // ==========================================================================
  const btnOpenSavedPlans = document.getElementById('btnOpenSavedPlans');
  const savedPlansModal = document.getElementById('savedPlansModal');
  const btnCloseSavedPlans = document.getElementById('btnCloseSavedPlansModal');
  const btnCloseSavedPlansBottom = document.getElementById('btnCloseSavedPlansModalBottom');
  const btnSavePlan = document.getElementById('btnSaveGeneratedPlan');

  if (btnOpenSavedPlans) {
    btnOpenSavedPlans.addEventListener('click', openSavedPlansModal);
  }

  if (btnCloseSavedPlans) {
    btnCloseSavedPlans.addEventListener('click', closeSavedPlansModal);
  }

  if (btnCloseSavedPlansBottom) {
    btnCloseSavedPlansBottom.addEventListener('click', closeSavedPlansModal);
  }

  if (btnSavePlan) {
    btnSavePlan.addEventListener('click', saveCurrentGeneratedPlan);
  }

  // Search & Filter in Saved Plans Modal
  const searchInput = document.getElementById('searchSavedPlansInput');
  const filterSubject = document.getElementById('filterSavedPlansSubject');

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      renderSavedPlansGrid(e.target.value, filterSubject ? filterSubject.value : '');
    });
  }

  if (filterSubject) {
    filterSubject.addEventListener('change', (e) => {
      renderSavedPlansGrid(searchInput ? searchInput.value : '', e.target.value);
    });
  }

  // Backup & Restore JSON Handlers
  const btnExportBackup = document.getElementById('btnExportAllPlansJson');
  if (btnExportBackup) {
    btnExportBackup.addEventListener('click', exportAllPlansAsJson);
  }

  const btnImportTrigger = document.getElementById('btnImportPlansJsonTrigger');
  const importInput = document.getElementById('importPlansJsonInput');
  if (btnImportTrigger && importInput) {
    btnImportTrigger.addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        importPlansFromJson(file);
      }
    });
  }

  // API Key Modal
  const btnApiKey = document.getElementById('btnApiKey');
  const btnCloseModal = document.getElementById('btnCloseModal');
  const btnSaveKey = document.getElementById('btnSaveKey');
  const btnRemoveKey = document.getElementById('btnRemoveKey');
  const btnResetKeyModal = document.getElementById('btnResetKeyModal');
  const btnResetToSystemDefault = document.getElementById('btnResetToSystemDefault');

  if (btnApiKey) {
    btnApiKey.addEventListener('click', (e) => {
      e.preventDefault();
      openApiKeyModal();
    });
  }

  if (btnCloseModal) {
    btnCloseModal.addEventListener('click', (e) => {
      e.preventDefault();
      closeApiKeyModal();
    });
  }

  if (btnSaveKey) {
    btnSaveKey.addEventListener('click', (e) => {
      e.preventDefault();
      saveApiKeyFromModal();
    });
  }

  if (btnRemoveKey) {
    btnRemoveKey.addEventListener('click', (e) => {
      e.preventDefault();
      removeApiKeyFromModal();
    });
  }

  if (btnResetKeyModal) {
    btnResetKeyModal.addEventListener('click', (e) => {
      e.preventDefault();
      resetToSmartEngineDefault();
    });
  }

  if (btnResetToSystemDefault) {
    btnResetToSystemDefault.addEventListener('click', (e) => {
      e.preventDefault();
      resetToSmartEngineDefault();
    });
  }

  const inputGeminiKey = document.getElementById('inputGeminiKey');
  if (inputGeminiKey) {
    let keyDebounceTimer = null;
    inputGeminiKey.addEventListener('input', (e) => {
      const val = (e.target.value || '').trim();
      clearTimeout(keyDebounceTimer);
      if (val.length >= 20 || val.startsWith('AIza') || val.startsWith('gsk_') || val.startsWith('sk-or-')) {
        keyDebounceTimer = setTimeout(() => {
          saveApiKeyFromModal(false);
        }, 500);
      }
    });
    inputGeminiKey.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveApiKeyFromModal(true);
      }
    });
  }

  // Export Actions
  document.getElementById('btnExportWord').addEventListener('click', handleExportWord);
  document.getElementById('btnPrintPdf').addEventListener('click', handlePrintPdf);
  document.getElementById('btnCopyText').addEventListener('click', handleCopyText);
}

// Setup Drag & Drop File Uploads
function initDropzones() {
  // 1. Template Dropzone
  setupDropzone(
    'templateDropzone',
    'templateFileInput',
    'templateFileStatus',
    'btnRemoveTemplateFile',
    async (file) => {
      showToast(`កំពុងអានឯកសារ Template: ${file.name}...`, 'info');
      const text = await extractTextFromFile(file);
      state.customTemplateText = text;
      state.customTemplateFileName = file.name;
      document.getElementById('customTemplateText').value = text;
      
      const saveWrap = document.getElementById('saveCustomTemplateActionWrap');
      const nameInput = document.getElementById('inputCustomTemplateName');
      if (saveWrap) saveWrap.style.display = 'flex';
      if (nameInput) nameInput.value = file.name.replace(/\.[^/.]+$/, "");
      
      showToast(`បានទាញយកទម្រង់ពី ${file.name} រួចរាល់! អ្នកអាចចុច "រក្សាទុក Template" សម្រាប់ទុកប្រើលើកក្រោយ`, 'success');
    },
    () => {
      state.customTemplateText = '';
      state.customTemplateFileName = '';
      document.getElementById('customTemplateText').value = '';
      const saveWrap = document.getElementById('saveCustomTemplateActionWrap');
      if (saveWrap) saveWrap.style.display = 'none';
    }
  );

  // 2. Lesson Content Dropzone
  setupDropzone(
    'lessonDropzone',
    'lessonFileInput',
    'lessonFileStatus',
    'btnRemoveLessonFile',
    async (file) => {
      showToast(`កំពុងអានឯកសារមេរៀន: ${file.name}...`, 'info');
      const text = await extractTextFromFile(file);
      if (text && text.trim().length > 0) {
        state.lessonContent = text.trim();
        state.lessonFileName = file.name;
        const contentEl = document.getElementById('lessonContentText');
        if (contentEl) contentEl.value = text.trim();
        updateWordCount();

        const baseName = file.name.replace(/\.[^/.]+$/, "");
        const nameInput = document.getElementById('inputSaveLessonName');
        if (nameInput) nameInput.value = baseName;
        const lessonTitleInput = document.getElementById('inputLessonTitle');
        if (lessonTitleInput && !lessonTitleInput.value.trim()) {
          lessonTitleInput.value = baseName;
        }

        showToast(`✅ បានស្រង់ខ្លឹមសារពី ${file.name} (${text.trim().length} តួអក្សរ) ចូលប្រអប់រួចរាល់! AI នឹងប្រើប្រាស់ខ្លឹមសារនេះ!`, 'success');
      } else {
        showToast(`⚠️ មិនអាចស្រង់អត្ថបទពី ${file.name} បានទេ។ សូមពិនិត្យមើលឯកសារ ឬ Copy-Paste ខ្លឹមសារដោយផ្ទាល់!`, 'warning');
      }
    },
    () => {
      state.lessonFileName = '';
      // keep current text or let user edit
    }
  );
}

// Generic Dropzone Helper
function setupDropzone(dropzoneId, inputId, statusId, removeBtnId, onFileLoaded, onFileRemoved) {
  const dropzone = document.getElementById(dropzoneId);
  const input = document.getElementById(inputId);
  const statusEl = document.getElementById(statusId);
  const removeBtn = document.getElementById(removeBtnId);

  dropzone.addEventListener('click', (e) => {
    if (!e.target.closest('.file-status-pill')) {
      input.click();
    }
  });

  input.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
      handleFileSelected(file, statusEl, onFileLoaded);
    }
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelected(file, statusEl, onFileLoaded);
    }
  });

  removeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    statusEl.style.display = 'none';
    input.value = '';
    if (onFileRemoved) onFileRemoved();
    showToast('បានដកឯកសារចេញ', 'info');
  });
}

function handleFileSelected(file, statusEl, callback) {
  const fileNameEl = statusEl.querySelector('.file-name');
  if (fileNameEl) fileNameEl.textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
  statusEl.style.display = 'inline-flex';
  callback(file);
}

// Check if Python backend is active
let isBackendAvailable = false;
async function checkBackendHealth() {
  try {
    const res = await fetch('/api/health');
    if (res.ok) {
      isBackendAvailable = true;
      console.log('Python Backend connected successfully!');
    }
  } catch (e) {
    isBackendAvailable = false;
  }
}

// Extract text using Python backend if available or client-side fallback
async function extractTextFromFile(file) {
  // 1. Always attempt backend extraction first (uses native python-docx, python-pptx, pypdf)
  try {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/upload/lesson', {
      method: 'POST',
      body: formData
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.text && data.text.trim() && !data.text.startsWith('PowerPoint parsing notice:')) {
        isBackendAvailable = true;
        return data.text.trim();
      }
    }
  } catch (e) {
    console.log('Backend upload fallback to client:', e);
  }

  // 2. Client-side extraction fallback
  const extension = file.name.split('.').pop().toLowerCase();
  try {
    if (extension === 'txt' || extension === 'text' || extension === 'json' || extension === 'md') {
      return await file.text();
    }
    if (extension === 'docx' && window.mammoth) {
      const arrayBuffer = await file.arrayBuffer();
      const result = await window.mammoth.extractRawText({ arrayBuffer: arrayBuffer });
      return result.value;
    }
    if (extension === 'pdf' && window.pdfjsLib) {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let fullText = '';
      for (let i = 1; i <= Math.min(pdf.numPages, 15); i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageStrings = content.items.map(item => item.str).join(' ');
        fullText += `\n[ទំព័រទី ${i}]\n` + pageStrings + '\n';
      }
      return fullText;
    }
    if ((extension === 'pptx' || extension === 'ppt') && window.JSZip) {
      const arrayBuffer = await file.arrayBuffer();
      const zip = await window.JSZip.loadAsync(arrayBuffer);
      const slideFiles = [];
      
      zip.forEach((relativePath) => {
        if (relativePath.match(/^ppt\/slides\/slide\d+\.xml$/i)) {
          slideFiles.push(relativePath);
        }
      });
      
      slideFiles.sort((a, b) => {
        const numA = parseInt(a.match(/\d+/)[0], 10);
        const numB = parseInt(b.match(/\d+/)[0], 10);
        return numA - numB;
      });
      
      let fullText = '';
      for (let i = 0; i < slideFiles.length; i++) {
        const xmlStr = await zip.file(slideFiles[i]).async('string');
        // Regex extraction directly from raw XML string (immune to namespace bugs)
        const matches = xmlStr.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/gi) || [];
        const slideTexts = [];
        for (const match of matches) {
          const raw = match.replace(/^<a:t[^>]*>/i, '').replace(/<\/a:t>$/i, '');
          const clean = raw
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .trim();
          if (clean) slideTexts.push(clean);
        }
        if (slideTexts.length > 0) {
          fullText += `[ស្លាយទី ${i + 1}]\n` + slideTexts.join('\n') + '\n\n';
        }
      }
      if (fullText.trim()) {
        return fullText.trim();
      }
    }
    // 3. Image OCR using Gemini Vision AI
    if (['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(extension)) {
      const apiKey = (state.geminiApiKey || '').trim();
      if (!apiKey) {
        showToast('⚠️ ដើម្បីអានអត្ថបទពីរូបភាព (OCR) សូមបញ្ចូល API Key ជាមុនសិន!', 'warning');
        return '';
      }
      showToast('🖼️ កំពុងប្រើប្រាស់ Gemini Vision AI ដើម្បីអានអត្ថបទ និងខ្លឹមសារពីរូបភាព...', 'info');
      const base64Data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const mimeType = file.type || (extension === 'png' ? 'image/png' : 'image/jpeg');
      const rawBase64 = base64Data.split(',')[1];

      const ocrCandidateModels = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-2.5-pro', 'gemini-3.5-flash-lite', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'];
      for (const model of ocrCandidateModels) {
        try {
          const ocrUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
          const ocrRes = await fetch(ocrUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [
                  { inline_data: { mime_type: mimeType, data: rawBase64 } },
                  { text: "សូមស្រង់អត្ថបទ និងខ្លឹមសារមេរៀនទាំងអស់ដែលមាននៅក្នុងរូបភាពនេះជាភាសាខ្មែរ (Khmer OCR Text Extraction) ឱ្យបានពេញលេញ ត្រឹមត្រូវ និងច្បាស់លាស់ ១០០%។ ប្រសិនបើមានតារាង រូបមន្ត ឬលំហាត់ សូមស្រង់មកឱ្យបានត្រឹមត្រូវទាំងអស់ ដោយមិនបន្ថែមពាក្យអត្ថាធិប្បាយក្រៅឡើយ។" }
                ]
              }]
            })
          });
          if (ocrRes.ok) {
            const ocrJson = await ocrRes.json();
            const ocrText = ocrJson.candidates?.[0]?.content?.parts?.[0]?.text;
            if (ocrText && ocrText.trim()) {
              return ocrText.trim();
            }
          }
        } catch (e) {
          console.warn(`Vision OCR failed on ${model}:`, e);
        }
      }
    }

    // If not plaintext, avoid dumping binary gibberish
    if (['exe', 'bin', 'zip', 'rar', '7z', 'iso', 'dll', 'pptx', 'ppt'].includes(extension)) {
      showToast('កំពុងដំណើរការស្រង់ទិន្នន័យពីឯកសារ...', 'info');
      return '';
    }
    return await file.text();
  } catch (err) {
    console.error('File parsing error:', err);
    showToast(`មិនអាចអានឯកសារនេះបានទេ: ${err.message}`, 'error');
    return '';
  }
}

// Load Pre-defined Sample Lesson
function loadSampleLesson(index) {
  const sample = SAMPLE_LESSONS[index];
  if (!sample) return;

  document.getElementById('inputSubject').value = sample.subject;

  // Set Degree and Grade
  const degreeKey = findDegreeKeyForGrade(sample.grade);
  const inputDegree = document.getElementById('inputDegree');
  if (inputDegree) inputDegree.value = degreeKey;
  updateGradeOptions(degreeKey, sample.grade);

  setDurationValue(sample.duration);
  document.getElementById('inputChapter').value = sample.chapter;
  document.getElementById('inputLessonTitle').value = sample.lesson;
  document.getElementById('inputMethod').value = sample.method;
  document.getElementById('lessonContentText').value = sample.content;
  state.lessonContent = sample.content;
  updateWordCount();

  // Sync Template Mode to match sample
  const isFlippedSample = (sample.title + ' ' + sample.method).toLowerCase().includes('flipped') || (sample.title + ' ' + sample.method).includes('ថ្នាក់រៀនត្រឡប់');
  if (isFlippedSample) {
    state.templateMode = 'preset';
    state.selectedPresetId = 'flipped_learning_5step';
    const radioPreset = document.querySelector('input[name="templateMode"][value="preset"]');
    if (radioPreset) radioPreset.checked = true;
    const presetRadioCards = document.querySelectorAll('.preset-card');
    presetRadioCards.forEach(c => {
      c.classList.toggle('selected', c.dataset.presetId === 'flipped_learning_5step');
    });
  }

  showToast(`បានផ្ទុកមេរៀន: ${sample.title}`, 'info');
}

// Update Word Count Indicator
function updateWordCount() {
  const input = document.getElementById('lessonContentText');
  const badge = document.getElementById('charCount');
  if (!badge) return;
  const text = input ? input.value.trim() : '';
  const words = text ? text.split(/\s+/).length : 0;
  const unit = (state.language === 'en') ? 'words' : 'ពាក្យ';
  badge.textContent = `${words} ${unit}`;
}

// Check API Key Status Indicator
function checkApiKeyStatus() {
  const badge = document.getElementById('apiKeyBadge');
  const btn = document.getElementById('btnApiKey');
  const label = document.getElementById('headerApiKeyLabel');
  const customKey = (state.geminiApiKey || getActiveGeminiApiKey() || localStorage.getItem('gemini_api_key') || '').trim();
  if (!badge) return;

  if (customKey) {
    badge.className = 'status-dot active';
    badge.style.backgroundColor = '#10b981';
    badge.style.boxShadow = '0 0 8px #10b981';
    badge.title = 'Personal API Key ត្រូវបានភ្ជាប់';
    if (label) label.textContent = 'API Key';
    if (btn) {
      btn.title = '🔑 កំពុងប្រើ Personal API Key (ចុចដើម្បីកែប្រែ ឬ Reset)';
      btn.style.borderColor = '#10b981';
      btn.style.background = '#f0fdf4';
    }
  } else {
    badge.className = 'status-dot';
    badge.style.backgroundColor = '#ef4444';
    badge.style.boxShadow = '0 0 6px rgba(239, 68, 68, 0.6)';
    badge.title = 'មិនទាន់ភ្ជាប់ API Key (ចុចដើម្បីបញ្ចូល)';
    if (label) label.textContent = 'បញ្ចូល API Key';
    if (btn) {
      btn.title = '⚠️ មិនទាន់ភ្ជាប់ API Key (សូមចុចដើម្បីបញ្ចូល API Key ឥតគិតថ្លៃ)';
      btn.style.borderColor = '#f59e0b';
      btn.style.background = '#fffbeb';
    }
  }
  try { updateEmptyStateApiStatus(); } catch (e) {}
}

// ==========================================================================
// Helper: Check if request is for Backward Design / UbD or Flipped Learning
// ==========================================================================
function isFlippedLearningRequest(params) {
  const presetId = (params.presetId || '').toLowerCase();
  if (presetId === 'flipped_learning_5step') return true;

  const method = (params.method || '').toLowerCase();
  if (method.includes('flipped') || method.includes('ថ្នាក់រៀនត្រឡប់') || method.includes('ការរៀនបែបត្រឡប់') || method.includes('តាមបែបត្រឡប់')) return true;

  const customText = (params.customTemplate || state.customTemplateText || '').toLowerCase();
  const customFileName = (params.customTemplateFileName || state.customTemplateFileName || '').toLowerCase();
  const customNotes = (params.customNotes || '').toLowerCase();

  if (customFileName.includes('flipped') || customFileName.includes('ថ្នាក់រៀនត្រឡប់') || customFileName.includes('តាមបែបត្រឡប់') || customFileName.includes('កិច្ចតែងការ_តាមបែបត្រឡប់')) return true;
  if (customText.includes('flipped') || customText.includes('ថ្នាក់រៀនត្រឡប់') || customText.includes('ការរៀនបែបត្រឡប់') || (customText.includes('តាមបែបត្រឡប់') && !customText.includes('backward') && !customText.includes('ubd'))) return true;
  if (customNotes.includes('flipped') || customNotes.includes('ថ្នាក់រៀនត្រឡប់') || customNotes.includes('pretest') || customNotes.includes('qcm') || customNotes.includes('២-៦-២')) return true;

  return false;
}

function isBackwardDesignRequest(params) {
  if (isFlippedLearningRequest(params)) return false;

  const presetId = (params.presetId || '').toLowerCase();
  if (presetId === 'backward_design_ubd') return true;

  const customText = (params.customTemplate || state.customTemplateText || '').toLowerCase();
  const customFileName = (params.customTemplateFileName || state.customTemplateFileName || '').toLowerCase();

  if (customFileName.includes('backward') || customFileName.includes('ubd')) return true;
  if (customText.includes('backward') || customText.includes('ubd') || customText.includes('ដំណាក់កាលទី ១') || customText.includes('stage 1') || customText.includes('desired results')) return true;

  return false;
}


// ==========================================================================
// AI Generation Core Engine
// ==========================================================================
async function handleGenerateLessonPlan() {
  if (!state.isLicenseActivated && state.trial && state.trial.isExpired) {
    showToast('🔒 សុពលភាពសាកល្បង ១០ ថ្ងៃបានផុតកំណត់ហើយ! សូម Activate License Key ដើម្បីបន្តបង្កើតកិច្ចតែងការ។', 'warning');
    openLicenseModal();
    return;
  }

  const subject = document.getElementById('inputSubject').value;
  const grade = getGradeValue();
  const lessonTitle = document.getElementById('inputLessonTitle').value.trim();
  const chapter = document.getElementById('inputChapter').value.trim();
  const school = document.getElementById('inputSchool').value.trim();
  const teacher = document.getElementById('inputTeacher').value.trim();
  const duration = getDurationValue();
  const method = document.getElementById('inputMethod').value;
  const customNotes = document.getElementById('inputCustomNotes').value.trim();
  const lessonContent = document.getElementById('lessonContentText').value.trim();

  if (!lessonTitle && !lessonContent) {
    showToast('សូមបញ្ចូលចំណងជើងមេរៀន ឬខ្លឹមសារមេរៀនជាមុនសិន!', 'error');
    document.getElementById('inputLessonTitle').focus();
    return;
  }

  // Show Loading Animation
  const loadingOverlay = document.getElementById('loadingOverlay');
  loadingOverlay.style.display = 'flex';

  const genParams = {
    school, teacher, subject, grade, duration, chapter, lessonTitle, method, customNotes, lessonContent,
    language: state.language || 'km',
    templateMode: state.templateMode,
    presetId: state.selectedPresetId,
    customTemplate: state.customTemplateText,
    customTemplateFileName: state.customTemplateFileName
  };

  try {
    let planData;
    const key = (state.geminiApiKey || '').trim();
    let provider = state.aiProvider || 'gemini';
    if (key.startsWith('AIza') || key.startsWith('AQ.')) {
      provider = 'gemini';
    } else if (key.startsWith('gsk_')) {
      provider = 'groq';
    } else if (key.startsWith('sk-or-')) {
      provider = 'openrouter';
    }

    // Explicit API Key requirement:
    // If no API Key is configured, DO NOT silently generate a dummy template!
    // Alert the user immediately with transparent explanation and guide them to enter their free API key.
    if (!key) {
      loadingOverlay.style.display = 'none';
      openAiErrorModal('NO_KEY', genParams);
      return;
    }

    if (provider === 'groq' || key.startsWith('gsk_')) {
      showToast('⚡ កំពុងដំណើរការដោយ Groq AI (Llama 3.3 70B & DeepSeek)...', 'info');
      planData = await generateWithGroqAPI(genParams);
    } else if (provider === 'openrouter' || key.startsWith('sk-or-')) {
      showToast('🌐 កំពុងដំណើរការដោយ OpenRouter Universal AI...', 'info');
      planData = await generateWithOpenRouterAPI(genParams);
    } else {
      showToast('🤖 កំពុងដំណើរការដោយ Google Gemini AI...', 'info');
      try {
        planData = await generateWithGeminiAPI(genParams);
      } catch (geminiErr) {
        console.warn('[AI Lesson Plan] Direct Gemini call encountered an issue:', geminiErr);
        // If user key hit quota or rate limit, automatically try backend AI server
        try {
          showToast('🔄 Key ផ្ទាល់ខ្លួនជួបបញ្ហា... កំពុងប្តូរស្វ័យប្រវត្តទៅកាន់ AI Server បម្រុង...', 'info');
          planData = await generateWithBackendAPI(genParams);
          if (planData && planData.isOfflineDraft) {
            throw geminiErr;
          }
        } catch (backendErr) {
          throw geminiErr;
        }
      }
    }

    if (planData) {
      planData = normalizeLessonPlanData(planData, genParams);
    }

    if (state.savedLearningGain && !planData.selfEvaluation) {
      planData.selfEvaluation = state.savedLearningGain;
    }
    state.currentPlan = planData;
    state.generatedPlanData = planData;
    renderLessonPlanToA4(planData);
    try {
      if (typeof saveToHistory === 'function') {
        saveToHistory(planData);
      }
      if (typeof updateSavedPlansCountBadge === 'function') {
        updateSavedPlansCountBadge();
      }
    } catch(hErr) {
      console.warn('History auto-save error:', hErr);
    }

    // Auto-save admin profile if remember is checked
    const chkAutoRemember = document.getElementById('chkAutoRememberAdmin');
    if (chkAutoRemember && chkAutoRemember.checked) {
      saveAdminProfile(true);
    }

    // Auto-remember and save lesson material to Lesson Library
    const chkAutoRememberLesson = document.getElementById('chkAutoRememberLesson');
    if ((!chkAutoRememberLesson || chkAutoRememberLesson.checked) && lessonContent && lessonContent.trim().length > 10) {
      saveCurrentLessonMaterial('', true);
    }

    // Hide Empty State and Loading
    document.getElementById('emptyState').style.display = 'none';
    document.getElementById('printableDoc').style.display = 'block';
    showToast('✨ បានបង្កើតកិច្ចតែងការបង្រៀនដោយជោគជ័យ!', 'success');

  } catch (err) {
    console.error('[AI Lesson Plan] Generation Error:', err);
    // NEVER silently fall back to an offline template!
    // Show transparent diagnosis and allow user to retry or update key
    openAiErrorModal(err, genParams);
  } finally {
    loadingOverlay.style.display = 'none';
  }
}

// Global state for pending generation parameters
let pendingGenParams = null;

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
window.escapeHtml = escapeHtml;

// 🤖 AI Troubleshooting & Error Notification Modal Handlers
function openAiErrorModal(errOrType, genParams) {
  pendingGenParams = genParams;
  const loadingOverlay = document.getElementById('loadingOverlay');
  if (loadingOverlay) loadingOverlay.style.display = 'none';

  const modal = document.getElementById('aiErrorModal');
  const titleEl = document.getElementById('aiErrorModalTitle');
  const reasonEl = document.getElementById('aiErrorReasonText');
  const logEl = document.getElementById('aiErrorTechnicalLog');

  let rawMsg = '';
  let isNoKey = false;
  let isInvalidKey = false;
  let isQuotaExceeded = false;
  let isNetworkOrTimeout = false;

  if (errOrType === 'NO_KEY' || (typeof errOrType === 'object' && errOrType?.type === 'NO_KEY')) {
    isNoKey = true;
    rawMsg = 'No Google Gemini API Key configured in app.';
  } else {
    rawMsg = errOrType?.message || String(errOrType);
    const lower = rawMsg.toLowerCase();
    if (rawMsg.includes('API_KEY_INVALID') || rawMsg.includes('API key not valid') || rawMsg.includes('401') || rawMsg.includes('403') || rawMsg.includes('PERMISSION_DENIED')) {
      isInvalidKey = true;
    } else if (lower.includes('quota') || lower.includes('resource_exhausted') || lower.includes('429') || lower.includes('try again later') || lower.includes('overloaded') || lower.includes('503') || lower.includes('too many requests')) {
      isQuotaExceeded = true;
    } else if (rawMsg.includes('AbortError') || lower.includes('timed out') || lower.includes('timeout') || lower.includes('failed to fetch') || lower.includes('networkerror')) {
      isNetworkOrTimeout = true;
    }
  }

  if (logEl) logEl.textContent = rawMsg || 'Unknown Error';

  if (isNoKey) {
    if (titleEl) titleEl.textContent = '⚠️ មិនទាន់បានបញ្ចូល Google Gemini API Key';
    if (reasonEl) {
      reasonEl.innerHTML = `
        <div style="margin-bottom: 10px; font-size: 0.92rem; line-height: 1.6;">
          <strong>🔍 មូលហេតុ៖</strong> កម្មវិធីមិនទាន់រកឃើញ <strong>Google Gemini API Key</strong> នៅក្នុងប្រព័ន្ធនៅឡើយទេ។
        </div>
        <div style="margin-bottom: 10px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; padding: 10px 14px; font-size: 0.88rem; color: #1e40af; line-height: 1.6;">
          <strong>💡 ហេតុអ្វីត្រូវមាន API Key?</strong><br>
          ដើម្បីឱ្យបញ្ញាសិប្បនិម្មិត <strong>Google Gemini AI (2.5 Pro / Flash)</strong> អាចវិភាគចំណងជើង និងបង្កើតខ្លឹមសារកិច្ចតែងការ MoEYS ៥ ជំហានពេញលេញ មានគុណភាពខ្ពស់ និងឆ្លើយតបត្រូវតាមមុខវិជ្ជាជាក់ស្ដែង។
        </div>
        <div style="margin-bottom: 6px; font-size: 0.88rem; color: #166534; line-height: 1.5;">
          <strong>✨ តើ API Key គិតថ្លៃទេ?</strong><br>
          <strong>ឥតគិតថ្លៃ ១០០% (Free 100%)</strong> ពី Google AI Studio ដោយប្រើត្រឹមតែគណនី Gmail ធម្មតារបស់លោកគ្រូ/អ្នកគ្រូប៉ុណ្ណោះ (ចំណាយពេលត្រឹម ៣០ វិនាទី)។
        </div>
      `;
    }
  } else if (isInvalidKey) {
    if (titleEl) titleEl.textContent = 'Google Gemini API Key មិនត្រឹមត្រូវ (Invalid Key)';
    if (reasonEl) {
      reasonEl.innerHTML = `
        <div style="margin-bottom: 8px;">
          <strong>🔍 មូលហេតុ៖</strong> Google បានបដិសេធ API Key (HTTP 400/401/403: API_KEY_INVALID)។ API Key អាចមានការចម្លងខ្វះតួអក្សរ ផុតសុពលភាព ឬត្រូវបាន Revoke។
        </div>
        <div>
          <strong>🛠️ អ្វីដែលលោកគ្រូ អ្នកគ្រូត្រូវធ្វើ៖</strong> 
          សូមចូលទៅកាន់ <strong><a href="https://aistudio.google.com/app/apikey" target="_blank" style="color: #2563eb; text-decoration: underline;">aistudio.google.com/app/apikey</a></strong> បង្កើត ឬចម្លង Key ថ្មី រួចចុចប៊ូតុង <strong>«🔑 ពិនិត្យ / បញ្ចូល Gemini API Key ថ្មី»</strong> ខាងក្រោម។
        </div>
      `;
    }
  } else if (isQuotaExceeded) {
    if (titleEl) titleEl.textContent = 'ម៉ាស៊ីនបម្រើ Google ជាប់រវល់ ឬលើសកូតា (Overloaded / Quota Limit)';
    if (reasonEl) {
      reasonEl.innerHTML = `
        <div style="margin-bottom: 8px;">
          <strong>🔍 មូលហេតុ៖</strong> ម៉ាស៊ីនបម្រើ Google Gemini កំពុងមានអ្នកប្រើប្រាស់កកស្ទះ ឬគណនីបានដល់កម្រិតកំណត់នៃការស្នើសុំ (Rate Limit / Model Overloaded / Try Again Later)។
        </div>
        <div>
          <strong>🛠️ អ្វីដែលលោកគ្រូ អ្នកគ្រូត្រូវធ្វើ៖</strong> 
          សូមរង់ចាំប្រមាណ <strong>៣០ វិនាទី ទៅ ១ នាទី</strong> រួចចុចប៊ូតុង <strong>«🔄 ព្យាយាមបង្កើតម្តងទៀត»</strong> ឬពិនិត្យប្តូរ API Key ផ្សេងទៀត។
        </div>
      `;
    }
  } else if (isNetworkOrTimeout) {
    if (titleEl) titleEl.textContent = 'ការតភ្ជាប់ទៅ Google Gemini ដាច់ចង្វាក់ ឬលើសពេល (Timeout)';
    if (reasonEl) {
      reasonEl.innerHTML = `
        <div style="margin-bottom: 8px;">
          <strong>🔍 មូលហេតុ៖</strong> ការតភ្ជាប់បណ្តាញអ៊ីនធឺណិតមានការរអាក់រអួល ឬម៉ាស៊ីនបម្រើ Google Gemini មិនបានឆ្លើយតបក្នុងរយៈពេលកំណត់។
        </div>
        <div>
          <strong>🛠️ អ្វីដែលលោកគ្រូ អ្នកគ្រូត្រូវធ្វើ៖</strong> 
          សូមពិនិត្យមើលខ្សែបណ្តាញ Wi-Fi / អ៊ីនធឺណិតរបស់អ្នក រួចចុចប៊ូតុង <strong>«🔄 ព្យាយាមបង្កើតម្តងទៀត»</strong>។
        </div>
      `;
    }
  } else {
    if (titleEl) titleEl.textContent = 'មិនអាចដំណើរការតាម Google Gemini AI បានឡើយ';
    if (reasonEl) {
      reasonEl.innerHTML = `
        <div style="margin-bottom: 8px;">
          <strong>🔍 មូលហេតុ៖</strong> ម៉ាស៊ីនបម្រើ Google Gemini បានឆ្លើយតបកំហុស៖ <em>${escapeHtml(rawMsg.substring(0, 150))}</em>
        </div>
        <div>
          <strong>🛠️ អ្វីដែលលោកគ្រូ អ្នកគ្រូត្រូវធ្វើ៖</strong> 
          សូមចុចប៊ូតុង <strong>«🔄 ព្យាយាមបង្កើតម្តងទៀត»</strong> ឬពិនិត្យ API Key និងការតភ្ជាប់អ៊ីនធឺណិតរបស់អ្នកឡើងវិញ។
        </div>
      `;
    }
  }

  // Adjust button styles and visibility based on error type
  const btnOffline = document.getElementById('btnAiErrorOffline');
  const btnKey = document.getElementById('btnAiErrorKey');
  const btnClearKey = document.getElementById('btnAiErrorClearKey');
  const btnRetry = document.getElementById('btnAiErrorRetry');

  if (isNoKey) {
    if (btnKey) {
      btnKey.style.display = 'flex';
      btnKey.style.background = 'linear-gradient(135deg, #2563eb, #4f46e5)';
      btnKey.style.color = '#ffffff';
      btnKey.style.border = 'none';
      btnKey.style.fontWeight = '700';
      btnKey.style.boxShadow = '0 4px 12px rgba(37, 99, 235, 0.3)';
      btnKey.innerHTML = '<i class="fa-solid fa-key" style="color: #fde047;"></i> 🔑 បញ្ចូល Gemini API Key ឥឡូវនេះ (ឥតគិតថ្លៃ Free)';
    }
    if (btnOffline) {
      btnOffline.style.display = 'flex';
      btnOffline.style.background = '#f8fafc';
      btnOffline.style.color = '#475569';
      btnOffline.style.border = '1px solid #cbd5e1';
      btnOffline.style.fontWeight = '600';
      btnOffline.style.boxShadow = 'none';
      btnOffline.innerHTML = '<i class="fa-solid fa-file-lines"></i> 📋 មើលគ្រោងគំរូសេចក្ដីព្រាង (Offline Draft Template)';
    }
    if (btnClearKey) btnClearKey.style.display = 'none';
    if (btnRetry) btnRetry.style.display = 'none';
  } else {
    if (btnKey) {
      btnKey.style.display = 'flex';
      btnKey.style.background = 'white';
      btnKey.style.color = '#1d4ed8';
      btnKey.style.border = '1.5px solid #3b82f6';
      btnKey.style.fontWeight = '600';
      btnKey.style.boxShadow = 'none';
      btnKey.innerHTML = '<i class="fa-solid fa-key" style="color: #f59e0b;"></i> 🔑 ពិនិត្យ / បញ្ចូល API Key ថ្មី (Gemini / Groq)';
    }
    if (btnOffline) {
      btnOffline.style.display = 'flex';
      btnOffline.style.background = 'linear-gradient(135deg, #059669, #10b981)';
      btnOffline.style.color = 'white';
      btnOffline.style.border = 'none';
      btnOffline.style.fontWeight = '700';
      btnOffline.style.boxShadow = '0 4px 12px rgba(16, 185, 129, 0.25)';
      btnOffline.innerHTML = '<i class="fa-solid fa-bolt"></i> 🚀 បង្កើតភ្លាមៗតាម Smart Offline Engine (មិនបាច់រង់ចាំ / ឥតគិតថ្លៃ)';
    }
    if (btnClearKey) btnClearKey.style.display = (state.geminiApiKey || localStorage.getItem('gemini_api_key')) ? 'flex' : 'none';
    if (btnRetry) btnRetry.style.display = 'flex';
  }

  if (modal) {
    modal.style.display = 'flex';
  }
}
window.openAiErrorModal = openAiErrorModal;

function closeAiErrorModal() {
  const modal = document.getElementById('aiErrorModal');
  if (modal) modal.style.display = 'none';
}
window.closeAiErrorModal = closeAiErrorModal;

function retryAiGeneration() {
  closeAiErrorModal();
  handleGenerateLessonPlan();
}
window.retryAiGeneration = retryAiGeneration;

function openKeyFromAiErrorModal() {
  closeAiErrorModal();
  openApiKeyModal();
}
window.openKeyFromAiErrorModal = openKeyFromAiErrorModal;

function clearKeyAndRetry() {
  localStorage.removeItem('gemini_api_key');
  localStorage.removeItem('ai_provider');
  state.geminiApiKey = '';
  state.aiProvider = 'gemini';
  state.verifiedGeminiModel = null;
  checkApiKeyStatus();
  updateApiKeyModalUI();
  closeAiErrorModal();
  showToast('បានសម្អាត Key ចេញរួចរាល់! កំពុងដំណើរការតាម AI Server...', 'info');
  handleGenerateLessonPlan();
}
window.clearKeyAndRetry = clearKeyAndRetry;

function proceedOfflineDeliberately() {
  closeAiErrorModal();
  if (!pendingGenParams) return;
  const loadingOverlay = document.getElementById('loadingOverlay');
  if (loadingOverlay) loadingOverlay.style.display = 'flex';
  setLoadingOverlayStatus(
    'កំពុងរៀបចំតាម Smart Offline Engine...',
    'រៀបចំកិច្ចតែងការតាមទម្រង់ក្រសួង MoEYS ស្តង់ដារ (របៀប Offline)...',
    '⚙️ ដំណើរការ Offline Mode'
  );
  setTimeout(() => {
    try {
      const fallbackData = synthesizeLessonPlanOffline(pendingGenParams);
      fallbackData.isOfflineDraft = true;
      state.generatedPlanData = fallbackData;
      renderLessonPlanToA4(fallbackData);
      document.getElementById('emptyState').style.display = 'none';
      document.getElementById('printableDoc').style.display = 'block';
      showToast('⚠️ នេះជាគ្រោងគំរូសេចក្ដីព្រាង (Offline Draft) - សូមបញ្ចូល API Key ដើម្បីបង្កើតដោយ AI ពិតប្រាកដ', 'warning');
    } catch (e) {
      console.error('Offline generation error:', e);
      showToast('មានបញ្ហាក្នុងការបង្កើតកិច្ចតែងការ Offline', 'error');
    } finally {
      if (loadingOverlay) loadingOverlay.style.display = 'none';
    }
  }, 400);
}
window.proceedOfflineDeliberately = proceedOfflineDeliberately;

// ⚡ Groq Cloud Generator (Llama 3.3 70B & DeepSeek R1 - Ultra Fast)
async function generateWithGroqAPI(params) {
  const apiKey = (state.geminiApiKey || '').trim();
  const isFlipped = isFlippedLearningRequest(params);
  const isBd = !isFlipped && isBackwardDesignRequest(params);
  const totalMin = parseDurationToMinutes(params.duration);
  const stepTimeHints = calculateStepDurations(params.duration, isFlipped ? 'flipped' : (isBd ? 'backward_design' : 'standard'));

  const prompt = `Generate a complete MoEYS Lesson Plan in Khmer for ${params.lessonTitle} (${params.subject} ${params.grade}, ${params.duration}). Include 3 objectives (Knowledge, Skills, Attitudes), materials, teaching method, and ${isBd ? "3-stage UbD learning activities" : "5 in-class teaching steps with teacher activity, lesson content, and student activity"}. Do NOT include pre-test/post-test questions in this output (they are generated separately on-demand). Return strictly valid JSON.`;

  const candidateModels = [
    'llama-3.3-70b-versatile',
    'deepseek-r1-distill-llama-70b',
    'qwen-2.5-32b',
    'llama-3.1-8b-instant'
  ];

  let lastErr = null;
  for (let i = 0; i < candidateModels.length; i++) {
    const model = candidateModels[i];
    setLoadingOverlayStatus(
      '⚡ Groq AI កំពុងបង្កើតកិច្ចតែងការ...',
      `កំពុងបង្កើតតាមរយៈម៉ូដែល ${model} (Ultra-Fast)...`,
      `🚀 ដំណើរការ ${i + 1}/${candidateModels.length}`
    );

    try {
      const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: 'system', content: 'You are an AI pedagogical assistant for Cambodia MoEYS. Always respond strictly in valid JSON matching the lesson plan schema.' },
            { role: 'user', content: prompt + (params.lessonContent ? `\n\nLesson Material:\n${params.lessonContent.substring(0, 4000)}` : '') }
          ],
          temperature: 0.2,
          max_tokens: 8000,
          response_format: { type: 'json_object' }
        })
      });

      if (!resp.ok) {
        const errJson = await resp.json().catch(() => ({}));
        throw new Error(errJson.error?.message || `HTTP ${resp.status}`);
      }

      const resData = await resp.json();
      const content = resData.choices?.[0]?.message?.content;
      if (content) {
        const parsed = extractAndParseJson(content);
        if (parsed) return parsed;
      }
    } catch (e) {
      console.warn(`Groq model ${model} failed:`, e);
      lastErr = e;
    }
  }

  throw lastErr || new Error('Groq AI API failed');
}

// 🌐 OpenRouter Universal AI Generator (DeepSeek, Llama 3.3, Claude)
async function generateWithOpenRouterAPI(params) {
  const apiKey = (state.geminiApiKey || '').trim();
  const isFlipped = isFlippedLearningRequest(params);
  const prompt = `Generate a complete ${isFlipped ? 'Flipped Learning' : 'MoEYS'} Lesson Plan in Khmer for ${params.lessonTitle} (${params.subject} ${params.grade}, ${params.duration}). Return strictly valid JSON.`;

  const models = [
    'meta-llama/llama-3.3-70b-instruct:free',
    'deepseek/deepseek-r1:free',
    'google/gemini-2.0-flash-exp:free',
    'meta-llama/llama-3.3-70b-instruct'
  ];

  let lastErr = null;
  for (const model of models) {
    try {
      setLoadingOverlayStatus('🌐 OpenRouter AI កំពុងដំណើរការ...', `កំពុងបង្កើតតាមរយៈម៉ូដែល ${model}...`);
      const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'http://127.0.0.1:8765',
          'X-Title': 'AI Lesson Plan Studio'
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: 'system', content: 'You are an AI pedagogical assistant for Cambodia MoEYS. Always respond strictly in valid JSON.' },
            { role: 'user', content: prompt + (params.lessonContent ? `\n\nLesson Material:\n${params.lessonContent.substring(0, 4000)}` : '') }
          ]
        })
      });

      if (!resp.ok) {
        const errJson = await resp.json().catch(() => ({}));
        throw new Error(errJson.error?.message || `HTTP ${resp.status}`);
      }

      const resData = await resp.json();
      const content = resData.choices?.[0]?.message?.content;
      if (content) {
        const parsed = extractAndParseJson(content);
        if (parsed) return parsed;
      }
    } catch (e) {
      console.warn(`OpenRouter model ${model} failed:`, e);
      lastErr = e;
    }
  }

  throw lastErr || new Error('OpenRouter API failed');
}

// 🔍 Dynamic Google Gemini Model Discovery (Queries ModelService.ListModels from Google AI Studio)
async function discoverGeminiModels(apiKey) {
  if (!apiKey) return null;
  const versions = ['v1beta', 'v1'];
  for (const ver of versions) {
    try {
      const resp = await fetch(`https://generativelanguage.googleapis.com/${ver}/models?key=${apiKey}`);
      if (resp.ok) {
        const data = await resp.json();
        if (data.models && Array.isArray(data.models)) {
          const supported = data.models
            .filter(m => {
              if (!m.name) return false;
              if (m.supportedGenerationMethods && !m.supportedGenerationMethods.includes('generateContent')) {
                return false;
              }
              const n = m.name.toLowerCase();
              const baseName = n.replace(/^models\//, '');
              if (!baseName.startsWith('gemini')) return false;
              if (n.includes('embedding') || n.includes('imagen') || n.includes('aqa') || n.includes('gemma') || n.includes('learnlm')) return false;
              return true;
            })
            .map(m => ({
              ver: ver,
              name: m.name.replace(/^models\//, ''),
              displayName: m.displayName || m.name
            }));
          if (supported.length > 0) {
            console.log(`[AI Engine] Discovered ${supported.length} models for key (${ver}):`, supported.map(x => x.name));
            return supported;
          }
        }
      }
    } catch (e) {
      console.warn(`[Model Discovery] Error fetching ${ver}/models:`, e);
    }
  }
  return null;
}
window.discoverGeminiModels = discoverGeminiModels;

// 🌐 Backend Server API Generator (uses Vercel GEMINI_API_KEY env var - no personal key needed)
async function generateWithBackendAPI(params) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 360000); // 6-minute timeout (more than 5 mins)

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject: params.subject,
        grade: params.grade,
        lessonTitle: params.lessonTitle,
        chapter: params.chapter,
        school: params.school,
        teacher: params.teacher,
        duration: params.duration,
        method: params.method,
        customNotes: params.customNotes,
        lessonContent: params.lessonContent,
        language: params.language,
        templateMode: params.templateMode,
        presetId: params.presetId,
        customTemplate: params.customTemplate,
        apiKey: '' // server uses its own env key
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Server error ${res.status}: ${errText}`);
    }

    const json = await res.json();
    if (!json.success) {
      throw new Error(json.error || 'Server generation failed');
    }
    return json.data;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}
window.generateWithBackendAPI = generateWithBackendAPI;

// 🤖 Google Gemini API Generator
async function generateWithGeminiAPI(params) {
  const apiKey = state.geminiApiKey;
  const isFlipped = isFlippedLearningRequest(params);
  const isBd = !isFlipped && isBackwardDesignRequest(params);

  const totalMin = parseDurationToMinutes(params.duration);
  const stepTimeHints = calculateStepDurations(params.duration, isFlipped ? 'flipped' : (isBd ? 'backward_design' : 'standard'));
  const isLongSession = totalMin >= 90;

  let systemPrompt;
  if (isFlipped) {
    systemPrompt = `You are Google Gemini AI serving as an expert Cambodian pedagogical educator, 21st-century instructional designer, and Google NotebookLM specialist for the Ministry of Education, Youth and Sport (MoEYS).
Your mission is to deeply analyze the uploaded lesson content and generate an authentic, 100% lesson-specific, state-of-the-art Flipped Learning Lesson Plan (កិច្ចតែងការបង្រៀនតាមបែបថ្នាក់រៀនត្រឡប់) in Khmer.

CRITICAL DURATION & ACTIVITY SCALING (${totalMin} MINUTES TOTAL):
1. Total teaching duration is ${params.duration} (${totalMin} minutes). You MUST allocate step durations:
- ជំហានទី ១: ${stepTimeHints.step1}
- ជំហានទី ២: ${stepTimeHints.step2}
- ជំហានទី ៣: ${stepTimeHints.step3}
- ជំហានទី ៤: ${stepTimeHints.step4}
- ជំហានទី ៥: ${stepTimeHints.step5}

2. DURATION-REFLECTIVE ACTIVITIES & STUDY MATERIALS:
${isLongSession ? `• This is an EXTENDED ${totalMin}-minute block (Multi-hour / Workshop / Deep Learning Session).
• Study Materials MUST include: Comprehensive Case Studies, Group Flipcharts (ក្រដាសផ្ទាំងធំ A0/A1), Color Markers (ប៊ិចហ្វឺតពណ៌), Mission Worksheets (សន្លឹកបេសកកម្មក្រុម), Digital Tools / Simulation, Rubric Assessment Sheets.
• Step 4 (${stepTimeHints.step4}) MUST be rich, detailed, and structured into progressive phases:
  - ដំណាក់កាលទី ១ : ការពិភាក្សា និងវិភាគបញ្ហាស៊ីជម្រៅក្នុងក្រុម
  - ដំណាក់កាលទី ២ : ការអនុវត្តជាក់ស្តែង ការគណនា ឬការធ្វើពិសោធន៍លើផ្ទាំងក្រដាសធំ
  - ដំណាក់កាលទី ៣ : ការធ្វើ Gallery Walk ឬការឡើងការពារបទបង្ហាញ និងដេញដោល
  - ដំណាក់កាលទី ៤ : ការបូកសរុបទាញក្បួនគន្លឹះរួមថ្នាក់${totalMin >= 120 ? ' (រួមទាំងលំហាត់បំផុសស្មារតី Brain Break ២ នាទី)' : ''}` : `• Tailor the depth of activities and study materials proportionally to standard class time.`}

🚨 ABSOLUTE CRITICAL RULES — VIOLATION = FAILURE:
1. MANDATORY 3-COLUMN ALIGNMENT & UNIVERSITY/TEC PEDAGOGICAL QUESTIONING STANDARDS (សំណួរ ➔ ចម្លើយ ➔ ចម្លើយរំពឹងទុករបស់សិស្ស):
   ក. កូតាកំណត់ និងការស្រង់សំណួរពីឯកសារ/ស្លាយ (Question Quotas & Exhaustive Extraction):
      - ប្រសិនបើក្នុងឯកសារ ឬស្លាយមេរៀនដែលបាន Upload មានសំណួរស្រាប់ អ្នកត្រូវតែស្រង់យកសំណួរទាំងអស់មកប្រើប្រាស់ឱ្យគ្រប់ ១០០% ដោយហាមដាច់ខាតកាត់ចោល ឬសង្ខេបមកត្រឹម ២ សំណួរ!
      - កូតាកំណត់តាមទម្រង់សកម្មភាពគរុកោសល្យឧត្តមសិក្សា / គរុនិស្សិត៖
        • [ការពិភាក្សាក្រុម (Group Discussion)]៖ ត្រូវតែមាន ៤ សំណួរពេញលេញ (១. «...?» ២. «...?» ៣. «...?» ៤. «...?») សម្រាប់ចែកក្រុមពិភាក្សា! (បើក្នុងស្លាយមាន ៤ សំណួរ ត្រូវស្រង់យកទាំង ៤ មកប្រើ)
        • [ការស្រាវជ្រាវ (Research / Inquiry Tasks)]៖ ត្រូវមានរហូតដល់ ១០ ប្រធានបទជាក់លាក់ ដើម្បីឱ្យគរុនិស្សិតជ្រើសរើសស្រាវជ្រាវតាមក្រុម!
        • [ការសួរឆ្លើយផ្ទាល់មាត់ (Oral Q&A / Whole-class interactive)]៖ ត្រូវមាន ៦ សំណួរជាក់លាក់សម្រាប់គ្រូសួរ-សិស្សឆ្លើយ!
        • [ករណីសិក្សា (Case Studies / Problem Scenarios)]៖ ត្រូវកំណត់ត្រឹម ១ ឬ ២ ករណីសិក្សាជាក់ស្តែងសម្រាប់ក្រុមនិស្សិតវិភាគស៊ីជម្រៅ!
   ខ. វិធានតម្រឹម ៣ ជួរឈរ (3-Column Alignment):
      - teacherActivity: រាល់សំណួរទាំងអស់ (៤ សំណួរពិភាក្សាក្រុម, ៦ សំណួរផ្ទាល់មាត់, ឬ ១-២ ករណីសិក្សា) ត្រូវសរសេរក្នុងប្រអប់នេះជាលាយលក្ខណ៍អក្សរច្បាស់ៗក្នុងសញ្ញាសម្រង់ «...» តាមលេខរៀង (ឧ. គ្រូចោទសំណួរពិភាក្សា ៤ សំណួរ៖ «១. ...? ២. ...? ៣. ...? ៤. ...?»)
      - contentSummary: ត្រូវតែជា "ចម្លើយពេញលេញ ត្រឹមត្រូវតាមក្បួនទ្រឹស្តី" សម្រាប់គ្រប់សំណួរទាំងអស់ខាងលើ តាមលេខរៀង (ចម្លើយទី១៖ [ខ្លឹមសារពេញលេញ], ចម្លើយទី២៖ [...], ចម្លើយទី៣៖ [...], ចម្លើយទី៤៖ [...]) រួមទាំងខ្លឹមសារមេរៀនស្នូល! (មិនត្រូវសរសេរសំណួរក្នុងប្រអប់នេះឡើយ)
      - studentActivity: ត្រូវសរសេរ "ចម្លើយរំពឹងទុករបស់សិស្ស" ទៅតាមសំណួរនីមួយៗ ដោយទាញចេញពីចម្លើយក្នុងប្រអប់ [ខ្លឹមសារ] គ្រាន់តែសង្ខេបខ្លីៗ ព្រោះវាជាការទស្សទាយការឆ្លើយរបស់សិស្ស (ឧ. សិស្សឆ្លើយ (ចម្លើយរំពឹងទុក)៖ «- សំណួរទី១៖ [សង្ខេបចម្លើយ], - សំណួរទី២៖ [សង្ខេបចម្លើយ], - សំណួរទី៣៖ [សង្ខេបចម្លើយ], - សំណួរទី៤៖ [សង្ខេបចម្លើយ]») រួមទាំងសកម្មភាពសហការលើ Flipchart និងការកត់ត្រា!
2. ZERO PLACEHOLDERS: Every single field in the JSON MUST contain REAL, SPECIFIC, CLASSROOM-READY content in Khmer. NEVER write "...", "...", or template-style filler. Every sentence must be a complete, meaningful Khmer sentence a teacher can read and use immediately.
3. CONTENT-SPECIFIC: All activities, questions, explanations, and objectives MUST be directly tied to the exact lesson topic and subject matter provided. Do NOT generate generic content.
4. TEACHER-READY: Write as if this plan will be printed and handed to a teacher tomorrow morning. Every teacher activity, student activity, and explanation must be clear, specific, and actionable.
5. REAL QUESTIONS: Pre-test and Post-test questions MUST be actual, answerable multiple-choice questions about this specific lesson — not examples or placeholders.
6. TTT 30% / STT 70% RULE: In Step 4, explicitly design activities so the Teacher Talking Time is max 30%, and Student Talking Time is 70% (Student-Centered).
7. 21st CENTURY SKILLS (4Cs): At the end of student activities (especially in Step 4), tag the exact 4Cs skill being developed in brackets (e.g., [ជំនាញសហការ និងការគិតស៊ីជម្រៅ]).
8. EXIT TICKET 3-2-1: In Step 5 (teacherActivity & studentActivity), you MUST include an "Exit Ticket 3-2-1" formative assessment (e.g., សរសេរ ៣ចំណុចដែលបានរៀន, ២ចំណុចដែលចាប់អារម្មណ៍, ១ចំណុចដែលឆ្ងល់).
9. MANDATORY INSTRUCTIONAL OBJECTIVE FORMULA (ក្បួនតែងវត្ថុបំណងបង្រៀនស្តង់ដារ MoEYS / គរុកោសល្យ A-C-S / ABCD):
   រាល់ចំណុចវត្ថុបំណងនីមួយៗទាំង ៣ ផ្នែក (វិជ្ជាសម្បទា បំណិនសម្បទា ចរិយាសម្បទា) ត្រូវតែមានសមាសភាគពេញលេញទាំង ៣ យ៉ាងម៉ឺងម៉ាត់៖
   - [A - Action / សកម្មភាព ឬ របៀបធ្វើសកម្មភាព]: ប្រើកិរិយាស័ព្ទសកម្មដែលអាចវាស់វែងបាន (ឧ. កំណត់, ពន្យល់, រៀបរាប់, គណនា, វិភាគ, ដោះស្រាយ, រៀបចំ, បង្ហាញ, ប្ដេជ្ញាចិត្ត...)
   - [C - Condition / លក្ខខណ្ឌ]: មធ្យោបាយ ឬវិធីសាស្ត្ររៀន (ឧ. «តាមរយៈការពន្យល់របស់គ្រូ និងការសង្កេតស្លាយ/វីដេអូ», «តាមរយៈការអានឯកសារគោល», «តាមរយៈការអនុវត្តលំហាត់ជាក់ស្តែង និងការពិភាក្សាជាក្រុម», «តាមរយៈការឆ្លុះបញ្ចាំងលើ Exit Ticket»...)
   - [S / D - Standard / ស្ដង់ដារ ឬ កម្រិតកំណត់]: កម្រិតកំណត់នៃការសម្រេចបាន (ឧ. «បានត្រឹមត្រូវ និងក្បោះក្បាយ», «បានយ៉ាងហោចណាស់ ៨០% ត្រឹមត្រូវ», «បានច្បាស់លាស់ឥតខុសឆ្គង», «ប្រកបដោយភាពជឿជាក់ និងស្ទាត់ជំនាញ», «ប្រកបដោយស្មារតីទទួលខុសត្រូវខ្ពស់»)
   ⚠️ ហាមដាច់ខាតសរសេរតែសកម្មភាពកាត់ៗ (ឧ. «ពន្យល់បានពី...») ដោយគ្មានលក្ខខណ្ឌ (Condition: តាមរយៈ...) និងគ្មានស្ដង់ដារ (Standard: បានត្រឹមត្រូវ...)!
10. INTEGRATION OF PRIMARY TEACHING METHOD (${params.method || '5E'}):
   - វិធីសាស្ត្របង្រៀនចម្បងដែលលោកគ្រូ/អ្នកគ្រូបានជ្រើសរើសគឺ៖ «${params.method}»។
   - ត្រូវបញ្ចូលវិធីសាស្ត្រនេះចូលក្នុងដំណើរការបង្រៀន ៥ ជំហាន (steps) ជាពិសេសជំហានទី ៣ និងទី ៤ ឱ្យស៊ីជម្រៅបំផុត។
   ${(params.method || '').toLowerCase().includes('5e') ? `
   - ដោយសារវិធីសាស្ត្រ «5E» ត្រូវបានជ្រើសរើស ត្រូវរៀបចំដំណាក់កាលទាំង ៥ នៃ 5E ឱ្យឆ្លុះបញ្ចាំងក្នុង ៥ ជំហាន៖
     • ជំហានទី ១ & ២: ផ្សារភ្ជាប់ដំណាក់កាល Engage (ឈានចូល & បំផុសចំណាប់អារម្មណ៍ តាមរយៈលទ្ធផល Pre-Test & Muddiest Points)
     • ជំហានទី ៣: ផ្សារភ្ជាប់ដំណាក់កាល Explore (រុករក & ពិសោធន៍ តាមសន្លឹកបេសកកម្ម Challenge Scenario)
     • ជំហានទី ៤: ផ្សារភ្ជាប់ដំណាក់កាល Explain & Elaborate (ពន្យល់រកឃើញ និងពង្រីកចំណេះដឹងដោះស្រាយបញ្ហាស៊ីជម្រៅ ៧០%)
     • ជំហានទី ៥: ផ្សារភ្ជាប់ដំណាក់កាល Evaluate (វាយតម្លៃសមត្ថភាព តាមរយៈ Exit Ticket 3-2-1 & Post-Test)
   ` : ''}

CRITICAL INSTRUCTIONS FOR AI GENERATION:
1. Deep Content Analysis: Thoroughly examine the provided lesson content. Extract real definitions, terms, rules, formulas, and examples. Use them everywhere in the plan.
2. Objectives: Strictly format every single objective statement using the 3 components: [Action] + [Content] + [Condition: តាមរយៈ...] + [Standard: បានត្រឹមត្រូវ/ច្បាស់លាស់...]!
3. Core Focus: Focus 100% of your pedagogical output on Objectives, Materials, and the 5-Step Teaching Process (5%-10%-10%-70%-5%). Do NOT generate pre-test or post-test question arrays in this JSON (they are generated separately on-demand).
4. Step 4 (Active Learning Core 70%): You MUST dynamically choose and apply ONE of these 4 advanced pedagogies: (1) Jigsaw Cooperative Learning (ក្រុមអ្នកជំនាញ), (2) Concept Mapping (ការគូសផែនទីគំនិត), (3) Role-Play/Phenomenon-Based Simulation (ការដើរតួដោះស្រាយវិបត្តិ), or (4) Metacognitive Reflection/Advanced Exit Tickets (ការត្រិះរិះពិចារណាពីការគិត). Describe a SPECIFIC, RICH group activity applying this chosen pedagogy directly based on the lesson content with clear progressive phases.

Return ONLY valid JSON matching this schema:
{
  "templateType": "flipped_learning",
  "templateTitle": "កិច្ចតែងការបង្រៀនតាមបែបត្រឡប់",
  "school": "${params.school}",
  "teacher": "${params.teacher}",
  "subject": "${params.subject}",
  "grade": "${params.grade}",
  "credits": "៣ ក្រេឌីត (៣-០-៦)",
  "year": "១",
  "semester": "២",
  "week": "១",
  "lessonNumber": "១",
  "duration": "${params.duration}",
  "chapter": "${params.chapter || ''}",
  "lessonTitle": "${params.lessonTitle}",
  "method": "ការរៀនបែបត្រឡប់",
  "dateStr": "ថ្ងៃ... ខែ... ឆ្នាំ២០២...",
  "objectives": {
    "intro": "បន្ទាប់ពីរៀនមេរៀននេះចប់ គរុនិស្សិតនឹង៖",
    "knowledge": [
      "ពន្យល់ពីគោលការណ៍គ្រឹះ និងនិយមន័យនៃ «${params.lessonTitle}» តាមរយៈការសង្កេតស្លាយបង្រៀន និងការពន្យល់របស់គ្រូ បានត្រឹមត្រូវ និងក្បោះក្បាយ។"
    ],
    "skills": [
      "វិភាគ និងដោះស្រាយលំហាត់/កិច្ចការជាក់ស្តែងនៃ «${params.lessonTitle}» តាមរយៈការអនុវត្តការងារជាក្រុម បានត្រឹមត្រូវតាមក្បួនខ្នាត។"
    ],
    "attitudes": [
      "បង្ហាញនូវស្មារតីសហការ យកចិត្តទុកដាក់ និងការគោរពវិន័យ តាមរយៈការចូលរួមសកម្មភាពក្រុម ប្រកបដោយទំនួលខុសត្រូវខ្ពស់។"
    ]
  },
  "materials": {
    "teacher": ["កិច្ចតែងការបង្រៀន", "វីដេអូបង្រៀន", "ស្លាយបង្រៀន", "សន្លឹកកិច្ចការករណីសិក្សា"],
    "student": ["សៀវភៅគោល", "សៀវភៅកត់ត្រា", "ផ្ទាំងក្រដាសធំ Flipchart", "ប៊ិចហ្វឺតពណ៌"]
  },
  "steps": [
    {
      "stepNumber": 1,
      "stepTitle": "ជំហានទី១៖ រដ្ឋបាលថ្នាក់",
      "duration": "${stepTimeHints.step1}",
      "teacherActivity": "ពិនិត្យអនាម័យ វត្តមាន សណ្ដាប់ធ្នាប់",
      "contentSummary": "ការពិនិត្យអនាម័យ សម្រង់វត្តមាន និងសណ្ដាប់ធ្នាប់",
      "studentActivity": "ប្រធានថ្នាក់រាយការណ៍ និងត្រៀមរៀន"
    },
    {
      "stepNumber": 2,
      "stepTitle": "ជំហានទី២៖ រំលឹកមេរៀនចាស់",
      "duration": "${stepTimeHints.step2}",
      "teacherActivity": "ពិនិត្យការស្វ័យសិក្សា និងបង្ហាញលទ្ធផលបុរេតេស្ត (Pre-Test QCM ៥ សំណួរ)",
      "contentSummary": "វិភាគលទ្ធផលបុរេតេស្ត និងស្រាយចម្ងល់ Muddiest Points",
      "studentActivity": "ឆ្លើយសំណួររំលឹក និងលើកឡើងចំណុចចម្ងល់"
    },
    {
      "stepNumber": 3,
      "stepTitle": "ជំហានទី៣៖ ខ្លឹមសារមេរៀនថ្មី",
      "duration": "${stepTimeHints.step3}",
      "teacherActivity": "ពន្យល់សង្ខេបតែលើគំនិតស្នូល និងក្របខណ្ឌទ្រឹស្តីសំខាន់ៗនៃមេរៀន",
      "contentSummary": "ខ្លឹមសារស្នូល និងទ្រឹស្តីគន្លឹះនៃមេរៀន",
      "studentActivity": "យកចិត្តទុកដាក់ស្តាប់ កត់ត្រាគំនិតសំខាន់ៗ និងសួរសំណួរ"
    },
    {
      "stepNumber": 4,
      "stepTitle": "ជំហានទី៤៖ ពង្រឹងចំណេះដឹង",
      "duration": "${stepTimeHints.step4}",
      "teacherActivity": "[ពិពណ៌នាសកម្មភាពគ្រូដោយប្រើវិធីសាស្ត្រមួយក្នុងចំណោម៖ Jigsaw, Concept Mapping, Role-Play, ឬ Metacognition។ ធានាថាគ្រូនិយាយត្រឹម ៣០%]...",
      "contentSummary": "[សង្ខេបខ្លឹមសារសកម្មភាព និងទ្រឹស្តីគន្លឹះ]...",
      "studentActivity": "[សកម្មភាពសិស្សឆ្លើយតបទៅនឹងវិធីសាស្ត្រដែលបានជ្រើសរើស]... [ជំនាញសហការ និងការគិតស៊ីជម្រៅ 4Cs]"
    },
    {
      "stepNumber": 5,
      "stepTitle": "ជំហានទី៥៖ កិច្ចការផ្ទះ និងបណ្ដាំផ្ញើ",
      "duration": "${stepTimeHints.step5}",
      "teacherActivity": "គ្រូដាក់សកម្មភាព Exit Ticket 3-2-1 (៣ចំណុចដែលបានរៀន, ២ចំណុចចាប់អារម្មណ៍, ១ចំណុចឆ្ងល់) ណែនាំការធ្វើតេស្តបញ្ចប់ (Post-Test ៥ សំណួរ) និងដាក់កិច្ចការស្រាវជ្រាវបន្ត",
      "contentSummary": "ការវាយតម្លៃ Formative តាមរយៈ Exit Ticket 3-2-1 និងកិច្ចការស្រាវជ្រាវសម្រាប់ម៉ោងក្រោយ",
      "studentActivity": "សិស្សសរសេរ Exit Ticket 3-2-1 ធ្វើ Post-Test ភ្លាមៗ និងកត់ត្រាកិច្ចការផ្ទះ"
    }
  ]
};
`

  } else if (isBd) {
    systemPrompt = `You are an expert Cambodian pedagogical educator and TEC (Teacher Education College) curriculum developer.
Generate a complete, high-quality Backward Design / UbD Lesson Plan (កិច្ចតែងការបង្រៀន តាមបែបត្រឡប់ ៣ ដំណាក់កាល) in Khmer.

CRITICAL DURATION ALLOCATION (${totalMin} MINUTES):
Total duration is ${params.duration} (${totalMin} minutes). You MUST set stage 3 step durations: Step 1 (${stepTimeHints.step1}), Step 2 (${stepTimeHints.step2}), Step 3 (${stepTimeHints.step3}), Step 4 (៥ នាទី).
${isLongSession ? `Adapt materials to include group flipcharts, markers, and multi-stage exploratory projects.` : ''}

🚨 ABSOLUTE CRITICAL RULES — VIOLATION = FAILURE:
1. ZERO PLACEHOLDERS: Every field MUST contain REAL, SPECIFIC Khmer content. NEVER write "...", "...", or generic filler. Every sentence must be complete, meaningful, and directly about this lesson topic.
2. CONTENT-SPECIFIC: All stage descriptions, activities, assessment criteria, and objectives MUST be directly tied to the lesson title and subject matter provided.
3. TEACHER-READY: This plan will be printed and used by a real teacher tomorrow. Write every teacher action and student activity in complete, clear Khmer sentences.
4. REAL ASSESSMENTS: Stage 1 performance tasks and assessment criteria must be actual, specific, evaluatable evidence of learning — not generic descriptions.

Return ONLY valid JSON matching this schema:
{
  "templateType": "backward_design",
  "templateTitle": "កិច្ចតែងការបង្រៀន (តាមបែបត្រឡប់ - Backward Design / UbD)",
  "school": "${params.school}",
  "teacher": "${params.teacher}",
  "subject": "${params.subject}",
  "grade": "${params.grade}",
  "duration": "${params.duration}",
  "chapter": "${params.chapter || ''}",
  "lessonTitle": "${params.lessonTitle}",
  "dateStr": "ថ្ងៃ... ខែ... ឆ្នាំ២០២...",
  "objectives": {
    "knowledge": ["...", "..."],
    "skills": ["...", "..."],
    "attitudes": ["...", "..."]
  },
  "materials": {
    "teacher": ["...", "..."],
    "student": ["...", "..."]
  },
  "stage1": {
    "title": "ដំណាក់កាលទី ១ : ការកំណត់លទ្ធផលរំពឹងទុក (Stage 1: Desired Results)",
    "establishedGoals": "...",
    "enduringUnderstandings": ["...", "..."],
    "essentialQuestions": ["...", "..."],
    "objectives": {
      "knowledge": ["...", "..."],
      "skills": ["...", "..."],
      "attitudes": ["...", "..."]
    }
  },
  "stage2": {
    "title": "ដំណាក់កាលទី ២ : ការកំណត់ភស្តុតាងនៃការវាយតម្លៃ (Stage 2: Assessment Evidence)",
    "performanceTasks": ["...", "..."],
    "otherEvidence": ["...", "..."],
    "criteria": ["...", "..."]
  },
  "stage3": {
    "title": "ដំណាក់កាលទី ៣ : ផែនការរៀបចំការបង្រៀន និងរៀន (Stage 3: Learning Plan)",
    "materials": {
      "teacher": ["...", "..."],
      "student": ["...", "..."]
    },
    "learningActivities": [
      {
        "stepNumber": 1,
        "stepTitle": "១. ការទាក់ទាញ និងភ្ជាប់ទំនាក់ទំនង (Hook & Connect)",
        "duration": "${stepTimeHints.step1}",
        "teacherActivity": "...",
        "contentSummary": "...",
        "studentActivity": "..."
      },
      {
        "stepNumber": 2,
        "stepTitle": "២. ការរុករក និងកសាងចំណេះដឹង (Equip & Explore)",
        "duration": "${stepTimeHints.step2}",
        "teacherActivity": "...",
        "contentSummary": "...",
        "studentActivity": "..."
      },
      {
        "stepNumber": 3,
        "stepTitle": "៣. ការឆ្លុះបញ្ចាំង និងកែសម្រួល (Rethink & Reflect)",
        "duration": "${stepTimeHints.step3}",
        "teacherActivity": "...",
        "contentSummary": "...",
        "studentActivity": "..."
      },
      {
        "stepNumber": 4,
        "stepTitle": "៤. ការវាយតម្លៃ និងការអនុវត្តបន្ត (Evaluate & Exhibit)",
        "duration": "៥ នាទី",
        "teacherActivity": "...",
        "contentSummary": "...",
        "studentActivity": "..."
      }
    ]
  }
}`;
  } else {
    systemPrompt = `You are THREE experts working together as one:
1. 🎓 CAMBODIA MoEYS CURRICULUM EXPERT — Deep knowledge of the official Cambodian national curriculum (NEP 2030, MoEYS textbooks grades 1-12), teaching standards, and subject matter across all disciplines.
2. 📚 SUBJECT MATTER SPECIALIST — Expert in the specific subject being taught. You know the textbook content, key definitions, formulas, concepts, examples, and activities for this topic at this grade level.
3. 🏫 CLASSROOM COACH — You write instructions that real teachers can read and follow immediately. You think like a teacher standing in front of a class.

YOUR MISSION: Generate a COMPLETE, PROFESSIONAL, CLASSROOM-READY official Cambodian Lesson Plan (កិច្ចតែងការបង្រៀន) in Khmer that a teacher can print and use TOMORROW MORNING without changing a single word.

═══════════════════════════════════════════════════
STEP DURATION ALLOCATION (${totalMin} MINUTES TOTAL):
═══════════════════════════════════════════════════
- ជំហានទី ១ (រដ្ឋបាលថ្នាក់): ${stepTimeHints.step1}
- ជំហានទី ២ (រំលឹកមេរៀនចាស់): ${stepTimeHints.step2}
- ជំហានទី ៣ (មេរៀនថ្មី): ${stepTimeHints.step3}
- ជំហានទី ៤ (ពង្រឹងពុទ្ធិ): ${stepTimeHints.step4}
- ជំហានទី ៥ (បណ្ដាំ + កិច្ចការ): ${stepTimeHints.step5}

═══════════════════════════════════════════════════
🎯 វិធានគរុកោសល្យកម្ពុជា & ស្តង់ដារឧត្តមសិក្សា/TEC (សំណួរ ➔ ចម្លើយ ➔ ចម្លើយរំពឹងទុករបស់សិស្ស):
═══════════════════════════════════════════════════
សម្រាប់គ្រប់ជំហានទាំងអស់ (ជាពិសេស ជំហានទី ២, ជំហានទី ៣, ជំហានទី ៤) អ្នកត្រូវតែអនុវត្តតាមក្បួន ៣ ជួរឈរនេះជាដាច់ខាត៖

ក. កូតាកំណត់ និងការស្រង់សំណួរពីឯកសារ/ស្លាយ (Question Quotas & Exhaustive Extraction):
   - ប្រសិនបើក្នុងឯកសារ ឬស្លាយមេរៀនដែលបាន Upload មានសំណួរស្រាប់ អ្នកត្រូវតែស្រង់យកសំណួរទាំងអស់មកប្រើប្រាស់ឱ្យគ្រប់ ១០០% ដោយហាមដាច់ខាតកាត់ចោល ឬសង្ខេបមកត្រឹម ២ សំណួរ!
   - កូតាកំណត់តាមទម្រង់សកម្មភាពគរុកោសល្យឧត្តមសិក្សា / គរុនិស្សិត៖
     • [ការពិភាក្សាក្រុម (Group Discussion)]៖ ត្រូវតែមាន ៤ សំណួរពេញលេញ (១. «...?» ២. «...?» ៣. «...?» ៤. «...?») សម្រាប់ចែកក្រុមពិភាក្សា!
     • [ការស្រាវជ្រាវ (Research / Inquiry Tasks)]៖ ត្រូវមានរហូតដល់ ១០ ប្រធានបទជាក់លាក់ ដើម្បីឱ្យគរុនិស្សិតជ្រើសរើសស្រាវជ្រាវតាមក្រុម!
     • [ការសួរឆ្លើយផ្ទាល់មាត់ (Oral Q&A / Interactive)]៖ ត្រូវមាន ៦ សំណួរជាក់លាក់សម្រាប់គ្រូសួរ-សិស្សឆ្លើយ!
     • [ករណីសិក្សា (Case Studies / Problem Scenarios)]៖ ត្រូវកំណត់ត្រឹម ១ ឬ ២ ករណីសិក្សាជាក់ស្តែងសម្រាប់ក្រុមនិស្សិតវិភាគស៊ីជម្រៅ!

ខ. វិធានតម្រឹម ៣ ជួរឈរ (3-Column Alignment):
១. ក្នុង [សកម្មភាពគ្រូ] (teacherActivity):
   - រាល់ "សំណួរទាំងអស់" ដែលគ្រូចោទសួរ (៤ សំណួរពិភាក្សាក្រុម, ៦ សំណួរផ្ទាល់មាត់, ឬ ១-២ ករណីសិក្សា) ត្រូវសរសេរនៅក្នុងប្រអប់នេះជាលាយលក្ខណ៍អក្សរច្បាស់ៗក្នុងសញ្ញាសម្រង់ «...» តាមលេខរៀង៖
     • គ្រូដាក់សំណួរពិភាក្សា ៤ សំណួរ៖
       ១. «[សំណួរជាក់លាក់ទី១]?»
       ២. «[សំណួរជាក់លាក់ទី២]?»
       ៣. «[សំណួរជាក់លាក់ទី៣]?»
       ៤. «[សំណួរជាក់លាក់ទី៤]?»
     • គ្រូដើរសម្របសម្រួល ត្រួតពិនិត្យ និងលើកទឹកចិត្ត...

២. ក្នុង [ខ្លឹមសារមេរៀន] (contentSummary):
   - ត្រូវតែជា "ចម្លើយពេញលេញ ត្រឹមត្រូវតាមក្បួនទ្រឹស្តី" សម្រាប់គ្រប់សំណួរទាំងអស់ខាងលើ តាមលេខរៀង រួមទាំងនិយមន័យ រូបមន្ត និងខ្លឹមសារមេរៀនស្នូល!
   - មិនត្រូវសរសេរសំណួរក្នុងប្រអប់នេះទេ គឺសរសេរចម្លើយនៃសំណួរ និងខ្លឹមសារបង្រៀន៖
     • ខ្លឹមសារស្នូល និងចម្លើយនៃសំណួរទាំង ៤៖
       - ចម្លើយទី១៖ [ចម្លើយពេញលេញ និងត្រឹមត្រូវ តាមកម្រិតសិក្សា]
       - ចម្លើយទី២៖ [ចម្លើយពេញលេញ និងត្រឹមត្រូវ]
       - ចម្លើយទី៣៖ [ចម្លើយពេញលេញ និងត្រឹមត្រូវ]
       - ចម្លើយទី៤៖ [ចម្លើយពេញលេញ និងត្រឹមត្រូវ]
       - [និយមន័យ រូបមន្ត ឬខ្លឹមសារស្នូលនៃមេរៀន]

៣. ក្នុង [សកម្មភាពសិស្ស] (studentActivity):
   - ត្រូវតែ "សង្ខេបចម្លើយចេញពី [ខ្លឹមសារមេរៀន] យកមកដាក់ជាចម្លើយរំពឹងទុករបស់សិស្ស" ទៅតាមសំណួរនីមួយៗ ព្រោះវាជាការទស្សទាយការឆ្លើយរបស់សិស្ស!
   - គំរូទម្រង់សរសេរ៖
     • សិស្សពិភាក្សាជាក្រុម និងឆ្លើយសំណួររបស់គ្រូ៖
       - សិស្សឆ្លើយ (ចម្លើយរំពឹងទុក)៖
         • សំណួរទី១៖ «[សង្ខេបចម្លើយរបស់សិស្សចេញពីខ្លឹមសារមេរៀន]»
         • សំណួរទី២៖ «[សង្ខេបចម្លើយរបស់សិស្សចេញពីខ្លឹមសារមេរៀន]»
         • សំណួរទី៣៖ «[សង្ខេបចម្លើយរបស់សិស្សចេញពីខ្លឹមសារមេរៀន]»
         • សំណួរទី៤៖ «[សង្ខេបចម្លើយរបស់សិស្សចេញពីខ្លឹមសារមេរៀន]»
     • សិស្សកត់ត្រាខ្លឹមសារសំខាន់ៗលើផ្ទាំង Flipchart និងចូលរួមធ្វើបទបង្ហាញការពារលទ្ធផល។

៤. វិធានគរុកោសល្យកម្រិតខ្ពស់ (Advanced Pedagogical Rules):
   - ច្បាប់ TTT 30% / STT 70%: នៅក្នុងជំហានទី៤ ត្រូវរៀបចំសកម្មភាពយ៉ាងណាឱ្យគ្រូនិយាយត្រឹមតែ ៣០% និងសិស្សអនុវត្ត/ពិភាក្សា ៧០%។
   - ជំនាញសតវត្សទី២១ (4Cs): ត្រូវដាក់រង្វង់ក្រចកបញ្ជាក់ពីជំនាញ 4Cs នៅចុងសកម្មភាពសិស្ស (ឧ. [ជំនាញសហការ និងការគិតស៊ីជម្រៅ])។
   - Exit Ticket 3-2-1: នៅក្នុងជំហានទី៥ ត្រូវដាក់សកម្មភាពវាយតម្លៃចុងម៉ោង (Exit Ticket 3-2-1: ៣ចំណុចដែលបានរៀន ២ចំណុចដែលចាប់អារម្មណ៍ ១ចំណុចដែលឆ្ងល់)។

⛔ ABSOLUTE PROHIBITIONS:
- NEVER write "...", "...", or any ellipsis as content
- NEVER put the questions inside contentSummary — questions belong in teacherActivity ONLY!
- NEVER put the full theoretical answers inside studentActivity — students speak summarized answers!
- NEVER repeat the lesson title as the content of a field

Return ONLY valid JSON:
{
  "templateType": "5_steps",
  "school": "${params.school}",
  "teacher": "${params.teacher}",
  "subject": "${params.subject}",
  "grade": "${params.grade}",
  "duration": "${params.duration}",
  "chapter": "${params.chapter || ''}",
  "lessonTitle": "${params.lessonTitle}",
  "method": "${params.method}",
  "dateStr": "ថ្ងៃទី..... ខែ......... ឆ្នាំ២០.....​",
  "objectives": {
    "knowledge": [
      "ពន្យល់ពី [ខ្លឹមសារចំណេះដឹងជាក់លាក់] តាមរយៈ [លក្ខខណ្ឌ៖ ការសង្កេតស្លាយ/ការពន្យល់របស់គ្រូ/ការពិភាក្សា] បានត្រឹមត្រូវ និងក្បោះក្បាយ។",
      "កំណត់ និងរៀបរាប់ពី [និយមន័យ/រូបមន្ត/ច្បាប់] តាមរយៈ [លក្ខខណ្ឌ៖ ការអានឯកសារគោល] បានយ៉ាងហោចណាស់ ៨០% ត្រឹមត្រូវ។"
    ],
    "skills": [
      "អនុវត្ត ដោះស្រាយ ឬគណនា [លំហាត់/បំណិនជាក់លាក់] តាមរយៈ [លក្ខខណ្ឌ៖ ការអនុវត្តជាក្រុម/បុគ្គល] បានត្រឹមត្រូវតាមក្បួនខ្នាត។",
      "រៀបចំ និងធ្វើបទបង្ហាញពី [លទ្ធផលការងារ] តាមរយៈ [លក្ខខណ្ឌ៖ ការការពារលើផ្ទាំង Flipchart] ប្រកបដោយភាពជឿជាក់ និងស្ទាត់ជំនាញ។"
    ],
    "attitudes": [
      "បង្ហាញនូវស្មារតីសហការ យកចិត្តទុកដាក់ និងការគោរពវិន័យ តាមរយៈការចូលរួមសកម្មភាពក្រុម ប្រកបដោយទំនួលខុសត្រូវខ្ពស់។",
      "ប្ដេជ្ញាចិត្តយកចំណេះដឹង និងបំណិនទៅអនុវត្តក្នុងការរស់នៅ និងដោះស្រាយបញ្ហាជាក់ស្តែង ដោយភាពស្មោះត្រង់ និងវិជ្ជមាន។"
    ]
  },
  "materials": {
    "teacher": ["[Specific material 1 for this lesson]", "[Specific material 2]", "[Specific material 3]"],
    "student": ["[Specific student material 1]", "[Specific student material 2]"]
  },
  "steps": [
    {
      "stepNumber": 1,
      "stepTitle": "ជំហានទី ១ : រដ្ឋបាលថ្នាក់",
      "duration": "${stepTimeHints.step1}",
      "teacherActivity": "• គ្រូពិនិត្យអនាម័យ សណ្ដាប់ធ្នាប់ក្នុងថ្នាក់ និងសម្លៀកបំពាក់សិស្ស\n• គ្រូពិនិត្យវត្តមាន និងកត់ត្រាចំនួនសិស្សអវត្តមានក្នុងបញ្ជីវត្តមាន",
      "contentSummary": "• ពង្រឹងវិន័យ អនាម័យថ្នាក់រៀន និងបរិស្ថានសិក្សា\n• សម្រង់វត្តមានសិស្សប្រចាំថ្ងៃ",
      "studentActivity": "• ប្រធានថ្នាក់ឡើងរាយការណ៍ពីចំនួនសិស្សវត្តមាន និងអវត្តមាន\n• សិស្សទាំងអស់អង្គុយតាមកន្លែង រៀបចំសម្ភារសិក្សា និងគោរពវិន័យ"
    },
    {
      "stepNumber": 2,
      "stepTitle": "ជំហានទី ២ : រំលឹកមេរៀនចាស់ / ទំនាក់ទំនងមេរៀន",
      "duration": "${stepTimeHints.step2}",
      "teacherActivity": "• គ្រូសួរសំណួររំលឹកមេរៀនចាស់ទៅកាន់សិស្ស៖\n  «[សរសេរសំណួរជាក់លាក់ពីមេរៀនមុនដែលទាក់ទងនឹង ${params.lessonTitle}]?»\n• គ្រូហៅសិស្ស ២-៣ នាក់ឱ្យឆ្លើយ និងកោតសរសើរ ព្រមទាំងភ្ជាប់ទំនាក់ទំនងចូលមេរៀនថ្មី",
      "contentSummary": "• ចម្លើយនៃសំណួររំលឹកមេរៀនចាស់៖\n  [សរសេរចម្លើយត្រឹមត្រូវពេញលេញនៃសំណួររំលឹកខាងលើ]\n• ចំណុចតភ្ជាប់គន្លឹះចូលមេរៀនថ្មី៖ ${params.lessonTitle}",
      "studentActivity": "• សិស្សស្តាប់ និងស្ម័គ្រចិត្តឆ្លើយសំណួររបស់គ្រូ៖\n  - សិស្សឆ្លើយ (ចម្លើយរំពឹងទុក)៖ «[សង្ខេបចម្លើយដែលរំពឹងថាសិស្សនឹងឆ្លើយ ចេញពីខ្លឹមសារខាងលើ]»\n• សិស្សកត់ត្រាចំណុចតភ្ជាប់ចូលក្នុងសៀវភៅ"
    },
    {
      "stepNumber": 3,
      "stepTitle": "ជំហានទី ៣ : ដំណើរការបង្រៀន និងរៀន (មេរៀនថ្មី)",
      "duration": "${stepTimeHints.step3}",
      "teacherActivity": "• គ្រូសរសេរចំណងជើងមេរៀនលើក្ដារខៀន៖ «${params.lessonTitle}»\n• គ្រូពន្យល់ខ្លឹមសារគន្លឹះ និងសួរសំណួរទៅកាន់សិស្ស៖\n  ១. «[សំណួរគន្លឹះទី១ នៃមេរៀនថ្មី]?»\n  ២. «[សំណួរគន្លឹះទី២ នៃមេរៀនថ្មី]?»\n• គ្រូបែងចែកសិស្សជាក្រុម ដាក់កិច្ចការពិភាក្សា និងដើរសម្របសម្រួលតាមក្រុម",
      "contentSummary": "«${params.lessonTitle}»\n• ខ្លឹមសារស្នូល និងចម្លើយនៃសំណួរ៖\n  - ចម្លើយទី១៖ [សរសេរចម្លើយពេញលេញ និយមន័យ ទ្រឹស្តីត្រឹមត្រូវ]\n  - ចម្លើយទី២៖ [សរសេរចម្លើយពេញលេញ រូបមន្ត ឧទាហរណ៍ជាក់ស្ដែង]\n  - [ខ្លឹមសារលម្អិតបន្ថែម ៤-៦ ចំណុចចេញពីមេរៀន]",
      "studentActivity": "• សិស្សកត់ត្រាចំណងជើងមេរៀនចូលក្នុងសៀវភៅ និងយកចិត្តទុកដាក់ស្តាប់ការពន្យល់\n• សិស្សឆ្លើយសំណួររបស់គ្រូ (ចម្លើយរំពឹងទុក)៖\n  - សិស្សឆ្លើយ៖ «[សង្ខេបចម្លើយរំពឹងទុករបស់សិស្សលើសំណួរទី១ និងទី២ ចេញពីខ្លឹមសារខាងលើ]»\n• សិស្សចូលរួមពិភាក្សាដោះស្រាយកិច្ចការជាក្រុម និងកត់ត្រាខ្លឹមសារត្រឹមត្រូវ"
    },
    {
      "stepNumber": 4,
      "stepTitle": "ជំហានទី ៤ : ពង្រឹងពុទ្ធិ (វាយតម្លៃ)",
      "duration": "${stepTimeHints.step4}",
      "teacherActivity": "• គ្រូដាក់សំណួរពង្រឹងពុទ្ធិ ឬលំហាត់អនុវត្តរហ័ស៖\n  ១. «[សំណួរពង្រឹងពុទ្ធិទី១]?»\n  ២. «[សំណួរពង្រឹងពុទ្ធិទី២ ឬលំហាត់អនុវត្ត]?»\n• គ្រូឱ្យសិស្សឆ្លើយលើក្ដារឆ្នួន ឬសរសេរក្នុងសៀវភៅ និងវាយតម្លៃការយល់ដឹង",
      "contentSummary": "• ចម្លើយនៃសំណួរពង្រឹងពុទ្ធិ និងដំណោះស្រាយ៖\n  - ចម្លើយទី១៖ [ចម្លើយត្រឹមត្រូវពេញលេញនៃសំណួរទី១]\n  - ចម្លើយទី២៖ [ចម្លើយ ឬដំណោះស្រាយពេញលេញនៃសំណួរទី២]\n• ក្បួនគន្លឹះដែលសិស្សត្រូវចងចាំ",
      "studentActivity": "• សិស្សយកចិត្តទុកដាក់ដោះស្រាយលំហាត់/សំណួរជាបុគ្គល ឬដៃគូ\n• សិស្សឆ្លើយ (ចម្លើយរំពឹងទុក)៖ «[សង្ខេបចម្លើយរំពឹងទុករបស់សិស្សលើសំណួរពង្រឹងពុទ្ធិ]»\n• សិស្សលើកបង្ហាញចម្លើយលើក្ដារឆ្នួន និងកែតម្រូវតាមការណែនាំរបស់គ្រូ"
    },
    {
      "stepNumber": 5,
      "stepTitle": "ជំហានទី ៥ : បណ្តាំផ្ញើ និងកិច្ចការផ្ទះ",
      "duration": "${stepTimeHints.step5}",
      "teacherActivity": "• គ្រូសង្ខេបចំណុចសំខាន់ៗនៃមេរៀន ${params.lessonTitle} ឡើងវិញ\n• គ្រូដាក់កិច្ចការផ្ទះ៖ «[ពិពណ៌នាលំហាត់ ឬកិច្ចការស្រាវជ្រាវជាក់លាក់]?»\n• គ្រូផ្ដាំផ្ញើអប់រំទូន្មានសីលធម៌ និងការមើលមេរៀនបន្តសម្រាប់ម៉ោងក្រោយ",
      "contentSummary": "• ចំណុចសំខាន់ៗ ៣-៥ ដែលសិស្សត្រូវចងចាំពីមេរៀន ${params.lessonTitle}\n• កិច្ចការផ្ទះ៖ [សរសេរខ្លឹមសារកិច្ចការផ្ទះឱ្យបានច្បាស់លាស់]\n• បណ្ដាំផ្ញើអប់រំសីលធម៌ និងសុវត្ថិភាព",
      "studentActivity": "• សិស្សកត់ត្រាកិច្ចការផ្ទះចូលក្នុងសៀវភៅដោយយកចិត្តទុកដាក់\n• សិស្សឆ្លើយបញ្ជាក់ការយល់ដឹង៖ «សិស្សយល់ច្បាស់ពីកិច្ចការផ្ទះ និងសន្យាអនុវត្តឱ្យបានគ្រប់គ្នា»\n• សិស្សរៀបចំសម្ភារ និងជម្រាបលាគ្រូ"
    }
  ]
}`;
  }

  const hasContent = params.lessonContent && params.lessonContent.trim().length > 30;
  const userQuery = `═══════════════════════════════════════
LESSON INFORMATION:
═══════════════════════════════════════
មុខវិជ្ជា (Subject): ${params.subject}
កម្រិតថ្នាក់ (Grade): ${params.grade}
ជំពូក (Chapter): ${params.chapter || 'មិនបានបញ្ជាក់'}
ចំណងជើងមេរៀន (Lesson Title): ${params.lessonTitle}
រយៈពេលបង្រៀន (Duration): ${params.duration}
វិធីសាស្ត្របង្រៀន (Teaching Method): ${params.method}
${params.customNotes ? `កំណត់ចំណាំពិសេស (Special Notes): ${params.customNotes}` : ''}

═══════════════════════════════════════
${hasContent
  ? `REFERENCE MATERIAL (Use this to generate specific content):
${params.lessonContent}

🚨 CRITICAL INSTRUCTIONS FOR EXTRACTING QUESTIONS & DISCUSSION TASKS FROM REFERENCE MATERIAL:
1. EXHAUSTIVE QUESTION EXTRACTION (ស្រង់សំណួរទាំងអស់ពីឯកសារ/ស្លាយ):
   - If the uploaded material/slides contain discussion questions, group activities, or reflection prompts, YOU MUST EXTRACT ALL OF THEM into the lesson plan — NEVER drop, compress, or omit any question! If the slides have 4 questions, you MUST generate all 4 questions!
2. UNIVERSITY / TEACHER EDUCATION COLLEGE (TEC) QUESTIONING QUOTAS FOR ACTIVITIES:
   - ការពិភាក្សាក្រុម (Group Discussion): Must have EXACTLY 4 comprehensive questions (១. «...?» ២. «...?» ៣. «...?» ៤. «...?»). If 4 questions exist in the uploaded slides, use all 4 verbatim!
   - ការស្រាវជ្រាវ (Research / Investigative Topics): Must provide up to 10 specific topics (១ ដល់ ១០) for student groups to choose from.
   - ការសួរឆ្លើយផ្ទាល់មាត់ (Oral Q&A): Must formulate 6 specific questions for teacher-student interaction.
   - ករណីសិក្សា (Case Studies): Provide 1 to 2 detailed real-life scenario case studies.
3. 3-COLUMN 1-TO-1 ALIGNMENT:
   - teacherActivity: List every single question clearly inside quotation marks «...» (e.g. «១. ...?», «២. ...?», «៣. ...?», «៤. ...?»).
   - contentSummary: Provide the COMPLETE theoretical answers corresponding to each of those questions (ចម្លើយទី១៖ ..., ចម្លើយទី២៖ ..., ចម្លើយទី៣៖ ..., ចម្លើយទី៤៖ ...).
   - studentActivity: Provide the predicted summarized student answers for each question:
     «សិស្សឆ្លើយ (ចម្លើយរំពឹងទុក)៖
       - សំណួរទី១៖ [សង្ខេបចម្លើយសិស្សចេញពីខ្លឹមសារ]
       - សំណួរទី២៖ [សង្ខេបចម្លើយសិស្សចេញពីខ្លឹមសារ]
       - សំណួរទី៣៖ [សង្ខេបចម្លើយសិស្សចេញពីខ្លឹមសារ]
       - សំណួរទី៤៖ [សង្ខេបចម្លើយសិស្សចេញពីខ្លឹមសារ]»`
  : `⚠️ NO REFERENCE MATERIAL PROVIDED — USE YOUR EXPERT KNOWLEDGE:
Since no reference document was uploaded, YOU MUST use your deep knowledge of the Cambodia MoEYS curriculum to generate REAL, SPECIFIC content for this lesson.

For the topic "${params.lessonTitle}" in subject "${params.subject}" at grade level "${params.grade}", generate:
1. The actual definitions and key concepts that belong in this topic
2. Real vocabulary terms in Khmer (and English if applicable) 
3. Concrete examples, formulas, or case studies appropriate for this grade level
4. Specific activities that match the teaching method: ${params.method}
5. Assessment questions that test understanding of this specific topic

DO NOT write generic content. Write as if you are a ${params.subject} teacher who has taught this topic many times and knows exactly what students need to learn.`
}
═══════════════════════════════════════
${(params.language === 'en' || state.language === 'en')
  ? `🌐 MANDATORY LANGUAGE INSTRUCTION:
The user has chosen ENGLISH language mode. Generate the ENTIRE lesson plan in professional, fluent, academic ENGLISH (standard MoEYS-compliant pedagogical 5-step format in English). All headings, objectives, steps, teacher activities, student activities, questions, answers, and reflection must be written in English.`
  : `🌐 MANDATORY LANGUAGE INSTRUCTION:
Every field must contain real, specific, classroom-ready Khmer content.`
}
GENERATE THE COMPLETE LESSON PLAN NOW.`;

  // Dynamic Candidate API endpoints for Google AI Studio
  let candidateModels = [];
  if (state.verifiedGeminiModel) {
    candidateModels.push(state.verifiedGeminiModel);
  }
  
  const discovered = await discoverGeminiModels(apiKey);
  if (discovered && discovered.length > 0) {
    discovered.sort((a, b) => {
      const score = (m) => {
        const name = (m.name || '').toLowerCase();
        if (name === 'gemini-2.5-pro') return 250;
        if (name === 'gemini-3.8-flash') return 240;
        if (name === 'gemini-3.6-flash') return 230;
        if (name === 'gemini-3.5-flash-lite') return 210;
        if (name === 'gemini-2.5-flash-lite') return 200;
        if (name.includes('2.5-pro')) return 195;
        if (name.includes('3.8-flash')) return 190;
        if (name.includes('3.6-flash')) return 185;
        if (name.includes('flash-lite')) return 175;
        if (name === 'gemini-2.0-flash') return 150;
        if (name.includes('flash') && !name.includes('tts') && !name.includes('image')) return 140;
        if (name.includes('pro') && !name.includes('tts') && !name.includes('image')) return 130;
        return 10;
      };
      return score(b) - score(a);
    });
    for (const m of discovered) {
      if (candidateModels.length >= 4) break; // Limit to top 4 models
      if (!candidateModels.some(c => c.name === m.name)) {
        candidateModels.push(m);
      }
    }
  }

  if (candidateModels.length === 0) {
    candidateModels = [
      { ver: 'v1beta', name: 'gemini-2.5-pro' },
      { ver: 'v1beta', name: 'gemini-3.8-flash' },
      { ver: 'v1beta', name: 'gemini-3.6-flash' },
      { ver: 'v1beta', name: 'gemini-3.5-flash-lite' },
      { ver: 'v1beta', name: 'gemini-2.5-flash-lite' },
      { ver: 'v1beta', name: 'gemini-2.0-flash' }
    ];
  }

  let lastError = null;

  for (let i = 0; i < candidateModels.length; i++) {
    const item = candidateModels[i];
    const modelLabel = `${item.name}`;
    const isPro = item.name.includes('pro');
    const badgeText = isPro ? '🏆 ម៉ូដែល Pro គិតស៊ីជម្រៅ' : '⚡ ម៉ូដែល Gemini Flash ល្បឿនលឿន';
    
    setLoadingOverlayStatus(
      'AI កំពុងវិភាគឯកសារ និងរៀបចំកិច្ចតែងការ...',
      `កំពុងបង្កើតកិច្ចតែងការតាម Google Gemini (${item.name})... សូមរង់ចាំបន្តិច (អនុញ្ញាតពេលរហូតដល់ ៦ នាទី ដើម្បីទទួលបានលទ្ធផលស្តង់ដារល្អបំផុត)!`,
      `🤖 ដំណើរការម៉ូដែល ${i + 1}/${candidateModels.length} (${item.name}) - ${badgeText}`
    );

    const streamUrl = `https://generativelanguage.googleapis.com/${item.ver}/models/${item.name}:streamGenerateContent?alt=sse&key=${apiKey}`;
    const directUrl = `https://generativelanguage.googleapis.com/${item.ver}/models/${item.name}:generateContent?key=${apiKey}`;
    const controller = new AbortController();
    // Generous failover timeout: 6 minutes (360,000ms > 5 minutes) so complex reasoning & Khmer token output never get cut off
    const modelTimeoutMs = 360000;
    const timeoutId = setTimeout(() => controller.abort(), modelTimeoutMs);
    try {
      // Safe universal maxOutputTokens across all Gemini models (prevents 400 Bad Request)
      const maxTokens = 8192;

      const requestBody = {
        contents: [
          {
            role: 'user',
            parts: [{ text: systemPrompt + '\n\n' + userQuery }]
          }
        ],
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT",        threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_HATE_SPEECH",       threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" }
        ],
        generationConfig: {
          response_mime_type: 'application/json',
          temperature: 0.4,
          maxOutputTokens: maxTokens
        }
      };

      let responseText = '';

      // ⚡ Step 1: Attempt Server-Sent Events (SSE) Streaming for instant real-time response
      try {
        const streamResp = await fetch(streamUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify(requestBody)
        });

        if (streamResp.ok && streamResp.body) {
          const reader = streamResp.body.getReader();
          const decoder = new TextDecoder('utf-8');
          let buffer = '';
          let totalChars = 0;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split('\n');
            buffer = lines.pop(); // keep partial line

            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.startsWith('data:')) {
                const jsonStr = trimmed.slice(5).trim();
                if (jsonStr && jsonStr !== '[DONE]') {
                  try {
                    const chunkData = JSON.parse(jsonStr);
                    const chunkText = chunkData.candidates?.[0]?.content?.parts?.[0]?.text || '';
                    if (chunkText) {
                      responseText += chunkText;
                      totalChars += chunkText.length;
                      const progressPct = Math.min(95, Math.round(15 + (totalChars / 45)));
                      const progressEl = document.getElementById('progressBarFill');
                      if (progressEl) progressEl.style.width = `${progressPct}%`;
                      setLoadingOverlayStatus(
                        'AI កំពុងបង្កើតកិច្ចតែងការ (Streaming Real-Time)...',
                        `⚡ កំពុងទទួលទិន្នន័យផ្ទាល់ (SSE)៖ ទទួលបាន ${totalChars.toLocaleString()} តួអក្សរ...`,
                        `🤖 ${item.name} (${progressPct}% - SSE Active ⚡)`
                      );
                    }
                  } catch (parseErr) {
                    // Ignore transient SSE frame parsing
                  }
                }
              }
            }
          }

          if (responseText) {
            const progressEl = document.getElementById('progressBarFill');
            if (progressEl) progressEl.style.width = '100%';
            setLoadingOverlayStatus(
              'កំពុងផ្ទៀងផ្ទាត់ និងបង្ហាញកិច្ចតែងការ...',
              `✨ ទទួលបានទិន្នន័យពេញលេញ (${totalChars.toLocaleString()} តួអក្សរ)... កំពុងរៀបចំ និងបង្ហាញលើទំព័រ!`,
              `✅ ជោគជ័យ ១០០%`
            );
          }
        } else if (!streamResp.ok) {
          const errorData = await streamResp.json().catch(() => ({}));
          const errMsg = errorData.error?.message || streamResp.statusText || `HTTP ${streamResp.status}`;
          throw new Error(errMsg);
        }
      } catch (streamErr) {
        console.warn(`[AI Engine] SSE stream failed on ${modelLabel} (${streamErr.message}). Fallback...`);
        const isTransientOverload = streamErr.message && (
          streamErr.message.includes('503') ||
          streamErr.message.includes('high demand') ||
          streamErr.message.includes('Unavailable') ||
          streamErr.message.includes('Quota') ||
          streamErr.message.includes('429') ||
          streamErr.name === 'AbortError'
        );
        if (isTransientOverload) {
          lastError = streamErr;
          setLoadingOverlayStatus(
            'AI កំពុងប្តូរទៅកាន់ម៉ូដែលបម្រុង...',
            `ម៉ូដែល ${item.name} កំពុងមមាញឹក... ប្រព័ន្ធកំពុងប្តូរទៅម៉ូដែលបន្ទាប់!`,
            `⚡ កំពុងប្តូរទៅ ${candidateModels[i+1]?.name || 'ម៉ូដែលបន្ទាប់'}`
          );
          await new Promise(r => setTimeout(r, 300));
          continue;
        }
      }

      // 🔄 Step 2: Fallback to standard Direct REST API if SSE did not return complete text
      if (!responseText) {
        const response = await fetch(directUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const errMsg = errorData.error?.message || response.statusText || `HTTP ${response.status}`;
          console.warn(`[AI Engine] ${modelLabel} error: ${errMsg}. Auto-switching to next model...`);
          lastError = new Error(errMsg);

          // Fast abort loop if key is strictly invalid or unauthorized
          if (errMsg.includes('API_KEY_INVALID') || errMsg.includes('API key not valid') || errMsg.includes('PERMISSION_DENIED') || errMsg.includes('401') || errMsg.includes('403')) {
            console.warn('[AI Engine] API Key is invalid or unauthorized. Aborting API loop.');
            lastError = new Error(errMsg);
            break;
          }

          // If Pro model hit 429 Quota Exceeded on Free Key, intelligently jump directly to high-quota gemini-2.0-flash
          const lowerErr = errMsg.toLowerCase();
          if (isPro && (lowerErr.includes('quota') || lowerErr.includes('resource_exhausted') || lowerErr.includes('429') || lowerErr.includes('try again later'))) {
            const flashIdx = candidateModels.findIndex((m, idx) => idx > i && m.name === 'gemini-2.0-flash');
            if (flashIdx !== -1) {
              console.info(`[AI Engine] Pro model hit quota limit. Intelligently auto-switching to high-quota gemini-2.0-flash...`);
              setLoadingOverlayStatus(
                'កំពុងប្តូរទៅម៉ូដែល Flash ស្វ័យប្រវត្តិ...',
                `ម៉ូដែល Pro ជាប់កូតា (Quota)... ប្រព័ន្ធកំពុងតភ្ជាប់ស្វ័យប្រវត្តទៅកាន់ Google Gemini 2.0 Flash ដើម្បីបង្កើតកិច្ចតែងការភ្លាមៗ!`,
                `⚡ តភ្ជាប់ស្វ័យប្រវត្តិទៅ Gemini 2.0 Flash`
              );
              i = flashIdx - 1; // loop increment will make it flashIdx
              await new Promise(r => setTimeout(r, 600));
              continue;
            }
          }

          setLoadingOverlayStatus(
            'AI កំពុងប្តូរទៅកាន់ម៉ូដែលបម្រុង...',
            `ម៉ូដែល ${item.name} ជួបបញ្ហា... ប្រព័ន្ធកំពុងតភ្ជាប់ស្វ័យប្រវត្តិទៅ ${candidateModels[i+1]?.name || 'ម៉ូដែលបន្ទាប់'}!`,
            `⚡ កំពុងប្តូរទៅម៉ូដែលបន្ទាប់ (${candidateModels[i+1]?.name || '...'})`
          );
          await new Promise(r => setTimeout(r, 400));
          continue;
        }

        const data = await response.json();
        const candidate = data.candidates?.[0];
        responseText = candidate?.content?.parts?.[0]?.text;
      }

      clearTimeout(timeoutId);

      if (!responseText) {
        console.warn(`[AI Engine] ${modelLabel} returned empty or filtered response`);
        continue;
      }

      const parsed = extractAndParseJson(responseText);
      if (isFlipped) {
        parsed.templateType = 'flipped_learning';
      } else if (isBd && !parsed.stage1 && parsed.steps) {
        parsed.templateType = 'backward_design';
      }
      parsed.method = params.method || parsed.method;
      parsed.school = params.school || parsed.school;
      parsed.teacher = params.teacher || parsed.teacher;
      parsed.subject = params.subject || parsed.subject;
      parsed.grade = params.grade || params.grade;
      parsed.duration = params.duration || parsed.duration;
      parsed.chapter = params.chapter || parsed.chapter;
      parsed.lessonTitle = params.lessonTitle || parsed.lessonTitle;
      const normalized = normalizeLessonPlanData(parsed, params);
      return normalized;

    } catch (err) {
      console.warn(`[AI Engine] Error on ${modelLabel}:`, err.message);
      lastError = err;
      continue;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError || new Error('All Gemini AI candidate endpoints were unreachable.');
}

// 🛡️ Robust Self-Repairing JSON Parser (Handles Markdown fences, truncated streaming, and unclosed brackets)
function extractAndParseJson(text) {
  if (!text) throw new Error("Empty response text from Gemini AI");
  let clean = text.trim();
  clean = clean.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '').trim();

  // 1. Direct standard parse first (handles pristine arrays or objects)
  try {
    return JSON.parse(clean);
  } catch (e) {
    // continue to extract and repair
  }

  const firstBrace = clean.indexOf('{');
  const firstBracket = clean.indexOf('[');

  let startIdx = -1;
  let isArray = false;

  if (firstBrace !== -1 && firstBracket !== -1) {
    if (firstBracket < firstBrace) {
      startIdx = firstBracket;
      isArray = true;
    } else {
      startIdx = firstBrace;
      isArray = false;
    }
  } else if (firstBracket !== -1) {
    startIdx = firstBracket;
    isArray = true;
  } else if (firstBrace !== -1) {
    startIdx = firstBrace;
    isArray = false;
  } else {
    throw new Error("No JSON object or array found in Gemini response");
  }

  clean = clean.substring(startIdx);

  // 2. Direct parse of extracted substring
  try {
    return JSON.parse(clean);
  } catch (e) {
    // try fallback repairs
  }

  // 3. Substring up to last closing brace or bracket
  const lastCloser = isArray ? clean.lastIndexOf(']') : clean.lastIndexOf('}');
  if (lastCloser > 0) {
    try {
      return JSON.parse(clean.substring(0, lastCloser + 1));
    } catch (e) {}
  }

  // 3. Intelligent deep auto-repair for truncated SSE / Token Limit JSON
  const stack = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (!inString) {
      if (ch === '{') stack.push('}');
      else if (ch === '[') stack.push(']');
      else if (ch === '}' || ch === ']') {
        if (stack.length > 0 && stack[stack.length - 1] === ch) stack.pop();
      }
    }
  }

  let repaired = clean;
  if (inString) repaired += '"';
  repaired = repaired.replace(/,\s*$/, '').replace(/,\s*([}\]])/g, '$1');
  const tempStack = [...stack];
  while (tempStack.length > 0) repaired += tempStack.pop();

  try {
    return JSON.parse(repaired);
  } catch (err2) {
    // 4. Secondary repair: remove broken trailing key or trailing colon
    repaired = clean;
    if (inString) repaired += '"';
    repaired = repaired.replace(/,\s*"[^"]*":\s*("[^"]*)?$/, '');
    repaired = repaired.replace(/,\s*"[^"]*":\s*$/, '');
    repaired = repaired.replace(/:\s*$/, ': null');
    repaired = repaired.replace(/,\s*$/, '').replace(/,\s*([}\]])/g, '$1');

    const stack2 = [];
    let inStr2 = false, esc2 = false;
    for (let i = 0; i < repaired.length; i++) {
      const ch = repaired[i];
      if (esc2) { esc2 = false; continue; }
      if (ch === '\\') { esc2 = true; continue; }
      if (ch === '"') { inStr2 = !inStr2; continue; }
      if (!inStr2) {
        if (ch === '{') stack2.push('}');
        else if (ch === '[') stack2.push(']');
        else if (ch === '}' || ch === ']') {
          if (stack2.length > 0 && stack2[stack2.length - 1] === ch) stack2.pop();
        }
      }
    }
    if (inStr2) repaired += '"';
    while (stack2.length > 0) repaired += stack2.pop();
    return JSON.parse(repaired);
  }
}

// Open & Close API Key Modal Globally
function openApiKeyModal() {
  const apiKeyModal = document.getElementById('apiKeyModal');
  const inputGeminiKey = document.getElementById('inputGeminiKey');
  const selectAiProvider = document.getElementById('selectAiProvider');
  if (inputGeminiKey) {
    inputGeminiKey.value = state.geminiApiKey || getActiveGeminiApiKey();
    inputGeminiKey.type = 'password';
    const icon = document.getElementById('iconToggleKeyMask');
    if (icon) {
      icon.classList.remove('fa-eye-slash');
      icon.classList.add('fa-eye');
    }
  }
  if (selectAiProvider) {
    const savedKey = state.geminiApiKey || getActiveGeminiApiKey();
    const savedProvider = state.aiProvider || localStorage.getItem('ai_provider') || (savedKey.startsWith('gsk_') ? 'groq' : (savedKey.startsWith('sk-or-') ? 'openrouter' : 'gemini'));
    selectAiProvider.value = savedProvider;
    handleAiProviderChange();
  }
  updateApiKeyModalUI();
  if (apiKeyModal) {
    apiKeyModal.style.display = 'flex';
  }
}
window.openApiKeyModal = openApiKeyModal;

function closeApiKeyModal() {
  const apiKeyModal = document.getElementById('apiKeyModal');
  const input = document.getElementById('inputGeminiKey');
  if (input && input.value.trim() && input.value.trim() !== (state.geminiApiKey || '')) {
    saveApiKeyFromModal(false);
  }
  if (apiKeyModal) {
    apiKeyModal.style.display = 'none';
  }
}
window.closeApiKeyModal = closeApiKeyModal;

function updateEmptyStateApiStatus() {
  const banner = document.getElementById('emptyStateApiBanner');
  const dot = document.getElementById('emptyStateApiDot');
  const text = document.getElementById('emptyStateApiText');
  const btnBanner = document.getElementById('btnEmptyBannerConnectKey');
  const btnBottom = document.getElementById('btnEmptyConnectKey');
  if (!banner || !dot || !text) return;

  const key = (state.geminiApiKey || getActiveGeminiApiKey() || '').trim();
  const provider = state.aiProvider || PersistentKeyVault.getProviderSync();

  if (key) {
    banner.style.background = '#f0fdf4';
    banner.style.borderColor = '#86efac';
    banner.style.color = '#15803d';
    dot.textContent = '🟢';
    const provName = (provider === 'groq') ? 'Groq LLaMA 3.3 AI' : (provider === 'openrouter' ? 'OpenRouter AI' : 'Google Gemini AI');
    text.innerHTML = `<strong>បានភ្ជាប់ API រួចរាល់</strong> (${provName} — Online Mode)`;
    if (btnBanner) btnBanner.style.display = 'none';
    if (btnBottom) btnBottom.style.display = 'none';
  } else {
    banner.style.background = '#fefce8';
    banner.style.borderColor = '#fef08a';
    banner.style.color = '#854d0e';
    dot.textContent = '🟡';
    text.textContent = 'មិនទាន់ភ្ជាប់ API Key (កំពុងប្រើ Offline Mode)';
    if (btnBanner) btnBanner.style.display = 'inline-flex';
    if (btnBottom) btnBottom.style.display = 'inline-flex';
  }
}
window.updateEmptyStateApiStatus = updateEmptyStateApiStatus;

let _lastSaveApiKeyTime = 0;
function saveApiKeyFromModal() {
  const now = Date.now();
  if (now - _lastSaveApiKeyTime < 250) return;
  _lastSaveApiKeyTime = now;

  const showSuccessToast = arguments.length > 0 ? arguments[0] : true;
  const inputGeminiKey = document.getElementById('inputGeminiKey');
  const selectAiProvider = document.getElementById('selectAiProvider');
  const apiKeyModal = document.getElementById('apiKeyModal');
  const key = (inputGeminiKey?.value || '').trim();
  const provider = selectAiProvider ? selectAiProvider.value : 'gemini';
  state.aiProvider = provider;
  if (key) {
    state.geminiApiKey = key;
    PersistentKeyVault.save(key, provider);
    const provName = provider === 'groq' ? 'Groq Cloud (Free)' : (provider === 'openrouter' ? 'OpenRouter' : 'Google Gemini');
    if (showSuccessToast) showToast(`បានរក្សាទុក ${provName} API Key ដោយជោគជ័យ!`, 'success');
  } else {
    state.geminiApiKey = '';
    PersistentKeyVault.clear();
    if (showSuccessToast) showToast('បានសម្អាត API Key រួចរាល់!', 'info');
  }
  checkApiKeyStatus();
  updateApiKeyModalUI();
  updateEmptyStateApiStatus();
  if (apiKeyModal && showSuccessToast) apiKeyModal.style.display = 'none';

  if (key && pendingGenParams) {
    showToast('🚀 កំពុងដំណើរការបង្កើតកិច្ចតែងការដោយ AI ដោយស្វ័យប្រវត្តិ...', 'info');
    setTimeout(() => {
      handleGenerateLessonPlan();
    }, 300);
  }
}
window.saveApiKeyFromModal = saveApiKeyFromModal;

async function removeApiKeyFromModal() {
  const inputGeminiKey = document.getElementById('inputGeminiKey');
  const apiKeyModal = document.getElementById('apiKeyModal');
  state.geminiApiKey = '';
  await PersistentKeyVault.clear();
  if (inputGeminiKey) inputGeminiKey.value = '';
  checkApiKeyStatus();
  updateApiKeyModalUI();
  showToast('បានលុប / សម្អាត API Key រួចរាល់!', 'info');
  if (apiKeyModal) apiKeyModal.style.display = 'none';
}
window.removeApiKeyFromModal = removeApiKeyFromModal;

// Update UI elements in the API Key Modal
function updateApiKeyModalUI() {
  const statusBox = document.getElementById('apiKeyCurrentStatusBox');
  const statusTitle = document.getElementById('apiKeyStatusTitle');
  const statusDesc = document.getElementById('apiKeyStatusDesc');
  const customKey = state.geminiApiKey || getActiveGeminiApiKey() || localStorage.getItem('gemini_api_key');
  const provider = state.aiProvider || PersistentKeyVault.getProviderSync();

  if (customKey) {
    if (statusBox) {
      statusBox.style.background = '#eff6ff';
      statusBox.style.borderColor = '#bfdbfe';
    }
    if (statusTitle) {
      statusTitle.style.color = '#1d4ed8';
      const provName = provider === 'groq' ? 'Groq Cloud' : (provider === 'openrouter' ? 'OpenRouter' : 'Google Gemini');
      statusTitle.innerHTML = `<i class="fa-solid fa-key" style="color: #f59e0b;"></i> កំពុងប្រើប្រាស់ ${provName} API Key ផ្ទាល់ខ្លួនរបស់អ្នក (Custom Key)`;
    }
    if (statusDesc) {
      statusDesc.style.color = '#1e40af';
      statusDesc.innerHTML = '✨ លោកគ្រូ អ្នកគ្រូកំពុងប្រើ Key ផ្ទាល់ខ្លួន។ ប្រសិនបើជួបបញ្ហា Quota ឬចង់សម្អាត Key សូមចុចប៊ូតុង <strong>«លុប Key»</strong> ឬ <strong>«🔄 សម្អាត Key»</strong> ខាងក្រោម។';
    }
  } else {
    if (statusBox) {
      statusBox.style.background = '#fefce8';
      statusBox.style.borderColor = '#fef08a';
    }
    if (statusTitle) {
      statusTitle.style.color = '#854d0e';
      statusTitle.innerHTML = '<i class="fa-solid fa-circle-info" style="color: #eab308;"></i> មិនទាន់មាន API Key ផ្ទាល់ខ្លួននៅឡើយទេ';
    }
    if (statusDesc) {
      statusDesc.style.color = '#713f12';
      statusDesc.innerHTML = '✨ លោកគ្រូ អ្នកគ្រូអាចយក Google Gemini API Key ឥតគិតថ្លៃពី <strong><a href="https://aistudio.google.com/app/apikey" target="_blank" style="color: #2563eb; text-decoration: underline;">aistudio.google.com</a></strong> រួច Paste ខាងក្រោមដើម្បីដំណើរការ AI កិច្ចតែងការ MoEYS យ៉ាងរលូន ឬប្រើប្រាស់ Groq / OpenRouter ឬ Smart Offline Engine។';
    }
  }
}
window.updateApiKeyModalUI = updateApiKeyModalUI;

function toggleApiKeyMask() {
  const input = document.getElementById('inputGeminiKey');
  const icon = document.getElementById('iconToggleKeyMask');
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    if (icon) {
      icon.classList.remove('fa-eye');
      icon.classList.add('fa-eye-slash');
    }
  } else {
    input.type = 'password';
    if (icon) {
      icon.classList.remove('fa-eye-slash');
      icon.classList.add('fa-eye');
    }
  }
}
window.toggleApiKeyMask = toggleApiKeyMask;

async function pasteApiKeyFromClipboard() {
  const input = document.getElementById('inputGeminiKey');
  if (!input) return;
  try {
    if (navigator.clipboard && navigator.clipboard.readText) {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        input.value = text.trim();
        autoDetectApiKeyProvider(input.value);
        const curProv = document.getElementById('selectAiProvider')?.value || 'gemini';
        state.geminiApiKey = input.value;
        state.aiProvider = curProv;
        await PersistentKeyVault.save(input.value, curProv);
        checkApiKeyStatus();
        updateApiKeyModalUI();
        showToast('📋 បានបិទភ្ជាប់ និងរក្សាទុក API Key ដោយជោគជ័យ!', 'success');
        return;
      }
    }
  } catch (err) {
    console.warn('Clipboard read failed:', err);
  }
  input.focus();
  showToast('សូមចុច Ctrl+V ដើម្បីបិទភ្ជាប់ API Key', 'info');
}
window.pasteApiKeyFromClipboard = pasteApiKeyFromClipboard;

function clearApiKeyInput() {
  const input = document.getElementById('inputGeminiKey');
  if (input) {
    input.value = '';
    input.focus();
  }
}
window.clearApiKeyInput = clearApiKeyInput;

// Handle AI Provider dropdown changes
function handleAiProviderChange() {
  const provider = document.getElementById('selectAiProvider')?.value || 'gemini';
  const lbl = document.getElementById('lblApiKeyInput');
  const input = document.getElementById('inputGeminiKey');
  const linkBox = document.getElementById('aiProviderHelpLink');
  const statusEl = document.getElementById('apiKeyTestStatus');
  if (statusEl) statusEl.style.display = 'none';

  if (provider === 'groq') {
    if (lbl) lbl.textContent = 'Groq Cloud API Key (ឥតគិតថ្លៃ / ចាប់ផ្តើមដោយ gsk_...)';
    if (input) input.placeholder = 'gsk_...';
    if (linkBox) {
      linkBox.innerHTML = `
        <a href="https://console.groq.com/keys" target="_blank" rel="noopener" style="color: #4f46e5; font-weight: 600;">
          <i class="fa-solid fa-arrow-up-right-from-square"></i> យក Groq Free API Key ឥតគិតថ្លៃ (console.groq.com/keys) - ល្បឿនលឿន ៥០០ ពាក្យ/វិនាទី & មិនដែលគាំង
        </a>
      `;
    }
  } else if (provider === 'openrouter') {
    if (lbl) lbl.textContent = 'OpenRouter API Key (Universal AI / ចាប់ផ្តើមដោយ sk-or-...)';
    if (input) input.placeholder = 'sk-or-v1-...';
    if (linkBox) {
      linkBox.innerHTML = `
        <a href="https://openrouter.ai/keys" target="_blank" rel="noopener" style="color: #4f46e5; font-weight: 600;">
          <i class="fa-solid fa-arrow-up-right-from-square"></i> យក OpenRouter API Key ពី openrouter.ai/keys (គាំទ្រ DeepSeek R1, Llama 3.3, Claude)
        </a>
      `;
    }
  } else {
    if (lbl) lbl.textContent = 'Google Gemini API Key (ពី aistudio.google.com)';
    if (input) input.placeholder = 'AIzaSy...';
    if (linkBox) {
      linkBox.innerHTML = `
        <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener" style="color: #4f46e5; font-weight: 600;">
          <i class="fa-solid fa-arrow-up-right-from-square"></i> យក Gemini API Key ពី Google AI Studio (aistudio.google.com/app/apikey)
        </a>
      `;
    }
  }
}
window.handleAiProviderChange = handleAiProviderChange;

// Auto-detect provider based on pasted key prefix
function autoDetectApiKeyProvider(val) {
  const clean = (val || '').trim();
  const select = document.getElementById('selectAiProvider');
  if (!select) return;

  if (clean.startsWith('gsk_')) {
    if (select.value !== 'groq') {
      select.value = 'groq';
      handleAiProviderChange();
    }
  } else if (clean.startsWith('sk-or-')) {
    if (select.value !== 'openrouter') {
      select.value = 'openrouter';
      handleAiProviderChange();
    }
  } else if (clean.startsWith('AIzaSy') || clean.startsWith('AQ.')) {
    if (select.value !== 'gemini') {
      select.value = 'gemini';
      handleAiProviderChange();
    }
  }
}
window.autoDetectApiKeyProvider = autoDetectApiKeyProvider;

// Interactive Multi-AI Provider Tester
async function testCurrentAiProviderKey() {
  const inputEl = document.getElementById('inputGeminiKey');
  const selectAi = document.getElementById('selectAiProvider');
  const statusEl = document.getElementById('apiKeyTestStatus');
  if (!inputEl || !statusEl) return;
  const key = (inputEl.value || '').trim().replace(/^["']|["']$/g, '');
  const provider = selectAi ? selectAi.value : 'gemini';

  if (!key) {
    statusEl.style.display = 'block';
    statusEl.style.background = '#fef2f2';
    statusEl.style.color = '#dc2626';
    statusEl.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> សូមបញ្ចូល API Key ជាមុនសិន!';
    return;
  }

  statusEl.style.display = 'block';
  statusEl.style.background = '#eef2ff';
  statusEl.style.color = '#4338ca';

  if (provider === 'groq') {
    statusEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> កំពុងសាកល្បងតភ្ជាប់ទៅកាន់ Groq Cloud (Llama 3.3 70B & DeepSeek)...';
    const models = ['llama-3.3-70b-versatile', 'deepseek-r1-distill-llama-70b', 'llama-3.1-8b-instant'];
    let success = false;
    let lastErr = null;

    for (const m of models) {
      try {
        const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`
          },
          body: JSON.stringify({
            model: m,
            messages: [{ role: 'user', content: 'Say OK in 1 word' }],
            max_tokens: 5
          })
        });
        if (resp.ok) {
          success = true;
          state.geminiApiKey = key;
          state.aiProvider = provider;
          await PersistentKeyVault.save(key, provider);
          checkApiKeyStatus();
          updateApiKeyModalUI();
          statusEl.style.background = '#f0fdf4';
          statusEl.style.color = '#16a34a';
          statusEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> ការតភ្ជាប់ជោគជ័យ និងបានរក្សាទុក! Groq Cloud API Key (${m}) ដំណើរការយ៉ាងរលូន ១០០% (Ultra-Fast ⚡)។`;
          break;
        } else {
          const errJson = await resp.json().catch(() => ({}));
          lastErr = errJson.error?.message || resp.statusText;
        }
      } catch (e) {
        lastErr = e.message;
      }
    }

    if (!success) {
      statusEl.style.background = '#fef2f2';
      statusEl.style.color = '#dc2626';
      statusEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> បរាជ័យពី Groq: ${lastErr || 'Invalid Key'}`;
    }
  } else if (provider === 'openrouter') {
    statusEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> កំពុងសាកល្បងតភ្ជាប់ទៅកាន់ OpenRouter AI...';
    try {
      const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`,
          'HTTP-Referer': 'http://127.0.0.1:8765',
          'X-Title': 'AI Lesson Plan Studio'
        },
        body: JSON.stringify({
          model: 'meta-llama/llama-3.3-70b-instruct:free',
          messages: [{ role: 'user', content: 'Say OK' }],
          max_tokens: 5
        })
      });
      if (resp.ok) {
        state.geminiApiKey = key;
        state.aiProvider = provider;
        await PersistentKeyVault.save(key, provider);
        checkApiKeyStatus();
        updateApiKeyModalUI();
        statusEl.style.background = '#f0fdf4';
        statusEl.style.color = '#16a34a';
        statusEl.innerHTML = '<i class="fa-solid fa-circle-check"></i> ការតភ្ជាប់ជោគជ័យ និងបានរក្សាទុក! OpenRouter API Key មានសុពលភាព។';
      } else {
        const errJson = await resp.json().catch(() => ({}));
        statusEl.style.background = '#fef2f2';
        statusEl.style.color = '#dc2626';
        statusEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> បរាជ័យពី OpenRouter: ${errJson.error?.message || resp.statusText}`;
      }
    } catch (e) {
      statusEl.style.background = '#fef2f2';
      statusEl.style.color = '#dc2626';
      statusEl.innerHTML = `<i class="fa-solid fa-wifi"></i> មិនអាចតភ្ជាប់ OpenRouter: ${e.message}`;
    }
  } else {
    // Google Gemini (Dynamic Model Discovery & Auto-Matching)
    statusEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> កំពុងទាញយកបញ្ជីម៉ូដែលផ្លូវការពី Google AI Studio...';
    
    let modelsToTest = [];
    const discovered = await discoverGeminiModels(key);
    if (discovered && discovered.length > 0) {
      discovered.sort((a, b) => {
        const score = (m) => {
          const name = (m.name || '').toLowerCase();
          if (name === 'gemini-2.5-pro') return 250;
          if (name === 'gemini-3.8-flash') return 240;
          if (name === 'gemini-3.6-flash') return 230;
          if (name === 'gemini-3.5-flash-lite') return 210;
          if (name === 'gemini-2.5-flash-lite') return 200;
          if (name.includes('2.5-pro')) return 195;
          if (name.includes('3.8-flash')) return 190;
          if (name.includes('3.6-flash')) return 185;
          if (name.includes('flash-lite')) return 175;
          if (name === 'gemini-2.0-flash') return 150;
          if (name.includes('flash') && !name.includes('tts') && !name.includes('image')) return 140;
          if (name.includes('pro') && !name.includes('tts') && !name.includes('image')) return 130;
          return 10;
        };
        return score(b) - score(a);
      });
      modelsToTest = discovered.slice(0, 4);
    } else {
      modelsToTest = [
        { ver: 'v1beta', name: 'gemini-2.5-pro' },
        { ver: 'v1beta', name: 'gemini-3.8-flash' },
        { ver: 'v1beta', name: 'gemini-3.6-flash' },
        { ver: 'v1beta', name: 'gemini-3.5-flash-lite' },
        { ver: 'v1beta', name: 'gemini-2.5-flash-lite' },
        { ver: 'v1beta', name: 'gemini-2.0-flash' }
      ];
    }

    let success = false;
    let lastErr = null;

    for (const item of modelsToTest) {
      statusEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> កំពុងសាកល្បងតភ្ជាប់ Google Gemini (${item.name})...`;
      try {
        const url = `https://generativelanguage.googleapis.com/${item.ver}/models/${item.name}:generateContent?key=${key}`;
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'Say OK' }] }],
            generationConfig: { maxOutputTokens: 5 }
          })
        });
        if (resp.ok) {
          success = true;
          state.verifiedGeminiModel = item;
          state.geminiApiKey = key;
          state.aiProvider = provider;
          await PersistentKeyVault.save(key, provider);
          checkApiKeyStatus();
          updateApiKeyModalUI();
          statusEl.style.background = '#f0fdf4';
          statusEl.style.color = '#16a34a';
          const isPro = item.name.includes('pro');
          const badge = isPro ? ' 🏆 <strong>(Pro Model Activated!)</strong>' : ' ⚡ <strong>(Gemini Flash Activated!)</strong>';
          statusEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> ការតភ្ជាប់ជោគជ័យ និងបានរក្សាទុក! Google Gemini <strong>${item.name}</strong> ដំណើរការ ១០០%!${badge}`;
          break;
        } else {
          const errData = await resp.json().catch(() => ({}));
          lastErr = errData.error?.message || resp.statusText;
          if (lastErr.includes('API_KEY_INVALID') || lastErr.includes('API key not valid')) {
            break;
          }
        }
      } catch (e) {
        lastErr = e.message;
      }
    }

    if (!success) {
      statusEl.style.background = '#fef2f2';
      statusEl.style.color = '#dc2626';
      statusEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> បរាជ័យពី Google: ${lastErr || 'Invalid Key — សូម Paste API Key ពី aistudio.google.com ម្ដងទៀត'}`;
    }
  }
}
window.testCurrentAiProviderKey = testCurrentAiProviderKey;
window.testGeminiApiKey = testCurrentAiProviderKey;

// 1-Click Reset to Default Smart Engine (Clean Start)
async function resetToSmartEngineDefault() {
  await PersistentKeyVault.clear();
  state.geminiApiKey = '';
  state.aiProvider = 'gemini';
  state.verifiedGeminiModel = null;
  const inputEl = document.getElementById('inputGeminiKey');
  if (inputEl) inputEl.value = '';
  const sel = document.getElementById('selectAiProvider');
  if (sel) sel.value = 'gemini';
  handleAiProviderChange();
  const statusEl = document.getElementById('apiKeyTestStatus');
  if (statusEl) {
    statusEl.style.display = 'block';
    statusEl.style.background = '#fefce8';
    statusEl.style.color = '#854d0e';
    statusEl.innerHTML = '<i class="fa-solid fa-circle-check"></i> បានសម្អាត API Key រួចរាល់! លោកគ្រូអាច Paste Key ថ្មី ឬប្រើ Smart Offline Engine។';
  }
  checkApiKeyStatus();
  updateApiKeyModalUI();

  showToast('🔄 បានសម្អាត API Key ដោយជោគជ័យ!', 'info');
}
window.resetToSmartEngineDefault = resetToSmartEngineDefault;

// Helper to update Loading Overlay UI Status in real-time
function setLoadingOverlayStatus(title, desc, subStatus) {
  const titleEl = document.getElementById('loadingTitleText');
  const descEl = document.getElementById('loadingDescText');
  const subEl = document.getElementById('loadingSubStatus');
  if (title && titleEl) titleEl.textContent = title;
  if (desc && descEl) descEl.textContent = desc;
  if (subEl) subEl.textContent = subStatus || '';
}

// Smart Built-in Synthesizer Engine (Authentic MoEYS Curriculum Logic & Backward Design UbD)
function hideLoadingOverlay() {
  const el = document.getElementById('loadingOverlay');
  if (el) el.style.display = 'none';
}

function showLoadingOverlay() {
  const el = document.getElementById('loadingOverlay');
  if (el) el.style.display = 'flex';
}

function synthesizeLessonPlanOffline(params) {
  const lessonTitle = params.lessonTitle || (params.chapter ? params.chapter : 'មេរៀនទូទៅ');
  const subject = params.subject;
  const grade = params.grade;
  const method = params.method;
  const duration = params.duration || '៥០ នាទី (១ ម៉ោងសិក្សា)';
  const content = params.lessonContent;
  const isFlipped = isFlippedLearningRequest(params);
  const isBd = !isFlipped && isBackwardDesignRequest(params);

  // Dynamically calculate accurate proportional step durations
  const stepTimes = calculateStepDurations(duration, isFlipped ? 'flipped' : (isBd ? 'backward_design' : 'standard'));

  const lines = content ? content.split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 2 && !l.match(/^\[ស្លាយទី\s*\d+\]/i) && !l.match(/^\[ទំព័រ(ទី)?\s*\d+\]/i)) : [];
  const mainPoints = lines.slice(0, 6).map(l => l.replace(/^[-*•\d.)\s]+/, '').trim()).filter(l => l.length > 2);

  const knowledge = [
    `កំណត់និយមន័យ និងពន្យល់ពីខ្លឹមសារចម្បងនៃ «${lessonTitle}» តាមរយៈការសង្កេតស្លាយបង្រៀន និងការពន្យល់របស់គ្រូ បានត្រឹមត្រូវ និងក្បោះក្បាយ។`,
    `ចងចាំ និងរៀបរាប់រូបមន្ត ច្បាប់ ឬទ្រឹស្តីគន្លឹះនៃ ${subject} តាមរយៈការអានឯកសារ និងការពិភាក្សាជាក្រុម បានយ៉ាងហោចណាស់ ៨០% ត្រឹមត្រូវ។`
  ];

  const skills = [
    `វិភាគ គណនា និងដោះស្រាយលំហាត់ជាក់ស្តែងទាក់ទងនឹង «${lessonTitle}» តាមរយៈការអនុវត្តការងារជាក្រុម បានត្រឹមត្រូវតាមក្បួនខ្នាត។`,
    `រៀបចំ ធ្វើបទបង្ហាញ និងការពារលទ្ធផលការងារជាក្រុម តាមរយៈផ្ទាំង Flipchart ឬក្ដារឆ្នួន ប្រកបដោយភាពជឿជាក់ និងស្ទាត់ជំនាញ។`
  ];

  const attitudes = [
    `បង្ហាញនូវស្មារតីសហការ យកចិត្តទុកដាក់ និងការគោរពវិន័យក្នុងការរៀនសូត្រ តាមរយៈការចូលរួមសកម្មភាពក្រុម ប្រកបដោយទំនួលខុសត្រូវខ្ពស់។`,
    `ប្ដេជ្ញាចិត្តយកចំណេះដឹង និងបំណិនដែលទទួលបានពី «${lessonTitle}» ទៅអនុវត្តក្នុងការរស់នៅ និងដោះស្រាយបញ្ហាជាក់ស្តែង ដោយភាពស្មោះត្រង់ និងវិជ្ជមាន។`
  ];

  const teacherMaterials = [
    `សៀវភៅសិក្សាគោលមុខវិជ្ជា ${subject} ${grade}`,
    `សៀវភៅគ្រូ បន្ទះរូបភាព ឬផ្ទាំងតារាងសង្ខេបខ្លឹមសារ`,
    `កុំព្យូទ័រ/ស្លាយបង្រៀន និងសម្ភារពិសោធន៍ជាក់ស្តែង (បើមាន)`
  ];

  const studentMaterials = [
    `សៀវភៅពុម្ព ${subject} ${grade}`,
    `សៀវភៅសរសេរ ប៊ិច ខ្មៅដៃ បន្ទាត់ ក្ដារឆ្នួន`
  ];

  // Pre-Test and Post-Test are created separately on-demand when requested by the user
  const preTestQCM = [];
  const postTestMCQ = [];

  if (isFlipped) {
    const flippedSteps = [
      {
        stepNumber: 1,
        stepTitle: "ជំហានទី១៖ រដ្ឋបាលថ្នាក់",
        duration: stepTimes.step1,
        teacherActivity: "• គ្រូពិនិត្យអនាម័យ សណ្ដាប់ធ្នាប់ក្នុងថ្នាក់ និងសម្លៀកបំពាក់សិស្ស\n• គ្រូពិនិត្យវត្តមាន និងសម្រង់វត្តមានសិស្សប្រចាំថ្ងៃ",
        contentSummary: "• ការពិនិត្យអនាម័យ សម្រង់វត្តមាន និងសណ្ដាប់ធ្នាប់ទូទៅក្នុងថ្នាក់\n• រៀបចំបរិយាកាស និងស្មារតីសម្រាប់ការរៀនសកម្ម",
        studentActivity: "• ប្រធានថ្នាក់ឡើងរាយការណ៍ពីចំនួនសិស្សវត្តមាន និងអវត្តមាន\n• សិស្សទាំងអស់អង្គុយតាមកន្លែង រៀបចំសម្ភារសិក្សា និងគោរពវិន័យ"
      },
      {
        stepNumber: 2,
        stepTitle: "ជំហានទី២៖ រំលឹកមេរៀនចាស់",
        duration: stepTimes.step2,
        teacherActivity: `• គ្រូត្រួតពិនិត្យការស្វ័យសិក្សា និងរំលឹកចំណុចគន្លឹះនៃ «${lessonTitle}»\n• គ្រូបង្ហាញលទ្ធផលបុរេតេស្ត (Pre-Test QCM ៥ សំណួរ) និងស្រាយចម្ងល់ Muddiest Points`,
        contentSummary: `• ពិនិត្យការស្វ័យសិក្សា និងវិភាគលទ្ធផលបុរេតេស្ត (Pre-Test QCM ៥ សំណួរ)\n• បំភ្លឺចំណុចស្រពេចស្រពិល និងភ្ជាប់ទៅសកម្មភាពអនុវត្ត`,
        studentActivity: `• សិស្សស្តាប់ និងឆ្លើយសំណួររំលឹករបស់គ្រូ\n• លើកឡើងនូវចំណុចដែលនៅមិនទាន់ច្បាស់ពីការស្វ័យសិក្សានៅផ្ទះ`
      },
      {
        stepNumber: 3,
        stepTitle: "ជំហានទី៣៖ ខ្លឹមសារមេរៀនថ្មី",
        duration: stepTimes.step3,
        teacherActivity: `• គ្រូពន្យល់សង្ខេបតែលើគំនិតស្នូល និងក្របខណ្ឌទ្រឹស្តីសំខាន់ៗនៃ «${lessonTitle}»\n• គ្រូចោទសួរ និងដោះស្រាយចម្ងល់គន្លឹះរបស់សិស្ស`,
        contentSummary: `«${lessonTitle}»\n• ខ្លឹមសារ និងទ្រឹស្តីស្នូលនៃមេរៀន៖\n` + (mainPoints.length > 0 ? mainPoints.map(p => `  - ${p}`).join('\n') : `  - និយមន័យ និងគោលការណ៍គ្រឹះនៃ ${lessonTitle}\n  - ការផ្សារភ្ជាប់ទ្រឹស្តីទៅនឹងការអនុវត្តជាក់ស្តែង`),
        studentActivity: `• សិស្សយកចិត្តទុកដាក់ស្តាប់ការពន្យល់ និងកត់ត្រាគំនិតគន្លឹះ\n• ឆ្លើយតប និងសួរសំណួរបំភ្លឺបន្ថែមឱ្យកាន់តែស៊ីជម្រៅ`
      },
      {
        stepNumber: 4,
        stepTitle: "ជំហានទី៤៖ ពង្រឹងចំណេះដឹង",
        duration: stepTimes.step4,
        teacherActivity: `• គ្រូបែងចែកក្រុមការងារ និងប្រគល់សន្លឹកកិច្ចការករណីសិក្សាជាក់ស្តែង (Challenge Scenario) លើ Flipchart A0/A1\n• គ្រូដើរសម្របសម្រួល ផ្តល់ Feedback និងដឹកនាំ Gallery Walk ការពារលទ្ធផលក្រុម`,
        contentSummary: `• សកម្មភាពអនុវត្តស៊ីជម្រៅ និងដោះស្រាយករណីសិក្សាជាក់ស្តែង៖\n` + (mainPoints.length > 0 ? mainPoints.map(p => `  • ${p}`).join('\n') : `  • ការវិភាគករណីសិក្សា និងយុទ្ធសាស្ត្រគរុកោសល្យ\n  • ការវាយតម្លៃ និងការឆ្លុះបញ្ចាំងបែបស្ថាបនា`),
        studentActivity: `• ធ្វើការរួមគ្នាក្នុងក្រុម វិភាគបញ្ហាដោយប្រើទ្រឹស្តីដែលបានរៀន\n• សរសេរដំណោះស្រាយលើ Flipchart តំណាងក្រុមឡើងការពារ និងឆ្លើយសំណួរដេញដោល`
      },
      {
        stepNumber: 5,
        stepTitle: "ជំហានទី៥៖ កិច្ចការផ្ទះ និងបណ្ដាំផ្ញើ",
        duration: stepTimes.step5,
        teacherActivity: `• គ្រូបូកសរុបគន្លឹះនៃមេរៀន ${lessonTitle} និងណែនាំការធ្វើតេស្តបញ្ចប់ (Post-Test ៥ សំណួរ)\n• គ្រូដាក់កិច្ចការស្រាវជ្រាវ និងណែនាំមាតិកាស្វ័យសិក្សាសម្រាប់សប្តាហ៍បន្ទាប់`,
        contentSummary: `• បូកសរុបការវាយតម្លៃលទ្ធផលសិក្សា (Post-Test ៥ សំណួរ)\n• កិច្ចការស្រាវជ្រាវ និងការត្រៀមសម្រាប់មេរៀនបន្ត`,
        studentActivity: `• ធ្វើ Post-Test ៥ សំណួរ\n• កត់ត្រាកិច្ចការផ្ទះ និងកាលវិភាគស្វ័យសិក្សាសប្តាហ៍បន្ទាប់`
      }
    ];

    return {
      templateType: 'flipped_learning',
      templateTitle: 'កិច្ចតែងការបង្រៀនតាមបែបត្រឡប់',
      school: params.school || 'វិទ្យាស្ថានគរុកោសល្យ',
      teacher: params.teacher || 'កែម បូរី',
      subject: subject || 'ចិត្តវិទ្យាអប់រំ',
      grade: grade || 'គរុនិស្សិត ឆ្នាំទី ១ ឆមាសទី ២',
      credits: params.credits || '៣ ក្រេឌីត (៣-០-៦)',
      year: params.year || '១',
      semester: params.semester || '២',
      week: params.week || '១',
      lessonNumber: params.lessonNumber || '១',
      duration: duration || '១៨០ នាទី',
      chapter: params.chapter || '',
      lessonTitle: lessonTitle,
      method: method || 'ការរៀនបែបត្រឡប់',
      dateStr: getKhmerFormattedDate(),
      licenseFootnote: 'ខ្ញុំឈ្មោះកែម បូរី ជាគ្រូឧទ្ទេសមុខវិជ្ជាចិត្តវិទ្យាអប់រំ នៅវិទ្យាស្ថានគរុកោសល្យកំពង់ចាម',
      objectives: { knowledge, skills, attitudes },
      materials: { teacher: teacherMaterials, student: studentMaterials },
      preTestQCM: preTestQCM,
      steps: flippedSteps,
      postTestMCQ: postTestMCQ
    };
  }


  if (isBd) {
    const stage1 = {
      title: 'ដំណាក់កាលទី ១ : ការកំណត់លទ្ធផលរំពឹងទុក (Stage 1: Desired Results)',
      establishedGoals: `សិស្សយល់ដឹងស៊ីជម្រៅអំពីគោលគំនិតសំខាន់ៗនៃ «${lessonTitle}» ក្នុងមុខវិជ្ជា ${subject} ${grade} និងអាចយកចំណេះដឹងនេះទៅដោះស្រាយបញ្ហាក្នុងជីវភាពជាក់ស្តែង។`,
      enduringUnderstandings: [
        `ការយល់ដឹងពីគោលការណ៍គ្រឹះនៃ ${lessonTitle} ជួយឱ្យសិស្សមានមូលដ្ឋានគ្រឹះរឹងមាំក្នុងការស្រាវជ្រាវ និងសិក្សាបន្ត។`,
        `ចំណេះដឹង ${subject} ផ្សារភ្ជាប់យ៉ាងជិតស្និទ្ធទៅនឹងបាតុភូត និងការអនុវត្តប្រចាំថ្ងៃក្នុងសង្គម។`
      ],
      essentialQuestions: [
        `ហេតុអ្វីបានជាយើងត្រូវសិក្សា និងស្វែងយល់អំពី «${lessonTitle}»?`,
        `តើយើងអាចយកទ្រឹស្តី និងរូបមន្តនៃ ${subject} ទៅអនុវត្តដោះស្រាយបញ្ហាជាក់ស្តែងដោយរបៀបណា?`
      ],
      objectives: { knowledge, skills, attitudes }
    };

    const stage2 = {
      title: 'ដំណាក់កាលទី ២ : ការកំណត់ភស្តុតាងនៃការវាយតម្លៃ (Stage 2: Assessment Evidence)',
      performanceTasks: [
        `សិស្សអាចធ្វើការជាក្រុម ដោះស្រាយលំហាត់គំរូ ពិសោធន៍ ឬបកស្រាយខ្លឹមសារនៃ «${lessonTitle}» នៅលើក្ដារខៀនបានត្រឹមត្រូវ។`,
        `ការរៀបចំរបាយការណ៍សង្ខេប និងការឆ្លើយតបសំណួរដេញដោលទាក់ទងនឹងបាតុភូតជាក់ស្តែង។`
      ],
      otherEvidence: [
        `ការឆ្លើយសំណួរផ្ទាល់មាត់អំឡុងពេលបង្រៀន និងការលើកបង្ហាញលើក្ដារឆ្នួនរហ័ស។`,
        `ការបំពេញសន្លឹកកិច្ចការបុគ្គល និងលទ្ធផលកិច្ចការផ្ទះ។`
      ],
      criteria: [
        `ភាពត្រឹមត្រូវនៃចម្លើយ និងក្បួនដោះស្រាយ (៨០% ឡើង)`,
        `បំណិនបកស្រាយ និងការចូលរួមយ៉ាងសកម្មក្នុងថ្នាក់រៀន`
      ]
    };

    const learningActivities = [
      {
        stepNumber: 1,
        stepTitle: "១. ការទាក់ទាញ និងភ្ជាប់ទំនាក់ទំនង (Hook & Connect)",
        duration: stepTimes.step1,
        teacherActivity: `• ពិនិត្យវត្តមាន និងអនាម័យ\n• ចោទសួរសំណួរគន្លឹះ (Essential Question)៖ «តើ ${lessonTitle} មានសារៈសំខាន់ដូចម្តេចក្នុងជីវភាព?»`,
        contentSummary: `• រដ្ឋបាលថ្នាក់ និងអនាម័យ\n• សំណួរគន្លឹះដាស់ការត្រិះរិះពិចារណា`,
        studentActivity: `• ត្រៀមសម្ភារសិក្សា និងរាយការណ៍វត្តមាន\n• ចូលរួមឆ្លើយសំណួរគន្លឹះដោយសេរី`
      },
      {
        stepNumber: 2,
        stepTitle: "២. ការរុករក និងកសាងចំណេះដឹង (Equip & Explore)",
        duration: stepTimes.step2,
        teacherActivity: `• ចែកសិស្សជាក្រុមកិច្ចការ និងប្រគល់សន្លឹកកិច្ចការស្រាវជ្រាវ/លំហាត់\n• ណែនាំសិស្សឱ្យពិភាក្សា រុករកនិយមន័យ រូបមន្ត និងឧទាហរណ៍នៃ «${lessonTitle}»`,
        contentSummary: `ខ្លឹមសារស្នូល៖ «${lessonTitle}»\n` + (mainPoints.length > 0 ? mainPoints.map(p => `• ${p}`).join('\n') : `• និយមន័យ និងគោលការណ៍គ្រឹះ\n• រូបមន្ត និងការគណនាគំរូ`),
        studentActivity: `• សហការពិភាក្សាក្នុងក្រុម និងដោះស្រាយសន្លឹកកិច្ចការ\n• តំណាងក្រុមឡើងធ្វើបទបង្ហាញ`
      },
      {
        stepNumber: 3,
        stepTitle: "៣. ការឆ្លុះបញ្ចាំង និងកែសម្រួល (Rethink & Reflect)",
        duration: stepTimes.step3,
        teacherActivity: `• សម្របសម្រួលឱ្យសិស្សឆ្លុះបញ្ចាំងលើលទ្ធផលការងារ\n• ផ្ទៀងផ្ទាត់ និងកែតម្រូវចំណុចខុសឆ្គងរួមគ្នា\n• សង្ខេបគន្លឹះសំខាន់ៗ`,
        contentSummary: `• ឆ្លុះបញ្ចាំងលើការយល់ដឹងរបស់សិស្ស\n• សន្និដ្ឋានខ្លឹមសារមេរៀនរួម`,
        studentActivity: `• ផ្ទៀងផ្ទាត់ចម្លើយ និងកែតម្រូវចំណុចខ្វះខាត\n• កត់ត្រាកំណែត្រឹមត្រូវចូលសៀវភៅ`
      }
    ];

    return {
      templateType: 'backward_design',
      templateTitle: 'កិច្ចតែងការបង្រៀន (តាមបែបត្រឡប់ - Backward Design / UbD)',
      school: params.school || '',
      teacher: params.teacher || '',
      subject: subject,
      grade: grade,
      duration: duration,
      chapter: params.chapter || '',
      lessonTitle: lessonTitle,
      method: method,
      dateStr: getKhmerFormattedDate(),
      objectives: { knowledge, skills, attitudes },
      materials: { teacher: teacherMaterials, student: studentMaterials },
      stage1: stage1,
      stage2: stage2,
      stage3: {
        title: 'ដំណាក់កាលទី ៣ : ផែនការរៀបចំការបង្រៀន និងរៀន (Stage 3: Learning Plan)',
        activities: learningActivities
      },
      steps: learningActivities,
      preTestQCM: preTestQCM,
      postTestMCQ: postTestMCQ
    };
  }

  // Standard 5-Step MoEYS / Primary / STEM
  const steps = [
    {
      stepNumber: 1,
      stepTitle: "ជំហានទី ១ : រដ្ឋបាលថ្នាក់",
      duration: stepTimes.step1,
      teacherActivity: "• គ្រូពិនិត្យអនាម័យ សណ្ដាប់ធ្នាប់ក្នុងថ្នាក់ និងសម្លៀកបំពាក់សិស្ស\n• គ្រូពិនិត្យវត្តមាន និងកត់ត្រាចំនួនសិស្សអវត្តមានក្នុងបញ្ជីវត្តមាន",
      contentSummary: "• ពង្រឹងវិន័យ អនាម័យថ្នាក់រៀន និងបរិស្ថានសិក្សា\n• សម្រង់វត្តមានសិស្សប្រចាំថ្ងៃ",
      studentActivity: "• ប្រធានថ្នាក់ឡើងរាយការណ៍ពីចំនួនសិស្សវត្តមាន និងអវត្តមាន\n• សិស្សទាំងអស់អង្គុយតាមកន្លែង រៀបចំសម្ភារសិក្សា និងគោរពវិន័យ"
    },
    {
      stepNumber: 2,
      stepTitle: "ជំហានទី ២ : រំលឹកមេរៀនចាស់ / ទំនាក់ទំនងមេរៀន",
      duration: stepTimes.step2,
      teacherActivity: `• គ្រូសួរសំណួររំលឹកមេរៀនចាស់ ឬចោទជាបញ្ហាខ្លីៗទាក់ទងនឹង ${subject}\n• គ្រូកោតសរសើរ និងភ្ជាប់ទំនាក់ទំនងទៅកាន់មេរៀនថ្មី «${lessonTitle}»`,
      contentSummary: `• រំលឹកខ្លឹមសារគន្លឹះនៃមេរៀនមុន\n• ស្ពានចម្លងគំនិតចូលមេរៀនថ្មី៖ «${lessonTitle}»`,
      studentActivity: "• សិស្សស្តាប់ និងស្ម័គ្រចិត្តឡើងឆ្លើយសំណួររំលឹកមេរៀនចាស់\n• កត់សម្គាល់ចំណុចផ្សារភ្ជាប់ទៅកាន់មេរៀនថ្មី"
    },
    {
      stepNumber: 3,
      stepTitle: "ជំហានទី ៣ : ដំណើរការបង្រៀន និងរៀន (មេរៀនថ្មី)",
      duration: stepTimes.step3,
      teacherActivity: `• គ្រូសរសេរចំណងជើងមេរៀន «${lessonTitle}» លើក្ដារខៀន\n• គ្រូពន្យល់ បង្ហាញរូបភាព/ស្លាយ និងចោទសួរសំណួរគន្លឹះ\n• គ្រូសម្របសម្រួលការពិភាក្សា និងបូកសរុបចម្លើយសិស្ស`,
      contentSummary: `«${lessonTitle}»\n• ខ្លឹមសារស្នូល និងចំណុចសំខាន់ៗ៖\n` + (mainPoints.length > 0 ? mainPoints.map(p => `  - ${p}`).join('\n') : `  - និយមន័យ និងទ្រឹស្តីមូលដ្ឋាននៃ ${lessonTitle}\n  - ឧទាហរណ៍ និងរូបមន្តគន្លឹះ\n  - ការអនុវត្តជាក់ស្តែង`),
      studentActivity: `• សិស្សកត់ត្រាចំណងជើងមេរៀន «${lessonTitle}» ចូលសៀវភៅ\n• យកចិត្តទុកដាក់ស្តាប់ការពន្យល់ និងចូលរួមឆ្លើយសំណួរគ្រូ\n• សហការពិភាក្សាក្នុងក្រុម និងកត់ចំណាំខ្លឹមសារសំខាន់ៗ`
    },
    {
      stepNumber: 4,
      stepTitle: "ជំហានទី ៤ : ពង្រឹងពុទ្ធិ (វាយតម្លៃ)",
      duration: stepTimes.step4,
      teacherActivity: `• គ្រូដាក់សំណួរពង្រឹងការយល់ដឹង ឬលំហាត់អនុវត្តរហ័សទាក់ទងនឹង «${lessonTitle}»\n• គ្រូដើរសង្កេត ណែនាំសិស្ស និងកែសម្រួលចម្លើយរួមថ្នាក់`,
      contentSummary: `• សំណួរវាស់ស្ទង់ការយល់ដឹង ឬលំហាត់សង្ខេប\n• កំណែចម្លើយត្រឹមត្រូវ និងការកែតម្រូវចំណុចខ្វះខាត`,
      studentActivity: "• សិស្សគិត គណនា និងឆ្លើយសំណួរពង្រឹងពុទ្ធិលើក្ដារឆ្នួន ឬសៀវភៅ\n• ផ្ទៀងផ្ទាត់ចម្លើយ និងកែតម្រូវចំណុចខុសឆ្គង"
    },
    {
      stepNumber: 5,
      stepTitle: "ជំហានទី ៥ : បណ្តាំផ្ញើ និងកិច្ចការផ្ទះ",
      duration: stepTimes.step5,
      teacherActivity: `• គ្រូសង្ខេបចំណុចសំខាន់ៗនៃមេរៀន ${lessonTitle} ឡើងវិញ\n• គ្រូដាក់កិច្ចការផ្ទះទាក់ទងនឹង ${lessonTitle}\n• គ្រូផ្ដាំផ្ញើអប់រំទូន្មានសីលធម៌ និងការមើលមេរៀនបន្តសម្រាប់ម៉ោងក្រោយ`,
      contentSummary: `• ចំណុចសំខាន់ៗដែលសិស្សត្រូវចងចាំពីមេរៀន ${lessonTitle}\n• កិច្ចការផ្ទះ៖ លំហាត់អនុវត្តសម្រាប់ផ្ទះ\n• បណ្ដាំផ្ញើអប់រំសីលធម៌ និងសុវត្ថិភាព`,
      studentActivity: "• សិស្សកត់ត្រាកិច្ចការផ្ទះចូលក្នុងសៀវភៅដោយយកចិត្តទុកដាក់\n• សិស្សរៀបចំសម្ភារ និងជម្រាបលាគ្រូ"
    }
  ];

  return {
    templateType: '5_steps',
    school: params.school || '',
    teacher: params.teacher || '',
    subject: subject,
    grade: grade,
    duration: duration,
    chapter: params.chapter || '',
    lessonTitle: lessonTitle,
    method: method,
    dateStr: getKhmerFormattedDate(),
    objectives: { knowledge, skills, attitudes },
    materials: { teacher: teacherMaterials, student: studentMaterials },
    steps: steps,
    preTestQCM: preTestQCM,
    postTestMCQ: postTestMCQ
  };
}


function generateNotebookLMScriptOffline(subject, grade, lessonTitle, mainPoints) {
  const p1 = mainPoints[0] || `គោលការណ៍គ្រឹះ និងនិយមន័យនៃ ${lessonTitle}`;
  const p2 = mainPoints[1] || `រូបមន្តគន្លឹះ និងយន្តការដំណើរការ`;
  const p3 = mainPoints[2] || `ការអនុវត្តជាក់ស្តែង និងឧទាហរណ៍គំរូ`;

  return {
    overviewTitle: `Google NotebookLM Video Micro-Lecture ៥ នាទី: «${lessonTitle}» (${subject} ${grade})`,
    format: "វីដេអូបង្រៀន Micro-Lecture / Explainer Video (៥ នាទី) - ភាសាខ្មែរ",
    videoDuration: "៥ នាទី",
    fontSpecification: "Kantumruy Pro (អក្សររត់ និងចំណងជើងក្នុងវីដេអូ)",
    keyTakeaways: [
      `ស្វែងយល់ពីនិយមន័យ និងគោលគំនិតចម្បង៖ ${p1}`,
      `យន្តការដំណើរការ និងរូបមន្តគន្លឹះ៖ ${p2}`,
      `ការផ្សារភ្ជាប់ទ្រឹស្តីទៅនឹងការដោះស្រាយបញ្ហាក្នុងជីវភាពជាក់ស្តែង៖ ${p3}`
    ],
    scriptSegments: [
      {
        timestamp: "0:00 - 1:00",
        sceneDescription: "ណែនាំមេរៀន & ចោទបញ្ហាគន្លឹះ",
        narration: `សួស្តីប្អូនៗទាំងអស់គ្នា! សូមស្វាគមន៍មកកាន់វីដេអូស្វ័យសិក្សាខ្លី ៥ នាទី នៃមេរៀន «${lessonTitle}» ក្នុងមុខវិជ្ជា ${subject} ${grade}។ ថ្ងៃនេះយើងនឹងស្វែងយល់ពីគោលគំនិតចម្បង និងបញ្ហាគន្លឹះមុនពេលចូលរៀនក្នុងថ្នាក់!`,
        onScreenText: `មេរៀន៖ ${lessonTitle} (${subject} ${grade})`
      },
      {
        timestamp: "1:00 - 2:30",
        sceneDescription: "ពន្យល់ទ្រឹស្តី & រូបមន្តយន្តការស្នូល",
        narration: `ចំណុចស្នូលដែលប្អូនៗត្រូវយល់ឱ្យបានស៊ីជម្រៅ គឺ ${p1}។ នៅពេលយើងពិនិត្យមើលលម្អិត យន្តការនេះកើតឡើងតាមរយៈ ${p2} ដែលជាគន្លឹះមិនអាចខ្វះបានក្នុងការដោះស្រាយលំហាត់ និងកិច្ចការស្រាវជ្រាវ!`,
        onScreenText: `យន្តការគន្លឹះ៖ ${p2}`
      },
      {
        timestamp: "2:30 - 4:00",
        sceneDescription: "ឧទាហរណ៍ជាក់ស្តែង & ការផ្សារភ្ជាប់ជីវភាព",
        narration: `ឥឡូវនេះសូមក្រឡេកមកមើលការអនុវត្តជាក់ស្តែងក្នុងជីវភាពប្រចាំថ្ងៃ គឺទាក់ទងនឹង ${p3}។ ការយល់ដឹងពីចំណុចនេះ នឹងជួយឱ្យប្អូនៗអាចផ្សារភ្ជាប់មេរៀនទៅនឹងសង្គមពិតបានយ៉ាងល្អប្រសើរ!`,
        onScreenText: `ការអនុវត្តជាក់ស្តែង៖ ${p3}`
      },
      {
        timestamp: "4:00 - 5:00",
        sceneDescription: "សង្ខេប បេសកកម្ម Muddiest Point & Pre-Test",
        narration: `ជាចុងក្រោយ សូមប្អូនៗកត់ត្រាចំណុចដែលខ្លួននៅស្រពិចស្រពិល (Muddiest Point) យ៉ាងតិចមួយសំណួរ ព្រមទាំងឆ្លើយវិញ្ញាសា Pre-Test QCM ៥ សំណួរខាងក្រោម ដើម្បីត្រៀមខ្លួនសម្រាប់សកម្មភាពអនុវត្តជាក្រុមក្នុងថ្នាក់!`,
        onScreenText: `កត់ត្រា Muddiest Point & ឆ្លើយវិញ្ញាសា Pre-Test QCM ៥ សំណួរ`
      }
    ],
    notebooklmPrompt: `Generate an engaging 5-minute Educational Video Explainer / Micro-Lecture in 100% Khmer for "${lessonTitle}" (${subject} ${grade}). Key concepts: 1. ${p1}, 2. ${p2}, 3. ${p3}. All on-screen captions and text overlays must run in Khmer using font 'Kantumruy Pro' exclusively. Include timestamps, scene descriptions, Khmer teacher narration, and Kantumruy Pro on-screen display text.`
  };
}

function distributeAndBalanceQuizList(list) {
  if (!Array.isArray(list) || list.length === 0) return list;

  // If the list is already well-distributed and authentic from AI (has at least 2 distinct answer keys),
  // preserve AI questions, options, and explanations without scrambling!
  const keys = new Set(list.map(q => (q && q.correctAnswer ? String(q.correctAnswer).trim().toUpperCase() : 'A')));
  if (keys.size > 1) {
    return list;
  }

  const letters = ['A', 'B', 'C', 'D'];
  const khmerLetters = ['ក', 'ខ', 'គ', 'ឃ'];
  const n = list.length;

  // Generate balanced target keys across A, B, C, D (~25% each)
  const pool = [];
  const baseCount = Math.floor(n / 4);
  const remainder = n % 4;
  for (let i = 0; i < 4; i++) {
    for (let c = 0; c < baseCount; c++) {
      pool.push(letters[i]);
    }
  }
  const remLetters = [...letters].sort(() => Math.random() - 0.5);
  for (let i = 0; i < remainder; i++) {
    pool.push(remLetters[i]);
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  // Prevent adjacent duplicate keys where possible
  for (let i = 1; i < pool.length; i++) {
    if (pool[i] === pool[i - 1]) {
      for (let j = i + 1; j < pool.length; j++) {
        if (pool[j] !== pool[i] && (j === pool.length - 1 || pool[j] !== pool[j + 1])) {
          [pool[i], pool[j]] = [pool[j], pool[i]];
          break;
        }
      }
    }
  }

  return list.map((q, idx) => {
    if (!q || typeof q !== 'object') return q;
    const item = { ...q };
    const opts = item.options || {};
    const optA = opts.A || opts['ក'] || '';
    const optB = opts.B || opts['ខ'] || '';
    const optC = opts.C || opts['គ'] || '';
    const optD = opts.D || opts['ឃ'] || '';

    let rawCorrect = (item.correctAnswer || 'A').toString().trim().toUpperCase();
    let correctText = optA;
    if (rawCorrect === 'B' || rawCorrect === 'ខ' || rawCorrect === '2' || rawCorrect === '២' || (optB && rawCorrect === optB)) {
      correctText = optB;
    } else if (rawCorrect === 'C' || rawCorrect === 'គ' || rawCorrect === '3' || rawCorrect === '៣' || (optC && rawCorrect === optC)) {
      correctText = optC;
    } else if (rawCorrect === 'D' || rawCorrect === 'ឃ' || rawCorrect === '4' || rawCorrect === '៤' || (optD && rawCorrect === optD)) {
      correctText = optD;
    }

    const allOptions = [optA, optB, optC, optD];
    const correctIdx = allOptions.indexOf(correctText);
    const distractors = allOptions.filter((_, i) => i !== (correctIdx >= 0 ? correctIdx : 0));

    // Shuffle distractors randomly
    for (let i = distractors.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [distractors[i], distractors[j]] = [distractors[j], distractors[i]];
    }

    const targetKey = pool[idx % pool.length];
    const targetIdx = letters.indexOf(targetKey);

    const newOpts = {};
    let distractorIdx = 0;
    for (let i = 0; i < 4; i++) {
      const val = (i === targetIdx) ? correctText : (distractors[distractorIdx++] || '');
      newOpts[letters[i]] = val;
      newOpts[khmerLetters[i]] = val;
    }

    item.options = newOpts;
    item.correctAnswer = targetKey;
    return item;
  });
}

function randomizeQuestionOptions(q) {
  if (!q || !q.options) return q;
  const res = distributeAndBalanceQuizList([q]);
  return res[0] || q;
}

function randomizeQuizList(list) {
  return distributeAndBalanceQuizList(list);
}
window.distributeAndBalanceQuizList = distributeAndBalanceQuizList;
window.randomizeQuizList = distributeAndBalanceQuizList;

// Generate Pre-Test QCM Questions following strict 60% - 30% - 10% MoEYS Standard
function generatePreTestQCMOffline(subject, grade, lessonTitle, mainPoints = [], count = 10) {
  const cleanTitle = (lessonTitle || "មេរៀន").trim();
  const subj = (subject || "").toLowerCase();
  const isPsychOrInfo = subj.includes('ចិត្តវិទ្យា') || cleanTitle.includes('ព័ត៌មាន') || cleanTitle.includes('ចងចាំ') || subj.includes('psychology');

  if (isPsychOrInfo) {
    const psychList = [
      // 6 EASY QUESTIONS (Q1 - Q6) - 60%
      {
        number: 1,
        difficulty: "ងាយ (Easy)",
        difficultyLevel: "easy",
        question: "តើអ្វីជា «ការទទួលដឹងតាមរយៈញាណ» (Sensory Register / Sensory Memory) ក្នុងចិត្តវិទ្យាអប់រំ?",
        options: {
          A: "ជាដំណាក់កាលដំបូងនៃការកត់សម្គាល់ព័ត៌មានពីបរិស្ថានតាមរយៈឥន្ទ្រិយារម្មណ៍ទាំង ៥ ក្នុងរយៈពេលខ្លីបំផុត",
          B: "ជាការចងចាំចំណេះដឹងអចិន្ត្រៃយ៍ដែលមិនអាចបំភ្លេចបាន",
          C: "ជាការគិតពិចារណាដោះស្រាយលំហាត់ស្មុគស្មាញ",
          D: "ជាការបដិសេធមិនទទួលយកព័ត៌មានពីខាងក្រៅ"
        },
        correctAnswer: "A",
        explanation: "Sensory Register គឺជាច្រកទ្វារដំបូងដែលទទួលរំញោចពីបរិស្ថានតាមរយៈភ្នែក ត្រចៀក ច្រមុះ អណ្តាត និងស្បែក ក្នុងថិរវេលាត្រឹមតែពីរបីវិនាទីប៉ុណ្ណោះ។"
      },
      {
        number: 2,
        difficulty: "ងាយ (Easy)",
        difficultyLevel: "easy",
        question: "ក្នុងចំណោមឥន្ទ្រិយារម្មណ៍ទាំង៥ តើញាណណាខ្លះដែលដើរតួយ៉ាងសំខាន់បំផុតក្នុងការទទួលព័ត៌មានសម្រាប់ការរៀនសូត្រក្នុងថ្នាក់?",
        options: {
          A: "ចក្ខុវិញ្ញាណ (ការមើលឃើញ) និងសោតវិញ្ញាណ (ការស្តាប់ឮ)",
          B: "ឃានវិញ្ញាណ (ការហិតក្លិន) និងជីវ្ហាវិញ្ញាណ (ការភ្លក្សរស)",
          C: "កាយវិញ្ញាណតែមួយមុខគត់",
          D: "គ្មានឥន្ទ្រិយារម្មណ៍ណាពាក់ព័ន្ធនឹងការរៀនសូត្រឡើយ"
        },
        correctAnswer: "A",
        explanation: "ជាង ៨០% នៃព័ត៌មានដែលមនុស្សទទួលបានក្នុងការរៀនសូត្រ គឺឆ្លងកាត់តាមរយៈការមើលឃើញ (Visual) និងការស្តាប់ (Auditory)។"
      },
      {
        number: 3,
        difficulty: "ងាយ (Easy)",
        difficultyLevel: "easy",
        question: "តើ «ការយកចិត្តទុកដាក់» (Attention) ដើរតួជាអ្វីក្នុងដំណើរការទទួលបានព័ត៌មាន?",
        options: {
          A: "ជាតម្រងជ្រើសរើសព័ត៌មានសំខាន់ពី Sensory Memory បញ្ជូនទៅកាន់ Working Memory",
          B: "ជាការបញ្ឈប់ដំណើរការខួរក្បាលមិនឱ្យគិត",
          C: "ជាការទន្ទេញចាំមាត់ដោយមិនបាច់យល់",
          D: "ជាការបំផ្លាញទិន្នន័យចាស់ៗចោល"
        },
        correctAnswer: "A",
        explanation: "ប្រសិនបើគ្មានការយកចិត្តទុកដាក់ (Attention) ទេ ព័ត៌មានដែលប៉ះនឹងញាណនឹងរសាត់បាត់ភ្លាមៗ ដោយមិនអាចឆ្លងចូលទៅក្នុងស្មារតីបានឡើយ។"
      },
      {
        number: 4,
        difficulty: "ងាយ (Easy)",
        difficultyLevel: "easy",
        question: "យោងតាមទ្រឹស្តីចិត្តវិទ្យារបស់លោក George Miller តើអង្គចងចាំរយៈពេលខ្លី (Short-Term / Working Memory) អាចផ្ទុកព័ត៌មានបានប្រមាណប៉ុន្មានឯកតា (Chunks)?",
        options: {
          A: "៧ ± ២ ឯកតា (ចន្លោះពី ៥ ទៅ ៩ ឯកតា)",
          B: "គ្មានដែនកំណត់ អាចផ្ទុករាប់ពាន់ឯកតា",
          C: "ត្រឹមតែ ១ ឯកតាតែប៉ុណ្ណោះ",
          D: "២០ ទៅ ៣០ ឯកតាក្នុងពេលតែមួយ"
        },
        correctAnswer: "A",
        explanation: "ក្បួន Miller's Law (7 ± 2) បញ្ជាក់ថា អង្គចងចាំដំណើរការរបស់មនុស្សមានសមត្ថភាពផ្ទុកព័ត៌មានថ្មីក្នុងកម្រិតកំណត់គឺចន្លោះពី ៥ ទៅ ៩ ឯកតាប៉ុណ្ណោះ។"
      },
      {
        number: 5,
        difficulty: "ងាយ (Easy)",
        difficultyLevel: "easy",
        question: "តើអ្វីជាតួនាទីចម្បងនៃ «អង្គចងចាំរយៈពេលវែង» (Long-Term Memory)?",
        options: {
          A: "រក្សាទុកចំណេះដឹង ជំនាញ និងបទពិសោធន៍ទុកប្រើប្រាស់ក្នុងរយៈពេលយូរ ឬអចិន្ត្រៃយ៍",
          B: "កត់ត្រាព័ត៌មានបណ្ដោះអាសន្នត្រឹមតែ ៥ វិនាទី",
          C: "ដំណើរការតែនៅពេលមនុស្សកំពុងដេកលក់ប៉ុណ្ណោះ",
          D: "ផ្ទុកតែលេខទូរស័ព្ទដោយមិនផ្ទុកចំណេះដឹងទូទៅ"
        },
        correctAnswer: "A",
        explanation: "Long-Term Memory គឺជាឃ្លាំងស្តុកចំណេះដឹងដ៏ធំធេង និងមានថិរវេលារក្សាទុកយូរអង្វែង សម្រាប់ទាញយកមកប្រើប្រាស់នៅពេលត្រូវការ។"
      },
      {
        number: 6,
        difficulty: "ងាយ (Easy)",
        difficultyLevel: "easy",
        question: "នៅពេលសិស្សស្តាប់ឮគ្រូពន្យល់ភ្លាមៗ តែភ្លេចបាត់ក្នុងរយៈពេលកន្លះនាទីក្រោយមក តើបាតុភូតនេះកើតឡើងនៅដំណាក់កាលណា?",
        options: {
          A: "នៅដំណាក់កាល Short-Term / Working Memory ដែលមិនទាន់បានឆ្លងកាត់ការ Rehearsal",
          B: "នៅដំណាក់កាល Long-Term Memory បាត់បង់ជារៀងរហូត",
          C: "ជាជំងឺភ្លេចភ្លាំងធ្ងន់ធ្ងរមិនអាចព្យាបាលបាន",
          D: "ជាការចងចាំស្វ័យប្រវត្តិកម្រិតខ្ពស់"
        },
        correctAnswer: "A",
        explanation: "ព័ត៌មានក្នុង Working Memory ប្រសិនបើមិនត្រូវបានរំលឹកឡើងវិញ (Rehearsal) ឬកត់ត្រាទុកទេ វានឹងរលាយបាត់ក្នុងរង្វង់ ១៥-៣០ វិនាទី។"
      },
      // 3 MEDIUM QUESTIONS (Q7 - Q9) - 30%
      {
        number: 7,
        difficulty: "មធ្យម (Medium)",
        difficultyLevel: "medium",
        question: "ដើម្បីផ្ទេរព័ត៌មានពី Working Memory ទៅរក្សាទុកក្នុង Long-Term Memory តើត្រូវឆ្លងកាត់ដំណើរការគន្លឹះណា?",
        options: {
          A: "ដំណើរការកូដទុក (Encoding) តាមរយៈការផ្សារភ្ជាប់ន័យ និងការអនុវត្តរំលឹក (Rehearsal)",
          B: "ការបិទភ្នែកមិនមើលមេរៀន",
          C: "ការរង់ចាំឱ្យចំណេះដឹងជ្រាបចូលដោយឯកឯង",
          D: "ការអានត្រឹមតែមួយភ្លែតដោយមិនគិតពិចារណា"
        },
        correctAnswer: "A",
        explanation: "Encoding គឺជាដំណើរការបំប្លែងព័ត៌មាន និងផ្សារភ្ជាប់ជាមួយ Schema ដែលមានស្រាប់ ដើម្បីរក្សាទុកក្នុង Long-Term Memory បានយ៉ាងរឹងមាំ។"
      },
      {
        number: 8,
        difficulty: "មធ្យម (Medium)",
        difficultyLevel: "medium",
        question: "តើបច្ចេកទេស «ការបំបែកជាដុំៗ» (Chunking) ជួយសម្រួលដល់ការទទួលបានព័ត៌មានយ៉ាងដូចម្តេច?",
        options: {
          A: "ជួយរៀបចំព័ត៌មានដាច់ៗពីគ្នាឱ្យទៅជាបណ្តុំមានន័យ កាត់បន្ថយបន្ទុក Working Memory",
          B: "ជួយលុបបំបាត់ព័ត៌មានស្មុគស្មាញចោលទាំងអស់",
          C: "តម្រូវឱ្យទន្ទេញលេខម្តងមួយខ្ទង់ដាច់ដោយឡែក",
          D: "មិនមានផលប្រយោជន៍ដល់ការចងចាំឡើយ"
        },
        correctAnswer: "A",
        explanation: "Chunking ជួយច្របាច់ព័ត៌មានជាច្រើនឱ្យក្លាយជាក្រុមតូចៗ (ឧ. លេខទូរស័ព្ទ 012-345-678) ធ្វើឱ្យខួរក្បាលងាយកត់ចំណាំដោយមិនលើសចំណុះ 7±2។"
      },
      {
        number: 9,
        difficulty: "មធ្យម (Medium)",
        difficultyLevel: "medium",
        question: "យោងតាមទ្រឹស្តី Cognitive Load តើសភាព «លើសបន្ទុកនៃការយល់ដឹង» (Cognitive Overload) បង្កផលប៉ះពាល់អ្វីដល់សិស្ស?",
        options: {
          A: "ធ្វើឱ្យ Working Memory ជាប់គាំង មិនអាចដំណើរការ ឬយល់ខ្លឹមសារមេរៀនថ្មីបាន",
          B: "ជួយឱ្យសិស្សរៀនបានលឿនជាងមុនទ្វេដង",
          C: "ជួយបង្កើនទំហំផ្ទុកនៃ Long-Term Memory ដោយស្វ័យប្រវត្តិ",
          D: "មិនមានផលប៉ះពាល់អ្វីដល់ដំណើរការរៀនសូត្រឡើយ"
        },
        correctAnswer: "A",
        explanation: "នៅពេលព័ត៌មានហូរចូលច្រើនលើសសមត្ថភាពនៃ Working Memory សិស្សនឹងមានអារម្មណ៍ច្របូកច្របល់ និងបាត់បង់លទ្ធភាពយល់ដឹង។"
      },
      // 1 HARD QUESTION (Q10) - 10%
      {
        number: 10,
        difficulty: "ពិបាក (Hard)",
        difficultyLevel: "hard",
        question: "[ការវិភាគគរុកោសល្យ] សិស្សម្នាក់អាចមើលស្លាយបង្រៀនរបស់គ្រូ ប៉ុន្តែពេលសួរនាំ គាត់មិនអាចរំលឹកខ្លឹមសារសំខាន់ៗបានឡើយ។ តើការបរាជ័យនេះបណ្តាលមកពីកត្តាស្នូលណា ហើយគ្រូគួរដោះស្រាយយ៉ាងដូចម្តេច?",
        options: {
          A: "បរាជ័យត្រង់ Selective Attention និង Encoding (មើលដោយអសកម្ម) -> គ្រូគួរប្រើសំណួរដាស់គំនិត និងឱ្យសិស្សកត់ត្រាសង្ខេប",
          B: "សិស្សខ្វះសមត្ថភាពខួរក្បាលតាំងពីកំណើត មិនអាចកែលម្អបាន",
          C: "គ្រូគួរបង្កើនចំនួនអក្សរលើស្លាយឱ្យកាន់តែច្រើនថែមទៀត",
          D: "គ្រូគួរបញ្ឈប់ការបង្រៀន និងឱ្យសិស្សរៀនដោយខ្លួនឯង"
        },
        correctAnswer: "A",
        explanation: "ការមើលឃើញ (Sensory) ដោយគ្មានការយកចិត្តទុកដាក់ និងការកូដទុក (Elaborative Encoding) មិនអាចបង្កើតជាការយល់ដឹងបានឡើយ។ គ្រូត្រូវរៀបចំសកម្មភាព Active Learning ដើម្បីជួយជំរុញដំណើរការនេះ។"
      }
    ];
    let result = [...psychList];
    if (count === 5) {
      result = [psychList[0], psychList[1], psychList[3], psychList[6], psychList[9]];
    } else if (count <= psychList.length) {
      result = psychList.slice(0, count);
    } else {
      while (result.length < count) {
        const base = psychList[result.length % psychList.length];
        const copy = JSON.parse(JSON.stringify(base));
        copy.question = `[អនុវត្តបន្ថែម] ` + copy.question;
        result.push(copy);
      }
    }
    result.forEach((q, idx) => { q.number = idx + 1; });
    return randomizeQuizList(result);
  }

  // General Subject Bank (Strict 60% Easy, 30% Medium, 10% Hard)
  const p1 = mainPoints[0] || `និយមន័យ និងគោលការណ៍គ្រឹះនៃ ${cleanTitle}`;
  const p2 = mainPoints[1] || `លក្ខណៈសម្គាល់ និងរូបមន្តគន្លឹះក្នុង ${subject}`;
  const p3 = mainPoints[2] || `ការអនុវត្ត និងទំនាក់ទំនងបាតុភូតជាក់ស្តែង`;
  const p4 = mainPoints[3] || `ក្បួនដោះស្រាយបញ្ហា និងការគណនា`;

  const rawList = [
    // 6 EASY QUESTIONS (Q1 - Q6) - 60%
    {
      number: 1,
      difficulty: "ងាយ (Easy)",
      difficultyLevel: "easy",
      question: `តើអ្វីជាគោលគំនិតចម្បង ឬនិយមន័យគ្រឹះនៃ «${cleanTitle}» ក្នុងមុខវិជ្ជា ${subject}?`,
      options: {
        A: `ជាដំណើរការ ឬគោលការណ៍ដែលផ្សារភ្ជាប់ទៅនឹង ${p1}`,
        B: `ជាបាតុភូតដែលមិនទាក់ទងនឹង ${subject} ឡើយ`,
        C: `ជាទ្រឹស្តីដែលប្រើប្រាស់តែក្នុងមន្ទីរពិសោធន៍ដាច់ដោយឡែក`,
        D: `ជាច្បាប់ដែលមិនមានការប្រែប្រួល និងគ្មានការអនុវត្ត`
      },
      correctAnswer: "A",
      explanation: `និយមន័យស្នូល និងចំណេះដឹងត្រៀមជាមុននៃ ${cleanTitle} គឺសំដៅលើ ${p1}។`
    },
    {
      number: 2,
      difficulty: "ងាយ (Easy)",
      difficultyLevel: "easy",
      question: `ក្នុងចំណោមជម្រើសខាងក្រោម តើមួយណាជាលក្ខណៈសម្គាល់គ្រឹះនៃ «${cleanTitle}»?`,
      options: {
        A: `${p2}`,
        B: `កត្តាអសកម្មដែលគ្មានចលនា និងគ្មានទំនាក់ទំនង`,
        C: `ការមិនអើពើចំពោះទ្រឹស្តីមូលដ្ឋាន`,
        D: `ការបំផ្លាញទិន្នន័យចាស់ៗចោលទាំងស្រុង`
      },
      correctAnswer: "A",
      explanation: `ចំណុចសម្គាល់ស្នូលដែលសិស្សត្រូវចងចាំមុនពេលចូលរៀនគឺ ${p2}។`
    },
    {
      number: 3,
      difficulty: "ងាយ (Easy)",
      difficultyLevel: "easy",
      question: `តើពាក្យគន្លឹះ ឬឯកតារង្វាស់/សញ្ញាសម្គាល់ណាដែលផ្សារភ្ជាប់ជិតស្និទ្ធបំផុតជាមួយ «${cleanTitle}»?`,
      options: {
        A: `លក្ខណៈគ្រឹះស្របតាម ${p1}`,
        B: `សញ្ញាសម្គាល់ដែលផ្ទុយនឹងវិទ្យាសាស្ត្រ`,
        C: `ធាតុដែលមិនមានតម្លៃក្នុងការគណនា`,
        D: `កត្តាចៃដន្យដែលគ្មានមូលដ្ឋានច្បាស់លាស់`
      },
      correctAnswer: "A",
      explanation: `ការចងចាំពាក្យគន្លឹះ និងឯកតារង្វាស់ត្រឹមត្រូវជាមូលដ្ឋានគ្រឹះនៃមុខវិជ្ជា។`
    },
    {
      number: 4,
      difficulty: "ងាយ (Easy)",
      difficultyLevel: "easy",
      question: `នៅពេលចាប់ផ្តើមសិក្សាអំពី «${cleanTitle}» តើចំណេះដឹងមុន (Prerequisite) ណាដែលសិស្សត្រូវមានជាចាំបាច់?`,
      options: {
        A: `ការយល់ដឹងពីគោលការណ៍គ្រឹះ និងបម្រាប់ទូទៅនៃ ${subject}`,
        B: `ការទន្ទេញរូបមន្តកម្រិតខ្ពស់ដោយមិនបាច់យល់ន័យ`,
        C: `ការរំលងទ្រឹស្តីគ្រឹះចូលទៅអនុវត្តលំហាត់ស្មុគស្មាញភ្លាម`,
        D: `ការសិក្សាដោយមិនចាំបាច់មានចំណេះដឹងត្រៀមជាមុន`
      },
      correctAnswer: "A",
      explanation: `ចំណេះដឹងត្រៀមជាមុនជួយភ្ជាប់ស្ពានទៅរកការយល់ដឹងមេរៀនថ្មីបានយ៉ាងរលូន។`
    },
    {
      number: 5,
      difficulty: "ងាយ (Easy)",
      difficultyLevel: "easy",
      question: `តើប្រភព ឬឧទាហរណ៍សាមញ្ញបំផុតក្នុងជីវភាពណាដែលឆ្លុះបញ្ចាំងពីគោលការណ៍នៃ «${cleanTitle}»?`,
      options: {
        A: `បាតុភូត ឬសកម្មភាពប្រចាំថ្ងៃដែលទាក់ទងនឹង ${p3}`,
        B: `ករណីដែលផ្ទុយនឹងច្បាប់ធម្មជាតិទាំងស្រុង`,
        C: `ព្រឹត្តិការណ៍ដែលមិនអាចពន្យល់បានតាមវិទ្យាសាស្ត្រ`,
        D: `ស្ថានភាពដែលគ្មានទិន្នន័យជាក់លាក់`
      },
      correctAnswer: "A",
      explanation: `ឧទាហរណ៍សាមញ្ញក្នុងជីវភាពប្រចាំថ្ងៃជួយឱ្យសិស្សមើលឃើញរូបភាពច្បាស់នៃមេរៀន។`
    },
    {
      number: 6,
      difficulty: "ងាយ (Easy)",
      difficultyLevel: "easy",
      question: `តើគោលបំណងចម្បងនៃការរៀន «${cleanTitle}» ក្នុងកម្រិតថ្នាក់នេះ គឺដើម្បីអ្វី?`,
      options: {
        A: `កសាងមូលដ្ឋានគ្រឹះក្នុងការយល់ដឹង និងដោះស្រាយបញ្ហាស្របតាម ${p1}`,
        B: `ការរៀនទន្ទេញដើម្បីតែប្រឡងមួយគ្រា`,
        C: `ការផ្តោតតែលើការចងចាំពាក្យដោយមិនយល់ន័យ`,
        D: `ការកាត់បន្ថយពេលវេលាសិក្សាដោយមិនគិតវិភាគ`
      },
      correctAnswer: "A",
      explanation: `គោលបំណងគរុកោសល្យគឺដើម្បីកសាងសមត្ថភាពគ្រឹះសម្រាប់បន្តទៅកម្រិតខ្ពស់។`
    },

    // 3 MEDIUM QUESTIONS (Q7 - Q9) - 30%
    {
      number: 7,
      difficulty: "មធ្យម (Medium)",
      difficultyLevel: "medium",
      question: `នៅពេលពិនិត្យមើលយន្តការ ឬដំណើរការនៃ «${cleanTitle}» តើដំណាក់កាលប្រព្រឹត្តទៅតាមលំដាប់លំដោយយ៉ាងដូចម្តេច?`,
      options: {
        A: `ចាប់ផ្តើមពីការកំណត់ទិន្នន័យ បន្តទៅ ${p1} រួចបង្កើតជាលទ្ធផលស្របតាម ${p3}`,
        B: `កើតឡើងដោយចៃដន្យគ្មានលំដាប់លំដោយ`,
        C: `បញ្ចប់មុនពេលចាប់ផ្តើមដំណើរការ`,
        D: `ដំណើរការតែនៅពេលគ្មានថាមពលប៉ុណ្ណោះ`
      },
      correctAnswer: "A",
      explanation: `ការយល់ដឹងពីលំដាប់លំដោយនៃដំណើរការជាស្នូលនៃការអនុវត្ត។`
    },
    {
      number: 8,
      difficulty: "មធ្យម (Medium)",
      difficultyLevel: "medium",
      question: `ប្រសិនបើមានការប្រែប្រួលកត្តា ឬលក្ខខណ្ឌមួយក្នុង ${subject} តើ ${cleanTitle} នឹងរងឥទ្ធិពលយ៉ាងដូចម្តេច?`,
      options: {
        A: `ល្បឿន ឬលទ្ធផលនឹងប្រែប្រួលអាស្រ័យលើទំនាក់ទំនងនៃ ${p3}`,
        B: `គ្មានការប្រែប្រួលអ្វីទាំងអស់ទោះបីលក្ខខណ្ឌផ្លាស់ប្តូរក៏ដោយ`,
        C: `ដំណើរការទាំងមូលត្រូវខូចខាតជាអចិន្ត្រៃយ៍`,
        D: `ប្រែប្រួលដោយគ្មានច្បាប់ទម្លាប់វិទ្យាសាស្ត្រ`
      },
      correctAnswer: "A",
      explanation: `ការប្រែប្រួលនៃកត្តាខាងក្រៅជះឥទ្ធិពលផ្ទាល់ទៅលើលទ្ធផលតាមក្បួនវិទ្យាសាស្ត្រ។`
    },
    {
      number: 9,
      difficulty: "មធ្យម (Medium)",
      difficultyLevel: "medium",
      question: `តើការអនុវត្តរូបមន្ត ឬទ្រឹស្តីនៃ «${cleanTitle}» ក្នុងស្ថានភាពជាក់ស្តែង តម្រូវឱ្យចាប់ផ្តើមពីជំហានណា?`,
      options: {
        A: `កំណត់បម្រាប់ និងទិន្នន័យ -> ជ្រើសរើសគោលការណ៍ស្រប (${p4}) -> គណនា និងផ្ទៀងផ្ទាត់`,
        B: `ទាយចម្លើយភ្លាមៗដោយមិនបាច់វិភាគបម្រាប់`,
        C: `ជំនួសលេខដោយមិនបាច់ប្តូរខ្នាតឱ្យត្រូវស្តង់ដារ`,
        D: `ប្រើប្រាស់រូបមន្តណាក៏បានដោយគ្មានលក្ខខណ្ឌ`
      },
      correctAnswer: "A",
      explanation: `ក្បួនដោះស្រាយបញ្ហាត្រឹមត្រូវតម្រូវឱ្យវិភាគទិន្នន័យ ប្រើរូបមន្តត្រូវ និងផ្ទៀងផ្ទាត់លទ្ធផល។`
    },

    // 1 HARD QUESTION (Q10) - 10%
    {
      number: 10,
      difficulty: "ពិបាក (Hard)",
      difficultyLevel: "hard",
      question: `[ការវិភាគ និងការត្រិះរិះ] ឧបមាថាមានភាពមិនស៊ីសង្វាក់គ្នាក្នុងការដោះស្រាយបញ្ហានៃ «${cleanTitle}»។ តើអ្នកគួរវិភាគរកឫសគល់នៃបញ្ហាតាមបែបវិទ្យាសាស្ត្រយ៉ាងដូចម្តេច?`,
      options: {
        A: `កំណត់អថេរមិនប្រក្រតី -> ផ្ទៀងផ្ទាត់ជាមួយគោលការណ៍គ្រឹះ ${p1} & ${p4} -> កែសម្រួលប៉ារ៉ាម៉ែត្រដើម្បីស្តារភាពត្រឹមត្រូវ`,
        B: `បោះបង់ការដោះស្រាយ និងសន្និដ្ឋានថាទ្រឹស្តីមិនពិត`,
        C: `ផ្លាស់ប្តូរទិន្នន័យតាមចិត្តដើម្បីឱ្យស្របនឹងការគិតផ្ទាល់ខ្លួន`,
        D: `មិនអើពើចំពោះចំណុចខុសឆ្គងនោះឡើយ`
      },
      correctAnswer: "A",
      explanation: `ការត្រិះរិះពិចារណាកម្រិតខ្ពស់តម្រូវឱ្យវិភាគរកឫសគល់នៃកំហុស និងកែតម្រូវតាមក្បួនវិធីសាស្ត្រវិទ្យាសាស្ត្រ។`
    }
  ];
  let result = [...rawList];
  if (count === 5) {
    result = [rawList[0], rawList[1], rawList[2], rawList[6], rawList[9]];
  } else if (count <= rawList.length) {
    result = rawList.slice(0, count);
  } else {
    while (result.length < count) {
      const base = rawList[result.length % rawList.length];
      const copy = JSON.parse(JSON.stringify(base));
      copy.question = `[អនុវត្តបន្ថែម] ` + copy.question;
      result.push(copy);
    }
  }
  result.forEach((q, idx) => { q.number = idx + 1; });
  return randomizeQuizList(result);
}

// Generate Post-Test MCQ Questions following strict 20% - 60% - 20% MoEYS Bloom Standard
function generatePostTestMCQOffline(subject, grade, lessonTitle, mainPoints = [], count = 10) {
  const cleanTitle = (lessonTitle || "មេរៀន").trim();
  const subj = (subject || "").toLowerCase();
  const isPsychOrInfo = subj.includes('ចិត្តវិទ្យា') || cleanTitle.includes('ព័ត៌មាន') || cleanTitle.includes('ចងចាំ') || subj.includes('psychology');

  if (isPsychOrInfo) {
    const psychPostList = [
      // 2 EASY QUESTIONS (Q1, Q2) - 20%
      {
        number: 1,
        bloom: "Remember & Understand",
        difficulty: "ងាយ (Easy)",
        difficultyLevel: "easy",
        question: "តើយន្តការនៃការទទួលបាន និងដំណើរការព័ត៌មាន (Information Processing Model) ចែកចេញជាប៉ុន្មានដំណាក់កាលស្នូល?",
        options: {
          A: "៣ ដំណាក់កាលស្នូល៖ Sensory Register -> Working Memory -> Long-Term Memory",
          B: "ត្រឹមតែ ១ ដំណាក់កាលគត់ គឺការទន្ទេញចាំមាត់",
          C: "២ ដំណាក់កាល គឺការស្តាប់ឮ និងការភ្លេច",
          D: "៥ ដំណាក់កាលដោយគ្មានទំនាក់ទំនងគ្នា"
        },
        correctAnswer: "A",
        explanation: "គំរូ Atkinson-Shiffrin បញ្ជាក់យ៉ាងច្បាស់ពីដំណាក់កាលទាំងបីនៃការដំណើរការព័ត៌មានក្នុងចិត្តវិទ្យាយល់ដឹង។"
      },
      {
        number: 2,
        bloom: "Remember & Understand",
        difficulty: "ងាយ (Easy)",
        difficultyLevel: "easy",
        question: "តើអ្វីជា «គ្រោងចំណេះដឹង» (Schema) ក្នុងអង្គចងចាំរយៈពេលវែង?",
        options: {
          A: "ជាបណ្តាញរៀបចំចំណេះដឹង និងគំនិតដែលទាក់ទងគ្នា ដែលជួយឱ្យមនុស្សយល់ពីពិភពជុំវិញខ្លួន",
          B: "ជាការចងចាំពាក្យមួយម៉ាត់ដាច់ដោយឡែក",
          C: "ជាកោសិកាខួរក្បាលដែលមិនដំណើរការ",
          D: "ជាអារម្មណ៍ភ័យខ្លាចពេលជួបបញ្ហា"
        },
        correctAnswer: "A",
        explanation: "Schema គឺជាគ្រោងគំនិត ឬប្រព័ន្ធរៀបចំព័ត៌មានក្នុងខួរក្បាល ដែលជួយឱ្យយើងបកស្រាយ និងបញ្ចូលព័ត៌មានថ្មីៗបានយ៉ាងឆាប់រហ័ស។"
      },
      // 6 MEDIUM QUESTIONS (Q3 - Q8) - 60%
      {
        number: 3,
        bloom: "Apply",
        difficulty: "មធ្យម (Medium)",
        difficultyLevel: "medium",
        question: "ក្នុងការបង្រៀនជាក់ស្តែង ដើម្បីទាក់ទាញ «ការយកចិត្តទុកដាក់ជ្រើសរើស» (Selective Attention) របស់សិស្ស តើគ្រូគួរអនុវត្តវិធីណាដែលល្អបំផុត?",
        options: {
          A: "ប្រើប្រាស់សំណួរចោទសួរដាស់គំនិត សម្ភារឧបទេសរូបភាពច្បាស់ និងការផ្លាស់ប្តូរកាយវិការបង្រៀន",
          B: "និយាយសំឡេងដដែលៗស្មើៗគ្នាតាំងពីដើមដល់ចប់ម៉ោង",
          C: "ដាក់ស្លាយដែលមានតែអក្សរតូចៗណែនពេញអេក្រង់",
          D: "ហាមសិស្សមិនឱ្យសួរនាំ ឬធ្វើសកម្មភាពអ្វីទាំងអស់"
        },
        correctAnswer: "A",
        explanation: "ការប្រែប្រួលរំញោច (Stimulus variation) និងការចោទសួរជួយទាញ Attention ពី Sensory Memory ចូលទៅ Working Memory បានយ៉ាងមានប្រសិទ្ធភាព។"
      },
      {
        number: 4,
        bloom: "Apply",
        difficulty: "មធ្យម (Medium)",
        difficultyLevel: "medium",
        question: "នៅពេលសិស្សកំពុងគិតដោះស្រាយលំហាត់គណិតវិទ្យា ឬវិភាគអត្ថបទ តើអង្គចងចាំណាដែលកំពុងបំពេញការងារសកម្មបំផុត?",
        options: {
          A: "Working Memory (អង្គចងចាំដំណើរការ / អង្គចងចាំរយៈពេលខ្លី)",
          B: "Sensory Register តែមួយមុខ",
          C: "មិនមានអង្គចងចាំណាដំណើរការឡើយ",
          D: "កាយវិញ្ញាណនៃការប៉ះពាល់"
        },
        correctAnswer: "A",
        explanation: "Working Memory គឺជាកន្លែងធ្វើការសកម្មនៃខួរក្បាល (Mental Workspace) សម្រាប់រក្សាទុក និងចាត់ចែងព័ត៌មានក្នុងពេលដំណាលគ្នា។"
      },
      {
        number: 5,
        bloom: "Analyze",
        difficulty: "មធ្យម (Medium)",
        difficultyLevel: "medium",
        question: "យោងតាមទ្រឹស្តីបន្ទុកនៃការយល់ដឹង (Cognitive Load Theory) តើគ្រូអាចកាត់បន្ថយ Extraneous Cognitive Load (បន្ទុកឥតប្រយោជន៍) យ៉ាងដូចម្តេច?",
        options: {
          A: "លុបបំបាត់ព័ត៌មានរំខានដែលមិនទាក់ទងនឹងមេរៀន និងបង្ហាញខ្លឹមសារតាមលំដាប់លំដោយសាមញ្ញទៅស្មុគស្មាញ",
          B: "ចាក់ភ្លេងឮខ្លាំងៗក្នុងពេលពន្យល់មេរៀនស្មុគស្មាញ",
          C: "ដាក់លំហាត់ពិបាកបំផុតតាំងពីដើមម៉ោងរៀន",
          D: "ឱ្យសិស្សមើលអត្ថបទវែងអន្លាយដោយគ្មានការណែនាំ"
        },
        correctAnswer: "A",
        explanation: "ការរៀបចំមេរៀនច្បាស់លាស់ មិនមានកត្តារំខាន ជួយការពារកុំឱ្យ Working Memory ត្រូវចំណាយថាមពលលើរឿងឥតប្រយោជន៍។"
      },
      {
        number: 6,
        bloom: "Apply & Solve",
        difficulty: "មធ្យម (Medium)",
        difficultyLevel: "medium",
        question: "ហេតុអ្វីបានជាបច្ចេកទេស «ការអនុវត្តរំលឹកឡើងវិញ» (Retrieval Practice ដូចជាការធ្វើតេស្តសាកល្បង) មានប្រសិទ្ធភាពជាងការគ្រាន់តែអានសៀវភៅឡើងវិញ?",
        options: {
          A: "ជួយពង្រឹងផ្លូវប្រសាទ (Neural Pathways) ក្នុងការទាញយកព័ត៌មានពី Long-Term Memory និងធ្វើឱ្យការចងចាំរឹងមាំ",
          B: "ជួយឱ្យសិស្សចំណាយពេលតិចជាងមុនដោយមិនបាច់គិត",
          C: "ធ្វើឱ្យសិស្សអាចទន្ទេញដោយមិនបាច់យល់",
          D: "មិនមានភាពខុសគ្នារវាងវិធីទាំងពីរឡើយ"
        },
        correctAnswer: "A",
        explanation: "Retrieval Practice បង្កើត Testing Effect ដែលទាមទារឱ្យខួរក្បាលប្រឹងប្រែងទាញព័ត៌មានមកប្រើ ធ្វើឱ្យដាននៃការចងចាំរឹងមាំយូរអង្វែង។"
      },
      {
        number: 7,
        bloom: "Analyze",
        difficulty: "មធ្យម (Medium)",
        difficultyLevel: "medium",
        question: "ក្នុងចំណោមវិធីសាស្ត្រខាងក្រោម តើវិធីណាដែលជួយដល់ដំណើរការ Encoding ក្នុងកម្រិតស៊ីជម្រៅ (Deep Processing)?",
        options: {
          A: "Elaborative Rehearsal (ការភ្ជាប់ចំណេះដឹងថ្មីទៅនឹងឧទាហរណ៍ជាក់ស្តែង និងការពន្យល់ជាពាក្យសម្តីផ្ទាល់ខ្លួន)",
          B: "Maintenance Rehearsal (ការទន្ទេញពាក្យដដែលៗដោយគ្មានការគិត)",
          C: "ការចម្លងអត្ថបទតាមសៀវភៅពុម្ពពាក្យមួយទៅពាក្យមួយ",
          D: "ការទន្ទេញតែមួយយប់មុនពេលប្រឡង"
        },
        correctAnswer: "A",
        explanation: "Deep Processing ទាមទារឱ្យមានការវិភាគន័យ (Semantic Analysis) និងការផ្សារភ្ជាប់ ដែលនាំឱ្យព័ត៌មានស្ថិតស្ថេរក្នុង Long-Term Memory។"
      },
      {
        number: 8,
        bloom: "Apply",
        difficulty: "មធ្យម (Medium)",
        difficultyLevel: "medium",
        question: "ប្រសិនបើសិស្សម្នាក់ចងចាំនិយមន័យបានល្អ ប៉ុន្តែមិនចេះយកទៅអនុវត្តដោះស្រាយបញ្ហាក្នុងថ្នាក់រៀន តើមានន័យថាសិស្សខ្វះអ្វី?",
        options: {
          A: "ខ្វះចំណេះដឹងនីតិវិធី (Procedural Knowledge) និងសមត្ថភាពផ្ទេរចំណេះដឹង (Transfer of Learning)",
          B: "ខ្វះសមត្ថភាពស្តាប់ឮ",
          C: "ខ្វះអង្គចងចាំរយៈពេលខ្លី",
          D: "មានអង្គចងចាំ Sensory ខូចខាត"
        },
        correctAnswer: "A",
        explanation: "ការចងចាំត្រឹមតែ Declarative Knowledge (និយមន័យ) មិនទាន់គ្រប់គ្រាន់ទេ សិស្សត្រូវមានការហ្វឹកហាត់លើ Procedural Knowledge ដើម្បីចេះអនុវត្ត។"
      },
      // 2 HARD QUESTIONS (Q9, Q10) - 20%
      {
        number: 9,
        bloom: "Evaluate",
        difficulty: "ពិបាក (Hard)",
        difficultyLevel: "hard",
        question: "[ករណីសិក្សាគរុកោសល្យ] សិស្សក្នុងថ្នាក់រៀនមួយជួបបញ្ហាភ្លេចមេរៀនស្ទើរតែទាំងស្រុងក្រោយពេលរៀនចប់មួយសប្តាហ៍ (Ebbinghaus Forgetting Curve)។ ផ្អែកលើយន្តការនៃការទទួលបានព័ត៌មាន តើគ្រូគួររៀបចំយុទ្ធសាស្ត្រគរុកោសល្យបែបណាដើម្បីដោះស្រាយ?",
        options: {
          A: "រៀបចំ Spaced Repetition (ការរំលឹកឡើងវិញតាមចន្លោះពេលកំណត់) រួមជាមួយការធ្វើតេស្តរង្វាយតម្លៃខ្លីៗជាប្រចាំ",
          B: "ស្តីបន្ទោសសិស្ស និងបង្ខំឱ្យសិស្សចម្លងមេរៀនដដែលៗ ១០០ ដង",
          C: "បង្រៀនមេរៀនថ្មីបន្តទៀតដោយមិនបាច់ខ្វល់ពីមេរៀនចាស់",
          D: "លុបចោលការធ្វើតេស្តទាំងអស់ក្នុងថ្នាក់"
        },
        correctAnswer: "A",
        explanation: "Spaced Repetition (ការរំលឹកខណ្ឌពេល) គឺជាយុទ្ធសាស្ត្រផ្អែកលើវិទ្យាសាស្ត្រខួរក្បាល ដែលអាចបំបែកខ្សែកោងនៃការភ្លេច (Forgetting Curve) បានយ៉ាងជោគជ័យ។"
      },
      {
        number: 10,
        bloom: "Create & Synthesize",
        difficulty: "ពិបាក (Hard)",
        difficultyLevel: "hard",
        question: "[ការសំយោគ និងការវាយតម្លៃ] តើគ្រូបង្រៀនអាចរៀបចំកិច្ចតែងការបង្រៀនតាមបែបថ្នាក់រៀនត្រឡប់ (Flipped Learning) យ៉ាងដូចម្តេច ដើម្បីគាំទ្រដល់យន្តការទទួលបានព័ត៌មានរបស់សិស្សឱ្យឈានដល់កម្រិត Higher-Order Thinking?",
        options: {
          A: "ឱ្យសិស្សទទួលព័ត៌មានគ្រឹះនៅផ្ទះតាមវីដេអូខ្លី (កាត់បន្ថយបន្ទុកក្នុងថ្នាក់) រួចប្រើម៉ោងក្នុងថ្នាក់សម្រាប់ការវិភាគ ដោះស្រាយបញ្ហា និងកសាង Schema ជាក់ស្តែង",
          B: "ឱ្យសិស្សធ្វើលំហាត់ស្មុគស្មាញនៅផ្ទះម្នាក់ឯងដោយគ្មានការណែនាំ",
          C: "បង្រៀនមេរៀនដដែលពីរដងដោយគ្មានសកម្មភាពក្រុម",
          D: "លុបបំបាត់ការរៀននៅផ្ទះ និងបង្រៀនតែទ្រឹស្តីក្នុងថ្នាក់"
        },
        correctAnswer: "A",
        explanation: "Flipped Learning បង្វែរការទទួលព័ត៌មានដំបូង (Lower Bloom) ទៅផ្ទះតាមល្បឿនផ្ទាល់ខ្លួនរបស់សិស្ស និងទុកពេលក្នុងថ្នាក់សម្រាប់សកម្មភាពកម្រិតខ្ពស់ (Higher Bloom) ជាមួយគ្រូ។"
      }
    ];
    let result = [...psychPostList];
    if (count === 5) {
      result = [psychPostList[0], psychPostList[2], psychPostList[3], psychPostList[5], psychPostList[8]];
    } else if (count <= psychPostList.length) {
      result = psychPostList.slice(0, count);
    } else {
      while (result.length < count) {
        const base = psychPostList[result.length % psychPostList.length];
        const copy = JSON.parse(JSON.stringify(base));
        copy.question = `[អនុវត្តបន្ថែម] ` + copy.question;
        result.push(copy);
      }
    }
    result.forEach((q, idx) => { q.number = idx + 1; });
    return randomizeQuizList(result);
  }

  // General Subject Bank (Strict 20% Easy, 60% Medium, 20% Hard)
  const p1 = mainPoints[0] || `ទ្រឹស្តី និងគោលការណ៍គ្រឹះនៃ ${cleanTitle}`;
  const p2 = mainPoints[1] || `វិធីសាស្ត្រគណនា និងការអនុវត្ត ${subject}`;
  const p3 = mainPoints[2] || `ការដោះស្រាយបញ្ហាក្នុងជីវភាពជាក់ស្តែង`;
  const p4 = mainPoints[3] || `ការវិភាគ និងការវាយតម្លៃកម្រិតខ្ពស់`;

  const rawPostList = [
    // 2 EASY (Q1, Q2) - 20%
    {
      number: 1,
      bloom: "Remember & Understand",
      difficulty: "ងាយ (Easy)",
      difficultyLevel: "easy",
      question: `តើគោលការណ៍ស្នូល ឬច្បាប់គ្រឹះនៃ «${cleanTitle}» ក្នុងមុខវិជ្ជា ${subject} ចែងអំពីអ្វីចម្បង?`,
      options: {
        A: `ជាគោលការណ៍គ្រឹះដែលកំណត់អំពី ${p1}`,
        B: `ជាបាតុភូតដែលកើតឡើងដោយចៃដន្យគ្មានច្បាប់ទម្លាប់`,
        C: `ជាទ្រឹស្តីដែលមិនអាចយកមកអនុវត្តជាក់ស្តែងបានឡើយ`,
        D: `ជាការសន្មតដែលគ្មានមូលដ្ឋានវិទ្យាសាស្ត្រ`
      },
      correctAnswer: "A",
      explanation: `គោលការណ៍គ្រឹះនៃ ${cleanTitle} គឺកំណត់យ៉ាងច្បាស់អំពី ${p1}។`
    },
    {
      number: 2,
      bloom: "Remember & Understand",
      difficulty: "ងាយ (Easy)",
      difficultyLevel: "easy",
      question: `ក្នុងចំណោមនិយមន័យខាងក្រោម តើមួយណាឆ្លុះបញ្ចាំងពីខ្លឹមសារដែលបានរៀនក្នុង «${cleanTitle}» ត្រឹមត្រូវបំផុត?`,
      options: {
        A: `និយមន័យដែលស្របតាមគោលការណ៍ ${p1}`,
        B: `ការយល់ច្រឡំដែលផ្ទុយនឹងការពិត`,
        C: `ការបកស្រាយដែលគ្មានទឡ្ហីករណ៍ច្បាស់លាស់`,
        D: `ការសន្មតដែលគ្មានការផ្ទៀងផ្ទាត់`
      },
      correctAnswer: "A",
      explanation: `និយមន័យត្រឹមត្រូវផ្អែកលើការយល់ដឹងស៊ីជម្រៅនៃខ្លឹមសារមេរៀន។`
    },

    // 6 MEDIUM (Q3 - Q8) - 60%
    {
      number: 3,
      bloom: "Apply",
      difficulty: "មធ្យម (Medium)",
      difficultyLevel: "medium",
      question: `នៅពេលអនុវត្តរូបមន្ត ឬក្បួនគន្លឹះនៃ «${cleanTitle}» ដើម្បីដោះស្រាយលំហាត់ជាក់ស្តែង តើត្រូវចាប់ផ្តើមពីចំណុចណា?`,
      options: {
        A: `កំណត់បម្រាប់ និងបំប្លែងខ្នាត -> ប្រើប្រាស់រូបមន្ត ${p2} -> គណនារកលទ្ធផល`,
        B: `ទាយចម្លើយភ្លាមៗដោយមិនបាច់ពិនិត្យបម្រាប់`,
        C: `ប្រើរូបមន្តណាក៏បានដោយមិនបាច់ផ្ទៀងផ្ទាត់លក្ខខណ្ឌ`,
        D: `សរសេរតែចម្លើយចុងក្រោយដោយគ្មានដំណោះស្រាយ`
      },
      correctAnswer: "A",
      explanation: `ការអនុវត្តត្រឹមត្រូវតម្រូវឱ្យវិភាគបម្រាប់ ប្រើរូបមន្តស្រប និងគណនាផ្ទៀងផ្ទាត់ខ្នាត។`
    },
    {
      number: 4,
      bloom: "Apply & Solve",
      difficulty: "មធ្យម (Medium)",
      difficultyLevel: "medium",
      question: `តើឧទាហរណ៍ជាក់ស្តែងមួយណាដែលឆ្លុះបញ្ចាំងពីការយក «${cleanTitle}» ទៅប្រើប្រាស់ក្នុងជីវភាព ឬបច្ចេកវិទ្យា?`,
      options: {
        A: `ការអនុវត្តជាក់ស្តែងស្របតាម ${p3} ដើម្បីបង្កើនប្រសិទ្ធភាពការងារ`,
        B: `ការប្រើប្រាស់ដែលផ្ទុយនឹងគោលការណ៍វិទ្យាសាស្ត្រ`,
        C: `ការបោះបង់បច្ចេកវិទ្យាទំនើបចោលទាំងស្រុង`,
        D: `ការអនុវត្តដែលបង្កឱ្យមានការខាតបង់ថាមពល`
      },
      correctAnswer: "A",
      explanation: `ការអនុវត្តជាក់ស្តែងនៃ ${cleanTitle} ជួយដោះស្រាយបញ្ហា និងបង្កើនប្រសិទ្ធភាពស្របតាម ${p3}។`
    },
    {
      number: 5,
      bloom: "Analyze",
      difficulty: "មធ្យម (Medium)",
      difficultyLevel: "medium",
      question: `នៅពេលធ្វើការវិភាគប្រៀបធៀបករណីសិក្សានៃ «${cleanTitle}» តើកត្តាស្នូលណាដែលកំណត់លទ្ធផល?`,
      options: {
        A: `ទំនាក់ទំនងរវាងអថេរ និងលក្ខខណ្ឌប្រតិបត្តិការស្របតាម ${p4}`,
        B: `ការកើនឡើងនៃកត្តាចៃដន្យដែលមិនអាចគ្រប់គ្រងបាន`,
        C: `ការមិនអើពើចំពោះបម្រែបម្រួលបរិស្ថានជុំវិញ`,
        D: `ការសន្និដ្ឋានដោយផ្អែកលើការស្មានសុទ្ធសាធ`
      },
      correctAnswer: "A",
      explanation: `ការវិភាគបែបស៊ីជម្រៅតម្រូវឱ្យពិនិត្យទំនាក់ទំនងរវាងអថេរ និងលក្ខខណ្ឌជាក់ស្តែង។`
    },
    {
      number: 6,
      bloom: "Apply",
      difficulty: "មធ្យម (Medium)",
      difficultyLevel: "medium",
      question: `ក្នុងការដោះស្រាយបញ្ហាជាក់ស្តែង តើជំហានណាដែលជួយបញ្ចៀសកំហុសឆ្គងបានល្អបំផុតក្នុង «${cleanTitle}»?`,
      options: {
        A: `ការផ្ទៀងផ្ទាត់លក្ខខណ្ឌព្រំដែន និងការត្រួតពិនិត្យភាពស៊ីសង្វាក់គ្នានៃ ${p2}`,
        B: `ការប្រញាប់សន្និដ្ឋានដោយមិនផ្ទៀងផ្ទាត់`,
        C: `ការកាត់បន្ថយជំហានគណនាឱ្យនៅខ្លីបំផុតដោយមិនបាច់គិត`,
        D: `ការជឿជាក់លើការទាយទុកជាមុនតែមួយមុខ`
      },
      correctAnswer: "A",
      explanation: `ការផ្ទៀងផ្ទាត់លក្ខខណ្ឌព្រំដែនជួយធានានូវភាពសុក្រឹតនៃការដោះស្រាយ។`
    },
    {
      number: 7,
      bloom: "Analyze",
      difficulty: "មធ្យម (Medium)",
      difficultyLevel: "medium",
      question: `ប្រសិនបើមានអថេរមួយកើនឡើងទ្វេដងក្នុងប្រព័ន្ធនៃ «${cleanTitle}» តើផលប៉ះពាល់លើលទ្ធផលចុងក្រោយនឹងទៅជាយ៉ាងណា?`,
      options: {
        A: `ប្រែប្រួលសមាមាត្រស្រប ឬច្រាសអាស្រ័យលើទំនាក់ទំនងសមីការនៃ ${p2}`,
        B: `នៅថេរដដែលគ្មានការប្រែប្រួល`,
        C: `ធ្លាក់ចុះដល់សូន្យភ្លាមៗ`,
        D: `ប្រែប្រួលដោយគ្មានទំនាក់ទំនងគណិតវិទ្យា`
      },
      correctAnswer: "A",
      explanation: `ការវិភាគទំនាក់ទំនងសមាមាត្រជាបំណិនស្នូលក្នុងការអនុវត្តវិទ្យាសាស្ត្រ។`
    },
    {
      number: 8,
      bloom: "Apply & Solve",
      difficulty: "មធ្យម (Medium)",
      difficultyLevel: "medium",
      question: `តើវិធីសាស្ត្រមួយណាដែលបង្ហាញពីការផ្ទេរចំណេះដឹង (Transfer of Learning) នៃ «${cleanTitle}» ទៅកាន់ស្ថានភាពថ្មី?`,
      options: {
        A: `ការយកគោលការណ៍ ${p3} ទៅសម្របសម្រួលដោះស្រាយបញ្ហាក្នុងបរិបទថ្មីដែលមិនធ្លាប់ជួបពីមុន`,
        B: `ការធ្វើតែលំហាត់ដដែលៗដែលធ្លាប់បានបង្រៀន`,
        C: `ការបដិសេធមិនដោះស្រាយបញ្ហាណាដែលខុសពីសៀវភៅពុម្ព`,
        D: `ការរង់ចាំឱ្យមានដំណោះស្រាយគំរូទើបធ្វើតាម`
      },
      correctAnswer: "A",
      explanation: `Transfer of Learning គឺជាសមត្ថភាពយកចំណេះដឹងដែលបានរៀនទៅអនុវត្តក្នុងបរិបទថ្មី។`
    },

    // 2 HARD (Q9, Q10) - 20%
    {
      number: 9,
      bloom: "Evaluate",
      difficulty: "ពិបាក (Hard)",
      difficultyLevel: "hard",
      question: `[ការវាយតម្លៃ និងការដោះស្រាយបញ្ហា] ប្រសិនបើជួបប្រទះស្ថានភាពស្មុគស្មាញ ឬភាពយល់ច្រឡំ (Misconception) លើ «${cleanTitle}» តើគួរវាយតម្លៃ និងកែលម្អយ៉ាងដូចម្តេច?`,
      options: {
        A: `បង្កើតស្ថានភាព Cognitive Conflict -> ផ្ទៀងផ្ទាត់លើទឡ្ហីករណ៍ជាក់ស្តែង -> កែសម្រួល Schema ឱ្យត្រូវតាម ${p1}`,
        B: `បដិសេធរាល់ការកែលម្អ និងរក្សាការយល់ខុសដដែល`,
        C: `ស្តីបន្ទោសអ្នករៀនដោយមិនផ្តល់ការពន្យល់`,
        D: `រំលងបញ្ហានោះចោលដោយមិនដោះស្រាយ`
      },
      correctAnswer: "A",
      explanation: `ការវាយតម្លៃកម្រិតខ្ពស់តម្រូវឱ្យវិភាគរកឫសគល់នៃកំហុស និងបង្កើតដំណោះស្រាយកែតម្រូវ Schema ឱ្យត្រឹមត្រូវ។`
    },
    {
      number: 10,
      bloom: "Create & Synthesize",
      difficulty: "ពិបាក (Hard)",
      difficultyLevel: "hard",
      question: `[ការសំយោគ និងការច្នៃប្រឌិត] តើអ្នកអាចសំយោគចំណេះដឹងនៃ «${cleanTitle}» ទៅបង្កើតជាដំណោះស្រាយ ឬគម្រោងនវានុវត្តន៍ជាក់ស្តែងដោយរបៀបណា?`,
      options: {
        A: `រួមបញ្ចូលគោលការណ៍ ${p1} និង ${p3} ដើម្បីរចនាគម្រោងដោះស្រាយបញ្ហាពិតក្នុងសហគមន៍ប្រកបដោយចីរភាព`,
        B: `ចម្លងស្នាដៃចាស់ៗរបស់អ្នកដទៃទាំងស្រុង`,
        C: `រៀបចំគម្រោងដែលគ្មានមូលដ្ឋានវិទ្យាសាស្ត្រគាំទ្រ`,
        D: `កំណត់គោលដៅដែលមិនអាចសម្រេចបានក្នុងភាពជាក់ស្តែង`
      },
      correctAnswer: "A",
      explanation: `កម្រិតខ្ពស់បំផុតនៃ Bloom គឺការសំយោគចំណេះដឹងពហុវិស័យទៅបង្កើតជានវានុវត្តន៍មានប្រយោជន៍។`
    }
  ];
  let result = [...rawPostList];
  if (count === 5) {
    result = [rawPostList[0], rawPostList[2], rawPostList[3], rawPostList[5], rawPostList[8]];
  } else if (count <= rawPostList.length) {
    result = rawPostList.slice(0, count);
  } else {
    while (result.length < count) {
      const base = rawPostList[result.length % rawPostList.length];
      const copy = JSON.parse(JSON.stringify(base));
      copy.question = `[អនុវត្តបន្ថែម] ` + copy.question;
      result.push(copy);
    }
  }
  result.forEach((q, idx) => { q.number = idx + 1; });
  return randomizeQuizList(result);
}

function generateActiveRubric(lessonTitle, subject) {
  return [
    {
      criterion: "១. ការសហការ និងការចូលរួមក្នុងក្រុម (Collaboration & Engagement)",
      levels: [
        "កម្រិត ១ (ត្រូវការកែលម្អ): អសកម្ម មិនសូវចូលរួមបញ្ចេញមតិ ឬធ្វើការតែម្នាក់ឯង។",
        "កម្រិត ២ (មធ្យម): ចូលរួមបំពេញកិច្ចការមួយចំនួន ប៉ុន្តែត្រូវការការរំលឹកជាប្រចាំ។",
        "កម្រិត ៣ (ល្អ): ចូលរួមយ៉ាងសកម្ម ស្តាប់មតិអ្នកដទៃ និងបំពេញតួនាទីបានល្អ។",
        "កម្រិត ៤ (ឆ្នើម): ដឹកនាំការពិភាក្សាលើកទឹកចិត្តសមាជិក និងជួយសម្របសម្រួលក្រុមបានល្អឥតខ្ចោះ។"
      ]
    },
    {
      criterion: "២. ការត្រិះរិះ និងដោះស្រាយបញ្ហា (Critical Thinking & Problem Solving)",
      levels: [
        "កម្រិត ១: ដោះស្រាយលំហាត់តាមលំនាំចាស់ មិនទាន់ចេះវិភាគឫសគល់បញ្ហា។",
        "កម្រិត ២: ចេះអនុវត្តរូបមន្តគ្រឹះ ប៉ុន្តែនៅជួបការលំបាកពេលជួបបញ្ហាស្មុគស្មាញ។",
        "កម្រិត ៣: វិភាគទិន្នន័យត្រឹមត្រូវ និងរកឃើញដំណោះស្រាយសមហេតុផល។",
        "កម្រិត ៤: បង្ហាញការវិភាគស៊ីជម្រៅ ច្នៃប្រឌិត និងរកឃើញដំណោះស្រាយពហុវិមាត្រ។"
      ]
    },
    {
      criterion: "៣. គុណភាពនៃស្នាដៃ/ដំណោះស្រាយ (Quality of Output)",
      levels: [
        "កម្រិត ១: ស្នាដៃមិនទាន់ពេញលេញ មានកំហុសច្រើនលើខ្លឹមសារស្នូល។",
        "កម្រិត ២: ស្នាដៃត្រឹមត្រូវកម្រិតមូលដ្ឋាន ប៉ុន្តែខ្វះរបៀបរៀបរយ និងភាពច្បាស់លាស់។",
        "កម្រិត ៣: ស្នាដៃត្រឹមត្រូវតាមស្តង់ដារ មានទឡ្ហីករណ៍ច្បាស់លាស់ និងស្អាតបាត។",
        "កម្រិត ៤: ស្នាដៃមានភាពសុក្រឹតឥតខ្ចោះ បង្ហាញការសំយោគកម្រិតខ្ពស់ និងទាក់ទាញខ្លាំង។"
      ]
    },
    {
      criterion: "៤. ការធ្វើបទបង្ហាញ និងការពារទឡ្ហីករណ៍ (Presentation & Defense)",
      levels: [
        "កម្រិត ១: ពិបាកបកស្រាយ មិនអាចឆ្លើយសំណួរដេញដោលរបស់មិត្តរួមថ្នាក់បាន។",
        "កម្រិត ២: បកស្រាយបានត្រឹមត្រូវមួយផ្នែក ប៉ុន្តែខ្វះភាពជឿជាក់ក្នុងការការពារគំនិត។",
        "កម្រិត ៣: ធ្វើបទបង្ហាញបានច្បាស់លាស់ សំឡេងឮច្បាស់ និងឆ្លើយសំណួរបានត្រឹមត្រូវ។",
        "កម្រិត ៤: ធ្វើបទបង្ហាញប្រកបដោយភាពជឿជាក់ខ្ពស់ ដេញដោលឆ្លើយតបបានយ៉ាងមុតស្រួច។"
      ]
    }
  ];
}

// Generate Differentiated Scaffolding Strategy
function generateDifferentiatedPlan(lessonTitle, subject) {
  return {
    scaffolding: {
      targetGroup: "ក្រុមសិស្សត្រូវការជំនួយ (ពិន្ទុ Pre-Test < 50%)",
      strategies: [
        `ផ្តល់សន្លឹកជំនួយគន្លឹះ (Formula & Step-by-Step Hint Cards) សម្រាប់មេរៀន «${lessonTitle}»`,
        `គ្រូដើរសម្របសម្រួលផ្ទាល់នៅតុក្រុម ចោទសួរសំណួរដាស់គំនិតជាជំហានៗ`,
        `ចាត់តាំងសិស្សពូកែក្នុងក្រុមធ្វើជា Peer Tutor ជួយពន្យល់បន្ថែម`
      ]
    },
    challenge: {
      targetGroup: "ក្រុមសិស្សពូកែ/រហ័ស (ពិន្ទុ Pre-Test ≥ 80%)",
      strategies: [
        `ផ្តល់បេសកកម្មស្រាវជ្រាវស៊ីជម្រៅ (Advanced Challenge Scenario) អំពីការអនុវត្ត «${lessonTitle}» ក្នុងសង្គមជាក់ស្តែង`,
        `ឱ្យបង្កើតសំណួរដេញដោល ឬវិភាគករណីសិក្សាប្រៀបធៀបកម្រិតខ្ពស់`,
        `ដើរតួជាអ្នកត្រួតពិនិត្យ និងផ្តល់មតិកែលម្អ (Peer Reviewers) ដល់ក្រុមផ្សេងៗ`
      ]
    }
  };
}

// Generate Exit Ticket 3-2-1
function generateExitTicket321(lessonTitle) {
  return {
    title: `សន្លឹកឆ្លុះបញ្ចាំង Exit Ticket 3-2-1: «${lessonTitle}»`,
    prompt3: "៣ ចំណុចដែលប្អូនបានយល់ដឹងច្បាស់បំផុតក្នុងម៉ោងរៀននេះ",
    prompt2: "២ ចំណុចដែលប្អូនយល់ថាគួរឱ្យចាប់អារម្មណ៍ និងចង់យកទៅអនុវត្ត",
    prompt1: "១ ចំណុចដែលប្អូននៅតែមានចម្ងល់ និងចង់ស្រាវជ្រាវបន្ថែម"
  };
}

// Format Khmer Date String
function getKhmerFormattedDate() {
  const khmerNums = ['០', '១', '២', '៣', '៤', '៥', '៦', '៧', '៨', '៩'];
  const now = new Date();
  const d = String(now.getDate()).split('').map(n => khmerNums[parseInt(n, 10)]).join('');
  const y = String(now.getFullYear()).split('').map(n => khmerNums[parseInt(n, 10)]).join('');
  const months = ['មករា', 'កុម្ភៈ', 'មីនា', 'មេសា', 'ឧសភា', 'មិថុនា', 'កក្កដា', 'សីហា', 'កញ្ញា', 'តុលា', 'វិច្ឆិកា', 'ធ្នូ'];
  const m = months[now.getMonth()];
  return `ថ្ងៃទី ${d} ខែ ${m} ឆ្នាំ ${y}`;
}

// 🎯 Render Comprehensive Teaching Method HTML (Harmonizing 5E, Active Learning & Flipped Learning Model)
function renderTeachingMethodContent(method) {
  const m = (method || '').trim();
  const is5E = m.toLowerCase().includes('5e') || m.includes('engage') || m.includes('explore');

  if (is5E) {
    return `
      <ul class="doc-list" style="margin-top: 4px; line-height: 1.8;">
        <li><strong>វិធីសាស្ត្របង្រៀនចម្បង៖</strong> វិធីសាស្ត្រ 5E (Engage, Explore, Explain, Elaborate, Evaluate)</li>
        <li><strong>គំរូ និងទម្រង់រៀបចំការរៀន៖</strong> ការរៀនបែបត្រឡប់ (Flipped Learning Model) — ផ្សារភ្ជាប់ការស្វ័យសិក្សាត្រៀមមុនម៉ោង (Pre-Class Phase តាមវីដេអូបង្រៀន Micro-Lecture NotebookLM និងបុរេតេស្ត Pre-Test QCM) ជាមួយការរៀនសកម្មក្នុងថ្នាក់ (In-Class Active Collaborative Learning)។</li>
        <li><strong>ការផ្សារភ្ជាប់ដំណាក់កាល 5E ជាមួយ Flipped Learning (៥ ដំណាក់កាលគរុកោសល្យ)៖</strong>
          <ul style="margin: 6px 0 4px 20px; list-style-type: circle; font-size: 9.5pt; line-height: 1.7;">
            <li><strong>១. Engage (ឈានចូល / បំផុសចំណាប់អារម្មណ៍)៖</strong> ស្វ័យសិក្សាតាមវីដេអូបង្រៀនមុនម៉ោង ឆ្លើយសំណួរ Pre-Test និងការស្រាយចម្ងល់ Muddiest Points នៅដើមម៉ោងរៀន</li>
            <li><strong>២. Explore (រុករក / ពិសោធន៍ / ស្រាវជ្រាវ)៖</strong> សិស្សធ្វើការជាក្រុម អនុវត្តការងាររុករក ដោះស្រាយលំហាត់ ឬពិសោធន៍ជាក់ស្តែងក្នុងថ្នាក់</li>
            <li><strong>៣. Explain (ពន្យល់ / បកស្រាយ)៖</strong> តំណាងក្រុមឡើងធ្វើបទបង្ហាញការពារលទ្ធផលរកឃើញ គ្រូសម្របសម្រួល និងបូកសរុបគោលការណ៍គន្លឹះ</li>
            <li><strong>៤. Elaborate (ពង្រីកចំណេះដឹង / អនុវត្តស៊ីជម្រៅ)៖</strong> អនុវត្តដោះស្រាយបញ្ហាក្នុងស្ថានភាពថ្មី ឬករណីសិក្សាស៊ីជម្រៅ (សកម្មភាពស្នូល ៧០% នៃម៉ោងរៀន)</li>
            <li><strong>៥. Evaluate (វាយតម្លៃលទ្ធផល)៖</strong> វាស់ស្ទង់សមត្ថភាពតាមរយៈកម្រងសំណួរ Post-Test MCQ, Active Rubric ៤ កម្រិត និងការឆ្លុះបញ្ចាំង Exit Ticket 3-2-1</li>
          </ul>
        </li>
      </ul>
    `;
  }

  if (m && !m.toLowerCase().startsWith('ថ្នាក់រៀនត្រឡប់')) {
    return `
      <ul class="doc-list" style="margin-top: 4px; line-height: 1.8;">
        <li><strong>វិធីសាស្ត្របង្រៀនចម្បង៖</strong> ${escapeHtml(m)}</li>
        <li><strong>គំរូ និងទម្រង់រៀបចំការរៀន៖</strong> ការរៀនបែបត្រឡប់ (Flipped Learning Model) — ផ្សារភ្ជាប់ការស្វ័យសិក្សាត្រៀមមុនម៉ោង (Pre-Class Phase តាមវីដេអូបង្រៀន Micro-Lecture NotebookLM និងបុរេតេស្ត) ជាមួយការរៀនសកម្មក្នុងថ្នាក់ (In-Class Active Learning)។</li>
        <li><strong>បច្ចេកទេសបង្រៀនគាំទ្រ (Active Learning Techniques)៖</strong> ការសហការជាក្រុម (Collaborative Learning), ការដោះស្រាយបញ្ហាជាក់ស្តែង (Problem-Solving), និងកិច្ចការស្ទាបស្ទង់យល់ដឹង (Exit Ticket & Muddiest Point)</li>
      </ul>
    `;
  }

  return `
    <ul class="doc-list" style="margin-top: 4px; line-height: 1.8;">
      <li><strong>គំរូ និងទម្រង់រៀបចំការរៀន៖</strong> ការរៀនបែបត្រឡប់ (Flipped Learning Model) ៥ ជំហាន (៥% - ១០% - ១០% - ៧០% - ៥%)</li>
      <li><strong>វិធីសាស្ត្របង្រៀនគន្លឹះ៖</strong> វិធីសាស្ត្រសិស្សមជ្ឈមណ្ឌល (Student-Centered Approach) គួបផ្សំការរៀនសហការជាក្រុម និងការដោះស្រាយបញ្ហាជាក់ស្តែង</li>
    </ul>
  `;
}

// Render Data to A4 Document Canvas

// ==========================================================================
// 🛡️ Bulletproof Data Normalizer & Quality Assurance Engine
// Guarantees 100% complete, non-empty objectives, materials, and 5 steps
// ==========================================================================
function normalizeLessonPlanData(data, params = {}) {
  if (!data || typeof data !== 'object') data = {};
  const isEn = (state.language === 'en' || params.language === 'en');
  
  const subject = data.subject || params.subject || (isEn ? 'General Subject' : 'មុខវិជ្ជាទូទៅ');
  const grade = data.grade || params.grade || (isEn ? 'Grade 10' : 'ថ្នាក់ទី ១០');
  const lessonTitle = data.lessonTitle || params.lessonTitle || (params.chapter ? params.chapter : (isEn ? 'Core Lesson Topic' : 'មេរៀនស្នូល'));
  const duration = data.duration || params.duration || (isEn ? '100 min (2 Sessions)' : '១០០ នាទី (២ ម៉ោងសិក្សា)');
  const school = data.school || params.school || (isEn ? 'Educational Institution' : 'សាលារៀនជំនាន់ថ្មី / គ្រឹះស្ថានសិក្សា');
  const teacher = data.teacher || params.teacher || (isEn ? 'Instructor' : 'លោកគ្រូ/អ្នកគ្រូ');
  const chapter = data.chapter || params.chapter || '';
  const method = data.method || params.method || (isEn ? 'Active Learning' : 'ការរៀនសកម្ម');
  const dateStr = data.dateStr || params.dateStr || (isEn ? 'Date: ..... / ..... / 202...' : 'ថ្ងៃទី..... ខែ......... ឆ្នាំ២០២...');

  data.subject = subject;
  data.grade = grade;
  data.lessonTitle = lessonTitle;
  data.duration = duration;
  data.school = school;
  data.teacher = teacher;
  data.chapter = chapter;
  data.method = method;
  data.dateStr = dateStr;

  const isFlipped = isFlippedLearningRequest(params) || data.templateType === 'flipped_learning' || (data.method && (data.method.includes('ត្រឡប់') || data.method.toLowerCase().includes('flipped')));
  const isBd = !isFlipped && (isBackwardDesignRequest(params) || data.templateType === 'backward_design' || Boolean(data.stage1));

  if (isFlipped) {
    data.templateType = 'flipped_learning';
    data.templateTitle = isEn ? 'FLIPPED LEARNING LESSON PLAN' : 'កិច្ចតែងការបង្រៀនតាមបែបថ្នាក់រៀនត្រឡប់';
  } else if (isBd) {
    data.templateType = 'backward_design';
    data.templateTitle = isEn ? 'BACKWARD DESIGN (UbD) LESSON PLAN' : 'កិច្ចតែងការបង្រៀន (តាមបែបត្រឡប់ - Backward Design / UbD)';
  } else {
    data.templateType = data.templateType || '5_steps';
    data.templateTitle = data.templateTitle || (isEn ? 'LESSON PLAN' : 'កិច្ចតែងការបង្រៀន');
  }

  // --- NORMALIZE OBJECTIVES ---
  const rawObj = data.objectives || data.stage1?.objectives || {};
  const toCleanArray = (val, defaultList) => {
    if (!val) return defaultList;
    if (Array.isArray(val)) {
      const list = val.map(x => typeof x === 'string' ? x.trim() : (x.text || x.description || JSON.stringify(x))).filter(Boolean);
      return list.length > 0 ? list : defaultList;
    }
    if (typeof val === 'string') {
      const s = val.trim();
      if (!s) return defaultList;
      const parts = s.split(/\n|;/).map(x => x.replace(/^[-*•\d.)\s]+/, '').trim()).filter(Boolean);
      return parts.length > 0 ? parts : [s];
    }
    return defaultList;
  };

  const defaultKnowledge = isEn ? [
    `Explain the fundamental concepts and principles of "${lessonTitle}" through slide observations and teacher presentations accurately.`,
    `Identify and articulate key formulas, rules, and definitions of ${subject} with at least 80% accuracy.`
  ] : [
    `កំណត់និយមន័យ និងពន្យល់ពីខ្លឹមសារចម្បងនៃ «${lessonTitle}» តាមរយៈការសង្កេតស្លាយបង្រៀន និងការពន្យល់របស់គ្រូ បានត្រឹមត្រូវ និងក្បោះក្បាយ។`,
    `ចងចាំ និងរៀបរាប់រូបមន្ត ច្បាប់ ឬទ្រឹស្តីគន្លឹះនៃ ${subject} តាមរយៈការអានឯកសារ និងការពិភាក្សាជាក្រុម បានយ៉ាងហោចណាស់ ៨០% ត្រឹមត្រូវ។`
  ];

  const defaultSkills = isEn ? [
    `Analyze, compute, and solve practical tasks relating to "${lessonTitle}" through collaborative group activities effectively.`,
    `Organize, present, and defend group solutions on flipcharts or whiteboards with confidence and fluency.`
  ] : [
    `វិភាគ គណនា និងដោះស្រាយលំហាត់ជាក់ស្តែងទាក់ទងនឹង «${lessonTitle}» តាមរយៈការអនុវត្តការងារជាក្រុម បានត្រឹមត្រូវតាមក្បួនខ្នាត។`,
    `រៀបចំ ធ្វើបទបង្ហាញ និងការពារលទ្ធផលការងារជាក្រុម តាមរយៈផ្ទាំង Flipchart ឬក្ដារឆ្នួន ប្រកបដោយភាពជឿជាក់ និងស្ទាត់ជំនាញ។`
  ];

  const defaultAttitudes = isEn ? [
    `Demonstrate active collaboration, mutual respect, and disciplined participation throughout group inquiry tasks responsibly.`,
    `Commit to applying the knowledge and skills from "${lessonTitle}" in daily life and practical problem-solving positively.`
  ] : [
    `បង្ហាញនូវស្មារតីសហការ យកចិត្តទុកដាក់ និងការគោរពវិន័យក្នុងការរៀនសូត្រ តាមរយៈការចូលរួមសកម្មភាពក្រុម ប្រកបដោយទំនួលខុសត្រូវខ្ពស់។`,
    `ប្ដេជ្ញាចិត្តយកចំណេះដឹង និងបំណិនដែលទទួលបានពី «${lessonTitle}» ទៅអនុវត្តក្នុងការរស់នៅ និងដោះស្រាយបញ្ហាជាក់ស្តែង ដោយភាពស្មោះត្រង់ និងវិជ្ជមាន។`
  ];

  const rawK = rawObj.knowledge || rawObj['វិជ្ជាសម្បទា'] || rawObj['ចំណេះដឹង'] || rawObj.cognitive || data.knowledge;
  const rawS = rawObj.skills || rawObj['បំណិនសម្បទា'] || rawObj['បំណិន'] || rawObj.psychomotor || data.skills;
  const rawA = rawObj.attitudes || rawObj['ចរិយាសម្បទា'] || rawObj['ឥរិយាសម្បទា'] || rawObj['ឥរិយាបថ'] || rawObj.affective || data.attitudes;

  data.objectives = {
    intro: rawObj.intro || (isEn ? 'After completing this lesson, students will be able to:' : 'បន្ទាប់ពីរៀនមេរៀននេះចប់ គរុនិស្សិត/សិស្សនឹង៖'),
    knowledge: toCleanArray(rawK, defaultKnowledge),
    skills: toCleanArray(rawS, defaultSkills),
    attitudes: toCleanArray(rawA, defaultAttitudes)
  };

  // --- NORMALIZE MATERIALS ---
  const rawMat = data.materials || data.stage3?.materials || {};
  const defaultTeacherMaterials = isEn ? [
    `Textbook and Curriculum Guide: ${subject} ${grade}`,
    `Teaching Slides, Video Materials, and Multimedia Presentations`,
    `Case Study Worksheets and Rubric Assessment Sheets`
  ] : [
    `កិច្ចតែងការបង្រៀន, សៀវភៅសិក្សាគោលមុខវិជ្ជា ${subject} ${grade}`,
    `ស្លាយបង្រៀន, កុំព្យូទ័រ/វីដេអូឧបទេស និងសន្លឹកកិច្ចការករណីសិក្សា`,
    `តារាងរូបរិចវាយតម្លៃ (Rubrics) និងសម្ភារពិសោធន៍ជាក់ស្តែង (បើមាន)`
  ];

  const defaultStudentMaterials = isEn ? [
    `Student Textbook ${subject} ${grade}`,
    `Notebooks, Pens, Markers, and Student Whiteboards`,
    `Group Flipcharts (A0/A1) and Sticky Notes`
  ] : [
    `សៀវភៅពុម្ព ${subject} ${grade}, សៀវភៅកត់ត្រា, ប៊ិច, បន្ទាត់`,
    `ផ្ទាំងក្រដាសធំ Flipchart (A0/A1) និងប៊ិចហ្វឺតពណ៌ (សម្រាប់ពិភាក្សាក្រុម)`
  ];

  const rawTM = rawMat.teacher || rawMat['គ្រូ'] || rawMat['សម្រាប់គ្រូ'] || rawMat.teacherMaterials || data.teacherMaterials;
  const rawSM = rawMat.student || rawMat['សិស្ស'] || rawMat['សម្រាប់សិស្ស'] || rawMat.studentMaterials || data.studentMaterials;

  data.materials = {
    teacher: toCleanArray(rawTM, defaultTeacherMaterials),
    student: toCleanArray(rawSM, defaultStudentMaterials)
  };

  // --- NORMALIZE STEPS & DURATIONS ---
  const stepTimeHints = calculateStepDurations(duration, isFlipped ? 'flipped' : (isBd ? 'backward_design' : 'standard'));

  if (isBd) {
    if (!data.stage1) data.stage1 = {};
    if (!data.stage2) data.stage2 = {};
    if (!data.stage3) data.stage3 = {};

    data.stage1.title = data.stage1.title || (isEn ? "Stage 1: Desired Results" : "ដំណាក់កាលទី ១ : ការកំណត់លទ្ធផលរំពឹងទុក (Stage 1: Desired Results)");
    data.stage1.establishedGoals = data.stage1.establishedGoals || (isEn ? `Master curriculum standards for ${lessonTitle}.` : `សម្រេចបានតាមស្តង់ដាកម្មវិធីសិក្សាជាតិសម្រាប់ «${lessonTitle}»`);
    data.stage1.enduringUnderstandings = toCleanArray(data.stage1.enduringUnderstandings, [
      `ការយល់ដឹងស៊ីជម្រៅអំពីគោលការណ៍គ្រឹះនៃ «${lessonTitle}» ជួយសិស្សដោះស្រាយបញ្ហាជាក់ស្តែងក្នុងជីវភាព។`
    ]);
    data.stage1.essentialQuestions = toCleanArray(data.stage1.essentialQuestions, [
      `ហេតុអ្វីបានជា «${lessonTitle}» មានសារៈសំខាន់? តើយើងអាចយកទ្រឹស្តីនេះទៅអនុវត្តដោះស្រាយបញ្ហាជាក់ស្តែងយ៉ាងដូចម្តេច?`
    ]);
    data.stage1.objectives = data.objectives;

    data.stage2.title = data.stage2.title || (isEn ? "Stage 2: Assessment Evidence" : "ដំណាក់កាលទី ២ : ការកំណត់ភស្តុតាងនៃការវាយតម្លៃ (Stage 2: Assessment Evidence)");
    data.stage2.performanceTasks = toCleanArray(data.stage2.performanceTasks, [
      `កិច្ចការអនុវត្ត និងបទបង្ហាញជាក្រុមលើករណីសិក្សាជាក់ស្តែងនៃ «${lessonTitle}»`
    ]);
    data.stage2.otherEvidence = toCleanArray(data.stage2.otherEvidence, [
      `ការសង្កេតផ្ទាល់របស់គ្រូលើការចូលរួមពិភាក្សា និងការឆ្លើយសំណួរពង្រឹងពុទ្ធិ`
    ]);
    data.stage2.criteria = toCleanArray(data.stage2.criteria, [
      `ភាពត្រឹមត្រូវតាមទ្រឹស្តី`, `ភាពច្នៃប្រឌិតក្នុងការដោះស្រាយ`, `កិច្ចសហការក្រុម`
    ]);

    data.stage3.title = data.stage3.title || (isEn ? "Stage 3: Learning Plan" : "ដំណាក់កាលទី ៣ : ផែនការរៀបចំការបង្រៀន និងរៀន (Stage 3: Learning Plan)");
    data.stage3.materials = data.materials;

    let acts = data.stage3.learningActivities || data.steps || [];
    if (!acts || acts.length === 0) {
      acts = [
        {
          stepNumber: 1,
          stepTitle: isEn ? "1. Hook & Connect" : "១. ការទាក់ទាញ និងភ្ជាប់ទំនាក់ទំនង (Hook & Connect)",
          duration: stepTimeHints.step1,
          teacherActivity: `• គ្រូបង្ហាញរូបភាព/វីដេអូបំផុសសំណួរទាក់ទងនឹង «${lessonTitle}»\n• គ្រូចោទសំណួរគន្លឹះដាស់ការត្រិះរិះដើម្បីភ្ជាប់ចូលមេរៀន`,
          contentSummary: `• បង្កើតចំណាប់អារម្មណ៍ និងភ្ជាប់បទពិសោធន៍ចាស់ទៅមេរៀនថ្មី «${lessonTitle}»`,
          studentActivity: `• សិស្សសង្កេត រួមគ្នាសញ្ជឹងគិត និងឆ្លើយសំណួរបំផុសរបស់គ្រូដោយស្វាហាប់`
        },
        {
          stepNumber: 2,
          stepTitle: isEn ? "2. Equip & Explore" : "២. ការរុករក និងកសាងចំណេះដឹង (Equip & Explore)",
          duration: stepTimeHints.step2,
          teacherActivity: `• គ្រូចែកសិស្សជាក្រុម ដាក់សន្លឹកកិច្ចការបេសកកម្ម និងសម្របសម្រួល\n• គ្រូពន្យល់ណែនាំ និងជួយបំភ្លឺចំណុចគន្លឹះតាមក្រុម`,
          contentSummary: `• ខ្លឹមសារស្នូល និងទ្រឹស្តីសំខាន់ៗនៃ «${lessonTitle}»\n• ដំណោះស្រាយជាក់ស្តែងនៃកិច្ចការបេសកកម្មក្រុម`,
          studentActivity: `• សិស្សធ្វើការជាក្រុម រុករកឯកសារ ពិភាក្សាស៊ីជម្រៅ និងកត់ត្រាលើ Flipchart`
        },
        {
          stepNumber: 3,
          stepTitle: isEn ? "3. Rethink & Reflect" : "៣. ការឆ្លុះបញ្ចាំង និងកែសម្រួល (Rethink & Reflect)",
          duration: stepTimeHints.step3,
          teacherActivity: `• គ្រូសម្របសម្រួលឱ្យក្រុមធ្វើបទបង្ហាញ និងផ្តល់មតិកែលម្អ (Peer Feedback)\n• គ្រូបូកសរុបទាញក្បួនរួមថ្នាក់ និងកែតម្រូវចំណុចខ្វះខាត`,
          contentSummary: `• ការបូកសរុប និងការទាញសេចក្តីសន្និដ្ឋានត្រឹមត្រូវនៃ «${lessonTitle}»`,
          studentActivity: `• សិស្សឡើងការពារលទ្ធផល ចូលរួមដេញដោល និងឆ្លុះបញ្ចាំងការយល់ដឹង`
        },
        {
          stepNumber: 4,
          stepTitle: isEn ? "4. Evaluate & Exhibit" : "៤. ការវាយតម្លៃ និងការអនុវត្តបន្ត (Evaluate & Exhibit)",
          duration: "៥ នាទី",
          teacherActivity: `• គ្រូវាយតម្លៃការសម្រេចបានតាមវត្ថុបំណង និងដាក់កិច្ចការអនុវត្តបន្ត`,
          contentSummary: `• ការវាយតម្លៃចុងក្រោយ និងការណែនាំការស្វ័យសិក្សាបន្តនៅផ្ទះ`,
          studentActivity: `• សិស្សឆ្លើយសំណួរវាយតម្លៃ និងកត់ត្រាកិច្ចការផ្ទះដោយយកចិត្តទុកដាក់`
        }
      ];
    }
    data.stage3.learningActivities = acts;
    data.steps = acts;

  } else {
    // 5-Step Model Normalization (Flipped, MoEYS Standard, STEM, Primary)
    let rawSteps = data.steps || data.learningActivities || data.activities || [];
    
    const stepTitlesFlipped = [
      "ជំហានទី១៖ រដ្ឋបាលថ្នាក់ និងត្រួតពិនិត្យការត្រៀមខ្លួន",
      "ជំហានទី២៖ រំលឹកមេរៀនចាស់ និងត្រួតពិនិត្យការស្វ័យសិក្សា (Pre-Test QCM & Muddiest Points)",
      "ជំហានទី៣៖ ខ្លឹមសារមេរៀនថ្មី និងក្របខណ្ឌទ្រឹស្តីគន្លឹះ (Mini-Lecture / Core Insights)",
      "ជំហានទី៤៖ ការរៀនសកម្ម ស៊ីជម្រៅ និងដោះស្រាយករណីសិក្សាជាក្រុម (Active Learning & Gallery Walk)",
      "ជំហានទី៥៖ បូកសរុប វាយតម្លៃបច្ឆិមតេស្ត និងកិច្ចការស្រាវជ្រាវបន្ត (Synthesis & Homework)"
    ];

    const stepTitlesStandard = [
      "ជំហានទី ១ : រដ្ឋបាលថ្នាក់",
      "ជំហានទី ២ : រំលឹកមេរៀនចាស់ / ទំនាក់ទំនងមេរៀន",
      "ជំហានទី ៣ : ដំណើរការបង្រៀន និងរៀន (មេរៀនថ្មី)",
      "ជំហានទី ៤ : ពង្រឹងពុទ្ធិ (វាយតម្លៃ)",
      "ជំហានទី ៥ : បណ្តាំផ្ញើ និងកិច្ចការផ្ទះ"
    ];

    const defaultTitles = isFlipped ? stepTitlesFlipped : stepTitlesStandard;
    const normalizedSteps = [];

    for (let i = 0; i < 5; i++) {
      const stepIdx = i + 1;
      const existing = rawSteps.find(s => s && (s.stepNumber === stepIdx || s.step_number === stepIdx || s.step === stepIdx)) || rawSteps[i] || {};
      
      const teacherAct = existing.teacherActivity || existing.teacher_activity || existing.teacher || existing['សកម្មភាពគ្រូ'] || '';
      const contentSum = existing.contentSummary || existing.content_summary || existing.content || existing['ខ្លឹមសារ'] || existing['ខ្លឹមសារមេរៀន'] || '';
      const studentAct = existing.studentActivity || existing.student_activity || existing.student || existing['សកម្មភាពសិស្ស'] || '';

      const durKey = `step${stepIdx}`;
      const defaultDur = stepTimeHints[durKey] || '១០ នាទី';

      let safeTeacher = teacherAct;
      let safeContent = contentSum;
      let safeStudent = studentAct;

      if (!safeTeacher || safeTeacher.trim().length < 5) {
        if (stepIdx === 1) {
          safeTeacher = "• គ្រូពិនិត្យអនាម័យ សណ្ដាប់ធ្នាប់ក្នុងថ្នាក់ និងសម្លៀកបំពាក់សិស្ស\n• គ្រូពិនិត្យវត្តមាន និងកត់ត្រាចំនួនសិស្សអវត្តមានក្នុងបញ្ជីវត្តមាន";
        } else if (stepIdx === 2) {
          safeTeacher = isFlipped 
            ? `• គ្រូត្រួតពិនិត្យការស្វ័យសិក្សាតាមផ្ទះរបស់សិស្សលើប្រធានបទ «${lessonTitle}»\n• គ្រូបង្ហាញលទ្ធផលបុរេតេស្ត (Pre-Test QCM) និងប្រមូលចំណុចចម្ងល់ (Muddiest Points)`
            : `• គ្រូសួរសំណួររំលឹកមេរៀនចាស់ទាក់ទងនឹង «${lessonTitle}»\n• គ្រូហៅសិស្សឆ្លើយ កោតសរសើរ និងភ្ជាប់ទំនាក់ទំនងចូលមេរៀនថ្មី`;
        } else if (stepIdx === 3) {
          safeTeacher = isFlipped
            ? `• គ្រូសង្ខេបក្របខណ្ឌទ្រឹស្តីគន្លឹះ និងគំនិតស្នូលនៃ «${lessonTitle}» រយៈពេលខ្លី\n• គ្រូចោទសំណួរបំផុសគំនិត និងណែនាំបេសកកម្មសិក្សាជាក្រុម`
            : `• គ្រូសរសេរចំណងជើងមេរៀន «${lessonTitle}» លើក្ដារខៀន\n• គ្រូពន្យល់ខ្លឹមសារគន្លឹះ ចោទសំណួរ និងដឹកនាំសិស្សរុករកចំណេះដឹង`;
        } else if (stepIdx === 4) {
          safeTeacher = isFlipped
            ? `• គ្រូបែងចែកក្រុម ដាក់សន្លឹកកិច្ចការករណីសិក្សាជាក់ស្តែងនៃ «${lessonTitle}»\n• គ្រូដើរសម្របសម្រួល ផ្តល់ការគាំទ្រ និងដឹកនាំការធ្វើ Gallery Walk`
            : `• គ្រូដាក់សំណួរពង្រឹងពុទ្ធិ ឬលំហាត់អនុវត្តរហ័សទាក់ទងនឹង «${lessonTitle}»\n• គ្រូឱ្យសិស្សអនុវត្តជាបុគ្គល ឬដៃគូ និងត្រួតពិនិត្យការយល់ដឹង`;
        } else {
          safeTeacher = `• គ្រូបូកសរុបចំណុចសំខាន់ៗនៃមេរៀន «${lessonTitle}» ឡើងវិញ\n• គ្រូដាក់កិច្ចការផ្ទះស្រាវជ្រាវ និងផ្ដាំផ្ញើអប់រំសីលធម៌ សុវត្ថិភាព`;
        }
      }

      if (!safeContent || safeContent.trim().length < 5) {
        if (stepIdx === 1) {
          safeContent = "• ការពិនិត្យអនាម័យ បរិស្ថានសិក្សា និងសម្រង់វត្តមានសិស្សប្រចាំថ្ងៃ";
        } else if (stepIdx === 2) {
          safeContent = isFlipped
            ? `• ការវិភាគលទ្ធផលបុរេតេស្ត (Pre-Test QCM) និងការស្រាយបំភ្លឺចំណុចស្រពេចស្រពិល\n• ចំណុចតភ្ជាប់គន្លឹះចូលសកម្មភាពអនុវត្តនៃ «${lessonTitle}»`
            : `• ចម្លើយនៃសំណួររំលឹកមេរៀនចាស់ និងការតភ្ជាប់ចូលមេរៀនថ្មី «${lessonTitle}»`;
        } else if (stepIdx === 3) {
          safeContent = `«${lessonTitle}»\n• ខ្លឹមសារស្នូល និយមន័យ និងទ្រឹស្តីគន្លឹះដែលសិស្សត្រូវក្តាប់បាន\n• ឧទាហរណ៍ជាក់ស្តែង និងរូបមន្ត/ក្បួនខ្នាតសំខាន់ៗ`;
        } else if (stepIdx === 4) {
          safeContent = isFlipped
            ? `• ដំណោះស្រាយករណីសិក្សា និងលទ្ធផលការងារជាក់ស្តែងរបស់ក្រុមនិស្សិត\n• ការទាញក្បួនគន្លឹះរួម និងការឆ្លុះបញ្ចាំងលើបញ្ហាប្រឈម`
            : `• ចម្លើយ និងដំណោះស្រាយនៃសំណួរពង្រឹងពុទ្ធិ\n• ក្បួនគន្លឹះចងចាំនៃមេរៀន «${lessonTitle}»`;
        } else {
          safeContent = `• ចំណុចគន្លឹះ ៣-៥ ដែលសិស្សត្រូវចងចាំពី «${lessonTitle}»\n• ខ្លឹមសារកិច្ចការផ្ទះ និងការណែនាំការស្វ័យសិក្សាសម្រាប់ម៉ោងក្រោយ`;
        }
      }

      if (!safeStudent || safeStudent.trim().length < 5) {
        if (stepIdx === 1) {
          safeStudent = "• ប្រធានថ្នាក់ឡើងរាយការណ៍ពីវត្តមានសិស្ស\n• សិស្សទាំងអស់រៀបចំសម្ភារសិក្សា និងរក្សាភាពស្ងប់ស្ងាត់គោរពវិន័យ";
        } else if (stepIdx === 2) {
          safeStudent = isFlipped
            ? "• សិស្សស្តាប់ការវិភាគលទ្ធផលបុរេតេស្ត និងលើកឡើងនូវចំណុចចម្ងល់ពីការស្វ័យសិក្សា\n• ចូលរួមឆ្លើយសំណួរស្រាយបំភ្លឺរបស់គ្រូ"
            : "• សិស្សស្តាប់ និងស្ម័គ្រចិត្តឆ្លើយសំណួររំលឹករបស់គ្រូ\n• សិស្សកត់ត្រាចំណុចតភ្ជាប់ចូលក្នុងសៀវភៅ";
        } else if (stepIdx === 3) {
          safeStudent = "• សិស្សកត់ត្រាចំណងជើងមេរៀន យកចិត្តទុកដាក់ស្តាប់ និងកត់ត្រាគំនិតសំខាន់ៗ\n• សិស្សសួរសំណួរចម្ងល់ និងឆ្លើយសំណួរបំផុសរបស់គ្រូ";
        } else if (stepIdx === 4) {
          safeStudent = isFlipped
            ? "• សិស្សពិភាក្សាជាក្រុមយ៉ាងសកម្ម ដោះស្រាយករណីសិក្សា និងសរសេរលើ Flipchart\n• សិស្សចូលរួមធ្វើ Gallery Walk ឡើងការពារ និងឆ្លើយសំណួរដេញដោល"
            : "• សិស្សយកចិត្តទុកដាក់ដោះស្រាយលំហាត់/សំណួរពង្រឹងពុទ្ធិលើក្ដារឆ្នួន ឬសៀវភៅ\n• សិស្សលើកបង្ហាញចម្លើយ និងកែតម្រូវតាមការណែនាំរបស់គ្រូ";
        } else {
          safeStudent = "• សិស្សកត់ត្រាកិច្ចការផ្ទះ និងបណ្ដាំផ្ញើចូលក្នុងសៀវភៅដោយយកចិត្តទុកដាក់\n• សិស្សរៀបចំសម្ភារ និងជម្រាបលាគ្រូ";
        }
      }

      normalizedSteps.push({
        stepNumber: stepIdx,
        stepTitle: existing.stepTitle || existing.step_title || defaultTitles[i],
        duration: existing.duration || defaultDur,
        teacherActivity: safeTeacher,
        contentSummary: safeContent,
        studentActivity: safeStudent
      });
    }

    data.steps = normalizedSteps;
  }

  return data;
}
window.normalizeLessonPlanData = normalizeLessonPlanData;


function renderPreTestHtmlBlock(data) {
  let qcmList = (data.preTestQCM && data.preTestQCM.length > 0)
    ? data.preTestQCM
    : generatePreTestQCMOffline(data.subject, data.grade, data.lessonTitle, [], (data.preTestQCM?.length || 5));

  // Auto-heal uniform answer keys (e.g., if all answers are A from legacy drafts)
  if (Array.isArray(qcmList) && qcmList.length > 1) {
    const isUniform = qcmList.every(q => (q.correctAnswer || 'A') === (qcmList[0].correctAnswer || 'A'));
    if (isUniform) {
      qcmList = distributeAndBalanceQuizList(qcmList);
      data.preTestQCM = qcmList;
    }
  }

  let preQcmHtml = '';
  let preAnswerKeyList = [];

  qcmList.forEach((q, idx) => {
    const qNum = idx + 1;
    preAnswerKeyList.push(`<strong>ស.${qNum}:</strong> ${escapeHtml(q.correctAnswer || 'A')}`);
    const opts = q.options || {};
    preQcmHtml += `
      <div class="qcm-item">
        <div class="qcm-question-header">
          <div class="qcm-question-text"><strong>សំណួរទី ${qNum} :</strong> ${escapeHtml(q.question)}</div>
        </div>
        <div class="qcm-options">
          <div class="qcm-option"><strong>ក.</strong> ${escapeHtml(opts.A || opts['ក'] || '')}</div>
          <div class="qcm-option"><strong>ខ.</strong> ${escapeHtml(opts.B || opts['ខ'] || '')}</div>
          <div class="qcm-option"><strong>គ.</strong> ${escapeHtml(opts.C || opts['គ'] || '')}</div>
          <div class="qcm-option"><strong>ឃ.</strong> ${escapeHtml(opts.D || opts['ឃ'] || '')}</div>
        </div>
        ${q.explanation ? `<div style="font-size: 8.5pt; color: #475569; margin-top: 4px; font-style: italic;">💡 <em>ពន្យល់៖</em> ${escapeHtml(q.explanation)}</div>` : ''}
      </div>
    `;
  });

  return `
    <!-- Pre-Test QCM -->
    <div class="doc-section-title flex justify-between items-center" style="flex-wrap: wrap; gap: 6px; margin-top: 8px;">
      <span>វិញ្ញាសាស្ទង់សមត្ថភាពមុនម៉ោង (Pre-Test QCM ${qcmList.length} សំណួរ)</span>
      <div class="flex items-center gap-2" style="flex-wrap: wrap;">
        <button type="button" class="btn-copy-notebooklm" onclick="openGoogleFormModal('pre')" style="background: #7c3aed; color: white; border: none; font-weight: bold;" title="បង្កើតជា Google Form ដោយស្វ័យប្រវត្តក្នុង Google Drive">
          <i class="fa-solid fa-square-poll-vertical"></i> 📝 បង្កើត Google Form
        </button>
        <button type="button" class="btn-csv-action" onclick="exportTestToCSV('pre')" title="ទាញយក Pre-Test ជា Excel/CSV (Google Sheets 5 Columns)">
          <i class="fa-solid fa-file-csv"></i> ទាញយក Pre-Test CSV
        </button>
        <button type="button" class="btn-tool-action" onclick="promptGenerateTest('pre')" style="background: #eef2ff; color: #4338ca; border: 1px solid #c7d2fe; font-weight: 600; padding: 4px 10px; border-radius: 6px; cursor: pointer;" title="បង្កើតបុរេតេស្តឡើងវិញ">
          <i class="fa-solid fa-arrows-rotate"></i> បង្កើតឡើងវិញ
        </button>
        <button type="button" class="btn-tool-action" onclick="removePreTestModule()" style="background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5; font-weight: 600; padding: 4px 8px; border-radius: 6px; cursor: pointer;" title="លាក់កម្រងសំណួរ">
          <i class="fa-solid fa-xmark"></i> លាក់
        </button>
      </div>
    </div>
    <div class="doc-pretest-container">
      <div class="doc-pretest-header">
        <div class="doc-pretest-title"><i class="fa-solid fa-wand-magic-sparkles" style="color: #0284c7;"></i> កម្រងសំណួរស្ទង់ការយល់ដឹងមុនម៉ោង (Pre-Test Diagnostic QCM)</div>
        <span class="doc-pretest-formula">កម្រិតលំបាក: 🟢 ងាយ (Easy) | 🟡 មធ្យម (Medium) | 🔴 ពិបាក (Hard)</span>
      </div>
      <div class="qcm-grid">
        ${preQcmHtml}
      </div>
      <div class="qcm-answer-key-box">
        <div class="qcm-answer-key-header">🔑 បន្ទះចម្លើយត្រឹមត្រូវ (Pre-Test Answer Key) សម្រាប់គ្រូផ្ទៀងផ្ទាត់៖</div>
        <div class="qcm-answer-grid">
          ${preAnswerKeyList.join(' | ')}
        </div>
      </div>
    </div>
  `;
}

function renderPostTestHtmlBlock(data) {
  let postTestList = (data.postTestMCQ && data.postTestMCQ.length > 0)
    ? data.postTestMCQ
    : generatePostTestMCQOffline(data.subject, data.grade, data.lessonTitle, [], (data.postTestMCQ?.length || 5));

  // Auto-heal uniform answer keys (e.g., if all answers are A from legacy drafts)
  if (Array.isArray(postTestList) && postTestList.length > 1) {
    const isUniformPost = postTestList.every(q => (q.correctAnswer || 'A') === (postTestList[0].correctAnswer || 'A'));
    if (isUniformPost) {
      postTestList = distributeAndBalanceQuizList(postTestList);
      data.postTestMCQ = postTestList;
    }
  }

  let postQcmHtml = '';
  let postAnswerKeyList = [];

  postTestList.forEach((q, idx) => {
    const qNum = idx + 1;
    postAnswerKeyList.push(`<strong>ស.${qNum}:</strong> ${escapeHtml(q.correctAnswer || 'A')}`);
    const opts = q.options || {};
    postQcmHtml += `
      <div class="qcm-item">
        <div class="qcm-question-header">
          <div class="qcm-question-text"><strong>សំណួរទី ${qNum} :</strong> ${escapeHtml(q.question)}</div>
        </div>
        <div class="qcm-options">
          <div class="qcm-option"><strong>ក.</strong> ${escapeHtml(opts.A || opts['ក'] || '')}</div>
          <div class="qcm-option"><strong>ខ.</strong> ${escapeHtml(opts.B || opts['ខ'] || '')}</div>
          <div class="qcm-option"><strong>គ.</strong> ${escapeHtml(opts.C || opts['គ'] || '')}</div>
          <div class="qcm-option"><strong>ឃ.</strong> ${escapeHtml(opts.D || opts['ឃ'] || '')}</div>
        </div>
        ${q.explanation ? `<div style="font-size: 8.5pt; color: #475569; margin-top: 4px; font-style: italic;">💡 <em>ពន្យល់៖</em> ${escapeHtml(q.explanation)}</div>` : ''}
      </div>
    `;
  });

  return `
    <!-- Post-Test MCQ -->
    <div class="doc-section-title flex justify-between items-center" style="margin-top: 8px; flex-wrap: wrap; gap: 6px;">
      <span>វិញ្ញាសាវាយតម្លៃបញ្ចប់ Post-Test (MCQ ${postTestList.length} សំណួរ)</span>
      <div class="flex items-center gap-2" style="flex-wrap: wrap;">
        <button type="button" class="btn-copy-notebooklm" onclick="openGoogleFormModal('post')" style="background: #7c3aed; color: white; border: none; font-weight: bold;" title="បង្កើតជា Google Form ដោយស្វ័យប្រវត្តក្នុង Google Drive">
          <i class="fa-solid fa-square-poll-vertical"></i> 📝 បង្កើត Google Form
        </button>
        <button type="button" class="btn-csv-action" onclick="exportTestToCSV('post')" title="ទាញយក Post-Test ជា Excel/CSV (Google Sheets 5 Columns)">
          <i class="fa-solid fa-file-csv"></i> ទាញយក Post-Test CSV
        </button>
        <button type="button" class="btn-tool-action" onclick="promptGenerateTest('post')" style="background: #f0fdf4; color: #166534; border: 1px solid #86efac; font-weight: 600; padding: 4px 10px; border-radius: 6px; cursor: pointer;" title="បង្កើតបច្ឆិមតេស្តឡើងវិញ">
          <i class="fa-solid fa-arrows-rotate"></i> បង្កើតឡើងវិញ
        </button>
        <button type="button" class="btn-tool-action" onclick="removePostTestModule()" style="background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5; font-weight: 600; padding: 4px 8px; border-radius: 6px; cursor: pointer;" title="លាក់កម្រងសំណួរ">
          <i class="fa-solid fa-xmark"></i> លាក់
        </button>
      </div>
    </div>
    <div class="doc-pretest-container" style="background: #f0fdf4; border-color: #86efac;">
      <div class="doc-pretest-header" style="border-bottom-color: #86efac;">
        <div class="doc-pretest-title" style="color: #166534;"><i class="fa-solid fa-graduation-cap"></i> កម្រងសំណួរវាស់ស្ទង់សមត្ថភាពបញ្ចប់ (Post-Test Diagnostic MCQ)</div>
        <span class="doc-pretest-formula" style="background: #dcfce7; color: #166534;">Bloom's: 🟢 ងាយ | 🟡 មធ្យម | 🔴 ពិបាក</span>
      </div>
      <div class="qcm-grid">
        ${postQcmHtml}
      </div>
      <div class="qcm-answer-key-box" style="background: #e2e8f0;">
        <div class="qcm-answer-key-header">🔑 បន្ទះចម្លើយត្រឹមត្រូវ (Post-Test Answer Key) សម្រាប់គ្រូផ្ទៀងផ្ទាត់៖</div>
        <div class="qcm-answer-grid">
          ${postAnswerKeyList.join(' | ')}
        </div>
      </div>
    </div>
  `;
}

function renderLearningGainReflectionBlock(data) {
  if (!data || !data.selfEvaluation) return '';
  const isEn = (state.language === 'en');
  const sectionTitle = isEn
    ? "Learning Gain & Pedagogical Reflection (Hake's Normalized Gain)"
    : "ការវាស់ស្ទង់កំណើន និងស្វ័យវាយតម្លៃការបង្រៀន (Learning Gain & Teaching Reflection)";
  return `
    <!-- Learning Gain & Teaching Reflection Block -->
    <div class="doc-section-title flex items-center gap-2" style="margin-top: 18px; color: #1e3a8a;">
      <i class="fa-solid fa-chart-line" style="color: #4f46e5;"></i>
      <span>${escapeHtml(sectionTitle)}</span>
    </div>
    <div style="margin: 8px 0 16px 0; padding: 12px 16px; background: #f8fafc; border: 1.5px solid #cbd5e1; border-left: 5px solid #4f46e5; border-radius: 8px; font-size: 10pt; line-height: 1.6; color: #1e293b; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
      <div style="display: flex; align-items: center; gap: 8px; font-weight: 700; color: #4338ca; margin-bottom: 6px;">
        <i class="fa-solid fa-square-check"></i>
        <span>${isEn ? "Normalized Learning Gain Evaluation Result:" : "លទ្ធផលវាយតម្លៃតាមរូបមន្ត Richard Hake:"}</span>
      </div>
      <div>${formatLineBreaks(data.selfEvaluation)}</div>
    </div>
  `;
}


// ==========================================================================
// 🎯 On-Demand Pre-Test & Post-Test AI Generation Engine
// Separates diagnostic/mastery assessments from core lesson plan generation
// ==========================================================================

async function callAiForSingleTest(testType, plan, numQuestions = 10, scale = null, skipOverlay = false) {
  if (!skipOverlay) {
    showLoadingOverlay();
    const isPre = testType === 'pre';
    setLoadingOverlayStatus(
      isPre ? '📝 AI កំពុងបង្កើតកម្រងសំណួរ Pre-Test (៦០% - ៣០% - ១០%)...' : '📝 AI កំពុងបង្កើតកម្រងសំណួរ Post-Test (២០% - ៦០% - ២០%)...',
      `កំពុងវិភាគខ្លឹមសារមេរៀន «${plan.lessonTitle || ''}» ដើម្បីបង្កើតសំណួរឆ្លាតវៃ...`,
      '🤖 ដំណើរការដោយ Advanced Pedagogical AI Engine'
    );
  }
  const isPre = testType === 'pre';
  const isEn = (state.language === 'en');

  try {
    let apiKey = (state.geminiApiKey || getActiveGeminiApiKey() || localStorage.getItem('gemini_api_key') || sessionStorage.getItem('gemini_api_key') || '').trim();
    let provider = state.aiProvider || localStorage.getItem('ai_provider') || 'gemini';
    
    // Standard Distribution:
    // Pre-Test: 60% Easy, 30% Medium, 10% Hard
    // Post-Test: 20% Easy, 60% Medium, 20% Hard
    let e = isPre ? Math.round(numQuestions * 0.6) : Math.round(numQuestions * 0.2);
    let m = isPre ? Math.round(numQuestions * 0.3) : Math.round(numQuestions * 0.6);
    let h = Math.max(0, numQuestions - e - m);
    
    if (scale) {
      e = parseInt(scale.e) || e;
      m = parseInt(scale.m) || m;
      h = parseInt(scale.h) || h;
    }

    if (!apiKey) {
      // 1. Try Backend Server proxy (/api/generate/test) first if client has no direct key
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 90000);
        const serverResp = await fetch('/api/generate/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            testType,
            plan,
            numQuestions,
            scale: { e, m, h }
          })
        });
        clearTimeout(timeoutId);
        if (serverResp.ok) {
          const serverData = await serverResp.json();
          if (serverData.success && Array.isArray(serverData.data) && serverData.data.length > 0 && !serverData.fallback) {
            return distributeAndBalanceQuizList(serverData.data.slice(0, numQuestions));
          }
        }
      } catch (srvErr) {
        console.warn('Backend test call without client apiKey error:', srvErr);
      }

      // No API key available anywhere: Require API key connection to generate authentic AI questions
      throw new Error("NEED_API_KEY");
    }

    // Extract rich teaching context to give Gemini deep awareness of lesson
    let objectivesSummary = '';
    if (plan.objectives) {
      const k = (plan.objectives.knowledge || []).join('; ');
      const s = (plan.objectives.skills || []).join('; ');
      const a = (plan.objectives.attitudes || []).join('; ');
      objectivesSummary = `វិជ្ជាសម្បទា: ${k} | បំណិនសម្បទា: ${s} | ចរិយាសម្បទា: ${a}`;
    }

    let stepsSummary = '';
    if (Array.isArray(plan.steps) && plan.steps.length > 0) {
      stepsSummary = plan.steps.map(st => `${st.stepTitle || ''}: ${st.contentSummary || st.teacherActivity || ''}`).slice(0, 5).join('\n');
    } else if (plan.stage1) {
      stepsSummary = `ការយល់ដឹងស្នូល: ${(plan.stage1.enduringUnderstandings || []).join('; ')} | សំណួរគន្លឹះ: ${(plan.stage1.essentialQuestions || []).join('; ')}`;
    }

    let docSnippet = '';
    if (state.extractedText) {
      docSnippet = state.extractedText.slice(0, 2500).replace(/\s+/g, ' ');
    } else if (plan.lessonContent) {
      docSnippet = String(plan.lessonContent).slice(0, 2500).replace(/\s+/g, ' ');
    }

    const testTypeDescription = isPre
      ? `បុរេតេស្ត (Pre-Test Diagnostic Assessment) ក្នុងគោលដៅវាស់ស្ទង់ «ចំណេះដឹងត្រៀមជាមុន (Prerequisite / Baseline Knowledge)» ដែលសិស្សត្រូវមានជាគ្រឹះ មុននឹងរៀនមេរៀនថ្មីនេះ។ សំណួរភាគច្រើន (${e} ងាយ, ${m} មធ្យម) ត្រូវជាសំណួរចងចាំ និងការយល់ដឹងគ្រឹះ ចំណែក ${h} ពិបាក ជាការគិតវិភាគ។`
      : `បច្ឆិមតេស្ត (Post-Test Mastery Assessment) ក្នុងគោលដៅវាស់ស្ទង់ «ការយល់ដឹងស៊ីជម្រៅ និងការសម្រេចបានតាម Bloom's Taxonomy» នៃខ្លឹមសារមេរៀនដែលបានរៀនរួច។ សំណួរត្រូវមាន ${e} ងាយ (ការចងចាំ/យល់), ${m} មធ្យម (ការអនុវត្ត/ការដោះស្រាយបញ្ហា/ការវិភាគ), និង ${h} ពិបាក (ការវាយតម្លៃ/ការសំយោគកម្រិតខ្ពស់)។`;

    const systemPrompt = `តួនាទី៖ អ្នកគឺជាសាស្ត្រាចារ្យ និងអ្នកជំនាញកម្រិតខ្ពស់នៃការបង្កើតវិញ្ញាសាវាយតម្លៃគរុកោសល្យ និងតេស្តស្ដង់ដារនៃក្រសួងអប់រំ យុវជន និងកីឡា (MoEYS)។
ភារកិច្ច៖ បង្កើតកម្រងសំណួរពហុជ្រើសរើស (Multiple Choice Questions) ចំនួនពិតប្រាកដ ${numQuestions} សំណួរ ជាភាសាខ្មែរ ដោយផ្អែកលើខ្លឹមសារពិតជាក់ស្ដែងនៃមេរៀន។

ព័ត៌មានលម្អិតនៃមេរៀន៖
- មុខវិជ្ជា៖ ${plan.subject || 'ទូទៅ'}
- កម្រិតថ្នាក់៖ ${plan.grade || 'ទូទៅ'}
- ចំណងជើងមេរៀន៖ ${plan.lessonTitle || 'មេរៀន'}
${plan.chapter ? `- ជំពូក៖ ${plan.chapter}` : ''}
${objectivesSummary ? `- វត្ថុបំណងមេរៀន៖ ${objectivesSummary}` : ''}
${stepsSummary ? `- ខ្លឹមសារសង្ខេបនៃជំហានបង្រៀន៖\n${stepsSummary}` : ''}
${docSnippet ? `- សម្រង់ខ្លឹមសារមេរៀនបន្ថែម៖\n${docSnippet}` : ''}

ប្រភេទតេស្ត និងការបែងចែកកម្រិតលំបាក៖
${testTypeDescription}
- ចំនួនសំណួរសរុប៖ ${numQuestions} សំណួរ
- កម្រិតងាយ (Easy): ${e} សំណួរ (${Math.round((e / numQuestions) * 100)}%)
- កម្រិតមធ្យម (Medium): ${m} សំណួរ (${Math.round((m / numQuestions) * 100)}%)
- កម្រិតពិបាក (Hard): ${h} សំណួរ (${Math.round((h / numQuestions) * 100)}%)

🚨 បទបញ្ជាគរុកោសល្យតឹងរ៉ឹងបំផុត (STRICT RULES - NO ROBOTIC TEMPLATES):
១. ដាច់ខាតមិនត្រូវបង្កើតសំណួរពុម្ពទូទៅ ឬចម្លងចំណងជើងមេរៀនចូលក្នុងប្រធានបទដដែលៗដូចជា៖
   ❌ «តើ [ចំណងជើងមេរៀន] មានឥទ្ធិពលយ៉ាងណា?»
   ❌ «តើការអនុវត្ត [ចំណងជើងមេរៀន] ត្រូវធ្វើតាមដំណាក់កាលណា?»
   ❌ «តើសារពារពាក់ព័ន្ធណាដែលរងផលប៉ះពាល់ពី [ចំណងជើងមេរៀន]?»
២. សំណួរនីមួយៗត្រូវតែចោទសួរអំពី «គំនិតស្នូលជាក់ស្ដែង» នៃមុខវិជ្ជា (Authentic Scientific / Pedagogical Concepts, Real Theories, Practical Classroom Scenarios, Case Studies)។
   - ប្រសិនបើមុខវិជ្ជា «រូបវិទ្យា» (Physics) សំណួរត្រូវសួរអំពីច្បាប់រូបវិទ្យា ចលនា កម្លាំង ថាមពល រូបមន្តគណនា និងបាតុភូតពិសោធន៍ជាក់ស្តែង។
   - ប្រសិនបើមុខវិជ្ជា «ចិត្តវិទ្យា» (Psychology) សំណួរត្រូវសួរអំពីយន្តការចងចាំ ឥរិយាបថ ការអភិវឌ្ឍបញ្ញាស្មារតី ការលើកទឹកចិត្ត ឬការយល់ដឹង។
   - សម្រាប់មុខវិជ្ជាដទៃទៀត សំណួរត្រូវផ្អែកលើវិទ្យាសាស្ត្រ និងទ្រឹស្តីពិតនៃមុខវិជ្ជានោះ។
៣. ជម្រើសចម្លើយនីមួយៗ (A, B, C, D) ត្រូវតែជាជម្រើសសមហេតុផលក្នុងវិស័យអប់រំ (Plausible distractors) មិនត្រូវដាក់ចម្លើយកំប្លែង ឬមិនទំនងឡើយ។
៤. ការបែងចែកចម្លើយត្រឹមត្រូវ (MANDATORY BALANCED ANSWER KEY ROTATION - ហាមដាច់ខាតដាក់ A ទាំងអស់):
   - ដាច់ខាតមិនត្រូវដាក់ចម្លើយត្រឹមត្រូវ A ទាំងអស់ ឬដាក់ A ច្រើនពេកឡើយ! (DO NOT default to option A for all questions).
   - ចម្លើយត្រឹមត្រូវ (correctAnswer) ត្រូវតែឆ្លាស់គ្នាយ៉ាងស្មើភាព និងចៃដន្យរវាង A, B, C, D ពេញមួយកម្រងសំណួរទាំង ${numQuestions} (ឧទាហរណ៍៖ សំណួរទី១: C, សំណួរទី២: A, សំណួរទី៣: D, សំណួរទី៤: B, សំណួរទី៥: C...)។
   - ក្នុងចំណោម ${numQuestions} សំណួរ ចម្លើយនីមួយៗ (A, B, C, D) គួរតែមានប្រហាក់ប្រហែល ២៥% ស្មើៗគ្នា (ប្រហែល ២ ទៅ ៣ សំណួរក្នុងមួយអក្សរ)។
   - ទីតាំងនៃចម្លើយត្រឹមត្រូវពិតប្រាកដក្នុង options ត្រូវដាក់ខ្លឹមសារត្រឹមត្រូវឱ្យត្រូវគ្នានឹងតម្លៃនៃ correctAnswer នោះ។
៥. ការពន្យល់ (explanation) ត្រូវបញ្ជាក់ឱ្យបានច្បាស់លាស់ពីមូលហេតុដែលចម្លើយនោះត្រឹមត្រូវតាមក្បួនគរុកោសល្យ។

ទម្រង់លទ្ធផលត្រឡប់មកវិញ (JSON ARRAY ONLY):
ត្រឡប់មកវិញតែ JSON Array សុទ្ធដែលមាន ${numQuestions} objects ដូចទម្រង់នេះ (ចម្លើយត្រូវឆ្លាស់គ្នា A, B, C, D គ្មានអក្សរបន្ថែមក្រៅពី JSON):
[
  {
    "number": 1,
    "difficulty": "ងាយ (Easy)",
    "difficultyLevel": "easy",
    "question": "ខ្លឹមសារសំណួរជាក់លាក់ទី១...",
    "options": {
      "A": "ជម្រើសទី ១",
      "B": "ជម្រើសទី ២",
      "C": "ជម្រើសទី ៣",
      "D": "ជម្រើសទី ៤"
    },
    "correctAnswer": "C",
    "explanation": "ការពន្យល់គរុកោសល្យលម្អិត..."
  }
]`;

    // 1. Try Groq API if key is Groq
    if (provider === 'groq' || apiKey.startsWith('gsk_')) {
      try {
        const groqResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
              { role: 'system', content: 'You are an elite MoEYS curriculum examiner. Return ONLY a valid JSON array of test questions with balanced answer keys (A, B, C, D).' },
              { role: 'user', content: systemPrompt }
            ],
            temperature: 0.3,
            response_format: { type: 'json_object' }
          })
        });
        if (groqResp.ok) {
          const resJson = await groqResp.json();
          const content = resJson.choices?.[0]?.message?.content;
          const parsed = extractAndParseJson(content);
          let list = Array.isArray(parsed) ? parsed : (parsed.questions || parsed.preTestQCM || parsed.postTestMCQ || parsed.test || parsed.quiz || parsed.items || []);
          if (!list || list.length === 0) {
            const found = Object.values(parsed || {}).find(v => Array.isArray(v) && v.length > 0 && typeof v[0] === 'object');
            if (found) list = found;
          }
          if (list && list.length > 0) return distributeAndBalanceQuizList(list.slice(0, numQuestions));
        }
      } catch (groqErr) {
        console.warn('Groq single test generator error:', groqErr);
      }
    }

    // 2. Try OpenRouter API if key is OpenRouter
    if (provider === 'openrouter' || apiKey.startsWith('sk-or-')) {
      try {
        const orResp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: 'google/gemini-2.0-flash-001',
            messages: [
              { role: 'system', content: 'You are an elite MoEYS curriculum examiner. Return ONLY a valid JSON array of test questions with balanced answer keys (A, B, C, D).' },
              { role: 'user', content: systemPrompt }
            ],
            temperature: 0.3
          })
        });
        if (orResp.ok) {
          const resJson = await orResp.json();
          const content = resJson.choices?.[0]?.message?.content;
          const parsed = extractAndParseJson(content);
          let list = Array.isArray(parsed) ? parsed : (parsed.questions || parsed.preTestQCM || parsed.postTestMCQ || parsed.test || parsed.quiz || parsed.items || []);
          if (!list || list.length === 0) {
            const found = Object.values(parsed || {}).find(v => Array.isArray(v) && v.length > 0 && typeof v[0] === 'object');
            if (found) list = found;
          }
          if (list && list.length > 0) return distributeAndBalanceQuizList(list.slice(0, numQuestions));
        }
      } catch (orErr) {
        console.warn('OpenRouter test generator error:', orErr);
      }
    }

    // 3. Try Google Gemini AI Models with 90-second timeout
    const geminiModels = [];
    if (state.verifiedGeminiModel && state.verifiedGeminiModel.name) {
      geminiModels.push(state.verifiedGeminiModel.name);
    }
    geminiModels.push('gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash-lite');
    const uniqueModels = [...new Set(geminiModels)];

    let lastAiError = null;
    for (const model of uniqueModels) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 90000);
      try {
        const cleanKey = apiKey.trim();
        const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cleanKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: systemPrompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.35,
              maxOutputTokens: 8192
            }
          })
        });
        clearTimeout(timeoutId);
        if (resp.ok) {
          const data = await resp.json();
          const txt = data.candidates?.[0]?.content?.parts?.[0]?.text;
          const parsed = extractAndParseJson(txt);
          let list = null;
          if (Array.isArray(parsed)) {
            list = parsed;
          } else if (parsed && typeof parsed === 'object') {
            const possible = parsed.questions || parsed.preTestQCM || parsed.postTestMCQ ||
                             parsed.test || parsed.quiz || parsed.preTest || parsed.postTest ||
                             parsed.mcqs || parsed.data || parsed.items || parsed.assessment;
            if (Array.isArray(possible) && possible.length > 0) {
              list = possible;
            } else {
              const found = Object.values(parsed).find(v => Array.isArray(v) && v.length > 0 && typeof v[0] === 'object');
              if (found) list = found;
            }
          }
          if (list && list.length > 0) {
            console.log(`[Gemini ${model}] Successfully generated ${list.length} questions`);
            return distributeAndBalanceQuizList(list.slice(0, numQuestions));
          }
        } else {
          const errText = await resp.text().catch(() => '');
          lastAiError = new Error(`Gemini ${model} (${resp.status}): ${errText.slice(0, 80)}`);
          console.warn(`Model ${model} returned status ${resp.status}:`, errText);
        }
      } catch (e) {
        clearTimeout(timeoutId);
        lastAiError = e;
        console.warn(`Model ${model} single test generator error:`, e);
      }
    }

    // 4. Try Backend Server proxy (/api/generate/test) with client apiKey
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 90000);
      const serverResp = await fetch('/api/generate/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          testType,
          plan,
          numQuestions,
          scale: { e, m, h },
          apiKey
        })
      });
      clearTimeout(timeoutId);
      if (serverResp.ok) {
        const serverData = await serverResp.json();
        if (serverData.success && Array.isArray(serverData.data) && serverData.data.length > 0 && !serverData.fallback) {
          return distributeAndBalanceQuizList(serverData.data.slice(0, numQuestions));
        }
      }
    } catch (srvErr) {
      console.warn('Server test generator fallback error:', srvErr);
    }

    throw lastAiError || new Error("Failed to generate test via Gemini AI. Please check your API key.");
  } finally {
    if (!skipOverlay) {
      hideLoadingOverlay();
    }
  }
}

async function generatePreTestOnDemand(numQuestions = 10, scale = null) {
  let plan = state.generatedPlanData || state.currentPlan;
  if (!plan) {
    const title = (document.getElementById('lessonTitleInput')?.value || '').trim();
    const subject = (document.getElementById('subjectSelect')?.value || '').trim();
    const grade = (document.getElementById('gradeSelect')?.value || '').trim();
    if (title || subject) {
      plan = {
        lessonTitle: title || 'មេរៀនទូទៅ',
        subject: subject || 'ចំណេះដឹងទូទៅ',
        grade: grade || 'ថ្នាក់ទូទៅ',
        objectives: { knowledge: ['ស្វែងយល់ខ្លឹមសារមេរៀន'], skills: ['អនុវត្តលំហាត់'], attitudes: ['សហការ'] }
      };
      state.currentPlan = plan;
      state.generatedPlanData = plan;
      renderLessonPlanToA4(plan);
      const empty = document.getElementById('emptyState');
      if (empty) empty.style.display = 'none';
    } else {
      showToast('សូមបង្កើតកិច្ចតែងការ ឬបញ្ចូលចំណងជើងមេរៀនជាមុនសិន!', 'warning');
      return;
    }
  }

  const isEn = (state.language === 'en');
  let wrapper = document.getElementById('preTestModuleWrapper');
  const appendix = document.getElementById('appendixSectionWrapper');
  if (appendix) appendix.style.display = 'block';
  const titleWrapper = document.querySelectorAll('#assessmentSectionTitle');
  titleWrapper.forEach(el => el.style.display = 'flex');

  if (!wrapper) {
    renderLessonPlanToA4(plan);
    const empty = document.getElementById('emptyState');
    if (empty) empty.style.display = 'none';
    wrapper = document.getElementById('preTestModuleWrapper');
    const appEl = document.getElementById('appendixSectionWrapper');
    if (appEl) appEl.style.display = 'block';
  }

  if (wrapper) {
    wrapper.style.display = 'block';
    wrapper.innerHTML = `
      <div style="background: #f8fafc; border: 1.5px solid #c7d2fe; border-radius: 10px; padding: 22px; text-align: center;">
        <i class="fa-solid fa-spinner fa-spin" style="font-size: 2rem; color: #6366f1; margin-bottom: 10px;"></i>
        <div style="font-weight: 700; font-size: 11pt; color: #3730a3;">
          ${isEn ? `AI is generating Pre-Test Diagnostic QCM (${numQuestions} Questions)...` : `AI កំពុងបង្កើតកម្រងសំណួរ Pre-Test (${numQuestions} សំណួរ QCM)...`}
        </div>
        <div style="font-size: 9.5pt; color: #64748b; margin-top: 5px;">
          ${isEn ? `Analyzing "${plan.lessonTitle}" according to Bloom's Taxonomy...` : `កំពុងវិភាគមេរៀន «${plan.lessonTitle}» តាម Bloom's Taxonomy...`}
        </div>
      </div>
    `;
    wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  showToast(isEn ? 'Generating Pre-Test QCM with AI...' : '🤖 កំពុងបង្កើតបុរេតេស្ត (Pre-Test QCM) តាម AI...', 'info');

  try {
    const qList = await callAiForSingleTest('pre', plan, numQuestions, scale);
    if (Array.isArray(qList)) {
      qList.forEach((q, idx) => { q.number = idx + 1; });
    }
    plan.preTestQCM = qList;
    state.currentPlan = plan;
    state.generatedPlanData = plan;

    if (wrapper) {
      wrapper.innerHTML = renderPreTestModule(plan, isEn);
      wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    showToast(isEn ? '✨ Pre-Test QCM generated successfully!' : `✨ បានបង្កើតបុរេតេស្ត (${qList.length} សំណួរ) ដោយជោគជ័យ!`, 'success');
  } catch (err) {
    console.error('Pre-Test generation error:', err);
    if (err.message === 'NEED_API_KEY') {
      if (wrapper) {
        wrapper.innerHTML = `
          <div style="background: #fffbeb; border: 1.5px solid #fde68a; border-radius: 10px; padding: 22px; text-align: center;">
            <div style="font-size: 2rem; margin-bottom: 8px;">🔑</div>
            <div style="font-weight: 700; color: #92400e; font-size: 11pt; margin-bottom: 6px;">
              ${isEn ? 'Gemini API Key Required' : 'តម្រូវឱ្យភ្ជាប់ Gemini API Key'}
            </div>
            <div style="font-size: 9pt; color: #78350f; max-width: 480px; margin: 0 auto 14px; line-height: 1.5;">
              ${isEn ? 'To generate authentic, curriculum-based questions with Google Gemini AI (no robotic templates), please connect your free API key.' : 'ដើម្បីឱ្យ AI បង្កើតកម្រងសំណួរពិតប្រាកដ និងឆ្លាតវៃតាមក្បួនគរុកោសល្យ (គ្មានពុម្ពគំរូទូទៅ) សូមភ្ជាប់ Gemini API Key ឥតគិតថ្លៃ (100% Free)។'}
            </div>
            <button type="button" onclick="openApiKeyModal()" style="padding: 9px 18px; background: linear-gradient(135deg, #4f46e5, #4338ca); color: white; border: none; border-radius: 8px; font-weight: 700; font-size: 9.5pt; cursor: pointer; box-shadow: 0 4px 10px rgba(79, 70, 229, 0.3);">
              <i class="fa-solid fa-key" style="margin-right: 6px;"></i> ${isEn ? 'Connect API Key Now' : 'ភ្ជាប់ API Key ឥឡូវនេះ'}
            </button>
          </div>
        `;
      }
      openApiKeyModal();
      showToast(isEn ? '⚠️ Please connect your Gemini API Key first.' : '⚠️ សូមភ្ជាប់ Google Gemini API Key ដើម្បីបង្កើតសំណួរឆ្លាតវៃតាម AI!', 'warning', 6000);
    } else {
      if (wrapper) {
        wrapper.innerHTML = `
          <div style="background: #fef2f2; border: 1.5px solid #fca5a5; border-radius: 10px; padding: 22px; text-align: center;">
            <div style="font-size: 2rem; margin-bottom: 8px;">❌</div>
            <div style="font-weight: 700; color: #991b1b; font-size: 11pt; margin-bottom: 6px;">
              ${isEn ? 'Gemini AI Pre-Test Generation Failed' : 'ការបង្កើតបុរេតេស្តតាម Gemini AI មិនជោគជ័យ'}
            </div>
            <div style="font-size: 9pt; color: #7f1d1d; max-width: 480px; margin: 0 auto 14px; line-height: 1.5;">
              ${escapeHtml(err.message || 'Error communicating with AI service')}
            </div>
            <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
              <button type="button" onclick="openApiKeyModal()" style="padding: 8px 16px; background: #64748b; color: white; border: none; border-radius: 6px; font-weight: 600; font-size: 9pt; cursor: pointer;">
                <i class="fa-solid fa-key" style="margin-right: 6px;"></i> ${isEn ? 'Check / Change API Key' : 'ពិនិត្យ / ប្តូរ API Key'}
              </button>
              <button type="button" onclick="generatePreTestOnDemand(${numQuestions}, ${JSON.stringify(scale)})" style="padding: 8px 16px; background: #4f46e5; color: white; border: none; border-radius: 6px; font-weight: 700; font-size: 9pt; cursor: pointer;">
                <i class="fa-solid fa-rotate-right" style="margin-right: 6px;"></i> ${isEn ? 'Retry with AI' : 'ព្យាយាមបង្កើតម្តងទៀត'}
              </button>
            </div>
          </div>
        `;
      }
      showToast(isEn ? '❌ AI generation error: ' + (err.message || 'Failed') : `❌ បរាជ័យក្នុងការបង្កើតតាម AI៖ ${err.message || 'សូមពិនិត្យ API Key'}`, 'error', 7000);
    }
  } finally {
    hideLoadingOverlay();
  }
}
window.generatePreTestOnDemand = generatePreTestOnDemand;

async function generatePostTestOnDemand(numQuestions = 10, scale = null) {
  let plan = state.generatedPlanData || state.currentPlan;
  if (!plan) {
    const title = (document.getElementById('lessonTitleInput')?.value || '').trim();
    const subject = (document.getElementById('subjectSelect')?.value || '').trim();
    const grade = (document.getElementById('gradeSelect')?.value || '').trim();
    if (title || subject) {
      plan = {
        lessonTitle: title || 'មេរៀនទូទៅ',
        subject: subject || 'ចំណេះដឹងទូទៅ',
        grade: grade || 'ថ្នាក់ទូទៅ',
        objectives: { knowledge: ['ស្វែងយល់ខ្លឹមសារមេរៀន'], skills: ['អនុវត្តលំហាត់'], attitudes: ['សហការ'] }
      };
      state.currentPlan = plan;
      state.generatedPlanData = plan;
      renderLessonPlanToA4(plan);
      const empty = document.getElementById('emptyState');
      if (empty) empty.style.display = 'none';
    } else {
      showToast('សូមបង្កើតកិច្ចតែងការ ឬបញ្ចូលចំណងជើងមេរៀនជាមុនសិន!', 'warning');
      return;
    }
  }

  const isEn = (state.language === 'en');
  let wrapper = document.getElementById('postTestModuleWrapper');
  const appendix = document.getElementById('appendixSectionWrapper');
  if (appendix) appendix.style.display = 'block';
  const titleWrapper = document.querySelectorAll('#assessmentSectionTitle');
  titleWrapper.forEach(el => el.style.display = 'flex');

  if (!wrapper) {
    renderLessonPlanToA4(plan);
    const empty = document.getElementById('emptyState');
    if (empty) empty.style.display = 'none';
    wrapper = document.getElementById('postTestModuleWrapper');
    const appEl = document.getElementById('appendixSectionWrapper');
    if (appEl) appEl.style.display = 'block';
  }

  if (wrapper) {
    wrapper.style.display = 'block';
    wrapper.innerHTML = `
      <div style="background: #f0fdf4; border: 1.5px solid #86efac; border-radius: 10px; padding: 22px; text-align: center;">
        <i class="fa-solid fa-spinner fa-spin" style="font-size: 2rem; color: #16a34a; margin-bottom: 10px;"></i>
        <div style="font-weight: 700; font-size: 11pt; color: #166534;">
          ${isEn ? `AI is generating Post-Test Diagnostic MCQ (${numQuestions} Questions)...` : `AI កំពុងបង្កើតកម្រងសំណួរ Post-Test (${numQuestions} សំណួរ MCQ)...`}
        </div>
        <div style="font-size: 9.5pt; color: #475569; margin-top: 5px;">
          ${isEn ? `Measuring mastery of "${plan.lessonTitle}" (Bloom's Taxonomy)...` : `កំពុងវិភាគវាស់ស្ទង់សមត្ថភាពសម្រេចបាននៃ «${plan.lessonTitle}» (Bloom's Taxonomy)...`}
        </div>
      </div>
    `;
    wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  showToast(isEn ? 'Generating Post-Test MCQ with AI...' : '🎓 កំពុងបង្កើតបច្ឆិមតេស្ត (Post-Test MCQ) តាម AI...', 'info');

  try {
    const qList = await callAiForSingleTest('post', plan, numQuestions, scale);
    if (Array.isArray(qList)) {
      qList.forEach((q, idx) => { q.number = idx + 1; });
    }
    plan.postTestMCQ = qList;
    state.currentPlan = plan;
    state.generatedPlanData = plan;

    if (wrapper) {
      wrapper.innerHTML = renderPostTestModule(plan, isEn);
      wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    showToast(isEn ? '✨ Post-Test MCQ generated successfully!' : `✨ បានបង្កើតបច្ឆិមតេស្ត (${qList.length} សំណួរ) ដោយជោគជ័យ!`, 'success');
  } catch (err) {
    console.error('Post-Test generation error:', err);
    if (err.message === 'NEED_API_KEY') {
      if (wrapper) {
        wrapper.innerHTML = `
          <div style="background: #fffbeb; border: 1.5px solid #fde68a; border-radius: 10px; padding: 22px; text-align: center;">
            <div style="font-size: 2rem; margin-bottom: 8px;">🔑</div>
            <div style="font-weight: 700; color: #92400e; font-size: 11pt; margin-bottom: 6px;">
              ${isEn ? 'Gemini API Key Required' : 'តម្រូវឱ្យភ្ជាប់ Gemini API Key'}
            </div>
            <div style="font-size: 9pt; color: #78350f; max-width: 480px; margin: 0 auto 14px; line-height: 1.5;">
              ${isEn ? 'To generate authentic, curriculum-based questions with Google Gemini AI (no robotic templates), please connect your free API key.' : 'ដើម្បីឱ្យ AI បង្កើតកម្រងសំណួរពិតប្រាកដ និងឆ្លាតវៃតាមក្បួនគរុកោសល្យ (គ្មានពុម្ពគំរូទូទៅ) សូមភ្ជាប់ Gemini API Key ឥតគិតថ្លៃ (100% Free)។'}
            </div>
            <button type="button" onclick="openApiKeyModal()" style="padding: 9px 18px; background: linear-gradient(135deg, #10b981, #059669); color: white; border: none; border-radius: 8px; font-weight: 700; font-size: 9.5pt; cursor: pointer; box-shadow: 0 4px 10px rgba(16, 185, 129, 0.3);">
              <i class="fa-solid fa-key" style="margin-right: 6px;"></i> ${isEn ? 'Connect API Key Now' : 'ភ្ជាប់ API Key ឥឡូវនេះ'}
            </button>
          </div>
        `;
      }
      openApiKeyModal();
      showToast(isEn ? '⚠️ Please connect your Gemini API Key first.' : '⚠️ សូមភ្ជាប់ Google Gemini API Key ដើម្បីបង្កើតសំណួរឆ្លាតវៃតាម AI!', 'warning', 6000);
    } else {
      if (wrapper) {
        wrapper.innerHTML = `
          <div style="background: #fef2f2; border: 1.5px solid #fca5a5; border-radius: 10px; padding: 22px; text-align: center;">
            <div style="font-size: 2rem; margin-bottom: 8px;">❌</div>
            <div style="font-weight: 700; color: #991b1b; font-size: 11pt; margin-bottom: 6px;">
              ${isEn ? 'Gemini AI Post-Test Generation Failed' : 'ការបង្កើតបច្ឆិមតេស្តតាម Gemini AI មិនជោគជ័យ'}
            </div>
            <div style="font-size: 9pt; color: #7f1d1d; max-width: 480px; margin: 0 auto 14px; line-height: 1.5;">
              ${escapeHtml(err.message || 'Error communicating with AI service')}
            </div>
            <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
              <button type="button" onclick="openApiKeyModal()" style="padding: 8px 16px; background: #64748b; color: white; border: none; border-radius: 6px; font-weight: 600; font-size: 9pt; cursor: pointer;">
                <i class="fa-solid fa-key" style="margin-right: 6px;"></i> ${isEn ? 'Check / Change API Key' : 'ពិនិត្យ / ប្តូរ API Key'}
              </button>
              <button type="button" onclick="generatePostTestOnDemand(${numQuestions}, ${JSON.stringify(scale)})" style="padding: 8px 16px; background: #10b981; color: white; border: none; border-radius: 6px; font-weight: 700; font-size: 9pt; cursor: pointer;">
                <i class="fa-solid fa-rotate-right" style="margin-right: 6px;"></i> ${isEn ? 'Retry with AI' : 'ព្យាយាមបង្កើតម្តងទៀត'}
              </button>
            </div>
          </div>
        `;
      }
      showToast(isEn ? '❌ AI generation error: ' + (err.message || 'Failed') : `❌ បរាជ័យក្នុងការបង្កើតតាម AI៖ ${err.message || 'សូមពិនិត្យ API Key'}`, 'error', 7000);
    }
  } finally {
    hideLoadingOverlay();
  }
}
window.generatePostTestOnDemand = generatePostTestOnDemand;

function removePreTestModule() {
  const plan = state.generatedPlanData || state.currentPlan;
  if (plan) {
    plan.preTestQCM = null;
    const wrapper = document.getElementById('preTestModuleWrapper');
    if (wrapper) wrapper.innerHTML = '';
    const hasPre = Boolean(plan.preTestQCM && plan.preTestQCM.length > 0);
    const hasPost = Boolean(plan.postTestMCQ && plan.postTestMCQ.length > 0);
    if (!hasPre && !hasPost) {
      const appendix = document.getElementById('appendixSectionWrapper');
      if (appendix) appendix.style.display = 'none';
      const titleWrapper = document.querySelectorAll('#assessmentSectionTitle');
      titleWrapper.forEach(el => el.style.display = 'none');
    }
  }
}
window.removePreTestModule = removePreTestModule;

function removePostTestModule() {
  const plan = state.generatedPlanData || state.currentPlan;
  if (plan) {
    plan.postTestMCQ = null;
    const wrapper = document.getElementById('postTestModuleWrapper');
    if (wrapper) wrapper.innerHTML = '';
    const hasPre = Boolean(plan.preTestQCM && plan.preTestQCM.length > 0);
    const hasPost = Boolean(plan.postTestMCQ && plan.postTestMCQ.length > 0);
    if (!hasPre && !hasPost) {
      const appendix = document.getElementById('appendixSectionWrapper');
      if (appendix) appendix.style.display = 'none';
      const titleWrapper = document.querySelectorAll('#assessmentSectionTitle');
      titleWrapper.forEach(el => el.style.display = 'none');
    }
  }
}
window.removePostTestModule = removePostTestModule;

function renderPreTestModule(data, isEn = false) {
  const hasQuestions = data.preTestQCM && Array.isArray(data.preTestQCM) && data.preTestQCM.length > 0;
  if (!hasQuestions) { return ''; }
  return renderPreTestHtmlBlock(data);
}

function renderPostTestModule(data, isEn = false) {
  const hasQuestions = data.postTestMCQ && Array.isArray(data.postTestMCQ) && data.postTestMCQ.length > 0;
  if (!hasQuestions) { return ''; }
  return renderPostTestHtmlBlock(data);
}


function renderLessonPlanToA4(data) {
  const doc = document.getElementById('printableDoc');
  if (!doc) return;

  data = normalizeLessonPlanData(data, data);
  state.currentPlan = data;
  state.generatedPlanData = data;

  const isFlipped = isFlippedLearningRequest(data) || data.templateType === 'flipped_learning';
  const isBd = !isFlipped && (isBackwardDesignRequest(data) || data.templateType === 'backward_design' || Boolean(data.stage1));

  const isEn = (state.language === 'en');

  // Offline Draft Warning Banner
  const offlineWarningBanner = data.isOfflineDraft ? `
    <div class="offline-warning-banner" id="offlineDraftWarningBanner">
      <div style="display: flex; align-items: flex-start; gap: 12px;">
        <span style="font-size: 1.6rem; line-height: 1;">⚠️</span>
        <div>
          <div style="font-weight: 700; color: #92400e; font-size: 10.5pt; margin-bottom: 3px;">
            គ្រោងគំរូសេចក្ដីព្រាង (Offline Draft Template) — មិនទាន់បង្កើតដោយ AI ពិតប្រាកដនៅឡើយទេ
          </div>
          <div style="font-size: 9pt; color: #78350f; line-height: 1.45;">
            ឯកសារខាងក្រោមនេះជាគ្រោងគំរូទូទៅ (Offline Template) ដោយសារមិនទាន់បានបញ្ចូល <strong>Gemini API Key</strong>។ សូមចុចប៊ូតុងខាងស្ដាំដើម្បីភ្ជាប់ Key ឥតគិតថ្លៃ (Free 100%) រួចបង្កើតខ្លឹមសារលម្អិតតាម AI Gemini ពិតប្រាកដ។
          </div>
        </div>
      </div>
      <button type="button" onclick="openApiKeyModal()" style="white-space: nowrap; padding: 8px 14px; background: linear-gradient(135deg, #d97706, #b45309); color: white; border: none; border-radius: 6px; font-weight: 700; font-size: 9pt; cursor: pointer; display: flex; align-items: center; gap: 6px; box-shadow: 0 2px 6px rgba(217, 119, 6, 0.3);">
        <i class="fa-solid fa-key" style="color: #fef08a;"></i> ភ្ជាប់ API Key ឥឡូវនេះ
      </button>
    </div>
  ` : '';

  // Common Header HTML
  const headerHtml = `
    <!-- Top Emblem & Motto -->
    <div class="doc-header-top">
      <div class="doc-motto-kh">${isEn ? 'KINGDOM OF CAMBODIA' : 'ព្រះរាជាណាចក្រកម្ពុជា'}</div>
      <div class="doc-motto-sub">${isEn ? 'NATION RELIGION KING' : 'ជាតិ សាសនា ព្រះមហាក្សត្រ'}</div>
      <div style="font-size: 14pt; letter-spacing: 2px;">***</div>
    </div>

    <!-- Meta School & Date Row -->
    <div class="doc-meta-row">
      <div class="doc-school-info">
        <div><strong>${isEn ? 'School / Institution:' : 'គ្រឹះស្ថានសិក្សា៖'}</strong> ${escapeHtml(data.school || '')}</div>
        <div><strong>${isEn ? 'Teacher:' : 'ឈ្មោះគ្រូបង្រៀន៖'}</strong> ${escapeHtml(data.teacher || '')}</div>
        <div><strong>${isEn ? 'Subject:' : 'មុខវិជ្ជា៖'}</strong> ${escapeHtml(data.subject || '')} | <strong>${isEn ? 'Grade:' : 'កម្រិត៖'}</strong> ${escapeHtml(data.grade || '')}</div>
      </div>
      <div class="doc-date-info">
        <div>${escapeHtml(data.dateStr || '')}</div>
        <div><strong>${isEn ? 'Duration:' : 'រយៈពេល៖'}</strong> ${escapeHtml(data.duration || '')}</div>
      </div>
    </div>

    <!-- Main Title Banner -->
    <div class="doc-main-title">${escapeHtml(data.templateTitle || (isFlipped ? (isEn ? 'FLIPPED LEARNING LESSON PLAN' : 'កិច្ចតែងការបង្រៀនតាមបែបថ្នាក់រៀនត្រឡប់') : (isBd ? (isEn ? 'BACKWARD DESIGN (UbD) LESSON PLAN' : 'កិច្ចតែងការបង្រៀន (តាមបែបត្រឡប់ - Backward Design / UbD)') : (isEn ? 'LESSON PLAN' : 'កិច្ចតែងការបង្រៀន'))))}</div>
    
    <div class="doc-lesson-banner">
      ${data.chapter ? `<div><strong>${escapeHtml(data.chapter)}</strong></div>` : ''}
      <div style="font-size: 11.5pt; font-weight: bold; color: #1e293b;">${escapeHtml(data.lessonTitle || '')}</div>
      ${data.method ? `<div style="font-size: 9.5pt; color: #475569; margin-top: 2px;"><strong>${isEn ? 'Teaching Method:' : 'វិធីសាស្ត្របង្រៀន៖'}</strong> ${escapeHtml(data.method)}</div>` : ''}
    </div>
  `;

  // Common Signatures HTML
  const signaturesHtml = `
    <!-- Signatures -->
    <div class="doc-footer-signatures">
      <div class="sig-box">
        <div>${isEn ? 'Seen and Approved' : 'បានឃើញ និងឯកភាព'}</div>
        <div style="font-weight: bold; margin-top: 2px;">${isEn ? 'School Principal / Director' : 'នាយក/នាយិកាសាលា'}</div>
        <div class="sig-space"></div>
      </div>
      <div class="sig-box">
        <div>${escapeHtml(data.dateStr || '')}</div>
        <div style="font-weight: bold; margin-top: 2px;">${isEn ? "Teacher's Signature" : 'ហត្ថលេខាគ្រូបង្រៀន'}</div>
        <div class="sig-space"></div>
        <div style="font-weight: bold;">${escapeHtml(data.teacher || '')}</div>
      </div>
    </div>
  `;

  if (isFlipped) {
    let flippedStepsHtml = '';
    (data.steps || []).forEach(step => {
      flippedStepsHtml += `
        <tr style="background: #f1f5f9;">
          <td colspan="3" style="font-weight: bold; font-size: 10.5pt; color: #0f172a; padding: 7px 10px; border: 1px solid #cbd5e1;">
            ${escapeHtml(step.stepTitle)} <span style="color: #0369a1; font-weight: 700; font-size: 9.5pt;">(${escapeHtml(step.duration)})</span>
          </td>
        </tr>
        <tr>
          <td style="width: 35%; vertical-align: top; padding: 8px 10px; border: 1px solid #cbd5e1;">${formatLineBreaks(step.teacherActivity)}</td>
          <td style="width: 35%; vertical-align: top; font-weight: 500; padding: 8px 10px; border: 1px solid #cbd5e1;">${formatLineBreaks(step.contentSummary)}</td>
          <td style="width: 30%; vertical-align: top; padding: 8px 10px; border: 1px solid #cbd5e1;">${formatLineBreaks(step.studentActivity)}</td>
        </tr>
      `;
    });

    doc.innerHTML = `
      ${offlineWarningBanner}
      <!-- Top Emblem & Motto -->
      <div class="doc-header-top">
        <div class="doc-motto-kh">ព្រះរាជាណាចក្រកម្ពុជា</div>
        <div class="doc-motto-sub">ជាតិ សាសនា ព្រះមហាក្សត្រ</div>
        <div style="font-size: 14pt; letter-spacing: 2px;">***</div>
      </div>

      <!-- Main Title Banner -->
      <div class="doc-main-title" style="margin-top: 10px; margin-bottom: 12px;">កិច្ចតែងការបង្រៀនតាមបែបត្រឡប់</div>

      <!-- Meta School & Higher-Ed Grid Row -->
      <div style="display: grid; grid-template-columns: 1.2fr 1fr; gap: 14px; margin-bottom: 14px; padding: 10px 14px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 10.5pt; line-height: 1.6;">
        <div>
          <div><strong>មុខវិជ្ជា៖</strong> ${escapeHtml(data.subject || 'ចិត្តវិទ្យាអប់រំ')}</div>
          <div><strong>ចំនួនក្រេឌីត៖</strong> ${escapeHtml(data.credits || '៣ ក្រេឌីត (៣-០-៦)')}</div>
          <div><strong>ឆ្នាំទី៖</strong> ${escapeHtml(data.year || '១')}  &nbsp;&nbsp;<strong>ឆមាសទី៖</strong> ${escapeHtml(data.semester || '២')}</div>
          <div><strong>សប្តាហ៍ទី៖</strong> ${escapeHtml(data.week || '១')}  &nbsp;&nbsp;<strong>មេរៀនទី៖</strong> ${escapeHtml(data.lessonNumber || '១')}</div>
        </div>
        <div style="text-align: right;">
          <div><strong>រយៈពេល៖</strong> ${escapeHtml(data.duration || '១៨០ នាទី')}</div>
          <div><strong>គ្រូឧទ្ទេស៖</strong> ${escapeHtml(data.teacher || 'កែម បូរី')}</div>
          <div>${escapeHtml(data.dateStr || '')}</div>
        </div>
      </div>

      <div class="doc-lesson-banner" style="margin-bottom: 16px;">
        ${data.chapter ? `<div><strong>${escapeHtml(data.chapter)}</strong></div>` : ''}
        <div style="font-size: 11.5pt; font-weight: bold; color: #1e293b;">ចំណងជើងមេរៀន៖ ${escapeHtml(data.lessonTitle || '')}</div>
      </div>

      <!-- Section 1: Objectives -->
      <div class="doc-section-title">១. វត្ថុបំណង</div>
      <div style="margin-left: 10px; margin-bottom: 12px;">
        <div style="font-style: italic; margin-bottom: 4px; font-weight: 600;">បន្ទាប់ពីរៀនមេរៀននេះចប់ គរុនិស្សិតនឹង៖</div>
        <div style="font-weight: 600; margin-top: 4px;">• វិជ្ជាសម្បទា៖</div>
        <ul class="doc-list" style="margin-top: 2px;">
          ${(data.objectives?.knowledge || []).map(k => `<li>${escapeHtml(k)}</li>`).join('')}
        </ul>
        <div style="font-weight: 600; margin-top: 4px;">• បំណិនសម្បទា៖</div>
        <ul class="doc-list" style="margin-top: 2px;">
          ${(data.objectives?.skills || []).map(s => `<li>${escapeHtml(s)}</li>`).join('')}
        </ul>
        <div style="font-weight: 600; margin-top: 4px;">• ចរិយាសម្បទា៖</div>
        <ul class="doc-list" style="margin-top: 2px;">
          ${(data.objectives?.attitudes || []).map(a => `<li>${escapeHtml(a)}</li>`).join('')}
        </ul>
      </div>

      <!-- Section 2: Materials -->
      <div class="doc-section-title">២. សម្ភារឧបទេស</div>
      <div style="margin-left: 10px; margin-bottom: 14px;">
        <div>កិច្ចតែងការបង្រៀន វីដេអូបង្រៀន បុរេតេស្ត តេស្តបញ្ចប់ និងកិច្ចការផ្ទះ</div>
        <div style="margin-top: 4px;">• <strong>សម្រាប់គ្រូ៖</strong> ${escapeHtml((data.materials?.teacher || []).join(', '))}</div>
        <div style="margin-top: 2px;">• <strong>សម្រាប់និស្សិត៖</strong> ${escapeHtml((data.materials?.student || []).join(', '))}</div>
      </div>

      <!-- Section 3: Method -->
      <div class="doc-section-title">៣. វិធីសាស្រ្ដបង្រៀន</div>
      <div style="margin-left: 10px; margin-bottom: 12px; font-size: 10pt;">
        <div>- ការរៀនបែបត្រឡប់ (Flipped Learning ៥ ជំហាន: ៥% - ១០% - ១០% - ៧០% - ៥%)</div>
      </div>

      <!-- Section 4: In-Class Process (3 Columns) -->
      <div class="doc-section-title">៤. ដំណើរការបង្រៀនក្នុងថ្នាក់ (${escapeHtml(data.duration || '១៨០ នាទី')})</div>
      <table class="doc-table">
        <thead>
          <tr>
            <th style="width: 35%;">សកម្មភាពគ្រូ</th>
            <th style="width: 35%;">ខ្លឹមសារ</th>
            <th style="width: 30%;">សកម្មភាពសិស្ស</th>
          </tr>
        </thead>
        <tbody>
          ${flippedStepsHtml}
        </tbody>
      </table>

      <!-- Signatures closing Lesson Plan -->
      <div class="doc-footer-signatures" style="margin-top: 28px;">
        <div class="sig-box">
          <div>បានឃើញ និងឯកភាព</div>
          <div style="font-weight: bold; margin-top: 2px;">ប្រធានដេប៉ាតឺម៉ង់ / គណៈគ្រប់គ្រង</div>
          <div class="sig-space"></div>
        </div>
        <div class="sig-box">
          <div>${escapeHtml(data.dateStr || '')}</div>
          <div style="font-weight: bold; margin-top: 2px;">ហត្ថលេខាគ្រូឧទ្ទេស</div>
          <div class="sig-space"></div>
          <div style="font-weight: bold;">${escapeHtml(data.teacher || 'កែម បូរី')}</div>
        </div>
      </div>

      <!-- Footnote License -->
      <div style="margin-top: 26px; padding-top: 10px; border-top: 1px dashed #cbd5e1; font-size: 9pt; color: #475569; font-style: italic;">
        * អាជ្ញាបណ្ណ និងកម្មសិទ្ធិ (License)： ខ្ញុំឈ្មោះកែម បូរី ជាគ្រូឧទ្ទេសមុខវិជ្ជាចិត្តវិទ្យាអប់រំ នៅវិទ្យាស្ថានគរុកោសល្យកំពង់ចាម
      </div>

      <!-- 📎 APPENDIX: Pre-Test & Post-Test on the page after signatures -->
      <div id="appendixSectionWrapper" class="doc-appendix-wrapper" style="page-break-before: always; break-before: page; margin-top: 36px; ${ (data.preTestQCM?.length > 0 || data.postTestMCQ?.length > 0) ? '' : 'display: none;' }">
        <div class="appendix-page-divider">
          <span>📄 ទំព័របន្ទាប់ (Next Page) — ឯកសារឧបសម្ព័ន្ធ (Appendix)</span>
        </div>

        <div id="assessmentSectionTitle" class="doc-appendix-header">
          <div>
            <div style="font-size: 12.5pt; font-weight: 800; color: #1e3a8a; font-family: 'Kantumruy Pro', 'Khmer OS Siemreap', sans-serif;">
              📎 ឯកសារឧបសម្ព័ន្ធ (Appendix)
            </div>
            <div style="font-size: 9.5pt; color: #475569; margin-top: 2px; font-weight: 600;">
              វិញ្ញាសាស្ទង់សមត្ថភាពមុនម៉ោង (Pre-Test) និងតេស្តវាស់ស្ទង់សមត្ថភាព (Post-Test)
            </div>
          </div>
          <span style="font-size: 8.5pt; background: #e0e7ff; color: #3730a3; padding: 4px 12px; border-radius: 12px; font-weight: 700;">
            ឯកសារភ្ជាប់កិច្ចតែងការ
          </span>
        </div>

        <div class="test-modules-container" style="display: flex; flex-direction: column; gap: 16px; margin-bottom: 20px;">
          <div id="preTestModuleWrapper">${renderPreTestModule(data, false)}</div>
          <div id="postTestModuleWrapper">${renderPostTestModule(data, false)}</div>
        </div>

        <!-- Learning Gain & Reflection Block -->
        ${renderLearningGainReflectionBlock(data)}
      </div>
    `;
    return;
  }

  if (isBd) {
    const stage1 = data.stage1 || {};
    const stage2 = data.stage2 || {};
    const stage3 = data.stage3 || {};
    const activities = stage3.learningActivities || data.steps || [];

    let activitiesHtml = '';
    activities.forEach(step => {
      activitiesHtml += `
        <tr>
          <td style="text-align: center; font-weight: bold; width: 16%;">${escapeHtml(step.stepTitle)}<br><small style="color: #475569;">(${escapeHtml(step.duration)})</small></td>
          <td style="width: 30%;">${formatLineBreaks(step.teacherActivity)}</td>
          <td style="width: 25%; font-weight: 500;">${formatLineBreaks(step.contentSummary)}</td>
          <td style="width: 29%;">${formatLineBreaks(step.studentActivity)}</td>
        </tr>
      `;
    });

    doc.innerHTML = `
      ${offlineWarningBanner}
      ${headerHtml}

      <!-- Stage 1: Desired Results -->
      <div class="doc-section-title">I. ដំណាក់កាលទី ១ : ការកំណត់លទ្ធផលរំពឹងទុក (Stage 1: Desired Results)</div>
      <div style="margin-left: 10px; margin-bottom: 12px;">
        ${stage1.establishedGoals ? `<div style="margin-bottom: 6px;"><strong>១. គោលបំណងចម្បង / ស្តង់ដារសិក្សា៖</strong> ${escapeHtml(stage1.establishedGoals)}</div>` : ''}
        
        <div style="font-weight: 600; margin-top: 4px;">២. ការយល់ដឹងស្នូល (Enduring Understandings) & សំណួរគន្លឹះ (Essential Questions)៖</div>
        <div style="margin-left: 12px; margin-top: 2px;">
          <div>• <em>ការយល់ដឹងស្នូល (Enduring Understandings)៖</em></div>
          <ul class="doc-list" style="margin-top: 2px; margin-bottom: 6px;">
            ${(stage1.enduringUnderstandings || []).map(u => `<li>${escapeHtml(u)}</li>`).join('')}
          </ul>
          <div>• <em>សំណួរគន្លឹះដាស់ការត្រិះរិះ (Essential Questions)៖</em></div>
          <ul class="doc-list" style="margin-top: 2px; margin-bottom: 6px;">
            ${(stage1.essentialQuestions || []).map(q => `<li>${escapeHtml(q)}</li>`).join('')}
          </ul>
        </div>

        <div style="font-weight: 600; margin-top: 6px;">៣. វត្ថុបំណងជាក់លាក់ (Specific Objectives)៖</div>
        <ul class="doc-list">
          <li><strong>វិជ្ជាសម្បទា (ចំណេះដឹង)៖</strong> ${(stage1.objectives?.knowledge || data.objectives?.knowledge || []).join('; ')}</li>
          <li><strong>បំណិនសម្បទា (បំណិន)៖</strong> ${(stage1.objectives?.skills || data.objectives?.skills || []).join('; ')}</li>
          <li><strong>ចរិយាសម្បទា (ឥរិយាបថ)៖</strong> ${(stage1.objectives?.attitudes || data.objectives?.attitudes || []).join('; ')}</li>
        </ul>
      </div>

      <!-- Stage 2: Assessment Evidence -->
      <div class="doc-section-title">II. ដំណាក់កាលទី ២ : ការកំណត់ភស្តុតាងនៃការវាយតម្លៃ (Stage 2: Assessment Evidence)</div>
      <div style="margin-left: 10px; margin-bottom: 14px;">
        <div style="font-weight: 600;">១. ភារកិច្ចវាស់ស្ទង់សមត្ថភាព / កិច្ចការអនុវត្ត (Performance Tasks)៖</div>
        <ul class="doc-list" style="margin-top: 2px; margin-bottom: 6px;">
          ${(stage2.performanceTasks || []).map(pt => `<li>${escapeHtml(pt)}</li>`).join('')}
        </ul>

        <div style="font-weight: 600; margin-top: 4px;">២. ភស្តុតាងផ្សេងៗទៀត (Other Evidence) & លក្ខណៈវិនិច្ឆ័យ (Criteria)៖</div>
        <ul class="doc-list" style="margin-top: 2px; margin-bottom: 4px;">
          ${(stage2.otherEvidence || []).map(oe => `<li>${escapeHtml(oe)}</li>`).join('')}
        </ul>
        ${stage2.criteria && stage2.criteria.length > 0 ? `<div style="font-size: 9.5pt; color: #334155; margin-left: 12px;"><em>លក្ខណៈវិនិច្ឆ័យវាយតម្លៃ៖</em> ${escapeHtml(stage2.criteria.join(' | '))}</div>` : ''}
      </div>

      <!-- Stage 3: Learning Plan -->
      <div class="doc-section-title" style="margin-top: 16px;">III. ដំណាក់កាលទី ៣ : ផែនការរៀបចំការបង្រៀន និងរៀន (Stage 3: Learning Plan)</div>
      <div style="margin-left: 10px; margin-bottom: 8px;">
        <div>• <strong>សម្ភារឧបទេស៖</strong> សម្រាប់គ្រូ៖ ${escapeHtml((stage3.materials?.teacher || data.materials?.teacher || []).join(', '))} | សម្រាប់សិស្ស៖ ${escapeHtml((stage3.materials?.student || data.materials?.student || []).join(', '))}</div>
      </div>

      <table class="doc-table">
        <thead>
          <tr>
            <th style="width: 16%;">ដំណាក់កាល និងពេល</th>
            <th style="width: 30%;">សកម្មភាពគ្រូ</th>
            <th style="width: 25%;">ខ្លឹមសារមេរៀន</th>
            <th style="width: 29%;">សកម្មភាពសិស្ស</th>
          </tr>
        </thead>
        <tbody>
          ${activitiesHtml}
        </tbody>
      </table>

      <!-- Signatures closing Lesson Plan -->
      ${signaturesHtml}

      <!-- 📎 APPENDIX: Pre-Test & Post-Test on the page after signatures -->
      <div id="appendixSectionWrapper" class="doc-appendix-wrapper" style="page-break-before: always; break-before: page; margin-top: 36px; ${ (data.preTestQCM?.length > 0 || data.postTestMCQ?.length > 0) ? '' : 'display: none;' }">
        <div class="appendix-page-divider">
          <span>📄 ទំព័របន្ទាប់ (Next Page) — ឯកសារឧបសម្ព័ន្ធ (Appendix)</span>
        </div>

        <div id="assessmentSectionTitle" class="doc-appendix-header">
          <div>
            <div style="font-size: 12.5pt; font-weight: 800; color: #1e3a8a; font-family: 'Kantumruy Pro', 'Khmer OS Siemreap', sans-serif;">
              📎 ឯកសារឧបសម្ព័ន្ធ (Appendix)
            </div>
            <div style="font-size: 9.5pt; color: #475569; margin-top: 2px; font-weight: 600;">
              ${isEn ? 'Diagnostic & Mastery Assessments (Pre-Test & Post-Test)' : 'វិញ្ញាសាស្ទង់សមត្ថភាពមុនម៉ោង (Pre-Test) និងតេស្តវាស់ស្ទង់សមត្ថភាព (Post-Test)'}
            </div>
          </div>
          <span style="font-size: 8.5pt; background: #e0e7ff; color: #3730a3; padding: 4px 12px; border-radius: 12px; font-weight: 700;">
            ${isEn ? 'Assessment Appendix' : 'ឯកសារភ្ជាប់កិច្ចតែងការ'}
          </span>
        </div>

        <div class="test-modules-container" style="display: flex; flex-direction: column; gap: 16px; margin-bottom: 20px;">
          <div id="preTestModuleWrapper">${renderPreTestModule(data, isEn)}</div>
          <div id="postTestModuleWrapper">${renderPostTestModule(data, isEn)}</div>
        </div>

        <!-- Learning Gain & Reflection Block -->
        ${renderLearningGainReflectionBlock(data)}
      </div>
    `;
    return;
  }

  // 5-Step Process Rendering (MoEYS Standard, Flipped Learning, Primary School, STEM/5E)
  let stepsHtml = '';
  (data.steps || []).forEach(step => {
    stepsHtml += `
      <tr>
        <td style="text-align: center; font-weight: bold; width: 16%;">${escapeHtml(step.stepTitle)}<br><span style="color: #0369a1; font-weight: 700; font-size: 9pt;">(${escapeHtml(step.duration)})</span></td>
        <td style="width: 30%;">${formatLineBreaks(step.teacherActivity)}</td>
        <td style="width: 25%; font-weight: 500;">${formatLineBreaks(step.contentSummary)}</td>
        <td style="width: 29%;">${formatLineBreaks(step.studentActivity)}</td>
      </tr>
    `;
  });

  doc.innerHTML = `
    ${offlineWarningBanner}
    ${headerHtml}

    <!-- Section I: Objectives -->
    <div class="doc-section-title">I. វត្ថុបំណង (Objectives)</div>
    <div style="margin-left: 10px; margin-bottom: 12px;">
      ${data.objectives?.intro ? `<div style="font-style: italic; margin-bottom: 4px; font-weight: 600;">${escapeHtml(data.objectives.intro)}</div>` : ''}
      <div style="font-weight: 600; margin-top: 4px;">១. វិជ្ជាសម្បទា (ចំណេះដឹង)៖</div>
      <ul class="doc-list" style="margin-top: 2px;">
        ${(data.objectives?.knowledge || []).map(k => `<li>${escapeHtml(k)}</li>`).join('')}
      </ul>

      <div style="font-weight: 600; margin-top: 4px;">២. បំណិនសម្បទា (បំណិន)៖</div>
      <ul class="doc-list" style="margin-top: 2px;">
        ${(data.objectives?.skills || []).map(s => `<li>${escapeHtml(s)}</li>`).join('')}
      </ul>

      <div style="font-weight: 600; margin-top: 4px;">៣. ចរិយាសម្បទា (ឥរិយាបថ)៖</div>
      <ul class="doc-list" style="margin-top: 2px;">
        ${(data.objectives?.attitudes || []).map(a => `<li>${escapeHtml(a)}</li>`).join('')}
      </ul>
    </div>

    <!-- Section II: Materials -->
    <div class="doc-section-title">II. សម្ភារឧបទេស (Teaching Aids / Materials)</div>
    <div style="margin-left: 10px; margin-bottom: 14px;">
      <div>• <strong>សម្រាប់គ្រូ៖</strong> ${escapeHtml((data.materials?.teacher || []).join(', '))}</div>
      <div style="margin-top: 4px;">• <strong>សម្រាប់សិស្ស៖</strong> ${escapeHtml((data.materials?.student || []).join(', '))}</div>
    </div>

    ${data.method ? `
    <!-- Teaching Method -->
    <div class="doc-section-title" style="font-size: 11.5pt;">៣. វិធីសាស្រ្ដបង្រៀន</div>
    <div style="margin-left: 10px; margin-bottom: 12px; font-size: 10pt;">
      ${renderTeachingMethodContent(data.method)}
    </div>` : ''}

    <!-- Section IV: In-Class Process -->
    <div class="doc-section-title">IV. ដំណើរការបង្រៀន និងរៀនក្នុងថ្នាក់ (In-Class Teaching Process)</div>
    <table class="doc-table">
      <thead>
        <tr>
          <th style="width: 16%;">${isEn ? 'Step & Timing' : 'ជំហាន និងពេលវេលា'}</th>
          <th style="width: 30%;">${isEn ? "Teacher's Activity" : 'សកម្មភាពគ្រូ'}</th>
          <th style="width: 25%;">${isEn ? 'Lesson Content' : 'ខ្លឹមសារមេរៀន'}</th>
          <th style="width: 29%;">${isEn ? "Students' Activity" : 'សកម្មភាពសិស្ស'}</th>
        </tr>
      </thead>
      <tbody>
        ${stepsHtml}
      </tbody>
    </table>

    <!-- Signatures closing Lesson Plan -->
    ${signaturesHtml}

    <!-- 📎 APPENDIX: Pre-Test & Post-Test on the page after signatures -->
    <div id="appendixSectionWrapper" class="doc-appendix-wrapper" style="page-break-before: always; break-before: page; margin-top: 36px; ${ (data.preTestQCM?.length > 0 || data.postTestMCQ?.length > 0) ? '' : 'display: none;' }">
      <div class="appendix-page-divider">
        <span>📄 ទំព័របន្ទាប់ (Next Page) — ឯកសារឧបសម្ព័ន្ធ (Appendix)</span>
      </div>

      <div id="assessmentSectionTitle" class="doc-appendix-header">
        <div>
          <div style="font-size: 12.5pt; font-weight: 800; color: #1e3a8a; font-family: 'Kantumruy Pro', 'Khmer OS Siemreap', sans-serif;">
            📎 ឯកសារឧបសម្ព័ន្ធ (Appendix)
          </div>
          <div style="font-size: 9.5pt; color: #475569; margin-top: 2px; font-weight: 600;">
            ${isEn ? 'Diagnostic & Mastery Assessments (Pre-Test & Post-Test)' : 'វិញ្ញាសាស្ទង់សមត្ថភាពមុនម៉ោង (Pre-Test) និងតេស្តវាស់ស្ទង់សមត្ថភាព (Post-Test)'}
          </div>
        </div>
        <span style="font-size: 8.5pt; background: #e0e7ff; color: #3730a3; padding: 4px 12px; border-radius: 12px; font-weight: 700;">
          ${isEn ? 'Assessment Appendix' : 'ឯកសារភ្ជាប់កិច្ចតែងការ'}
        </span>
      </div>

      <div class="test-modules-container" style="display: flex; flex-direction: column; gap: 16px; margin-bottom: 20px;">
        <div id="preTestModuleWrapper">${renderPreTestModule(data, isEn)}</div>
        <div id="postTestModuleWrapper">${renderPostTestModule(data, isEn)}</div>
      </div>

      <!-- Learning Gain & Reflection Block -->
      ${renderLearningGainReflectionBlock(data)}
    </div>
  `;
}


function formatLineBreaks(str) {
  if (!str) return '';
  return escapeHtml(str).replace(/\n/g, '<br>');
}

function escapeHtml(text) {
  if (text == null) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

// ==========================================================================
// Custom Template Storage & Library System
// ==========================================================================

function loadSavedTemplates() {
  try {
    const raw = localStorage.getItem(SAVED_TEMPLATES_STORAGE_KEY);
    state.savedTemplates = raw ? JSON.parse(raw) : [];
    updateSavedTemplatesUI();
  } catch (e) {
    console.error('Error loading saved templates:', e);
    state.savedTemplates = [];
    updateSavedTemplatesUI();
  }
}

function updateSavedTemplatesUI() {
  const badge = document.getElementById('savedTemplatesCountBadge');
  const count = state.savedTemplates.length;
  if (badge) badge.textContent = `${count} Template`;

  const select = document.getElementById('savedTemplateSelect');
  const detailsCard = document.getElementById('savedTemplateDetailsCard');
  const emptyState = document.getElementById('savedTemplatesEmptyState');

  if (!select) return;
  select.innerHTML = '';

  if (count === 0) {
    if (detailsCard) detailsCard.style.display = 'none';
    if (emptyState) emptyState.style.display = 'block';
    select.style.display = 'none';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';
  select.style.display = 'block';

  state.savedTemplates.forEach((tmpl, idx) => {
    const opt = document.createElement('option');
    opt.value = tmpl.id;
    opt.textContent = `📋 ${tmpl.name} (${tmpl.date || 'បានរក្សាទុក'})`;
    if (state.selectedSavedTemplateId === tmpl.id || (!state.selectedSavedTemplateId && idx === 0)) {
      opt.selected = true;
      state.selectedSavedTemplateId = tmpl.id;
    }
    select.appendChild(opt);
  });

  renderSelectedSavedTemplateDetails();
}

function renderSelectedSavedTemplateDetails() {
  const detailsCard = document.getElementById('savedTemplateDetailsCard');
  const nameEl = document.getElementById('selectedSavedTemplateName');
  const dateEl = document.getElementById('selectedSavedTemplateDate');
  const snippetEl = document.getElementById('selectedSavedTemplateSnippet');

  if (!state.savedTemplates || state.savedTemplates.length === 0) {
    if (detailsCard) detailsCard.style.display = 'none';
    return;
  }

  const selected = state.savedTemplates.find(t => t.id === state.selectedSavedTemplateId) || state.savedTemplates[0];
  if (!selected) {
    if (detailsCard) detailsCard.style.display = 'none';
    return;
  }

  if (detailsCard) detailsCard.style.display = 'block';
  if (nameEl) nameEl.textContent = selected.name;
  if (dateEl) dateEl.textContent = `កាលបរិច្ឆេទ: ${selected.date || 'ថ្មីៗ'} | ឯកសារដើម: ${selected.fileName || 'ផ្ទាល់ខ្លួន'}`;
  if (snippetEl) {
    const preview = selected.content.length > 220 ? selected.content.substring(0, 220) + '...' : selected.content;
    snippetEl.textContent = preview || '(គ្មានខ្លឹមសារអត្ថបទ)';
  }

  if (state.templateMode === 'saved') {
    state.customTemplateText = selected.content;
    state.customTemplateFileName = selected.fileName || selected.name;
  }
}

function saveCustomTemplate(name, content, fileName) {
  if (!content || !content.trim()) {
    showToast('សូមបញ្ចូល ឬ Upload ឯកសារ Template ជាមុនសិន!', 'warning');
    return;
  }

  let tmplName = (name || '').trim();
  if (!tmplName) {
    if (fileName) {
      tmplName = fileName.replace(/\.[^/.]+$/, "");
    } else {
      tmplName = `Template ផ្ទាល់ខ្លួន ${state.savedTemplates.length + 1}`;
    }
  }

  const newTmpl = {
    id: 'tmpl_' + Date.now(),
    name: tmplName,
    fileName: fileName || 'custom_template.txt',
    content: content.trim(),
    date: getKhmerFormattedDate()
  };

  state.savedTemplates.unshift(newTmpl);
  localStorage.setItem(SAVED_TEMPLATES_STORAGE_KEY, JSON.stringify(state.savedTemplates));
  state.selectedSavedTemplateId = newTmpl.id;

  loadSavedTemplates();
  showToast(`💾 បានរក្សាទុក Template "${tmplName}" ទៅក្នុងបណ្ណាល័យជោគជ័យ!`, 'success');
}

function deleteSavedTemplate(id) {
  const tmpl = state.savedTemplates.find(t => t.id === id);
  const name = tmpl ? tmpl.name : 'Template';
  if (!confirm(`តើអ្នកពិតជាចង់លុប Template "${name}" នេះចេញពីបណ្ណាល័យមែនទេ?`)) {
    return;
  }

  state.savedTemplates = state.savedTemplates.filter(t => t.id !== id);
  localStorage.setItem(SAVED_TEMPLATES_STORAGE_KEY, JSON.stringify(state.savedTemplates));
  state.selectedSavedTemplateId = state.savedTemplates.length > 0 ? state.savedTemplates[0].id : null;
  loadSavedTemplates();
  showToast(`បានលុប Template "${name}" ចេញរួចរាល់`, 'info');
}

// ==========================================================================
// Admin Profile Storage & Memory System
// ==========================================================================

function saveAdminProfile(silent = false) {
  const school = document.getElementById('inputSchool').value.trim();
  const teacher = document.getElementById('inputTeacher').value.trim();
  const degree = document.getElementById('inputDegree').value;
  const grade = document.getElementById('inputGrade').value;
  const customGrade = document.getElementById('inputCustomGradeText').value.trim();
  const subject = document.getElementById('inputSubject').value;
  const duration = getDurationValue();
  const method = document.getElementById('inputMethod').value;

  const profile = {
    school,
    teacher,
    degree,
    grade,
    customGrade,
    subject,
    duration,
    method
  };

  localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(profile));
  updateSavedProfileUI(true);

  if (!silent) {
    showToast('💾 បានរក្សាទុកព័ត៌មានរដ្ឋបាលសម្រាប់លើកក្រោយរួចរាល់!', 'success');
  }
}

function loadSavedAdminProfile() {
  try {
    const raw = localStorage.getItem(ADMIN_STORAGE_KEY);
    const degreeSelect = document.getElementById('inputDegree');

    if (!raw) {
      if (degreeSelect) updateGradeOptions(degreeSelect.value || 'lower_sec');
      updateSavedProfileUI(false);
      return;
    }
    const profile = JSON.parse(raw);
    if (!profile) {
      if (degreeSelect) updateGradeOptions(degreeSelect.value || 'lower_sec');
      return;
    }

    if (profile.school !== undefined) document.getElementById('inputSchool').value = profile.school;
    if (profile.teacher !== undefined) document.getElementById('inputTeacher').value = profile.teacher;
    if (profile.method !== undefined) document.getElementById('inputMethod').value = profile.method;
    if (profile.subject !== undefined) document.getElementById('inputSubject').value = profile.subject;
    if (profile.duration !== undefined) setDurationValue(profile.duration);

    const activeDegree = profile.degree || (degreeSelect ? degreeSelect.value : 'lower_sec');
    if (degreeSelect) degreeSelect.value = activeDegree;
    const targetGrade = profile.grade === 'custom' ? profile.customGrade : profile.grade;
    updateGradeOptions(activeDegree, targetGrade);

    updateSavedProfileUI(true);
    if (typeof updateTeacherProfileSummaryLive === 'function') updateTeacherProfileSummaryLive();
    if (typeof syncDurationChipsFromSelect === 'function') syncDurationChipsFromSelect();
    const fields = document.getElementById('teacherProfileFields');
    const btnText = document.getElementById('btnToggleProfileEditText');
    if (fields) fields.style.display = 'none';
    if (btnText) btnText.textContent = 'កែប្រែ';
  } catch (err) {
    console.error('Error loading saved admin profile:', err);
    const degreeSelect = document.getElementById('inputDegree');
    if (degreeSelect) updateGradeOptions(degreeSelect.value || 'lower_sec');
  }
}

function clearSavedAdminProfile() {
  localStorage.removeItem(ADMIN_STORAGE_KEY);
  updateSavedProfileUI(false);
  if (typeof updateTeacherProfileSummaryLive === 'function') updateTeacherProfileSummaryLive();
  const fields = document.getElementById('teacherProfileFields');
  const btnText = document.getElementById('btnToggleProfileEditText');
  if (fields) fields.style.display = 'flex';
  if (btnText) btnText.textContent = 'បង្រួម';
  showToast('បានលុបព័ត៌មានរដ្ឋបាលដែលបានចងចាំចេញរួចរាល់', 'info');
}

function updateSavedProfileUI(hasSaved) {
  const badge = document.getElementById('savedProfileBadge');
  const btnClear = document.getElementById('btnClearAdminInfo');
  if (badge) badge.style.display = hasSaved ? 'inline-flex' : 'none';
  if (btnClear) btnClear.style.display = hasSaved ? 'inline-flex' : 'none';
}

// Reset Form Handler
function handleResetForm() {
  document.getElementById('inputSchool').value = '';
  document.getElementById('inputTeacher').value = '';
  setDurationValue('៥០ នាទី (១ ម៉ោងសិក្សា)');
  if (typeof syncDurationChipsFromSelect === 'function') syncDurationChipsFromSelect();
  if (typeof updateTeacherProfileSummaryLive === 'function') updateTeacherProfileSummaryLive();
  document.getElementById('inputLessonTitle').value = '';
  document.getElementById('inputChapter').value = '';
  document.getElementById('inputCustomNotes').value = '';
  document.getElementById('inputCustomGradeText').value = '';
  document.getElementById('customGradeInputWrap').style.display = 'none';
  document.getElementById('lessonContentText').value = '';
  document.getElementById('customTemplateText').value = '';
  document.getElementById('samplePicker').value = '';

  const inputDegree = document.getElementById('inputDegree');
  if (inputDegree) {
    inputDegree.value = 'lower_sec';
    updateGradeOptions('lower_sec');
  }

  // Reset file inputs and pills
  document.getElementById('templateFileInput').value = '';
  document.getElementById('templateFileStatus').style.display = 'none';
  document.getElementById('lessonFileInput').value = '';
  document.getElementById('lessonFileStatus').style.display = 'none';

  state.lessonContent = '';
  state.customTemplateText = '';
  state.customTemplateFileName = '';
  state.lessonFileName = '';

  localStorage.removeItem('active_lesson_content');
  const savedLessonBadge = document.getElementById('savedLessonBadge');
  if (savedLessonBadge) savedLessonBadge.style.display = 'none';

  updateWordCount();
  showToast('បានសម្អាតទិន្នន័យទាំងអស់រួចរាល់', 'info');
}

// Zoom Handlers
function changeZoom(delta) {
  state.currentZoom = Math.min(Math.max(state.currentZoom + delta, 0.5), 1.6);
  applyZoom();
}

function resetZoom() {
  state.currentZoom = 1.0;
  applyZoom();
}

function applyZoom() {
  const doc = document.getElementById('printableDoc');
  doc.style.transform = `scale(${state.currentZoom})`;
  document.getElementById('zoomLevel').textContent = `${Math.round(state.currentZoom * 100)}%`;
}

// ==========================================================================
// Export to Microsoft Word (.docx)
// ==========================================================================
async function handleExportWord() {
  if (!state.generatedPlanData) {
    showToast('សូមបង្កើតកិច្ចតែងការជាមុនសិន!', 'warning');
    return;
  }

  showToast('កំពុងបង្កើតឯកសារ Microsoft Word (.docx)...', 'info');

  try {
    const data = state.generatedPlanData;
    const isFlipped = data.templateType === 'flipped_learning' || (data.method && (data.method.includes('ត្រឡប់') || data.method.toLowerCase().includes('flipped'))) || Boolean(data.preTestQCM) || Boolean(data.preClassPhase);
    const isBd = !isFlipped && (data.templateType === 'backward_design' || Boolean(data.stage1));
    const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, HeadingLevel, BorderStyle } = window.docx;

    let docChildren = [];

    // National Motto
    docChildren.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: "ព្រះរាជាណាចក្រកម្ពុជា", bold: true, size: 28 })]
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: "ជាតិ សាសនា ព្រះមហាក្សត្រ", bold: true, size: 24 })]
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: "***", size: 24 })]
      }),
      new Paragraph({ text: "" })
    );

    // Meta Info Table
    docChildren.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: 60, type: WidthType.PERCENTAGE },
                borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
                children: [
                  new Paragraph({ children: [new TextRun({ text: `គ្រឹះស្ថានសិក្សា៖ ${data.school || ''}`, bold: true, size: 22 })] }),
                  new Paragraph({ children: [new TextRun({ text: `ឈ្មោះគ្រូបង្រៀន៖ ${data.teacher || ''}`, size: 22 })] }),
                  new Paragraph({ children: [new TextRun({ text: `មុខវិជ្ជា៖ ${data.subject || ''} | កម្រិត៖ ${data.grade || ''}`, size: 22 })] }),
                ]
              }),
              new TableCell({
                width: { size: 40, type: WidthType.PERCENTAGE },
                borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
                children: [
                  new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `${data.dateStr || ''}`, size: 22 })] }),
                  new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `រយៈពេល៖ ${data.duration || ''}`, bold: true, size: 22 })] }),
                ]
              })
            ]
          })
        ]
      }),
      new Paragraph({ text: "" })
    );

    // Main Lesson Plan Title
    const titleText = data.templateTitle || (isFlipped ? "កិច្ចតែងការបង្រៀន (តាមបែបថ្នាក់រៀនត្រឡប់ - FLIPPED LEARNING)" : (isBd ? "កិច្ចតែងការបង្រៀន (តាមបែបត្រឡប់ - Backward Design / UbD)" : "កិច្ចតែងការបង្រៀន"));
    docChildren.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: titleText, bold: true, underline: {}, size: 28 })]
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: data.chapter ? `${data.chapter} - ` : '', size: 24 }),
          new TextRun({ text: `${data.lessonTitle || ''}`, bold: true, size: 26 })
        ]
      }),
      new Paragraph({ text: "" })
    );

    // Helper: Pre-Test Docx paragraphs
    const buildDocxPreTest = () => {
      const qcmList = (data.preTestQCM && data.preTestQCM.length > 0)
        ? data.preTestQCM
        : generatePreTestQCMOffline(data.subject, data.grade, data.lessonTitle, [], (data.preTestQCM?.length || 5));
      let pList = [
        new Paragraph({ children: [new TextRun({ text: "វិញ្ញាសាស្ទង់សមត្ថភាពមុនម៉ោង (Pre-Test QCM " + qcmList.length + " សំណួរ)", bold: true, size: 24 })] }),
        new Paragraph({ children: [new TextRun({ text: "កម្រិតលំបាក៖ 🟢 ងាយ (Easy) | 🟡 មធ្យម (Medium) | 🔴 ពិបាក (Hard)", italics: true, size: 24 })] })
      ];
      let answerKeys = [];
      qcmList.forEach((q, idx) => {
        const qNum = idx + 1;
        const opts = q.options || {};
        answerKeys.push(`ស.${qNum}: ${q.correctAnswer || 'A'}`);
        pList.push(
          new Paragraph({
            children: [
              new TextRun({ text: `សំណួរទី ${qNum} : `, bold: true, size: 22 }),
              new TextRun({ text: q.question || '', size: 22 })
            ]
          }),
          new Paragraph({
            children: [
              new TextRun({ text: `  ក. ${opts.A || opts['ក'] || ''}    ខ. ${opts.B || opts['ខ'] || ''}`, size: 24 })
            ]
          }),
          new Paragraph({
            children: [
              new TextRun({ text: `  គ. ${opts.C || opts['គ'] || ''}    ឃ. ${opts.D || opts['ឃ'] || ''}`, size: 24 })
            ]
          })
        );
        if (q.explanation) {
          pList.push(new Paragraph({ children: [new TextRun({ text: `  💡 ពន្យល់៖ ${q.explanation}`, italics: true, size: 22 })] }));
        }
      });
      pList.push(
        new Paragraph({ text: "" }),
        new Paragraph({ children: [new TextRun({ text: `🔑 បន្ទះចម្លើយត្រឹមត្រូវ (Pre-Test Answer Keys)៖ ${answerKeys.join(' | ')}`, bold: true, size: 24 })] }),
        new Paragraph({ text: "" })
      );
      return pList;
    };

    // Helper: Post-Test Docx paragraphs
    const buildDocxPostTest = () => {
      const postTestList = (data.postTestMCQ && data.postTestMCQ.length > 0)
        ? data.postTestMCQ
        : generatePostTestMCQOffline(data.subject, data.grade, data.lessonTitle, [], (data.postTestMCQ?.length || 5));
      let pList = [
        new Paragraph({ children: [new TextRun({ text: "វិញ្ញាសាវាយតម្លៃបញ្ចប់ Post-Test (MCQ " + postTestList.length + " សំណួរ)", bold: true, size: 24 })] }),
        new Paragraph({ children: [new TextRun({ text: "  (វាស់ស្ទង់សមត្ថភាពក្រោយរៀន Bloom's Taxonomy)", italics: true, size: 24 })] })
      ];
      let postAnswerKeys = [];
      postTestList.forEach((q, idx) => {
        const qNum = idx + 1;
        const opts = q.options || {};
        postAnswerKeys.push(`ស.${qNum}: ${q.correctAnswer || 'A'}`);
        pList.push(
          new Paragraph({
            children: [
              new TextRun({ text: `សំណួរទី ${qNum} : `, bold: true, size: 24 }),
              new TextRun({ text: q.question || '', size: 24 })
            ]
          }),
          new Paragraph({
            children: [
              new TextRun({ text: `  ក. ${opts.A || opts['ក'] || ''}    ខ. ${opts.B || opts['ខ'] || ''}`, size: 24 })
            ]
          }),
          new Paragraph({
            children: [
              new TextRun({ text: `  គ. ${opts.C || opts['គ'] || ''}    ឃ. ${opts.D || opts['ឃ'] || ''}`, size: 24 })
            ]
          })
        );
        if (q.explanation) {
          pList.push(new Paragraph({ children: [new TextRun({ text: `  💡 ពន្យល់៖ ${q.explanation}`, italics: true, size: 22 })] }));
        }
      });
      pList.push(
        new Paragraph({ text: "" }),
        new Paragraph({ children: [new TextRun({ text: `🔑 បន្ទះចម្លើយត្រឹមត្រូវ (Post-Test Answer Keys)៖ ${postAnswerKeys.join(' | ')}`, bold: true, size: 24 })] }),
        new Paragraph({ text: "" })
      );
      return pList;
    };

    if (isFlipped) {
      const steps = data.steps || [];

      // Main Title
      docChildren.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: "កិច្ចតែងការបង្រៀនតាមបែបត្រឡប់", bold: true, underline: {}, size: 28 })]
        }),
        new Paragraph({ text: "" })
      );

      // Higher-Ed Metadata Table
      docChildren.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  width: { size: 60, type: WidthType.PERCENTAGE },
                  borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
                  children: [
                    new Paragraph({ children: [new TextRun({ text: `មុខវិជ្ជា៖ ${data.subject || 'ចិត្តវិទ្យាអប់រំ'}`, bold: true, size: 22 })] }),
                    new Paragraph({ children: [new TextRun({ text: `ចំនួនក្រេឌីត៖ ${data.credits || '៣ ក្រេឌីត (៣-០-៦)'}`, size: 22 })] }),
                    new Paragraph({ children: [new TextRun({ text: `ឆ្នាំទី៖ ${data.year || '១'}   ឆមាសទី៖ ${data.semester || '២'}`, size: 22 })] }),
                    new Paragraph({ children: [new TextRun({ text: `សប្តាហ៍ទី៖ ${data.week || '១'}   មេរៀនទី៖ ${data.lessonNumber || '១'}`, size: 22 })] }),
                  ]
                }),
                new TableCell({
                  width: { size: 40, type: WidthType.PERCENTAGE },
                  borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
                  children: [
                    new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `រយៈពេល៖ ${data.duration || '១៨០ នាទី'}`, bold: true, size: 22 })] }),
                    new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `គ្រូឧទ្ទេស៖ ${data.teacher || 'កែម បូរី'}`, bold: true, size: 22 })] }),
                    new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `${data.dateStr || ''}`, size: 24 })] }),
                  ]
                })
              ]
            })
          ]
        }),
        new Paragraph({ text: "" }),
        new Paragraph({
          children: [
            new TextRun({ text: `ចំណងជើងមេរៀន៖ ${data.lessonTitle || ''}`, bold: true, size: 24 })
          ]
        }),
        new Paragraph({ text: "" })
      );

      // Section 1: Objectives
      docChildren.push(
        new Paragraph({ children: [new TextRun({ text: "១. វត្ថុបំណង", bold: true, size: 24 })] }),
        new Paragraph({ children: [new TextRun({ text: "បន្ទាប់ពីរៀនមេរៀននេះចប់ គរុនិស្សិតនឹង៖", italics: true, size: 22 })] }),
        new Paragraph({ children: [new TextRun({ text: "• វិជ្ជាសម្បទា៖", bold: true, size: 22 })] }),
        ...(data.objectives?.knowledge || []).map(k => new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: k, size: 22 })] })),
        new Paragraph({ children: [new TextRun({ text: "• បំណិនសម្បទា៖", bold: true, size: 22 })] }),
        ...(data.objectives?.skills || []).map(s => new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: s, size: 22 })] })),
        new Paragraph({ children: [new TextRun({ text: "• ចរិយាសម្បទា៖", bold: true, size: 22 })] }),
        ...(data.objectives?.attitudes || []).map(a => new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: a, size: 22 })] })),
        new Paragraph({ text: "" })
      );

      // Section 2: Materials
      docChildren.push(
        new Paragraph({ children: [new TextRun({ text: "២. សម្ភារឧបទេស", bold: true, size: 24 })] }),
        new Paragraph({ children: [new TextRun({ text: "កិច្ចតែងការបង្រៀន វីដេអូបង្រៀន បុរេតេស្ត តេស្តបញ្ចប់ និងកិច្ចការផ្ទះ", size: 22 })] }),
        new Paragraph({ children: [new TextRun({ text: `• សម្រាប់គ្រូ៖ ${(data.materials?.teacher || []).join(', ')}`, size: 22 })] }),
        new Paragraph({ children: [new TextRun({ text: `• សម្រាប់និស្សិត៖ ${(data.materials?.student || []).join(', ')}`, size: 22 })] }),
        new Paragraph({ text: "" })
      );

      // Section 3: Method
      docChildren.push(
        new Paragraph({ children: [new TextRun({ text: "៣. វិធីសាស្រ្ដបង្រៀន", bold: true, size: 24 })] }),
        new Paragraph({ children: [new TextRun({ text: "     - ការរៀនបែបត្រឡប់", size: 22 })] }),
        new Paragraph({ text: "" })
      );

      // Section 4: In-Class Process (3 Columns)
      let flippedDocxRows = [
        new TableRow({
          tableHeader: true,
          children: [
            new TableCell({ width: { size: 35, type: WidthType.PERCENTAGE }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "សកម្មភាពគ្រូ", bold: true, size: 24 })] })] }),
            new TableCell({ width: { size: 35, type: WidthType.PERCENTAGE }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "ខ្លឹមសារ", bold: true, size: 24 })] })] }),
            new TableCell({ width: { size: 30, type: WidthType.PERCENTAGE }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "សកម្មភាពសិស្ស", bold: true, size: 24 })] })] }),
          ]
        })
      ];

      steps.forEach(step => {
        // Step Title Header Row spanning 3 cols
        flippedDocxRows.push(
          new TableRow({
            children: [
              new TableCell({
                columnSpan: 3,
                shading: { fill: "F1F5F9" },
                children: [new Paragraph({ children: [new TextRun({ text: `${step.stepTitle} (${step.duration})`, bold: true, size: 21, color: "0F172A" })] })]
              })
            ]
          }),
          new TableRow({
            children: [
              new TableCell({ width: { size: 35, type: WidthType.PERCENTAGE }, children: (step.teacherActivity || '').split('\n').map(l => new Paragraph({ children: [new TextRun({ text: l, size: 24 })] })) }),
              new TableCell({ width: { size: 35, type: WidthType.PERCENTAGE }, children: (step.contentSummary || '').split('\n').map(l => new Paragraph({ children: [new TextRun({ text: l, size: 24, bold: true })] })) }),
              new TableCell({ width: { size: 30, type: WidthType.PERCENTAGE }, children: (step.studentActivity || '').split('\n').map(l => new Paragraph({ children: [new TextRun({ text: l, size: 24 })] })) }),
            ]
          })
        );
      });

      docChildren.push(
        new Paragraph({ children: [new TextRun({ text: `៤. ដំណើរការបង្រៀន (${data.duration || '១៨០ នាទី'})`, bold: true, size: 24 })] }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: flippedDocxRows
        }),
        new Paragraph({ text: "" })
      );

      // Signatures
      docChildren.push(
        new Paragraph({ text: "" }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  width: { size: 50, type: WidthType.PERCENTAGE },
                  borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
                  children: [
                    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "បានឃើញ និងឯកភាព", size: 22 })] }),
                    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "ប្រធានដេប៉ាតឺម៉ង់ / គណៈគ្រប់គ្រង", bold: true, size: 22 })] }),
                    new Paragraph({ text: "\n\n\n" })
                  ]
                }),
                new TableCell({
                  width: { size: 50, type: WidthType.PERCENTAGE },
                  borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
                  children: [
                    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `${data.dateStr || ''}`, size: 22 })] }),
                    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "ហត្ថលេខាគ្រូឧទ្ទេស", bold: true, size: 22 })] }),
                    new Paragraph({ text: "\n\n\n" }),
                    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `${data.teacher || 'កែម បូរី'}`, bold: true, size: 22 })] })
                  ]
                })
              ]
            })
          ]
        }),
        new Paragraph({ text: "" }),
        new Paragraph({
          children: [
            new TextRun({ text: "* អាជ្ញាបណ្ណ និងកម្មសិទ្ធិ (License)： ខ្ញុំឈ្មោះកែម បូរី ជាគ្រូឧទ្ទេសមុខវិជ្ជាចិត្តវិទ្យាអប់រំ នៅវិទ្យាស្ថានគរុកោសល្យកំពង់ចាម", italics: true, size: 22, color: "64748B" })
          ]
        })
      );

      // Appendix: Pre-Test & Post-Test on the page after signatures
      const hasPreFlipped = Boolean(data.preTestQCM && data.preTestQCM.length > 0);
      const hasPostFlipped = Boolean(data.postTestMCQ && data.postTestMCQ.length > 0);
      if (hasPreFlipped || hasPostFlipped) {
        docChildren.push(
          new Paragraph({
            pageBreakBefore: true,
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: "ឯកសារឧបសម្ព័ន្ធ (Appendix)", bold: true, size: 28 })
            ]
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: "វិញ្ញាសាស្ទង់សមត្ថភាពមុនម៉ោង (Pre-Test) និងតេស្តវាស់ស្ទង់សមត្ថភាព (Post-Test)", bold: true, size: 22 })
            ]
          }),
          new Paragraph({ text: "" })
        );
        if (hasPreFlipped) {
          docChildren.push(...buildDocxPreTest());
        }
        if (hasPostFlipped) {
          docChildren.push(...buildDocxPostTest());
        }
      }

      // Done for flipped learning export
      const blob = await Packer.toBlob(new Document({
        styles: {
          default: {
            document: {
              run: {
                font: "Kantumruy Pro",
                size: 22
              }
            }
          }
        },
        sections: [{ children: docChildren }]
      }));
      const filename = `កិច្ចតែងការបង្រៀនតាមបែបត្រឡប់_${(data.subject || 'មេរៀន')}_${(data.teacher || 'កែម_បូរី')}.docx`.replace(/\s+/g, '_');
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();
      showToast(`✅ បានទាញយកឯកសារ Word ដោយជោគជ័យ៖ ${filename}`, 'success');
      return;
    }

    if (isBd) {
      const stage1 = data.stage1 || {};
      const stage2 = data.stage2 || {};
      const stage3 = data.stage3 || {};
      const activities = stage3.learningActivities || data.steps || [];

      // Stage 1
      docChildren.push(
        new Paragraph({ children: [new TextRun({ text: "I. ដំណាក់កាលទី ១ : ការកំណត់លទ្ធផលរំពឹងទុក (Stage 1: Desired Results)", bold: true, size: 24 })] })
      );

      if (stage1.establishedGoals) {
        docChildren.push(
          new Paragraph({ children: [new TextRun({ text: "១. គោលបំណងចម្បង / ស្តង់ដារសិក្សា៖ ", bold: true, size: 22 }), new TextRun({ text: stage1.establishedGoals, size: 22 })] })
        );
      }

      docChildren.push(
        new Paragraph({ children: [new TextRun({ text: "២. ការយល់ដឹងស្នូល (Enduring Understandings) & សំណួរគន្លឹះ (Essential Questions)៖", bold: true, size: 22 })] }),
        new Paragraph({ children: [new TextRun({ text: "  • ការយល់ដឹងស្នូល (Enduring Understandings)៖", italics: true, size: 22 })] }),
        ...(stage1.enduringUnderstandings || []).map(u => new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: u, size: 22 })] })),
        new Paragraph({ children: [new TextRun({ text: "  • សំណួរគន្លឹះដាស់ការត្រិះរិះ (Essential Questions)៖", italics: true, size: 22 })] }),
        ...(stage1.essentialQuestions || []).map(q => new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: q, size: 22 })] })),
        new Paragraph({ children: [new TextRun({ text: "៣. វត្ថុបំណងជាក់លាក់ (Specific Objectives)៖", bold: true, size: 22 })] }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: `វិជ្ជាសម្បទា (ចំណេះដឹង)៖ ${(stage1.objectives?.knowledge || data.objectives?.knowledge || []).join('; ')}`, size: 22 })] }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: `បំណិនសម្បទា (បំណិន)៖ ${(stage1.objectives?.skills || data.objectives?.skills || []).join('; ')}`, size: 22 })] }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: `ចរិយាសម្បទា (ឥរិយាបថ)៖ ${(stage1.objectives?.attitudes || data.objectives?.attitudes || []).join('; ')}`, size: 22 })] }),
        new Paragraph({ text: "" })
      );

      // Stage 2
      docChildren.push(
        new Paragraph({ children: [new TextRun({ text: "II. ដំណាក់កាលទី ២ : ការកំណត់ភស្តុតាងនៃការវាយតម្លៃ (Stage 2: Assessment Evidence)", bold: true, size: 24 })] }),
        new Paragraph({ children: [new TextRun({ text: "១. ភារកិច្ចវាស់ស្ទង់សមត្ថភាព / កិច្ចការអនុវត្ត (Performance Tasks)៖", bold: true, size: 22 })] }),
        ...(stage2.performanceTasks || []).map(pt => new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: pt, size: 22 })] })),
        new Paragraph({ children: [new TextRun({ text: "២. ភស្តុតាងផ្សេងៗទៀត (Other Evidence) & លក្ខណៈវិនិច្ឆ័យ (Criteria)៖", bold: true, size: 22 })] }),
        ...(stage2.otherEvidence || []).map(oe => new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: oe, size: 22 })] }))
      );

      if (stage2.criteria && stage2.criteria.length > 0) {
        docChildren.push(
          new Paragraph({ children: [new TextRun({ text: `  • លក្ខណៈវិនិច្ឆ័យវាយតម្លៃ៖ ${stage2.criteria.join(' | ')}`, italics: true, size: 24 })] })
        );
      }
      docChildren.push(new Paragraph({ text: "" }));

      // Stage 3
      docChildren.push(
        new Paragraph({ children: [new TextRun({ text: "III. ដំណាក់កាលទី ៣ : ផែនការរៀបចំការបង្រៀន និងរៀន (Stage 3: Learning Plan)", bold: true, size: 24 })] }),
        new Paragraph({ children: [new TextRun({ text: `• សម្ភារឧបទេស៖ សម្រាប់គ្រូ៖ ${(stage3.materials?.teacher || data.materials?.teacher || []).join(', ')} | សម្រាប់សិស្ស៖ ${(stage3.materials?.student || data.materials?.student || []).join(', ')}`, size: 22 })] }),
        new Paragraph({ text: "" }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              tableHeader: true,
              children: [
                new TableCell({ width: { size: 24, type: WidthType.PERCENTAGE }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "ដំណាក់កាល/ពេល", bold: true, size: 24 })] })] }),
                new TableCell({ width: { size: 30, type: WidthType.PERCENTAGE }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "សកម្មភាពគ្រូ", bold: true, size: 24 })] })] }),
                new TableCell({ width: { size: 25, type: WidthType.PERCENTAGE }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "ខ្លឹមសារមេរៀន", bold: true, size: 24 })] })] }),
                new TableCell({ width: { size: 25, type: WidthType.PERCENTAGE }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "សកម្មភាពសិស្ស", bold: true, size: 24 })] })] }),
              ]
            }),
            ...activities.map(step => new TableRow({
              children: [
                new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `${step.stepTitle}
(${step.duration})`, bold: true, size: 22 })] })] }),
                new TableCell({ children: (step.teacherActivity || '').split('\n').map(l => new Paragraph({ children: [new TextRun({ text: l, size: 22 })] })) }),
                new TableCell({ children: (step.contentSummary || '').split('\n').map(l => new Paragraph({ children: [new TextRun({ text: l, bold: true, size: 22 })] })) }),
                new TableCell({ children: (step.studentActivity || '').split('\n').map(l => new Paragraph({ children: [new TextRun({ text: l, size: 22 })] })) }),
              ]
            }))
          ]
        }),
        new Paragraph({ text: "" })
      );

    } else {
      // 5-Step Process (MoEYS Standard, Flipped Learning, Primary School, STEM/5E)
      const steps = data.steps || [];

      // Section I: Objectives
      docChildren.push(
        new Paragraph({ children: [new TextRun({ text: "I. វត្ថុបំណង (Objectives)", bold: true, size: 24 })] }),
        new Paragraph({ children: [new TextRun({ text: "១. វិជ្ជាសម្បទា (ចំណេះដឹង)៖", bold: true, size: 22 })] }),
        ...(data.objectives?.knowledge || []).map(k => new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: k, size: 22 })] })),
        new Paragraph({ children: [new TextRun({ text: "២. បំណិនសម្បទា (បំណិន)៖", bold: true, size: 22 })] }),
        ...(data.objectives?.skills || []).map(s => new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: s, size: 22 })] })),
        new Paragraph({ children: [new TextRun({ text: "៣. ចរិយាសម្បទា (ឥរិយាបថ)៖", bold: true, size: 22 })] }),
        ...(data.objectives?.attitudes || []).map(a => new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: a, size: 22 })] })),
        new Paragraph({ text: "" })
      );

      // Section II: Materials
      docChildren.push(
        new Paragraph({ children: [new TextRun({ text: "II. សម្ភារឧបទេស (Materials)", bold: true, size: 24 })] }),
        new Paragraph({ children: [new TextRun({ text: `• សម្រាប់គ្រូ៖ ${(data.materials?.teacher || []).join(', ')}`, size: 22 })] }),
        new Paragraph({ children: [new TextRun({ text: `• សម្រាប់សិស្ស៖ ${(data.materials?.student || []).join(', ')}`, size: 22 })] }),
        new Paragraph({ text: "" })
      );

      // Section IV: 5-Step Process Table
      docChildren.push(
        new Paragraph({ children: [new TextRun({ text: "IV. ដំណើរការបង្រៀន និងរៀនក្នុងថ្នាក់ (Teaching Process)", bold: true, size: 24 })] }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              tableHeader: true,
              children: [
                new TableCell({ width: { size: 24, type: WidthType.PERCENTAGE }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "ជំហាន/ពេល", bold: true, size: 24 })] })] }),
                new TableCell({ width: { size: 30, type: WidthType.PERCENTAGE }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "សកម្មភាពគ្រូ", bold: true, size: 24 })] })] }),
                new TableCell({ width: { size: 25, type: WidthType.PERCENTAGE }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "ខ្លឹមសារមេរៀន", bold: true, size: 24 })] })] }),
                new TableCell({ width: { size: 25, type: WidthType.PERCENTAGE }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "សកម្មភាពសិស្ស", bold: true, size: 24 })] })] }),
              ]
            }),
            ...steps.map(step => new TableRow({
              children: [
                new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `${step.stepTitle}\n(${step.duration})`, bold: true, size: 22 })] })] }),
                new TableCell({ children: (step.teacherActivity || '').split('\n').map(l => new Paragraph({ children: [new TextRun({ text: l, size: 22 })] })) }),
                new TableCell({ children: (step.contentSummary || '').split('\n').map(l => new Paragraph({ children: [new TextRun({ text: l, bold: true, size: 22 })] })) }),
                new TableCell({ children: (step.studentActivity || '').split('\n').map(l => new Paragraph({ children: [new TextRun({ text: l, size: 22 })] })) }),
              ]
            }))
          ]
        }),
        new Paragraph({ text: "" })
      );
    }

    // Signatures Table closing the Lesson Plan
    docChildren.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: 50, type: WidthType.PERCENTAGE },
                borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
                children: [
                  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "បានឃើញ និងឯកភាព", size: 22 })] }),
                  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "នាយក/នាយិកាសាលា", bold: true, size: 22 })] }),
                ]
              }),
              new TableCell({
                width: { size: 50, type: WidthType.PERCENTAGE },
                borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
                children: [
                  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `${data.dateStr || ''}`, size: 22 })] }),
                  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "ហត្ថលេខាគ្រូបង្រៀន", bold: true, size: 22 })] }),
                  new Paragraph({ text: "" }),
                  new Paragraph({ text: "" }),
                  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `${data.teacher || ''}`, bold: true, size: 22 })] }),
                ]
              })
            ]
          })
        ]
      })
    );

    // Appendix: Pre-Test & Post-Test on the page after signatures
    const hasPreStd = Boolean(data.preTestQCM && data.preTestQCM.length > 0);
    const hasPostStd = Boolean(data.postTestMCQ && data.postTestMCQ.length > 0);
    if (hasPreStd || hasPostStd) {
      docChildren.push(
        new Paragraph({
          pageBreakBefore: true,
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: "ឯកសារឧបសម្ព័ន្ធ (Appendix)", bold: true, size: 28 })
          ]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: "វិញ្ញាសាស្ទង់សមត្ថភាពមុនម៉ោង (Pre-Test) និងតេស្តវាស់ស្ទង់សមត្ថភាព (Post-Test)", bold: true, size: 22 })
          ]
        }),
        new Paragraph({ text: "" })
      );
      if (hasPreStd) {
        docChildren.push(...buildDocxPreTest());
      }
      if (hasPostStd) {
        docChildren.push(...buildDocxPostTest());
      }
    }

    // Create Document
    const doc = new Document({
      styles: {
        default: {
          document: {
            run: {
              font: "Kantumruy Pro",
              size: 22
            }
          }
        }
      },
      sections: [{
        properties: {
          page: {
            margin: {
              top: 720,
              right: 720,
              bottom: 720,
              left: 720
            }
          }
        },
        children: docChildren
      }]
    });

    // Generate blob and download
    const blob = await Packer.toBlob(doc);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `កិច្ចតែងការ_${data.subject || ''}_${data.grade || ''}_${(data.lessonTitle || '').substring(0, 20)}.docx`;
    link.click();
    showToast('✨ បានទាញយកឯកសារ Word (.docx) ដោយជោគជ័យ!', 'success');

  } catch (err) {
    console.error('Word Export Error:', err);
    showToast(`បញ្ហាក្នុងការទាញយក Word: ${err.message}`, 'error');
  }
}


function handlePrintPdf() {
  if (!state.generatedPlanData) {
    showToast('សូមបង្កើតកិច្ចតែងការជាមុនសិន!', 'warning');
    return;
  }
  window.print();
}

// Copy Text to Clipboard
async function handleCopyText() {
  const doc = document.getElementById('printableDoc');
  if (!doc || doc.style.display === 'none') {
    showToast('មិនទាន់មានអត្ថបទសម្រាប់ចម្លងទេ', 'warning');
    return;
  }

  try {
    await navigator.clipboard.writeText(doc.innerText);
    showToast('📋 បានចម្លងអត្ថបទកិច្ចតែងការទាំងអស់ទៅកាន់ Clipboard!', 'success');
  } catch (err) {
    showToast('មិនអាចចម្លងបានទេ: ' + err.message, 'error');
  }
}

// Toast Notification Manager
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let icon = 'fa-circle-info';
  if (type === 'success') icon = 'fa-circle-check';
  if (type === 'warning') icon = 'fa-triangle-exclamation';
  if (type === 'error') icon = 'fa-circle-exclamation';

  toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ==========================================================================
// 📁 Lesson Materials Storage & Library System (កន្លែងរក្សាទុកមេរៀន)
// ==========================================================================

function loadSavedLessons() {
  try {
    const isInitialized = localStorage.getItem(LIBRARY_INIT_FLAG);
    const raw = localStorage.getItem(SAVED_LESSONS_STORAGE_KEY);

    if (!isInitialized) {
      // First-time initialization: populate with standard sample lessons
      if (typeof SAMPLE_LESSONS !== 'undefined' && SAMPLE_LESSONS.length > 0) {
        state.savedLessons = SAMPLE_LESSONS.map((sample, idx) => ({
          id: 'lesson_sample_' + idx,
          name: `${sample.subject} - ${sample.lesson}`,
          subject: sample.subject,
          grade: sample.grade,
          chapter: sample.chapter,
          lessonTitle: sample.lesson,
          content: sample.content,
          fileName: '',
          date: getKhmerFormattedDate()
        }));
      } else {
        state.savedLessons = [];
      }
      localStorage.setItem(SAVED_LESSONS_STORAGE_KEY, JSON.stringify(state.savedLessons));
      localStorage.setItem(LIBRARY_INIT_FLAG, 'true');
    } else {
      // Subsequent loads: load exactly what user has saved/deleted
      state.savedLessons = raw ? JSON.parse(raw) : [];
    }

    updateSavedLessonsUI();
  } catch (e) {
    console.error('Error loading saved lessons:', e);
    state.savedLessons = [];
    updateSavedLessonsUI();
  }
}

function deleteSavedLesson(id) {
  const lesson = state.savedLessons.find(l => l.id === id);
  const name = lesson ? lesson.name : 'មេរៀន';
  if (!confirm(`តើអ្នកពិតជាចង់លុបមេរៀន "${name}" នេះចេញពីបណ្ណាល័យមែនទេ?`)) {
    return;
  }

  state.savedLessons = state.savedLessons.filter(l => l.id !== id);
  localStorage.setItem(SAVED_LESSONS_STORAGE_KEY, JSON.stringify(state.savedLessons));
  updateSavedLessonsUI();
  showToast(`🗑️ បានលុបមេរៀន "${name}" រួចរាល់!`, 'info');
}

function updateSavedLessonsUI(filterQuery = '') {
  const count = state.savedLessons.length;
  const badge = document.getElementById('savedLessonsCountBadge');
  if (badge) badge.textContent = `${count} មេរៀន`;

  const memoryPill = document.getElementById('savedLessonsMemoryPill');
  if (memoryPill) memoryPill.textContent = `${count} មេរៀនក្នុងឃ្លាំង`;

  const container = document.getElementById('savedLessonsCardsList');
  const emptyState = document.getElementById('savedLessonsEmptyState');
  if (!container) return;

  container.innerHTML = '';

  const q = (filterQuery || '').toLowerCase().trim();
  const filtered = state.savedLessons.filter(l => {
    if (!q) return true;
    return (l.name && l.name.toLowerCase().includes(q)) ||
           (l.subject && l.subject.toLowerCase().includes(q)) ||
           (l.grade && l.grade.toLowerCase().includes(q)) ||
           (l.lessonTitle && l.lessonTitle.toLowerCase().includes(q)) ||
           (l.content && l.content.toLowerCase().includes(q));
  });

  if (filtered.length === 0) {
    if (emptyState) emptyState.style.display = 'block';
    return;
  }
  if (emptyState) emptyState.style.display = 'none';

  filtered.forEach((lesson) => {
    const card = document.createElement('div');
    card.className = 'saved-lesson-item-card';
    card.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 12px;
      border-radius: 8px;
      background: var(--card-bg, #ffffff);
      border: 1px solid var(--border-color, #e2e8f0);
      transition: all 0.2s ease;
      gap: 10px;
    `;
    card.onmouseover = () => { card.style.borderColor = 'var(--primary, #6366f1)'; card.style.transform = 'translateY(-1px)'; };
    card.onmouseout = () => { card.style.borderColor = 'var(--border-color, #e2e8f0)'; card.style.transform = 'none'; };

    const words = lesson.content ? lesson.content.trim().split(/\s+/).length : 0;
    const isCustom = !lesson.id.startsWith('lesson_sample_');

    card.innerHTML = `
      <div style="flex: 1; min-width: 0;">
        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
          <span style="font-weight: 700; font-size: 0.88rem; color: var(--text-color, #1e293b);">${escapeHtml(lesson.name)}</span>
          ${isCustom ? '<span style="background: rgba(16,185,129,0.15); color: #10b981; font-size: 0.72rem; padding: 2px 6px; border-radius: 4px; font-weight: 600;">🌟 ផ្ទាល់ខ្លួន</span>' : ''}
          <span style="background: rgba(99,102,241,0.1); color: var(--primary); font-size: 0.72rem; padding: 2px 6px; border-radius: 4px;">${escapeHtml(lesson.subject || 'ទូទៅ')} ${escapeHtml(lesson.grade || '')}</span>
        </div>
        <div style="font-size: 0.76rem; color: var(--text-muted, #64748b); margin-top: 3px; display: flex; gap: 10px;">
          <span><i class="fa-regular fa-clock"></i> ${escapeHtml(lesson.date || 'ថ្មីៗ')}</span>
          <span><i class="fa-solid fa-file-lines"></i> ${words} ពាក្យ</span>
        </div>
      </div>
      <div style="display: flex; gap: 6px; align-items: center;">
        <button type="button" class="btn btn-sm btn-primary btn-apply-lesson" data-id="${lesson.id}" style="padding: 4px 10px; font-size: 0.78rem; white-space: nowrap;">
          <i class="fa-solid fa-check"></i> ប្រើមេរៀននេះ
        </button>
        <button type="button" class="btn-icon-danger btn-del-lesson" data-id="${lesson.id}" title="លុបមេរៀននេះ" style="background: none; border: none; color: #ef4444; cursor: pointer; padding: 4px 6px;">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>
    `;

    container.appendChild(card);
  });

  // Attach click events
  container.querySelectorAll('.btn-apply-lesson').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      applySavedLesson(id);
    });
  });

  container.querySelectorAll('.btn-del-lesson').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      deleteSavedLesson(id);
    });
  });
}

function exportSavedLessonsAsJson() {
  if (!state.savedLessons || state.savedLessons.length === 0) {
    showToast('មិនមានមេរៀនសម្រាប់ទាញយកទេ', 'warning');
    return;
  }
  const blob = new Blob([JSON.stringify(state.savedLessons, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Lesson_Memory_Vault_Backup_${Date.now()}.json`;
  a.click();
  showToast('💾 បានទាញយកទិន្នន័យមេរៀនទាំងអស់ជោគជ័យ!', 'success');
}

function importSavedLessonsFromJson(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const imported = JSON.parse(e.target.result);
      if (Array.isArray(imported)) {
        let added = 0;
        imported.forEach(item => {
          if (item.name && item.content) {
            const exists = state.savedLessons.some(l => l.name === item.name || l.id === item.id);
            if (!exists) {
              state.savedLessons.unshift(item);
              added++;
            }
          }
        });
        localStorage.setItem(SAVED_LESSONS_STORAGE_KEY, JSON.stringify(state.savedLessons));
        updateSavedLessonsUI();
        showToast(`🎉 បានបញ្ចូល ${added} មេរៀនថ្មីទៅក្នុងបណ្ណាល័យដោយជោគជ័យ!`, 'success');
      } else {
        showToast('ឯកសារ JSON មិនត្រឹមត្រូវ', 'error');
      }
    } catch (err) {
      showToast('បរាជ័យក្នុងការអានឯកសារ JSON: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
}

function saveCurrentLessonMaterial(name, silent = false) {
  const content = document.getElementById('lessonContentText').value.trim();
  if (!content) {
    if (!silent) showToast('សូមបញ្ចូល ឬ Upload ខ្លឹមសារមេរៀនជាមុនសិន!', 'warning');
    return;
  }

  const subject = document.getElementById('inputSubject').value;
  const grade = getGradeValue();
  const chapter = document.getElementById('inputChapter').value.trim();
  const lessonTitle = document.getElementById('inputLessonTitle').value.trim();

  let lessonName = (name || '').trim();
  if (!lessonName) {
    const inputNameEl = document.getElementById('inputSaveLessonName');
    if (inputNameEl && inputNameEl.value.trim()) {
      lessonName = inputNameEl.value.trim();
    } else if (state.lessonFileName) {
      lessonName = state.lessonFileName.replace(/\.[^/.]+$/, "");
    } else if (lessonTitle) {
      lessonName = `${subject} - ${lessonTitle}`;
    } else {
      const now = new Date();
      const timeStr = `${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`;
      lessonName = `មេរៀន ${subject} ${grade} (${timeStr})`;
    }
  }

  // Create a brand new distinct lesson record (never overwrite other lessons)
  const lessonRecord = {
    id: 'lesson_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    name: lessonName,
    subject: subject,
    grade: grade,
    chapter: chapter,
    lessonTitle: lessonTitle || lessonName,
    content: content,
    fileName: state.lessonFileName || '',
    date: getKhmerFormattedDate()
  };

  // Add the new lesson to the top of the list
  state.savedLessons.unshift(lessonRecord);

  localStorage.setItem(SAVED_LESSONS_STORAGE_KEY, JSON.stringify(state.savedLessons));
  state.selectedSavedLessonId = lessonRecord.id;

  updateSavedLessonsUI();

  // Clear name input for next upload
  const nameInput = document.getElementById('inputSaveLessonName');
  if (nameInput) nameInput.value = '';

  const savedLessonBadge = document.getElementById('savedLessonBadge');
  if (savedLessonBadge) savedLessonBadge.style.display = 'inline-flex';

  if (!silent) {
    showToast(`💾 បានរក្សាទុកមេរៀនថ្មី "${lessonName}" ទៅក្នុងបណ្ណាល័យជោគជ័យ!`, 'success');
  }
}

function applySavedLesson(id) {
  const lesson = state.savedLessons.find(l => l.id === id);
  if (!lesson) return;

  document.getElementById('lessonContentText').value = lesson.content;
  state.lessonContent = lesson.content;
  state.lessonFileName = lesson.fileName || '';

  if (lesson.subject) document.getElementById('inputSubject').value = lesson.subject;
  if (lesson.chapter) document.getElementById('inputChapter').value = lesson.chapter;
  if (lesson.lessonTitle) document.getElementById('inputLessonTitle').value = lesson.lessonTitle;

  if (lesson.grade) {
    const degreeKey = findDegreeKeyForGrade(lesson.grade);
    const inputDegree = document.getElementById('inputDegree');
    if (inputDegree && degreeKey) {
      inputDegree.value = degreeKey;
      updateGradeOptions(degreeKey, lesson.grade);
    }
  }

  updateWordCount();

  // Switch tab back to upload mode so user can see and edit the applied lesson directly
  const uploadRadio = document.querySelector('input[name="lessonSourceMode"][value="upload"]');
  if (uploadRadio) {
    uploadRadio.checked = true;
    uploadRadio.dispatchEvent(new Event('change'));
  }

  showToast(`⚡ បានជ្រើសរើសមេរៀន "${lesson.name}" មកប្រើប្រាស់!`, 'success');
}

function deleteSavedLesson(id) {
  const lesson = state.savedLessons.find(l => l.id === id);
  const name = lesson ? lesson.name : 'មេរៀន';
  if (!confirm(`តើអ្នកពិតជាចង់លុបមេរៀន "${name}" នេះចេញពីបណ្ណាល័យមែនទេ?`)) {
    return;
  }

  state.savedLessons = state.savedLessons.filter(l => l.id !== id);
  localStorage.setItem(SAVED_LESSONS_STORAGE_KEY, JSON.stringify(state.savedLessons));
  state.selectedSavedLessonId = state.savedLessons.length > 0 ? state.savedLessons[0].id : null;
  loadSavedLessons();
  showToast(`បានលុបមេរៀន "${name}" ចេញរួចរាល់`, 'info');
}

// ==========================================================================
// 📚 Saved Generated Lesson Plans Library (បណ្ណាល័យកិច្ចតែងការដែលបានបង្កើត)
// ==========================================================================

function loadSavedPlans() {
  try {
    const raw = localStorage.getItem(SAVED_PLANS_STORAGE_KEY);
    state.savedPlans = raw ? JSON.parse(raw) : [];
    updateSavedPlansCountBadge();
  } catch (e) {
    console.error('Error loading saved plans:', e);
    state.savedPlans = [];
    updateSavedPlansCountBadge();
  }
}

function updateSavedPlansCountBadge() {
  const badgeHeader = document.getElementById('savedPlansCountBadge');
  const badgeModal = document.getElementById('modalSavedPlansBadge');
  const count = state.savedPlans.length;

  if (badgeHeader) badgeHeader.textContent = count;
  if (badgeModal) badgeModal.textContent = `${count} កិច្ចតែងការ`;
}

function openSavedPlansModal() {
  loadSavedPlans();
  renderSavedPlansGrid();
  const modal = document.getElementById('savedPlansModal');
  if (modal) modal.style.display = 'flex';
}

function closeSavedPlansModal() {
  const modal = document.getElementById('savedPlansModal');
  if (modal) modal.style.display = 'none';
}
window.openSavedPlansModal = openSavedPlansModal;
window.closeSavedPlansModal = closeSavedPlansModal;
window.saveCurrentGeneratedPlan = saveCurrentGeneratedPlan;

function saveCurrentGeneratedPlan() {
  if (!state.generatedPlanData) {
    showToast('មិនទាន់មានកិច្ចតែងការសម្រាប់រក្សាទុកទេ! សូមចុចបង្កើតកិច្ចតែងការជាមុនសិន។', 'warning');
    return;
  }

  const plan = state.generatedPlanData;
  const isBd = plan.templateType === 'backward_design' || Boolean(plan.stage1);
  const planTitle = plan.lessonTitle || 'កិច្ចតែងការបង្រៀន';

  // Check if already saved with exact title & date
  const existingIdx = state.savedPlans.findIndex(p => 
    p.planData && p.planData.lessonTitle === plan.lessonTitle && p.planData.subject === plan.subject && p.planData.grade === plan.grade
  );

  const planRecord = {
    id: 'plan_' + Date.now(),
    title: planTitle,
    chapter: plan.chapter || '',
    subject: plan.subject || '',
    grade: plan.grade || '',
    school: plan.school || '',
    teacher: plan.teacher || '',
    duration: plan.duration || '',
    templateType: isBd ? 'backward_design' : '5_steps',
    templateBadge: isBd ? 'បែបត្រឡប់ UbD' : 'ស្តង់ដារ MoEYS',
    date: plan.dateStr || getKhmerFormattedDate(),
    savedAt: new Date().toISOString(),
    planData: JSON.parse(JSON.stringify(plan))
  };

  if (existingIdx >= 0) {
    state.savedPlans[existingIdx] = planRecord;
    showToast(`💾 បានធ្វើបច្ចុប្បន្នភាពកិច្ចតែងការ "${planTitle}" ក្នុងបណ្ណាល័យ!`, 'success');
  } else {
    state.savedPlans.unshift(planRecord);
    showToast(`✨ បានរក្សាទុកកិច្ចតែងការ "${planTitle}" ទៅក្នុងបណ្ណាល័យជោគជ័យ!`, 'success');
  }

  localStorage.setItem(SAVED_PLANS_STORAGE_KEY, JSON.stringify(state.savedPlans));
  updateSavedPlansCountBadge();
}

function renderSavedPlansGrid(searchQuery = '', filterSubject = '') {
  const grid = document.getElementById('savedPlansGrid');
  const emptyState = document.getElementById('savedPlansEmptyState');
  if (!grid) return;

  grid.innerHTML = '';
  const q = (searchQuery || '').trim().toLowerCase();
  const subj = (filterSubject || '').trim();

  let filtered = state.savedPlans.filter(p => {
    const matchSubj = !subj || (p.subject && p.subject === subj);
    if (!matchSubj) return false;

    if (!q) return true;
    const titleMatch = (p.title || '').toLowerCase().includes(q);
    const chapterMatch = (p.chapter || '').toLowerCase().includes(q);
    const subjMatch = (p.subject || '').toLowerCase().includes(q);
    const gradeMatch = (p.grade || '').toLowerCase().includes(q);
    const schoolMatch = (p.school || '').toLowerCase().includes(q);
    const dateMatch = (p.date || '').toLowerCase().includes(q);
    return titleMatch || chapterMatch || subjMatch || gradeMatch || schoolMatch || dateMatch;
  });

  if (filtered.length === 0) {
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  filtered.forEach(planRecord => {
    const isBd = planRecord.templateType === 'backward_design';
    const plan = planRecord.planData || {};

    let snippetText = '';
    if (isBd && plan.stage1) {
      snippetText = plan.stage1.establishedGoals || (plan.stage1.enduringUnderstandings ? plan.stage1.enduringUnderstandings[0] : '');
    } else if (plan.objectives && plan.objectives.knowledge) {
      snippetText = plan.objectives.knowledge[0] || '';
    }

    const card = document.createElement('div');
    card.className = 'saved-plan-card';
    card.innerHTML = `
      <div>
        <div class="saved-plan-card-header">
          <div>
            <div class="saved-plan-title">${escapeHtml(planRecord.title)}</div>
            ${planRecord.chapter ? `<div style="font-size: 0.8rem; color: var(--text-muted);">${escapeHtml(planRecord.chapter)}</div>` : ''}
          </div>
          <span class="plan-tag plan-tag-template">${escapeHtml(planRecord.templateBadge || 'MoEYS')}</span>
        </div>

        <div class="saved-plan-tags">
          <span class="plan-tag plan-tag-subject">${escapeHtml(planRecord.subject || 'មុខវិជ្ជា')}</span>
          <span class="plan-tag plan-tag-grade">${escapeHtml(planRecord.grade || 'ថ្នាក់')}</span>
        </div>

        <div class="saved-plan-snippet mt-2">
          ${escapeHtml(snippetText || 'កិច្ចតែងការបង្រៀនស្តង់ដារ')}
        </div>
      </div>

      <div>
        <div class="saved-plan-meta">
          <div><strong>គ្រឹះស្ថាន៖</strong> ${escapeHtml(planRecord.school || '-')} | <strong>គ្រូ៖</strong> ${escapeHtml(planRecord.teacher || '-')}</div>
          <div><strong>កាលបរិច្ឆេទ៖</strong> ${escapeHtml(planRecord.date || '-')}</div>
        </div>

        <div class="saved-plan-card-actions">
          <div class="actions-left">
            <button type="button" class="btn btn-sm btn-primary" onclick="openSavedPlanInCanvas('${planRecord.id}')" title="បើកមើលលើសន្លឹក A4">
              <i class="fa-solid fa-eye"></i> បើកមើល
            </button>
            <button type="button" class="btn btn-sm btn-outline btn-word" onclick="exportSavedPlanDocx('${planRecord.id}')" title="ទាញយកជា Word (.docx)">
              <i class="fa-solid fa-file-word"></i> Word
            </button>
          </div>
          <div class="actions-right">
            <button type="button" class="btn-icon-danger" onclick="deleteSavedPlan('${planRecord.id}')" title="លុបកិច្ចតែងការនេះ">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </div>
      </div>
    `;
    grid.appendChild(card);
  });
}

function openSavedPlanInCanvas(id) {
  const record = state.savedPlans.find(p => p.id === id);
  if (!record || !record.planData) {
    showToast('រកមិនឃើញទិន្នន័យកិច្ចតែងការនេះទេ', 'error');
    return;
  }

  state.generatedPlanData = record.planData;
  renderLessonPlanToA4(record.planData);

  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('printableDoc').style.display = 'block';

  // Also pre-fill the form inputs with this plan's info
  if (record.planData.subject) document.getElementById('inputSubject').value = record.planData.subject;
  if (record.planData.school) document.getElementById('inputSchool').value = record.planData.school;
  if (record.planData.teacher) document.getElementById('inputTeacher').value = record.planData.teacher;
  if (record.planData.duration) setDurationValue(record.planData.duration);
  if (record.planData.chapter) document.getElementById('inputChapter').value = record.planData.chapter;
  if (record.planData.lessonTitle) document.getElementById('inputLessonTitle').value = record.planData.lessonTitle;
  if (record.planData.method) document.getElementById('inputMethod').value = record.planData.method;

  if (record.planData.grade) {
    const degreeKey = findDegreeKeyForGrade(record.planData.grade);
    const inputDegree = document.getElementById('inputDegree');
    if (inputDegree && degreeKey) {
      inputDegree.value = degreeKey;
      updateGradeOptions(degreeKey, record.planData.grade);
    }
  }

  closeSavedPlansModal();
  showToast(`✨ បានបើកកិច្ចតែងការ "${record.title}" លើសន្លឹក A4 រួចរាល់!`, 'success');
}

async function exportSavedPlanDocx(id) {
  const record = state.savedPlans.find(p => p.id === id);
  if (!record || !record.planData) return;

  const previous = state.generatedPlanData;
  state.generatedPlanData = record.planData;
  await handleExportWord();
  state.generatedPlanData = previous;
}

function deleteSavedPlan(id) {
  const record = state.savedPlans.find(p => p.id === id);
  const title = record ? record.title : 'កិច្ចតែងការ';

  if (!confirm(`តើអ្នកពិតជាចង់លុបកិច្ចតែងការ "${title}" នេះចេញពីបណ្ណាល័យមែនទេ?`)) {
    return;
  }

  state.savedPlans = state.savedPlans.filter(p => p.id !== id);
  localStorage.setItem(SAVED_PLANS_STORAGE_KEY, JSON.stringify(state.savedPlans));
  updateSavedPlansCountBadge();
  renderSavedPlansGrid();
  showToast(`បានលុបកិច្ចតែងការ "${title}" ចេញរួចរាល់`, 'info');
}

function exportAllPlansAsJson() {
  if (!state.savedPlans || state.savedPlans.length === 0) {
    showToast('មិនទាន់មានកិច្ចតែងការសម្រាប់ Backup ទេ!', 'warning');
    return;
  }

  const backupData = {
    appName: "AI Lesson Plan Studio",
    version: "2.0",
    exportDate: new Date().toISOString(),
    plansCount: state.savedPlans.length,
    plans: state.savedPlans,
    lessons: state.savedLessons
  };

  const jsonStr = JSON.stringify(backupData, null, 2);
  const blob = new Blob([jsonStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `LessonPlans_Backup_${new Date().toISOString().slice(0,10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast(`📥 បានទាញយក Backup កិច្ចតែងការទាំងអស់ជោគជ័យ!`, 'success');
}

function importPlansFromJson(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      let importedPlansCount = 0;
      let importedLessonsCount = 0;

      if (data.plans && Array.isArray(data.plans)) {
        // Merge or prepend plans without duplicates by ID
        data.plans.forEach(plan => {
          if (!state.savedPlans.some(p => p.id === plan.id)) {
            state.savedPlans.unshift(plan);
            importedPlansCount++;
          }
        });
        localStorage.setItem(SAVED_PLANS_STORAGE_KEY, JSON.stringify(state.savedPlans));
      }

      if (data.lessons && Array.isArray(data.lessons)) {
        data.lessons.forEach(lesson => {
          if (!state.savedLessons.some(l => l.id === lesson.id)) {
            state.savedLessons.unshift(lesson);
            importedLessonsCount++;
          }
        });
        localStorage.setItem(SAVED_LESSONS_STORAGE_KEY, JSON.stringify(state.savedLessons));
        updateSavedLessonsUI();
      }

      updateSavedPlansCountBadge();
      renderSavedPlansGrid();
      showToast(`📤 បានស្តារ (${importedPlansCount} កិច្ចតែងការ, ${importedLessonsCount} មេរៀន) ដោយជោគជ័យ!`, 'success');
    } catch (err) {
      console.error('Import error:', err);
      showToast('ឯកសារ JSON មិនត្រឹមត្រូវ: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
}

// Google NotebookLM & Gemini Notebook Studio Actions - Flipped Classroom Video Micro-Lecture
let currentNotebookLmFlippedPrompt = '';

function prepareNotebookLmFlippedVideoPrompt() {
  const data = state.generatedPlanData || state.currentPlan;
  
  const subject = data?.subject || document.getElementById('txtSubject')?.value?.trim() || 'ចិត្តវិទ្យាអប់រំ';
  const grade = data?.grade || document.getElementById('txtGrade')?.value?.trim() || 'គរុនិស្សិត';
  const title = data?.lessonTitle || document.getElementById('txtLessonTitle')?.value?.trim() || 'មេរៀន';

  // 1. Prioritize Attached Lesson Content (ឯកសារមេរៀនដែលបានភ្ជាប់)
  let lessonBody = '';
  const attachedContent = data?.lessonContent || document.getElementById('txtLessonContent')?.value || '';
  if (attachedContent && attachedContent.trim().length > 15) {
    lessonBody = attachedContent.trim();
  } else {
    // Fallback: extract academic theories and concepts from Step 3 & 4 contentSummary only
    const concepts = [];
    if (data?.steps && Array.isArray(data.steps)) {
      data.steps.forEach(st => {
        // Exclude step 1 (admin) and step 5 (homework), focus on academic content
        if (st.contentSummary && st.contentSummary.trim().length > 15) {
          const titleClean = st.stepTitle || 'ខ្លឹមសារស្នូល';
          if (!titleClean.includes('រដ្ឋបាល') && !titleClean.includes('កិច្ចការផ្ទះ')) {
            concepts.push(`• ${titleClean}៖\n${st.contentSummary.trim()}`);
          }
        }
      });
    }
    lessonBody = concepts.join('\n\n');
  }

  // 2. Learning Objectives (Knowledge & Skills only)
  let objText = '';
  if (data?.objectives) {
    const list = [];
    if (data.objectives.knowledge?.length) list.push(...data.objectives.knowledge);
    if (data.objectives.skills?.length) list.push(...data.objectives.skills);
    if (list.length) objText = list.map(o => `- ${o}`).join('\n');
  }

  // 3. Build the 100% Khmer Pre-Class Flipped Classroom Video Prompt
  let prompt = `=======================================================\n`;
  prompt += `PROMPT វីដេអូស្វ័យសិក្សាត្រៀមមុនម៉ោង (FLIPPED CLASSROOM MICRO-LECTURE)\n`;
  prompt += `ភាសានិយាយ និងអក្សរលើស្លាយ៖ ភាសាខ្មែរ ១០០% (FONT: KANTUMRUY PRO)\n`;
  prompt += `=======================================================\n\n`;
  prompt += `សូមដើរតួជាសាស្ត្រាចារ្យគរុកោសល្យ និងជាអ្នកជំនាញផលិតវីដេអូអប់រំឌីជីថល។ សូមផលិតវីដេអូពន្យល់មេរៀនខ្នាតខ្លី (Educational Explainer Video / Micro-Lecture) រយៈពេល ៥ ទៅ ៨ នាទី សម្រាប់សិស្ស/គរុនិស្សិតស្វ័យសិក្សាត្រៀមមុនចូលរៀនក្នុងថ្នាក់ (Pre-Class Phase ក្នុងគំរូ Flipped Classroom) សម្រាប់មេរៀន «${title}» មុខវិជ្ជា ${subject} ${grade}។\n\n`;

  prompt += `⚠️ លក្ខខណ្ឌតម្រូវចាំបាច់បំផុត (CRITICAL REQUIREMENTS)៖\n`;
  prompt += `១. ភាសានិយាយ និងអក្សរលើស្លាយ (Language):\n`;
  prompt += `   • ទាំងសំឡេងគ្រូអត្ថាធិប្បាយ (Narration Voiceover) និងអក្សរសង្ខេបបង្ហាញលើស្លាយវីដេអូ (On-Screen Text) ត្រូវតែជា «ភាសាខ្មែរ ១០០%» (Font 'Kantumruy Pro')។\n`;
  prompt += `   • ទឹកដមសំឡេងត្រូវមានភាពរស់រវើក ទាក់ទាញ ច្បាស់ៗ រលូន និងមានលក្ខណៈអប់រំកម្រិតខ្ពស់។ ដាច់ខាតកុំប្រើប្រាស់ភាសាអង់គ្លេសលើស្លាយ ឬក្នុងសំឡេងនិយាយ!\n\n`;

  prompt += `២. រចនាសម្ព័ន្ធវីដេអូ ៤ ឈុត (4-Scene Micro-Lecture Structure)៖\n`;
  prompt += `   • ឈុតទី១ (អារម្ភកថា & ចំណុចចាប់អារម្មណ៍ - ១ នាទី)៖ បង្ហាញពីសារៈសំខាន់នៃមេរៀនក្នុងជីវភាពរស់នៅជាក់ស្តែង និងចោទជាបញ្ហា ឬភាពចង់ដឹង ដើម្បីទាក់ទាញការយកចិត្តទុកដាក់របស់សិស្ស។\n`;
  prompt += `   • ឈុតទី២ (ទ្រឹស្តី និងបញ្ញត្តិស្នូល - ៣ នាទី)៖ ពន្យល់និយមន័យ បញ្ញត្តិ និងទ្រឹស្តីគន្លឹះជាភាសាខ្មែរឱ្យច្បាស់លាស់ និងងាយយល់ អមដោយដ្យាក្រាម រូបភាព ឬគំនូរជីវចលពន្យល់។\n`;
  prompt += `   • ឈុតទី៣ (ករណីសិក្សា និងការអនុវត្តជាក់ស្តែង - ២ នាទី)៖ លើកករណីសិក្សាជាក់ស្តែងក្នុងបរិបទសង្គម និងការអប់រំនៅកម្ពុជា ដើម្បីបង្ហាញពីរបៀបដោះស្រាយបញ្ហាតាមក្បួនចិត្តវិទ្យា/គរុកោសល្យ។\n`;
  prompt += `   • ឈុតទី៤ (សង្ខេប & សំណួរត្រិះរិះត្រៀមចូលថ្នាក់ - ១ នាទី)៖ សង្ខេបចំណុចសំខាន់ៗដែលបានរៀន និងដាក់សំណួរពិចារណា ២-៣ សំណួរ ដើម្បីឱ្យសិស្សត្រិះរិះទុកជាមុន និងត្រៀមយកមកពិភាក្សាដេញដោលក្នុងថ្នាក់រៀន (In-Class Active Learning)។\n\n`;

  prompt += `៣. ខ្លឹមសារត្រូវផ្តោតតែលើ «ចំណេះដឹងមេរៀន» (Content Only)៖\n`;
  prompt += `   • វីដេអូនេះសម្រាប់សិស្សរៀន ដូច្នេះហាមដាច់ខាតមិនឱ្យនិយាយពីរឿងរដ្ឋបាលថ្នាក់ ការសម្រង់វត្តមាន អនាម័យថ្នាក់ ឬការបែងចែកក្រុមឡើយ!\n\n`;

  if (objText) {
    prompt += `=======================================================\n`;
    prompt += `[វត្ថុបំណងនៃការរៀនសូត្រ]\n`;
    prompt += `${objText}\n\n`;
  }

  if (lessonBody) {
    prompt += `=======================================================\n`;
    prompt += `[ខ្លឹមសារឯកសារមេរៀនសម្រាប់ផលិតវីដេអូ]\n`;
    prompt += `=======================================================\n`;
    prompt += `${lessonBody}\n\n`;
  }

  if (data?.notebooklmGuide?.keyTakeaways?.length) {
    prompt += `[ចំណុចគន្លឹះបន្ថែម]\n`;
    data.notebooklmGuide.keyTakeaways.forEach(k => prompt += `• ${k}\n`);
    prompt += `\n`;
  }

  return prompt;
}

function prepareNotebookLmText() {
  return prepareNotebookLmFlippedVideoPrompt();
}
function prepareNotebookLmSource() {
  return prepareNotebookLmFlippedVideoPrompt();
}
function prepareNotebookLmShortPrompt() {
  return prepareNotebookLmFlippedVideoPrompt();
}

async function copyNotebookLMFlippedPrompt(e) {
  if (e) e.stopPropagation();
  const text = currentNotebookLmFlippedPrompt || prepareNotebookLmFlippedVideoPrompt();
  try {
    await navigator.clipboard.writeText(text);
    showToast('✨ បានចម្លង Prompt វីដេអូ Flipped Classroom (ភាសាខ្មែរ ១០០%) រួចរាល់!', 'success');
  } catch (err) {
    showToast('មិនអាចចម្លងបានទេ: ' + err.message, 'error');
  }
}
window.copyNotebookLMFlippedPrompt = copyNotebookLMFlippedPrompt;
window.copyNotebookLMShortPrompt = copyNotebookLMFlippedPrompt;
window.copyNotebookLMSourceOnly = copyNotebookLMFlippedPrompt;
window.copyNotebookLMPromptAgain = copyNotebookLMFlippedPrompt;

async function openNotebookLM() {
  try {
    const flippedPrompt = prepareNotebookLmFlippedVideoPrompt();
    currentNotebookLmFlippedPrompt = flippedPrompt;

    // Auto-copy Flipped Classroom Video Prompt to clipboard
    let copied = false;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(flippedPrompt);
        copied = true;
      } catch (cErr) {
        console.warn('Clipboard API error, trying fallback:', cErr);
      }
    }
    if (!copied) {
      try {
        const ta = document.createElement('textarea');
        ta.value = flippedPrompt;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        copied = true;
      } catch (fbErr) {
        console.warn('execCommand copy fallback failed:', fbErr);
      }
    }

    // Populate preview text in modal
    const previewEl = document.getElementById('notebookLmCopiedPreview');
    if (previewEl) {
      previewEl.textContent = flippedPrompt;
    }

    // Open modal popup
    const modal = document.getElementById('notebookLmModal');
    if (modal) {
      modal.style.display = 'flex';
      showToast('✨ បានចម្លង Prompt វីដេអូ Flipped Classroom ចូល Clipboard រួចរាល់!', 'success');
    } else {
      window.open('https://notebooklm.google.com/', '_blank');
    }
  } catch (err) {
    console.error('openNotebookLM error:', err);
    window.open('https://notebooklm.google.com/', '_blank');
  }
}
window.openNotebookLM = openNotebookLM;
window.autoOpenNotebookLMWithPrompt = openNotebookLM;
window.copyNotebookLMPrompt = openNotebookLM;

function closeNotebookLmModal() {
  const modal = document.getElementById('notebookLmModal');
  if (modal) modal.style.display = 'none';
}
window.closeNotebookLmModal = closeNotebookLmModal;

function proceedToNotebookLMWeb() {
  closeNotebookLmModal();
  const win = window.open('https://notebooklm.google.com/', '_blank');
  if (!win || win.closed || typeof win.closed === 'undefined') {
    window.location.href = 'https://notebooklm.google.com/';
  } else {
    showToast('🚀 កំពុងបើក Google NotebookLM... សូមចុច Ctrl+V ដើម្បីបិទភ្ជាប់ Prompt!', 'success');
  }
}
window.proceedToNotebookLMWeb = proceedToNotebookLMWeb;

function proceedToGeminiWeb() {
  closeNotebookLmModal();
  const win = window.open('https://gemini.google.com/', '_blank');
  if (!win || win.closed || typeof win.closed === 'undefined') {
    window.location.href = 'https://gemini.google.com/';
  } else {
    showToast('🚀 កំពុងបើក Google Gemini... សូមចុច Ctrl+V ដើម្បីបិទភ្ជាប់ Prompt!', 'success');
  }
}
window.proceedToGeminiWeb = proceedToGeminiWeb;

function downloadNotebookLMSourceFile() {
  copyNotebookLMFlippedPrompt();
}
window.downloadNotebookLMSourceFile = downloadNotebookLMSourceFile;
window.downloadNotebookLMSourceFile = downloadNotebookLMSourceFile;

async function copyVideoAIScriptPrompt() {
  const data = state.generatedPlanData || state.currentPlan;
  if (!data) {
    showToast('សូមបង្កើតកិច្ចតែងការជាមុនសិន!', 'warning');
    return;
  }

  const title = data.lessonTitle || 'មេរៀន';
  const subject = data.subject || '';
  const grade = data.grade || '';
  const segments = data.notebooklmGuide?.scriptSegments || [];

  let text = `🎬 AI VIDEO GENERATION SCRIPT & PROMPT (Canva / CapCut / InVideo / HeyGen)\n`;
  text += `=======================================================\n`;
  text += `📌 ប្រធានបទ៖ ${title} (${subject} ${grade})\n`;
  text += `🎯 ទម្រង់៖ វីដេអូបង្រៀនខ្លី Micro-Lecture (៥ ទៅ ៨ នាទី) ជាភាសាខ្មែរ ១០០%\n`;
  text += `🔤 ពុម្ពអក្សរអក្សររត់លើអេក្រង់ (On-Screen Captions)៖ Font "Kantumruy Pro"\n`;
  text += `🎙️ សំឡេងអត្ថាធិប្បាយ៖ គ្រូបង្រៀនពន្យល់ក្បោះក្បាយ ច្បាស់ៗ រួសរាយ និងទាក់ទាញ (Khmer Teacher Narration)\n`;
  text += `=======================================================\n\n`;

  if (segments && segments.length > 0) {
    segments.forEach((seg, idx) => {
      text += `--- ឈុតឆាកទី ${idx + 1} (${seg.timestamp || ''}) ---\n`;
      if (seg.screenText || seg.visualCue) {
        text += `📺 សកម្មភាព/អត្ថបទលើអេក្រង់ (Font: Kantumruy Pro)៖\n${seg.screenText || seg.visualCue || ''}\n`;
      }
      text += `🎙️ សំឡេងអានបង្រៀន (Voiceover Narration)៖\n"${seg.dialogue || seg.narration || ''}"\n\n`;
    });
  } else {
    text += `[0:00 - 1:30] Hook & Intro to ${title}\n`;
    text += `[1:30 - 4:00] Core Concepts & Formulas\n`;
    text += `[4:00 - 6:30] Real-world Applications & Examples\n`;
    text += `[6:30 - 8:00] Summary & Reflection Challenge\n\n`;
  }

  text += `=======================================================\n`;
  text += `💡 ការណែនាំ៖ លោកអ្នកអាចយក Script នេះទៅ Paste ក្នុង Canva (Magic Studio), CapCut (Script to Video) ឬ InVideo AI ដើម្បី Render វីដេអូបានភ្លាមៗ!`;

  try {
    await navigator.clipboard.writeText(text);
    showToast('🎬 បានចម្លង Script វីដេអូ AI (Font: Kantumruy Pro) រួចរាល់! អាចយកទៅ Paste ក្នុង Canva, CapCut ឬ InVideo AI។', 'success');
  } catch (err) {
    showToast('មិនអាចចម្លងបានទេ: ' + err.message, 'error');
  }
}

let isPlayingAudio = false;
let currentKhmerAudio = null;
let khmerAudioQueue = [];
let khmerAudioIndex = 0;

function stopKhmerAudioPlayback() {
  isPlayingAudio = false;
  khmerAudioQueue = [];
  khmerAudioIndex = 0;
  if (currentKhmerAudio) {
    currentKhmerAudio.pause();
    currentKhmerAudio.src = '';
    currentKhmerAudio = null;
  }
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  const btn = document.getElementById('btnPlayInAppAudio');
  if (btn) btn.innerHTML = '<i class="fa-solid fa-play"></i> ▶️ ស្តាប់ក្នុងកម្មវិធី';
}

function playNextKhmerChunk() {
  if (!isPlayingAudio || khmerAudioIndex >= khmerAudioQueue.length) {
    stopKhmerAudioPlayback();
    showToast('✅ បានចាក់សំឡេងសង្ខេបមេរៀនចប់សព្វគ្រប់', 'success');
    return;
  }

  const chunk = khmerAudioQueue[khmerAudioIndex];
  khmerAudioIndex++;

  if (!chunk || !chunk.trim()) {
    playNextKhmerChunk();
    return;
  }

  // Use local backend TTS proxy for 100% genuine Khmer speech stream
  const encoded = encodeURIComponent(chunk.trim());
  const localUrl = `/api/tts/khmer?text=${encoded}`;

  currentKhmerAudio = new Audio(localUrl);
  currentKhmerAudio.onended = () => {
    playNextKhmerChunk();
  };
  currentKhmerAudio.onerror = () => {
    // If running in standalone file:// without server, try direct or fallback
    const directUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=km&client=tw-ob&q=${encoded}`;
    currentKhmerAudio = new Audio(directUrl);
    currentKhmerAudio.onended = () => playNextKhmerChunk();
    currentKhmerAudio.onerror = () => {
      fallbackSpeechSynthesis(chunk, () => playNextKhmerChunk());
    };
    currentKhmerAudio.play().catch(e => {
      fallbackSpeechSynthesis(chunk, () => playNextKhmerChunk());
    });
  };

  currentKhmerAudio.play().catch(e => {
    fallbackSpeechSynthesis(chunk, () => playNextKhmerChunk());
  });
}

function fallbackSpeechSynthesis(text, onDone) {
  if (!('speechSynthesis' in window)) {
    if (onDone) onDone();
    return;
  }
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'km-KH';
  utter.rate = 0.9;
  utter.pitch = 1.0;

  const voices = window.speechSynthesis.getVoices();
  const kmVoice = voices.find(v => (v.lang && (v.lang.includes('km') || v.lang.includes('KM'))) || (v.name && v.name.toLowerCase().includes('khmer')));
  if (kmVoice) {
    utter.voice = kmVoice;
  }

  utter.onend = () => { if (onDone) onDone(); };
  utter.onerror = () => { if (onDone) onDone(); };
  window.speechSynthesis.speak(utter);
}

function toggleInAppAudioPodcast() {
  const btn = document.getElementById('btnPlayInAppAudio');
  const data = state.generatedPlanData;
  if (!data) return;

  if (isPlayingAudio) {
    stopKhmerAudioPlayback();
    showToast('⏹️ បានបញ្ឈប់ការចាក់សំឡេង', 'info');
    return;
  }

  // Extract clean Khmer dialogue sentences
  const sentences = [];
  sentences.push(`សូមស្វាគមន៍មកកាន់ការសង្ខេបមេរៀន ${data.subject || ''} ${data.grade || ''} ${data.lessonTitle || ''}។`);

  if (data.notebooklmGuide?.scriptSegments && data.notebooklmGuide.scriptSegments.length > 0) {
    data.notebooklmGuide.scriptSegments.forEach(s => {
      const cleanDialogue = (s.dialogue || s.narration || '').replace(/\[.*?\]/g, '').replace(/Host [AB] \(.*?\):/g, '').replace(/https?:\/\/\S+/g, '').trim();
      if (cleanDialogue) {
        // Split dialogue by periods/sentence markers if too long
        const parts = cleanDialogue.split(/(?<=[។!?\n])/);
        parts.forEach(p => {
          const t = p.trim();
          if (t.length > 0) {
            // Further chunk if > 120 chars for TTS smoothness
            if (t.length > 120) {
              const subparts = t.match(/.{1,100}(\s|$)/g) || [t];
              subparts.forEach(sp => { if (sp.trim()) sentences.push(sp.trim()); });
            } else {
              sentences.push(t);
            }
          }
        });
      }
    });
  } else {
    (data.objectives?.knowledge || []).forEach(k => sentences.push(k));
  }

  if (sentences.length === 0) {
    showToast('មិនមានអត្ថបទសម្រាប់ចាក់សំឡេងទេ!', 'warning');
    return;
  }

  khmerAudioQueue = sentences;
  khmerAudioIndex = 0;
  isPlayingAudio = true;

  if (btn) btn.innerHTML = '<i class="fa-solid fa-stop"></i> ⏹️ កំពុងនិយាយភាសាខ្មែរ... (ចុចបញ្ឈប់)';
  showToast('🔊 កំពុងចាក់សំឡេងសន្ទនាជាភាសាខ្មែរ...', 'info');

  playNextKhmerChunk();
}

// NotebookLM trigger alias
function triggerNotebookLMFromMenu() {
  openNotebookLM();
}

// ==========================================================================
// 🎬 IN-APP VIDEO MICRO-LECTURE STUDIO ENGINE (HTML5 HD Canvas & WebM)
// ==========================================================================
let videoStudioState = {
  isOpen: false,
  isPlaying: false,
  currentScene: 0,
  scenes: [],
  planData: null,
  animTick: 0,
  animFrameId: null,
  playbackTimer: null,
  isRecording: false,
  mediaRecorder: null,
  recordedChunks: [],
  particles: []
};

// Initialize background particles
for (let i = 0; i < 35; i++) {
  videoStudioState.particles.push({
    x: Math.random() * 1280,
    y: Math.random() * 720,
    radius: Math.random() * 3 + 1,
    vx: (Math.random() - 0.5) * 0.8,
    vy: (Math.random() - 0.5) * 0.8,
    alpha: Math.random() * 0.6 + 0.2,
    color: ['#38bdf8', '#818cf8', '#34d399', '#f472b6', '#3b82f6'][Math.floor(Math.random() * 5)]
  });
}

function buildDefaultVideoScenes(data) {
  const subject = data?.subject || 'មុខវិជ្ជា';
  const grade = data?.grade || 'ថ្នាក់ទី';
  const title = data?.lessonTitle || 'មេរៀនស្វ័យប្រវត្តិ';
  const duration = data?.duration || '៥០ នាទី';
  
  const objList = [...(data?.objectives?.knowledge || []), ...(data?.objectives?.skills || [])];
  const obj1 = objList[0] || 'ស្វែងយល់ពីនិយមន័យ និងទ្រឹស្តីមូលដ្ឋាននៃមេរៀន';
  const obj2 = objList[1] || 'អនុវត្តរូបមន្ត និងដោះស្រាយលំហាត់គំរូជាក់ស្តែង';
  const obj3 = objList[2] || 'បណ្តុះបំណិនរិះគិត និងការធ្វើការងារជាក្រុម';

  let core1 = 'ស្វែងយល់ពីគោលការណ៍គ្រឹះ ច្បាប់ និងនិយមន័យសំខាន់ៗ';
  let core2 = 'ការវិភាគបាតុភូត និងទំនាក់ទំនងនៃរូបមន្តក្នុងជីវភាព';
  let core3 = 'គន្លឹះចងចាំលឿន និងចំណុចងាយភ័ន្តច្រឡំ';

  if (data?.notebooklmGuide?.keyTakeaways && data.notebooklmGuide.keyTakeaways.length >= 3) {
    core1 = data.notebooklmGuide.keyTakeaways[0];
    core2 = data.notebooklmGuide.keyTakeaways[1];
    core3 = data.notebooklmGuide.keyTakeaways[2];
  }

  return [
    {
      id: 1,
      name: 'ឈុតទី ១: សេចក្តីផ្តើម & គោលបំណង',
      timeRange: '0:00 - 1:30',
      badge: '🎯 សេចក្តីផ្តើម',
      title: title,
      subtitle: `${subject} ${grade} • រយៈពេល ${duration}`,
      bullets: [
        `✨ ស្វាគមន៍មកកាន់ Video Micro-Lecture ស្វ័យសិក្សាមុនម៉ោង`,
        `🎯 វត្ថុបំណងទី ១៖ ${obj1}`,
        `💡 វត្ថុបំណងទី ២៖ ${obj2}`
      ],
      narration: `សូមស្វាគមន៍ប្អូនៗសិស្សានុសិស្សមកកាន់វីដេអូមេរៀនខ្នាតខ្លី ស្តីពី «${title}» នៃមុខវិជ្ជា ${subject} ${grade}។ មុនពេលចូលរៀនក្នុងថ្នាក់ ប្អូនៗត្រូវស្វែងយល់ពីគោលបំណងចម្បងនៃមេរៀននេះដើម្បីត្រៀមខ្លួនអនុវត្តសកម្មភាពជាក់ស្តែង ៧០% ក្នុងថ្នាក់រៀន!`,
      colorTheme: '#0284c7'
    },
    {
      id: 2,
      name: 'ឈុតទី ២: ទ្រឹស្តីស្នូល & និយមន័យ',
      timeRange: '1:30 - 4:00',
      badge: '🔬 ទ្រឹស្តីស្នូល',
      title: `ទ្រឹស្តី និងរូបមន្តគន្លឹះនៃ «${title}»`,
      subtitle: 'គោលការណ៍វិទ្យាសាស្ត្រ និងការបកស្រាយលម្អិត',
      bullets: [
        `📌 ${core1}`,
        `⚡ ${core2}`,
        `🧠 ${core3}`
      ],
      narration: `ចំណុចស្នូលទីមួយនៃមេរៀននេះ គឺការយល់ដឹងពីទ្រឹស្តី និងនិយមន័យសំខាន់ៗ។ ${core1}។ សូមកត់ចំណាំរូបមន្ត និងពាក្យគន្លឹះទាំងនេះចូលទៅក្នុងសៀវភៅកំណត់ហេតុសិក្សារបស់ប្អូនៗ!`,
      colorTheme: '#6366f1'
    },
    {
      id: 3,
      name: 'ឈុតទី ៣: ឧទាហរណ៍ជាក់ស្តែង & ការអនុវត្ត',
      timeRange: '4:00 - 6:30',
      badge: '💡 អនុវត្តជាក់ស្តែង',
      title: 'ឧទាហរណ៍គំរូ & ការដោះស្រាយបញ្ហា',
      subtitle: 'ផ្សារភ្ជាប់ទ្រឹស្តីទៅនឹងការដោះស្រាយជាក់ស្តែង',
      bullets: [
        `📊 វិភាគឧទាហរណ៍គំរូមួយជំហានម្តងៗប្រកបដោយភាពច្បាស់លាស់`,
        `🛠️ វិធីសាស្ត្រដោះស្រាយ និងជៀសវាងកំហុសឆ្គងទូទៅ`,
        `🤝 ត្រៀមធ្វើការងារជាក្រុមតូច (Active Learning) ក្នុងថ្នាក់រៀន`
      ],
      narration: `ដើម្បីយល់កាន់តែច្បាស់ យើងមកពិនិត្យមើលឧទាហរណ៍ជាក់ស្តែង។ នៅពេលអនុវត្ត សូមប្រុងប្រយ័ត្នលើជំហានគណនា និងការបកស្រាយលទ្ធផល។ ចំណុចនេះនឹងត្រូវយកទៅអនុវត្តជាក្រុមនៅជំហានទី ៤ ក្នុងថ្នាក់រៀន!`,
      colorTheme: '#10b981'
    },
    {
      id: 4,
      name: 'ឈុតទី ៤: សង្ខេប & ការត្រៀម Pre-Test',
      timeRange: '6:30 - 8:00',
      badge: '📝 សង្ខេប & Pre-Test',
      title: 'សង្ខេបមេរៀន & ឆ្លើយ Pre-Test QCM',
      subtitle: 'វាស់ស្ទង់សមត្ថភាពមុនពេលចូលរៀន',
      bullets: [
        `✅ ចងចាំគន្លឹះសំខាន់ៗទាំង ៣ នៃមេរៀន`,
        `📝 ចូលទៅកាន់តំណភ្ជាប់ Google Form / QCM ដើម្បីឆ្លើយសំណួរ ១០ សំណួរ`,
        `🚀 ត្រៀមខ្លួនសម្រាប់សកម្មភាពដេញដោល និងពិសោធន៍ក្នុងថ្នាក់!`
      ],
      narration: `ជាចុងក្រោយ សូមប្អូនៗឆ្លើយវិញ្ញាសាបុរេតេស្ត Pre-Test QCM ចំនួន ១០ សំណួរ ដែលលោកគ្រូអ្នកគ្រូបានផ្ញើតាមរយៈ Google Form ឬតំណភ្ជាប់ interactive មុនពេលចូលថ្នាក់រៀន។ សូមអរគុណ និងជួបគ្នាក្នុងម៉ោងសិក្សា!`,
      colorTheme: '#f59e0b'
    }
  ];
}

function openVideoStudioModal(customPlan = null) {
  const data = customPlan || state.generatedPlanData || (typeof SAMPLE_LESSONS !== 'undefined' ? SAMPLE_LESSONS[0] : null) || {
    subject: 'ជីវវិទ្យា',
    grade: 'ថ្នាក់ទី ១០',
    lessonTitle: 'ការបំប្លែងថាមពលក្នុងកោសិកា (Cellular Respiration & Photosynthesis)',
    duration: '៥០ នាទី'
  };

  videoStudioState.planData = data;
  videoStudioState.scenes = buildDefaultVideoScenes(data);
  videoStudioState.currentScene = 0;
  videoStudioState.isPlaying = false;
  videoStudioState.animTick = 0;

  // Render Scene navigation pills
  const pillsWrap = document.getElementById('studioScenePills');
  if (pillsWrap) {
    pillsWrap.innerHTML = videoStudioState.scenes.map((s, idx) => `
      <button type="button" class="btn-scene-pill ${idx === 0 ? 'active' : ''}" onclick="selectStudioScene(${idx})" id="scenePill_${idx}" style="background: ${idx === 0 ? s.colorTheme : '#1e293b'}; color: white; border: 1px solid ${s.colorTheme}; border-radius: 20px; padding: 5px 12px; font-size: 0.8rem; cursor: pointer; transition: all 0.2s;">
        ${s.badge} (${s.timeRange})
      </button>
    `).join('');
  }

  // Render Script details
  const scriptWrap = document.getElementById('studioScriptScenes');
  if (scriptWrap) {
    scriptWrap.innerHTML = videoStudioState.scenes.map((s, idx) => `
      <div style="background: #0f172a; padding: 10px 12px; border-radius: 8px; border-left: 4px solid ${s.colorTheme};">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <span style="font-weight: bold; color: ${s.colorTheme}; font-size: 0.88rem;">${s.name} [${s.timeRange}]</span>
          <button type="button" onclick="selectStudioScene(${idx}); toggleVideoPlayback(true);" style="background: rgba(255,255,255,0.1); color: #cbd5e1; border: none; border-radius: 4px; padding: 2px 8px; font-size: 0.75rem; cursor: pointer;">
            <i class="fa-solid fa-play"></i> ចាក់ឈុតនេះ
          </button>
        </div>
        <div style="font-size: 0.82rem; color: #e2e8f0; line-height: 1.5; font-family: 'Kantumruy Pro', sans-serif;">
          <strong>🎙️ ការអានបកស្រាយ (Narration):</strong> ${s.narration}
        </div>
      </div>
    `).join('');
  }

  const subLabel = document.getElementById('videoStudioSubtitle');
  if (subLabel) {
    subLabel.textContent = `«${data.lessonTitle || 'មេរៀន'}» (${data.subject || ''} ${data.grade || ''}) • Font: Kantumruy Pro`;
  }

  const modal = document.getElementById('videoStudioModal');
  if (modal) {
    modal.style.display = 'flex';
    videoStudioState.isOpen = true;
  }

  // Start Canvas animation loop
  startStudioCanvasLoop();
  drawCurrentStudioFrame();
}

function openVideoStudioWithDemo() {
  const demoLesson = (typeof SAMPLE_LESSONS !== 'undefined' ? SAMPLE_LESSONS[0] : null) || {
    subject: 'ជីវវិទ្យា',
    grade: 'ថ្នាក់ទី ១០',
    lessonTitle: 'ការបំប្លែងថាមពលក្នុងកោសិកា (Cellular Respiration & Photosynthesis)',
    duration: '៥០ នាទី'
  };
  openVideoStudioModal(demoLesson);
}

function closeVideoStudioModal() {
  const modal = document.getElementById('videoStudioModal');
  if (modal) modal.style.display = 'none';
  videoStudioState.isOpen = false;
  videoStudioState.isPlaying = false;
  if (videoStudioState.animFrameId) {
    cancelAnimationFrame(videoStudioState.animFrameId);
    videoStudioState.animFrameId = null;
  }
  if (videoStudioState.playbackTimer) {
    clearTimeout(videoStudioState.playbackTimer);
    videoStudioState.playbackTimer = null;
  }
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

function selectStudioScene(idx) {
  if (idx < 0 || idx >= videoStudioState.scenes.length) return;
  videoStudioState.currentScene = idx;

  // Update pills UI
  videoStudioState.scenes.forEach((s, i) => {
    const pill = document.getElementById(`scenePill_${i}`);
    if (pill) {
      if (i === idx) {
        pill.style.background = s.colorTheme;
        pill.classList.add('active');
      } else {
        pill.style.background = '#1e293b';
        pill.classList.remove('active');
      }
    }
  });

  const timeDisplay = document.getElementById('studioTimeDisplay');
  if (timeDisplay) {
    timeDisplay.textContent = `⏱️ ឈុតទី ${idx + 1} / ${videoStudioState.scenes.length} (${videoStudioState.scenes[idx].timeRange})`;
  }

  drawCurrentStudioFrame();
}

function drawCurrentStudioFrame() {
  const canvas = document.getElementById('studioVideoCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width || 1280;
  const h = canvas.height || 720;
  const scene = videoStudioState.scenes[videoStudioState.currentScene] || videoStudioState.scenes[0];
  if (!scene) return;

  const tick = videoStudioState.animTick;

  // 1. Clear & Studio Dark Gradient Background
  const bgGrad = ctx.createLinearGradient(0, 0, w, h);
  bgGrad.addColorStop(0, '#040b17');
  bgGrad.addColorStop(0.5, '#0b192e');
  bgGrad.addColorStop(1, '#020617');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, w, h);

  // 2. Animated Floating Particles
  videoStudioState.particles.forEach(p => {
    p.x += p.vx;
    p.y += p.vy;
    if (p.x < 0) p.x = w;
    if (p.x > w) p.x = 0;
    if (p.y < 0) p.y = h;
    if (p.y > h) p.y = 0;

    ctx.save();
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.globalAlpha = p.alpha * (0.6 + 0.4 * Math.sin(tick * 0.05 + p.x));
    ctx.fill();
    ctx.restore();
  });

  // 3. Grid Tech Lines
  ctx.save();
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.04)';
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 60) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += 60) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.restore();

  // 4. Header Bar
  ctx.save();
  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
  ctx.fillRect(40, 24, w - 80, 54);
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.3)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(40, 24, w - 80, 54);

  // Glowing Dot
  const pulse = Math.abs(Math.sin(tick * 0.08));
  ctx.beginPath();
  ctx.arc(65, 51, 8, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(239, 68, 68, ${0.4 + 0.6 * pulse})`;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(65, 51, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#ef4444';
  ctx.fill();

  // Header Title
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 20px "Kantumruy Pro", sans-serif';
  ctx.fillText('🎬 IN-APP VIDEO MICRO-LECTURE • MOEYS FLIPPED LEARNING', 85, 57);

  // Timestamp Pill on right
  ctx.fillStyle = scene.colorTheme;
  ctx.fillRect(w - 290, 32, 230, 38);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 16px "Kantumruy Pro", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`⏱️ ${scene.timeRange} (${scene.badge})`, w - 175, 57);
  ctx.restore();

  // 5. Left Presenter Card (Avatar & Audio Waves)
  const leftX = 40;
  const leftY = 100;
  const leftW = 280;
  const leftH = 460;

  ctx.save();
  ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
  ctx.strokeStyle = scene.colorTheme;
  ctx.lineWidth = 2;
  roundRect(ctx, leftX, leftY, leftW, leftH, 16, true, true);

  // Teacher Avatar Circle
  const avX = leftX + leftW / 2;
  const avY = leftY + 110;

  // Pulsing Wave Rings when playing
  if (videoStudioState.isPlaying) {
    for (let r = 1; r <= 3; r++) {
      const ringRadius = 55 + r * 15 + Math.sin(tick * 0.1 + r) * 8;
      ctx.beginPath();
      ctx.arc(avX, avY, ringRadius, 0, Math.PI * 2);
      ctx.strokeStyle = scene.colorTheme;
      ctx.globalAlpha = Math.max(0, 0.4 - r * 0.1);
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // Avatar Icon Circle
  ctx.globalAlpha = 1.0;
  ctx.beginPath();
  ctx.arc(avX, avY, 52, 0, Math.PI * 2);
  const avGrad = ctx.createLinearGradient(avX - 52, avY - 52, avX + 52, avY + 52);
  avGrad.addColorStop(0, scene.colorTheme);
  avGrad.addColorStop(1, '#1e1b4b');
  ctx.fillStyle = avGrad;
  ctx.fill();
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Teacher Icon Emoji
  ctx.fillStyle = '#ffffff';
  ctx.font = '46px "Kantumruy Pro", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('👨‍🏫', avX, avY + 16);

  // Presenter Name
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 18px "Kantumruy Pro", sans-serif';
  ctx.fillText('គ្រូបង្រៀននិម្មិត (AI Tutor)', avX, avY + 95);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '14px "Kantumruy Pro", sans-serif';
  ctx.fillText('Khmer Voice & Typography', avX, avY + 120);

  // Status Pill
  ctx.fillStyle = videoStudioState.isPlaying ? 'rgba(16, 185, 129, 0.2)' : 'rgba(148, 163, 184, 0.2)';
  ctx.strokeStyle = videoStudioState.isPlaying ? '#10b981' : '#94a3b8';
  ctx.lineWidth = 1;
  roundRect(ctx, leftX + 40, leftY + 280, leftW - 80, 36, 18, true, true);

  ctx.fillStyle = videoStudioState.isPlaying ? '#34d399' : '#cbd5e1';
  ctx.font = 'bold 14px "Kantumruy Pro", sans-serif';
  ctx.fillText(videoStudioState.isPlaying ? '🎙️ កំពុងចាក់សំឡេង...' : '⏸️ ផ្អាកការចាក់', avX, leftY + 303);

  // Voice wave bars
  for (let b = 0; b < 12; b++) {
    const barH = videoStudioState.isPlaying ? 8 + Math.abs(Math.sin(tick * 0.15 + b * 0.6)) * 28 : 6;
    const barX = leftX + 50 + b * 15;
    const barY = leftY + 390 - barH / 2;
    ctx.fillStyle = scene.colorTheme;
    ctx.fillRect(barX, barY, 8, barH);
  }
  ctx.restore();

  // 6. Right Main Slide Card
  const mainX = 340;
  const mainY = 100;
  const mainW = w - 380;
  const mainH = 460;

  ctx.save();
  ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
  ctx.lineWidth = 2;
  roundRect(ctx, mainX, mainY, mainW, mainH, 16, true, true);

  // Inner top badge
  ctx.fillStyle = scene.colorTheme;
  roundRect(ctx, mainX + 30, mainY + 26, 180, 32, 8, true, false);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 15px "Kantumruy Pro", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(scene.badge, mainX + 120, mainY + 48);

  // Slide Title (Font: Kantumruy Pro)
  ctx.textAlign = 'left';
  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 26px "Kantumruy Pro", sans-serif';
  wrapCanvasText(ctx, scene.title, mainX + 30, mainY + 95, mainW - 60, 34, 2);

  // Slide Subtitle
  ctx.fillStyle = '#94a3b8';
  ctx.font = 'italic 16px "Kantumruy Pro", sans-serif';
  ctx.fillText(scene.subtitle, mainX + 30, mainY + 160);

  // Divider
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(mainX + 30, mainY + 180);
  ctx.lineTo(mainX + mainW - 30, mainY + 180);
  ctx.stroke();

  // Bullet Points
  let bulletY = mainY + 225;
  scene.bullets.forEach((bulletText, bIdx) => {
    // Bullet box
    ctx.fillStyle = 'rgba(30, 41, 59, 0.8)';
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.2)';
    ctx.lineWidth = 1;
    roundRect(ctx, mainX + 30, bulletY - 26, mainW - 60, 54, 8, true, true);

    // Bullet text
    ctx.fillStyle = '#f8fafc';
    ctx.font = '16px "Kantumruy Pro", sans-serif';
    wrapCanvasText(ctx, bulletText, mainX + 45, bulletY + 6, mainW - 90, 24, 2);

    bulletY += 66;
  });
  ctx.restore();

  // 7. Bottom Kinetic Subtitle Banner (Font: Kantumruy Pro)
  const subBarY = 580;
  const subBarH = 75;
  ctx.save();
  ctx.fillStyle = 'rgba(2, 6, 23, 0.95)';
  ctx.strokeStyle = scene.colorTheme;
  ctx.lineWidth = 2;
  roundRect(ctx, 40, subBarY, w - 80, subBarH, 12, true, true);

  ctx.fillStyle = '#facc15';
  ctx.font = 'bold 15px "Kantumruy Pro", sans-serif';
  ctx.fillText('💬 អក្សររត់ Font Kantumruy Pro (Kinetic Subtitles):', 60, subBarY + 26);

  ctx.fillStyle = '#ffffff';
  ctx.font = '16px "Kantumruy Pro", sans-serif';
  wrapCanvasText(ctx, scene.narration, 60, subBarY + 54, w - 120, 24, 1);
  ctx.restore();

  // 8. Progress timeline at the very bottom
  const totalScenes = videoStudioState.scenes.length;
  const progressRatio = (videoStudioState.currentScene + 1) / totalScenes;
  ctx.fillStyle = 'rgba(51, 65, 85, 0.8)';
  ctx.fillRect(40, 668, w - 80, 8);
  ctx.fillStyle = scene.colorTheme;
  ctx.fillRect(40, 668, (w - 80) * progressRatio, 8);
}

function startStudioCanvasLoop() {
  if (videoStudioState.animFrameId) cancelAnimationFrame(videoStudioState.animFrameId);
  function loop() {
    if (!videoStudioState.isOpen) return;
    videoStudioState.animTick++;
    drawCurrentStudioFrame();
    videoStudioState.animFrameId = requestAnimationFrame(loop);
  }
  videoStudioState.animFrameId = requestAnimationFrame(loop);
}

function roundRect(ctx, x, y, width, height, radius, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 3) {
  if (!text) return;
  const words = text.split(' ');
  let line = '';
  let lineCount = 0;

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = ctx.measureText(testLine);
    const testWidth = metrics.width;
    if (testWidth > maxWidth && n > 0) {
      ctx.fillText(line, x, y);
      line = words[n] + ' ';
      y += lineHeight;
      lineCount++;
      if (lineCount >= maxLines - 1) {
        const remaining = words.slice(n).join(' ');
        let fit = '';
        for (let c = 0; c < remaining.length; c++) {
          if (ctx.measureText(fit + remaining[c] + '...').width < maxWidth) {
            fit += remaining[c];
          } else break;
        }
        ctx.fillText(fit + '...', x, y);
        return;
      }
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, x, y);
}

function toggleVideoPlayback(forcePlay = null) {
  const shouldPlay = forcePlay !== null ? forcePlay : !videoStudioState.isPlaying;
  videoStudioState.isPlaying = shouldPlay;

  const btnPlay = document.getElementById('btnStudioPlay');
  const iconPlay = document.getElementById('iconStudioPlay');
  const labelPlay = document.getElementById('labelStudioPlay');

  if (videoStudioState.isPlaying) {
    if (iconPlay) iconPlay.className = 'fa-solid fa-pause';
    if (labelPlay) labelPlay.textContent = 'ផ្អាកវីដេអូ';
    if (btnPlay) btnPlay.style.background = '#f59e0b';
    playCurrentSceneAudio();
  } else {
    if (iconPlay) iconPlay.className = 'fa-solid fa-play';
    if (labelPlay) labelPlay.textContent = 'ចាក់វីដេអូ';
    if (btnPlay) btnPlay.style.background = '#0284c7';
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    if (videoStudioState.playbackTimer) {
      clearTimeout(videoStudioState.playbackTimer);
      videoStudioState.playbackTimer = null;
    }
  }
}

function restartVideoPlayback() {
  selectStudioScene(0);
  toggleVideoPlayback(true);
}

function playCurrentSceneAudio() {
  const scene = videoStudioState.scenes[videoStudioState.currentScene];
  if (!scene) return;

  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(scene.narration);
    utter.lang = 'km-KH';
    utter.rate = 0.92;

    const voices = window.speechSynthesis.getVoices();
    const kmVoice = voices.find(v => (v.lang && (v.lang.includes('km') || v.lang.includes('KM'))) || (v.name && v.name.toLowerCase().includes('khmer')));
    if (kmVoice) utter.voice = kmVoice;

    utter.onend = () => {
      if (videoStudioState.isPlaying) {
        if (videoStudioState.currentScene < videoStudioState.scenes.length - 1) {
          videoStudioState.playbackTimer = setTimeout(() => {
            selectStudioScene(videoStudioState.currentScene + 1);
            playCurrentSceneAudio();
          }, 1200);
        } else {
          toggleVideoPlayback(false);
          showToast('🎉 បានចាក់វីដេអូ Micro-Lecture ទាំង ៤ ឈុតចប់សព្វគ្រប់!', 'success');
        }
      }
    };

    utter.onerror = () => {
      if (videoStudioState.isPlaying) {
        videoStudioState.playbackTimer = setTimeout(() => {
          if (videoStudioState.currentScene < videoStudioState.scenes.length - 1) {
            selectStudioScene(videoStudioState.currentScene + 1);
            playCurrentSceneAudio();
          } else {
            toggleVideoPlayback(false);
          }
        }, 8000);
      }
    };

    window.speechSynthesis.speak(utter);
  } else {
    videoStudioState.playbackTimer = setTimeout(() => {
      if (videoStudioState.isPlaying && videoStudioState.currentScene < videoStudioState.scenes.length - 1) {
        selectStudioScene(videoStudioState.currentScene + 1);
        playCurrentSceneAudio();
      } else {
        toggleVideoPlayback(false);
      }
    }, 8000);
  }
}

async function downloadVideoAsWebM() {
  const canvas = document.getElementById('studioVideoCanvas');
  if (!canvas) return;

  if (typeof MediaRecorder === 'undefined') {
    showToast('Browser របស់អ្នកមិនគាំទ្រ MediaRecorder API ទេ!', 'error');
    return;
  }

  const btnDownload = document.getElementById('btnStudioDownload');
  const labelDownload = document.getElementById('labelStudioDownload');
  const progressWrap = document.getElementById('videoProgressWrap');
  const progressBar = document.getElementById('videoProgressBar');
  const progressPercent = document.getElementById('videoProgressPercent');

  if (progressWrap) progressWrap.style.display = 'block';
  if (labelDownload) labelDownload.textContent = '⏳ កំពុង Render វីដេអូ...';
  if (btnDownload) btnDownload.disabled = true;

  try {
    const stream = canvas.captureStream(30);
    const recordedChunks = [];
    const mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const safeTitle = (videoStudioState.planData?.lessonTitle || 'Micro_Lecture').replace(/[/\\?%*:|"<>]/g, '_').substring(0, 30);
      link.download = `Video_Micro_Lecture_${safeTitle}.webm`;
      link.href = url;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      if (progressWrap) progressWrap.style.display = 'none';
      if (labelDownload) labelDownload.textContent = '📥 ទាញយក File វីដេអូ (.webm)';
      if (btnDownload) btnDownload.disabled = false;
      showToast('🎬 បានទាញយកឯកសារវីដេអូ Micro-Lecture (.webm) ជោគជ័យ!', 'success');
    };

    mediaRecorder.start();

    const totalScenes = videoStudioState.scenes.length;
    const sceneTime = 4000;
    const startTime = Date.now();
    const totalDuration = totalScenes * sceneTime;

    for (let i = 0; i < totalScenes; i++) {
      selectStudioScene(i);
      const sceneStart = Date.now();
      while (Date.now() - sceneStart < sceneTime) {
        const elapsed = Date.now() - startTime;
        const pct = Math.min(99, Math.round((elapsed / totalDuration) * 100));
        if (progressBar) progressBar.style.width = `${pct}%`;
        if (progressPercent) progressPercent.textContent = `${pct}%`;
        await new Promise(r => setTimeout(r, 100));
      }
    }

    if (progressBar) progressBar.style.width = '100%';
    if (progressPercent) progressPercent.textContent = '100%';
    mediaRecorder.stop();

  } catch (err) {
    if (progressWrap) progressWrap.style.display = 'none';
    if (labelDownload) labelDownload.textContent = '📥 ទាញយក File វីដេអូ (.webm)';
    if (btnDownload) btnDownload.disabled = false;
    showToast('កំហុសក្នុងការបង្កើតវីដេអូ: ' + err.message, 'error');
  }
}


// ==========================================================================
// CSV & Google Sheets 5-Columns Test Exporter
// ==========================================================================
function exportTestToCSV(testType) {
  const data = state.generatedPlanData;
  if (!data) {
    showToast('សូមបង្កើតកិច្ចតែងការជាមុនសិន!', 'warning');
    return;
  }

  const isPost = testType === 'post';
  const testList = isPost ? (data.postTestMCQ || generatePostTestMCQOffline(data.subject, data.grade, data.lessonTitle, [])) : (data.preTestQCM || []);
  const testTitle = isPost ? 'Post-Test_MCQ' : 'Pre-Test_QCM';
  const lessonName = (data.lessonTitle || 'Lesson').replace(/[/\\?%*:|"<>]/g, '_');

  if (!testList || testList.length === 0) {
    showToast('មិនមានវិញ្ញាសាសម្រាប់ទាញយកទេ!', 'warning');
    return;
  }

  // 5 Columns: Question, Correct Answer, Distractor 1, Distractor 2, Distractor 3
  let csvContent = '\uFEFF'; // UTF-8 BOM for Khmer Excel support
  csvContent += 'Question,Correct Answer,Distractor 1,Distractor 2,Distractor 3\n';

  testList.forEach(q => {
    const qText = `"${(q.question || '').replace(/"/g, '""')}"`;
    const opts = q.options || {};
    const correctLetter = q.correctAnswer || 'A';
    
    // Correct Answer
    let correctText = opts[correctLetter] || opts.A || opts['ក'] || '';
    
    // Distractors
    let distractors = [];
    ['A', 'B', 'C', 'D'].forEach(letter => {
      if (letter !== correctLetter && opts[letter]) {
        distractors.push(opts[letter]);
      }
    });

    // Fallbacks if options were Khmer keys
    if (distractors.length < 3) {
      ['ក', 'ខ', 'គ', 'ឃ'].forEach(kLetter => {
        if (opts[kLetter] && opts[kLetter] !== correctText && !distractors.includes(opts[kLetter])) {
          distractors.push(opts[kLetter]);
        }
      });
    }

    while (distractors.length < 3) {
      distractors.push(`ជម្រើសមិនត្រឹមត្រូវ ${distractors.length + 1}`);
    }

    const cText = `"${(correctText || '').replace(/"/g, '""')}"`;
    const d1Text = `"${(distractors[0] || '').replace(/"/g, '""')}"`;
    const d2Text = `"${(distractors[1] || '').replace(/"/g, '""')}"`;
    const d3Text = `"${(distractors[2] || '').replace(/"/g, '""')}"`;

    csvContent += `${qText},${cText},${d1Text},${d2Text},${d3Text}\n`;
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${testTitle}_${lessonName}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  showToast(`📥 បានទាញយក ${testTitle} ជា CSV (Google Sheets 5-Columns) ដោយជោគជ័យ!`, 'success');
}

// ==========================================================================
// Hake's Normalized Learning Gain Calculator
// ==========================================================================
function openLearningGainModal() {
  const modal = document.getElementById('learningGainModal');
  if (modal) modal.style.display = 'flex';
  calculateLearningGain();
}

function closeLearningGainModal() {
  const modal = document.getElementById('learningGainModal');
  if (modal) modal.style.display = 'none';
}

function calculateLearningGain() {
  const preInput = document.getElementById('inputPreTestScore');
  const postInput = document.getElementById('inputPostTestScore');
  const scoreText = document.getElementById('gainScoreText');
  const badgeContainer = document.getElementById('gainBadgeContainer');
  const adviceText = document.getElementById('gainAdviceText');

  if (!preInput || !postInput) return;

  const pre = parseFloat(preInput.value) || 0;
  const post = parseFloat(postInput.value) || 0;

  let g = 0;
  if (100 - pre > 0) {
    g = (post - pre) / (100 - pre);
  } else {
    g = post >= 100 ? 1 : 0;
  }

  g = Math.max(-1, Math.min(1, g));
  const gPercent = (g * 100).toFixed(1);
  if (scoreText) scoreText.textContent = `${g.toFixed(2)} (${gPercent}%)`;

  const isEn = (state.language === 'en');

  if (g >= 0.70) {
    if (badgeContainer) {
      badgeContainer.innerHTML = isEn
        ? '<span class="gain-badge-high"><i class="fa-solid fa-circle-check"></i> High Gain (Exceptional: g ≥ 0.70)</span>'
        : '<span class="gain-badge-high"><i class="fa-solid fa-circle-check"></i> High Gain (ប្រសិទ្ធភាពបង្រៀនខ្ពស់ខ្លាំង: g ≥ 0.70)</span>';
    }
    if (adviceText) {
      adviceText.textContent = isEn
        ? '🌟 Group collaborative tasks and 70% active learning missions showed exceptional effectiveness in deep student comprehension.'
        : '🌟 សកម្មភាពអនុវត្តជាក្រុម និងបេសកកម្ម ៧០% ក្នុងថ្នាក់រៀន មានប្រសិទ្ធភាពខ្ពស់ខ្លាំងក្នុងការជួយឱ្យសិស្សយល់ដឹងស៊ីជម្រៅ។';
    }
  } else if (g >= 0.30) {
    if (badgeContainer) {
      badgeContainer.innerHTML = isEn
        ? '<span class="gain-badge-med"><i class="fa-solid fa-triangle-exclamation"></i> Medium Gain (Moderate: 0.30 ≤ g < 0.70)</span>'
        : '<span class="gain-badge-med"><i class="fa-solid fa-triangle-exclamation"></i> Medium Gain (ប្រសិទ្ធភាពបង្រៀនកម្រិតមធ្យម: 0.30 ≤ g < 0.70)</span>';
    }
    if (adviceText) {
      adviceText.textContent = isEn
        ? '👍 Students demonstrated solid moderate progress. Teacher can incorporate more higher-order practice and guided inquiry.'
        : '👍 សិស្សមានការរីកចម្រើនល្អជាមធ្យម។ គ្រូអាចបង្កើនលំហាត់អនុវត្តកម្រិតខ្ពស់ និងការពិភាក្សាដេញដោលបន្ថែម។';
    }
  } else {
    if (badgeContainer) {
      badgeContainer.innerHTML = isEn
        ? '<span class="gain-badge-low"><i class="fa-solid fa-circle-xmark"></i> Low Gain (Low: g < 0.30)</span>'
        : '<span class="gain-badge-low"><i class="fa-solid fa-circle-xmark"></i> Low Gain (ប្រសិទ្ធភាពទាប: g < 0.30)</span>';
    }
    if (adviceText) {
      adviceText.textContent = isEn
        ? '⚠️ Gain is low. Teacher should review pre-class materials and provide more instructional scaffolding during in-class practice.'
        : '⚠️ អត្រាកំណើននៅទាប។ គ្រូគួរពិនិត្យឡើងវិញនូវគុណភាពស្វ័យសិក្សាពីផ្ទះ និងបង្កើនការណែនាំ (Scaffolding) ក្នុងម៉ោងរៀន។';
    }
  }
}

function applyLearningGainToReflection() {
  const preInput = document.getElementById('inputPreTestScore');
  const postInput = document.getElementById('inputPostTestScore');
  const pre = parseFloat(preInput?.value) || 0;
  const post = parseFloat(postInput?.value) || 0;
  let gNum = (100 - pre > 0) ? ((post - pre) / (100 - pre)) : (post >= 100 ? 1 : 0);
  gNum = Math.max(-1, Math.min(1, gNum));
  const gStr = gNum.toFixed(2);
  const gPercent = (gNum * 100).toFixed(1);
  const isEn = (state.language === 'en');

  let gLabel = '';
  let advice = '';
  if (gNum >= 0.70) {
    gLabel = isEn ? 'High Gain (g ≥ 0.70)' : 'High Gain (ប្រសិទ្ធភាពខ្ពស់ខ្លាំង: g ≥ 0.70)';
    advice = isEn 
      ? 'Group collaborative tasks and 70% active learning showed outstanding effectiveness in deep student comprehension.'
      : 'សកម្មភាពអនុវត្តជាក្រុម និងបេសកកម្ម ៧០% ក្នុងថ្នាក់រៀន មានប្រសិទ្ធភាពខ្ពស់ខ្លាំងក្នុងការជួយឱ្យសិស្សយល់ដឹងស៊ីជម្រៅ។';
  } else if (gNum >= 0.30) {
    gLabel = isEn ? 'Medium Gain (0.30 ≤ g < 0.70)' : 'Medium Gain (ប្រសិទ្ធភាពមធ្យម: 0.30 ≤ g < 0.70)';
    advice = isEn
      ? 'Students demonstrated solid moderate improvement. Teacher can incorporate more higher-order practice and guided inquiry.'
      : 'សិស្សមានការរីកចម្រើនល្អជាមធ្យម។ គ្រូអាចបង្កើនលំហាត់អនុវត្តកម្រិតខ្ពស់ និងការពិភាក្សាដេញដោលបន្ថែម។';
  } else {
    gLabel = isEn ? 'Low Gain (g < 0.30)' : 'Low Gain (ប្រសិទ្ធភាពទាប: g < 0.30)';
    advice = isEn
      ? 'Gain is currently low. Teacher should review pre-class materials and provide more scaffolding during in-class practice.'
      : 'អត្រាកំណើននៅទាប។ គ្រូគួរពិនិត្យឡើងវិញនូវគុណភាពស្វ័យសិក្សាពីផ្ទះ និងបង្កើនការណែនាំ (Scaffolding) ក្នុងម៉ោងរៀន។';
  }

  const reflectionText = isEn
    ? `The instructional process achieved strong pedagogical results:\n• Pre-Test Average: ${pre}%\n• Post-Test Average: ${post}%\n• Hake's Normalized Learning Gain: g = ${gStr} (${gPercent}%) — [${gLabel}]\n• Pedagogical Reflection: ${advice}`
    : `ដំណើរការបង្រៀនសម្រេចបានលទ្ធផលជាក់ស្តែង៖\n• ពិន្ទុមធ្យមបុរេតេស្ត (Pre-Test): ${pre}%\n• ពិន្ទុមធ្យមបច្ឆិមតេស្ត (Post-Test): ${post}%\n• អត្រាកំណើននៃការរៀនសូត្រ (Hake's Gain): g = ${gStr} (${gPercent}%) — [${gLabel}]\n• ការឆ្លុះបញ្ចាំងគរុកោសល្យ៖ ${advice}`;

  state.savedLearningGain = reflectionText;

  if (state.generatedPlanData) {
    state.generatedPlanData.selfEvaluation = reflectionText;
    renderLessonPlanToA4(state.generatedPlanData);
    closeLearningGainModal();
    showToast(isEn ? '✅ Learning Gain evaluation added into your lesson plan!' : '✅ បានបញ្ចូលទិន្នន័យ Learning Gain ទៅក្នុងកិច្ចតែងការដោយជោគជ័យ!', 'success');
  } else {
    closeLearningGainModal();
    showToast(isEn ? '✅ Learning Gain saved! It will be automatically attached when you generate a lesson plan.' : '✅ បានរក្សាទុកទិន្នន័យ Learning Gain! វានឹងត្រូវភ្ជាប់ក្នុងកិច្ចតែងការដោយស្វ័យប្រវត្តិពេលបង្កើត។', 'info');
  }
}

// ==========================================================================
// Software License & Commercial Activation System
// ==========================================================================
const LICENSE_STORAGE_KEY = 'alps_client_license';

async function checkLicenseStatus() {
  const badge = document.getElementById('headerLicenseBadge');
  const label = document.getElementById('headerLicenseLabel');

  try {
    const res = await fetch('/api/license/info');
    if (res.ok) {
      const data = await res.json();
      state.machineId = data.machineId;
      state.isLicenseActivated = data.isActivated;
      state.licenseDetails = data.details || {};
      state.trial = data.trial || { isTrial: true, isTrialActive: true, isExpired: false, daysLeft: 10, hoursLeft: 0 };

      if (data.isActivated) {
        if (badge) {
          badge.className = 'status-dot online';
          badge.title = 'អាជ្ញាបណ្ណស្របច្បាប់ (Activated)';
        }
        if (label) label.textContent = 'អាជ្ញាបណ្ណ ✓';
      } else if (state.trial.isTrialActive) {
        if (badge) {
          badge.className = 'status-dot';
          badge.style.background = '#0284c7';
          badge.title = `សាកល្បងឥតគិតថ្លៃ៖ នៅសល់ ${state.trial.daysLeft} ថ្ងៃ ${state.trial.hoursLeft} ម៉ោង`;
        }
        if (label) label.textContent = `សាកល្បង (${state.trial.daysLeft} ថ្ងៃ)`;
      } else {
        if (badge) {
          badge.className = 'status-dot';
          badge.style.background = '#dc2626';
          badge.title = 'សុពលភាពសាកល្បងបានផុតកំណត់ (Trial Expired)';
        }
        if (label) label.textContent = '⚠️ ផុតកំណត់សាកល្បង';
      }
      return;
    }
  } catch (e) {
    // Offline browser fallback
  }

  // Fallback if running purely offline in browser
  const saved = localStorage.getItem(LICENSE_STORAGE_KEY);
  if (!state.machineId) {
    state.machineId = 'WEB-' + (localStorage.getItem('alps_web_id') || Math.random().toString(36).substring(2, 10).toUpperCase());
    localStorage.setItem('alps_web_id', state.machineId);
  }

  // Browser Trial Calculation (10 days)
  let firstRun = localStorage.getItem('alps_first_run');
  if (!firstRun) {
    firstRun = Date.now();
    localStorage.setItem('alps_first_run', firstRun);
  } else {
    firstRun = parseInt(firstRun, 10);
  }

  const elapsedSec = (Date.now() - firstRun) / 1000;
  const totalTrialSec = 10 * 24 * 3600;
  const remainingSec = Math.max(0, totalTrialSec - elapsedSec);
  const daysLeft = Math.floor(remainingSec / 86400);
  const hoursLeft = Math.floor((remainingSec % 86400) / 3600);
  const isExpired = remainingSec <= 0;

  state.trial = {
    isTrial: true,
    isTrialActive: !isExpired,
    isExpired: isExpired,
    daysLeft: daysLeft,
    hoursLeft: hoursLeft,
    totalDays: 10
  };

  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      state.isLicenseActivated = true;
      state.licenseDetails = parsed;
      if (badge) { badge.className = 'status-dot online'; }
      if (label) label.textContent = 'អាជ្ញាបណ្ណ ✓';
    } catch (err) {
      state.isLicenseActivated = false;
    }
  } else if (state.trial.isTrialActive) {
    state.isLicenseActivated = false;
    if (badge) { badge.className = 'status-dot'; badge.style.background = '#0284c7'; }
    if (label) label.textContent = `សាកល្បង (${daysLeft} ថ្ងៃ)`;
  } else {
    state.isLicenseActivated = false;
    if (badge) { badge.className = 'status-dot'; badge.style.background = '#dc2626'; }
    if (label) label.textContent = '⚠️ ផុតកំណត់សាកល្បង';
  }
}

// ==========================================
// 🔄 CLOUD AUTO-UPDATER SYSTEM
// ==========================================
const CURRENT_APP_VERSION = '2.6.0';

function openUpdateModal() {
  const modal = document.getElementById('updateModal');
  if (modal) modal.style.display = 'flex';
  checkAppUpdates(false);
}

function closeUpdateModal() {
  const modal = document.getElementById('updateModal');
  if (modal) modal.style.display = 'none';
}

async function checkAppUpdates(isManual = false) {
  const lblVersion = document.getElementById('lblCurrentAppVersion');
  const statusBox = document.getElementById('updateStatusBox');
  const statusTitle = document.getElementById('updateStatusTitle');
  const statusDesc = document.getElementById('updateStatusDesc');
  const btnApply = document.getElementById('btnApplyUpdate');
  const updateDot = document.getElementById('updateAvailableDot');
  const headerLabel = document.getElementById('headerVersionLabel');

  if (lblVersion) lblVersion.textContent = `v${CURRENT_APP_VERSION}`;
  if (headerLabel) headerLabel.textContent = `v${CURRENT_APP_VERSION}`;

  if (isManual) {
    if (statusTitle) statusTitle.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> កំពុងពិនិត្យមើលកំណែថ្មីពី Server...';
    if (statusDesc) statusDesc.textContent = 'សូមរង់ចាំបន្តិច...';
  }

  try {
    let data = null;
    try {
      const res = await fetch('/api/system/check_update');
      if (res.ok) data = await res.json();
    } catch (_) {}

    // Fallback: Check GitHub directly (for Vercel / Static hosting)
    if (!data || !data.latestVersion) {
      const ghRes = await fetch('https://raw.githubusercontent.com/boreykem/lessonplan/main/version_manifest.json?t=' + Date.now());
      if (ghRes.ok) {
        const ghData = await ghRes.json();
        const parseV = (v) => (String(v).match(/\d+/g) || []).map(Number);
        const curV = parseV(CURRENT_APP_VERSION);
        const remV = parseV(ghData.version || '');
        let hasUp = false;
        for (let i = 0; i < Math.max(curV.length, remV.length); i++) {
          const c = curV[i] || 0;
          const r = remV[i] || 0;
          if (r > c) { hasUp = true; break; }
          if (r < c) { break; }
        }
        data = {
          hasUpdate: hasUp,
          currentVersion: CURRENT_APP_VERSION,
          latestVersion: ghData.version || CURRENT_APP_VERSION,
          releaseDate: ghData.releaseDate || '',
          releaseNotes: ghData.releaseNotes || ['កែលម្អប្រព័ន្ធ និងបន្ថែមមុខងារថ្មីៗ'],
          updateUrl: ghData.updateUrl || 'https://github.com/boreykem/lessonplan'
        };
      }
    }

    if (!data) throw new Error('Cannot reach update server');

    if (data.hasUpdate) {
      if (updateDot) updateDot.style.display = 'inline-block';
      if (statusBox) {
        statusBox.style.background = '#ecfdf5';
        statusBox.style.borderColor = '#10b981';
        statusBox.style.color = '#065f46';
      }
      if (statusTitle) {
        statusTitle.innerHTML = `<i class="fa-solid fa-sparkles text-success"></i> 🎉 រកឃើញកំណែថ្មី៖ v${escapeHtml(data.latestVersion)}!`;
      }
      if (statusDesc) {
        const notes = Array.isArray(data.releaseNotes) ? data.releaseNotes.join('<br>• ') : data.releaseNotes;
        statusDesc.innerHTML = `<strong>មុខងារថ្មីៗ និងការកែលម្អ៖</strong><br>• ${notes}`;
      }
      if (btnApply) {
        btnApply.style.display = 'inline-flex';
        btnApply.dataset.updateUrl = data.updateUrl || '';
      }
      if (isManual) showToast(`🎉 រកឃើញកំណែថ្មី v${data.latestVersion}!`, 'success');
    } else {
      if (updateDot) updateDot.style.display = 'none';
      if (statusBox) {
        statusBox.style.background = '#f0fdf4';
        statusBox.style.borderColor = '#86efac';
        statusBox.style.color = '#166534';
      }
      if (statusTitle) {
        statusTitle.innerHTML = '<i class="fa-solid fa-circle-check"></i> កម្មវិធីរបស់អ្នកជាកំណែថ្មីបំផុតហើយ!';
      }
      if (statusDesc) {
        statusDesc.textContent = `អ្នកកំពុងប្រើប្រាស់ v${CURRENT_APP_VERSION}។ មិនមានកំណែអាប់ដេតថ្មីនៅឡើយទេ។`;
      }
      if (btnApply) btnApply.style.display = 'none';
      if (isManual) showToast('✅ កម្មវិធីរបស់អ្នកជាកំណែថ្មីបំផុតហើយ!', 'info');
    }
  } catch (err) {
    if (statusTitle) statusTitle.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color: #f59e0b;"></i> មិនអាចភ្ជាប់ទៅកាន់ Server អាប់ដេតបានទេ';
    if (statusDesc) statusDesc.textContent = 'សូមពិនិត្យមើលការភ្ជាប់អ៊ីនធឺណិតរបស់អ្នក ឬសាកល្បងម្ដងទៀតនៅពេលក្រោយ។';
    if (btnApply) btnApply.style.display = 'none';
  }
}

async function applyAppUpdate() {
  const progressWrap = document.getElementById('updateProgressBarWrap');
  const progressBar = document.getElementById('updateProgressBar');
  const progressLabel = document.getElementById('updateProgressLabel');
  const progressPercent = document.getElementById('updateProgressPercent');
  const btnApply = document.getElementById('btnApplyUpdate');

  if (progressWrap) progressWrap.style.display = 'block';
  if (btnApply) btnApply.disabled = true;

  // Animate Progress
  let progress = 10;
  const timer = setInterval(() => {
    if (progress < 90) {
      progress += Math.floor(Math.random() * 15) + 5;
      if (progress > 90) progress = 90;
      if (progressBar) progressBar.style.width = `${progress}%`;
      if (progressPercent) progressPercent.textContent = `${progress}%`;
    }
  }, 200);

  try {
    if (progressLabel) progressLabel.textContent = 'កំពុងទាញយក និងដំឡើងឯកសារថ្មី...';
    
    const res = await fetch('/api/system/apply_update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: {} })
    });
    await res.json();

    clearInterval(timer);
    if (progressBar) progressBar.style.width = '100%';
    if (progressPercent) progressPercent.textContent = '100%';
    if (progressLabel) progressLabel.textContent = '✅ អាប់ដេតជោគជ័យ! កំពុងដំណើរការឡើងវិញ...';

    showToast('🎉 អាប់ដេតជោគជ័យ! កំពុង Restart កម្មវិធី...', 'success');
    setTimeout(() => {
      window.location.reload();
    }, 1500);
  } catch (err) {
    clearInterval(timer);
    showToast('បរាជ័យក្នុងការអាប់ដេត: ' + err.message, 'error');
    if (progressLabel) progressLabel.textContent = '⚠️ មានបញ្ហាក្នុងការអាប់ដេត';
    if (btnApply) btnApply.disabled = false;
  }
}

async function openLicenseModal() {
  const modal = document.getElementById('licenseModal');
  const machineInput = document.getElementById('displayMachineId');
  const statusBox = document.getElementById('licenseStatusBox');
  const statusTitle = document.getElementById('licenseStatusTitle');
  const statusDesc = document.getElementById('licenseStatusDesc');
  const typeBadge = document.getElementById('licenseTypeBadge');
  const keyInput = document.getElementById('inputLicenseKey');
  const isEn = (state.language === 'en');

  await checkLicenseStatus();

  if (machineInput) {
    machineInput.value = state.machineId || (isEn ? 'Fetching...' : 'កំពុងទាញយក...');
  }

  if (modal) modal.style.display = 'flex';

  if (state.isLicenseActivated) {
    if (statusBox) {
      statusBox.className = 'license-status-card activated';
    }
    if (statusTitle) {
      statusTitle.innerHTML = isEn
        ? '<span style="color: #15803d;"><i class="fa-solid fa-circle-check"></i> Activated License</span>'
        : '<span style="color: #15803d;"><i class="fa-solid fa-circle-check"></i> អាជ្ញាបណ្ណស្របច្បាប់ (Activated)</span>';
    }
    if (typeBadge) {
      typeBadge.textContent = state.licenseDetails?.type || 'LIFETIME';
    }
    if (statusDesc) {
      statusDesc.innerHTML = isEn
        ? `Licensee: <strong>${escapeHtml(state.licenseDetails?.licensee || 'Valued Customer')}</strong> | Key: <code>${escapeHtml(state.licenseDetails?.licenseKey || 'ALPS-****')}</code>`
        : `ម្ចាស់អាជ្ញាបណ្ណ៖ <strong>${escapeHtml(state.licenseDetails?.licensee || 'Valued Customer')}</strong> | Key: <code>${escapeHtml(state.licenseDetails?.licenseKey || 'ALPS-****')}</code>`;
    }
    if (keyInput && state.licenseDetails?.licenseKey) {
      keyInput.value = state.licenseDetails.licenseKey;
    }
  } else if (state.trial && state.trial.isTrialActive) {
    if (statusBox) {
      statusBox.className = 'license-status-card trial';
    }
    if (statusTitle) {
      statusTitle.innerHTML = isEn
        ? `<span style="color: #0284c7;"><i class="fa-solid fa-hourglass-half"></i> Free Trial Active</span>`
        : `<span style="color: #0284c7;"><i class="fa-solid fa-hourglass-half"></i> កំពុងស្ថិតក្នុងការសាកល្បងឥតគិតថ្លៃ (Free Trial)</span>`;
    }
    if (typeBadge) {
      typeBadge.textContent = isEn ? `${state.trial.daysLeft} Days Left` : `សល់ ${state.trial.daysLeft} ថ្ងៃ`;
    }
    if (statusDesc) {
      statusDesc.innerHTML = isEn
        ? `You can use all features freely during the <strong>10-day</strong> trial (${state.trial.daysLeft} days ${state.trial.hoursLeft} hours remaining). Contact us to activate permanently.`
        : `លោកអ្នកអាចប្រើប្រាស់មុខងារទាំងអស់ដោយសេរីក្នុងរយៈពេល <strong>១០ ថ្ងៃ</strong> (នៅសល់៖ <strong>${state.trial.daysLeft} ថ្ងៃ ${state.trial.hoursLeft} ម៉ោង</strong>)។ ដើម្បីប្រើប្រាស់អចិន្ត្រៃយ៍ សូមទាក់ទងទិញ License Key។`;
    }
  } else {
    if (statusBox) {
      statusBox.className = 'license-status-card';
      statusBox.style.borderColor = '#f87171';
      statusBox.style.background = '#fef2f2';
    }
    if (statusTitle) {
      statusTitle.innerHTML = isEn
        ? '<span style="color: #dc2626;"><i class="fa-solid fa-lock"></i> 10-Day Free Trial Expired</span>'
        : '<span style="color: #dc2626;"><i class="fa-solid fa-lock"></i> សុពលភាពសាកល្បង ១០ ថ្ងៃបានផុតកំណត់ហើយ!</span>';
    }
    if (typeBadge) {
      typeBadge.textContent = 'EXPIRED';
    }
    if (statusDesc) {
      statusDesc.innerHTML = isEn
        ? 'Your free trial has ended. Please copy your Machine ID below and contact support to purchase a license key.'
        : 'រយៈពេលសាកល្បងឥតគិតថ្លៃបានបញ្ចប់។ សូមចម្លង Machine ID ខាងក្រោមផ្ញើទៅកាន់អ្នកផ្គត់ផ្គង់ ដើម្បីទិញ License Key ធ្វើឱ្យកម្មវិធីដំណើរការឡើងវិញ។';
    }
  }
}

function closeLicenseModal() {
  const modal = document.getElementById('licenseModal');
  if (modal) modal.style.display = 'none';
}

async function copyMachineId() {
  const machineInput = document.getElementById('displayMachineId');
  const id = machineInput ? machineInput.value : state.machineId;

  if (!id) {
    showToast('មិនអាចចម្លង Machine ID បានទេ!', 'warning');
    return;
  }

  try {
    await navigator.clipboard.writeText(id);
    showToast(`📋 បានចម្លង Machine ID: ${id} រួចរាល់! សូមផ្ញើទៅកាន់អ្នកលក់ដើម្បីទិញ Key`, 'success');
  } catch (err) {
    showToast('មិនអាចចម្លងបានទេ: ' + err.message, 'error');
  }
}

function sendMachineIdToTelegram() {
  const machineInput = document.getElementById('displayMachineId');
  const id = machineInput ? machineInput.value : (state.machineId || '7E73-FC2E-2FF5-30A9');
  const today = new Date().toLocaleDateString('km-KH');
  
  const text = `សួស្តីលោកគ្រូ កែម បូរី! ខ្ញុំសូមស្នើសុំទិញលេខកូដអាជ្ញាបណ្ណ (License Key) សម្រាប់កម្មវិធី AI Lesson Plan Studio:\n\n🔑 Machine ID: ${id}\n📅 កាលបរិច្ឆេទ: ${today}\n\nសូមលោកគ្រូជួយពិនិត្យ និងផ្ញើ License Key មកខ្ញុំវិញ។ សូមអរគុណ!`;
  
  // Copy Machine ID to clipboard
  navigator.clipboard.writeText(id).catch(() => {});
  
  // Direct Telegram Chat with @KEMBOREY
  let sellerUsername = localStorage.getItem('seller_telegram_username') || 'KEMBOREY';
  if (sellerUsername.toLowerCase().includes('kem_borey') || sellerUsername.toLowerCase() === 'kemborey') {
    sellerUsername = 'KEMBOREY';
    localStorage.setItem('seller_telegram_username', 'KEMBOREY');
  }
  sellerUsername = sellerUsername.trim().replace(/^@/, '').replace(/^https?:\/\/t\.me\//, '');
  
  const tgUrl = `https://t.me/${sellerUsername}?text=${encodeURIComponent(text)}`;
  window.open(tgUrl, '_blank');
  showToast(`✈️ កំពុងបើកផ្ញើទៅ Telegram លោកគ្រូ កែម បូរី (@${sellerUsername})... បានចម្លង Machine ID រួចរាល់!`, 'success');
}

async function submitLicenseActivation() {
  const keyInput = document.getElementById('inputLicenseKey');
  const key = keyInput ? keyInput.value.trim().toUpperCase() : '';

  if (!key) {
    showToast('សូមបញ្ចូលលេខកូដ License Key ជាមុនសិន!', 'warning');
    return;
  }

  try {
    const res = await fetch('/api/license/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey: key })
    });

    const result = await res.json();
    if (res.ok && result.success) {
      showToast(result.message || '🎉 Activate ជោគជ័យ!', 'success');
      localStorage.setItem(LICENSE_STORAGE_KEY, JSON.stringify(result.license || { licenseKey: key }));
      await checkLicenseStatus();
      closeLicenseModal();
    } else {
      showToast(result.message || '⚠️ License Key មិនត្រឹមត្រូវ!', 'error');
    }
  } catch (err) {
    // Offline fallback verification
    if (key.startsWith('ALPS-') && key.length >= 19) {
      const mockLicense = { licenseKey: key, licensee: 'Customer', type: 'LIFETIME', activatedAt: new Date().toISOString() };
      localStorage.setItem(LICENSE_STORAGE_KEY, JSON.stringify(mockLicense));
      showToast('🎉 បានរក្សាទុក License Key ក្នុង Browser រួចរាល់!', 'success');
      await checkLicenseStatus();
      closeLicenseModal();
    } else {
      showToast('⚠️ ទម្រង់ License Key មិនត្រឹមត្រូវ (ឧ. ALPS-XXXX-XXXX-XXXX-XXXX)', 'error');
    }
  }
}

// ==========================================
// 🌟 1-CLICK INSTANT DIGITAL QUIZ GENERATOR (ZERO-CODE)
// ==========================================
function buildInteractiveQuizHtmlPage(testType = 'pre') {
  const plan = state.currentPlan || {};
  const isPre = testType === 'pre';
  const lessonTitle = plan.lessonTitle || 'ចិត្តវិទ្យាអប់រំ';
  const subject = plan.subject || 'ចិត្តវិទ្យាអប់រំ';
  const grade = plan.grade || 'គរុនិស្សិត ឆ្នាំទី ១ ឆមាសទី ២';
  const teacher = plan.teacher || 'កែម បូរី';
  const quizTitle = isPre 
    ? `វិញ្ញាសាបុរេតេស្ត (Pre-Test Diagnostic): ${lessonTitle}`
    : `វិញ្ញាសាតេស្តបញ្ចប់ (Post-Test Assessment): ${lessonTitle}`;

  const rawQ = isPre 
    ? (plan.preTestQCM && plan.preTestQCM.length > 0 ? plan.preTestQCM : generatePreTestQCMOffline(subject, grade, lessonTitle, []))
    : (plan.postTestMCQ && plan.postTestMCQ.length > 0 ? plan.postTestMCQ : generatePostTestMCQOffline(subject, grade, lessonTitle, []));

  const qList = randomizeQuizList(JSON.parse(JSON.stringify(rawQ)));
  const questionsJson = JSON.stringify(qList);

  return `<!DOCTYPE html>
<html lang="km">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(quizTitle)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Kantumruy+Pro:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Kantumruy Pro', sans-serif; }
    body { background: #f1f5f9; color: #1e293b; padding: 16px 12px 60px; line-height: 1.6; }
    .quiz-container { max-width: 740px; margin: 0 auto; }
    .quiz-header-card { background: white; border-top: 8px solid #7c3aed; border-radius: 12px; padding: 22px 24px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); margin-bottom: 16px; }
    .motto-box { text-align: center; margin-bottom: 12px; }
    .motto-kh { font-size: 13pt; font-weight: 700; color: #1e293b; }
    .motto-sub { font-size: 10pt; color: #475569; }
    .quiz-main-title { font-size: 15pt; font-weight: 700; color: #5b21b6; margin-top: 8px; }
    .quiz-meta-badge { display: inline-block; background: #ede9fe; color: #6d28d9; padding: 4px 10px; border-radius: 6px; font-size: 9.5pt; font-weight: 600; margin-top: 8px; }
    .info-card { background: white; border-radius: 12px; padding: 18px 24px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); margin-bottom: 16px; border-left: 4px solid #0284c7; }
    .form-group { margin-bottom: 12px; }
    .form-group:last-child { margin-bottom: 0; }
    .form-group label { display: block; font-weight: 600; font-size: 10pt; margin-bottom: 4px; color: #334155; }
    .form-control { width: 100%; padding: 10px 14px; border: 1.5px solid #cbd5e1; border-radius: 8px; font-size: 10.5pt; outline: none; transition: 0.2s; }
    .form-control:focus { border-color: #7c3aed; box-shadow: 0 0 0 3px rgba(124,58,237,0.15); }
    .question-card { background: white; border-radius: 12px; padding: 20px 24px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); margin-bottom: 16px; transition: 0.2s; border: 1.5px solid transparent; }
    .question-card.active-q { border-color: #c4b5fd; }
    .q-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 12px; }
    .q-title { font-size: 11pt; font-weight: 700; color: #0f172a; line-height: 1.5; }
    .diff-badge { font-size: 8pt; padding: 3px 8px; border-radius: 4px; font-weight: 700; white-space: nowrap; }
    .diff-easy { background: #dcfce7; color: #15803d; }
    .diff-medium { background: #fef9c3; color: #854d0e; }
    .diff-hard { background: #fee2e2; color: #b91c1c; }
    .options-list { display: flex; flex-direction: column; gap: 8px; }
    .option-label { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border: 1.5px solid #e2e8f0; border-radius: 8px; cursor: pointer; transition: 0.15s; font-size: 10pt; }
    .option-label:hover { background: #f8fafc; border-color: #cbd5e1; }
    .option-label.selected { background: #f5f3ff; border-color: #7c3aed; font-weight: 600; color: #5b21b6; }
    .option-label.correct-ans { background: #dcfce7 !important; border-color: #16a34a !important; color: #15803d !important; font-weight: bold; }
    .option-label.wrong-ans { background: #fee2e2 !important; border-color: #dc2626 !important; color: #991b1b !important; }
    .option-radio { width: 18px; height: 18px; accent-color: #7c3aed; }
    .explanation-box { display: none; margin-top: 12px; padding: 10px 14px; background: #eff6ff; border-left: 3px solid #3b82f6; border-radius: 6px; font-size: 9.5pt; color: #1e40af; }
    .submit-bar { text-align: center; margin-top: 24px; }
    .btn-submit { background: #7c3aed; color: white; border: none; padding: 14px 36px; border-radius: 30px; font-size: 12pt; font-weight: 700; cursor: pointer; box-shadow: 0 4px 15px rgba(124,58,237,0.35); transition: 0.2s; }
    .btn-submit:hover { background: #6d28d9; transform: translateY(-2px); }
    .score-banner { display: none; background: white; border-radius: 12px; padding: 24px; text-align: center; box-shadow: 0 8px 25px rgba(0,0,0,0.1); margin-bottom: 20px; border-top: 6px solid #10b981; }
    .score-number { font-size: 32pt; font-weight: 800; color: #10b981; margin: 8px 0; }
    .score-desc { font-size: 11pt; color: #475569; }
    @media print {
      body { background: white; padding: 0; }
      .quiz-header-card, .info-card, .question-card { box-shadow: none; border: 1px solid #ccc; break-inside: avoid; }
      .btn-submit, .btn-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="quiz-container">
    <!-- Header -->
    <div class="quiz-header-card">
      <div class="motto-box">
        <div class="motto-kh">ព្រះរាជាណាចក្រកម្ពុជា</div>
        <div class="motto-sub">ជាតិ សាសនា ព្រះមហាក្សត្រ</div>
      </div>
      <div class="quiz-main-title">${escapeHtml(quizTitle)}</div>
      <div style="font-size: 10pt; color: #475569; margin-top: 4px;">
        <strong>មុខវិជ្ជា៖</strong> ${escapeHtml(subject)} | <strong>កម្រិត៖</strong> ${escapeHtml(grade)} | <strong>គ្រូឧទ្ទេស៖</strong> ${escapeHtml(teacher)}
      </div>
      <div class="quiz-meta-badge">
        <i class="fa-solid fa-clipboard-check"></i> វិញ្ញាសាឌីជីថល ១០ សំណួរពហុជ្រើសរើស (១ ពិន្ទុ/សំណួរ)
      </div>
    </div>

    <!-- Student Info -->
    <div class="info-card" id="studentInfoCard">
      <div class="form-group">
        <label><i class="fa-solid fa-user"></i> គោត្តនាម និងនាម (Student Full Name) <span style="color:red;">*</span></label>
        <input type="text" id="inputStudentName" class="form-control" placeholder="ឧ. កែម ចិន្តា">
      </div>
      <div class="form-group" style="margin-top: 10px;">
        <label><i class="fa-solid fa-users"></i> ក្រុម / ជំនាន់ / ថ្នាក់ (Class / Group) <span style="color:red;">*</span></label>
        <input type="text" id="inputStudentGroup" class="form-control" placeholder="ឧ. ក្រុមទី ១ / បរិញ្ញាបត្រអប់រំ ជំនាន់ ២">
      </div>
    </div>

    <!-- Score Banner (Shown after submit) -->
    <div class="score-banner" id="scoreBanner">
      <div style="font-size: 14pt; font-weight: 700; color: #1e293b;">🎉 លទ្ធផលប្រឡងរបស់អ្នក (Quiz Result)</div>
      <div class="score-number" id="scoreText">10 / 10</div>
      <div class="score-desc" id="scoreFeedback">អបអរសាទរ! អ្នកសម្រេចបានលទ្ធផលយ៉ាងល្អឥតខ្ចោះ។</div>
      <button type="button" onclick="window.print()" class="btn-print" style="margin-top: 12px; background: #0284c7; color: white; border: none; padding: 8px 20px; border-radius: 6px; cursor: pointer; font-weight: 600;">
        <i class="fa-solid fa-print"></i> បោះពុម្ព ឬរក្សាទុកជា PDF (Save Result)
      </button>
    </div>

    <!-- Questions Form -->
    <form id="quizForm" onsubmit="handleQuizSubmit(event)">
      <div id="questionsContainer"></div>

      <div class="submit-bar">
        <button type="submit" id="btnSubmitQuiz" class="btn-submit">
          <i class="fa-solid fa-check-to-slot"></i> ផ្ញើចម្លើយ និងពិនិត្យពិន្ទុ (Submit Quiz)
        </button>
      </div>
    </form>
  </div>

  <script>
    const questions = ${questionsJson};
    const userAnswers = {};

    function renderQuestions() {
      const container = document.getElementById('questionsContainer');
      let html = '';

      questions.forEach((q, idx) => {
        const qNum = q.number || (idx + 1);
        const opts = q.options || {};
        const optA = opts.A || opts['ក'] || '';
        const optB = opts.B || opts['ខ'] || '';
        const optC = opts.C || opts['គ'] || '';
        const optD = opts.D || opts['ឃ'] || '';
        const diffLevel = q.difficultyLevel || (qNum <= 2 ? 'easy' : qNum <= 8 ? 'medium' : 'hard');
        const diffClass = diffLevel === 'easy' ? 'diff-easy' : (diffLevel === 'medium' ? 'diff-medium' : 'diff-hard');
        const diffLabel = q.difficulty || (diffLevel === 'easy' ? 'ងាយ' : diffLevel === 'medium' ? 'មធ្យម' : 'ពិបាក');

        html += \`
          <div class="question-card" id="card_q_\${qNum}">
            <div class="q-header">
              <div class="q-title"><strong>សំណួរទី \${qNum} :</strong> \${q.question}</div>
            </div>
            <div class="options-list">
              <label class="option-label" id="lbl_\${qNum}_A">
                <input type="radio" name="q_\${qNum}" value="A" class="option-radio" onchange="selectOption(\${qNum}, 'A')">
                <span><strong>ក.</strong> \${optA}</span>
              </label>
              <label class="option-label" id="lbl_\${qNum}_B">
                <input type="radio" name="q_\${qNum}" value="B" class="option-radio" onchange="selectOption(\${qNum}, 'B')">
                <span><strong>ខ.</strong> \${optB}</span>
              </label>
              <label class="option-label" id="lbl_\${qNum}_C">
                <input type="radio" name="q_\${qNum}" value="C" class="option-radio" onchange="selectOption(\${qNum}, 'C')">
                <span><strong>គ.</strong> \${optC}</span>
              </label>
              <label class="option-label" id="lbl_\${qNum}_D">
                <input type="radio" name="q_\${qNum}" value="D" class="option-radio" onchange="selectOption(\${qNum}, 'D')">
                <span><strong>ឃ.</strong> \${optD}</span>
              </label>
            </div>
            \${q.explanation ? \`<div class="explanation-box" id="expl_\${qNum}">💡 <strong>ពន្យល់៖</strong> \${q.explanation}</div>\` : ''}
          </div>
        \`;
      });

      container.innerHTML = html;
    }

    function selectOption(qNum, optLetter) {
      userAnswers[qNum] = optLetter;
      ['A', 'B', 'C', 'D'].forEach(l => {
        const el = document.getElementById('lbl_' + qNum + '_' + l);
        if (el) {
          if (l === optLetter) el.classList.add('selected');
          else el.classList.remove('selected');
        }
      });
      document.getElementById('card_q_' + qNum)?.classList.add('active-q');
    }

    function handleQuizSubmit(e) {
      e.preventDefault();
      const name = document.getElementById('inputStudentName').value.trim();
      const group = document.getElementById('inputStudentGroup').value.trim();

      if (!name) {
        alert('សូមបញ្ចូលឈ្មោះរបស់អ្នកជាមុនសិន!');
        document.getElementById('inputStudentName').focus();
        return;
      }

      let score = 0;
      questions.forEach((q, idx) => {
        const qNum = q.number || (idx + 1);
        const userChoice = userAnswers[qNum];
        const correct = (q.correctAnswer || 'A').toUpperCase().trim();
        const explBox = document.getElementById('expl_' + qNum);
        if (explBox) explBox.style.display = 'block';

        const isCorrect = userChoice && (
          userChoice === correct || 
          (correct.includes('A') && userChoice === 'A') ||
          (correct.includes('B') && userChoice === 'B') ||
          (correct.includes('C') && userChoice === 'C') ||
          (correct.includes('D') && userChoice === 'D')
        );

        if (isCorrect) {
          score++;
          document.getElementById('lbl_' + qNum + '_' + userChoice)?.classList.add('correct-ans');
        } else {
          if (userChoice) {
            document.getElementById('lbl_' + qNum + '_' + userChoice)?.classList.add('wrong-ans');
          }
          // Highlight the right answer in green
          let rightLetter = 'A';
          if (correct.includes('B') || correct.includes('ខ') || correct === '2') rightLetter = 'B';
          else if (correct.includes('C') || correct.includes('គ') || correct === '3') rightLetter = 'C';
          else if (correct.includes('D') || correct.includes('ឃ') || correct === '4') rightLetter = 'D';
          document.getElementById('lbl_' + qNum + '_' + rightLetter)?.classList.add('correct-ans');
        }
      });

      // Disable inputs
      document.querySelectorAll('.option-radio').forEach(r => r.disabled = true);
      document.getElementById('btnSubmitQuiz').style.display = 'none';

      // Show score banner
      const banner = document.getElementById('scoreBanner');
      const scoreText = document.getElementById('scoreText');
      const scoreFeedback = document.getElementById('scoreFeedback');
      banner.style.display = 'block';
      scoreText.textContent = score + ' / ' + questions.length;

      const pct = (score / questions.length) * 100;
      if (pct >= 80) scoreFeedback.textContent = '🌟 អស្ចារ្យណាស់ (' + name + ')! អ្នកទទួលបាននិទ្ទេសល្អប្រសើរ (High Learning Gain)';
      else if (pct >= 50) scoreFeedback.textContent = '👍 ល្អណាស់ (' + name + ')! អ្នកបានឆ្លងកាត់ការវាយតម្លៃដោយជោគជ័យ។';
      else scoreFeedback.textContent = '📚 (' + name + ') សូមពិនិត្យមើលការពន្យល់ខាងក្រោម និងព្យាយាមរំលឹកឡើងវិញ។';

      window.scrollTo({ top: banner.offsetTop - 20, behavior: 'smooth' });
    }

    renderQuestions();
  </script>
</body>
</html>`;
}

function openInteractiveHtmlQuiz(testType = state.activeQuizType || 'pre') {
  const html = buildInteractiveQuizHtmlPage(testType);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  showToast('🚀 បានបើកផ្ទាំងធ្វើតេស្ត Online ភ្លាមៗ!', 'success');
}

function downloadInteractiveHtmlQuiz(testType = state.activeQuizType || 'pre') {
  const plan = state.currentPlan || {};
  const isPre = testType === 'pre';
  const html = buildInteractiveQuizHtmlPage(testType);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${isPre ? 'PreTest_OnlineQuiz' : 'PostTest_OnlineQuiz'}_${(plan.lessonTitle || 'Quiz').replace(/\s+/g, '_')}.html`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast(`📥 បានទាញយក File Quiz (.html) រួចរាល់! អាចផ្ញើតាម Telegram បានភ្លាមៗ`, 'success');
}

// ==========================================
// GOOGLE FORM & GOOGLE APPS SCRIPT GENERATOR
// ==========================================
function generateGoogleAppsScriptCode(testType = 'pre') {
  const plan = state.currentPlan || {};
  const isPre = testType === 'pre';
  const lessonTitle = plan.lessonTitle || 'ចិត្តវិទ្យាអប់រំ';
  const subject = plan.subject || 'ចិត្តវិទ្យាអប់រំ';
  const grade = plan.grade || 'គរុនិស្សិត ឆ្នាំទី ១ ឆមាសទី ២';
  const teacher = plan.teacher || 'កែម បូរី';
  
  const formTitle = isPre 
    ? `វិញ្ញាសាបុរេតេស្ត (Pre-Test): ${lessonTitle} - ${subject} (${grade})`
    : `វិញ្ញាសាតេស្តបញ្ចប់ (Post-Test): ${lessonTitle} - ${subject} (${grade})`;
  const formDesc = isPre
    ? `កម្រងសំណួរស្ទង់ការយល់ដឹងមុនម៉ោង (Pre-Test Diagnostic QCM)\nមុខវិជ្ជា៖ ${subject} | គ្រូឧទ្ទេស៖ ${teacher}\nសូមគរុនិស្សិត/សិស្សានុសិស្សជ្រើសរើសចម្លើយត្រឹមត្រូវតែមួយគត់។`
    : `កម្រងសំណួរវាស់ស្ទង់ពុទ្ធិក្រោយរៀន (Post-Test MCQ Assessment)\nមុខវិជ្ជា៖ ${subject} | គ្រូឧទ្ទេស៖ ${teacher}\nសូមគរុនិស្សិត/សិស្សានុសិស្សជ្រើសរើសចម្លើយត្រឹមត្រូវតែមួយគត់។`;

  const rawQ = isPre 
    ? (plan.preTestQCM && plan.preTestQCM.length > 0 ? plan.preTestQCM : generatePreTestQCMOffline(subject, grade, lessonTitle, []))
    : (plan.postTestMCQ && plan.postTestMCQ.length > 0 ? plan.postTestMCQ : generatePostTestMCQOffline(subject, grade, lessonTitle, []));
  const qList = randomizeQuizList(JSON.parse(JSON.stringify(rawQ)));

  let script = `/**
 * Google Apps Script: បង្កើត Google Form ស្វ័យប្រវត្ត
 * បង្កើតដោយ៖ AI Lesson Plan Studio
 * មុខវិជ្ជា៖ ${subject} | មេរៀន៖ ${lessonTitle}
 */
function createGoogleForm() {
  // ១. បង្កើត Form ថ្មី
  var form = FormApp.create(${JSON.stringify(formTitle)});
  form.setDescription(${JSON.stringify(formDesc)});
  form.setIsQuiz(true);
  form.setCollectEmail(true);
  form.setAllowResponseEdits(false);
  form.setLimitOneResponsePerUser(false);

  // ២. ប្រអប់បញ្ចូលឈ្មោះ និងព័ត៌មានសិស្ស
  var nameItem = form.addTextItem();
  nameItem.setTitle("គោត្តនាម និងនាម (Student Full Name)").setRequired(true);

  var groupItem = form.addTextItem();
  groupItem.setTitle("ក្រុម / ជំនាន់ / ថ្នាក់ (Class / Group)").setRequired(true);

  // ៣. បញ្ចូលសំណួរពហុជ្រើសរើសទាំង ១០
`;

  qList.forEach((q, idx) => {
    const qNum = q.number || (idx + 1);
    const qText = `សំណួរទី ${qNum}: ${q.question || ''}`;
    const opts = q.options || {};
    const optA = opts.A || opts['ក'] || 'ជម្រើស A';
    const optB = opts.B || opts['ខ'] || 'ជម្រើស B';
    const optC = opts.C || opts['គ'] || 'ជម្រើស C';
    const optD = opts.D || opts['ឃ'] || 'ជម្រើស D';
    const correctLetter = (q.correctAnswer || 'A').toUpperCase().trim();
    const isACorrect = correctLetter.includes('A') || correctLetter.includes('ក') || correctLetter === '1';
    const isBCorrect = correctLetter.includes('B') || correctLetter.includes('ខ') || correctLetter === '2';
    const isCCorrect = correctLetter.includes('C') || correctLetter.includes('គ') || correctLetter === '3';
    const isDCorrect = correctLetter.includes('D') || correctLetter.includes('ឃ') || correctLetter === '4';
    const explanation = q.explanation || '';

    script += `
  // សំណួរទី ${qNum}
  var qItem${qNum} = form.addMultipleChoiceItem();
  qItem${qNum}.setTitle(${JSON.stringify(qText)})
    .setPoints(1)
    .setRequired(true)
    .setChoices([
      qItem${qNum}.createChoice(${JSON.stringify('ក. ' + optA)}, ${isACorrect}),
      qItem${qNum}.createChoice(${JSON.stringify('ខ. ' + optB)}, ${isBCorrect}),
      qItem${qNum}.createChoice(${JSON.stringify('គ. ' + optC)}, ${isCCorrect}),
      qItem${qNum}.createChoice(${JSON.stringify('ឃ. ' + optD)}, ${isDCorrect})
    ]);
  ${explanation ? `qItem${qNum}.setFeedbackForIncorrect(FormApp.createFeedback().setText(${JSON.stringify('💡 ពន្យល់៖ ' + explanation)}).build());` : ''}
`;
  });

  script += `
  // ៤. បង្ហាញតំណភ្ជាប់ Form ក្នុង Logger
  var publishedUrl = form.getPublishedUrl();
  var editUrl = form.getEditUrl();
  Logger.log("==========================================");
  Logger.log("🎉 GOOGLE FORM បង្កើតជោគជ័យ!");
  Logger.log("🔗 តំណភ្ជាប់សម្រាប់សិស្សបំពេញ (Public URL): " + publishedUrl);
  Logger.log("✏️ តំណភ្ជាប់សម្រាប់គ្រូកែប្រែ (Edit URL): " + editUrl);
  Logger.log("==========================================");
}
`;
  return script;
}

function openGoogleFormModal(testType = 'pre') {
  state.activeQuizType = testType;
  const isPre = testType === 'pre';
  const modal = document.getElementById('googleFormModal');
  const titleEl = document.getElementById('googleFormModalTitle');
  const codeEl = document.getElementById('googleAppsScriptCode');

  if (titleEl) {
    titleEl.innerHTML = `<i class="fa-solid fa-square-poll-vertical" style="color: #7c3aed;"></i> 📝 ផ្ទាំងធ្វើតេស្តឌីជីថល (${isPre ? 'បុរេតេស្ត Pre-Test' : 'តេស្តបញ្ចប់ Post-Test'})`;
  }

  const script = generateGoogleAppsScriptCode(testType);
  if (codeEl) {
    codeEl.value = script;
  }

  if (modal) modal.style.display = 'flex';
}

function closeGoogleFormModal() {
  const modal = document.getElementById('googleFormModal');
  if (modal) modal.style.display = 'none';
}

async function copyAndOpenGoogleScript() {
  const script = generateGoogleAppsScriptCode(state.activeQuizType || 'pre');
  try {
    await navigator.clipboard.writeText(script);
    showToast('🚀 បានចម្លងកូដ Apps Script! កំពុងបើកផ្ទាំង Google Script (script.new)... សូម Paste (Ctrl+V) រួចចុច Run', 'success');
  } catch (e) {
    showToast('បានរៀបចំកូដរួចរាល់! កំពុងបើក Google Script...', 'info');
  }
  window.open('https://script.new', '_blank');
}

async function copyGoogleAppsScriptOnly() {
  const script = generateGoogleAppsScriptCode(state.activeQuizType || 'pre');
  try {
    await navigator.clipboard.writeText(script);
    showToast('📋 បានចម្លងកូដ Google Apps Script ចូល Clipboard រួចរាល់!', 'success');
  } catch (e) {
    showToast('មិនអាចចម្លងបាន: ' + e.message, 'error');
  }
}

function toggleScriptPreview() {
  const box = document.getElementById('boxAppsScriptAdvance');
  const btn = document.getElementById('btnToggleScript');
  if (!box) return;
  if (box.style.display === 'none') {
    box.style.display = 'block';
    if (btn) btn.textContent = '🙈 លាក់កូដ';
  } else {
    box.style.display = 'none';
    if (btn) btn.textContent = '👁️ បង្ហាញកូដ';
  }
}

async function copyFormattedQuizText() {
  const plan = state.currentPlan || {};
  const isPre = state.activeQuizType === 'pre';
  const rawQ = isPre 
    ? (plan.preTestQCM && plan.preTestQCM.length > 0 ? plan.preTestQCM : generatePreTestQCMOffline(plan.subject, plan.grade, plan.lessonTitle, []))
    : (plan.postTestMCQ && plan.postTestMCQ.length > 0 ? plan.postTestMCQ : generatePostTestMCQOffline(plan.subject, plan.grade, plan.lessonTitle, []));
  const qList = randomizeQuizList(JSON.parse(JSON.stringify(rawQ)));

  let text = `${isPre ? 'វិញ្ញាសាបុរេតេស្ត (Pre-Test)' : 'វិញ្ញាសាតេស្តបញ្ចប់ (Post-Test)'}: ${plan.lessonTitle || 'មេរៀន'}\n`;
  text += `មុខវិជ្ជា៖ ${plan.subject || 'ចិត្តវិទ្យាអប់រំ'} | គ្រូឧទ្ទេស៖ ${plan.teacher || 'កែម បូរី'}\n\n`;

  qList.forEach((q, idx) => {
    const qNum = q.number || (idx + 1);
    const opts = q.options || {};
    text += `${qNum}. ${q.question}\n`;
    text += `   A. ${opts.A || opts['ក'] || ''}\n`;
    text += `   B. ${opts.B || opts['ខ'] || ''}\n`;
    text += `   C. ${opts.C || opts['គ'] || ''}\n`;
    text += `   D. ${opts.D || opts['ឃ'] || ''}\n`;
    text += `   👉 ចម្លើយត្រឹមត្រូវ៖ ${q.correctAnswer || 'A'}\n`;
    if (q.explanation) text += `   💡 ពន្យល់៖ ${q.explanation}\n`;
    text += `\n`;
  });

  try {
    await navigator.clipboard.writeText(text);
    showToast('📋 បានចម្លងសំណួរ និងចម្លើយទាំង ១០ ជា Text រួចរាល់!', 'success');
  } catch (e) {
    showToast('មិនអាចចម្លងបាន: ' + e.message, 'error');
  }
}

function exportCurrentQuizToCSV() {
  exportTestToCSV(state.activeQuizType || 'pre');
}

function exportTestToCSV(testType = 'pre') {
  const plan = state.currentPlan || {};
  const isPre = testType === 'pre';
  const rawQ = isPre 
    ? (plan.preTestQCM && plan.preTestQCM.length > 0 ? plan.preTestQCM : generatePreTestQCMOffline(plan.subject, plan.grade, plan.lessonTitle, []))
    : (plan.postTestMCQ && plan.postTestMCQ.length > 0 ? plan.postTestMCQ : generatePostTestMCQOffline(plan.subject, plan.grade, plan.lessonTitle, []));
  const qList = randomizeQuizList(JSON.parse(JSON.stringify(rawQ)));

  let csvContent = '\uFEFFQuestion,Option A,Option B,Option C,Option D,Correct Answer,Explanation\n';
  qList.forEach((q, idx) => {
    const qNum = q.number || (idx + 1);
    const opts = q.options || {};
    const sanitize = (str) => `"${(str || '').replace(/"/g, '""')}"`;
    const qText = `${qNum}. ${q.question || ''}`;
    const optA = opts.A || opts['ក'] || '';
    const optB = opts.B || opts['ខ'] || '';
    const optC = opts.C || opts['គ'] || '';
    const optD = opts.D || opts['ឃ'] || '';
    const ans = q.correctAnswer || 'A';
    const expl = q.explanation || '';
    csvContent += `${sanitize(qText)},${sanitize(optA)},${sanitize(optB)},${sanitize(optC)},${sanitize(optD)},${sanitize(ans)},${sanitize(expl)}\n`;
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${isPre ? 'PreTest_QCM' : 'PostTest_MCQ'}_${(plan.lessonTitle || 'Quiz').replace(/\s+/g, '_')}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast(`📊 បានទាញយក ${isPre ? 'Pre-Test' : 'Post-Test'} CSV រួចរាល់!`, 'success');
}



// Expose handlers for inline HTML events
window.toggleInAppAudioPodcast = toggleInAppAudioPodcast;
window.openVideoStudioModal = openVideoStudioModal;
window.openVideoStudioWithDemo = openVideoStudioWithDemo;
window.closeVideoStudioModal = closeVideoStudioModal;
window.selectStudioScene = selectStudioScene;
window.toggleVideoPlayback = toggleVideoPlayback;
window.restartVideoPlayback = restartVideoPlayback;
window.downloadVideoAsWebM = downloadVideoAsWebM;
window.openSavedPlanInCanvas = openSavedPlanInCanvas;
window.exportSavedPlanDocx = exportSavedPlanDocx;
window.deleteSavedPlan = deleteSavedPlan;
window.copyNotebookLMPrompt = openNotebookLM;
window.openNotebookLM = openNotebookLM;
window.autoOpenNotebookLMWithPrompt = openNotebookLM;
window.closeNotebookLmModal = closeNotebookLmModal;
window.proceedToNotebookLMWeb = proceedToNotebookLMWeb;
window.copyNotebookLMPromptAgain = copyNotebookLMFlippedPrompt;
window.downloadNotebookLMSourceFile = downloadNotebookLMSourceFile;
window.copyVideoAIScriptPrompt = copyVideoAIScriptPrompt;
window.exportTestToCSV = exportTestToCSV;
window.openInteractiveHtmlQuiz = openInteractiveHtmlQuiz;
window.downloadInteractiveHtmlQuiz = downloadInteractiveHtmlQuiz;
window.openGoogleFormModal = openGoogleFormModal;
window.closeGoogleFormModal = closeGoogleFormModal;
window.copyAndOpenGoogleScript = copyAndOpenGoogleScript;
window.copyGoogleAppsScriptOnly = copyGoogleAppsScriptOnly;
window.toggleScriptPreview = toggleScriptPreview;
window.copyFormattedQuizText = copyFormattedQuizText;
window.exportCurrentQuizToCSV = exportCurrentQuizToCSV;
window.openLearningGainModal = openLearningGainModal;
window.closeLearningGainModal = closeLearningGainModal;
window.calculateLearningGain = calculateLearningGain;
window.applyLearningGainToReflection = applyLearningGainToReflection;
window.openUpdateModal = openUpdateModal;
window.closeUpdateModal = closeUpdateModal;

// ==========================================================================
// 📱 PWA (Progressive Web App) & Install to Home Screen Logic
// ==========================================================================
let deferredPrompt = null;

function isPwaInstalledOrStandalone() {
  const isStandalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
                       window.navigator.standalone === true ||
                       (document.referrer && document.referrer.includes('android-app://'));
  let isStoredInstalled = false;
  try {
    isStoredInstalled = localStorage.getItem('pwa_app_installed') === 'true';
  } catch (e) {}
  return isStandalone || isStoredInstalled;
}

function updateInstallButtonVisibility() {
  const btnInstall = document.getElementById('btnInstallApp');
  if (!btnInstall) return;
  if (isPwaInstalledOrStandalone()) {
    btnInstall.style.display = 'none';
    if (document.documentElement) document.documentElement.classList.add('pwa-installed');
  } else {
    btnInstall.style.display = 'inline-flex';
    if (document.documentElement) document.documentElement.classList.remove('pwa-installed');
  }
}

function markPwaAsInstalled() {
  try {
    localStorage.setItem('pwa_app_installed', 'true');
  } catch (e) {}
  if (document.documentElement) document.documentElement.classList.add('pwa-installed');
  const btnInstall = document.getElementById('btnInstallApp');
  if (btnInstall) {
    btnInstall.style.display = 'none';
  }
  closeInstallModal();
}
window.markPwaAsInstalled = markPwaAsInstalled;

// Check state immediately
updateInstallButtonVisibility();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', updateInstallButtonVisibility);
}

// Listen to display-mode changes (e.g. launched as installed window)
if (window.matchMedia) {
  try {
    window.matchMedia('(display-mode: standalone)').addEventListener('change', (e) => {
      if (e.matches) {
        markPwaAsInstalled();
      } else {
        updateInstallButtonVisibility();
      }
    });
  } catch(e) {}
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  console.log('[PWA] beforeinstallprompt captured!');
  // If the browser triggers beforeinstallprompt, the app is not currently installed
  try {
    localStorage.removeItem('pwa_app_installed');
  } catch (err) {}
  updateInstallButtonVisibility();
  const btnInstall = document.getElementById('btnInstallApp');
  if (btnInstall) {
    btnInstall.style.boxShadow = '0 0 15px rgba(99, 102, 241, 0.8)';
  }
});

window.addEventListener('appinstalled', () => {
  console.log('[PWA] App successfully installed!');
  deferredPrompt = null;
  markPwaAsInstalled();
  if (typeof showToast === 'function') {
    showToast('🎉 បានដំឡើងកម្មវិធីលើអេក្រង់ដោយជោគជ័យ!', 'success');
  }
});

// Register Service Worker for PWA with auto-update
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      console.log('[PWA] ServiceWorker registered:', reg.scope);
      reg.update();
      if (reg.waiting) {
        reg.waiting.postMessage({ action: 'skipWaiting' });
      }
      reg.onupdatefound = () => {
        const installingWorker = reg.installing;
        if (installingWorker) {
          installingWorker.onstatechange = () => {
            if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
              console.log('[PWA] New version ready.');
            }
          };
        }
      };
    }).catch((err) => {
      console.warn('[PWA] ServiceWorker registration failed:', err);
    });
  });
}

// Clear all app caches and reload
window.clearAppCacheAndReload = async function() {
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) {
        await r.unregister();
      }
    }
  } catch (e) {
    console.warn('Error clearing caches:', e);
  }
  window.location.reload(true);
};

// Ensure unwanted widgets remain hidden
function enforceHiddenWidgets() {
  const hiddenSelectors = [
    '.sample-picker-wrapper',
    '#samplePicker',
    '.template-choice-group .radio-cards',
    '.lesson-choice-group .radio-cards'
  ];
  hiddenSelectors.forEach((sel) => {
    document.querySelectorAll(sel).forEach((el) => {
      el.style.setProperty('display', 'none', 'important');
    });
  });
}
enforceHiddenWidgets();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', enforceHiddenWidgets);
}
window.addEventListener('load', enforceHiddenWidgets);


function handleInstallPwaClick() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then((choiceResult) => {
      if (choiceResult.outcome === 'accepted') {
        console.log('[PWA] User accepted the install prompt');
        markPwaAsInstalled();
        if (typeof showToast === 'function') {
          showToast('🚀 កំពុងដំឡើងកម្មវិធីលើអេក្រង់...', 'info');
        }
      }
      deferredPrompt = null;
    });
  } else {
    openInstallModal();
  }
}
window.handleInstallPwaClick = handleInstallPwaClick;

async function triggerPwaPromptDirectly() {
  if (deferredPrompt) {
    handleInstallPwaClick();
    return;
  }
  try {
    const res = await fetch('/api/create-desktop-shortcut', { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      if (data.success) {
        if (typeof showToast === 'function') {
          showToast('✅ បានបង្កើត Shortcut "AI Lesson Plan Studio" លើ Desktop រួចរាល់ដោយជោគជ័យ!', 'success');
        }
        markPwaAsInstalled();
        closeInstallModal();
        return;
      }
    }
  } catch (err) {}

  if (typeof showToast === 'function') {
    showToast('💡 សូមអនុវត្តតាមការណែនាំខាងក្រោម ដើម្បីដំឡើងលើឧបករណ៍របស់អ្នក!', 'info');
  }
}
window.triggerPwaPromptDirectly = triggerPwaPromptDirectly;

function openInstallModal() {
  const modal = document.getElementById('installGuideModal');
  if (modal) modal.style.display = 'flex';
}
window.openInstallModal = openInstallModal;

function closeInstallModal() {
  const modal = document.getElementById('installGuideModal');
  if (modal) modal.style.display = 'none';
}
window.closeInstallModal = closeInstallModal;



window.promptGenerateTest = async function(type) {
  const isEn = (state.language === 'en');
  const isPre = type === 'pre';
  
  const curPlan = state.generatedPlanData || state.currentPlan;
  const existingCount = isPre 
    ? (curPlan?.preTestQCM?.length) 
    : (curPlan?.postTestMCQ?.length);
  const defaultTotal = (existingCount && existingCount > 0) ? existingCount : 10;
  
  // Standardized Assessment Distribution:
  // Pre-Test (Diagnostic): 60% Easy, 30% Medium, 10% Hard
  // Post-Test (Mastery):   20% Easy, 60% Medium, 20% Hard
  const defEasy = isPre ? Math.round(defaultTotal * 0.60) : Math.round(defaultTotal * 0.20);
  const defMed = isPre ? Math.round(defaultTotal * 0.30) : Math.round(defaultTotal * 0.60);
  const defHard = Math.max(0, defaultTotal - defEasy - defMed);

  // Clean any old open config modals
  document.querySelectorAll('.test-config-modal-overlay').forEach(el => el.remove());

  const overlay = document.createElement('div');
  overlay.className = 'modal-backdrop modal-overlay test-config-modal-overlay active';
  overlay.style.cssText = 'position: fixed; inset: 0; background: rgba(15,23,42,0.75); backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px); display: flex; align-items: center; justify-content: center; z-index: 10005;';
  
  const title = isPre 
    ? (isEn ? '🎯 Pre-Test Configuration (60% - 30% - 10%)' : '🎯 ការកំណត់បុរេតេស្ត (Pre-Test) — ៦០% - ៣០% - ១០%') 
    : (isEn ? '🎓 Post-Test Configuration (20% - 60% - 20%)' : '🎓 ការកំណត់បច្ឆិមតេស្ត (Post-Test) — ២០% - ៦០% - ២០%');
  
  const descHelp = isPre
    ? (isEn ? 'Standard Diagnostic Assessment: 60% Easy (Prerequisite recall), 30% Medium (Apply), 10% Hard (Analyze)' : 'ស្តង់ដារបុរេតេស្ត MoEYS: ងាយ ៦០% (ចំណេះដឹងត្រៀមជាមុន), មធ្យម ៣០% (ការយល់ដឹង), ពិបាក ១០% (ការត្រិះរិះ)')
    : (isEn ? "Standard Mastery Assessment (Bloom's Taxonomy): 20% Easy (Recall), 60% Medium (Apply & Analyze), 20% Hard (Evaluate & Create)" : 'ស្តង់ដារបច្ឆិមតេស្ត MoEYS (Bloom): ងាយ ២០% (ចងចាំ), មធ្យម ៦០% (អនុវត្ត និងវិភាគ), ពិបាក ២០% (វាយតម្លៃ និងសំយោគ)');

  const apiKey = (state.geminiApiKey || getActiveGeminiApiKey() || '').trim();
  const provider = state.aiProvider || localStorage.getItem('ai_provider') || 'gemini';
  const hasKey = Boolean(apiKey);
  const provName = provider === 'groq' ? 'Groq Cloud' : (provider === 'openrouter' ? 'OpenRouter' : 'Google Gemini AI');

  overlay.innerHTML = `
    <div class="modal modal-card active" style="max-width: 460px; width: 95%; background: #ffffff; border-radius: 14px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.35); overflow: hidden; animation: modalScaleIn 0.22s cubic-bezier(0.16, 1, 0.3, 1);">
      <div class="modal-header" style="padding: 16px 20px; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: space-between; background: ${isPre ? '#f5f3ff' : '#f0fdf4'};">
        <div class="modal-title" style="color: ${isPre ? '#4338ca' : '#166534'}; font-weight: 800; font-size: 1.05rem; display: flex; align-items: center; gap: 8px;">
          <i class="fa-solid ${isPre ? 'fa-wand-magic-sparkles' : 'fa-graduation-cap'}"></i> <span>${title}</span>
        </div>
        <button class="modal-close" onclick="this.closest('.test-config-modal-overlay').remove()" style="font-size: 1.3rem; background: none; border: none; cursor: pointer; color: #64748b;"><i class="fa-solid fa-times"></i></button>
      </div>
      <div class="modal-body" style="padding: 20px;">
        <div style="font-size: 8.5pt; color: #475569; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 12px; margin-bottom: 14px; line-height: 1.5;">
          💡 <strong>${descHelp}</strong>
        </div>

        ${!hasKey ? `
        <div style="margin-bottom: 14px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 10px 12px; display: flex; align-items: center; justify-content: space-between; gap: 10px;">
          <div style="font-size: 8.5pt; color: #92400e; line-height: 1.4;">
            ⚠️ <strong>មិនទាន់បានបញ្ចូល API Key</strong> (តេស្តនឹងត្រូវរៀបចំតាមគំរូទូទៅ)
          </div>
          <button type="button" onclick="this.closest('.test-config-modal-overlay').remove(); openApiKeyModal();" style="white-space: nowrap; font-size: 8pt; font-weight: 700; background: #d97706; color: white; border: none; padding: 5px 10px; border-radius: 5px; cursor: pointer;">
            🔑 ភ្ជាប់ API Key
          </button>
        </div>` : `
        <div style="margin-bottom: 14px; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; padding: 8px 12px; font-size: 8.5pt; color: #065f46; display: flex; align-items: center; gap: 6px;">
          <i class="fa-solid fa-circle-check" style="color: #10b981;"></i> <span>ភ្ជាប់ជាមួយ <strong>${provName}</strong> រួចរាល់ — ដំណើរការបង្កើតសំណួរឆ្លាតវៃ</span>
        </div>`}

        <div class="form-group">
          <label style="font-weight: 700; color: #334155; margin-bottom: 6px; display: block; font-size: 9.5pt;">${isEn ? 'Total Questions:' : 'ចំនួនសំណួរសរុប៖'}</label>
          <input type="number" id="testTotalQ" class="form-control" value="${defaultTotal}" min="1" max="30" oninput="window.updateScaleInputs()">
        </div>
        <div style="font-weight: 700; font-size: 9.5pt; margin-top: 16px; margin-bottom: 10px; color: #475569; padding-bottom: 5px; border-bottom: 2px solid #e2e8f0; display: flex; justify-content: space-between;">
          <span>${isEn ? 'Difficulty Distribution:' : 'កម្រិតលំបាកសំណួរ (ផលបូកស្មើចំនួនសរុប):'}</span>
          <span style="font-size: 8.5pt; color: #64748b; font-weight: 600;">${isPre ? 'ស្តង់ដារ ៦០% - ៣០% - ១០%' : 'ស្តង់ដារ ២០% - ៦០% - ២០%'}</span>
        </div>
        <div style="display: flex; gap: 10px;">
          <div class="form-group" style="flex: 1;">
            <label style="color: #15803d; font-size: 9pt; font-weight: 700;">${isPre ? (isEn ? 'Easy (60%)' : 'ងាយ (៦០%)') : (isEn ? 'Easy (20%)' : 'ងាយ (២០%)')}</label>
            <input type="number" id="testEasyQ" class="form-control" style="border: 1.5px solid #86efac; background: #f0fdf4; font-weight: 700; color: #166534;" value="${defEasy}" min="0" oninput="window.syncTotalFromScale()">
          </div>
          <div class="form-group" style="flex: 1;">
            <label style="color: #a16207; font-size: 9pt; font-weight: 700;">${isPre ? (isEn ? 'Medium (30%)' : 'មធ្យម (៣០%)') : (isEn ? 'Medium (60%)' : 'មធ្យម (៦០%)')}</label>
            <input type="number" id="testMedQ" class="form-control" style="border: 1.5px solid #fde047; background: #fefce8; font-weight: 700; color: #854d0e;" value="${defMed}" min="0" oninput="window.syncTotalFromScale()">
          </div>
          <div class="form-group" style="flex: 1;">
            <label style="color: #b91c1c; font-size: 9pt; font-weight: 700;">${isPre ? (isEn ? 'Hard (10%)' : 'ពិបាក (១០%)') : (isEn ? 'Hard (20%)' : 'ពិបាក (២០%)')}</label>
            <input type="number" id="testHardQ" class="form-control" style="border: 1.5px solid #fca5a5; background: #fef2f2; font-weight: 700; color: #991b1b;" value="${defHard}" min="0" oninput="window.syncTotalFromScale()">
          </div>
        </div>
        <div id="testScaleError" style="color: #ef4444; font-size: 9pt; margin-top: 12px; display: none; background: #fee2e2; padding: 8px 12px; border-radius: 6px; border: 1px solid #fca5a5; line-height: 1.4;"></div>
      </div>
      <div class="modal-footer" style="justify-content: flex-end; background: #f8fafc; padding: 14px 20px; border-top: 1px solid #e2e8f0; display: flex; gap: 10px;">
        <button class="btn-secondary" onclick="this.closest('.test-config-modal-overlay').remove()">${isEn ? 'Cancel' : 'បោះបង់'}</button>
        <button class="btn-primary" id="btnConfirmTestGen" style="background: ${isPre ? '#4f46e5' : '#10b981'}; box-shadow: none; padding: 8px 18px; border-radius: 8px; font-weight: 700; color: white; border: none; cursor: pointer; display: flex; align-items: center; gap: 6px;">
          <i class="fa-solid fa-bolt"></i> <span>${isEn ? 'Generate Test' : 'បង្កើតកម្រងសំណួរ'}</span>
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  window.updateScaleInputs = function() {
    const totalEl = document.getElementById('testTotalQ');
    const easyEl = document.getElementById('testEasyQ');
    const medEl = document.getElementById('testMedQ');
    const hardEl = document.getElementById('testHardQ');
    const errBox = document.getElementById('testScaleError');
    if (!totalEl || !easyEl || !medEl || !hardEl) return;
    
    const total = Math.max(1, Math.min(30, parseInt(totalEl.value) || 10));

    let e, m, h;
    if (isPre) {
      // Pre-Test Standard: 60% Easy, 30% Medium, 10% Hard
      e = Math.round(total * 0.60);
      m = Math.round(total * 0.30);
      h = Math.max(0, total - e - m);
    } else {
      // Post-Test Standard: 20% Easy, 60% Medium, 20% Hard
      e = Math.round(total * 0.20);
      m = Math.round(total * 0.60);
      h = Math.max(0, total - e - m);
    }
    easyEl.value = e;
    medEl.value = m;
    hardEl.value = h;
    if (errBox) errBox.style.display = 'none';
  };

  window.syncTotalFromScale = function() {
    const totalEl = document.getElementById('testTotalQ');
    const easyEl = document.getElementById('testEasyQ');
    const medEl = document.getElementById('testMedQ');
    const hardEl = document.getElementById('testHardQ');
    const errBox = document.getElementById('testScaleError');
    if (!totalEl || !easyEl || !medEl || !hardEl) return;
    
    const e = Math.max(0, parseInt(easyEl.value) || 0);
    const m = Math.max(0, parseInt(medEl.value) || 0);
    const h = Math.max(0, parseInt(hardEl.value) || 0);
    const sum = e + m + h;
    if (sum > 0) {
      totalEl.value = sum;
    }
    if (errBox) errBox.style.display = 'none';
  };

  document.getElementById('btnConfirmTestGen').onclick = async function() {
    const total = parseInt(document.getElementById('testTotalQ').value) || 0;
    const e = parseInt(document.getElementById('testEasyQ').value) || 0;
    const m = parseInt(document.getElementById('testMedQ').value) || 0;
    const h = parseInt(document.getElementById('testHardQ').value) || 0;

    const errBox = document.getElementById('testScaleError');

    if (total <= 0 || total > 30) {
      errBox.innerHTML = isEn ? '<i class="fa-solid fa-triangle-exclamation"></i> Total questions must be between 1 and 30.' : '<i class="fa-solid fa-triangle-exclamation"></i> ចំនួនសំណួរសរុបត្រូវចន្លោះពី ១ ដល់ ៣០។';
      errBox.style.display = 'block';
      return;
    }
    if (e + m + h !== total) {
      errBox.innerHTML = isEn ? `<i class="fa-solid fa-triangle-exclamation"></i> Scale sum (${e+m+h}) does not match Total (${total}).` : `<i class="fa-solid fa-triangle-exclamation"></i> ផលបូកសំណួរ (${e}+${m}+${h} = ${e+m+h}) មិនស្មើចំនួនសរុប (${total}) ទេ។`;
      errBox.style.display = 'block';
      return;
    }
    const key = (state.geminiApiKey || getActiveGeminiApiKey() || localStorage.getItem('gemini_api_key') || sessionStorage.getItem('gemini_api_key') || '').trim();
    if (!key) {
      overlay.remove();
      openApiKeyModal();
      showToast(isEn ? '⚠️ Please connect your Gemini API Key first to generate authentic AI questions.' : '⚠️ សូមភ្ជាប់ Google Gemini API Key (100% Free) ជាមុនសិន ដើម្បីឱ្យ AI បង្កើតកម្រងសំណួរឆ្លាតវៃពិតប្រាកដ (គ្មានពុម្ពគំរូ)!', 'warning', 6000);
      return;
    }

    overlay.remove();

    if (type === 'pre') {
      await generatePreTestOnDemand(total, {e, m, h});
    } else {
      await generatePostTestOnDemand(total, {e, m, h});
    }
  };
};

// ==========================================================================
// 🗂️ LocalStorage History & Dashboard System
// ==========================================================================
const HISTORY_STORAGE_KEY = 'alps_plan_history';
const MAX_HISTORY_ITEMS = 30; // Store up to 30 plans to stay well within 5MB limit

function saveToHistory(planData, isFlipped = false) {
  if (!planData || !planData.lessonTitle) return;
  try {
    let history = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) || '[]');
    
    // Create new history record
    const record = {
      id: Date.now().toString(),
      date: new Date().toISOString(),
      subject: planData.subject || '',
      grade: planData.grade || '',
      title: planData.lessonTitle || 'មេរៀនថ្មី',
      template: isFlipped ? 'flipped' : (planData.templateType || 'standard'),
      gNum: null, // Will be updated if they calculate learning gain
      planData: planData // Full object for restoring later
    };

    // Add to beginning of array
    history.unshift(record);
    
    // Trim to max items
    if (history.length > MAX_HISTORY_ITEMS) {
      history = history.slice(0, MAX_HISTORY_ITEMS);
    }
    
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
    console.log("Plan saved to local history.");
  } catch (e) {
    console.error("Failed to save history to LocalStorage:", e);
  }
}

// Called from applyLearningGainToReflection
function updateHistoryGain(gNum, planData) {
  try {
    let history = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) || '[]');
    if (history.length === 0) return;
    
    // We assume the most recent plan that matches the current plan is the one to update.
    // Or simpler: just update the very first one if generated recently.
    if (history[0].title === planData.lessonTitle) {
      history[0].gNum = gNum;
      history[0].planData = planData; // update with the new selfEvaluation attached
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
    }
  } catch (e) {
    console.error("Failed to update history gain:", e);
  }
}

function openHistoryModal() {
  const modal = document.getElementById('historyModal');
  if (modal) {
    modal.classList.add('active');
    renderHistoryList();
  }
}

function closeHistoryModal() {
  const modal = document.getElementById('historyModal');
  if (modal) {
    modal.classList.remove('active');
  }
}

function renderHistoryList() {
  const container = document.getElementById('historyListContainer');
  const statTotal = document.getElementById('statTotalPlans');
  const statAvgGain = document.getElementById('statAvgGain');
  const isEn = (state.language === 'en');
  
  if (!container || !statTotal || !statAvgGain) return;
  
  let history = [];
  try {
    history = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) || '[]');
  } catch(e) {}
  
  statTotal.innerText = history.length;
  
  // Calculate average gain
  let sumGain = 0;
  let countGain = 0;
  history.forEach(item => {
    if (item.gNum !== null && item.gNum !== undefined) {
      sumGain += parseFloat(item.gNum);
      countGain++;
    }
  });
  
  if (countGain > 0) {
    statAvgGain.innerText = (sumGain / countGain).toFixed(2);
  } else {
    statAvgGain.innerText = "N/A";
  }
  
  if (history.length === 0) {
    container.innerHTML = `<div style="text-align: center; padding: 40px 20px; color: #64748b;">
      <i class="fa-solid fa-folder-open" style="font-size: 3rem; margin-bottom: 12px; opacity: 0.5;"></i>
      <div>${isEn ? 'No lesson plans saved in history yet.<br>Every lesson plan you generate will be automatically saved here.' : 'មិនទាន់មានប្រវត្តិកិច្ចតែងការនៅឡើយទេ។<br>រាល់កិច្ចតែងការដែលលោកគ្រូបង្កើត វានឹងត្រូវរក្សាទុកនៅទីនេះដោយស្វ័យប្រវត្តិ។'}</div>
    </div>`;
    return;
  }
  
  let html = '';
  history.forEach((item, index) => {
    const d = new Date(item.date);
    const dateStr = isEn
      ? d.toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric'}) + ' ' + d.toLocaleTimeString('en-US', {hour: '2-digit', minute:'2-digit'})
      : d.toLocaleDateString('km-KH') + ' ' + d.toLocaleTimeString('en-US', {hour: '2-digit', minute:'2-digit'});
    
    let gainBadge = '';
    if (item.gNum !== null && item.gNum !== undefined) {
      let gColor = '#ef4444'; // low
      if (item.gNum >= 0.7) gColor = '#10b981'; // high
      else if (item.gNum >= 0.3) gColor = '#f59e0b'; // med
      
      gainBadge = `<span style="display: inline-block; background: ${gColor}15; color: ${gColor}; padding: 2px 8px; border-radius: 4px; font-size: 8.5pt; font-weight: 700; margin-top: 4px;">Gain: ${item.gNum.toFixed(2)}</span>`;
    }
    
    const gradeLabel = isEn ? 'Grade: ' : 'កម្រិត៖ ';
    const openBtnText = isEn ? 'Open Plan' : 'បើកមើល';
    const deleteBtnText = isEn ? 'Delete' : 'លុប';

    html += `
      <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; display: flex; justify-content: space-between; align-items: center; transition: 0.2s;">
        <div style="flex: 1; padding-right: 12px;">
          <div style="font-size: 11pt; font-weight: 700; color: #0f172a; margin-bottom: 4px;">${escapeHtml(item.title)}</div>
          <div style="font-size: 9pt; color: #64748b;">${escapeHtml(item.subject)} | ${gradeLabel}${escapeHtml(item.grade)}</div>
          <div style="font-size: 8.5pt; color: #94a3b8; margin-top: 4px;"><i class="fa-regular fa-clock"></i> ${dateStr}</div>
          ${gainBadge}
        </div>
        <div style="display: flex; gap: 8px; flex-direction: column;">
          <button onclick="loadPlanFromHistory(${index})" style="background: #4f46e5; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 9pt; font-weight: 600;"><i class="fa-solid fa-folder-open"></i> ${openBtnText}</button>
          <button onclick="deleteHistoryItem(${index})" style="background: #f8fafc; color: #ef4444; border: 1px solid #fca5a5; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 9pt;"><i class="fa-solid fa-trash-can"></i> ${deleteBtnText}</button>
        </div>
      </div>
    `;
  });
  
  container.innerHTML = html;
}

function loadPlanFromHistory(index) {
  try {
    const history = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) || '[]');
    if (history[index] && history[index].planData) {
      state.generatedPlanData = history[index].planData;
      state.currentPlan = history[index].planData;
      renderLessonPlanToA4(history[index].planData);
      
      document.getElementById('emptyState').style.display = 'none';
      const wrapper = document.getElementById('a4Wrapper');
      wrapper.style.display = 'block';
      wrapper.scrollIntoView({ behavior: 'smooth' });
      
      closeHistoryModal();
      showToast('✅ បានទាញយកកិច្ចតែងការពីប្រវត្តិដោយជោគជ័យ!', 'success');
    }
  } catch (e) {
    showToast('មានបញ្ហាក្នុងការទាញយកកិច្ចតែងការ!', 'error');
  }
}

function deleteHistoryItem(index) {
  if (!confirm('តើលោកគ្រូពិតជាចង់លុបកិច្ចតែងការនេះចេញពីប្រវត្តិមែនទេ?')) return;
  try {
    const history = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) || '[]');
    history.splice(index, 1);
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
    renderHistoryList();
  } catch (e) {}
}

function clearHistory() {
  if (!confirm('តើលោកគ្រូពិតជាចង់លុបប្រវត្តិកិច្ចតែងការទាំងអស់ចេញពីកុំព្យូទ័រនេះមែនទេ? (សកម្មភាពនេះមិនអាចទាញត្រលប់មកវិញបានទេ)')) return;
  localStorage.removeItem(HISTORY_STORAGE_KEY);
  renderHistoryList();
  showToast('បានលុបប្រវត្តិទាំងអស់ដោយជោគជ័យ!', 'success');
}

// ==========================================================================
// 📊 PPTX Generation (PowerPoint) via PptxGenJS + Gemini
// ==========================================================================


// ==========================================================================
// 📊 PPTX Attachment & Reliable Image Helpers
// ==========================================================================

function generateEducationalCardDataUrl(title, keyword, subject, theme, slideIndex = 1) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 768;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Theme Color Schemes
    let c1 = '#1e3a8a', c2 = '#2563eb', c3 = '#38bdf8';
    if (theme === 'eco_green') {
      c1 = '#064e3b'; c2 = '#059669'; c3 = '#34d399';
    } else if (theme === 'dark_mode') {
      c1 = '#0f172a'; c2 = '#1e293b'; c3 = '#64748b';
    } else if (theme === 'simple_light') {
      c1 = '#334155'; c2 = '#475569'; c3 = '#94a3b8';
    }

    // 1. Background Gradient
    const bgGrad = ctx.createLinearGradient(0, 0, 1024, 768);
    bgGrad.addColorStop(0, c1);
    bgGrad.addColorStop(1, c2);
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, 1024, 768);

    // 2. Decorative geometric accents
    ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.beginPath();
    ctx.arc(880, 120, 260, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(140, 680, 220, 0, Math.PI * 2);
    ctx.fill();

    // 3. Central Modern Educational Card
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(60, 60, 904, 648, 24);
    } else {
      ctx.rect(60, 60, 904, 648);
    }
    ctx.fill();
    ctx.stroke();

    // 4. Header Badges
    ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(90, 95, 360, 48, 12);
      ctx.roundRect(750, 95, 180, 48, 12);
    } else {
      ctx.rect(90, 95, 360, 48);
      ctx.rect(750, 95, 180, 48);
    }
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px "Kantumruy Pro", sans-serif';
    ctx.fillText(`📚 មុខវិជ្ជា៖ ${subject || 'ទូទៅ'}`, 110, 128);
    ctx.fillText(`ស្លាយទី #${slideIndex}`, 785, 128);

    // 5. Main Title & Concept
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 34px "Kantumruy Pro", sans-serif';
    const displayTitle = (title || 'ខ្លឹមសារមេរៀន').substring(0, 45);
    ctx.fillText(displayTitle, 90, 215);

    // 6. Pedagogical Concept Diagram (3 Visual Pillars)
    const pillars = [
      { num: '១', label: 'ស្វែងយល់', desc: 'ចំណេះដឹងគន្លឹះ' },
      { num: '២', label: 'ពិភាក្សា', desc: 'ការគិតពិចារណា' },
      { num: '៣', label: 'អនុវត្ត', desc: 'បំណិន និងសមត្ថភាព' }
    ];

    const pw = 250, ph = 260, gap = 45, sx = 100, sy = 265;
    pillars.forEach((p, idx) => {
      const px = sx + idx * (pw + gap);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(px, sy, pw, ph, 16);
      } else {
        ctx.rect(px, sy, pw, ph);
      }
      ctx.fill();
      ctx.stroke();

      // Number badge
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(px + 45, sy + 50, 24, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1e293b';
      ctx.font = 'bold 22px "Kantumruy Pro", sans-serif';
      ctx.fillText(p.num, px + 38, sy + 58);

      // Label
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 26px "Kantumruy Pro", sans-serif';
      ctx.fillText(p.label, px + 30, sy + 130);

      // Description
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '19px "Kantumruy Pro", sans-serif';
      ctx.fillText(p.desc, px + 30, sy + 180);
    });

    // 7. Footer MoEYS Pedagogical Tag
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.font = '18px "Kantumruy Pro", sans-serif';
    ctx.fillText('🎓 គរុកោសល្យ និងវិធីសាស្ត្របង្រៀនស្តង់ដារ MoEYS Cambodia', 95, 660);

    return canvas.toDataURL('image/png');
  } catch (err) {
    console.error('Canvas illustration error:', err);
    return null;
  }
}

async function fetchImageAsBase64(url, timeoutMs = 8000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch(url, { signal: controller.signal, mode: 'cors' });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const res = reader.result;
        if (typeof res === 'string' && res.startsWith('data:image')) {
          resolve(res);
        } else {
          resolve(null);
        }
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    return null;
  }
}

function sanitizeEnglishPrompt(text) {
  if (!text) return '';
  return String(text)
    .replace(/[^\x00-\x7F]/g, ' ')
    .replace(/[^\w\s,-]/gi, ' ')
    .replace(/[\n\r\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const EDUCATIONAL_IMAGE_CATEGORIES = {
  reflective: [
    'https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=1024&q=80',
    'https://images.unsplash.com/photo-1455390582262-044cdead277a?w=1024&q=80'
  ],
  research: [
    'https://images.unsplash.com/photo-1497633762265-9d179a990aa6?w=1024&q=80',
    'https://images.unsplash.com/photo-1532094349884-543bc11b234d?w=1024&q=80'
  ],
  learner: [
    'https://images.unsplash.com/photo-1509062522246-3755977927d7?w=1024&q=80',
    'https://images.unsplash.com/photo-1580582932707-520aed937b7b?w=1024&q=80'
  ],
  psychology: [
    'https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=1024&q=80',
    'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=1024&q=80'
  ],
  teacher: [
    'https://images.unsplash.com/photo-1577896851231-70ef18881754?w=1024&q=80',
    'https://images.unsplash.com/photo-1524178232363-1fb2b075b655?w=1024&q=80'
  ],
  group: [
    'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=1024&q=80',
    'https://images.unsplash.com/photo-1513258496099-48168024aec0?w=1024&q=80'
  ],
  summary: [
    'https://images.unsplash.com/photo-1427504494785-3a9ca7044f45?w=1024&q=80',
    'https://images.unsplash.com/photo-1491841573634-28140fc7ced7?w=1024&q=80'
  ],
  science: [
    'https://images.unsplash.com/photo-1532094349884-543bc11b234d?w=1024&q=80',
    'https://images.unsplash.com/photo-1507668077129-56e32842fceb?w=1024&q=80'
  ],
  math: [
    'https://images.unsplash.com/photo-1509228468518-180dd4864904?w=1024&q=80',
    'https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=1024&q=80'
  ]
};

async function getSlideImage(slideDef, data, imageMode, theme, slideIndex) {
  if (imageMode === 'no') return null;

  // 1. Determine authentic educational topic from slide content
  const fullSlideText = `${slideDef.title || ''} ${slideDef.imageSearchKeyword || ''} ${(slideDef.bullets || []).join(' ')} ${data.subject || ''}`.toLowerCase();
  
  let targetCategory = 'teacher';
  if (/ឆ្លុះបញ្ចាំង|reflective|reflection|journal|portfolio|រំលឹក/i.test(fullSlideText)) {
    targetCategory = 'reflective';
  } else if (/ស្រាវជ្រាវ|research|action research|investigation|ទិន្នន័យ|វិភាគ/i.test(fullSlideText)) {
    targetCategory = 'research';
  } else if (/អ្នកសិក្សា|learner|student|diversity|សមត្ថភាព|កុមារ/i.test(fullSlideText)) {
    targetCategory = 'learner';
  } else if (/ចិត្តវិទ្យា|psychology|cognitive|mind|brain|constructivism|ទ្រឹស្តី|ការយល់ដឹង/i.test(fullSlideText)) {
    targetCategory = 'psychology';
  } else if (/ពិភាក្សា|group|collaborative|discussion|peer|សហការ|ដៃគូ/i.test(fullSlideText)) {
    targetCategory = 'group';
  } else if (/សង្ខេប|summary|conclusion|achievement|ជោគជ័យ|បណ្តាំផ្ញើ|វាយតម្លៃ|assessment/i.test(fullSlideText)) {
    targetCategory = 'summary';
  } else if (/វិទ្យាសាស្ត្រ|science|lab|ពិសោធន៍|រូបវិទ្យា|គីមី|ជីវវិទ្យា/i.test(fullSlideText)) {
    targetCategory = 'science';
  } else if (/គណិត|math|រូបមន្ត|លំហាត់/i.test(fullSlideText)) {
    targetCategory = 'math';
  }

  // 2. Try Pollinations AI first if in AI mode and not blocked
  if (imageMode === 'ai') {
    let cleanPrompt = sanitizeEnglishPrompt(slideDef.imagePrompt || slideDef.imageSearchKeyword || '');
    if (cleanPrompt && cleanPrompt.length >= 8) {
      if (!/education|classroom|school|learning|pedagogy|teacher|students/i.test(cleanPrompt)) {
        cleanPrompt += ', educational classroom setting';
      }
      const fullPrompt = `${cleanPrompt.substring(0, 160)}, educational digital illustration, high quality`;
      const seed = Math.floor(Math.random() * 900000) + 100000;
      const aiUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(fullPrompt)}?width=1024&height=768&nologo=true&seed=${seed}`;
      try {
        const base64 = await fetchImageAsBase64(aiUrl, 3500);
        if (base64 && base64.startsWith('data:image')) {
          return { data: base64 };
        }
      } catch (e) {}
    }
  }

  // 3. High-Resolution Curated Educational Visual Bank (100% Reliable, 100ms, Instant CORS, Guaranteed Subject Relevance!)
  const list = EDUCATIONAL_IMAGE_CATEGORIES[targetCategory] || EDUCATIONAL_IMAGE_CATEGORIES['teacher'];
  const chosenUrl = list[(slideIndex - 1) % list.length];

  try {
    const base64 = await fetchImageAsBase64(chosenUrl, 6000);
    if (base64 && base64.startsWith('data:image')) {
      return { data: base64 };
    }
  } catch (e) {
    console.warn(`[PPTX Image ${slideIndex}] Educational bank fetch error:`, e);
  }

  // 4. Absolute offline zero-failure Canvas Diagram Card
  const canvasBase64 = generateEducationalCardDataUrl(slideDef.title, targetCategory, data.subject, theme, slideIndex);
  if (canvasBase64) {
    return { data: canvasBase64 };
  }

  return null;
}

function updatePptxAttachmentOptions() {
  const select = document.getElementById('pptxSourceSelect');
  const optLesson = document.getElementById('pptxOptUploadedLesson');
  const optHistory = document.getElementById('pptxOptHistoryPlan');
  const optCustom = document.getElementById('pptxOptCustomFile');
  const badge = document.getElementById('pptxUploadedFileBadge');
  const badgeName = document.getElementById('pptxUploadedFileName');

  if (!select) return;

  // 1. Check if user previously uploaded a lesson file in Step 2
  if (state.lessonFileName && state.lessonContent) {
    if (optLesson) {
      optLesson.style.display = '';
      optLesson.textContent = `📂 ${state.lessonFileName} (ឯកសារមេរៀនដែលបានផ្ទុកឡើង)`;
    }
  } else {
    if (optLesson) optLesson.style.display = 'none';
  }

  // 2. Check if history has saved plans
  try {
    const history = JSON.parse(localStorage.getItem('alps_plan_history') || '[]');
    if (history.length > 0) {
      if (optHistory) {
        optHistory.style.display = '';
        optHistory.textContent = `📋 ${history[0].title || 'កិច្ចតែងការចុងក្រោយ'} (ពីប្រវត្តិ)`;
      }
    } else {
      if (optHistory) optHistory.style.display = 'none';
    }
  } catch (e) {
    if (optHistory) optHistory.style.display = 'none';
  }

  // 3. Check if user attached a custom file inside this modal
  if (state.pptxCustomSource && state.pptxCustomSource.fileName) {
    if (optCustom) {
      optCustom.style.display = '';
      optCustom.textContent = `📤 ${state.pptxCustomSource.fileName} (ឯកសារទើបបង្ហោះ)`;
    }
    if (badge && badgeName) {
      badge.style.display = 'flex';
      badgeName.innerHTML = `<i class="fa-solid fa-file-circle-check" style="margin-right: 5px;"></i> <b>${state.pptxCustomSource.fileName}</b> (${Math.round((state.pptxCustomSource.fileSize || 0) / 1024)} KB)`;
    }
  } else {
    if (optCustom) optCustom.style.display = 'none';
    if (badge) badge.style.display = 'none';
  }

  // 4. Update in-modal warning / confirmation alert
  refreshPptxSourceAlert();
}

function refreshPptxSourceAlert() {
  const select = document.getElementById('pptxSourceSelect');
  const alertEl = document.getElementById('pptxSourceAlert');
  const alertText = document.getElementById('pptxSourceAlertText');
  const alertIcon = document.getElementById('pptxSourceAlertIcon');
  if (!alertEl || !select) return;

  const isEn = (state.language === 'en');
  const currentVal = select.value;
  const hasPlan = !!(state.generatedPlanData || state.currentPlan || (document.getElementById('lessonTitleInput')?.value || '').trim());
  const hasUploadedLesson = !!(state.lessonFileName && state.lessonContent);
  const hasCustom = !!(state.pptxCustomSource && state.pptxCustomSource.fileName);

  if (currentVal === 'current_plan') {
    if (!hasPlan) {
      alertEl.style.display = 'block';
      alertEl.style.background = '#fffbeb';
      alertEl.style.borderColor = '#fde68a';
      alertEl.style.color = '#b45309';
      if (alertIcon) alertIcon.className = 'fa-solid fa-triangle-exclamation';
      if (alertIcon) alertIcon.style.color = '#f59e0b';
      if (alertText) {
        alertText.innerHTML = isEn
          ? '<b>⚠️ No lesson plan available yet!</b><br>Please click <a href="javascript:void(0)" onclick="triggerPptxSourceUpload()" style="color: #e11d48; font-weight: 700; text-decoration: underline;">"Upload New File"</a> above to select a Word/PDF file, or generate a lesson plan first.'
          : '<b>⚠️ មិនទាន់មានកិច្ចតែងការបង្រៀននៅឡើយទេ!</b><br>សូមចុចប៊ូតុង <a href="javascript:void(0)" onclick="triggerPptxSourceUpload()" style="color: #e11d48; font-weight: 700; text-decoration: underline;">«បង្ហោះឯកសារថ្មី»</a> ដើម្បីជ្រើសឯកសារ Word/PDF មេរៀន ឬត្រឡប់ទៅបង្កើតកិច្ចតែងការជាមុនសិន។';
      }
    } else {
      alertEl.style.display = 'block';
      alertEl.style.background = '#f0fdf4';
      alertEl.style.borderColor = '#bbf7d0';
      alertEl.style.color = '#166534';
      if (alertIcon) alertIcon.className = 'fa-solid fa-circle-check';
      if (alertIcon) alertIcon.style.color = '#10b981';
      const defaultPlanTitle = isEn ? 'Current Lesson Plan' : 'កិច្ចតែងការបច្ចុប្បន្ន';
      const planTitle = (state.generatedPlanData?.lessonTitle || state.currentPlan?.lessonTitle || document.getElementById('lessonTitleInput')?.value || defaultPlanTitle);
      if (alertText) {
        alertText.innerHTML = isEn
          ? `<b>✅ Current lesson plan detected:</b> <i>${escapeHtml(planTitle)}</i> (Ready to generate slides)`
          : `<b>✅ រកឃើញកិច្ចតែងការបច្ចុប្បន្ន៖</b> <i>${escapeHtml(planTitle)}</i> (រួចរាល់សម្រាប់បង្កើតស្លាយ)`;
      }
    }
  } else if (currentVal === 'uploaded_lesson_file') {
    if (hasUploadedLesson) {
      alertEl.style.display = 'block';
      alertEl.style.background = '#f0fdf4';
      alertEl.style.borderColor = '#bbf7d0';
      alertEl.style.color = '#166534';
      if (alertIcon) alertIcon.className = 'fa-solid fa-circle-check';
      if (alertIcon) alertIcon.style.color = '#10b981';
      if (alertText) {
        alertText.innerHTML = isEn
          ? `<b>✅ Attached lesson reference:</b> <i>${escapeHtml(state.lessonFileName)}</i> (Ready to generate slides)`
          : `<b>✅ ឯកសារមេរៀនយោង៖</b> <i>${escapeHtml(state.lessonFileName)}</i> (រួចរាល់សម្រាប់បង្កើតស្លាយ)`;
      }
    } else {
      alertEl.style.display = 'none';
    }
  } else if (currentVal === 'custom_file') {
    if (hasCustom) {
      alertEl.style.display = 'none';
    } else {
      alertEl.style.display = 'block';
      alertEl.style.background = '#fffbeb';
      alertEl.style.borderColor = '#fde68a';
      alertEl.style.color = '#b45309';
      if (alertIcon) alertIcon.className = 'fa-solid fa-cloud-arrow-up';
      if (alertIcon) alertIcon.style.color = '#f59e0b';
      if (alertText) {
        alertText.innerHTML = isEn
          ? '<b>Please select a Word/PDF document</b> by clicking "Upload New File" above.'
          : '<b>សូមជ្រើសរើសឯកសារ Word/PDF</b> ដោយចុចប៊ូតុង «បង្ហោះឯកសារថ្មី» ខាងលើ។';
      }
    }
  } else {
    alertEl.style.display = 'none';
  }
}
window.refreshPptxSourceAlert = refreshPptxSourceAlert;

window.triggerPptxSourceUpload = function() {
  const input = document.getElementById('pptxSourceFileInput');
  if (input) input.click();
};

window.handlePptxSourceFileUploaded = async function(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  showToast(`កំពុងអានឯកសារ ${file.name}...`, 'info');
  try {
    const text = await extractTextFromFile(file);
    if (!text || text.trim().length === 0) {
      showToast(`⚠️ មិនអាចស្រង់អត្ថបទពី ${file.name} បានទេ។ សូមពិនិត្យឯកសារម្តងទៀត!`, 'warning');
      return;
    }
    state.pptxCustomSource = {
      fileName: file.name,
      content: text.trim(),
      fileSize: file.size
    };
    updatePptxAttachmentOptions();
    const select = document.getElementById('pptxSourceSelect');
    if (select) select.value = 'custom_file';
    refreshPptxSourceAlert();
    showToast(`✅ បានភ្ជាប់ឯកសារ ${file.name} (${text.trim().length} តួអក្សរ) សម្រាប់បង្កើតស្លាយ!`, 'success');
  } catch (err) {
    console.error('Error reading pptx attachment file:', err);
    showToast('❌ បរាជ័យក្នុងការអានឯកសារ: ' + err.message, 'error');
  } finally {
    event.target.value = '';
  }
};

window.clearPptxCustomSource = function() {
  state.pptxCustomSource = null;
  updatePptxAttachmentOptions();
  const select = document.getElementById('pptxSourceSelect');
  if (select) select.value = 'current_plan';
  refreshPptxSourceAlert();
  showToast('បានដកឯកសារភ្ជាប់ចេញរួចរាល់', 'info');
};

window.handlePptxSourceChanged = function(val) {
  if (val === 'custom_file' && !state.pptxCustomSource) {
    triggerPptxSourceUpload();
  }
  refreshPptxSourceAlert();
};

window.openGeminiPromptModal = function() {
  const el = document.getElementById('geminiPromptModal');
  if (el) el.style.display = 'flex';
};

window.closeGeminiPromptModal = function() {
  const el = document.getElementById('geminiPromptModal');
  if (el) el.style.display = 'none';
};

window.backToPptxModal = function() {
  closeGeminiPromptModal();
  const pptxModal = document.getElementById('pptxModal');
  if (pptxModal) pptxModal.style.display = 'flex';
};

window.generateGeminiSlidePrompt = function() {
  const sourceChoice = document.getElementById('pptxSourceSelect')?.value || 'current_plan';
  let title = (document.getElementById('lessonTitleInput')?.value || '').trim();
  let subject = (document.getElementById('subjectSelect')?.value || 'ទូទៅ').trim();
  let grade = (document.getElementById('gradeSelect')?.value || 'ទូទៅ').trim();
  let sourceText = '';

  if (sourceChoice === 'custom_file' && state.pptxCustomSource) {
    sourceText = state.pptxCustomSource.content;
    title = state.pptxCustomSource.fileName.replace(/\.[^/.]+$/, "");
  } else if (sourceChoice === 'uploaded_lesson_file' && state.lessonContent) {
    sourceText = state.lessonContent;
    if (state.lessonFileName) title = state.lessonFileName.replace(/\.[^/.]+$/, "");
  } else if (sourceChoice === 'history_plan') {
    try {
      const history = JSON.parse(localStorage.getItem('alps_plan_history') || '[]');
      if (history.length > 0 && history[0].planData) {
        sourceText = history[0].planData.sourceDocumentText || JSON.stringify(history[0].planData);
        title = history[0].title || title;
      }
    } catch (_) {}
  } else if (state.currentPlan?.sourceDocumentText) {
    sourceText = state.currentPlan.sourceDocumentText;
    if (state.currentPlan.lessonTitle) title = state.currentPlan.lessonTitle;
  } else if (state.currentPlan) {
    sourceText = JSON.stringify(state.currentPlan, null, 2);
    if (state.currentPlan.lessonTitle) title = state.currentPlan.lessonTitle;
  }

  if (!sourceText && !title) {
    const alertEl = document.getElementById('pptxSourceAlert');
    if (alertEl) alertEl.style.display = 'block';
    showToast('⚠️ សូមបញ្ចូលចំណងជើងមេរៀន ឬបង្ហោះឯកសារយោងជាមុនសិន!', 'warning', 6000);
    return;
  }

  const numSlides = parseInt(document.getElementById('pptxNumSlides')?.value || '15');
  const theme = document.getElementById('pptxTheme')?.value || 'modern_blue';
  const themeMap = {
    modern_blue: 'Modern Blue (ខៀវទំនើប - ស្តង់ដារ MoEYS)',
    eco_green: 'Eco Green (បៃតងធម្មជាតិ)',
    dark_mode: 'Dark Mode (ស្រមោលងងឹត - ទំនើប)',
    simple_light: 'Simple Light (ស/ស្អាត)'
  };
  const themeName = themeMap[theme] || 'Modern Blue';

  const curatedImageBank = [
    'https://images.unsplash.com/photo-1509062522246-3755977927d7?w=900&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1427504494785-3a9ca7044f45?w=900&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=900&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1524178232363-1fb2b075b655?w=900&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1577896851231-70ef18881754?w=900&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1497633762265-9d179a990aa6?w=900&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=900&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1580582932707-520aed937b7b?w=900&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1532094349884-543bc11b234d?w=900&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1509228468518-180dd4864904?w=900&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=900&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=900&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1491841573634-28140fc7ced7?w=900&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=900&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1513542789411-b6a5d4f31634?w=900&auto=format&fit=crop'
  ];

  let exactSlideImagesText = '';
  for (let i = 1; i <= numSlides; i++) {
    const imgUrl = curatedImageBank[(i - 1) % curatedImageBank.length];
    exactSlideImagesText += `- ស្លាយទី ${i}៖ ${imgUrl}\n`;
  }

  const webPrompt = `អ្នកគឺជាអ្នកជំនាញគរុកោសល្យ និងរចនាស្លាយបទបង្ហាញ PowerPoint កម្រិតខ្ពស់សម្រាប់ក្រសួងអប់រំ យុវជន និងកីឡា (MoEYS)។
សូមជួយរៀបចំខ្លឹមសារស្លាយបទបង្ហាញ PowerPoint (Slide Presentation Outline) ចំនួន ${numSlides} ស្លាយ (ស្លាយទី១ ដល់ ស្លាយទី ${numSlides}) យ៉ាងពិស្តារ លម្អិត និងស្រស់ស្អាតបំផុតសម្រាប់មេរៀនខាងក្រោម៖

📌 ព័ត៌មានមេរៀន៖
- ចំណងជើងមេរៀន៖ ${title || 'មេរៀនអប់រំ'}
- មុខវិជ្ជា៖ ${subject}
- កម្រិតថ្នាក់៖ ${grade}
- ចំនួនស្លាយដែលត្រូវបង្កើត៖ ${numSlides} ស្លាយ (រួមទាំងស្លាយចំណងជើង)
- រចនាបថពណ៌ស្លាយ៖ ${themeName}
- ទម្រង់ស្លាយ៖ កាតព័ត៌មានទំនើប (Modern Card Concept Layout) សមាមាត្រ 16:9

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚨 លក្ខខណ្ឌចាំបាច់ពិសេស (STRICT MANDATORY RULES):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

១. 🖼️ រូបភាពអប់រំពិតប្រាកដសម្រាប់គ្រប់ស្លាយទាំងអស់ (Real Educational Photography - ZERO PLACEHOLDERS):
   - គ្រប់ស្លាយទាំងអស់ (ចាប់ពីស្លាយទី ១ ដល់ ស្លាយទី ${numSlides}) ត្រូវតែមានរូបភាពអប់រំពិតប្រាកដ ១០០% ស្រស់ស្អាត ទាក់ទាញ។
   - 🚫 បម្រាមដាច់ខាត៖ ហាមប្រើប្រាស់រូបភាពប្រផេះ (DO NOT use placehold.co, via.placeholder, 600x400 ឬប្រអប់ទទេ) ជាដាច់ខាត!
   - 📸 បញ្ជី URL រូបភាពជាក់ស្តែងដែលអ្នកត្រូវតែយកទៅដាក់ក្នុងស្លាយនីមួយៗ (MANDATORY EXACT PHOTO URLS):
${exactSlideImagesText}
   - ក្នុងកូដ HTML នៃ Canvas Slide Deck គ្រប់ Tag <img> ត្រូវតែកំណត់ src តាមបញ្ជីខាងលើ៖
     <img src="[URL_តាមលេខស្លាយខាងលើ]" style="width: 100%; height: 320px; object-fit: cover; border-radius: 14px; box-shadow: 0 8px 24px rgba(0,0,0,0.12);" alt="Educational Photography">
   - ប្រសិនបើរៀបចំជា Markdown Outline ត្រូវសរសេរ៖
     ![រូបភាពអប់រំ]([URL_តាមលេខស្លាយខាងលើ])

២. ✍️ ទំហំ Font និងក្បួនរចនាអក្សរខ្មែរឱ្យធំស្អាតទាក់ទាញ (Typography Hierarchy & Large Font Sizes):
   - ប្រើប្រាស់ពុម្ពអក្សរខ្មែរស្រស់ស្អាតសមរម្យតាមបរិបទ (Kantumruy Pro, Moul Light សម្រាប់ចំណងជើង)។
   - ទំហំអក្សរត្រូវតែធំជាងមុន ច្បាស់ៗ និងងាយស្រួលមើលពីចម្ងាយក្នុងថ្នាក់រៀន (មិនត្រូវប្រើអក្សរតូចៗឡើយ)៖
     + ចំណងជើងធំនៃស្លាយ (Slide Title): ប្រើទំហំធំលេចធ្លោ (# ឬ ## / CSS 30px - 36px, អក្សរដិត Bold) ពណ៌ចម្បងទាក់ទាញ
     + ក្បាលកាត និងចំណុចសំខាន់ (Key Concept Cards): ប្រើទំហំធំល្មម (### / CSS 20px - 22px, អក្សរដិត Bold) ជាមួយរូបសញ្ញា Emoji/Icon ស៊ីគ្នា
     + ខ្លឹមសារពន្យល់ (Body Content): ប្រើទំហំអក្សរធំល្មមងាយអាន (CSS 16px - 18px, Line-height: 1.7) ដោយមានគម្លាតបន្ទាត់ស្រឡះល្អ មិនញាត់អក្សរតូចៗផ្តុំគ្នាឡើយ
     + ការណែនាំគ្រូ (Speaker Notes): ដាក់ក្នុងប្រអប់ដាច់ដោយឡែក (Quote Block > ឬ Notes Box) ទំហំ 14px - 15px

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 ទម្រង់គំរូនៃស្លាយនីមួយៗ (ស្លាយទី១ ដល់ ស្លាយទី ${numSlides})៖
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
---
## 🎬 ស្លាយទី [លេខស្លាយ]: [ចំណងជើងធំនៃស្លាយ - 28pt-36pt Bold]
![រូបភាពអប់រំ AI ស៊ីមេទ្រី](https://image.pollinations.ai/prompt/[English_Topic_Prompt]?width=1200&height=675&nologo=true)

### ❖ [ក្បាលចំណុចគន្លឹះទី១ - 18pt-22pt Bold]
[ការពន្យល់ស៊ីជម្រៅ ច្បាស់លាស់ ខ្លឹម ធំងាយអាន - 14pt-16pt]

### ❖ [ក្បាលចំណុចគន្លឹះទី២ - 18pt-22pt Bold]
[ការពន្យល់ស៊ីជម្រៅ ច្បាស់លាស់ ខ្លឹម ធំងាយអាន - 14pt-16pt]

### ❖ [ក្បាលចំណុចគន្លឹះទី៣ - 18pt-22pt Bold]
[ការពន្យល់ស៊ីជម្រៅ ច្បាស់លាស់ ខ្លឹម ធំងាយអាន - 14pt-16pt]

> 🗣️ **ការណែនាំសម្រាប់គ្រូបង្រៀន (Speaker Notes):**
> [ការណែនាំគរុកោសល្យ ២-៤ ឃ្លា របៀបពន្យល់សិស្ស និងសំណួរបំផុសគំនិតសួរសិស្សក្នុងថ្នាក់]
---

${sourceText ? `\n📚 ឯកសារយោងមេរៀនដើម (Source Document):\n` + sourceText.substring(0, 35000) + `\n` : ''}

សូមសរសេរខ្លឹមសារទាំងអស់ជាភាសាខ្មែរផ្លូវការ ១០០% ត្រឹមត្រូវតាមក្បួនវេយ្យាករណ៍ និងរៀបរៀងតាមលំដាប់លំដោយគរុកោសល្យ MoEYS យ៉ាងរស់រវើក!`;

  // 1. Close current PPTX setup modal
  closePptxModal();

  // 2. Put full prompt into textarea and update count
  const textarea = document.getElementById('geminiPromptTextarea');
  if (textarea) textarea.value = webPrompt;
  const countEl = document.getElementById('geminiPromptCharCount');
  if (countEl) countEl.textContent = `${webPrompt.length} តួអក្សរ`;

  // 3. Pop up the new preview modal
  openGeminiPromptModal();
};
window.copyGeminiSlidePrompt = window.generateGeminiSlidePrompt; // Backward compatibility

window.confirmCopyAndOpenGemini = async function() {
  const textarea = document.getElementById('geminiPromptTextarea');
  const promptText = textarea ? textarea.value : '';

  if (!promptText.trim()) {
    showToast('⚠️ មិនទាន់មានខ្លឹមសារ Prompt សម្រាប់ចម្លងឡើយ!', 'warning');
    return;
  }

  // 1. Close preview modal
  closeGeminiPromptModal();

  // 2. Copy to clipboard and open Gemini Web in new tab
  try {
    await navigator.clipboard.writeText(promptText);
    showToast('📋 បានកូពី Prompt រួចរាល់! កំពុងបើក Google Gemini ក្នុង New Tab... សូមចុច Ctrl+V (Paste)។', 'success', 8000);
    window.open('https://gemini.google.com', '_blank');
  } catch (err) {
    console.warn('Clipboard copy error:', err);
    window.prompt('សូមកូពី Prompt ខាងក្រោមនេះយកទៅ Paste ក្នុង gemini.google.com:', promptText);
    window.open('https://gemini.google.com', '_blank');
  }
};

function extractAndParseSlidesJson(text) {
  if (!text) return null;
  let clean = text.trim();
  clean = clean.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '').trim();
  
  // 1. Bracket array extraction [ ... ]
  const firstBracket = clean.indexOf('[');
  const lastBracket = clean.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    try {
      const arr = JSON.parse(clean.substring(firstBracket, lastBracket + 1));
      if (Array.isArray(arr) && arr.length > 0) return arr;
    } catch (e) {}
  }

  // 2. Direct JSON parse
  try {
    const res = JSON.parse(clean);
    if (Array.isArray(res) && res.length > 0) return res;
    if (res && Array.isArray(res.slides) && res.slides.length > 0) return res.slides;
  } catch (e) {}

  return null;
}

function synthesizeOfflineSlides(data, numSlides) {
  const slides = [];
  slides.push({
    type: 'title',
    title: data.lessonTitle || 'កិច្ចតែងការបង្រៀន',
    subtitle: `${data.subject || 'មុខវិជ្ជាទូទៅ'} - ${data.grade || 'ថ្នាក់ទូទៅ'}`,
    speakerNotes: `ស្វាគមន៍សិស្សានុសិស្សមកកាន់មេរៀន៖ ${data.lessonTitle || ''}`,
    imageSearchKeyword: 'education presentation'
  });
  
  slides.push({
    type: 'content',
    title: 'វត្ថុបំណងមេរៀន (Lesson Objectives)',
    bullets: [
      `ចំណេះដឹង៖ ${(data.objectives?.knowledge || ['ស្វែងយល់ខ្លឹមសារមេរៀនយ៉ាងស៊ីជម្រៅ']).slice(0, 2).join(' និង ')}`,
      `បំណិន៖ ${(data.objectives?.skills || ['អនុវត្តលំហាត់ជាក់ស្តែង និងដោះស្រាយបញ្ហា']).slice(0, 2).join(' និង ')}`,
      `ឥរិយាបថ៖ ${(data.objectives?.attitudes || ['ចូលរួមយ៉ាងសកម្ម និងមានស្មារតីសហការ']).slice(0, 2).join(' និង ')}`
    ],
    speakerNotes: 'សូមជម្រាបជូនសិស្សអំពីគោលបំណងចម្បងនៃមេរៀននេះដើម្បីកំណត់ទិសដៅសិក្សា។',
    imageSearchKeyword: 'classroom goals'
  });

  const steps = data.steps || data.stage3?.steps || [];
  if (steps.length > 0) {
    for (let i = 0; i < steps.length && slides.length < numSlides; i++) {
      const s = steps[i];
      const bullets = [];
      if (s.contentSummary) bullets.push(s.contentSummary);
      if (s.teacherActivity) bullets.push(`សកម្មភាពគ្រូ៖ ${s.teacherActivity}`);
      if (s.studentActivity) bullets.push(`សកម្មភាពសិស្ស៖ ${s.studentActivity}`);
      if (bullets.length === 0) bullets.push('ខ្លឹមសារ និងសកម្មភាពគន្លឹះក្នុងថ្នាក់រៀន');

      slides.push({
        type: 'content',
        title: s.stepTitle || `ផ្នែកទី ${i + 1}`,
        bullets: bullets.slice(0, 3),
        speakerNotes: `ណែនាំសិស្សអំពី ${s.stepTitle || 'ខ្លឹមសារមេរៀន'} និងសម្របសម្រួលសកម្មភាព។`,
        imageSearchKeyword: 'classroom teaching'
      });
    }
  }

  // If source document text exists, construct slides from it
  if (data.sourceDocumentText && slides.length < numSlides) {
    const paragraphs = data.sourceDocumentText
      .split(/\n\s*\n|\r\n\s*\r\n/)
      .map(p => p.trim())
      .filter(p => p.length > 30);
    for (let i = 0; i < paragraphs.length && slides.length < numSlides; i++) {
      slides.push({
        type: 'content',
        title: `ខ្លឹមសារគន្លឹះបន្ថែម (${i + 1})`,
        bullets: [
          paragraphs[i].substring(0, 160) + (paragraphs[i].length > 160 ? '...' : ''),
          'ការវិភាគ និងទាញសេចក្តីសន្និដ្ឋានលើខ្លឹមសារ'
        ],
        speakerNotes: 'ពន្យល់លម្អិតអំពីខ្លឹមសារក្នុងស្លាយនេះ។',
        imageSearchKeyword: 'study concept'
      });
    }
  }

  // Distinct rich pedagogical topics if user requested more slides
  const extraPedagogy = [
    {
      title: 'សំណួរគន្លឹះត្រិះរិះពិចារណា (Inquiry Questions)',
      bullets: [
        'តើមេរៀននេះមានសារៈសំខាន់យ៉ាងណាខ្លះចំពោះជីវិតប្រចាំថ្ងៃ?',
        'ការវិភាគ និងប្រៀបធៀបគំនិតសំខាន់ៗក្នុងមេរៀន',
        'ការលើកឡើងនូវឧទាហរណ៍ជាក់ស្តែងជុំវិញខ្លួន'
      ],
      speakerNotes: 'ជំរុញសិស្សឱ្យឆ្លើយ និងពិភាក្សាសំណួរគន្លឹះ។',
      imageSearchKeyword: 'critical thinking'
    },
    {
      title: 'សកម្មភាពការងារជាក្រុម និងការអនុវត្ត (Collaborative Work)',
      bullets: [
        'បែងចែកក្រុម និងប្រគល់ប្រធានបទពិភាក្សាជាក់លាក់',
        'សិស្សផ្លាស់ប្តូរយោបល់ និងកត់ត្រាលទ្ធផលពិភាក្សា',
        'តំណាងក្រុមឡើងធ្វើបទបង្ហាញពីលទ្ធផលការងារ'
      ],
      speakerNotes: 'ដើរសម្របសម្រួល និងជួយគាំទ្រសកម្មភាពក្រុម។',
      imageSearchKeyword: 'group collaboration'
    },
    {
      title: 'ការវាយតម្លៃលទ្ធផលសិក្សា (Formative Assessment)',
      bullets: [
        'សំណួរត្រួតពិនិត្យការយល់ដឹងរហ័ស (Quick Check)',
        'ការវាយតម្លៃខ្លួនឯង និងមិត្តភក្តិរួមថ្នាក់ (Peer Assessment)',
        'កម្រិតនៃការសម្រេចបាននូវវត្ថុបំណងមេរៀន'
      ],
      speakerNotes: 'វាយតម្លៃកម្រិតយល់ដឹងរបស់សិស្សម្នាក់ៗ។',
      imageSearchKeyword: 'formative evaluation'
    },
    {
      title: 'បំណិនសតវត្សរ៍ទី២១ និងការអនុវត្ត (21st Century Skills)',
      bullets: [
        'ការគិតពិចារណា និងការដោះស្រាយបញ្ហាជាក់ស្តែង',
        'បំណិនទំនាក់ទំនង និងកិច្ចសហការក្នុងថ្នាក់',
        'ភាពច្នៃប្រឌិត និងការស្វែងយល់ដោយស្វ័យប្រវត្ត'
      ],
      speakerNotes: 'បញ្ជាក់អំពីបំណិនជីវិតដែលទទួលបានពីមេរៀន។',
      imageSearchKeyword: 'skills development'
    },
    {
      title: 'កិច្ចការស្រាវជ្រាវ និងការរៀនបន្ត (Extension & Practice)',
      bullets: [
        'កិច្ចការស្វ័យសិក្សា និងស្រាវជ្រាវបន្ថែមនៅផ្ទះ',
        'ការអនុវត្តលំហាត់ពង្រឹងសមត្ថភាពក្នុងសៀវភៅ',
        'ការត្រៀមលក្ខណៈសម្រាប់មេរៀនបន្ទាប់'
      ],
      speakerNotes: 'ណែនាំកិច្ចការផ្ទះ និងការរៀនបន្ត។',
      imageSearchKeyword: 'homework research'
    }
  ];

  let pIdx = 0;
  while (slides.length < numSlides && pIdx < extraPedagogy.length) {
    slides.push(extraPedagogy[pIdx]);
    pIdx++;
  }

  return slides.slice(0, numSlides);
}

window.openPptxModal = function() {
  const m = document.getElementById('pptxModal');
  if (m) {
    m.style.display = 'flex';
    m.classList.add('active');
    updatePptxAttachmentOptions();
  }
};

window.closePptxModal = function() {
  const m = document.getElementById('pptxModal');
  if (m) {
    m.style.display = 'none';
    m.classList.remove('active');
  }
};

// ==========================================================================
// 🔔 Background PPTX Floating Widget & Web Audio Notification
// ==========================================================================

let pptxWidgetTimerInterval = null;
let pptxWidgetStartTime = null;

function playSuccessChime() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    
    // Note 1: E5 (659.25 Hz)
    const o1 = ctx.createOscillator();
    const g1 = ctx.createGain();
    o1.type = 'sine';
    o1.frequency.setValueAtTime(659.25, ctx.currentTime);
    g1.gain.setValueAtTime(0.18, ctx.currentTime);
    g1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    o1.connect(g1);
    g1.connect(ctx.destination);
    o1.start(ctx.currentTime);
    o1.stop(ctx.currentTime + 0.35);

    // Note 2: B5 (987.77 Hz)
    const o2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    o2.type = 'sine';
    o2.frequency.setValueAtTime(987.77, ctx.currentTime + 0.15);
    g2.gain.setValueAtTime(0.22, ctx.currentTime + 0.15);
    g2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7);
    o2.connect(g2);
    g2.connect(ctx.destination);
    o2.start(ctx.currentTime + 0.15);
    o2.stop(ctx.currentTime + 0.7);
  } catch (e) {
    // Audio context may be muted or blocked, fail silently
  }
}

function showPptxWidget(initialTitle = 'កំពុងបង្កើតស្លាយ PowerPoint...') {
  const el = document.getElementById('pptxBackgroundWidget');
  if (!el) return;
  el.style.display = 'block';
  
  const titleEl = document.getElementById('pptxWidgetTitle');
  if (titleEl) titleEl.textContent = initialTitle;
  
  const progressEl = document.getElementById('pptxWidgetProgressBar');
  if (progressEl) {
    progressEl.style.width = '10%';
    progressEl.style.background = 'linear-gradient(90deg, #e11d48, #f43f5e)';
  }
  
  const btnArea = document.getElementById('pptxWidgetActionBtnArea');
  if (btnArea) btnArea.innerHTML = '';

  const timerEl = document.getElementById('pptxWidgetTimer');
  if (timerEl) timerEl.textContent = '⏱️ 00:00';

  pptxWidgetStartTime = Date.now();
  if (pptxWidgetTimerInterval) clearInterval(pptxWidgetTimerInterval);
  pptxWidgetTimerInterval = setInterval(() => {
    const elapsedSec = Math.floor((Date.now() - pptxWidgetStartTime) / 1000);
    const m = Math.floor(elapsedSec / 60);
    const s = elapsedSec % 60;
    if (timerEl) {
      timerEl.textContent = `⏱️ ${m}:${s < 10 ? '0' : ''}${s}`;
    }
  }, 1000);
}

function updatePptxWidgetStatus(statusHtml, progressPct = null) {
  const statusEl = document.getElementById('pptxWidgetStatus');
  if (statusEl) statusEl.innerHTML = statusHtml;
  
  if (progressPct !== null) {
    const barEl = document.getElementById('pptxWidgetProgressBar');
    if (barEl) barEl.style.width = `${Math.min(100, Math.max(5, progressPct))}%`;
  }
}

function finishPptxWidgetSuccess(fileName) {
  if (pptxWidgetTimerInterval) clearInterval(pptxWidgetTimerInterval);
  const titleEl = document.getElementById('pptxWidgetTitle');
  if (titleEl) titleEl.innerHTML = '✅ បង្កើតស្លាយជោគជ័យ!';
  
  const barEl = document.getElementById('pptxWidgetProgressBar');
  if (barEl) {
    barEl.style.width = '100%';
    barEl.style.background = '#10b981';
  }

  const statusEl = document.getElementById('pptxWidgetStatus');
  if (statusEl) {
    statusEl.innerHTML = `<span style="color: #059669; font-weight: 600;"><i class="fa-solid fa-circle-check"></i> ឯកសារ <b>${escapeHtml(fileName)}</b> បានទាញយករួចរាល់!</span>`;
  }

  const btnArea = document.getElementById('pptxWidgetActionBtnArea');
  if (btnArea) {
    btnArea.innerHTML = `<button type="button" onclick="closePptxWidget()" style="background: #10b981; color: white; border: none; padding: 4px 10px; border-radius: 6px; font-size: 0.8rem; cursor: pointer; font-weight: 600;">យល់ព្រម</button>`;
  }

  // Restore title after 10s
  const prevTitle = document.title;
  document.title = '✅ [ស្លាយ PPTX រួចរាល់] ' + prevTitle.replace(/^\[.*?\]\s*/, '').replace(/^⏳\s*\(.*?\)\s*/, '');
  setTimeout(() => {
    document.title = prevTitle;
  }, 10000);

  // Play audio chime
  playSuccessChime();

  // Auto-dismiss widget after 25s if not closed
  setTimeout(() => {
    closePptxWidget();
  }, 25000);
}

function finishPptxWidgetError(errorMessage) {
  if (pptxWidgetTimerInterval) clearInterval(pptxWidgetTimerInterval);
  const titleEl = document.getElementById('pptxWidgetTitle');
  if (titleEl) titleEl.innerHTML = '⚠️ មិនទាន់អាចបង្កើតស្លាយ';

  const barEl = document.getElementById('pptxWidgetProgressBar');
  if (barEl) {
    barEl.style.background = '#f59e0b';
    barEl.style.width = '100%';
  }

  const statusEl = document.getElementById('pptxWidgetStatus');
  if (statusEl) {
    statusEl.innerHTML = `<span style="color: #d97706; font-size: 0.82rem;">${escapeHtml(errorMessage)}</span>`;
  }

  const btnArea = document.getElementById('pptxWidgetActionBtnArea');
  if (btnArea) {
    btnArea.innerHTML = `<button type="button" onclick="generatePptxSlides()" style="background: #e11d48; color: white; border: none; padding: 4px 10px; border-radius: 6px; font-size: 0.8rem; cursor: pointer; font-weight: 600;"><i class="fa-solid fa-rotate-right"></i> សាកម្តងទៀត</button>`;
  }
}

function closePptxWidget() {
  if (pptxWidgetTimerInterval) clearInterval(pptxWidgetTimerInterval);
  const el = document.getElementById('pptxBackgroundWidget');
  if (el) el.style.display = 'none';
}
window.closePptxWidget = closePptxWidget;

window.generatePptxSlides = async function() {
  if (state.isPptxGenerating) {
    showToast('⚠️ កំពុងមានដំណើរការបង្កើតស្លាយមួយរួចហើយ សូមរង់ចាំបន្តិច...', 'warning');
    return;
  }

  const sourceChoice = document.getElementById('pptxSourceSelect')?.value || 'current_plan';
  let data = null;
  let sourceDocText = '';
  let sourceDocTitle = '';

  if (sourceChoice === 'custom_file' && state.pptxCustomSource) {
    sourceDocText = state.pptxCustomSource.content;
    sourceDocTitle = state.pptxCustomSource.fileName.replace(/\.[^/.]+$/, "");
    data = {
      lessonTitle: sourceDocTitle,
      subject: (document.getElementById('subjectSelect')?.value || 'ទូទៅ').trim(),
      grade: (document.getElementById('gradeSelect')?.value || 'ទូទៅ').trim(),
      sourceDocumentText: sourceDocText,
      isDocumentBased: true
    };
  } else if (sourceChoice === 'uploaded_lesson_file' && state.lessonContent) {
    sourceDocText = state.lessonContent;
    sourceDocTitle = state.lessonFileName ? state.lessonFileName.replace(/\.[^/.]+$/, "") : '';
    data = {
      lessonTitle: sourceDocTitle || 'ឯកសារមេរៀន',
      subject: (document.getElementById('subjectSelect')?.value || 'ទូទៅ').trim(),
      grade: (document.getElementById('gradeSelect')?.value || 'ទូទៅ').trim(),
      sourceDocumentText: sourceDocText,
      isDocumentBased: true
    };
  } else if (sourceChoice === 'history_plan') {
    try {
      const history = JSON.parse(localStorage.getItem('alps_plan_history') || '[]');
      if (history.length > 0 && history[0].planData) {
        data = history[0].planData;
        sourceDocTitle = history[0].title;
      }
    } catch (e) {}
  } else {
    data = state.generatedPlanData || state.currentPlan;
  }

  if (!data && !sourceDocText) {
    const title = (document.getElementById('lessonTitleInput')?.value || '').trim();
    const subject = (document.getElementById('subjectSelect')?.value || '').trim();
    const grade = (document.getElementById('gradeSelect')?.value || '').trim();
    if (title || subject) {
      data = {
        lessonTitle: title || 'មេរៀនសង្ខេប',
        subject: subject || 'ចំណេះដឹងទូទៅ',
        grade: grade || 'ថ្នាក់ទូទៅ',
        objectives: { knowledge: ['ស្វែងយល់ខ្លឹមសារ'], skills: ['អនុវត្តលំហាត់'], attitudes: ['ការចូលរួម'] },
        steps: [
          { stepTitle: 'ជំហានទី១: រដ្ឋបាលថ្នាក់', contentSummary: 'ពិនិត្យអវត្តមាន និងវិន័យ' },
          { stepTitle: 'ជំហានទី២: រំលឹកមេរៀនចាស់', contentSummary: 'សំណួរចម្លើយលើមេរៀនមុន' },
          { stepTitle: 'ជំហានទី៣: មេរៀនថ្មី', contentSummary: title || 'ខ្លឹមសារមេរៀនចម្បង' },
          { stepTitle: 'ជំហានទី៤: ពង្រឹងចំណេះដឹង', contentSummary: 'លំហាត់អនុវត្ត និងសំណួរត្រួតពិនិត្យ' },
          { stepTitle: 'ជំហានទី៥: បណ្តាំផ្ញើ', contentSummary: 'កិច្ចការផ្ទះ និងការស្រាវជ្រាវបន្ថែម' }
        ]
      };
      state.currentPlan = data;
    } else {
      const alertEl = document.getElementById('pptxSourceAlert');
      const alertText = document.getElementById('pptxSourceAlertText');
      const alertIcon = document.getElementById('pptxSourceAlertIcon');
      if (alertEl) {
        alertEl.style.display = 'block';
        alertEl.style.background = '#fef2f2';
        alertEl.style.borderColor = '#fca5a5';
        alertEl.style.color = '#991b1b';
        if (alertIcon) {
          alertIcon.className = 'fa-solid fa-circle-exclamation';
          alertIcon.style.color = '#ef4444';
        }
        if (alertText) {
          alertText.innerHTML = '<b>❌ មិនអាចបង្កើតស្លាយបានទេ៖ មិនទាន់មានកិច្ចតែងការបង្រៀននៅឡើយ!</b><br>សូមចុចប៊ូតុង <a href="javascript:void(0)" onclick="triggerPptxSourceUpload()" style="color: #e11d48; font-weight: 700; text-decoration: underline;">«បង្ហោះឯកសារថ្មី»</a> ដើម្បីជ្រើសឯកសារ Word/PDF មេរៀន ឬត្រឡប់ទៅបង្កើតកិច្ចតែងការជាមុនសិន។';
        }
        try { alertEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (_) {}
      }
      showToast('⚠️ សូមបញ្ចូលចំណងជើងមេរៀន បង្កើតកិច្ចតែងការ ឬបង្ហោះឯកសារយោងជាមុនសិន!', 'warning', 6000);
      return;
    }
  }

  if (!data) {
    data = {
      lessonTitle: sourceDocTitle || 'ឯកសារមេរៀន',
      subject: (document.getElementById('subjectSelect')?.value || 'ទូទៅ').trim(),
      grade: (document.getElementById('gradeSelect')?.value || 'ទូទៅ').trim(),
      objectives: { knowledge: ['ស្វែងយល់ខ្លឹមសារឯកសារ'], skills: ['អនុវត្តតាមឯកសារ'], attitudes: ['ការយល់ដឹង'] }
    };
  }

  if (sourceDocText) {
    data.sourceDocumentText = sourceDocText;
    if (sourceDocTitle) {
      data.lessonTitle = sourceDocTitle;
    }
  }

  const numSlides = parseInt(document.getElementById('pptxNumSlides')?.value || '8');
  const imageMode = document.getElementById('pptxIncludeImages')?.value || 'ai';
  const theme = document.getElementById('pptxTheme')?.value || 'modern_blue';
  
  closePptxModal();
  state.isPptxGenerating = true;

  // 🚀 Start Floating Background Task (Does NOT lock teacher's screen!)
  showPptxWidget(`🎬 កំពុងបង្កើត ${numSlides} ស្លាយ PowerPoint...`);
  updatePptxWidgetStatus('🧠 Gemini AI កំពុងវិភាគឯកសារ និងរៀបចំខ្លឹមសារស្លាយកម្រិតខ្ពស់... (រហូតដល់ ៥ នាទី)', 12);
  showToast('🚀 កំពុងដំណើរការបង្កើតស្លាយនៅផ្ទៃខាងក្រោយ... លោកគ្រូអាចបន្តធ្វើការងារផ្សេងៗបានដោយសេរី!', 'info', 7000);

  const originalDocTitle = document.title;
  document.title = `⏳ (កំពុងបង្កើត ${numSlides} ស្លាយ...) ` + originalDocTitle.replace(/^\[.*?\]\s*/, '').replace(/^⏳\s*\(.*?\)\s*/, '');

  try {
    let slidesData = null;
    let lastError = null;
    const apiKey = (state.geminiApiKey || getActiveGeminiApiKey() || '').trim();
    const activeProvider = state.aiProvider || (apiKey.startsWith('gsk_') ? 'groq' : 'gemini');

    if (!apiKey) {
      finishPptxWidgetError('មិនទាន់បានភ្ជាប់ Gemini API Key');
      if (typeof openAiErrorModal === 'function') openAiErrorModal('NO_KEY');
      return;
    }

    const prompt = `You are an expert Cambodian MoEYS instructional designer, curriculum specialist, and master modern presentation visual designer.
Convert the following Cambodian educational material into an engaging, state-of-the-art, visually striking PowerPoint presentation outline.
Number of slides requested (including Title slide): ${numSlides}

STRICT CRITICAL RULES:
1. Output MUST be ONLY a raw valid JSON array of objects. Do NOT include markdown code blocks (\`\`\`json) or any conversational text. Output ONLY the raw JSON array.
2. Language: All titles, subtitles, bullet points, cards, and speaker notes MUST be in 100% natural, grammatically rich, formal educational Khmer. "imagePrompt" and "imageSearchKeyword" MUST be in English.
3. HIGH-QUALITY DIVERSE EDUCATIONAL CARDS (Pedagogical Excellence):
   - Thoroughly synthesize the material and logically distribute key topics across all ${numSlides} slides.
   - Slide 1: "type": "title" (Main lesson title, subject/grade subtitle, introductory teacher notes).
   - Subsequent slides: "type": "content". Each slide must present a clear, focused subtopic with 3 to 4 bite-sized, high-impact key concept points or cards.
   - For every card/bullet point, use meaningful and contextual bold headings tailored specifically to that topic (for example, subject definitions, formulas, theories, historical events, classroom experiments, or discussion questions).
   - DO NOT repeat the exact same placeholder headings across slides! Never use robotic 01-04 numbers unless describing real chronological steps.
   - Keep concepts punchy, memorable, and visually structured.
4. DETAILED SPEAKER NOTES:
   - Provide 2 to 4 sentences of rich teaching advice in Khmer per slide, explaining what the teacher should elaborate, questions to ask students, and activities.
5. AI IMAGE PROMPT ("imagePrompt"):
   - For EACH slide, provide a dedicated, highly descriptive English visual prompt for an educational illustration (e.g. "Warm educational digital illustration of Cambodian classroom, teacher and active students discussing concept, modern flat vector, soft lighting, high quality").

JSON Schema:
[
  {
    "type": "title",
    "title": "ចំណងជើងមេរៀនជាភាសាខ្មែរ",
    "subtitle": "មុខវិជ្ជា - កម្រិតថ្នាក់",
    "speakerNotes": "ការណែនាំផ្តើមមេរៀនសម្រាប់គ្រូបង្រៀន",
    "imageSearchKeyword": "educational psychology",
    "imagePrompt": "Educational title slide illustration, modern classroom with teacher and students, warm lighting, high quality"
  },
  {
    "type": "content",
    "title": "ចំណងជើងរងនៃស្លាយ (Short Impactful Title)",
    "bullets": [
      "**ទ្រឹស្តីសិក្សា៖** ការពន្យល់ពីគោលគំនិតចម្បងដោយខ្លីខ្លឹម និងច្បាស់លាស់",
      "**ការអនុវត្តជាក់ស្តែង៖** ឧទាហរណ៍ជាក់ស្តែងនៅក្នុងថ្នាក់រៀន",
      "**សំណួរបំផុសគំនិត៖** សំណួរជំរុញសិស្សឱ្យគិតពិចារណាស៊ីជម្រៅ"
    ],
    "speakerNotes": "ការណែនាំលម្អិតសម្រាប់គ្រូ៖ របៀបពន្យល់សិស្ស សំណួរបំផុសគំនិត និងការដឹកនាំសកម្មភាពក្នុងស្លាយនេះ",
    "imageSearchKeyword": "learning concept",
    "imagePrompt": "Educational digital illustration depicting this slide concept, modern classroom, clean, warm palette"
  }
]

Lesson & Source Details:
ចំណងជើង: ${data.lessonTitle}
មុខវិជ្ជា: ${data.subject}
កម្រិតថ្នាក់: ${data.grade}
${data.sourceDocumentText ? `\nAttached Reference Document (${data.sourceDocumentText.length} characters):\n${data.sourceDocumentText.substring(0, 35000)}\n` : ''}
${data.objectives?.knowledge ? `\nវត្ថុបំណង:\n- ចំណេះដឹង: ${data.objectives.knowledge.join(', ')}\n- បំណិន: ${data.objectives.skills?.join(', ') || ''}\n- ឥរិយាបថ: ${data.objectives.attitudes?.join(', ') || ''}` : ''}
${data.steps ? `\nTeaching Steps:\n${data.steps.map(s => s.stepTitle + ': ' + s.contentSummary).join('\n')}` : ''}
`;

    // ⚡ Case A: Groq Provider (if configured)
    if (activeProvider === 'groq' && apiKey.startsWith('gsk_')) {
      try {
        updatePptxWidgetStatus('⚡ Groq AI កំពុងបង្កើតស្លាយយ៉ាងរហ័ស (Llama 3.3 70B)...', 25);
        const groqResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
              { role: 'system', content: 'You are an expert Cambodian MoEYS educational presenter. Always respond strictly in valid raw JSON array format.' },
              { role: 'user', content: prompt }
            ],
            temperature: 0.2,
            max_tokens: 4096
          })
        });
        if (groqResp.ok) {
          const resJson = await groqResp.json();
          const content = resJson.choices?.[0]?.message?.content;
          if (content) {
            const parsed = extractAndParseSlidesJson(content);
            if (parsed && Array.isArray(parsed) && parsed.length > 0) slidesData = parsed;
          }
        }
      } catch (ge) {
        lastError = ge;
      }
    }

    // 🧠 Case B: Google Gemini AI (Dynamic discovery, up to 5 minutes timeout, 3 retries with backoff)
    if (!slidesData) {
      let candidateModels = [];
      if (typeof discoverGeminiModels === 'function') {
        try {
          const disc = await discoverGeminiModels(apiKey);
          if (disc && disc.length > 0) {
            disc.sort((a, b) => {
              const sc = (m) => {
                const n = (m.name || '').toLowerCase();
                if (n.includes('2.5-pro')) return 110;
                if (n.includes('3.8-flash')) return 105;
                if (n.includes('3.6-flash')) return 100;
                if (n.includes('3.5-flash-lite')) return 95;
                if (n.includes('2.5-flash-lite')) return 90;
                if (n.includes('flash-latest')) return 85;
                if (n.includes('pro-latest')) return 80;
                if (n.includes('2.0-flash')) return 75;
                if (n.includes('flash')) return 70;
                return 50;
              };
              return sc(b) - sc(a);
            });
            candidateModels = disc;
          }
        } catch (de) {}
      }

      if (candidateModels.length === 0) {
        candidateModels = [
          { ver: 'v1beta', name: 'gemini-2.5-pro' },
          { ver: 'v1beta', name: 'gemini-3.8-flash' },
          { ver: 'v1beta', name: 'gemini-3.6-flash' },
          { ver: 'v1beta', name: 'gemini-3.5-flash-lite' },
          { ver: 'v1beta', name: 'gemini-2.5-flash-lite' },
          { ver: 'v1beta', name: 'gemini-2.0-flash' }
        ];
      }

      const MAX_ATTEMPTS = 3;
      for (let attempt = 0; attempt < MAX_ATTEMPTS && !slidesData; attempt++) {
        if (attempt > 0) {
          const waitSec = attempt * 3;
          updatePptxWidgetStatus(
            `🔄 Gemini AI កំពុងព្យាយាមម្តងទៀត (ជុំទី ${attempt + 1}/${MAX_ATTEMPTS})... រង់ចាំ ${waitSec} វិនាទី (Server Backoff)`,
            20 + attempt * 5
          );
          await new Promise(r => setTimeout(r, waitSec * 1000));
        }

        for (const item of candidateModels) {
          try {
            updatePptxWidgetStatus(
              `🧠 Gemini AI (${item.name}) កំពុងវិភាគ និងបង្កើតខ្លឹមសារស្លាយ... (អនុញ្ញាតពេលរហូតដល់ ៥ នាទី)`,
              30 + attempt * 5
            );

            const controller = new AbortController();
            // Generous 5 MINUTES (300,000ms) timeout allowance so Gemini AI has full uninterrupted time
            const timeoutMs = 300000;
            const timer = setTimeout(() => controller.abort(), timeoutMs);

            const resp = await fetch(`https://generativelanguage.googleapis.com/${item.ver}/models/${item.name}:generateContent?key=${apiKey}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              signal: controller.signal,
              body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: {
                  temperature: 0.65,
                  response_mime_type: 'application/json'
                }
              })
            });
            clearTimeout(timer);

            if (resp.ok) {
              const result = await resp.json();
              const textResponse = result.candidates?.[0]?.content?.parts?.[0]?.text;
              if (textResponse) {
                const parsed = extractAndParseSlidesJson(textResponse);
                if (parsed && Array.isArray(parsed) && parsed.length > 0) {
                  slidesData = parsed;
                  break; // Success! Break out of model loop
                }
              }
            } else {
              const errBody = await resp.json().catch(() => ({}));
              const msg = errBody.error?.message || `HTTP ${resp.status}`;
              lastError = new Error(`${item.name}: ${msg}`);
              console.warn(`[PPTX Gemini] Model ${item.name} error:`, msg);
            }
          } catch (e) {
            lastError = e;
            console.warn(`[PPTX Gemini] Request error on ${item.name}:`, e);
          }
        }
      }
    }

    // STRICT USER REQUIREMENT:
    // If Gemini still failed after all retries, DO NOT output repetitive dummy slides!
    // Instead, inform the user honestly with instructions to try again.
    if (!slidesData || !Array.isArray(slidesData) || slidesData.length === 0) {
      const errStr = lastError ? (lastError.message || String(lastError)) : '';
      const isQuota = /429|quota|resource_exhausted|too many requests/i.test(errStr);
      const isBusy = /503|overloaded|unavailable|busy/i.test(errStr);
      const isTimeout = /timeout|timed out|abort/i.test(errStr);

      let alertMessage = '⚠️ Google Gemini AI កំពុងរវល់ខ្លាំង (Server Busy / 429 Rate Limit)។ សូមមេត្តារង់ចាំប្រមាណ ២០ ទៅ ៣០ វិនាទី រួចចុច «បង្កើតស្លាយឥឡូវនេះ» ម្ដងទៀត!';
      if (isTimeout) {
        alertMessage = '⚠️ ការបង្កើតស្លាយលើសរយៈពេលកំណត់ (Timeout 5 នាទី)។ សូមពិនិត្យអ៊ីនធឺណិត រួចចុចបង្កើតម្ដងទៀត!';
      } else if (isBusy) {
        alertMessage = '⚠️ ម៉ាស៊ីនបម្រើ Google Gemini កំពុងផ្ទុកទិន្នន័យច្រើន (503 Server Unavailable)។ សូមរង់ចាំបន្តិច រួចព្យាយាមម្ដងទៀត!';
      }

      finishPptxWidgetError(alertMessage);
      showToast(alertMessage, 'warning', 9000);
      if (typeof openAiErrorModal === 'function') {
        openAiErrorModal(lastError || new Error(alertMessage));
      }
      return; // Exit cleanly without creating fake/repetitive dummy presentation!
    }

    updatePptxWidgetStatus(`🎬 កំពុងផ្គុំឯកសារ PPTX & រូបភាព AI... (រៀបចំ ${slidesData.length} ស្លាយ)`, 55);

    if (typeof PptxGenJS === 'undefined') {
      throw new Error('បណ្ណាល័យ PPTXGenJS មិនទាន់ដំណើរការ។ សូមពិនិត្យការតភ្ជាប់អ៊ីនធឺណិត!');
    }

    let pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_16x9';

    // Theme definitions with curated 3-color palette & modern card styling
    let bg = 'F8FAFC', titleColor = '0F172A', bodyColor = '334155', accentPrimary = '2563EB', accentSecondary = 'D97706', cardBg = 'FFFFFF', cardBorder = 'E2E8F0';
    if (theme === 'modern_blue') {
      bg = 'F8FAFC'; titleColor = '1E3A8A'; bodyColor = '334155'; accentPrimary = '2563EB'; accentSecondary = 'D97706'; cardBg = 'FFFFFF'; cardBorder = 'E2E8F0';
    } else if (theme === 'eco_green') {
      bg = 'F0FDF4'; titleColor = '14532D'; bodyColor = '1E293B'; accentPrimary = '059669'; accentSecondary = 'D97706'; cardBg = 'FFFFFF'; cardBorder = 'DCFCE7';
    } else if (theme === 'dark_mode') {
      bg = '0F172A'; titleColor = 'F8FAFC'; bodyColor = 'CBD5E1'; accentPrimary = '38BDF8'; accentSecondary = 'F59E0B'; cardBg = '1E293B'; cardBorder = '334155';
    } else if (theme === 'simple_light') {
      bg = 'FFFFFF'; titleColor = '1E293B'; bodyColor = '475569'; accentPrimary = '4F46E5'; accentSecondary = 'EA580C'; cardBg = 'F8FAFC'; cardBorder = 'E2E8F0';
    }

    pptx.defineSlideMaster({
      title: 'MASTER_SLIDE',
      background: { color: bg },
      slideNumber: { x: 0.3, y: '92%', color: bodyColor, fontSize: 10, fontFace: 'Kantumruy Pro' }
    });

    // Dynamic icon bullet pool for conceptual cards (no robotic 01-04 on every slide!)
    const bulletIcons = ['✦', '◆', '●', '★', '►', '❖'];

    // Helper: Parse bullet into { isNumbered, badge, heading, desc }
    const parseCardContent = (bulletStr, itemIdx) => {
      let str = String(bulletStr || '').trim();
      let heading = '';
      let desc = '';
      let badge = '';
      let isNumbered = false;

      // 1. Extract bold lead-in: **Heading:** Body
      const boldMatch = str.match(/^\*\*(.*?)\*\*(.*)/);
      if (boldMatch) {
        heading = boldMatch[1].trim();
        desc = boldMatch[2].trim().replace(/^[:：\-–\s]+/, '');
      } else {
        const colonParts = str.split(/[:：]/);
        if (colonParts.length > 1) {
          heading = colonParts[0].trim();
          desc = colonParts.slice(1).join('៖').trim();
        } else {
          heading = str.substring(0, 36);
          desc = str.length > 36 ? str.substring(36).trim() : '';
        }
      }

      // 2. Clean trailing colons from heading to avoid double colons "៖ ៖"
      heading = heading.replace(/[:：\s]+$/, '').trim();

      // 3. Detect if bullet explicitly mentions a step, stage, or number
      const stepMatch = heading.match(/^(?:ជំហានទី|ដំណាក់កាលទី|ចំណុចទី|គន្លឹះទី)?\s*([០-៩\d]{1,2})[\.\s\:\)៖\-]*/);
      if (stepMatch && (heading.includes('ជំហាន') || heading.includes('ដំណាក់កាល') || heading.includes('ចំណុចទី'))) {
        isNumbered = true;
        badge = stepMatch[1];
        heading = heading.replace(stepMatch[0], '').trim();
      } else {
        // Conceptual card: Use dynamic aesthetic symbol icon
        isNumbered = false;
        badge = bulletIcons[itemIdx % bulletIcons.length];
      }

      return { isNumbered, badge, heading, desc };
    };

    // 🚀 High-Speed Sequential Image Fetching (Instant 100ms per slide, completely avoids rate-limits!)
    let slideImages = [];
    if (imageMode !== 'no') {
      updatePptxWidgetStatus(`🎨 កំពុងរៀបចំរូបភាពអប់រំគុណភាពខ្ពស់ស្របតាមខ្លឹមសារស្លាយទាំង ${slidesData.length}...`, 60);
      for (let sIdx = 0; sIdx < slidesData.length; sIdx++) {
        const img = await getSlideImage(slidesData[sIdx], data, imageMode, theme, sIdx + 1);
        slideImages.push(img);
      }
    }

    for (let idx = 0; idx < slidesData.length; idx++) {
      const slideDef = slidesData[idx];
      let slide = pptx.addSlide({ masterName: 'MASTER_SLIDE' });
      if (slideDef.speakerNotes) slide.addNotes(slideDef.speakerNotes);

      const slideProgress = 65 + Math.round(((idx + 1) / slidesData.length) * 30);
      updatePptxWidgetStatus(
        `🎬 កំពុងរៀបចំស្លាយទី ${idx + 1}/${slidesData.length}: <b>${escapeHtml((slideDef.title || 'ខ្លឹមសារ').substring(0, 35))}</b>`,
        slideProgress
      );

      const picObj = slideImages[idx] || null;

      if (slideDef.type === 'title') {
        // Title Slide: Clean hero layout with Kantumruy Pro font and contrasting multi-color typography
        if (picObj && picObj.data) {
          slide.addImage({ x: 0, y: 0, w: 10, h: 5.625, data: picObj.data, sizing: { type: 'cover', w: 10, h: 5.625 } });
          slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 5.625, fill: { color: '0A0F1D', transparency: 45 } });
          slide.addText(slideDef.title, { x: 0.8, y: 1.6, w: 8.4, h: 1.8, fontSize: 32, bold: true, color: 'FFFFFF', align: 'center', fontFace: 'Kantumruy Pro' });
          slide.addText(slideDef.subtitle || '', { x: 1, y: 3.5, w: 8, h: 0.9, fontSize: 18, color: 'FDBA74', align: 'center', fontFace: 'Kantumruy Pro', bold: true });
        } else {
          slide.addShape(pptx.ShapeType.roundRect, { x: 0.8, y: 0.8, w: 8.4, h: 4.0, rectRadius: 0.2, fill: { color: cardBg }, line: { color: cardBorder, width: 2 } });
          slide.addText(slideDef.title, { x: 1.0, y: 1.5, w: 8.0, h: 1.6, fontSize: 32, bold: true, color: titleColor, align: 'center', fontFace: 'Kantumruy Pro' });
          slide.addText(slideDef.subtitle || '', { x: 1.2, y: 3.2, w: 7.6, h: 0.9, fontSize: 18, color: accentSecondary, align: 'center', fontFace: 'Kantumruy Pro', bold: true });
        }
      } else {
        // Content Slide: Modern Card / Pill Concept Layout (Like Gemini Canvas)
        // 1. Header Topic Title (fontSize 22 >= 12, Kantumruy Pro, Primary Color)
        slide.addText(slideDef.title || 'ខ្លឹមសារមេរៀន', {
          x: 0.6,
          y: 0.35,
          w: 8.8,
          h: 0.8,
          fontSize: 22,
          bold: true,
          color: titleColor,
          fontFace: 'Kantumruy Pro'
        });

        const rawBullets = Array.isArray(slideDef.bullets) ? slideDef.bullets : [String(slideDef.bullets || '')];
        const parsedItems = rawBullets.slice(0, 5).map((b, i) => parseCardContent(b, i));

        if (picObj && picObj.data) {
          // Half layout: Left side cards (w: 4.8), Right side image (w: 4.0, h: 3.8)
          const totalCards = Math.max(1, parsedItems.length);
          const availH = 3.9;
          const cardH = Math.min(1.15, Math.max(0.68, (availH - (totalCards - 1) * 0.12) / totalCards));
          const cardGap = 0.12;
          const startY = 1.25;

          parsedItems.forEach((item, cIdx) => {
            const cardY = startY + cIdx * (cardH + cardGap);

            // Background card shape (soft pill with rounded corners)
            slide.addShape(pptx.ShapeType.roundRect, {
              x: 0.6,
              y: cardY,
              w: 4.8,
              h: cardH,
              rectRadius: 0.12,
              fill: { color: cardBg },
              line: { color: cardBorder, width: 1.5 }
            });

            // Accent Pill / Icon (Amber/Orange accent, dynamic icon or step number)
            slide.addText(item.badge, {
              x: 0.72,
              y: cardY + 0.05,
              w: 0.55,
              h: cardH - 0.1,
              fontSize: item.isNumbered ? 15 : 16,
              bold: true,
              color: accentSecondary, // Color 1: Warm Amber / Orange (#D97706)
              align: 'center',
              valign: 'middle',
              fontFace: 'Kantumruy Pro'
            });

            // Card Text: Color 2 (Heading: Bold Primary) + Color 3 (Description: Slate/Muted)
            // Strictly font size >= 12! (Heading 13pt bold, Desc 12pt)
            let textRuns = [];
            if (item.heading) {
              textRuns.push({
                text: item.heading + (item.desc ? ' ៖ ' : ''),
                options: {
                  fontSize: 13,
                  bold: true,
                  color: accentPrimary, // Color 2: Bold Indigo / Royal Blue (#2563EB)
                  fontFace: 'Kantumruy Pro'
                }
              });
            }
            if (item.desc) {
              textRuns.push({
                text: item.desc,
                options: {
                  fontSize: 12, // User requirement: Font size 12 and larger!
                  color: bodyColor, // Color 3: Slate Body (#334155)
                  fontFace: 'Kantumruy Pro'
                }
              });
            }

            slide.addText(textRuns, {
              x: 1.32,
              y: cardY + 0.04,
              w: 3.95,
              h: cardH - 0.08,
              align: 'left',
              valign: 'middle',
              paraSpaceAfter: 0
            });
          });

          // Right side: AI Educational Image with rounded border frame
          slide.addImage({
            x: 5.65,
            y: 1.25,
            w: 3.95,
            h: 3.9,
            data: picObj.data,
            sizing: { type: 'cover', w: 3.95, h: 3.9 }
          });
          slide.addShape(pptx.ShapeType.roundRect, {
            x: 5.65,
            y: 1.25,
            w: 3.95,
            h: 3.9,
            rectRadius: 0.15,
            fill: { type: 'none' },
            line: { color: cardBorder, width: 2 }
          });
        } else {
          // Full-width cards (e.g. 2x2 grid or horizontal cards across 8.8 width)
          const totalCards = Math.max(1, parsedItems.length);
          if (totalCards === 4) {
            // 2x2 Grid Layout
            const colW = 4.25;
            const rowH = 1.8;
            const colGap = 0.3;
            const rowGap = 0.25;
            parsedItems.forEach((item, cIdx) => {
              const col = cIdx % 2;
              const row = Math.floor(cIdx / 2);
              const cardX = 0.6 + col * (colW + colGap);
              const cardY = 1.3 + row * (rowH + rowGap);

              slide.addShape(pptx.ShapeType.roundRect, {
                x: cardX,
                y: cardY,
                w: colW,
                h: rowH,
                rectRadius: 0.15,
                fill: { color: cardBg },
                line: { color: cardBorder, width: 1.5 }
              });

              slide.addText(item.badge, {
                x: cardX + 0.15,
                y: cardY + 0.15,
                w: 0.6,
                h: 0.4,
                fontSize: item.isNumbered ? 16 : 18,
                bold: true,
                color: accentSecondary,
                align: 'center',
                fontFace: 'Kantumruy Pro'
              });

              let gridRuns = [
                {
                  text: item.heading + '\n',
                  options: { fontSize: 15, bold: true, color: accentPrimary, fontFace: 'Kantumruy Pro' }
                }
              ];
              if (item.desc) {
                gridRuns.push({
                  text: item.desc,
                  options: { fontSize: 13, color: bodyColor, fontFace: 'Kantumruy Pro' }
                });
              }

              slide.addText(gridRuns, {
                x: cardX + 0.2,
                y: cardY + 0.55,
                w: colW - 0.4,
                h: rowH - 0.65,
                align: 'left',
                valign: 'top'
              });
            });
          } else {
            // Horizontal stacked wide cards
            const availH = 3.9;
            const cardH = Math.min(1.2, Math.max(0.72, (availH - (totalCards - 1) * 0.14) / totalCards));
            const cardGap = 0.14;
            const startY = 1.25;

            parsedItems.forEach((item, cIdx) => {
              const cardY = startY + cIdx * (cardH + cardGap);
              slide.addShape(pptx.ShapeType.roundRect, {
                x: 0.6,
                y: cardY,
                w: 8.8,
                h: cardH,
                rectRadius: 0.12,
                fill: { color: cardBg },
                line: { color: cardBorder, width: 1.5 }
              });

              slide.addText(item.badge, {
                x: 0.8,
                y: cardY + 0.05,
                w: 0.6,
                h: cardH - 0.1,
                fontSize: item.isNumbered ? 15 : 18,
                bold: true,
                color: accentSecondary,
                align: 'center',
                valign: 'middle',
                fontFace: 'Kantumruy Pro'
              });

              let fullRuns = [];
              if (item.heading) {
                fullRuns.push({
                  text: item.heading + (item.desc ? ' ៖ ' : ''),
                  options: { fontSize: 14, bold: true, color: accentPrimary, fontFace: 'Kantumruy Pro' }
                });
              }
              if (item.desc) {
                fullRuns.push({
                  text: item.desc,
                  options: { fontSize: 13, color: bodyColor, fontFace: 'Kantumruy Pro' }
                });
              }

              slide.addText(fullRuns, {
                x: 1.5,
                y: cardY + 0.05,
                w: 7.7,
                h: cardH - 0.1,
                align: 'left',
                valign: 'middle'
              });
            });
          }
        }
      }
    }

    updatePptxWidgetStatus('📦 កំពុងបង្កើត និងទាញយកឯកសារ .pptx ទៅកាន់កុំព្យូទ័រ...', 98);

    // Clean lesson title to avoid double extension .docx.pptx and illegal filename characters
    let cleanTitle = (data.lessonTitle || 'Lesson')
      .replace(/\.(docx|pdf|pptx|txt|doc)$/gi, '')
      .replace(/[\\/:*?"<>|]/g, '_')
      .trim();
    const fileName = `PPT_${cleanTitle || 'Lesson'}.pptx`;
    await pptx.writeFile({ fileName: fileName });
    
    finishPptxWidgetSuccess(fileName);
    showToast(`✅ បានទាញយកស្លាយ ${fileName} ជោគជ័យ!`, 'success', 10000);

  } catch (error) {
    console.error('PPTX error:', error);
    finishPptxWidgetError('បរាជ័យ: ' + error.message);
    showToast('❌ បរាជ័យក្នុងការបង្កើតស្លាយ: ' + error.message, 'error');
  } finally {
    state.isPptxGenerating = false;
    document.title = originalDocTitle;
  }
};
// ==========================================================================
// 🎮 AC Kahoot Game Integration
// ==========================================================================
window.onGameIframeLoaded = function() {
  const spinner = document.getElementById('gameLoadingSpinner');
  if (spinner) spinner.style.display = 'none';

  // Automatically move away / fade out the notice banner when render.com server is awake & loaded!
  const notice = document.getElementById('gameRenderNotice');
  if (notice) {
    notice.style.transition = 'all 0.5s ease';
    notice.style.opacity = '0';
    notice.style.maxHeight = '0';
    notice.style.padding = '0';
    notice.style.overflow = 'hidden';
    notice.style.border = 'none';
    setTimeout(() => {
      notice.style.display = 'none';
    }, 500);
  }
};

window.dismissGameNotice = function() {
  const notice = document.getElementById('gameRenderNotice');
  if (notice) notice.style.display = 'none';
};

window.toggleGameFullscreen = function() {
  const card = document.getElementById('gameModalCard');
  const icon = document.getElementById('iconGameFullscreen');
  const text = document.getElementById('textGameFullscreen');
  if (!card) return;

  const isFull = card.classList.toggle('game-modal-full');
  if (isFull) {
    card.style.maxWidth = '100vw';
    card.style.width = '100vw';
    card.style.height = '100vh';
    card.style.maxHeight = '100vh';
    card.style.borderRadius = '0';
    if (icon) icon.className = 'fa-solid fa-compress';
    if (text) text.textContent = 'បង្រួម';
  } else {
    card.style.maxWidth = '98vw';
    card.style.width = '98vw';
    card.style.height = '96vh';
    card.style.maxHeight = '96vh';
    card.style.borderRadius = '14px';
    if (icon) icon.className = 'fa-solid fa-expand';
    if (text) text.textContent = 'ពេញអេក្រង់';
  }
};

window.openGameModal = function() {
  window.open('https://ac-kahoot.onrender.com', '_blank');
};

window.closeGameModal = function() {
  const m = document.getElementById('gameModal');
  if (m) m.style.display = 'none';
};


