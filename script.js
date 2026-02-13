// =========================================================
// PODCAST SITE + ADMIN DASHBOARD (V2)
// - Site público + Painel admin
// - Login modal (admin / pub031103)
// - CRUD: adicionar, excluir, EDITAR
// - Upload de imagem (guest photo / episode thumbnail) em Base64
// - Busca + filtro + ordenação
// - Gráficos em Canvas (sem libs)
// - Persistência: LocalStorage
// =========================================================

/** ⚠️ IMPORTANTE
 * Como é um site estático (sem servidor), o login é só uma trava simples.
 * Para segurança real, depois colocamos backend.
 */

// ----------- AUTH -----------
const AUTH = { user: "admin", pass: "pub031103" };
const SESSION_KEY = "podcast_session_ok";

// ----------- STORAGE -----------
const DB_KEY = "podcast_dashboard_db_v2";
const DB_BACKUP_KEY = "podcast_dashboard_db_backup_v2";
const DB_BACKUP_LIST_KEY = "podcast_dashboard_db_backup_list_v2";
const DB_VERSION = 3;
const MAX_BACKUPS = 5;
const CLOUD_COLLECTION = "podcast_dashboard";
const CLOUD_DOC_ID = "main";

const defaultDB = {
  brand: {
    name: "Seu Podcast",
    tagline: "Conversas reais, sem filtro.",
    social: {
      instagram: "",
      youtube: "",
      spotify: "",
      email: "",
      whatsapp: ""
    }
  },
  transacoes: [],
  convidados: [],
  episodios: []
};

function loadDB() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return structuredClone(defaultDB);
    const parsed = JSON.parse(raw);
    const data = parsed?.data ? parsed.data : parsed;
    return normalizeDBData(data);
  } catch (e) {
    return structuredClone(defaultDB);
  }
}

function normalizeDBData(source) {
  const parsed = source || {};
  const brand = parsed.brand || defaultDB.brand;
  const social = brand.social || defaultDB.brand.social;

  return {
    brand: {
      name: String(brand.name || defaultDB.brand.name),
      tagline: String(brand.tagline || defaultDB.brand.tagline),
      social: {
        instagram: String(social.instagram || ""),
        youtube: String(social.youtube || ""),
        spotify: String(social.spotify || ""),
        email: String(social.email || ""),
        whatsapp: String(social.whatsapp || "")
      }
    },
    transacoes: Array.isArray(parsed.transacoes) ? parsed.transacoes : [],
    convidados: Array.isArray(parsed.convidados) ? parsed.convidados : [],
    episodios: Array.isArray(parsed.episodios) ? parsed.episodios : []
  };
}

function getFirebaseConfig() {
  const cfg = window.__FIREBASE_CONFIG || null;
  if (!cfg) return null;
  const required = ["apiKey", "authDomain", "projectId", "appId"];
  const hasAll = required.every((k) => String(cfg[k] || "").trim().length > 0);
  if (!hasAll) return null;
  const asText = JSON.stringify(cfg).toLowerCase();
  if (asText.includes("sua_api_key") || asText.includes("seu_projeto") || asText.includes("seu_app_id")) {
    return null;
  }
  return cfg;
}

function createPayload(data, label = "auto") {
  return {
    version: DB_VERSION,
    label,
    savedAt: new Date().toISOString(),
    data: normalizeDBData(data)
  };
}

function setBackupFromRaw(raw, label = "auto") {
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    const data = parsed?.data ? parsed.data : parsed;
    const payload = createPayload(data, label);
    localStorage.setItem(DB_BACKUP_KEY, JSON.stringify(payload));
    pushBackupPayload(payload);
  } catch {
    // Ignore malformed backup source.
  }
}

function getBackupList() {
  try {
    const raw = localStorage.getItem(DB_BACKUP_LIST_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x) => x && x.data && x.savedAt);
  } catch {
    return [];
  }
}

function saveBackupList(list) {
  localStorage.setItem(DB_BACKUP_LIST_KEY, JSON.stringify(list.slice(0, MAX_BACKUPS)));
}

function pushBackupPayload(payload) {
  if (!payload?.data || !payload?.savedAt) return;
  try {
    const list = getBackupList();
    const key = `${payload.savedAt}_${payload.label || ""}`;
    const deduped = list.filter((x) => `${x.savedAt}_${x.label || ""}` !== key);
    deduped.unshift(payload);
    saveBackupList(deduped);
  } catch {
    // Keep primary save flow alive even if backup history write fails.
  }
}

