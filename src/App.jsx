import { useState, useEffect, useCallback } from "react";

// ── Supabase config ──────────────────────────────────────────────
const SUPABASE_URL = "https://bxjmcuqwzdvvhymqaeji.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ4am1jdXF3emR2dmh5bXFhZWppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2NTM3OTUsImV4cCI6MjA4ODIyOTc5NX0.axvucvLtar12xssiigYtwZuRZSLOA-XhX2Day7oqG6g";

async function sbFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": options.prefer || "return=representation",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// DB row ↔ app object conversions
function rowToTool(r) {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    serialNumber: r.serial_number || "",
    location: r.location || { type: "skap", name: "", hylle: "", rad: "" },
    status: r.status || "ok",
    calibrationRequired: r.calibration_required !== false,
    lastCalibration: r.last_calibration || "",
    notes: r.notes || "",
    addedDate: r.added_date || "",
  };
}

function toolToRow(t) {
  return {
    id: t.id,
    name: t.name,
    category: t.category,
    serial_number: t.serialNumber || "",
    location: t.location,
    status: t.status,
    calibration_required: t.calibrationRequired !== false,
    last_calibration: t.lastCalibration || null,
    notes: t.notes || "",
    added_date: t.addedDate || "",
  };
}

function rowToNotif(r) {
  return { id: r.id, msg: r.msg, date: r.date, read: r.read };
}

// ── CSV helpers ──────────────────────────────────────────────────
function parseCSV(text) {
  // Detect delimiter
  const delim = text.indexOf(";") !== -1 ? ";" : ",";
  const lines = text.replace(/\r/g, "").split("\n").filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(delim).map(h => h.trim().toLowerCase());

  // Map known column names to our fields
  const col = (names) => {
    for (const n of names) {
      const i = headers.findIndex(h => h.includes(n));
      if (i !== -1) return i;
    }
    return -1;
  };

  const iName     = col(["verktøynavn", "navn", "name", "tool"]);
  const iLok      = col(["lokasjon", "location", "sted"]);
  const iHylle    = col(["hylle", "shelf"]);
  const iRad      = col(["rad", "row"]);
  const iPlassering = col(["plassering", "placement"]);
  const iDel      = col(["delenummer", "part", "serial", "serienummer"]);
  const iLev      = col(["leverandør", "supplier", "vendor"]);
  const iStatus   = col(["status"]);
  const iKat      = col(["kategori", "category"]);
  const iNotes    = col(["notater", "notes", "merknad"]);

  const tools = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(delim);
    const get = (idx) => idx !== -1 ? (cols[idx] || "").trim() : "";

    const name = get(iName);
    if (!name) continue;

    const lokRaw = get(iLok);
    const hylle  = get(iHylle);
    const rad    = get(iRad);
    const plassering = get(iPlassering);

    // Detect location type
    let locType = "skap";
    if (lokRaw.toLowerCase().includes("tavle")) locType = "tavle";
    else if (lokRaw.toLowerCase().includes("reol")) locType = "skap";
    else if (lokRaw.toLowerCase().includes("gulv") || lokRaw.toLowerCase().includes("vegg")) locType = "gulv";

    // Status mapping
    const statusRaw = get(iStatus).toLowerCase();
    let status = "ok";
    if (statusRaw.includes("defekt") || statusRaw.includes("ødelagt")) status = "defekt";
    else if (statusRaw.includes("slitt") || statusRaw.includes("mangler")) status = "slitt";

    // Notes: combine leverandør, plassering and original notes/status
    const leverandor = get(iLev);
    const noteParts = [];
    if (leverandor) noteParts.push(`Leverandør: ${leverandor}`);
    if (plassering) noteParts.push(`Plassering: ${plassering}`);
    const origNotes = get(iNotes) || (iStatus !== -1 && get(iStatus) && status === "ok" ? get(iStatus) : "");
    if (origNotes && origNotes.toLowerCase() !== "ok" && origNotes.toLowerCase() !== "") noteParts.push(origNotes);

    tools.push({
      id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
      name,
      category: get(iKat) || "Importert",
      serialNumber: get(iDel),
      location: { type: locType, name: lokRaw, hylle, rad },
      status,
      calibrationRequired: false,
      lastCalibration: "",
      notes: noteParts.join(" | "),
      addedDate: new Date().toISOString().split("T")[0],
    });
  }
  return tools;
}

