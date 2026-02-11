export function createConfirmController() {
  const modalEl = document.getElementById("confirm-modal");
  const titleEl = document.getElementById("confirm-title");
  const messageEl = document.getElementById("confirm-message");
  const btnOk = document.getElementById("confirm-ok");
  const btnCancel = document.getElementById("confirm-cancel");

  if (!modalEl || !titleEl || !messageEl || !btnOk || !btnCancel) {
    // Graceful fallback for dev mishaps.
    return {
      confirm: async ({ message }) => window.confirm(String(message || "Are you sure?")),
      close: () => {},
      isOpen: () => false,
    };
  }

  let resolver = null;

  const close = (value) => {
    modalEl.classList.remove("is-open");
    modalEl.setAttribute("aria-hidden", "true");
    const r = resolver;
    resolver = null;
    r?.(value);
  };

  modalEl.addEventListener("click", (e) => {
    const t = e.target;
    const closeBtn = t?.closest?.('[data-close="confirm"]');
    if (closeBtn) close(false);
  });

  btnCancel.addEventListener("click", () => close(false));
  btnOk.addEventListener("click", () => close(true));

  window.addEventListener("keydown", (e) => {
    if (!modalEl.classList.contains("is-open")) return;
    if (e.key === "Escape") {
      e.preventDefault();
      close(false);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      close(true);
    }
  });

  const confirm = async ({
    title = "Confirm",
    message = "Are you sure?",
    confirmText = "Confirm",
    cancelText = "Cancel",
    danger = false,
  } = {}) => {
    titleEl.textContent = String(title);
    messageEl.textContent = String(message);
    btnOk.textContent = String(confirmText);
    btnCancel.textContent = String(cancelText);
    btnOk.classList.toggle("btn-danger", !!danger);
    btnOk.classList.toggle("btn-accent", !danger);
    modalEl.classList.add("is-open");
    modalEl.setAttribute("aria-hidden", "false");

    // Focus confirm button (keyboard-friendly).
    setTimeout(() => btnOk.focus(), 0);

    return await new Promise((resolve) => {
      resolver = resolve;
    });
  };

  return {
    confirm,
    close: () => close(false),
    isOpen: () => modalEl.classList.contains("is-open"),
  };
}

let singleton = null;

export async function confirmDialog(options) {
  // Prefer the shared instance if app.js created it.
  const existing = window.__SETTLE_CONFIRM__;
  if (existing?.confirm) {
    singleton = existing;
  }
  if (!singleton) {
    singleton = createConfirmController();
    window.__SETTLE_CONFIRM__ = singleton;
  }
  return await singleton.confirm(options);
}