function getBackupPayload() {
  const list = getBackupList();
  if (list.length > 0) return list[0];
  try {
    const raw = localStorage.getItem(DB_BACKUP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.data) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveDBLocalOnly(db, options = {}) {
  const label = options.label || "auto";
  const payload = createPayload(db, label);
  try {
    const previousRaw = localStorage.getItem(DB_KEY);
    localStorage.setItem(DB_KEY, JSON.stringify(payload));

    // Keep the previous valid state as a quick rollback backup.
    if (previousRaw && !options.skipBackup) setBackupFromRaw(previousRaw, `before_${label}`);
    else {
      localStorage.setItem(DB_BACKUP_KEY, JSON.stringify(payload));
      pushBackupPayload(payload);
    }
    return true;
  } catch (err) {
    if (err && (err.name === "QuotaExceededError" || err.code === 22)) {
      toast("Sem espaço no navegador para salvar. Exporte backup e limpe dados antigos.", "err");
    } else {
      toast("Falha ao salvar os dados no navegador.", "err");
    }
    return false;
  }
}

function saveDB(db, options = {}) {
  const ok = saveDBLocalOnly(db, options);
  if (ok) scheduleCloudSave(db, options.label || "auto");
  return ok;
}

let db = loadDB();
let cloudSyncInfo = document.getElementById("cloudSyncInfo");

const cloudState = {
  enabled: false,
  firestore: null,
  docRef: null,
  saveTimer: null,
  pending: null
};

function setCloudStatus(text) {
  ensureCloudStatusElement();
  if (cloudSyncInfo) cloudSyncInfo.textContent = text;
}

function ensureCloudStatusElement() {
  if (cloudSyncInfo) return cloudSyncInfo;
  const backupInfoEl = document.getElementById("backupInfo");
  if (!backupInfoEl || !backupInfoEl.parentElement) return null;
  const p = document.createElement("p");
  p.id = "cloudSyncInfo";
  p.className = "small muted";
  p.textContent = "Nuvem: inicializando...";
  backupInfoEl.insertAdjacentElement("afterend", p);
  cloudSyncInfo = p;
  return cloudSyncInfo;
}

async function initCloudSync() {
  try {
    const cfg = getFirebaseConfig();
    if (!cfg || !window.firebase) {
      setCloudStatus("Nuvem: não configurada.");
      return false;
    }

    if (!firebase.apps?.length) firebase.initializeApp(cfg);
    cloudState.firestore = firebase.firestore();
    cloudState.docRef = cloudState.firestore.collection(CLOUD_COLLECTION).doc(CLOUD_DOC_ID);
    cloudState.enabled = true;
    setCloudStatus("Nuvem: conectando...");

    const snap = await cloudState.docRef.get();
    if (!snap.exists) {
      await pushDBToCloud(db, "bootstrap_cloud");
      setCloudStatus("Nuvem: ativa (primeiro sync concluído).");
      return true;
    }

    const cloudPayload = snap.data() || {};
    if (cloudPayload?.data) {
      db = normalizeDBData(cloudPayload.data);
      saveDBLocalOnly(db, { label: "cloud_pull", skipBackup: false });
    }

    setCloudStatus("Nuvem: ativa e sincronizada.");
    return true;
  } catch (err) {
    setCloudStatus("Nuvem: erro de conexão (modo local ativo).");
    return false;
  }
}

async function pushDBToCloud(data, label = "auto") {
  if (!cloudState.enabled || !cloudState.docRef) return;
  const payload = createPayload(data, label);
  payload.updatedBy = "web_client";
  await cloudState.docRef.set(payload, { merge: true });
}

function scheduleCloudSave(data, label = "auto") {
  if (!cloudState.enabled) return;
  cloudState.pending = { data: normalizeDBData(data), label };
  clearTimeout(cloudState.saveTimer);
  cloudState.saveTimer = setTimeout(async () => {
    if (!cloudState.pending) return;
    const job = cloudState.pending;
    cloudState.pending = null;
    try {
      await pushDBToCloud(job.data, job.label);
      setCloudStatus("Nuvem: sincronizada.");
    } catch {
      setCloudStatus("Nuvem: erro no sync (dados locais preservados).");
    }
  }, 900);
}

// ----------- HELPERS -----------
const brl = (n) =>
  (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function uid(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function setSubtitle(text) {
  const el = document.getElementById("subtitle");
  if (el) el.textContent = text;
}

function safeText(s) {
  return String(s ?? "").replace(/[<>]/g, "");
}

function isValidUrl(value) {
  try {
    const u = new URL(String(value));
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function normalizeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (isValidUrl(raw)) return raw;
  if (raw.startsWith("www.")) return `https://${raw}`;
  return raw;
}

function formatDateBR(iso) {
  const raw = String(iso || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw || "—";
  const [y, m, d] = raw.split("-");
  return `${d}/${m}/${y}`;
}

function getEmbeddableLink(url) {
  const raw = String(url || "").trim();
  if (!isValidUrl(raw)) return "";

  // youtube.com/watch?v=... | youtu.be/... -> youtube embed
  const ytWatch = raw.match(/[?&]v=([^&]+)/);
  if (raw.includes("youtube.com/watch") && ytWatch?.[1]) {
    return `https://www.youtube.com/embed/${ytWatch[1]}`;
  }
  const ytShort = raw.match(/youtu\.be\/([^?&/]+)/);
  if (ytShort?.[1]) {
    return `https://www.youtube.com/embed/${ytShort[1]}`;
  }
  return "";
}

function toast(msg, type="ok"){
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.className = "toast " + type;
  t.classList.remove("hidden");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => {
    t.classList.add("hidden");
  }, 2200);
}

// ----------- CONFIRM MODAL -----------
const confirmModal = document.getElementById("confirmModal");
const confirmMessage = document.getElementById("confirmMessage");
const confirmDetail = document.getElementById("confirmDetail");
const confirmOkBtn = document.getElementById("confirmOkBtn");
const confirmCancelBtn = document.getElementById("confirmCancelBtn");
let confirmResolver = null;

function closeConfirmModal(result = false) {
  if (confirmModal) confirmModal.classList.add("hidden");
  if (confirmResolver) {
    confirmResolver(result);
    confirmResolver = null;
  }
}

function confirmAction(message, detail = "Essa ação pode alterar seus dados.") {
  if (!confirmModal || !confirmMessage || !confirmDetail || !confirmOkBtn || !confirmCancelBtn) {
    return Promise.resolve(window.confirm(message));
  }

  confirmMessage.textContent = message;
  confirmDetail.textContent = detail;
  confirmModal.classList.remove("hidden");

  return new Promise((resolve) => {
    confirmResolver = resolve;
  });
}

confirmOkBtn?.addEventListener("click", () => closeConfirmModal(true));
confirmCancelBtn?.addEventListener("click", () => closeConfirmModal(false));
confirmModal?.addEventListener("click", (e) => {
  if (e.target === confirmModal) closeConfirmModal(false);
});


function byDateStr(a, b) {
  return String(a).localeCompare(String(b));
}

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function monthKey(isoDate) {
  // "2026-02-11" -> "2026-02"
  return String(isoDate || "").slice(0, 7);
}

async function fileToBase64(file, maxWidth = 900) {
  // Compress image a bit to keep LocalStorage lighter
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();

    reader.onload = () => {
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const w = Math.floor(img.width * scale);
        const h = Math.floor(img.height * scale);

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);

        // jpeg smaller
        const out = canvas.toDataURL("image/jpeg", 0.82);
        resolve(out);
      };
      img.onerror = reject;
      img.src = reader.result;
    };

    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ----------- VIEWS -----------
const publicView = document.getElementById("publicView");
const appView = document.getElementById("appView");

// Modal
const loginModal = document.getElementById("loginModal");
const openLoginBtn = document.getElementById("openLoginBtn");
const closeLoginBtn = document.getElementById("closeLoginBtn");
const ctaAdmin = document.getElementById("ctaAdmin");

function showModal() { loginModal.classList.remove("hidden"); }
function hideModal() { loginModal.classList.add("hidden"); }

openLoginBtn?.addEventListener("click", showModal);
ctaAdmin?.addEventListener("click", showModal);
closeLoginBtn?.addEventListener("click", hideModal);
loginModal?.addEventListener("click", (e) => {
  if (e.target === loginModal) hideModal();
});

function showPublic() {
  publicView.classList.remove("hidden");
  appView.classList.add("hidden");
}

function showAdmin() {
  publicView.classList.add("hidden");
  appView.classList.remove("hidden");
}

function isLogged() {
  return sessionStorage.getItem(SESSION_KEY) === "1";
}

function setLogged(v) {
  if (v) sessionStorage.setItem(SESSION_KEY, "1");
  else sessionStorage.removeItem(SESSION_KEY);
}

// ----------- LOGIN -----------
const loginForm = document.getElementById("loginForm");
const loginMsg = document.getElementById("loginMsg");
const togglePass = document.getElementById("togglePass");

togglePass?.addEventListener("click", () => {
  const pass = document.getElementById("loginPass");
  if (!pass) return;
  pass.type = pass.type === "password" ? "text" : "password";
});

loginForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  const u = document.getElementById("loginUser")?.value?.trim();
  const p = document.getElementById("loginPass")?.value?.trim();

  loginMsg.className = "msg";

  if (u === AUTH.user && p === AUTH.pass) {
    setLogged(true);
    loginMsg.textContent = "Login OK! Abrindo painel...";
    loginMsg.classList.add("ok");
    setTimeout(() => {
      hideModal();
      showAdmin();
      initAdmin();
    }, 350);
  } else {
    loginMsg.textContent = "Usuário ou senha incorretos.";
    loginMsg.classList.add("error");
  }
});

// ----------- NAV -----------
const navItems = Array.from(document.querySelectorAll(".nav-item"));
const tabs = {
  overview: document.getElementById("tab-overview"),
  finance: document.getElementById("tab-finance"),
  guests: document.getElementById("tab-guests"),
  episodes: document.getElementById("tab-episodes"),
  charts: document.getElementById("tab-charts"),
  reports: document.getElementById("tab-reports"),
  settings: document.getElementById("tab-settings")
};

function openTab(name) {
  navItems.forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  Object.entries(tabs).forEach(([key, el]) => {
    if (!el) return;
    el.classList.toggle("hidden", key !== name);
  });

  const mapTitle = {
    overview: "Visão geral",
    finance: "Financeiro",
    guests: "Convidados",
    episodes: "Episódios",
    charts: "Gráficos",
    reports: "Relatórios",
    settings: "Configurações"
  };
  setSubtitle(mapTitle[name] || "Painel");

  if (name === "charts") renderCharts();
}

navItems.forEach((b) => {
  b.addEventListener("click", () => openTab(b.dataset.tab));
});

// ----------- LOGOUT -----------
document.getElementById("logoutBtn")?.addEventListener("click", () => {
  setLogged(false);
  showPublic();
});

// ----------- EXPORT / IMPORT / WIPE -----------
document.getElementById("exportBtn")?.addEventListener("click", () => {
  const payload = {
    ...createPayload(db, "manual_export"),
    exportedAt: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "backup_podcast_dashboard_v3.json";
  a.click();
  URL.revokeObjectURL(a.href);
});

const importBtn = document.getElementById("importBtn");
const importFile = document.getElementById("importFile");
const restoreBackupBtn = document.getElementById("restoreBackupBtn");
const clearBackupHistoryBtn = document.getElementById("clearBackupHistoryBtn");
const backupInfo = document.getElementById("backupInfo");
const backupHistory = document.getElementById("backupHistory");

importBtn?.addEventListener("click", () => importFile?.click());

importFile?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const json = JSON.parse(text);
    const sourceData = json?.data ? json.data : json;
    if (!sourceData || typeof sourceData !== "object") throw new Error("Formato inválido");

    db = normalizeDBData(sourceData);
    saveDB(db, { label: "import" });
    refreshAll();
    toast("Importado com sucesso!", "ok");
  } catch (err) {
    toast("Erro ao importar (arquivo inválido).", "err");
  } finally {
    importFile.value = "";
  }
});

restoreBackupBtn?.addEventListener("click", async () => {
  const backup = getBackupPayload();
  if (!backup?.data) {
    toast("Nenhum backup local disponível para restaurar.", "warn");
    return;
  }

  const ok = await confirmAction(
    "Restaurar último backup local?",
    "Os dados atuais serão substituídos pelos dados do backup."
  );
  if (!ok) return;

  db = normalizeDBData(backup.data);
  saveDB(db, { label: "restore_backup" });
  refreshAll();
  toast("Backup restaurado com sucesso!", "ok");
});

