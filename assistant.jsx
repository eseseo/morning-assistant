import { useState, useEffect, useCallback } from "react";

/* ─────────────────────────────────────────
   상수 & 유틸
───────────────────────────────────────── */
const STORAGE_KEY    = "jy_tasks_v1";
const FILE_HANDLE_KEY = "jy_filehandle_v1";
const GH_TOKEN_KEY   = "jy_gh_token";
const GH_REPO_KEY    = "jy_gh_repo";

/* ─────────────────────────────────────────
   GitHub Sync
───────────────────────────────────────── */
async function syncToGitHub(tasks, token, repo) {
  const path    = "tasks.json";
  const apiBase = `https://api.github.com/repos/${repo}/contents/${path}`;
  const headers = { Authorization: `token ${token}`, "Content-Type": "application/json" };
  const content = btoa(unescape(encodeURIComponent(
    JSON.stringify({ tasks, syncedAt: new Date().toISOString() }, null, 2)
  )));

  // 기존 파일 SHA 조회 (업데이트 시 필요)
  let sha;
  try {
    const r = await fetch(apiBase, { headers });
    if (r.ok) sha = (await r.json()).sha;
  } catch {}

  const res = await fetch(apiBase, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      message: `tasks sync ${new Date().toISOString().slice(0,16)}`,
      content,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  return true;
}

const todayStr = () => new Date().toISOString().split("T")[0];

const fmtDate = (s) => {
  if (!s) return "";
  const d = new Date(s + "T12:00:00");
  return d.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
};

const fmtFull = () =>
  new Date().toLocaleDateString("ko-KR", {
    year: "numeric", month: "long", day: "numeric", weekday: "long",
  });

const fmtTime = () =>
  new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });

const uid = () => Math.random().toString(36).slice(2, 10);

const PRIORITY = {
  high:   { label: "긴급", color: "#ff6b35", glow: "rgba(255,107,53,.3)" },
  medium: { label: "보통", color: "#a3c940", glow: "rgba(163,201,64,.3)" },
  low:    { label: "여유", color: "#6b9e3f", glow: "rgba(107,158,63,.3)" },
};

const CATS = ["업무", "개인", "미팅", "공부", "기타"];

/* ─────────────────────────────────────────
   File System Access API helpers
───────────────────────────────────────── */
async function getStoredHandle() {
  try {
    const db = await openDB();
    return await dbGet(db, FILE_HANDLE_KEY);
  } catch { return null; }
}

async function storeHandle(handle) {
  try {
    const db = await openDB();
    await dbPut(db, FILE_HANDLE_KEY, handle);
  } catch {}
}

