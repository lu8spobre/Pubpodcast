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

const defaultDB = {
  brand: {
    name: "Seu Podcast",
    tagline: "O podcast mais brabo da sua cidade.",
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

    const brand = parsed.brand || defaultDB.brand;
    const social = (brand.social || defaultDB.brand.social);

    return {
      brand: {
        name: brand.name || defaultDB.brand.name,
        tagline: brand.tagline || defaultDB.brand.tagline,
        social: {
          instagram: social.instagram || "",
          youtube: social.youtube || "",
          spotify: social.spotify || "",
          email: social.email || "",
          whatsapp: social.whatsapp || ""
        }
      },
      transacoes: Array.isArray(parsed.transacoes) ? parsed.transacoes : [],
      convidados: Array.isArray(parsed.convidados) ? parsed.convidados : [],
      episodios: Array.isArray(parsed.episodios) ? parsed.episodios : []
    };
  } catch (e) {
    return structuredClone(defaultDB);
  }
}

function saveDB(db) {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

let db = loadDB();

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
    version: 2,
    exportedAt: new Date().toISOString(),
    data: db
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "backup_podcast_dashboard_v2.json";
  a.click();
  URL.revokeObjectURL(a.href);
});

const importBtn = document.getElementById("importBtn");
const importFile = document.getElementById("importFile");

importBtn?.addEventListener("click", () => importFile?.click());

importFile?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const json = JSON.parse(text);
    if (!json?.data) throw new Error("Formato inválido");

    const d = json.data;

    db = {
      brand: d.brand || defaultDB.brand,
      transacoes: Array.isArray(d.transacoes) ? d.transacoes : [],
      convidados: Array.isArray(d.convidados) ? d.convidados : [],
      episodios: Array.isArray(d.episodios) ? d.episodios : []
    };

    saveDB(db);
    refreshAll();
    toast("Importado com sucesso!", "ok");
  } catch (err) {
    toast("Erro ao importar (arquivo inválido).", "err");
  } finally {
    importFile.value = "";
  }
});

document.getElementById("wipeAllBtn")?.addEventListener("click", () => {
  const ok = confirm("Tem certeza? Isso vai apagar convidados, episódios e transações.");
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

document.getElementById("clearFinanceBtn")?.addEventListener("click", () => {
  const ok = confirm("Apagar TODAS as transações?");
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

  if (!tipo || !categoria || !data || !(valor > 0)) return;

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

document.getElementById("clearGuestsBtn")?.addEventListener("click", () => {
  const ok = confirm("Apagar TODOS os convidados?");
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

  if (!nome || !bio) return;

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

document.getElementById("clearEpisodesBtn")?.addEventListener("click", () => {
  const ok = confirm("Apagar TODOS os episódios?");
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

  if (!titulo || !data) return;

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
    link,
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
  db.brand.social.instagram = sInstagram.value.trim();
  db.brand.social.youtube = sYoutube.value.trim();
  db.brand.social.spotify = sSpotify.value.trim();
  db.brand.social.email = sEmail.value.trim();
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
    del.addEventListener("click", () => {
      const ok = confirm("Excluir esta transação?");
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
  const t = db.transacoes.find((x) => x.id === id);
  if (!t) return;

  const tipo = prompt("Tipo (entrada/saida):", t.tipo);
  if (!tipo) return;

  const valor = Number(prompt("Valor:", String(t.valor)));
  if (!(valor > 0)) return;

  const categoria = prompt("Categoria:", t.categoria) || t.categoria;
  const data = prompt("Data (AAAA-MM-DD):", t.data) || t.data;
  const obs = prompt("Observação (opcional):", t.obs || "") ?? t.obs;

  t.tipo = tipo === "saida" ? "saida" : "entrada";
  t.valor = valor;
  t.categoria = categoria.trim();
  t.data = data.trim();
  t.obs = String(obs || "").trim();

  saveDB(db);
  refreshAll();
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
  del.addEventListener("click", () => {
    const ok = confirm("Excluir este convidado?");
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
  const g = db.convidados.find((x) => x.id === id);
  if (!g) return;

  const nome = prompt("Nome:", g.nome) || g.nome;
  const insta = prompt("Instagram:", g.insta || "") ?? g.insta;
  const bio = prompt("Bio:", g.bio) || g.bio;
  const contato = prompt("Contato:", g.contato || "") ?? g.contato;
  const status = prompt("Status (confirmado/pendente/recusou):", g.status) || g.status;

  g.nome = nome.trim();
  g.insta = String(insta || "").trim();
  g.bio = bio.trim();
  g.contato = String(contato || "").trim();
  g.status = ["confirmado","pendente","recusou"].includes(status) ? status : g.status;

  saveDB(db);
  refreshAll();
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
    del.addEventListener("click", () => {
      const ok = confirm("Excluir este episódio?");
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
  const e = db.episodios.find((x) => x.id === id);
  if (!e) return;

  const titulo = prompt("Título:", e.titulo) || e.titulo;
  const convidado = prompt("Convidado:", e.convidado || "") ?? e.convidado;
  const data = prompt("Data (AAAA-MM-DD):", e.data) || e.data;
  const status = prompt("Status (planejado/gravado/publicado):", e.status) || e.status;
  const link = prompt("Link (opcional):", e.link || "") ?? e.link;
  const obs = prompt("Observações:", e.obs || "") ?? e.obs;

  e.titulo = titulo.trim();
  e.convidado = String(convidado || "").trim();
  e.data = data.trim();
  e.status = ["planejado","gravado","publicado"].includes(status) ? status : e.status;
  e.link = String(link || "").trim();
  e.obs = String(obs || "").trim();

  saveDB(db);
  refreshAll();
}

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

  document.getElementById("pubStatLast").textContent = lastPub ? lastPub.data : "—";

  // featured (last published)
  const ft = lastPub || db.episodios.sort((a,b)=>byDateStr(b.data,a.data))[0];
  const featuredTitle = document.getElementById("featuredTitle");
  const featuredMeta = document.getElementById("featuredMeta");
  const featuredLink = document.getElementById("featuredLink");

  if (ft) {
    featuredTitle.textContent = ft.titulo;
    featuredMeta.textContent = `${ft.data}${ft.convidado ? " • " + ft.convidado : ""}`;
    if (ft.link) {
      featuredLink.href = ft.link;
      featuredLink.classList.remove("hidden");
    } else {
      featuredLink.href = "#episodios";
    }
  } else {
    featuredTitle.textContent = "Episódio em destaque";
    featuredMeta.textContent = "Cadastre episódios no painel para aparecer aqui.";
    featuredLink.href = "#episodios";
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
}

function renderPublicEpisodeCard(e) {
  const card = document.createElement("div");
  card.className = "carditem";

  const thumb = document.createElement("div");
  thumb.className = "thumb";
  if (e.thumb) {
    thumb.innerHTML = `<img src="${e.thumb}" alt="thumbnail"/>`;
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
    thumb.innerHTML = `<img src="${g.foto}" alt="foto"/>`;
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

(function boot() {
  document.getElementById("year").textContent = String(new Date().getFullYear());

  if (isLogged()) {
    showAdmin();
    initAdmin();
  } else {
    showPublic();
    refreshAll();
  }
})();