clearBackupHistoryBtn?.addEventListener("click", async () => {
  const list = getBackupList();
  if (list.length === 0) {
    toast("Histórico de backups já está vazio.", "warn");
    return;
  }
  const ok = await confirmAction(
    "Limpar histórico de backups locais?",
    "Você manterá apenas o estado atual salvo."
  );
  if (!ok) return;

  const payload = createPayload(db, "snapshot_after_clear");
  localStorage.setItem(DB_BACKUP_KEY, JSON.stringify(payload));
  saveBackupList([payload]);
  updateBackupInfo();
  toast("Histórico de backups limpo.", "ok");
});

backupHistory?.addEventListener("click", async (ev) => {
  const target = ev.target;
  if (!(target instanceof HTMLElement)) return;
  const btn = target.closest("[data-backup-idx]");
  if (!btn) return;

  const idx = Number(btn.getAttribute("data-backup-idx"));
  if (!Number.isInteger(idx)) return;
  const list = getBackupList();
  const item = list[idx];
  if (!item?.data) return;

  const ok = await confirmAction(
    "Restaurar este backup?",
    "Os dados atuais serão substituídos pelo backup selecionado."
  );
  if (!ok) return;

  db = normalizeDBData(item.data);
  saveDB(db, { label: `restore_history_${idx}` });
  refreshAll();
  toast("Backup restaurado do histórico!", "ok");
});

document.getElementById("wipeAllBtn")?.addEventListener("click", async () => {
  const ok = await confirmAction(
    "Tem certeza? Isso vai apagar convidados, episódios e transações.",
    "Essa ação é irreversível."
  );
  if (!ok) return;
  db = structuredClone(defaultDB);
  saveDB(db);
  refreshAll();
  toast("Tudo apagado.", "warn");
});

// =========================================================
// ADMIN: FINANCE (CRUD + EDIT)
// =========================================================
const financeForm = document.getElementById("financeForm");
const financeList = document.getElementById("financeList");
const lastTransactions = document.getElementById("lastTransactions");

document.getElementById("clearFinanceBtn")?.addEventListener("click", async () => {
  const ok = await confirmAction(
    "Apagar TODAS as transações?",
    "Você perderá o histórico financeiro salvo."
  );
  if (!ok) return;
  db.transacoes = [];
  saveDB(db);
  refreshAll();
});

financeForm?.addEventListener("submit", (e) => {
  e.preventDefault();

  const tipo = document.getElementById("fTipo").value;
  const valor = Number(document.getElementById("fValor").value);
  const categoria = document.getElementById("fCategoria").value.trim();
  const data = document.getElementById("fData").value;
  const obs = document.getElementById("fObs").value.trim();

  if (!tipo || categoria.length < 2 || !data || !(valor > 0)) {
    toast("Preencha categoria, data e valor válidos.", "warn");
    return;
  }

  db.transacoes.unshift({
    id: uid("t"),
    tipo,
    valor,
    categoria,
    data,
    obs,
    createdAt: Date.now()
  });

  saveDB(db);
  financeForm.reset();
  setTodayDefaults();
  refreshAll();
});

// =========================================================
// ADMIN: GUESTS (CRUD + EDIT + PHOTO)
// =========================================================
const guestForm = document.getElementById("guestForm");
const guestsList = document.getElementById("guestsList");
const guestSearch = document.getElementById("guestSearch");
const guestFilter = document.getElementById("guestFilter");
const guestSort = document.getElementById("guestSort");

document.getElementById("clearGuestsBtn")?.addEventListener("click", async () => {
  const ok = await confirmAction(
    "Apagar TODOS os convidados?",
    "Todos os convidados cadastrados serão removidos."
  );
  if (!ok) return;
  db.convidados = [];
  saveDB(db);
  refreshAll();
});

guestForm?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const nome = document.getElementById("gNome").value.trim();
  const insta = document.getElementById("gInsta").value.trim();
  const bio = document.getElementById("gBio").value.trim();
  const contato = document.getElementById("gContato").value.trim();
  const status = document.getElementById("gStatus").value;
  const fotoFile = document.getElementById("gFoto").files?.[0];

  if (nome.length < 2 || bio.length < 8) {
    toast("Informe nome e uma bio um pouco mais completa.", "warn");
    return;
  }

  if (insta && !insta.startsWith("@") && !isValidUrl(normalizeUrl(insta))) {
    toast("Instagram inválido. Use @usuario ou URL completa.", "warn");
    return;
  }

  let foto = "";
  if (fotoFile) {
    try { foto = await fileToBase64(fotoFile, 700); } catch {}
  }

  db.convidados.unshift({
    id: uid("g"),
    nome,
    insta,
    bio,
    contato,
    status,
    foto,
    createdAt: Date.now()
  });

  saveDB(db);
  guestForm.reset();
  refreshAll();
});

guestSearch?.addEventListener("input", () => renderGuests());
guestFilter?.addEventListener("change", () => renderGuests());
guestSort?.addEventListener("change", () => renderGuests());

// =========================================================
// ADMIN: EPISODES (CRUD + EDIT + THUMB)
// =========================================================
const episodeForm = document.getElementById("episodeForm");
const episodesList = document.getElementById("episodesList");
const episodeSearch = document.getElementById("episodeSearch");
const episodeFilter = document.getElementById("episodeFilter");
const episodeSort = document.getElementById("episodeSort");

document.getElementById("clearEpisodesBtn")?.addEventListener("click", async () => {
  const ok = await confirmAction(
    "Apagar TODOS os episódios?",
    "A lista de episódios será apagada."
  );
  if (!ok) return;
  db.episodios = [];
  saveDB(db);
  refreshAll();
});

episodeForm?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const titulo = document.getElementById("eTitulo").value.trim();
  const convidado = document.getElementById("eConvidado").value.trim();
  const data = document.getElementById("eData").value;
  const status = document.getElementById("eStatus").value;
  const link = document.getElementById("eLink").value.trim();
  const obs = document.getElementById("eObs").value.trim();
  const thumbFile = document.getElementById("eThumb").files?.[0];

  if (titulo.length < 4 || !data) {
    toast("Informe título e data válidos para o episódio.", "warn");
    return;
  }

  const linkNorm = normalizeUrl(link);
  if (linkNorm && !isValidUrl(linkNorm)) {
    toast("O link do episódio precisa ser uma URL válida.", "warn");
    return;
  }

  let thumb = "";
  if (thumbFile) {
    try { thumb = await fileToBase64(thumbFile, 900); } catch {}
  }

  db.episodios.unshift({
    id: uid("e"),
    titulo,
    convidado,
    data,
    status,
    link: linkNorm,
    obs,
    thumb,
    createdAt: Date.now()
  });

  saveDB(db);
  episodeForm.reset();
  setTodayDefaults();
  refreshAll();
});

episodeSearch?.addEventListener("input", () => renderEpisodes());
episodeFilter?.addEventListener("change", () => renderEpisodes());
episodeSort?.addEventListener("change", () => renderEpisodes());

// =========================================================
// SETTINGS (BRAND + SOCIAL)
// =========================================================
const sName = document.getElementById("sName");
const sTagline = document.getElementById("sTagline");
const sInstagram = document.getElementById("sInstagram");
const sYoutube = document.getElementById("sYoutube");
const sSpotify = document.getElementById("sSpotify");
const sEmail = document.getElementById("sEmail");
const sWhats = document.getElementById("sWhats");

document.getElementById("saveBrandBtn")?.addEventListener("click", () => {
  db.brand.name = sName.value.trim() || defaultDB.brand.name;
  db.brand.tagline = sTagline.value.trim() || defaultDB.brand.tagline;
  saveDB(db);
  refreshAll();
  toast("Dados do podcast salvos!", "ok");
});

document.getElementById("saveSocialBtn")?.addEventListener("click", () => {
  const instagram = normalizeUrl(sInstagram.value);
  const youtube = normalizeUrl(sYoutube.value);
  const spotify = normalizeUrl(sSpotify.value);
  const email = sEmail.value.trim();

  if (instagram && !isValidUrl(instagram)) {
    toast("Instagram inválido. Use URL completa.", "warn");
    return;
  }
  if (youtube && !isValidUrl(youtube)) {
    toast("YouTube inválido. Use URL completa.", "warn");
    return;
  }
  if (spotify && !isValidUrl(spotify)) {
    toast("Spotify inválido. Use URL completa.", "warn");
    return;
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    toast("Email inválido.", "warn");
    return;
  }

  db.brand.social.instagram = instagram;
  db.brand.social.youtube = youtube;
  db.brand.social.spotify = spotify;
  db.brand.social.email = email;
  db.brand.social.whatsapp = sWhats.value.trim();
  saveDB(db);
  refreshAll();
  toast("Redes e contato salvos!", "ok");
});

// =========================================================
// RENDER (ADMIN)
// =========================================================
function calcFinance() {
  let entradas = 0;
  let saidas = 0;

  db.transacoes.forEach((t) => {
    if (t.tipo === "entrada") entradas += Number(t.valor) || 0;
    else saidas += Number(t.valor) || 0;
  });

  return { entradas, saidas, saldo: entradas - saidas };
}

