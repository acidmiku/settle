export function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function todayLocalDate() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function escapeHtml(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Basic markdown: **bold**, *italic*, `code`, links http(s)://
export function renderBasicMarkdown(text) {
  let out = escapeHtml(text);
  out = out.replaceAll(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replaceAll(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replaceAll(/\*([^*]+)\*/g, "<em>$1</em>");
  out = out.replaceAll(
    /(https?:\/\/[^\s<]+)/g,
    (m) => `<a href="${m}" target="_blank" rel="noreferrer">${m}</a>`
  );
  out = out.replaceAll("\n", "<br/>");
  return out;
}

export function isMac() {
  return navigator.platform.toLowerCase().includes("mac");
}

export function modKeyLabel() {
  return isMac() ? "Cmd" : "Ctrl";
}

