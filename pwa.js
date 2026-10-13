// ─────────────────────────────────────────────────────────────────────
// PWA install support — kept separate from app.js on purpose so none of
// the cash-up, dashboard or photo-upload code is touched.
//
//  • Registers the service worker (sw.js).
//  • Android / desktop Chrome & Edge: shows "Download App" once the
//    browser says the app is installable, and opens the install prompt.
//  • iPhone / iPad: shows "Download App", which opens a short
//    "Share → Add to Home Screen" hint (iOS has no install prompt).
//  • Hidden when already running as an installed app.
// ─────────────────────────────────────────────────────────────────────
(function () {
  'use strict';

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function (err) {
        console.warn('Service worker registration failed:', err);
      });
    });
  }

  var installBtn = document.getElementById('installAppBtn');
  var iosHint = document.getElementById('iosInstallHint');
  var iosHintClose = document.getElementById('iosInstallHintClose');
  if (!installBtn) return;

  var isStandalone =
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    window.navigator.standalone === true;

  var ua = window.navigator.userAgent || '';
  var isIOS = /iphone|ipad|ipod/i.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1); // iPadOS reports as Mac

  var deferredPrompt = null;

  if (isStandalone) return; // already installed — never show the button

  if (isIOS) installBtn.hidden = false;

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.hidden = false;
  });

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    installBtn.hidden = true;
  });

  installBtn.addEventListener('click', function () {
    if (deferredPrompt) {
      var p = deferredPrompt;
      deferredPrompt = null;
      p.prompt();
      p.userChoice.then(function (choice) {
        if (choice && choice.outcome === 'accepted') installBtn.hidden = true;
      }).catch(function () {});
      return;
    }
    if (isIOS && iosHint) {
      iosHint.hidden = false;
      return;
    }
    // Browser hasn't offered installation (e.g. Firefox, or criteria not met yet)
    alert('To install, open this page in Chrome (Android) or Safari (iPhone) and use the browser menu to add it to your home screen.');
  });

  function closeHint() { if (iosHint) iosHint.hidden = true; }
  if (iosHintClose) iosHintClose.addEventListener('click', closeHint);
  if (iosHint) {
    iosHint.addEventListener('click', function (e) { if (e.target === iosHint) closeHint(); });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && iosHint && !iosHint.hidden) closeHint();
  });
})();