function renderOverview() {
  const { entradas, saidas, saldo } = calcFinance();

  document.getElementById("statSaldo").textContent = brl(saldo);
  document.getElementById("statEntradas").textContent = brl(entradas);
  document.getElementById("statSaidas").textContent = brl(saidas);
  document.getElementById("statEpisodios").textContent = String(db.episodios.length);

  // last transactions
  const last = db.transacoes.slice(0, 6);
  lastTransactions.innerHTML = "";
  if (last.length === 0) {
    lastTransactions.innerHTML = emptyRow("Sem transações", "Adicione uma entrada ou saída para aparecer aqui.", "ok");
  } else {
    last.forEach((t) => lastTransactions.appendChild(renderTransactionRow(t, true)));
  }

  // next episodes (ordenar por data)
  const eps = [...db.episodios]
    .sort((a, b) => byDateStr(a.data, b.data))
    .slice(0, 6);

  const nextEpisodes = document.getElementById("nextEpisodes");
  nextEpisodes.innerHTML = "";
  if (eps.length === 0) {
    nextEpisodes.innerHTML = emptyRow("Sem episódios", "Cadastre episódios para aparecer aqui.", "info");
  } else {
    eps.forEach((e) => nextEpisodes.appendChild(renderEpisodeRow(e, true)));
  }
}

function renderFinance() {
  const { entradas, saidas, saldo } = calcFinance();

  document.getElementById("sumEntradas").textContent = brl(entradas);
  document.getElementById("sumSaidas").textContent = brl(saidas);
  document.getElementById("sumSaldo").textContent = brl(saldo);

  financeList.innerHTML = "";

  if (db.transacoes.length === 0) {
    financeList.innerHTML = emptyRow("Nenhuma transação", "Adicione entradas e saídas para controlar o dinheiro.", "novo");
    return;
  }

  db.transacoes.forEach((t) => financeList.appendChild(renderTransactionRow(t, false)));
}

