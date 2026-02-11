function requireTauri() {
  if (!window.__TAURI__ || !window.__TAURI__.core) {
    throw new Error(
      "Tauri API not available. Ensure `withGlobalTauri: true` and you are running inside the Tauri app."
    );
  }
  return window.__TAURI__;
}

export async function invoke(command, args = {}) {
  const tauri = requireTauri();
  return await tauri.core.invoke(command, args);
}

export async function listen(eventName, handler) {
  const tauri = requireTauri();
  return await tauri.event.listen(eventName, handler);
}