function exportToCSV(tools) {
  const headers = ["Verktøynavn","Kategori","Serienummer","Lokasjon type","Lokasjon navn","Hylle","Rad","Status","Kalibreringspliktig","Siste kalibrering","Notater","Lagt til"];
  const rows = tools.map(t => [
    t.name,
    t.category,
    t.serialNumber,
    t.location.type,
    t.location.name,
    t.location.hylle,
    t.location.rad,
    t.status,
    t.calibrationRequired ? "Ja" : "Nei",
    t.lastCalibration,
    t.notes,
    t.addedDate,
  ].map(v => `"${(v || "").replace(/"/g, '""')}"`).join(";"));
  const csv = [headers.join(";"), ...rows].join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `verksted-verktoy-${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const ADMIN_CODE = "admin123";

const STATUS_CONFIG = {
  ok:     { label: "OK",     color: "#22c55e", bg: "#052e16", border: "#166534" },
  slitt:  { label: "Slitt",  color: "#f59e0b", bg: "#2d1700", border: "#92400e" },
  defekt: { label: "Defekt", color: "#ef4444", bg: "#2d0000", border: "#991b1b" },
};

function getDaysUntilCalibration(dateStr) {
  if (!dateStr) return null;
  const next = new Date(dateStr);
  next.setFullYear(next.getFullYear() + 1);
  return Math.ceil((next - new Date()) / (1000 * 60 * 60 * 24));
}

function CalibrationBadge({ dateStr }) {
  const days = getDaysUntilCalibration(dateStr);
  if (days === null) return <span style={{ color: "#666", fontSize: 12 }}>Ingen dato</span>;
  if (days < 0)  return <span style={{ color: "#ef4444", fontSize: 12, fontWeight: 700 }}>⚠ Forfalt ({Math.abs(days)}d siden)</span>;
  if (days <= 30) return <span style={{ color: "#f59e0b", fontSize: 12, fontWeight: 700 }}>⏰ Om {days} dager</span>;
  return <span style={{ color: "#22c55e", fontSize: 12 }}>✓ Om {days} dager</span>;
}

// ── Styles ───────────────────────────────────────────────────────
const st = {
  app:       { minHeight: "100vh", background: "#0a0a0f", color: "#e8e8e0", fontFamily: "'DM Mono','Courier New',monospace" },
  header:    { background: "#111118", borderBottom: "1px solid #222", padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100 },
  logo:      { fontSize: 22, fontWeight: 700, letterSpacing: 2, color: "#f5a623", textTransform: "uppercase", lineHeight: 1.1 },
  logoSub:   { fontSize: 11, color: "#555", letterSpacing: 1, marginTop: 2 },
  nav:       { display: "flex", gap: 8, alignItems: "center" },
  navBtn:    (a) => ({ padding: "6px 14px", borderRadius: 6, border: "1px solid", borderColor: a ? "#f5a623" : "#333", background: a ? "#f5a62322" : "transparent", color: a ? "#f5a623" : "#aaa", cursor: "pointer", fontSize: 13 }),
  notifBtn:  { position: "relative", padding: "6px 12px", borderRadius: 6, border: "1px solid #333", background: "transparent", color: "#aaa", cursor: "pointer", fontSize: 13 },
  badge:     { position: "absolute", top: -6, right: -6, background: "#ef4444", color: "#fff", borderRadius: 99, fontSize: 10, padding: "1px 5px", fontWeight: 700 },
  main:      { padding: "24px 32px" },
  inp:       { background: "#111118", border: "1px solid #333", borderRadius: 8, padding: "10px 14px", color: "#e8e8e0", fontSize: 14, outline: "none", fontFamily: "inherit" },
  sel:       { background: "#111118", border: "1px solid #333", borderRadius: 8, padding: "10px 14px", color: "#e8e8e0", fontSize: 14, outline: "none", fontFamily: "inherit" },
  card:      { background: "#111118", border: "1px solid #222", borderRadius: 12, padding: "16px", marginBottom: 10, cursor: "pointer", transition: "border-color 0.2s,background 0.2s" },
  lbl:       { fontSize: 11, color: "#666", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 },
  val:       { fontSize: 14, color: "#e8e8e0" },
  pill:      (s) => ({ display: "inline-block", padding: "3px 10px", borderRadius: 99, fontSize: 12, fontWeight: 700, color: STATUS_CONFIG[s].color, background: STATUS_CONFIG[s].bg, border: `1px solid ${STATUS_CONFIG[s].border}` }),
  primary:   { padding: "10px 20px", borderRadius: 8, border: "none", background: "#f5a623", color: "#0a0a0f", fontWeight: 700, cursor: "pointer", fontSize: 14, fontFamily: "inherit" },
  secondary: { padding: "10px 20px", borderRadius: 8, border: "1px solid #333", background: "transparent", color: "#aaa", cursor: "pointer", fontSize: 14, fontFamily: "inherit" },
  danger:    { padding: "10px 20px", borderRadius: 8, border: "1px solid #991b1b", background: "transparent", color: "#ef4444", cursor: "pointer", fontSize: 14, fontFamily: "inherit" },
  secTitle:  { fontSize: 13, color: "#f5a623", textTransform: "uppercase", letterSpacing: 2, marginBottom: 12, borderBottom: "1px solid #222", paddingBottom: 8 },
  g2:        { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 },
  toast:     { position: "fixed", bottom: 24, right: 24, background: "#052e16", border: "1px solid #166534", color: "#22c55e", padding: "12px 20px", borderRadius: 10, fontSize: 14, fontWeight: 600, zIndex: 9999 },
  toastErr:  { position: "fixed", bottom: 24, right: 24, background: "#2d0000", border: "1px solid #991b1b", color: "#ef4444", padding: "12px 20px", borderRadius: 10, fontSize: 14, fontWeight: 600, zIndex: 9999 },
  box:       { background: "#0d0d15", border: "1px solid #2a2a3a", borderRadius: 10, padding: 16, marginBottom: 16 },
  fl:        (col) => ({ fontSize: 11, color: col || "#888", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }),
  adminBanner: { background: "#1a1200", border: "1px solid #f5a62344", borderRadius: 8, padding: "8px 14px", fontSize: 12, color: "#f5a623", marginBottom: 16 },
  spinner:   { display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh", color: "#555", fontSize: 14 },
};

// ── ToolForm ─────────────────────────────────────────────────────
function ToolForm({ tool, onChange, isEdit }) {
  const full = { width: "100%", boxSizing: "border-box" };
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={st.g2}>
        <div>
          <div style={st.fl()}>Navn *</div>
          <input style={{ ...st.inp, ...full }} placeholder="F.eks. Momentnøkkel 3/4&quot;" value={tool.name} onChange={e => onChange({ ...tool, name: e.target.value })} />
        </div>
        <div>
          <div style={st.fl()}>Kategori *</div>
          <input style={{ ...st.inp, ...full }} placeholder="F.eks. Håndverktøy" value={tool.category} onChange={e => onChange({ ...tool, category: e.target.value })} />
        </div>
      </div>
      <div style={st.g2}>
        <div>
          <div style={st.fl()}>Serienummer</div>
          <input style={{ ...st.inp, ...full }} placeholder="Valgfritt" value={tool.serialNumber} onChange={e => onChange({ ...tool, serialNumber: e.target.value })} />
        </div>
        <div>
          <div style={st.fl()}>Status</div>
          <select style={{ ...st.sel, ...full }} value={tool.status} onChange={e => onChange({ ...tool, status: e.target.value })}>
            <option value="ok">OK</option>
            <option value="slitt">Slitt</option>
            <option value="defekt">Defekt</option>
          </select>
        </div>
      </div>

      <div style={{ borderTop: "1px solid #1a1a2a", paddingTop: 14 }}>
        <div style={{ ...st.fl("#f5a623"), marginBottom: 10 }}>Lokasjon</div>
        <div style={st.g2}>
          <div>
            <div style={st.fl()}>Type *</div>
            <select style={{ ...st.sel, ...full }} value={tool.location.type}
              onChange={e => onChange({ ...tool, location: { ...tool.location, type: e.target.value, hylle: "", rad: "" } })}>
              <option value="skap">Skap</option>
              <option value="tavle">Tavle</option>
              <option value="gulv">Gulv / Vegg / Annet</option>
            </select>
          </div>
          <div>
            <div style={st.fl()}>{tool.location.type === "skap" ? "Skapnavn" : tool.location.type === "tavle" ? "Tavlenavn" : "Stedsnavn"} *</div>
            <input style={{ ...st.inp, ...full }} placeholder="F.eks. Skap A" value={tool.location.name}
              onChange={e => onChange({ ...tool, location: { ...tool.location, name: e.target.value } })} />
          </div>
        </div>
        {tool.location.type === "skap" && (
          <div style={{ ...st.g2, marginTop: 10 }}>
            <div>
              <div style={st.fl()}>Hylle</div>
              <input style={{ ...st.inp, ...full }} placeholder="F.eks. Hylle 2" value={tool.location.hylle}
                onChange={e => onChange({ ...tool, location: { ...tool.location, hylle: e.target.value } })} />
            </div>
            <div>
              <div style={st.fl()}>Rad</div>
              <input style={{ ...st.inp, ...full }} placeholder="F.eks. Rad 1" value={tool.location.rad}
                onChange={e => onChange({ ...tool, location: { ...tool.location, rad: e.target.value } })} />
            </div>
          </div>
        )}
      </div>

      <div style={{ borderTop: "1px solid #1a1a2a", paddingTop: 14 }}>
        <div onClick={() => onChange({ ...tool, calibrationRequired: !tool.calibrationRequired })}
          style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer", userSelect: "none" }}>
          <div style={{ width: 44, height: 24, borderRadius: 99, background: tool.calibrationRequired ? "#f5a623" : "#222", border: `1px solid ${tool.calibrationRequired ? "#f5a623" : "#444"}`, position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
            <div style={{ position: "absolute", top: 3, left: tool.calibrationRequired ? 22 : 3, width: 16, height: 16, borderRadius: 99, background: "#fff", transition: "left 0.2s" }} />
          </div>
          <div>
            <div style={{ fontSize: 13, color: tool.calibrationRequired ? "#f5a623" : "#888", fontWeight: 600 }}>
              {tool.calibrationRequired ? "Kalibreringspliktig" : "Ikke kalibreringspliktig"}
            </div>
            <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>
              {tool.calibrationRequired ? "Kalibrering spores og varsles" : "Ingen kalibreringssporing"}
            </div>
          </div>
        </div>
      </div>

      {isEdit && tool.calibrationRequired && (
        <div>
          <div style={st.fl()}>Siste kalibrering / vedlikehold</div>
          <input type="date" style={{ ...st.inp, ...full }} value={tool.lastCalibration || ""}
            onChange={e => onChange({ ...tool, lastCalibration: e.target.value })} />
        </div>
      )}

      <div>
        <div style={st.fl()}>Notater</div>
        <textarea style={{ ...st.inp, ...full, minHeight: 72, resize: "vertical" }}
          placeholder="Valgfrie notater..." value={tool.notes}
          onChange={e => onChange({ ...tool, notes: e.target.value })} />
      </div>
    </div>
  );
}

function UserCodeEditor({ userCode, onSave, toast, st }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(userCode);
  const [show, setShow] = useState(false);

  function save() {
    if (!draft.trim()) return;
    onSave(draft.trim());
    setEditing(false);
    toast("Kode oppdatert!");
  }

  return editing ? (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <input style={{ ...st.inp, flex: 1, minWidth: 160 }}
        value={draft} onChange={e => setDraft(e.target.value)}
        onKeyDown={e => e.key === "Enter" && save()}
        autoFocus />
      <button style={st.primary} onClick={save}>Lagre</button>
      <button style={st.secondary} onClick={() => { setEditing(false); setDraft(userCode); }}>Avbryt</button>
    </div>
  ) : (
    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ background: "#0d0d15", border: "1px solid #2a2a3a", borderRadius: 8, padding: "10px 16px", fontFamily: "monospace", fontSize: 16, letterSpacing: 3, color: "#f5a623", minWidth: 120 }}>
        {show ? userCode : "•".repeat(userCode.length)}
      </div>
      <button style={{ ...st.secondary, padding: "8px 14px", fontSize: 12 }} onClick={() => setShow(s => !s)}>
        {show ? "Skjul" : "Vis"}
      </button>
      <button style={{ ...st.secondary, padding: "8px 14px", fontSize: 12 }} onClick={() => { setDraft(userCode); setEditing(true); }}>
        ✏ Endre kode
      </button>
    </div>
  );
}

// ── App ──────────────────────────────────────────────────────────
const emptyTool = { name: "", category: "", serialNumber: "", location: { type: "skap", name: "", hylle: "", rad: "" }, status: "ok", notes: "", lastCalibration: "", addedDate: "", calibrationRequired: true };

export default function App() {
  const [tools, setTools] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(null);

  const [view, setView] = useState("list");
  const [selectedTool, setSelectedTool] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminCode, setAdminCode] = useState("");
  const [loginError, setLoginError] = useState("");
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("alle");
  const [filterCategory, setFilterCategory] = useState("alle");
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newTool, setNewTool] = useState(emptyTool);
  const [saving, setSaving] = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const [importing, setImporting] = useState(false);
  const [userCode, setUserCode] = useState("verktoy123");
  const [showAddCodePrompt, setShowAddCodePrompt] = useState(false);
  const [addCodeInput, setAddCodeInput] = useState("");
  const [addCodeError, setAddCodeError] = useState("");

  // ── Load data ──
  useEffect(() => {
    async function load() {
      try {
        const [toolRows, notifRows, settingsRows] = await Promise.all([
          sbFetch("tools?order=added_date.asc"),
          sbFetch("notifications?order=id.desc&limit=50"),
          sbFetch("settings"),
        ]);
        setTools((toolRows || []).map(rowToTool));
        setNotifications((notifRows || []).map(rowToNotif));
        const codeSetting = (settingsRows || []).find(s => s.key === "user_add_code");
        if (codeSetting) setUserCode(codeSetting.value);
      } catch (e) {
        setDbError(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  function toast(msg) { setSuccessMsg(msg); setTimeout(() => setSuccessMsg(""), 2500); }
  function toastErr(msg) { setErrorMsg(msg); setTimeout(() => setErrorMsg(""), 4000); }

  async function pushNotif(msg) {
    const row = { id: Date.now(), msg, date: new Date().toLocaleString("nb-NO"), read: false };
    try {
      await sbFetch("notifications", { method: "POST", body: JSON.stringify(row) });
      setNotifications(prev => [row, ...prev].slice(0, 50));
    } catch (e) { console.warn("Notif error", e); }
  }

  const calibrationWarnings = tools.filter(t => {
    if (!t.calibrationRequired) return false;
    const days = getDaysUntilCalibration(t.lastCalibration);
    return days !== null && days <= 30;
  });
  const unreadCount = notifications.filter(n => !n.read).length + calibrationWarnings.length;
  const categories = ["alle", ...Array.from(new Set(tools.map(t => t.category)))];
  const filtered = tools.filter(t => {
    const q = search.toLowerCase();
    return (t.name.toLowerCase().includes(q) || (t.serialNumber || "").toLowerCase().includes(q) || (t.location?.name || "").toLowerCase().includes(q))
      && (filterStatus === "alle" || t.status === filterStatus)
      && (filterCategory === "alle" || t.category === filterCategory);
  });

  function handleLogin() {
    if (adminCode === ADMIN_CODE) { setIsAdmin(true); setView("admin"); setLoginError(""); }
    else setLoginError("Feil kode. Prøv igjen.");
  }

  async function handleStatusChange(toolId, newStatus) {
    const tool = tools.find(t => t.id === toolId);
    setSaving(true);
    try {
      await sbFetch(`tools?id=eq.${toolId}`, { method: "PATCH", body: JSON.stringify({ status: newStatus }), prefer: "return=minimal" });
      setTools(prev => prev.map(t => t.id === toolId ? { ...t, status: newStatus } : t));
      if (editDraft?.id === toolId) setEditDraft(p => ({ ...p, status: newStatus }));
      setSelectedTool(p => p ? { ...p, status: newStatus } : p);
      await pushNotif(`Statusendring: "${tool.name}" → ${STATUS_CONFIG[newStatus].label}`);
      toast("Status oppdatert!");
    } catch (e) { toastErr("Kunne ikke oppdatere status"); }
    setSaving(false);
  }

  async function handleAddTool() {
    if (!newTool.name || !newTool.category || !newTool.location.name) return;
    const tool = { ...newTool, id: Date.now().toString(), addedDate: new Date().toISOString().split("T")[0] };
    setSaving(true);
    try {
      await sbFetch("tools", { method: "POST", body: JSON.stringify(toolToRow(tool)) });
      setTools(prev => [...prev, tool]);
      await pushNotif(`Nytt verktøy lagt til: "${tool.name}" (${tool.category})`);
      setNewTool(emptyTool);
      setView("list");
      toast("Verktøy lagt til!");
    } catch (e) { toastErr("Kunne ikke legge til verktøy: " + e.message); }
    setSaving(false);
  }

  async function handleSaveEdit() {
    if (!editDraft?.name || !editDraft.category || !editDraft.location.name) return;
    const original = tools.find(t => t.id === editDraft.id);
    setSaving(true);
    try {
      await sbFetch(`tools?id=eq.${editDraft.id}`, { method: "PUT", body: JSON.stringify(toolToRow(editDraft)), prefer: "return=minimal" });
      setTools(prev => prev.map(t => t.id === editDraft.id ? editDraft : t));
      let changes = [];
      if (original.name !== editDraft.name) changes.push(`navn: "${original.name}" → "${editDraft.name}"`);
      if (original.status !== editDraft.status) changes.push(`status: ${STATUS_CONFIG[original.status].label} → ${STATUS_CONFIG[editDraft.status].label}`);
      if (original.lastCalibration !== editDraft.lastCalibration) changes.push("kalibreringsdata oppdatert");
      if (original.location.name !== editDraft.location.name) changes.push("lokasjon endret");
      if (original.category !== editDraft.category) changes.push(`kategori endret`);
      if (changes.length > 0) await pushNotif(`Admin redigerte: "${editDraft.name}" — ${changes.join(", ")}`);
      setSelectedTool(editDraft);
      setEditDraft(null);
      toast("Endringer lagret!");
    } catch (e) { toastErr("Kunne ikke lagre: " + e.message); }
    setSaving(false);
  }

  async function handleDeleteTool(toolId) {
    const tool = tools.find(t => t.id === toolId);
    setSaving(true);
    try {
      await sbFetch(`tools?id=eq.${toolId}`, { method: "DELETE", prefer: "return=minimal" });
      setTools(prev => prev.filter(t => t.id !== toolId));
      await pushNotif(`Verktøy slettet: "${tool.name}"`);
      setSelectedTool(null); setEditDraft(null); setConfirmDelete(false); setView("list");
      toast("Verktøy slettet.");
    } catch (e) { toastErr("Kunne ikke slette"); }
    setSaving(false);
  }

  async function markAllRead() {
    try {
      await sbFetch("notifications?read=eq.false", { method: "PATCH", body: JSON.stringify({ read: true }), prefer: "return=minimal" });
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch (e) { toastErr("Kunne ikke oppdatere"); }
  }

  function handleImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        // Try latin-1 first (common for Norwegian Excel exports)
        const text = ev.target.result;
        const parsed = parseCSV(text);
        if (parsed.length === 0) { toastErr("Ingen verktøy funnet i filen. Sjekk formatet."); return; }
        setImportPreview({ tools: parsed, filename: file.name });
      } catch (err) { toastErr("Kunne ikke lese filen: " + err.message); }
    };
    reader.readAsText(file, "latin-1");
    e.target.value = "";
  }

  async function handleConfirmImport() {
    if (!importPreview) return;
    setImporting(true);
    let ok = 0, fail = 0;
    for (const tool of importPreview.tools) {
      try {
        await sbFetch("tools", { method: "POST", body: JSON.stringify(toolToRow(tool)) });
        ok++;
      } catch { fail++; }
    }
    setTools(prev => {
      const existingIds = new Set(prev.map(t => t.id));
      const newTools = importPreview.tools.filter(t => !existingIds.has(t.id));
      return [...prev, ...newTools];
    });
    await pushNotif(`CSV-import: ${ok} verktøy importert${fail > 0 ? `, ${fail} feilet` : ""}`);
    setImportPreview(null);
    setImporting(false);
    toast(`${ok} verktøy importert!`);
  }

  function handleRequestAdd() {
    if (isAdmin) { setView("add"); return; }
    setAddCodeInput("");
    setAddCodeError("");
    setShowAddCodePrompt(true);
  }

  function handleUserCodeSubmit() {
    if (addCodeInput === userCode) {
      setShowAddCodePrompt(false);
      setView("add");
    } else {
      setAddCodeError("Feil kode. Prøv igjen.");
    }
  }

  async function saveUserCode(newCode) {
    try {
      await sbFetch("settings?key=eq.user_add_code", {
        method: "PATCH",
        body: JSON.stringify({ value: newCode }),
        prefer: "return=minimal",
      });
      setUserCode(newCode);
    } catch (e) { toastErr("Kunne ikke lagre kode"); }
  }

  function goToDetail(tool, startEditing = false) {
    setSelectedTool(tool);
    setEditDraft(startEditing ? { ...tool } : null);
    setConfirmDelete(false);
    setView("detail");
  }

  const Header = ({ backTo, backLabel = "← Tilbake", extra }) => (
    <div style={st.header}>
      <div>
        <div style={st.logo}>Toolbase</div>
        <div style={st.logoSub}>av Kenneth Almås</div>
      </div>
      <div style={st.nav}>
        {extra}
        {backTo && <button style={st.secondary} onClick={() => setView(backTo)}>{backLabel}</button>}
      </div>
    </div>
  );

  // ── Loading / error ──
  if (loading) return (
    <div style={st.app}>
      <div style={st.header}>
        <div><div style={st.logo}>Toolbase</div><div style={st.logoSub}>av Kenneth Almås</div></div>
      </div>
      <div style={st.spinner}>⏳ Kobler til database...</div>
    </div>
  );

  if (dbError) return (
    <div style={st.app}>
      <div style={st.header}><div><div style={st.logo}>Toolbase</div><div style={st.logoSub}>av Kenneth Almås</div></div></div>
      <div style={{ ...st.main, paddingTop: 60 }}>
        <div style={{ color: "#ef4444", marginBottom: 12, fontWeight: 700 }}>⚠ Kunne ikke koble til databasen</div>
        <div style={{ color: "#666", fontSize: 13, marginBottom: 16 }}>Sjekk at Supabase-tabellene er opprettet og at URL/nøkkel er riktig.</div>
        <div style={{ background: "#0d0d15", border: "1px solid #333", borderRadius: 8, padding: 12, fontSize: 12, color: "#888" }}>{dbError}</div>
      </div>
    </div>
  );

  // ── LOGIN ──
  if (view === "login") return (
    <div style={st.app}>
      <Header backTo="list" />
      <div style={{ ...st.main, maxWidth: 400, paddingTop: 60 }}>
        <div style={st.secTitle}>Administratorinnlogging</div>
        <input style={{ ...st.inp, width: "100%", marginBottom: 12, boxSizing: "border-box" }}
          type="password" placeholder="Skriv inn admin-kode"
          value={adminCode} onChange={e => setAdminCode(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleLogin()} />
        {loginError && <div style={{ color: "#ef4444", fontSize: 13, marginBottom: 10 }}>{loginError}</div>}
        <button style={st.primary} onClick={handleLogin}>Logg inn</button>
        <div style={{ marginTop: 16, color: "#555", fontSize: 12 }}>Demo-kode: admin123</div>
      </div>
    </div>
  );

  // ── DETAIL / EDIT ──
  if (view === "detail" && selectedTool) {
    const tool = tools.find(t => t.id === selectedTool.id) || selectedTool;
    const editing = editDraft !== null;
    return (
      <div style={st.app}>
        {successMsg && <div style={st.toast}>✓ {successMsg}</div>}
        {errorMsg && <div style={st.toastErr}>✗ {errorMsg}</div>}
        <Header
          backTo={editing ? null : "list"}
          extra={editing ? (
            <>
              <button style={st.secondary} onClick={() => { setEditDraft(null); setConfirmDelete(false); }}>Avbryt</button>
              <button style={{ ...st.primary, opacity: saving ? 0.6 : 1 }} onClick={handleSaveEdit} disabled={saving}>
                {saving ? "Lagrer..." : "💾 Lagre alle endringer"}
              </button>
            </>
          ) : (
            isAdmin && <button style={st.navBtn(false)} onClick={() => setEditDraft({ ...tool })}>✏ Rediger</button>
          )}
        />
        <div style={st.main}>
          {isAdmin && !editing && <div style={st.adminBanner}>🔑 Admin-modus — trykk "Rediger" for å endre alle felt</div>}
          {editing ? (
            <>
              <div style={{ ...st.secTitle, marginBottom: 16 }}>Redigerer: {tool.name}</div>
              <div style={st.box}><ToolForm tool={editDraft} onChange={setEditDraft} isEdit={true} /></div>
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #1a1a2a" }}>
                {confirmDelete ? (
                  <div style={{ background: "#2d0000", border: "1px solid #991b1b", borderRadius: 10, padding: 16 }}>
                    <div style={{ color: "#ef4444", marginBottom: 12, fontWeight: 600 }}>⚠ Er du sikker? Dette kan ikke angres.</div>
                    <div style={{ display: "flex", gap: 10 }}>
                      <button style={st.danger} onClick={() => handleDeleteTool(tool.id)} disabled={saving}>
                        {saving ? "Sletter..." : "Ja, slett permanent"}
                      </button>
                      <button style={st.secondary} onClick={() => setConfirmDelete(false)}>Avbryt</button>
                    </div>
                  </div>
                ) : (
                  <button style={st.danger} onClick={() => setConfirmDelete(true)}>🗑 Slett dette verktøyet</button>
                )}
              </div>
            </>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
                <div>
                  <h1 style={{ fontSize: 24, fontWeight: 700, color: "#f5a623", margin: 0 }}>{tool.name}</h1>
                  <div style={{ color: "#666", fontSize: 13, marginTop: 4 }}>{tool.category}{tool.serialNumber ? ` · S/N: ${tool.serialNumber}` : ""}</div>
                </div>
                <span style={st.pill(tool.status)}>{STATUS_CONFIG[tool.status].label}</span>
              </div>

              <div style={{ marginBottom: 24 }}>
                <div style={st.secTitle}>Lokasjon</div>
                <div style={st.g2}>
                  <div><div style={st.lbl}>Type</div><div style={st.val}>{tool.location.type === "skap" ? "🗄 Skap" : tool.location.type === "tavle" ? "📌 Tavle" : "📍 Annet"}</div></div>
                  <div><div style={st.lbl}>Navn</div><div style={st.val}>{tool.location.name}</div></div>
                  {tool.location.hylle && <div><div style={st.lbl}>Hylle</div><div style={st.val}>{tool.location.hylle}</div></div>}
                  {tool.location.rad && <div><div style={st.lbl}>Rad</div><div style={st.val}>{tool.location.rad}</div></div>}
                </div>
              </div>

              {tool.calibrationRequired ? (
                <div style={{ marginBottom: 24 }}>
                  <div style={st.secTitle}>Kalibrering / Vedlikehold</div>
                  <div style={{ marginBottom: 6 }}>
                    <div style={st.lbl}>Siste dato</div>
                    <div style={st.val}>{tool.lastCalibration ? new Date(tool.lastCalibration).toLocaleDateString("nb-NO") : "Ikke registrert"}</div>
                  </div>
                  <CalibrationBadge dateStr={tool.lastCalibration} />
                </div>
              ) : (
                <div style={{ marginBottom: 24 }}>
                  <div style={st.secTitle}>Kalibrering / Vedlikehold</div>
                  <div style={{ color: "#555", fontSize: 13 }}>Ikke kalibreringspliktig</div>
                </div>
              )}

              <div style={{ marginBottom: 24 }}>
                <div style={st.secTitle}>Endre status</div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                    <button key={key} onClick={() => handleStatusChange(tool.id, key)} disabled={saving}
                      style={{ padding: "8px 18px", borderRadius: 8, border: `2px solid ${tool.status === key ? cfg.color : "#333"}`, background: tool.status === key ? cfg.bg : "transparent", color: tool.status === key ? cfg.color : "#888", cursor: "pointer", fontWeight: 700, fontSize: 14, fontFamily: "inherit" }}>
                      {cfg.label}
                    </button>
                  ))}
                </div>
              </div>

              {tool.notes && (
                <div style={{ marginBottom: 24 }}>
                  <div style={st.secTitle}>Notater</div>
                  <div style={{ ...st.val, background: "#0d0d15", padding: 12, borderRadius: 8, border: "1px solid #222" }}>{tool.notes}</div>
                </div>
              )}
              <div style={{ color: "#444", fontSize: 12 }}>Lagt til: {tool.addedDate}</div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── ADD TOOL ──
  if (view === "add") return (
    <div style={st.app}>
      {successMsg && <div style={st.toast}>✓ {successMsg}</div>}
      {errorMsg && <div style={st.toastErr}>✗ {errorMsg}</div>}
      <Header backTo="list" />
      <div style={{ ...st.main, maxWidth: 640 }}>
        <div style={st.secTitle}>Legg til nytt verktøy</div>
        <div style={st.box}><ToolForm tool={newTool} onChange={setNewTool} isEdit={false} /></div>
        <button style={{ ...st.primary, opacity: saving ? 0.6 : 1 }} onClick={handleAddTool} disabled={saving}>
          {saving ? "Lagrer..." : "＋ Legg til verktøy"}
        </button>
      </div>
    </div>
  );

  // ── CALIBRATION OVERVIEW ──
  if (view === "calibration") {
    const withDays = tools.filter(t => t.calibrationRequired).map(t => ({ ...t, days: getDaysUntilCalibration(t.lastCalibration) }));
    const overdue  = withDays.filter(t => t.days !== null && t.days < 0).sort((a, b) => a.days - b.days);
    const urgent   = withDays.filter(t => t.days !== null && t.days >= 0 && t.days <= 30).sort((a, b) => a.days - b.days);
    const upcoming = withDays.filter(t => t.days !== null && t.days > 30 && t.days <= 90).sort((a, b) => a.days - b.days);
    const ok       = withDays.filter(t => t.days !== null && t.days > 90).sort((a, b) => a.days - b.days);
    const noDate   = withDays.filter(t => t.days === null);

    function CalibBar({ days }) {
      if (days === null) return null;
      const pct = Math.max(0, Math.min(100, (days / 365) * 100));
      const color = days < 0 ? "#ef4444" : days <= 30 ? "#f59e0b" : days <= 90 ? "#3b82f6" : "#22c55e";
      return (
        <div style={{ flex: 1, height: 6, background: "#1a1a2a", borderRadius: 99, overflow: "hidden", minWidth: 60 }}>
          <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 99 }} />
        </div>
      );
    }

    function CalibRow({ t, col, bg, border }) {
      const nextDue = t.lastCalibration ? (() => { const d = new Date(t.lastCalibration); d.setFullYear(d.getFullYear() + 1); return d; })() : null;
      return (
        <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: "12px 16px", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "0 0 200px", minWidth: 120 }}>
              <div style={{ fontWeight: 600, color: "#e8e8e0", fontSize: 14 }}>{t.name}</div>
              <div style={{ color: "#777", fontSize: 11 }}>{t.category}</div>
            </div>
            <CalibBar days={t.days} />
            <div style={{ flex: "0 0 170px", textAlign: "right" }}>
              <div style={{ color: col, fontWeight: 700, fontSize: 13 }}>
                {t.days === null ? "—" : t.days < 0 ? `⚠ Forfalt ${Math.abs(t.days)}d siden` : `Om ${t.days} dager`}
              </div>
              {nextDue && <div style={{ color: "#555", fontSize: 11 }}>Forfaller: {nextDue.toLocaleDateString("nb-NO")}</div>}
            </div>
            <button style={{ ...st.navBtn(false), fontSize: 11, padding: "4px 10px", flexShrink: 0 }}
              onClick={() => goToDetail(t, true)}>✏ Rediger</button>
          </div>
        </div>
      );
    }

    function Sec({ title, items, col, bg, border }) {
      if (!items.length) return null;
      return (
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: col, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>{title}</div>
            <div style={{ background: bg, border: `1px solid ${border}`, color: col, borderRadius: 99, fontSize: 11, padding: "1px 8px", fontWeight: 700 }}>{items.length}</div>
          </div>
          {items.map(t => <CalibRow key={t.id} t={t} col={col} bg={bg} border={border} />)}
        </div>
      );
    }

    return (
      <div style={st.app}>
        {successMsg && <div style={st.toast}>✓ {successMsg}</div>}
        <Header backTo="admin" backLabel="← Admin" extra={<button style={{ ...st.secondary, fontSize: 13 }} onClick={() => { setIsAdmin(false); setView("list"); }}>Logg ut</button>} />
        <div style={st.main}>
          <div style={st.secTitle}>Kalibreringsoversikt</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12, marginBottom: 32 }}>
            {[
              { label: "Kalibreringspliktige", value: withDays.length, color: "#e8e8e0", bg: "#111118", border: "#2a2a3a" },
              { label: "Trenger handling", value: overdue.length + urgent.length, color: "#ef4444", bg: "#2d0000", border: "#991b1b" },
              { label: "Forfalt", value: overdue.length, color: "#ef4444", bg: "#2d0000", border: "#991b1b" },
              { label: "Innen 30 dager", value: urgent.length, color: "#f59e0b", bg: "#2d1700", border: "#92400e" },
              { label: "Innen 90 dager", value: upcoming.length, color: "#3b82f6", bg: "#0c1a2e", border: "#1e3a5f" },
              { label: "Ingen dato", value: noDate.length, color: "#666", bg: "#0d0d15", border: "#222" },
            ].map(s => (
              <div key={s.label} style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 12, padding: "14px 16px", textAlign: "center" }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: 11, color: "#666", textTransform: "uppercase", letterSpacing: 1, marginTop: 4 }}>{s.label}</div>
              </div>
            ))}
          </div>
          <Sec title="⚠ Forfalt" items={overdue} col="#ef4444" bg="#1a0000" border="#5a1010" />
          <Sec title="⏰ Forfaller innen 30 dager" items={urgent} col="#f59e0b" bg="#1a0d00" border="#5a3a00" />
          <Sec title="🔵 Forfaller innen 90 dager" items={upcoming} col="#3b82f6" bg="#0a1020" border="#1e3a5f" />
          <Sec title="✅ OK — mer enn 90 dager igjen" items={ok} col="#22c55e" bg="#030f06" border="#0f3a1a" />
          {noDate.length > 0 && (
            <div style={{ marginBottom: 28 }}>
              <div style={{ fontSize: 13, color: "#555", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Ingen dato registrert ({noDate.length})</div>
              {noDate.map(t => (
                <div key={t.id} style={{ background: "#0d0d15", border: "1px solid #222", borderRadius: 10, padding: "12px 16px", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                  <div>
                    <div style={{ fontWeight: 600, color: "#888", fontSize: 14 }}>{t.name}</div>
                    <div style={{ color: "#555", fontSize: 11 }}>{t.category}</div>
                  </div>
                  <button style={{ ...st.navBtn(false), fontSize: 11, padding: "4px 10px" }} onClick={() => goToDetail(t, true)}>✏ Sett dato</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── IMPORT PREVIEW ──
  if (view === "admin" && importPreview) return (
    <div style={st.app}>
      {successMsg && <div style={st.toast}>✓ {successMsg}</div>}
      {errorMsg && <div style={st.toastErr}>✗ {errorMsg}</div>}
      <Header backTo={null} extra={
        <>
          <button style={st.secondary} onClick={() => setImportPreview(null)}>Avbryt</button>
          <button style={{ ...st.primary, opacity: importing ? 0.6 : 1 }} onClick={handleConfirmImport} disabled={importing}>
            {importing ? "Importerer..." : `✓ Importer ${importPreview.tools.length} verktøy`}
          </button>
        </>
      } />
      <div style={st.main}>
        <div style={st.secTitle}>Forhåndsvisning — {importPreview.filename}</div>
        <div style={{ color: "#aaa", fontSize: 13, marginBottom: 16 }}>
          Fant <strong style={{ color: "#f5a623" }}>{importPreview.tools.length} verktøy</strong> i filen. Sjekk at dataene ser riktige ut før du importerer.
        </div>
        <div style={{ background: "#0d0d15", border: "1px solid #2a2a3a", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 2fr 1fr", gap: 0, background: "#111118", padding: "10px 16px", fontSize: 11, color: "#666", textTransform: "uppercase", letterSpacing: 1 }}>
            <div>Verktøynavn</div><div>Kategori</div><div>Lokasjon</div><div>Status</div>
          </div>
          {importPreview.tools.map((t, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 2fr 1fr", gap: 0, padding: "10px 16px", borderTop: "1px solid #1a1a2a", fontSize: 13 }}>
              <div style={{ color: "#e8e8e0", fontWeight: 600 }}>{t.name}</div>
              <div style={{ color: "#888" }}>{t.category}</div>
              <div style={{ color: "#888" }}>
                {t.location.name}
                {t.location.hylle ? ` · ${t.location.hylle}` : ""}
                {t.location.rad ? ` · ${t.location.rad}` : ""}
              </div>
              <div><span style={st.pill(t.status)}>{STATUS_CONFIG[t.status].label}</span></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // ── ADMIN PANEL ──
  if (view === "admin") return (
    <div style={st.app}>
      {successMsg && <div style={st.toast}>✓ {successMsg}</div>}
      {errorMsg && <div style={st.toastErr}>✗ {errorMsg}</div>}
      <Header backTo="list" extra={<button style={{ ...st.secondary, fontSize: 13 }} onClick={() => { setIsAdmin(false); setView("list"); }}>Logg ut</button>} />
      <div style={st.main}>
        <div style={st.secTitle}>Admin — Varsler og hendelseslogg</div>
        <button style={{ ...st.primary, marginBottom: 12 }} onClick={() => setView("calibration")}>
          📅 Vis kalibreringsoversikt
        </button>

        <div style={{ ...st.box, marginBottom: 24 }}>
          <div style={{ ...st.secTitle, marginBottom: 12 }}>Kode for å legge til verktøy</div>
          <div style={{ fontSize: 13, color: "#888", marginBottom: 14 }}>
            Vanlige brukere må skrive inn denne koden for å få lov til å legge til nytt verktøy.
          </div>
          <UserCodeEditor userCode={userCode} onSave={saveUserCode} toast={toast} st={st} />
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 24, flexWrap: "wrap" }}>
          <label style={{ ...st.secondary, cursor: "pointer", display: "inline-block" }}>
            📥 Importer CSV
            <input type="file" accept=".csv" style={{ display: "none" }} onChange={handleImportFile} />
          </label>
          <button style={st.secondary} onClick={() => exportToCSV(tools)}>
            📤 Eksporter CSV ({tools.length} verktøy)
          </button>
        </div>

        {calibrationWarnings.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 13, color: "#f59e0b", marginBottom: 10, fontWeight: 600 }}>⏰ Kalibrering forfaller snart</div>
            {calibrationWarnings.map(t => {
              const days = getDaysUntilCalibration(t.lastCalibration);
              return (
                <div key={t.id} style={{ background: "#2d1700", border: "1px solid #92400e", borderRadius: 10, padding: "12px 16px", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                  <div>
                    <div style={{ color: "#e8e8e0", fontWeight: 600 }}>{t.name}</div>
                    <div style={{ color: "#aaa", fontSize: 12 }}>{t.category}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ color: "#f59e0b", fontWeight: 700 }}>{days < 0 ? `Forfalt ${Math.abs(days)} dager siden` : `Om ${days} dager`}</div>
                    <button style={{ ...st.secondary, fontSize: 12, padding: "4px 10px", marginTop: 6 }} onClick={() => goToDetail(t, true)}>Rediger →</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ ...st.secTitle, marginBottom: 0 }}>Hendelseslogg</div>
          {notifications.some(n => !n.read) && <button style={{ ...st.secondary, fontSize: 12, padding: "4px 10px" }} onClick={markAllRead}>Merk alle som lest</button>}
        </div>
        {notifications.length === 0 && <div style={{ color: "#555", fontSize: 14 }}>Ingen hendelser ennå.</div>}
        {notifications.map(n => (
          <div key={n.id} style={{ background: n.read ? "#0d0d15" : "#111820", border: `1px solid ${n.read ? "#1a1a2a" : "#1e3a5f"}`, borderRadius: 10, padding: "12px 16px", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <div>
              {!n.read && <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 99, background: "#f5a623", marginRight: 8 }} />}
              <span style={{ fontSize: 14, color: n.read ? "#888" : "#e8e8e0" }}>{n.msg}</span>
            </div>
            <span style={{ fontSize: 11, color: "#555", whiteSpace: "nowrap" }}>{n.date}</span>
          </div>
        ))}
      </div>
    </div>
  );

  // ── MAIN LIST ──
  return (
    <div style={st.app}>
      {successMsg && <div style={st.toast}>✓ {successMsg}</div>}
      {errorMsg && <div style={st.toastErr}>✗ {errorMsg}</div>}

      {/* Code prompt modal */}
      {showAddCodePrompt && (
        <div style={{ position: "fixed", inset: 0, background: "#000a", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#111118", border: "1px solid #333", borderRadius: 14, padding: 28, width: 340, boxShadow: "0 8px 40px #000a" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#e8e8e0", marginBottom: 6 }}>Skriv inn kode</div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 18 }}>Du trenger en kode for å legge til nytt verktøy.</div>
            <input
              style={{ ...st.inp, width: "100%", boxSizing: "border-box", marginBottom: 10 }}
              type="password" placeholder="Kode"
              value={addCodeInput}
              onChange={e => setAddCodeInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleUserCodeSubmit()}
              autoFocus
            />
            {addCodeError && <div style={{ color: "#ef4444", fontSize: 13, marginBottom: 10 }}>{addCodeError}</div>}
            <div style={{ display: "flex", gap: 10 }}>
              <button style={st.primary} onClick={handleUserCodeSubmit}>Bekreft</button>
              <button style={st.secondary} onClick={() => setShowAddCodePrompt(false)}>Avbryt</button>
            </div>
          </div>
        </div>
      )}
      <div style={st.header}>
        <div>
          <div style={st.logo}>Toolbase</div>
          <div style={st.logoSub}>av Kenneth Almås</div>
        </div>
        <div style={st.nav}>
          {isAdmin && <span style={{ fontSize: 11, color: "#f5a623", border: "1px solid #f5a62344", borderRadius: 4, padding: "3px 8px" }}>🔑 Admin</span>}
          <button style={st.navBtn(false)} onClick={handleRequestAdd}>＋ Legg til</button>
          <button style={st.notifBtn} onClick={() => isAdmin ? setView("admin") : setView("login")}>
            🔔 Admin
            {unreadCount > 0 && <span style={st.badge}>{unreadCount}</span>}
          </button>
        </div>
      </div>
      <div style={{ background: "#0d0d13", borderBottom: "1px solid #1a1a2a", padding: "12px 32px", position: "sticky", top: 61, zIndex: 99 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: 2, minWidth: 180, position: "relative", display: "flex" }}>
            <input style={{ ...st.inp, flex: 1, paddingRight: search ? 36 : 14 }} placeholder="🔍  Søk etter navn, serienr, sted..."
              value={search} onChange={e => setSearch(e.target.value)} />
            {search && (
              <button onClick={() => setSearch("")}
                style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0 }}>✕</button>
            )}
          </div>
          <select style={{ ...st.sel, flex: 1 }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="alle">Alle statuser</option>
            <option value="ok">OK</option>
            <option value="slitt">Slitt</option>
            <option value="defekt">Defekt</option>
          </select>
          <select style={{ ...st.sel, flex: 1 }} value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
            {categories.map(c => <option key={c} value={c}>{c === "alle" ? "Alle kategorier" : c}</option>)}
          </select>
          {(search || filterStatus !== "alle" || filterCategory !== "alle") && (
            <button style={{ ...st.secondary, padding: "10px 14px", fontSize: 12 }}
              onClick={() => { setSearch(""); setFilterStatus("alle"); setFilterCategory("alle"); }}>
              Nullstill filter
            </button>
          )}
        </div>
      </div>
      <div style={st.main}>
        <div style={{ color: "#555", fontSize: 12, marginBottom: 14 }}>{filtered.length} verktøy vises</div>
        {filtered.map(tool => {
          const calibDays = getDaysUntilCalibration(tool.lastCalibration);
          const calibWarning = tool.calibrationRequired && calibDays !== null && calibDays <= 30;
          return (
            <div key={tool.id} style={st.card}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "#f5a623"; e.currentTarget.style.background = "#111820"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "#222"; e.currentTarget.style.background = "#111118"; }}
              onClick={() => goToDetail(tool, false)}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16, color: "#e8e8e0", marginBottom: 4 }}>
                    {tool.name}
                    {calibWarning && <span style={{ marginLeft: 8, fontSize: 12, color: "#f59e0b" }}>⏰</span>}
                  </div>
                  <div style={{ fontSize: 12, color: "#666" }}>{tool.category}{tool.serialNumber ? ` · ${tool.serialNumber}` : ""}</div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {isAdmin && (
                    <button style={{ ...st.navBtn(false), fontSize: 11, padding: "3px 10px" }}
                      onClick={e => { e.stopPropagation(); goToDetail(tool, true); }}>✏ Rediger</button>
                  )}
                  <span style={st.pill(tool.status)}>{STATUS_CONFIG[tool.status].label}</span>
                </div>
              </div>
              <div style={{ marginTop: 10, display: "flex", gap: 20, flexWrap: "wrap" }}>
                <div>
                  <div style={st.lbl}>Lokasjon</div>
                  <div style={st.val}>
                    {tool.location.type === "tavle" ? "📌 " : tool.location.type === "skap" ? "🗄 " : "📍 "}
                    {tool.location.name}
                    {tool.location.hylle ? ` · ${tool.location.hylle}` : ""}
                    {tool.location.rad ? ` · ${tool.location.rad}` : ""}
                  </div>
                </div>
                {tool.calibrationRequired && (
                  <div>
                    <div style={st.lbl}>Kalibrering</div>
                    <CalibrationBadge dateStr={tool.lastCalibration} />
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: 60, color: "#555" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🔍</div>
            <div>Ingen verktøy funnet</div>
          </div>
        )}
      </div>
    </div>
  );
}