function renderGuests() {
  const q = (guestSearch?.value || "").toLowerCase().trim();
  const f = guestFilter?.value || "todos";
  const sort = guestSort?.value || "recent";

  let filtered = db.convidados.filter((g) => {
    const matchText =
      g.nome.toLowerCase().includes(q) ||
      (g.insta || "").toLowerCase().includes(q) ||
      (g.bio || "").toLowerCase().includes(q);

    const matchStatus = f === "todos" ? true : g.status === f;
    return matchText && matchStatus;
  });

  if (sort === "name") {
    filtered = filtered.sort((a, b) => a.nome.localeCompare(b.nome));
  } else {
    filtered = filtered.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  guestsList.innerHTML = "";

  if (filtered.length === 0) {
    guestsList.innerHTML = emptyRow("Nenhum convidado", "Tente outro filtro ou cadastre novos.", "vazio");
    return;
  }

  filtered.forEach((g) => guestsList.appendChild(renderGuestRow(g)));
}

function renderEpisodes() {
  const q = (episodeSearch?.value || "").toLowerCase().trim();
  const f = episodeFilter?.value || "todos";
  const sort = episodeSort?.value || "dateDesc";

  let filtered = db.episodios.filter((e) => {
    const matchText =
      e.titulo.toLowerCase().includes(q) ||
      (e.convidado || "").toLowerCase().includes(q) ||
      (e.obs || "").toLowerCase().includes(q);

    const matchStatus = f === "todos" ? true : e.status === f;
    return matchText && matchStatus;
  });

  if (sort === "dateAsc") filtered = filtered.sort((a, b) => byDateStr(a.data, b.data));
  if (sort === "dateDesc") filtered = filtered.sort((a, b) => byDateStr(b.data, a.data));
  if (sort === "title") filtered = filtered.sort((a, b) => a.titulo.localeCompare(b.titulo));

  episodesList.innerHTML = "";

  if (filtered.length === 0) {
    episodesList.innerHTML = emptyRow("Nenhum episódio", "Tente outro filtro ou cadastre novos.", "vazio");
    return;
  }

  filtered.forEach((e) => episodesList.appendChild(renderEpisodeRow(e, false)));
}

function emptyRow(title, meta, badgeText) {
  return `<div class="row"><div><div class="title">${safeText(title)}</div><div class="meta">${safeText(meta)}</div></div><span class="badge orange">${safeText(badgeText)}</span></div>`;
}

// =========================================================
// ROW BUILDERS (ADMIN) + EDIT
// =========================================================
function renderTransactionRow(t, compact) {
  const row = document.createElement("div");
  row.className = "row";

  const tipoLabel = t.tipo === "entrada" ? "Entrada" : "Saída";
  const badgeClass = t.tipo === "entrada" ? "ok" : "warn";

  const left = document.createElement("div");
  left.innerHTML = `
    <div class="title">${safeText(tipoLabel)} • ${safeText(t.categoria)}</div>
    <div class="meta">${safeText(t.data)} ${t.obs ? "• " + safeText(t.obs) : ""}</div>
  `;

  const right = document.createElement("div");
  right.style.display = "grid";
  right.style.justifyItems = "end";
  right.style.gap = "8px";

  const badge = document.createElement("span");
  badge.className = `badge ${badgeClass}`;
  badge.textContent = brl(t.valor);
  right.appendChild(badge);

  if (!compact) {
    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "10px";

    const edit = document.createElement("button");
    edit.className = "btn ghost smallbtn";
    edit.textContent = "Editar";
    edit.addEventListener("click", () => editTransaction(t.id));

    const del = document.createElement("button");
    del.className = "btn danger smallbtn";
    del.textContent = "Excluir";
    del.addEventListener("click", async () => {
      const ok = await confirmAction(
        "Excluir esta transação?",
        "Essa transação será removida permanentemente."
      );
      if (!ok) return;
      db.transacoes = db.transacoes.filter((x) => x.id !== t.id);
      saveDB(db);
      refreshAll();
    });

    actions.appendChild(edit);
    actions.appendChild(del);
    right.appendChild(actions);
  }

  row.appendChild(left);
  row.appendChild(right);
  return row;
}

function editTransaction(id) {
  openEditModal("transacao", id);
}

function renderGuestRow(g) {
  const row = document.createElement("div");
  row.className = "row";

  const statusMap = {
    confirmado: ["Confirmado", "ok"],
    pendente: ["Pendente", "warn"],
    recusou: ["Recusou", "info"]
  };

  const [statusLabel, badgeClass] = statusMap[g.status] || ["Status", "orange"];

  const left = document.createElement("div");
  const photo = g.foto ? `<img src="${g.foto}" style="width:44px;height:44px;border-radius:16px;object-fit:cover;border:1px solid rgba(255,255,255,0.10);margin-right:10px;">` : "";
  left.innerHTML = `
    <div style="display:flex; align-items:center; gap:10px;">
      ${photo}
      <div>
        <div class="title">${safeText(g.nome)}</div>
        <div class="meta">${safeText(g.bio)}</div>
        <div class="meta">${g.insta ? safeText(g.insta) : ""} ${g.contato ? "• " + safeText(g.contato) : ""}</div>
      </div>
    </div>
  `;

  const right = document.createElement("div");
  right.style.display = "grid";
  right.style.justifyItems = "end";
  right.style.gap = "8px";

  const badge = document.createElement("span");
  badge.className = `badge ${badgeClass}`;
  badge.textContent = statusLabel;

  const actions = document.createElement("div");
  actions.style.display = "flex";
  actions.style.gap = "10px";

  const edit = document.createElement("button");
  edit.className = "btn ghost smallbtn";
  edit.textContent = "Editar";
  edit.addEventListener("click", () => editGuest(g.id));

  const del = document.createElement("button");
  del.className = "btn danger smallbtn";
  del.textContent = "Excluir";
  del.addEventListener("click", async () => {
    const ok = await confirmAction(
      "Excluir este convidado?",
      "Os dados deste convidado serão removidos."
    );
    if (!ok) return;
    db.convidados = db.convidados.filter((x) => x.id !== g.id);
    saveDB(db);
    refreshAll();
  });

  actions.appendChild(edit);
  actions.appendChild(del);

  right.appendChild(badge);
  right.appendChild(actions);

  row.appendChild(left);
  row.appendChild(right);
  return row;
}

function editGuest(id) {
  openEditModal("convidado", id);
}

function renderEpisodeRow(e, compact) {
  const row = document.createElement("div");
  row.className = "row";

  const statusMap = {
    planejado: ["Planejado", "warn"],
    gravado: ["Gravado", "info"],
    publicado: ["Publicado", "ok"]
  };

  const [statusLabel, badgeClass] = statusMap[e.status] || ["Status", "orange"];

  const left = document.createElement("div");

  const thumb = e.thumb
    ? `<img src="${e.thumb}" style="width:92px;height:54px;border-radius:14px;object-fit:cover;border:1px solid rgba(255,255,255,0.10);margin-right:10px;">`
    : "";

  left.innerHTML = `
    <div style="display:flex; align-items:flex-start; gap:10px;">
      ${thumb}
      <div>
        <div class="title">${safeText(e.titulo)}</div>
        <div class="meta">${safeText(e.data)} ${e.convidado ? "• Convidado: " + safeText(e.convidado) : ""}</div>
        <div class="meta">${e.obs ? safeText(e.obs) : ""}</div>
        ${e.link ? `<div class="meta"><a class="link" href="${safeText(e.link)}" target="_blank" rel="noopener">Abrir link</a></div>` : ""}
      </div>
    </div>
  `;

  const right = document.createElement("div");
  right.style.display = "grid";
  right.style.justifyItems = "end";
  right.style.gap = "8px";

  const badge = document.createElement("span");
  badge.className = `badge ${badgeClass}`;
  badge.textContent = statusLabel;
  right.appendChild(badge);

  if (!compact) {
    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "10px";

    const edit = document.createElement("button");
    edit.className = "btn ghost smallbtn";
    edit.textContent = "Editar";
    edit.addEventListener("click", () => editEpisode(e.id));

    const del = document.createElement("button");
    del.className = "btn danger smallbtn";
    del.textContent = "Excluir";
    del.addEventListener("click", async () => {
      const ok = await confirmAction(
        "Excluir este episódio?",
        "O episódio será removido da timeline e do site público."
      );
      if (!ok) return;
      db.episodios = db.episodios.filter((x) => x.id !== e.id);
      saveDB(db);
      refreshAll();
    });

    actions.appendChild(edit);
    actions.appendChild(del);
    right.appendChild(actions);
  }

  row.appendChild(left);
  row.appendChild(right);
  return row;
}

function editEpisode(id) {
  openEditModal("episodio", id);
}

// =========================================================
// ADMIN: EDIT MODAL (REPLACES PROMPTS)
// =========================================================
const editModal = document.getElementById("editModal");
const editForm = document.getElementById("editForm");
const editTitle = document.getElementById("editTitle");
const closeEditBtn = document.getElementById("closeEditBtn");
const cancelEditBtn = document.getElementById("cancelEditBtn");

const editInputs = {
  tipo: document.getElementById("editTipo"),
  valor: document.getElementById("editValor"),
  categoria: document.getElementById("editCategoria"),
  data: document.getElementById("editData"),
  obs: document.getElementById("editObs"),
  nome: document.getElementById("editNome"),
  insta: document.getElementById("editInsta"),
  bio: document.getElementById("editBio"),
  contato: document.getElementById("editContato"),
  gStatus: document.getElementById("editGStatus"),
  titulo: document.getElementById("editTitulo"),
  convidado: document.getElementById("editConvidado"),
  eStatus: document.getElementById("editEStatus"),
  link: document.getElementById("editLink")
};

const editWraps = {
  fTipoWrap: document.getElementById("fTipoWrap"),
  fValorWrap: document.getElementById("fValorWrap"),
  fCategoriaWrap: document.getElementById("fCategoriaWrap"),
  fDataWrap: document.getElementById("fDataWrap"),
  fObsWrap: document.getElementById("fObsWrap"),
  gNomeWrap: document.getElementById("gNomeWrap"),
  gInstaWrap: document.getElementById("gInstaWrap"),
  gBioWrap: document.getElementById("gBioWrap"),
  gContatoWrap: document.getElementById("gContatoWrap"),
  gStatusWrap: document.getElementById("gStatusWrap"),
  eTituloWrap: document.getElementById("eTituloWrap"),
  eConvidadoWrap: document.getElementById("eConvidadoWrap"),
  eStatusWrap: document.getElementById("eStatusWrap"),
  eLinkWrap: document.getElementById("eLinkWrap")
};

const editVisibleByType = {
  transacao: ["fTipoWrap", "fValorWrap", "fCategoriaWrap", "fDataWrap", "fObsWrap"],
  convidado: ["gNomeWrap", "gInstaWrap", "gBioWrap", "gContatoWrap", "gStatusWrap"],
  episodio: ["eTituloWrap", "eConvidadoWrap", "fDataWrap", "eStatusWrap", "eLinkWrap", "fObsWrap"]
};

const editState = { kind: "", id: "" };

function setEditFields(kind) {
  Object.values(editWraps).forEach((el) => el?.classList.add("hidden"));
  (editVisibleByType[kind] || []).forEach((key) => editWraps[key]?.classList.remove("hidden"));
}

function openEditModal(kind, id) {
  editState.kind = kind;
  editState.id = id;

  if (kind === "transacao") {
    const t = db.transacoes.find((x) => x.id === id);
    if (!t) return;
    editTitle.textContent = "Editar transação";
    setEditFields("transacao");
    editInputs.tipo.value = t.tipo || "entrada";
    editInputs.valor.value = String(t.valor ?? "");
    editInputs.categoria.value = t.categoria || "";
    editInputs.data.value = t.data || "";
    editInputs.obs.value = t.obs || "";
  }

  if (kind === "convidado") {
    const g = db.convidados.find((x) => x.id === id);
    if (!g) return;
    editTitle.textContent = "Editar convidado";
    setEditFields("convidado");
    editInputs.nome.value = g.nome || "";
    editInputs.insta.value = g.insta || "";
    editInputs.bio.value = g.bio || "";
    editInputs.contato.value = g.contato || "";
    editInputs.gStatus.value = g.status || "confirmado";
  }

  if (kind === "episodio") {
    const e = db.episodios.find((x) => x.id === id);
    if (!e) return;
    editTitle.textContent = "Editar episódio";
    setEditFields("episodio");
    editInputs.titulo.value = e.titulo || "";
    editInputs.convidado.value = e.convidado || "";
    editInputs.data.value = e.data || "";
    editInputs.eStatus.value = e.status || "planejado";
    editInputs.link.value = e.link || "";
    editInputs.obs.value = e.obs || "";
  }

  editModal?.classList.remove("hidden");
}

function closeEditModal() {
  editState.kind = "";
  editState.id = "";
  editModal?.classList.add("hidden");
  editForm?.reset();
}

function saveEditModal() {
  const { kind, id } = editState;
  if (!kind || !id) return;

  if (kind === "transacao") {
    const t = db.transacoes.find((x) => x.id === id);
    if (!t) return;

    const valor = Number(editInputs.valor.value);
    const categoria = editInputs.categoria.value.trim();
    const data = editInputs.data.value.trim();

    if (!(valor > 0) || categoria.length < 2 || !data) {
      toast("Preencha tipo, valor, categoria e data válidos.", "warn");
      return;
    }

    t.tipo = editInputs.tipo.value === "saida" ? "saida" : "entrada";
    t.valor = valor;
    t.categoria = categoria;
    t.data = data;
    t.obs = editInputs.obs.value.trim();
  }

  if (kind === "convidado") {
    const g = db.convidados.find((x) => x.id === id);
    if (!g) return;

    const nome = editInputs.nome.value.trim();
    const insta = editInputs.insta.value.trim();
    const bio = editInputs.bio.value.trim();

    if (nome.length < 2 || bio.length < 8) {
      toast("Informe nome e bio válidos para o convidado.", "warn");
      return;
    }
    if (insta && !insta.startsWith("@") && !isValidUrl(normalizeUrl(insta))) {
      toast("Instagram inválido. Use @usuario ou URL completa.", "warn");
      return;
    }

    g.nome = nome;
    g.insta = insta;
    g.bio = bio;
    g.contato = editInputs.contato.value.trim();
    g.status = ["confirmado", "pendente", "recusou"].includes(editInputs.gStatus.value)
      ? editInputs.gStatus.value
      : "confirmado";
  }

  if (kind === "episodio") {
    const e = db.episodios.find((x) => x.id === id);
    if (!e) return;

    const titulo = editInputs.titulo.value.trim();
    const data = editInputs.data.value.trim();
    const linkNorm = normalizeUrl(editInputs.link.value);

    if (titulo.length < 4 || !data) {
      toast("Informe título e data válidos para o episódio.", "warn");
      return;
    }
    if (linkNorm && !isValidUrl(linkNorm)) {
      toast("O link do episódio precisa ser uma URL válida.", "warn");
      return;
    }

    e.titulo = titulo;
    e.convidado = editInputs.convidado.value.trim();
    e.data = data;
    e.status = ["planejado", "gravado", "publicado"].includes(editInputs.eStatus.value)
      ? editInputs.eStatus.value
      : "planejado";
    e.link = linkNorm;
    e.obs = editInputs.obs.value.trim();
  }

  saveDB(db);
  refreshAll();
  closeEditModal();
  toast("Alterações salvas.", "ok");
}

editForm?.addEventListener("submit", (ev) => {
  ev.preventDefault();
  saveEditModal();
});

closeEditBtn?.addEventListener("click", closeEditModal);
cancelEditBtn?.addEventListener("click", closeEditModal);
editModal?.addEventListener("click", (ev) => {
  if (ev.target === editModal) closeEditModal();
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && editModal && !editModal.classList.contains("hidden")) {
    closeEditModal();
    return;
  }
  if (ev.key === "Escape" && confirmModal && !confirmModal.classList.contains("hidden")) {
    closeConfirmModal(false);
  }
});

