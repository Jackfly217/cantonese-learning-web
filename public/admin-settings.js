(() => {
  "use strict";

  const NAV_ID = "admin-settings-nav";
  const SECTION_ID = "admin-settings-section";
  const STYLE_ID = "admin-settings-style";
  let currentUser = null;
  let booting = false;

  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  }[c]));

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .admin-settings-section{max-width:760px;margin:0 auto;padding:28px 20px 50px}
      .admin-settings-card{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:24px;box-shadow:0 8px 28px rgba(15,23,42,.06)}
      .admin-settings-card h2{margin:0 0 7px}
      .admin-settings-card .sub{margin:0 0 22px;color:#6b7280}
      .admin-settings-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
      .admin-settings-field{display:flex;flex-direction:column;gap:7px}
      .admin-settings-field.full{grid-column:1/-1}
      .admin-settings-field label{font-weight:600;color:#111827}
      .admin-settings-field input{width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid #d1d5db;border-radius:10px;font:inherit;background:#fff}
      .admin-settings-field input:focus{outline:none;border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.12)}
      .admin-settings-actions{display:flex;align-items:center;gap:12px;margin-top:20px;flex-wrap:wrap}
      .admin-settings-save{border:0;border-radius:10px;padding:11px 17px;font:inherit;font-weight:700;cursor:pointer;background:#111827;color:#fff}
      .admin-settings-save:disabled{opacity:.6;cursor:wait}
      .admin-settings-message{min-height:20px;font-size:14px}
      .admin-settings-message.ok{color:#15803d}
      .admin-settings-message.error{color:#b91c1c}
      .admin-settings-note{margin-top:18px;padding:12px 14px;border-radius:10px;background:#f9fafb;color:#6b7280;font-size:13px;line-height:1.5}
      @media (max-width:700px){.admin-settings-grid{grid-template-columns:1fr}.admin-settings-field.full{grid-column:auto}}
    `;
    document.head.appendChild(style);
  }

  function findAboutNav() {
    // The existing app uses navigation items with data-section attributes
    // and emoji labels (for example: "ℹ️ About"), so do not rely on an
    // exact text match. Prefer the real About nav item when available.
    const bySection = document.querySelector('[data-section="about"], [data-page="about"]');
    if (bySection && bySection.offsetParent !== null) return bySection;

    return [...document.querySelectorAll("a,button")].find(el => {
      if (el.offsetParent === null) return false;
      const text = (el.textContent || "").replace(/\s+/g, " ").trim();
      return /(^|\s)About$/i.test(text) || /About/i.test(text);
    });
  }

  function addNavButton() {
    if (!currentUser || currentUser.role !== "admin") return;
    if (document.getElementById(NAV_ID)) return;

    const about = findAboutNav();
    if (!about || !about.parentElement) return;

    const nav = about.cloneNode(true);
    nav.id = NAV_ID;
    nav.removeAttribute("href");
    nav.removeAttribute("data-page");
    nav.removeAttribute("data-section");
    nav.removeAttribute("aria-current");
    nav.textContent = "⚙ Settings";
    nav.setAttribute("data-section", "admin-settings");
    nav.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      openSettings();
    });

    about.parentElement.appendChild(nav);
  }

  function findPageSections() {
    return [...document.querySelectorAll(".page-section")];
  }

  function getSettingsSection() {
    let section = document.getElementById(SECTION_ID);
    if (section) return section;

    section = document.createElement("section");
    section.id = SECTION_ID;
    section.className = "page-section admin-settings-section";
    section.innerHTML = `
      <div class="admin-settings-card">
        <h2>⚙ Admin Settings</h2>
        <p class="sub">Change the administrator username and password.</p>
        <form id="admin-settings-form" autocomplete="off">
          <div class="admin-settings-grid">
            <div class="admin-settings-field full">
              <label for="admin-settings-current-password">Current password</label>
              <input id="admin-settings-current-password" name="currentPassword" type="password" autocomplete="current-password" required>
            </div>
            <div class="admin-settings-field full">
              <label for="admin-settings-username">New username</label>
              <input id="admin-settings-username" name="username" type="text" minlength="3" maxlength="50" autocomplete="username" required>
            </div>
            <div class="admin-settings-field">
              <label for="admin-settings-new-password">New password</label>
              <input id="admin-settings-new-password" name="newPassword" type="password" minlength="8" autocomplete="new-password" placeholder="Leave blank to keep current password">
            </div>
            <div class="admin-settings-field">
              <label for="admin-settings-confirm-password">Confirm new password</label>
              <input id="admin-settings-confirm-password" name="confirmPassword" type="password" minlength="8" autocomplete="new-password">
            </div>
          </div>
          <div class="admin-settings-actions">
            <button class="admin-settings-save" type="submit">Save Changes</button>
            <span id="admin-settings-message" class="admin-settings-message" aria-live="polite"></span>
          </div>
          <div class="admin-settings-note">
            Your current password is required for every change. Passwords are stored securely as bcrypt hashes; the password itself is never saved in the database.
          </div>
        </form>
      </div>
    `;

    const aboutSection = document.querySelector("#about");
    const host = aboutSection?.parentElement || document.querySelector("main") || document.body;
    host.appendChild(section);

    const form = section.querySelector("#admin-settings-form");
    form.addEventListener("submit", saveSettings);
    return section;
  }

  function closeSettings() {
    const section = document.getElementById(SECTION_ID);
    if (!section) return;
    section.style.display = "none";
    section.classList.remove("active");
  }

  function openSettings() {
    if (!currentUser || currentUser.role !== "admin") return;
    const section = getSettingsSection();
    const sections = findPageSections();
    for (const item of sections) {
      item.style.display = item === section ? "block" : "none";
      item.classList.toggle("active", item === section);
    }
    section.style.display = "block";
    section.classList.add("active");

    const username = section.querySelector("#admin-settings-username");
    if (username && !username.value) username.value = currentUser.username || "";
    section.querySelector("#admin-settings-current-password")?.focus();
  }

  async function saveSettings(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = form.querySelector("#admin-settings-message");
    const save = form.querySelector("button[type=submit]");
    const currentPassword = form.querySelector("[name=currentPassword]").value;
    const username = form.querySelector("[name=username]").value.trim();
    const newPassword = form.querySelector("[name=newPassword]").value;
    const confirmPassword = form.querySelector("[name=confirmPassword]").value;

    message.className = "admin-settings-message";
    message.textContent = "";

    if (newPassword && newPassword !== confirmPassword) {
      message.classList.add("error");
      message.textContent = "New passwords do not match.";
      return;
    }

    save.disabled = true;
    save.textContent = "Saving...";

    try {
      const res = await fetch("/api/account", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ currentPassword, username, newPassword, confirmPassword })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not update the account.");

      currentUser = data.user || currentUser;
      form.querySelector("[name=currentPassword]").value = "";
      form.querySelector("[name=newPassword]").value = "";
      form.querySelector("[name=confirmPassword]").value = "";
      form.querySelector("[name=username]").value = currentUser.username || username;
      message.classList.add("ok");
      message.textContent = "Saved successfully. Your new login details are active now.";
    } catch (err) {
      message.classList.add("error");
      message.textContent = err.message || "Could not update the account.";
    } finally {
      save.disabled = false;
      save.textContent = "Save Changes";
    }
  }

  async function loadUser() {
    try {
      const res = await fetch("/api/me", { credentials: "same-origin" });
      const data = await res.json();
      currentUser = data.user || null;
      if (currentUser?.role === "admin") {
        addStyles();
        addNavButton();
      } else {
        document.getElementById(NAV_ID)?.remove();
        document.getElementById(SECTION_ID)?.remove();
      }
    } catch (_) {}
  }

  function watchNavigation() {
    document.addEventListener("click", (event) => {
      if (event.target.closest(`#${NAV_ID}`)) return;
      if (event.target.closest("a,button")) closeSettings();
    }, true);
  }

  async function boot() {
    if (booting) return;
    booting = true;
    try {
      await loadUser();
      if (currentUser?.role === "admin") addNavButton();
    } finally {
      booting = false;
    }
  }

  watchNavigation();
  window.addEventListener("load", () => setTimeout(boot, 250));
  new MutationObserver(() => {
    if (!document.getElementById(NAV_ID) && currentUser?.role === "admin") addNavButton();
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
