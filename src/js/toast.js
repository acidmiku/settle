export function toast(message, { kind = "info", timeoutMs = 3000 } = {}) {
  const host = document.getElementById("toasts");
  if (!host) return;
  const el = document.createElement("div");
  el.className = `toast ${kind === "error" ? "is-error" : ""}`;
  el.textContent = message;
  host.appendChild(el);
  window.setTimeout(() => {
    el.remove();
  }, timeoutMs);
}