// =========================================================
// PUBLIC RENDER
// =========================================================
const pubEpisodeSearch = document.getElementById("pubEpisodeSearch");
const pubEpisodeFilter = document.getElementById("pubEpisodeFilter");
const pubGuestSearch = document.getElementById("pubGuestSearch");
const pubGuestFilter = document.getElementById("pubGuestFilter");

pubEpisodeSearch?.addEventListener("input", renderPublic);
pubEpisodeFilter?.addEventListener("change", renderPublic);
pubGuestSearch?.addEventListener("input", renderPublic);
pubGuestFilter?.addEventListener("change", renderPublic);

function renderPublic() {
  // brand
  document.getElementById("podName").textContent = db.brand.name;
  document.getElementById("podName2").textContent = db.brand.name;
  document.getElementById("podTagline").textContent = db.brand.tagline;
  document.getElementById("adminTitle").textContent = db.brand.name + " • Painel";

  // stats
  document.getElementById("pubStatEps").textContent = String(db.episodios.length);
  document.getElementById("pubStatGuests").textContent = String(db.convidados.length);

  const lastPub = [...db.episodios]
    .filter(e => e.status === "publicado")
    .sort((a,b) => byDateStr(b.data, a.data))[0];

  document.getElementById("pubStatLast").textContent = lastPub ? formatDateBR(lastPub.data) : "—";

  // featured (last published)
  const ft = lastPub || db.episodios.sort((a,b)=>byDateStr(b.data,a.data))[0];
  const featuredTitle = document.getElementById("featuredTitle");
  const featuredMeta = document.getElementById("featuredMeta");
  const featuredLink = document.getElementById("featuredLink");
  const featuredEmbed = document.getElementById("featuredEmbed");

  if (ft) {
    featuredTitle.textContent = ft.titulo;
    featuredMeta.textContent = `${formatDateBR(ft.data)}${ft.convidado ? " • " + ft.convidado : ""}`;
    if (ft.link) {
      featuredLink.href = ft.link;
      featuredLink.classList.remove("hidden");
    } else {
      featuredLink.href = "#episodios";
    }

    const embedUrl = getEmbeddableLink(ft.link);
    if (featuredEmbed && embedUrl) {
      featuredEmbed.innerHTML = `<iframe src="${embedUrl}" title="Episódio em destaque" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`;
      featuredEmbed.classList.remove("hidden");
    } else if (featuredEmbed) {
      featuredEmbed.innerHTML = "";
      featuredEmbed.classList.add("hidden");
    }
  } else {
    featuredTitle.textContent = "Episódio em destaque";
    featuredMeta.textContent = "Cadastre episódios no painel para aparecer aqui.";
    featuredLink.href = "#episodios";
    if (featuredEmbed) {
      featuredEmbed.innerHTML = "";
      featuredEmbed.classList.add("hidden");
    }
  }

  // episodes public list
  const qE = (pubEpisodeSearch?.value || "").toLowerCase().trim();
  const fE = pubEpisodeFilter?.value || "publicado";

  let eps = db.episodios.filter((e) => {
    const matchText =
      e.titulo.toLowerCase().includes(qE) ||
      (e.convidado || "").toLowerCase().includes(qE) ||
      (e.obs || "").toLowerCase().includes(qE);

    const matchStatus = fE === "todos" ? true : e.status === fE;
    return matchText && matchStatus;
  });

  eps = eps.sort((a,b)=>byDateStr(b.data, a.data)).slice(0, 30);

  const publicEpisodes = document.getElementById("publicEpisodes");
  publicEpisodes.innerHTML = "";

  if (eps.length === 0) {
    publicEpisodes.innerHTML = `<div class="carditem"><div class="title">Nenhum episódio</div><div class="meta">Cadastre episódios no painel para aparecer aqui.</div></div>`;
  } else {
    eps.forEach((e) => publicEpisodes.appendChild(renderPublicEpisodeCard(e)));
  }

  // guests public list
  const qG = (pubGuestSearch?.value || "").toLowerCase().trim();
  const fG = pubGuestFilter?.value || "confirmado";

  let guests = db.convidados.filter((g) => {
    const matchText =
      g.nome.toLowerCase().includes(qG) ||
      (g.insta || "").toLowerCase().includes(qG) ||
      (g.bio || "").toLowerCase().includes(qG);

    const matchStatus = fG === "todos" ? true : g.status === fG;
    return matchText && matchStatus;
  });

  guests = guests.sort((a,b)=>a.nome.localeCompare(b.nome)).slice(0, 60);

  const publicGuests = document.getElementById("publicGuests");
  publicGuests.innerHTML = "";

  if (guests.length === 0) {
    publicGuests.innerHTML = `<div class="carditem"><div class="title">Nenhum convidado</div><div class="meta">Cadastre convidados no painel.</div></div>`;
  } else {
    guests.forEach((g) => publicGuests.appendChild(renderPublicGuestCard(g)));
  }

  // social/contact
  renderPublicSocial();
  updateDynamicUI();
}

function renderPublicEpisodeCard(e) {
  const card = document.createElement("div");
  card.className = "carditem";

  const thumb = document.createElement("div");
  thumb.className = "thumb";
  if (e.thumb) {
    thumb.innerHTML = `<img src="${e.thumb}" alt="Capa do episódio ${safeText(e.titulo)}" loading="lazy" decoding="async"/>`;
  } else {
    thumb.innerHTML = `<div class="ph">EP</div>`;
  }

  const title = document.createElement("div");
  title.className = "title";
  title.textContent = e.titulo;

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = `${e.data}${e.convidado ? " • " + e.convidado : ""} • ${e.status}`;

  const actions = document.createElement("div");
  actions.className = "actions";

  const a1 = document.createElement("a");
  a1.className = "btn ghost smallbtn";
  a1.href = "#";
  a1.textContent = "Detalhes";
  a1.addEventListener("click", (ev) => {
    ev.preventDefault();
    openDetails(e);
  });

  actions.appendChild(a1);

  if (e.link) {
    const a2 = document.createElement("a");
    a2.className = "btn primary smallbtn";
    a2.href = e.link;
    a2.target = "_blank";
    a2.rel = "noopener";
    a2.textContent = "Abrir";
    actions.appendChild(a2);
  }

  card.appendChild(thumb);
  card.appendChild(title);
  card.appendChild(meta);
  card.appendChild(actions);
  return card;
}

function renderPublicGuestCard(g) {
  const card = document.createElement("div");
  card.className = "carditem";

  const thumb = document.createElement("div");
  thumb.className = "thumb";
  if (g.foto) {
    thumb.innerHTML = `<img src="${g.foto}" alt="Foto de ${safeText(g.nome)}" loading="lazy" decoding="async"/>`;
  } else {
    thumb.innerHTML = `<div class="ph">GUEST</div>`;
  }

  const title = document.createElement("div");
  title.className = "title";
  title.textContent = g.nome;

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = `${g.bio}${g.insta ? " • " + g.insta : ""}`;

  const actions = document.createElement("div");
  actions.className = "actions";

  if (g.insta) {
    const a = document.createElement("a");
    a.className = "btn primary smallbtn";
    a.href = g.insta.startsWith("http") ? g.insta : `https://instagram.com/${g.insta.replace("@","")}`;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = "Instagram";
    actions.appendChild(a);
  }

  card.appendChild(thumb);
  card.appendChild(title);
  card.appendChild(meta);
  card.appendChild(actions);
  return card;
}

