(() => {
  "use strict";

  const NAV_ID = "admin-student-nav-830";
  const STUDENT_SECTION_ID = "admin-student-management-830";
  const ABOUT_CARD_ID = "admin-about-editor-830";
  const STYLE_ID = "admin-tools-style-830";
  let currentUser = null;
  let booted = false;

  const esc = value => String(value ?? "").replace(/[&<>'"]/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  }[c]));

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .admin-tools-section{max-width:1050px;margin:0 auto;padding:28px 20px 50px}
      .admin-tools-card{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:22px;box-shadow:0 8px 28px rgba(15,23,42,.06);margin-bottom:18px}
      .admin-tools-card h2,.admin-tools-card h3{margin:0 0 7px;color:#111827}
      .admin-tools-sub{margin:0 0 18px;color:#6b7280}
      .admin-tools-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
      .admin-tools-field{display:flex;flex-direction:column;gap:7px}
      .admin-tools-field.full{grid-column:1/-1}
      .admin-tools-field label{font-weight:600;color:#111827}
      .admin-tools-field input,.admin-tools-field textarea{width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid #d1d5db;border-radius:10px;font:inherit;background:#fff}
      .admin-tools-field textarea{min-height:170px;resize:vertical;line-height:1.55}
      .admin-tools-actions{display:flex;align-items:center;gap:10px;margin-top:16px;flex-wrap:wrap}
      .admin-tools-btn{border:0;border-radius:10px;padding:10px 15px;font:inherit;font-weight:700;cursor:pointer;background:#111827;color:#fff}
      .admin-tools-btn.secondary{background:#eef2f7;color:#111827}
      .admin-tools-btn.danger{background:#b91c1c}
      .admin-tools-btn:disabled{opacity:.55;cursor:wait}
      .admin-tools-msg{min-height:20px;font-size:14px}
      .admin-tools-msg.ok{color:#15803d}.admin-tools-msg.error{color:#b91c1c}
      .admin-student-table-wrap{overflow:auto}
      .admin-student-table{width:100%;border-collapse:collapse;min-width:620px}
      .admin-student-table th,.admin-student-table td{padding:12px 10px;border-bottom:1px solid #e5e7eb;text-align:left;vertical-align:middle}
      .admin-student-table th{font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em}
      .admin-student-actions{display:flex;gap:7px;flex-wrap:wrap}
      .admin-role{display:inline-block;padding:4px 8px;border-radius:999px;background:#eef2ff;color:#3730a3;font-size:12px;font-weight:700}
      .admin-cleanup-note{font-size:13px;color:#6b7280;background:#f9fafb;border-radius:10px;padding:12px 14px;line-height:1.5;margin-top:14px}
      @media(max-width:700px){.admin-tools-grid{grid-template-columns:1fr}.admin-tools-field.full{grid-column:auto}}
    `;
    document.head.appendChild(style);
  }

  function findNav(section, text) {
    const direct = document.querySelector(`[data-section="${section}"], [data-page="${section}"]`);
    if (direct) return direct;
    return [...document.querySelectorAll("a,button")].find(el => {
      const t = (el.textContent || "").replace(/\s+/g, " ").trim();
      return new RegExp(text, "i").test(t);
    });
  }

  function hideAllSections(show) {
    document.querySelectorAll(".page-section").forEach(s => {
      s.style.display = s === show ? "block" : "none";
      s.classList.toggle("active", s === show);
    });
  }

  function ensureStudentNav() {
    if (!currentUser || currentUser.role !== "admin") return;
    const existing = findNav("students", "Students");
    if (existing) {
      existing.removeAttribute("data-page");
      existing.setAttribute("data-section", "students");
      if (!existing.dataset.adminToolsBound) {
        existing.dataset.adminToolsBound = "1";
        existing.addEventListener("click", e => {
          e.preventDefault(); e.stopImmediatePropagation(); openStudents();
        }, true);
      }
      return;
    }

    const about = findNav("about", "About");
    if (!about?.parentElement || document.getElementById(NAV_ID)) return;
    const nav = about.cloneNode(true);
    nav.id = NAV_ID;
    nav.textContent = "👥 Students";
    nav.setAttribute("data-section", "students");
    nav.removeAttribute("data-page");
    nav.addEventListener("click", e => { e.preventDefault(); e.stopImmediatePropagation(); openStudents(); }, true);
    about.parentElement.insertBefore(nav, about);
  }

  function studentSection() {
    let section = document.getElementById(STUDENT_SECTION_ID);
    if (section) return section;
    section = document.createElement("section");
    section.id = STUDENT_SECTION_ID;
    section.className = "page-section admin-tools-section";
    section.innerHTML = `
      <div class="admin-tools-card">
        <h2>👥 Student Management</h2>
        <p class="admin-tools-sub">Create student accounts, change their login details, or remove an account.</p>
        <form id="student-create-form" autocomplete="off">
          <div class="admin-tools-grid">
            <div class="admin-tools-field"><label>Student username</label><input name="username" minlength="3" maxlength="50" required></div>
            <div class="admin-tools-field"><label>Initial password</label><input name="password" type="password" minlength="8" autocomplete="new-password" required></div>
          </div>
          <div class="admin-tools-actions"><button class="admin-tools-btn" type="submit">+ Add Student</button><span id="student-create-msg" class="admin-tools-msg" aria-live="polite"></span></div>
        </form>
      </div>
      <div class="admin-tools-card">
        <h3>Student Accounts</h3>
        <div id="student-list-msg" class="admin-tools-msg"></div>
        <div class="admin-student-table-wrap"><table class="admin-student-table"><thead><tr><th>Username</th><th>Role</th><th>Actions</th></tr></thead><tbody id="student-table-body"></tbody></table></div>
      </div>
    `;
    const about = document.querySelector("#about");
    const host = about?.parentElement || document.querySelector("main") || document.body;
    host.appendChild(section);
    section.querySelector("#student-create-form").addEventListener("submit", createStudent);
    return section;
  }

  async function loadStudents() {
    const msg = document.getElementById("student-list-msg");
    const body = document.getElementById("student-table-body");
    if (!msg || !body) return;
    msg.className = "admin-tools-msg"; msg.textContent = "Loading...";
    try {
      const res = await fetch("/api/users", {credentials:"same-origin"});
      const data = await res.json().catch(() => []);
      if (!res.ok) throw new Error(data.error || "Could not load students.");
      const students = (data || []).filter(u => u.role === "student");
      body.innerHTML = students.length ? students.map(u => `
        <tr data-user-id="${Number(u.id)}"><td><strong>${esc(u.username)}</strong></td><td><span class="admin-role">Student</span></td><td><div class="admin-student-actions"><button class="admin-tools-btn secondary" data-action="edit" type="button">Edit</button><button class="admin-tools-btn danger" data-action="delete" type="button">Delete</button></div></td></tr>
      `).join("") : `<tr><td colspan="3">No student accounts yet.</td></tr>`;
      body.querySelectorAll("button[data-action=edit]").forEach(b => b.addEventListener("click", () => editStudent(b.closest("tr"))));
      body.querySelectorAll("button[data-action=delete]").forEach(b => b.addEventListener("click", () => deleteStudent(b.closest("tr"))));
      msg.textContent = `${students.length} student account${students.length === 1 ? "" : "s"}.`;
    } catch (err) {
      msg.className = "admin-tools-msg error"; msg.textContent = err.message || "Could not load students.";
    }
  }

  async function createStudent(e) {
    e.preventDefault();
    const form = e.currentTarget, msg = form.querySelector("#student-create-msg"), btn = form.querySelector("button");
    const username = form.username.value.trim(), password = form.password.value;
    msg.className = "admin-tools-msg"; msg.textContent = "";
    btn.disabled = true; btn.textContent = "Saving...";
    try {
      const res = await fetch("/api/users", {method:"POST", headers:{"Content-Type":"application/json"}, credentials:"same-origin", body:JSON.stringify({username,password})});
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not create student.");
      form.reset(); msg.classList.add("ok"); msg.textContent = `Student "${data.username}" created successfully.`; await loadStudents();
    } catch (err) { msg.classList.add("error"); msg.textContent = err.message || "Could not create student."; }
    finally { btn.disabled = false; btn.textContent = "+ Add Student"; }
  }

  async function editStudent(row) {
    const id = Number(row?.dataset.userId); if (!id) return;
    const oldName = row.querySelector("strong")?.textContent || "";
    const username = prompt("New student username:", oldName);
    if (username === null) return;
    const password = prompt("New password (leave blank to keep current password):", "");
    if (password === null) return;
    if (!username.trim() && !password) return alert("Please enter a username or password.");
    if (password && password.length < 8) return alert("Password must be at least 8 characters.");
    try {
      const res = await fetch(`/api/users/${id}`, {method:"PUT", headers:{"Content-Type":"application/json"}, credentials:"same-origin", body:JSON.stringify({username:username.trim(), password})});
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not update student.");
      await loadStudents(); alert("Student account updated successfully.");
    } catch (err) { alert(err.message || "Could not update student."); }
  }

  async function deleteStudent(row) {
    const id = Number(row?.dataset.userId); if (!id) return;
    const username = row.querySelector("strong")?.textContent || "this student";
    if (!confirm(`Delete student account "${username}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/users/${id}`, {method:"DELETE", credentials:"same-origin"});
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not delete student.");
      await loadStudents();
    } catch (err) { alert(err.message || "Could not delete student."); }
  }

  function openStudents() {
    if (!currentUser || currentUser.role !== "admin") return;
    const section = studentSection();
    hideAllSections(section); loadStudents();
  }

  function addAboutEditor() {
    if (!currentUser || currentUser.role !== "admin") return;
    const about = document.querySelector("#about");
    if (!about || document.getElementById(ABOUT_CARD_ID)) return;
    const card = document.createElement("div");
    card.id = ABOUT_CARD_ID; card.className = "admin-tools-card";
    card.innerHTML = `
      <h3>✏️ Edit About</h3>
      <p class="admin-tools-sub">This information is stored in Supabase and is visible to logged-in users.</p>
      <form id="admin-about-form" autocomplete="off">
        <div class="admin-tools-grid">
          <div class="admin-tools-field full"><label>About title</label><input name="title" required></div>
          <div class="admin-tools-field full"><label>About content</label><textarea name="content" placeholder="Write something about your Cantonese Learning app..."></textarea></div>
        </div>
        <div class="admin-tools-actions"><button class="admin-tools-btn" type="submit">Save About</button><span id="admin-about-msg" class="admin-tools-msg" aria-live="polite"></span></div>
      </form>`;
    about.appendChild(card);
    card.querySelector("form").addEventListener("submit", saveAbout);
    loadAboutForm();
  }

  async function loadAboutForm() {
    const card = document.getElementById(ABOUT_CARD_ID); if (!card) return;
    try {
      const res = await fetch("/api/about", {credentials:"same-origin"}); const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load About.");
      card.querySelector("[name=title]").value = data.title || "";
      card.querySelector("[name=content]").value = data.content || "";
    } catch (err) { const m = card.querySelector("#admin-about-msg"); m.className="admin-tools-msg error"; m.textContent=err.message; }
  }

  async function saveAbout(e) {
    e.preventDefault();
    const form = e.currentTarget, msg=form.querySelector("#admin-about-msg"), btn=form.querySelector("button");
    msg.className="admin-tools-msg"; msg.textContent=""; btn.disabled=true; btn.textContent="Saving...";
    try {
      const res = await fetch("/api/about", {method:"PUT", headers:{"Content-Type":"application/json"}, credentials:"same-origin", body:JSON.stringify({title:form.title.value.trim(), content:form.content.value})});
      const data=await res.json().catch(()=>({})); if(!res.ok) throw new Error(data.error || "Could not save About.");
      msg.classList.add("ok"); msg.textContent="About information saved successfully.";
    } catch(err){ msg.classList.add("error"); msg.textContent=err.message || "Could not save About."; }
    finally{ btn.disabled=false; btn.textContent="Save About"; }
  }

  function cleanupDemoCredentials() {
    const terms = ["admin123", "student123"];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes=[]; let n; while((n=walker.nextNode())) nodes.push(n);
    nodes.forEach(node => {
      const text=node.nodeValue || "";
      if (terms.some(t => text.toLowerCase().includes(t))) {
        const parent=node.parentElement;
        if (parent && /demo|admin|student|login/i.test(parent.textContent || "")) parent.remove();
        else node.nodeValue=text.replace(/admin123|student123/gi, "");
      }
    });
  }

  async function boot() {
    if (booted) return; booted=true;
    try {
      const res=await fetch("/api/me",{credentials:"same-origin"}); const data=await res.json(); currentUser=data.user||null;
      if(currentUser?.role !== "admin") return;
      addStyles(); ensureStudentNav(); addAboutEditor(); cleanupDemoCredentials();
    } catch(_) {}
  }

  document.addEventListener("click", e => {
    const students = e.target.closest('[data-section="students"], [data-page="students"]');
    if(students && currentUser?.role === "admin") { e.preventDefault(); e.stopImmediatePropagation(); openStudents(); }
  }, true);

  window.addEventListener("load", () => setTimeout(boot, 350));
  new MutationObserver(() => {
    if(currentUser?.role === "admin") { ensureStudentNav(); addAboutEditor(); cleanupDemoCredentials(); }
  }).observe(document.documentElement,{childList:true,subtree:true});
})();
