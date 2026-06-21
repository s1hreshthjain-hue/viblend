// js/pwa.js — PWA install prompt and service worker registration

let deferredInstallPrompt = null;

// ─── Service Worker ───────────────────────────────────────────────────────────

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });

    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      if (!newWorker) return;

      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          // New content available
          showUpdateToast();
        }
      });
    });

    // Push notification scaffold
    await requestPushPermission(reg);

  } catch (e) {
    console.warn('Service worker registration failed:', e);
  }
}

async function requestPushPermission(reg) {
  if (!('PushManager' in window)) return;
  // Only register push after explicit user opt-in (not auto-requesting)
  // This is the scaffold — actual push subscription would go here
  window._pushRegistration = reg;
}

// ─── Install Prompt ───────────────────────────────────────────────────────────

export function initInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    showInstallBanner();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    hideInstallBanner();
  });
}

export async function triggerInstall() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  if (outcome === 'accepted') deferredInstallPrompt = null;
}

function showInstallBanner() {
  let banner = document.getElementById('pwa-install-banner');
  if (banner) { banner.style.display = 'flex'; return; }

  banner = document.createElement('div');
  banner.id = 'pwa-install-banner';
  banner.className = 'pwa-install-banner';
  banner.innerHTML = `
    <span>Install Viblend for the best experience</span>
    <button class="btn-install" onclick="window.viblendPWA?.triggerInstall()">Install</button>
    <button class="btn-dismiss" onclick="this.closest('#pwa-install-banner').style.display='none'">✕</button>
  `;
  document.body.appendChild(banner);
}

function hideInstallBanner() {
  const banner = document.getElementById('pwa-install-banner');
  if (banner) banner.style.display = 'none';
}

function showUpdateToast() {
  const event = new CustomEvent('viblend:toast', {
    detail: { message: 'Update available — refresh to get the latest', duration: 10000 }
  });
  window.dispatchEvent(event);
}

// ─── App Install State ────────────────────────────────────────────────────────

export function isInstalledPWA() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

// ─── Export helper for inline usage ──────────────────────────────────────────

window.viblendPWA = { triggerInstall };