function renderPublicSocial() {
  const social = db.brand.social || {};
  const box = document.getElementById("publicSocial");
  const contact = document.getElementById("publicContact");

  box.innerHTML = "";
  contact.innerHTML = "";

  const links = [
    ["Instagram", social.instagram],
    ["YouTube", social.youtube],
    ["Spotify", social.spotify],
  ].filter(([_, v]) => v && v.trim());

  if (links.length === 0) {
    box.innerHTML = `<div class="muted">Configure suas redes no painel.</div>`;
  } else {
    links.forEach(([label, url]) => {
      const a = document.createElement("a");
      a.className = "slink";
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener";
      a.innerHTML = `<strong>${label}</strong><span>↗</span>`;
      box.appendChild(a);
    });
  }

  const c = [];
  if (social.email) c.push(["Email", social.email]);
  if (social.whatsapp) c.push(["WhatsApp", social.whatsapp]);

  if (c.length === 0) {
    contact.innerHTML = `<div class="muted">Configure email/WhatsApp no painel.</div>`;
  } else {
    c.forEach(([label, value]) => {
      const div = document.createElement("div");
      div.className = "slink";
      div.innerHTML = `<strong>${label}</strong><span>${safeText(value)}</span>`;
      contact.appendChild(div);
    });
  }
}


// =========================================================
// CSV EXPORT (Excel)
// =========================================================
function toCSV(rows){
  const esc = (v) => {
    const s = String(v ?? "");
    if (s.includes('"') || s.includes(",") || s.includes("\n")) {
      return '"' + s.replaceAll('"','""') + '"';
    }
    return s;
  };
  return rows.map(r => r.map(esc).join(",")).join("\n");
}

function downloadText(filename, text, mime="text/plain"){
  const blob = new Blob([text], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportFinanceCSV(transacoes, suffix=""){
  const header = ["tipo","valor","categoria","data","obs"];
  const rows = [header];
  transacoes.forEach(t => rows.push([
    t.tipo,
    Number(t.valor || 0).toFixed(2),
    t.categoria || "",
    t.data || "",
    t.obs || ""
  ]));
  downloadText(`financeiro${suffix}.csv`, toCSV(rows), "text/csv;charset=utf-8");
  toast("CSV do financeiro exportado!", "ok");
}

function exportGuestsCSV(convidados){
  const header = ["nome","instagram","bio","contato","status"];
  const rows = [header];
  convidados.forEach(g => rows.push([
    g.nome || "",
    g.insta || "",
    g.bio || "",
    g.contato || "",
    g.status || ""
  ]));
  downloadText("convidados.csv", toCSV(rows), "text/csv;charset=utf-8");
  toast("CSV de convidados exportado!", "ok");
}

function exportEpisodesCSV(episodios){
  const header = ["titulo","convidado","data","status","link","obs"];
  const rows = [header];
  episodios.forEach(e => rows.push([
    e.titulo || "",
    e.convidado || "",
    e.data || "",
    e.status || "",
    e.link || "",
    e.obs || ""
  ]));
  downloadText("episodios.csv", toCSV(rows), "text/csv;charset=utf-8");
  toast("CSV de episódios exportado!", "ok");
}

document.getElementById("csvFinanceBtn")?.addEventListener("click", () => exportFinanceCSV(db.transacoes));
document.getElementById("csvGuestsBtn")?.addEventListener("click", () => exportGuestsCSV(db.convidados));
document.getElementById("csvEpisodesBtn")?.addEventListener("click", () => exportEpisodesCSV(db.episodios));

document.getElementById("csvAllBtn")?.addEventListener("click", () => exportFinanceCSV(db.transacoes, "_tudo"));

document.getElementById("csvMonthBtn")?.addEventListener("click", () => {
  const m = document.getElementById("reportMonth")?.value; // YYYY-MM
  if (!m) {
    toast("Escolha um mês primeiro.", "warn");
    return;
  }
  const filtered = db.transacoes.filter(t => String(t.data || "").startsWith(m));
  exportFinanceCSV(filtered, "_" + m);
});



// =========================================================
// PUBLIC: DETAILS MODAL
// =========================================================
const detailsModal = document.getElementById("detailsModal");
const closeDetailsBtn = document.getElementById("closeDetailsBtn");
const detailsClose2 = document.getElementById("detailsClose2");
const detailsTitle = document.getElementById("detailsTitle");
const detailsMeta = document.getElementById("detailsMeta");
const detailsBody = document.getElementById("detailsBody");
const detailsOpenLink = document.getElementById("detailsOpenLink");

function openDetails(ep){
  if (!detailsModal) return;
  detailsTitle.textContent = ep.titulo || "Episódio";
  detailsMeta.textContent = `${ep.data || "—"} • ${ep.status || "—"}${ep.convidado ? " • " + ep.convidado : ""}`;

  detailsBody.innerHTML = "";

  const add = (label, value) => {
    const div = document.createElement("div");
    div.className = "details-item";
    div.innerHTML = `<strong>${safeText(label)}</strong><div class="muted">${safeText(value || "—")}</div>`;
    detailsBody.appendChild(div);
  };

  add("Convidado", ep.convidado || "—");
  add("Observações", ep.obs || "—");

  if (ep.link) {
    detailsOpenLink.href = ep.link;
    detailsOpenLink.classList.remove("hidden");
  } else {
    detailsOpenLink.href = "#episodios";
  }

  detailsModal.classList.remove("hidden");
}

function closeDetails(){
  detailsModal?.classList.add("hidden");
}

closeDetailsBtn?.addEventListener("click", closeDetails);
detailsClose2?.addEventListener("click", closeDetails);
detailsModal?.addEventListener("click", (e) => {
  if (e.target === detailsModal) closeDetails();
});


// =========================================================
// CHARTS (CANVAS)
// =========================================================
function lastNMonths(n = 6) {
  const now = new Date();
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push(key);
  }
  return out;
}

function financeByMonth(keys) {
  const map = {};
  keys.forEach(k => map[k] = { entrada: 0, saida: 0 });

  db.transacoes.forEach(t => {
    const k = monthKey(t.data);
    if (!map[k]) return;
    if (t.tipo === "entrada") map[k].entrada += Number(t.valor) || 0;
    else map[k].saida += Number(t.valor) || 0;
  });

  return keys.map(k => ({ k, ...map[k], saldo: map[k].entrada - map[k].saida }));
}

function drawBarChart(canvas, labels, seriesA, seriesB) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width = canvas.clientWidth * devicePixelRatio;
  const h = canvas.height = canvas.clientHeight * devicePixelRatio;

  ctx.clearRect(0,0,w,h);

  const pad = 28 * devicePixelRatio;
  const maxVal = Math.max(1, ...seriesA, ...seriesB);

  const innerW = w - pad*2;
  const innerH = h - pad*2;

  // axes
  ctx.globalAlpha = 0.6;
  ctx.strokeStyle = "rgba(255,255,255,0.20)";
  ctx.lineWidth = 1 * devicePixelRatio;
  ctx.beginPath();
  ctx.moveTo(pad, pad);
  ctx.lineTo(pad, h - pad);
  ctx.lineTo(w - pad, h - pad);
  ctx.stroke();
  ctx.globalAlpha = 1;

  const group = innerW / labels.length;
  const barW = group * 0.22;

  for (let i=0;i<labels.length;i++){
    const x0 = pad + i*group + group*0.25;
    const a = seriesA[i] / maxVal;
    const b = seriesB[i] / maxVal;

    const ha = innerH * a;
    const hb = innerH * b;

    // entradas (orange)
    ctx.fillStyle = "rgba(255,106,0,0.90)";
    ctx.fillRect(x0, (h-pad)-ha, barW, ha);

    // saidas (white-ish)
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(x0 + barW + group*0.08, (h-pad)-hb, barW, hb);

    // labels
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.font = `${12*devicePixelRatio}px ui-sans-serif, system-ui`;
    ctx.textAlign = "center";
    ctx.fillText(labels[i].slice(5), x0 + barW, h - (10*devicePixelRatio));
  }
}

function drawLineChart(canvas, labels, values) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width = canvas.clientWidth * devicePixelRatio;
  const h = canvas.height = canvas.clientHeight * devicePixelRatio;

  ctx.clearRect(0,0,w,h);

  const pad = 28 * devicePixelRatio;
  const maxVal = Math.max(1, ...values.map(v => Math.abs(v)));
  const innerW = w - pad*2;
  const innerH = h - pad*2;

  // axes
  ctx.globalAlpha = 0.6;
  ctx.strokeStyle = "rgba(255,255,255,0.20)";
  ctx.lineWidth = 1 * devicePixelRatio;
  ctx.beginPath();
  ctx.moveTo(pad, pad);
  ctx.lineTo(pad, h - pad);
  ctx.lineTo(w - pad, h - pad);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // line
  const step = innerW / Math.max(1, labels.length - 1);

  ctx.beginPath();
  for (let i=0;i<labels.length;i++){
    const x = pad + i*step;
    const y = (h - pad) - ( (values[i] / (maxVal || 1)) * (innerH*0.9) + innerH*0.05 );
    if (i === 0) ctx.moveTo(x,y);
    else ctx.lineTo(x,y);
  }
  ctx.strokeStyle = "rgba(255,106,0,0.95)";
  ctx.lineWidth = 2.5 * devicePixelRatio;
  ctx.stroke();

  // dots
  for (let i=0;i<labels.length;i++){
    const x = pad + i*step;
    const y = (h - pad) - ( (values[i] / (maxVal || 1)) * (innerH*0.9) + innerH*0.05 );
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.arc(x,y, 3.5*devicePixelRatio, 0, Math.PI*2);
    ctx.fill();
  }

  // labels
  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.font = `${12*devicePixelRatio}px ui-sans-serif, system-ui`;
  ctx.textAlign = "center";
  for (let i=0;i<labels.length;i++){
    const x = pad + i*step;
    ctx.fillText(labels[i].slice(5), x, h - (10*devicePixelRatio));
  }
}

