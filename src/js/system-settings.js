import { invoke, listen } from './api.js';
import { $ } from './utils.js';

export function createSystemSettings(runtime, installUpdate) {
  const startup = $('set-start-with-os'), startupStatus = $('startup-status');
  const check = $('btn-check-update'), install = $('btn-install-update'), status = $('update-status');
  let startupEnabled = false, startupBusy = false, available = null, updating = false;
  $('app-version').textContent = `Settle ${runtime.version}`;

  async function refreshStartup() {
    if (startupBusy) return;
    startupBusy = true; startup.disabled = true;
    try {
      startupEnabled = await invoke('get_start_with_os');
      startup.checked = startupEnabled; startup.disabled = false;
      startupStatus.textContent = '';
    } catch (error) {
      startupStatus.textContent = `Could not read startup setting: ${error}. Reopen Settings to retry.`;
    } finally { startupBusy = false; }
  }
  startup.onchange = async () => {
    startupBusy = true; startup.disabled = true;
    try {
      startupEnabled = await invoke('set_start_with_os', {enabled:startup.checked});
      startupStatus.textContent = startupEnabled ? 'Settle will open when you sign in.' : 'Start with OS is off.';
    } catch (error) { startupStatus.textContent = `Could not change startup setting: ${error}`; }
    finally { startup.checked = startupEnabled; startup.disabled = false; startupBusy = false; }
  };

  check.onclick = async () => {
    if (updating) return;
    check.disabled = true; install.hidden = true; available = null;
    $('update-notes').textContent = '';
    status.textContent = 'Checking for updates…';
    try {
      available = await invoke('check_for_update');
      status.textContent = available ? `Version ${available.version} is available.` : 'You’re up to date.';
      if (available) {
        install.hidden = false;
        $('update-notes').textContent = available.notes || '';
      }
    } catch (error) { status.textContent = `Could not check for updates: ${error}. Try again.`; }
    finally { check.disabled = false; }
  };
  install.onclick = async () => {
    if (!available || updating) return;
    updating = true; check.disabled = true; install.disabled = true;
    status.textContent = 'Saving drafts and downloading update…';
    let unlisten;
    try {
      unlisten = await listen('settle:update-progress', ({payload}) => {
        if (payload.phase === 'installing') status.textContent = 'Installing update. Settle will restart…';
        else if (payload.total) status.textContent = `Downloading update… ${Math.min(100,Math.floor(payload.downloaded / payload.total * 100))}%`;
        else status.textContent = `Downloading update… ${(payload.downloaded / 1048576).toFixed(1)} MB`;
      });
      await installUpdate();
      status.textContent = 'Restarting Settle…';
    } catch (error) {
      status.textContent = `Could not install update: ${error}. Your drafts are kept. Try again.`;
      updating = false; check.disabled = false; install.disabled = false;
    } finally { unlisten?.(); }
  };
  return {refreshStartup};
}