function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("jy_assistant", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function dbGet(db, key) {
  return new Promise((res, rej) => {
    const tx = db.transaction("kv", "readonly");
    const r = tx.objectStore("kv").get(key);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function dbPut(db, key, val) {
  return new Promise((res, rej) => {
    const tx = db.transaction("kv", "readwrite");
    const r = tx.objectStore("kv").put(val, key);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

async function writeToFile(handle, tasks) {
  try {
    const writable = await handle.createWritable();
    await writable.write(
      JSON.stringify({ tasks, syncedAt: new Date().toISOString() }, null, 2)
    );
    await writable.close();
    return true;
  } catch { return false; }
}

/* ─────────────────────────────────────────
   Main App
───────────────────────────────────────── */
export default function App() {
  const [tasks, setTasks] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
    catch { return []; }
  });

  const [now, setNow] = useState(fmtTime());
  const [view, setView]         = useState("today");
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId]     = useState(null);
  const [form, setForm]         = useState(blankForm());
  const [fileHandle, setFileHandle]   = useState(null);
  const [syncStatus, setSyncStatus]   = useState("none");
  const [ghToken,    setGhToken]      = useState(() => localStorage.getItem(GH_TOKEN_KEY) || "");
  const [ghRepo,     setGhRepo]       = useState(() => localStorage.getItem(GH_REPO_KEY)  || "");
  const [ghStatus,   setGhStatus]     = useState("idle"); // idle | syncing | ok | err
  const [showGhForm, setShowGhForm]   = useState(false);

  /* 시계 */
  useEffect(() => {
    const t = setInterval(() => setNow(fmtTime()), 30000);
    return () => clearInterval(t);
  }, []);

  /* localStorage 자동 저장 */
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  }, [tasks]);

  /* 파일 핸들 복원 */
  useEffect(() => {
    getStoredHandle().then(async (h) => {
      if (!h) return;
      try {
        const perm = await h.queryPermission({ mode: "readwrite" });
        if (perm === "granted") {
          setFileHandle(h);
          setSyncStatus("ok");
        }
      } catch {}
    });
  }, []);

  /* 파일에 자동 저장 */
  useEffect(() => {
    if (!fileHandle) return;
    writeToFile(fileHandle, tasks).then((ok) =>
      setSyncStatus(ok ? "ok" : "err")
    );
  }, [tasks, fileHandle]);

  /* 파일 연결 */
  const connectFile = useCallback(async () => {
    if (!window.showSaveFilePicker) {
      alert("이 브라우저는 파일 자동 동기화를 지원하지 않아요.\n수동 내보내기 버튼을 사용하세요.");
      return;
    }
    try {
      const h = await window.showSaveFilePicker({
        suggestedName: "tasks.json",
        types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
      });
      await storeHandle(h);
      setFileHandle(h);
      setSyncStatus("ok");
    } catch {}
  }, []);

  /* GitHub 동기화 */
  const handleGhSync = useCallback(async () => {
    if (!ghToken || !ghRepo) { setShowGhForm(true); return; }
    setGhStatus("syncing");
    try {
      await syncToGitHub(tasks, ghToken, ghRepo);
      setGhStatus("ok");
      setTimeout(() => setGhStatus("idle"), 3000);
    } catch {
      setGhStatus("err");
      setTimeout(() => setGhStatus("idle"), 4000);
    }
  }, [tasks, ghToken, ghRepo]);

  const saveGhSettings = () => {
    localStorage.setItem(GH_TOKEN_KEY, ghToken);
    localStorage.setItem(GH_REPO_KEY,  ghRepo);
    setShowGhForm(false);
  };

  /* 수동 내보내기 */
  const exportJSON = () => {
    const blob = new Blob(
      [JSON.stringify({ tasks, exportedAt: new Date().toISOString() }, null, 2)],
      { type: "application/json" }
    );
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(blob),
      download: "tasks.json",
    });
    a.click();
  };

  /* 할 일 CRUD */
  const saveTasks = (fn) => setTasks((prev) => fn(prev));

  const handleSubmit = () => {
    if (!form.title.trim()) return;
    if (editId) {
      saveTasks((p) => p.map((t) => (t.id === editId ? { ...t, ...form } : t)));
    } else {
      saveTasks((p) => [
        ...p,
        { id: uid(), ...form, completed: false, createdAt: new Date().toISOString() },
      ]);
    }
    closeForm();
  };

  const openEdit = (task) => {
    setEditId(task.id);
    setForm({ title: task.title, date: task.date, time: task.time || "",
      priority: task.priority, category: task.category || "업무", notes: task.notes || "" });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditId(null);
    setForm(blankForm());
  };

  const toggle   = (id) => saveTasks((p) => p.map((t) => t.id === id ? { ...t, completed: !t.completed } : t));
  const remove   = (id) => saveTasks((p) => p.filter((t) => t.id !== id));

  /* 뷰 필터 */
  const today   = todayStr();
  const todayT  = tasks.filter((t) => !t.completed && t.date === today);
  const allT    = tasks.filter((t) => !t.completed).sort((a, b) => a.date.localeCompare(b.date));
  const doneT   = tasks.filter((t) => t.completed);
  const viewMap = { today: todayT, all: allT, done: doneT };
  const visible = viewMap[view];

  /* 날짜별 그룹 (전체 뷰) */
  const grouped = view === "all"
    ? [...new Set(allT.map((t) => t.date))].map((d) => ({
        date: d,
        tasks: allT.filter((t) => t.date === d),
      }))
    : null;

  return (
    <div style={S.wrap}>
      {/* ── Header ── */}
      <header style={S.header}>
        <div style={S.hTop}>
          <div>
            <div style={S.brand}>총사령관님 🤘</div>
            <div style={S.dateStr}>{fmtFull()}</div>
          </div>
          <div style={S.clock}>{now}</div>
        </div>

        {/* Stats */}
        <div style={S.stats}>
          {[
            { n: todayT.length, label: "오늘", color: "#39ff14" },
            { n: allT.length,   label: "전체", color: "#00f5ff" },
            { n: doneT.length,  label: "완료", color: "#00e676" },
          ].map(({ n, label, color }) => (
            <div key={label} style={S.stat}>
              <span style={{ color, fontSize: 26, fontWeight: 900, lineHeight: 1, textShadow: `0 0 16px ${color}88` }}>{n}</span>
              <span style={{ color: "#555", fontSize: 11, marginTop: 2 }}>{label}</span>
            </div>
          ))}
        </div>

        {/* Sync status */}
        <div style={S.syncBar}>
          {fileHandle ? (
            <span style={{ color: syncStatus === "ok" ? "#22c55e" : "#39ff14", fontSize: 11 }}>
              {syncStatus === "ok" ? "● 파일 동기화 중" : "● 동기화 오류"}
            </span>
          ) : (
            <button onClick={connectFile} style={S.syncBtn}>
              🔗 파일 연결 (아침 알림 연동)
            </button>
          )}
        </div>
      </header>

      {/* ── Nav ── */}
      <nav style={S.nav}>
        {[["today","📅 오늘"], ["all","📋 전체"], ["done","✅ 완료"]].map(([k, label]) => (
          <button key={k} onClick={() => setView(k)}
            style={{ ...S.navBtn, ...(view === k ? S.navActive : {}) }}>
            {label}
          </button>
        ))}
      </nav>

      {/* ── Main ── */}
      <main style={S.main}>

        {/* Add button */}
        <button
          onClick={() => { if (showForm && !editId) closeForm(); else { closeForm(); setShowForm(true); } }}
          style={S.addBtn}
        >
          {showForm && !editId ? "✕ 취소" : "+ 할 일 추가"}
        </button>

        {/* Form */}
        {showForm && (
          <div style={S.form}>
            <input
              autoFocus
              style={S.inp}
              placeholder="무엇을 해야 하나요?"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <input type="date" style={{ ...S.inp, flex: 1 }}
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
              <input type="time" style={{ ...S.inp, width: 110 }}
                value={form.time}
                onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))} />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <select style={{ ...S.inp, flex: 1 }}
                value={form.priority}
                onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}>
                <option value="high">🔴 긴급</option>
                <option value="medium">🟡 보통</option>
                <option value="low">🔵 여유</option>
              </select>
              <select style={{ ...S.inp, flex: 1 }}
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
                {CATS.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <textarea
              style={{ ...S.inp, minHeight: 64, resize: "vertical" }}
              placeholder="메모 (선택)"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
            <button onClick={handleSubmit} style={S.submitBtn}>
              {editId ? "✏️ 수정 완료" : "+ 추가하기"}
            </button>
          </div>
        )}

        {/* Task list */}
        {visible.length === 0 ? (
          <div style={S.empty}>
            {view === "today" && "오늘 할 일이 없어요 🎉"}
            {view === "all"   && "할 일이 없어요!"}
            {view === "done"  && "완료된 항목이 없어요"}
          </div>
        ) : view === "all" && grouped ? (
          grouped.map(({ date, tasks: gt }) => (
            <div key={date} style={{ marginBottom: 20 }}>
              <div style={S.dateGroup}>
                {date === today ? "📅 오늘 · " : ""}{fmtDate(date)}
              </div>
              {gt.map((t) => (
                <TaskCard key={t.id} task={t} today={today}
                  onToggle={toggle} onDelete={remove} onEdit={openEdit} />
              ))}
            </div>
          ))
        ) : (
          visible.map((t) => (
            <TaskCard key={t.id} task={t} today={today}
              onToggle={toggle} onDelete={remove} onEdit={openEdit} />
          ))
        )}
      </main>

      {/* ── GitHub 설정 모달 ── */}
      {showGhForm && (
        <div style={S.modal}>
          <div style={S.modalBox}>
            <div style={{ color: "#c8dd6a", fontWeight: 900, marginBottom: 12, fontSize: 15 }}>
              🐙 GitHub 설정
            </div>
            <input
              style={{ ...S.inp, marginBottom: 8 }}
              placeholder="Personal Access Token (ghp_...)"
              type="password"
              value={ghToken}
              onChange={(e) => setGhToken(e.target.value)}
            />
            <input
              style={{ ...S.inp, marginBottom: 12 }}
              placeholder="username/repo-name"
              value={ghRepo}
              onChange={(e) => setGhRepo(e.target.value)}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={saveGhSettings} style={{ ...S.submitBtn, flex: 1, padding: "10px" }}>저장</button>
              <button onClick={() => setShowGhForm(false)} style={{ ...S.exportBtn, flex: 1 }}>취소</button>
            </div>
            <div style={{ color: "#2a2a2a", fontSize: 10, marginTop: 10, lineHeight: 1.7 }}>
              Token 권한: Contents (write)<br/>
              github.com → Settings → Developer settings → Fine-grained tokens
            </div>
          </div>
        </div>
      )}

      {/* ── Footer ── */}
      <footer style={S.footer}>
        <button
          onClick={handleGhSync}
          style={{
            ...S.exportBtn,
            color: ghStatus === "ok"  ? "#22c55e"
                 : ghStatus === "err" ? "#39ff14"
                 : "#00e676",
            borderColor: ghStatus === "ok"  ? "#22c55e44"
                       : ghStatus === "err" ? "#39ff1444"
                       : "#00e67644",
          }}
        >
          {ghStatus === "syncing" ? "⏳ 동기화 중..."
         : ghStatus === "ok"      ? "✅ GitHub 완료!"
         : ghStatus === "err"     ? "❌ 동기화 실패"
         : "🐙 GitHub 동기화"}
        </button>
        <button onClick={exportJSON} style={S.exportBtn}>📤 내보내기</button>
        <span style={{ color: "#2a2a2a", fontSize: 11, marginLeft: "auto" }}>{tasks.length}개</span>
      </footer>
    </div>
  );
}