function renderCharts() {
  const keys = lastNMonths(6);
  const data = financeByMonth(keys);

  const entradas = data.map(d => d.entrada);
  const saidas = data.map(d => d.saida);

  // saldo acumulado
  let acc = 0;
  const saldoAcc = data.map(d => (acc += d.saldo));

  drawBarChart(document.getElementById("chart6m"), keys, entradas, saidas);
  drawLineChart(document.getElementById("chartSaldo"), keys, saldoAcc);
}

// =========================================================
// DYNAMIC UI FX (PUBLIC)
// =========================================================
let fxInited = false;
let revealObserver = null;
let activePublicNavLinks = [];
let activePublicSections = [];

function initDynamicFX() {
  if (fxInited) return;
  fxInited = true;
  setupScrollProgress();
  setupBackToTop();
  setupActivePublicNav();
  setupRevealObserver();
  setupHeroTilt();
  updateDynamicUI();
}

function updateDynamicUI() {
  updateScrollProgress();
  updateBackToTop();
  updateActivePublicNav();
  applyRevealTargets();
  animatePublicStats();
}

function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function setupScrollProgress() {
  window.addEventListener("scroll", updateScrollProgress, { passive: true });
  window.addEventListener("resize", updateScrollProgress);
}

function updateScrollProgress() {
  const bar = document.getElementById("scrollProgress");
  if (!bar) return;
  const h = document.documentElement;
  const max = h.scrollHeight - h.clientHeight;
  const p = max > 0 ? (h.scrollTop / max) * 100 : 0;
  bar.style.width = `${Math.min(100, Math.max(0, p))}%`;
}

function setupBackToTop() {
  const btn = document.getElementById("backTopBtn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  });
  window.addEventListener("scroll", updateBackToTop, { passive: true });
}

function updateBackToTop() {
  const btn = document.getElementById("backTopBtn");
  if (!btn) return;
  btn.classList.toggle("show", window.scrollY > 360);
}

function setupActivePublicNav() {
  activePublicNavLinks = Array.from(document.querySelectorAll(".public-nav .navlink"));
  activePublicSections = activePublicNavLinks
    .map((a) => document.querySelector(a.getAttribute("href")))
    .filter(Boolean);

  window.addEventListener("scroll", updateActivePublicNav, { passive: true });
  window.addEventListener("resize", updateActivePublicNav);
  window.addEventListener("hashchange", updateActivePublicNav);
}

function updateActivePublicNav() {
  if (!activePublicNavLinks.length || !activePublicSections.length) return;

  const offset = window.scrollY + 120;
  let currentId = activePublicSections[0].id;
  activePublicSections.forEach((section) => {
    if (section.offsetTop <= offset) currentId = section.id;
  });

  activePublicNavLinks.forEach((link) => {
    const id = (link.getAttribute("href") || "").replace("#", "");
    link.classList.toggle("active", id === currentId);
  });
}

function setupRevealObserver() {
  if (!("IntersectionObserver" in window) || prefersReducedMotion()) return;
  revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("in");
      revealObserver.unobserve(entry.target);
    });
  }, { threshold: 0.12 });
}

function applyRevealTargets() {
  const targets = Array.from(document.querySelectorAll(
    ".hero-left, .hero-right, .public-section, .carditem, .statbox, .hero-card"
  ));
  targets.forEach((el) => {
    if (!el.classList.contains("reveal")) el.classList.add("reveal");
    if (prefersReducedMotion()) {
      el.classList.add("in");
      return;
    }
    if (revealObserver) revealObserver.observe(el);
    else el.classList.add("in");
  });
}

function setupHeroTilt() {
  if (prefersReducedMotion()) return;
  const card = document.querySelector(".hero-card");
  if (!card || card.dataset.fxTilt === "1") return;
  card.dataset.fxTilt = "1";

  card.addEventListener("mousemove", (e) => {
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    const rx = (0.5 - y) * 4;
    const ry = (x - 0.5) * 5;
    card.style.transform = `perspective(900px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
  });

  card.addEventListener("mouseleave", () => {
    card.style.transform = "perspective(900px) rotateX(0deg) rotateY(0deg)";
  });
}

function animatePublicStats() {
  if (prefersReducedMotion()) return;
  ["pubStatEps", "pubStatGuests"].forEach((id) => animateNumber(id));
}

function animateNumber(id) {
  const el = document.getElementById(id);
  if (!el) return;

  const target = Number(el.textContent) || 0;
  const last = Number(el.dataset.animatedValue || "0");
  if (target === last) return;

  const start = last;
  const startAt = performance.now();
  const duration = 480;

  const tick = (now) => {
    const t = Math.min(1, (now - startAt) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    const val = Math.round(start + (target - start) * eased);
    el.textContent = String(val);
    if (t < 1) requestAnimationFrame(tick);
    else el.dataset.animatedValue = String(target);
  };

  requestAnimationFrame(tick);
}

// =========================================================
// DEFAULTS + INIT
// =========================================================
function setTodayDefaults() {
  const val = todayISO();
  const fData = document.getElementById("fData");
  const eData = document.getElementById("eData");

  if (fData && !fData.value) fData.value = val;
  if (eData && !eData.value) eData.value = val;
}

function fillSettingsInputs() {
  sName.value = db.brand.name;
  sTagline.value = db.brand.tagline;

  sInstagram.value = db.brand.social.instagram || "";
  sYoutube.value = db.brand.social.youtube || "";
  sSpotify.value = db.brand.social.spotify || "";
  sEmail.value = db.brand.social.email || "";
  sWhats.value = db.brand.social.whatsapp || "";
  updateBackupInfo();
}

function updateBackupInfo() {
  if (!backupInfo || !backupHistory) return;
  const list = getBackupList();
  const backup = list[0] || getBackupPayload();
  if (!backup?.savedAt) {
    backupInfo.textContent = "Backup local: ainda não disponível.";
    backupHistory.innerHTML = "";
    return;
  }

  const date = new Date(backup.savedAt);
  const when = Number.isNaN(date.getTime())
    ? backup.savedAt
    : date.toLocaleString("pt-BR");
  const label = backup.label ? ` • ${backup.label}` : "";
  backupInfo.textContent = `Último backup local: ${when}${label} • Histórico: ${list.length}/${MAX_BACKUPS}`;

  backupHistory.innerHTML = "";
  list.forEach((item, idx) => {
    const d = new Date(item.savedAt || "");
    const whenItem = Number.isNaN(d.getTime()) ? String(item.savedAt || "—") : d.toLocaleString("pt-BR");
    const row = document.createElement("div");
    row.className = "backup-item";
    row.innerHTML = `
      <div class="small muted">${safeText(whenItem)}${item.label ? " • " + safeText(item.label) : ""}</div>
      <button class="btn ghost smallbtn" type="button" data-backup-idx="${idx}">Restaurar</button>
    `;
    backupHistory.appendChild(row);
  });
}

function ensureBackupInitialized() {
  if (getBackupList().length > 0 || getBackupPayload()) return;
  try {
    const payload = createPayload(db, "bootstrap");
    localStorage.setItem(DB_BACKUP_KEY, JSON.stringify(payload));
    saveBackupList([payload]);
  } catch {
    // If storage is full, we just keep running without bootstrap backup.
  }
}

function refreshAll() {
  renderPublic();
  renderOverview();
  renderFinance();
  renderGuests();
  renderEpisodes();
  fillSettingsInputs();
  const rm = document.getElementById("reportMonth");
  if (rm && !rm.value) rm.value = todayISO().slice(0,7);
}

function initAdmin() {
  setTodayDefaults();
  openTab("overview");
  refreshAll();
}

(async function boot() {
  document.getElementById("year").textContent = String(new Date().getFullYear());
  ensureBackupInitialized();
  initDynamicFX();
  await initCloudSync();

  if (isLogged()) {
    showAdmin();
    initAdmin();
  } else {
    showPublic();
    refreshAll();
  }
})();