/* ─────────────────────────────────────────
   TaskCard
───────────────────────────────────────── */
function TaskCard({ task, today, onToggle, onDelete, onEdit }) {
  const [open, setOpen] = useState(false);
  const p = PRIORITY[task.priority] || PRIORITY.medium;
  const overdue = !task.completed && task.date && task.date < today;

  return (
    <div style={{
      ...S.card,
      borderLeft: `3px solid ${p.color}`,
      boxShadow: `inset 0 0 0 1px #1a1a1a, -2px 0 8px ${p.glow}`,
      opacity: task.completed ? 0.45 : 1,
    }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        {/* Checkbox */}
        <button onClick={() => onToggle(task.id)} style={S.check}>
          {task.completed ? "✅" : <span style={{ fontSize: 18, color: "#333" }}>○</span>}
        </button>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            ...S.title,
            textDecoration: task.completed ? "line-through" : "none",
            color: task.completed ? "#444" : "#f0f0f0",
          }}>
            {task.title}
          </div>
          <div style={S.meta}>
            {overdue && <span style={{ color: "#39ff14" }}>⚠ 기한 초과 · </span>}
            {task.date && fmtDate(task.date)}
            {task.time && ` ${task.time}`}
            {task.category && (
              <span style={{ marginLeft: 8, color: "#00e676" }}>#{task.category}</span>
            )}
            <span style={{ marginLeft: 8, color: p.color, fontSize: 10 }}>
              {p.label}
            </span>
          </div>
          {task.notes && <div style={S.notes}>{task.notes}</div>}
        </div>

        {/* Menu */}
        <div style={{ position: "relative", flexShrink: 0 }}>
          <button onClick={() => setOpen((v) => !v)} style={S.menuBtn}>⋮</button>
          {open && (
            <div style={S.dropdown} onClick={() => setOpen(false)}>
              <button style={S.ddItem} onClick={() => onEdit(task)}>✏️ 수정</button>
              <button style={{ ...S.ddItem, color: "#39ff14" }} onClick={() => onDelete(task.id)}>
                🗑 삭제
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────
   Helpers
───────────────────────────────────────── */
function blankForm() {
  return { title: "", date: todayStr(), time: "", priority: "medium", category: "업무", notes: "" };
}

/* ─────────────────────────────────────────
   Styles
───────────────────────────────────────── */
const S = {
  wrap: {
    minHeight: "100vh",
    background: "#2c3320",
    color: "#e8edcc",
    fontFamily: "'Courier New', Courier, monospace",
    maxWidth: 480,
    margin: "0 auto",
  },
  header: {
    padding: "24px 20px 14px",
    background: "linear-gradient(180deg,#354028 0%,#2c3320 100%)",
    borderBottom: "1px solid #3d4d28",
  },
  hTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  brand: {
    fontSize: 22,
    fontWeight: 900,
    color: "#c8dd6a",
    letterSpacing: "-0.5px",
    textShadow: "0 0 18px rgba(200,221,106,.4)",
  },
  dateStr: { fontSize: 12, color: "#7a9055", marginTop: 4 },
  clock: {
    fontSize: 30,
    fontWeight: 900,
    color: "#c8dd6a",
    textShadow: "0 0 16px rgba(200,221,106,.35)",
    fontVariantNumeric: "tabular-nums",
  },
  stats: { display: "flex", gap: 10, marginBottom: 12 },
  stat: {
    flex: 1,
    background: "#354028",
    border: "1px solid #3d4d28",
    borderRadius: 8,
    padding: "10px 0",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
  syncBar: { display: "flex", alignItems: "center", minHeight: 28 },
  syncBtn: {
    background: "transparent",
    border: "1px dashed #4a5e30",
    borderRadius: 6,
    color: "#7a9055",
    fontSize: 12,
    padding: "4px 12px",
    cursor: "pointer",
    fontFamily: "inherit",
  },
  nav: { display: "flex", borderBottom: "1px solid #3d4d28" },
  navBtn: {
    flex: 1, padding: "13px 8px",
    background: "transparent", border: "none",
    color: "#7a9055", fontSize: 13, cursor: "pointer",
    fontFamily: "inherit", transition: "all .15s",
  },
  navActive: {
    color: "#c8dd6a",
    borderBottom: "2px solid #c8dd6a",
    background: "rgba(200,221,106,.06)",
  },
  main: { padding: "14px 16px 20px" },
  addBtn: {
    width: "100%", padding: 12, marginBottom: 10,
    background: "transparent",
    border: "1px dashed #4a5e30",
    borderRadius: 8, color: "#a3bc50",
    fontSize: 14, cursor: "pointer",
    fontFamily: "inherit", letterSpacing: ".5px",
    transition: "border-color .2s",
  },
  form: {
    background: "#354028",
    border: "1px solid #3d4d28",
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  inp: {
    background: "#2c3320",
    border: "1px solid #4a5e30",
    borderRadius: 6,
    padding: "10px 12px",
    color: "#e8edcc",
    fontSize: 14,
    fontFamily: "inherit",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  },
  submitBtn: {
    padding: 12,
    background: "#7a9e35",
    border: "none",
    borderRadius: 8,
    color: "#f0f4d8",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
    letterSpacing: ".5px",
    boxShadow: "0 0 20px rgba(122,158,53,.35)",
  },
  dateGroup: {
    fontSize: 11,
    color: "#5a7040",
    letterSpacing: ".5px",
    textTransform: "uppercase",
    marginBottom: 6,
    paddingLeft: 2,
  },
  card: {
    background: "#354028",
    borderRadius: 10,
    padding: "13px 13px",
    marginBottom: 8,
    transition: "opacity .2s",
  },
  title: { fontSize: 15, fontWeight: 600, lineHeight: 1.35, letterSpacing: "-.2px" },
  meta:  { fontSize: 11, color: "#7a9055", marginTop: 4 },
  notes: { fontSize: 12, color: "#5a7040", marginTop: 6, fontStyle: "italic" },
  check: {
    background: "transparent", border: "none",
    cursor: "pointer", fontSize: 18, padding: 0, flexShrink: 0,
    lineHeight: 1,
  },
  menuBtn: {
    background: "transparent", border: "none",
    color: "#5a7040", cursor: "pointer",
    fontSize: 20, padding: "0 4px", lineHeight: 1,
  },
  dropdown: {
    position: "absolute", right: 0, top: "100%",
    background: "#3d4d28",
    border: "1px solid #4a5e30",
    borderRadius: 8, overflow: "hidden",
    zIndex: 100, minWidth: 110,
  },
  ddItem: {
    display: "block", width: "100%",
    padding: "10px 14px",
    background: "transparent", border: "none",
    color: "#c8d8a0", fontSize: 13,
    cursor: "pointer", textAlign: "left",
    fontFamily: "inherit",
  },
  empty: {
    textAlign: "center", color: "#4a5e30",
    padding: "56px 20px", fontSize: 15,
  },
  footer: {
    padding: "14px 20px",
    borderTop: "1px solid #3d4d28",
    display: "flex", alignItems: "center", gap: 12,
  },
  exportBtn: {
    padding: "7px 13px",
    background: "transparent",
    border: "1px solid #4a5e30",
    borderRadius: 6, color: "#7a9055",
    fontSize: 12, cursor: "pointer",
    fontFamily: "inherit",
  },
  modal: {
    position: "fixed", inset: 0,
    background: "rgba(20,26,10,.88)",
    display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 999,
  },
  modalBox: {
    background: "#354028",
    border: "1px solid #4a5e30",
    borderRadius: 14,
    padding: "24px 20px",
    width: "90%", maxWidth: 360,
  },
};
