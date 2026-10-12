// ==UserScript==
// @name           YT Mini Player for Zen
// @description    Adds Search and Queue from the YT Mini Player extension to Zen's media card.
// @author         hfzizz
// @version        0.2.2
// @include        main
// ==/UserScript==

// Zen mod (userChrome script, loaded by Sine or fx-autoconfig).
//
// Zen's media card (#zen-media-controls-toolbar, cloned from
// #zen-media-card-template) is part of the browser UI, which extensions can't
// touch. This script adds two buttons to each card. Clicking one grows the card
// upwards and shows the YT Mini Player extension's Search / Queue panel inside
// it. The panel is an extension page (src/zen/panel.html) in an embedded
// <browser>, so all the logic stays in the extension; this file only does UI
// plumbing. Next/previous on the card already follow the extension's queue via
// the Media Session API.
//
// Troubleshooting: open the Browser Console (Ctrl+Shift+J) and filter for
// "YT Mini". On startup this script logs "YT Mini (Zen mod) loaded (v<version>)".

(function () {
  'use strict';

  if (window.__ytMiniZen) return;
  window.__ytMiniZen = true;

  const LOG = 'YT Mini (Zen mod):';
  const EXTENSION_ID = 'yt-mini-player@hfzizz';
  const PANEL_PATH = 'src/zen/panel.html';
  const FALLBACK_PATH = 'src/window/window.html';
  const OPEN_ATTR = 'ytmini-open';
  const VIEW_ATTR = 'data-ytmini-view'; // XUL elements have no `dataset`
  const POLICY_POLL_MS = 3000;
  const FIND_TOOLBAR_TRIES = 60; // x 250ms = 15s
  const STYLE_ID = 'ytmini-zen-style';
  const VERSION = '0.2.2'; // keep in sync with theme.json

  // Same rules as userChrome.css. Injected by the script too, so the mod works
  // even if the mod manager doesn't load the stylesheet.
  const CSS = `
.ytmini-zen-buttons { align-items: center; }
.ytmini-zen-search, .ytmini-zen-queue {
  list-style-image: var(--ytmini-icon);
  -moz-context-properties: fill, fill-opacity;
  fill: currentColor;
}
.ytmini-zen-search {
  --ytmini-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='context-fill' d='M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z'/%3E%3C/svg%3E");
}
.ytmini-zen-queue {
  --ytmini-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='context-fill' d='M3 10h11v2H3zm0-4h11v2H3zm0 8h7v2H3zm13-1v8l6-4z'/%3E%3C/svg%3E");
}
.ytmini-zen-search[checked], .ytmini-zen-queue[checked] {
  background-color: color-mix(in srgb, currentColor 16%, transparent) !important;
  border-radius: 6px;
}
#zen-media-controls-toolbar[ytmini-missing] .ytmini-zen-buttons { display: none; }
/* Narrow sidebars. The controls row doesn't wrap and its buttons are a fixed
   26px, so our two extra buttons push it out of the card. Measured against the
   card's inner width: below 220px drop Zen's artwork/focus button (Zen itself
   does this below 165px) and tighten the gaps; below 172px move our buttons up
   to the title row, next to PiP / close. */
.zen-media-main-vbox { container: ytmini-card / inline-size; }
.ytmini-zen-buttons-top { display: none; }
@container ytmini-card (min-width: 172px) and (max-width: 219px) {
  .zen-media-controls-hbox:has(.ytmini-zen-buttons-row) { gap: 0.4rem; }
  .zen-media-card:not([media-sharing]) .zen-media-controls-hbox:has(.ytmini-zen-buttons-row) .zen-media-focus-button {
    display: none;
  }
}
@container ytmini-card (max-width: 171px) {
  .ytmini-zen-buttons-top { display: flex; }
  .zen-media-card:has(.ytmini-zen-buttons-top) .ytmini-zen-buttons-row { display: none; }
  .zen-media-info-container:has(.ytmini-zen-buttons-top) .zen-media-info-vbox {
    width: auto !important;
    flex: 1 1 0 !important;
    min-width: 1px;
  }
}
.ytmini-zen-slot { height: 0; overflow: hidden; opacity: 0; transition: height 0.18s ease, opacity 0.18s ease; }
.zen-media-card[ytmini-open] .ytmini-zen-slot {
  height: 330px;
  opacity: 1;
  margin-bottom: 6px;
  padding-bottom: 6px;
  border-bottom: 1px solid color-mix(in srgb, currentColor 14%, transparent);
}
.ytmini-zen-slot > browser { min-height: 0; background: transparent; }
/* Zen gives the media bar a fixed height and stacks the cards on top of each
   other, fanning them out upwards over the tab list on hover. While our panel
   is open let the bar grow so it pushes the tab list up instead of covering it,
   and lay the stack out flat like on hover: otherwise the cards behind slide
   down behind the (now much taller) open card and leave an empty gap above it. */
#zen-media-controls-toolbar:has(.zen-media-card[ytmini-open]) { height: auto !important; }
#zen-media-controls-toolbar:has(.zen-media-card[ytmini-open]) .zen-media-card:not([zen-removing], [zen-hiding]) {
  transform: none !important;
  opacity: 1 !important;
}
/* Keep the title / progress rows visible while the panel is open (Zen shows them on hover). */
.zen-media-card[ytmini-open] .show-on-hover {
  max-height: 50px !important;
  opacity: 1 !important;
  padding: 5px !important;
}
.ytmini-zen-presence {
  position: fixed; width: 1px; height: 1px; opacity: 0; pointer-events: none; overflow: hidden;
}
`;

  let ExtensionParent = null;
  let toolbar = null;
  let policy; // undefined until the first check, then the policy or null
  let presence = null; // hidden extension page: tells the extension the mod is active
  let embedFailed = false;

  // ---------- Styles ----------

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElementNS('http://www.w3.org/1999/xhtml', 'style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  // ---------- Extension pages inside chrome ----------

  // Same setup Firefox uses for extension popups / sidebar panels: a remote
  // browser in the extension process, registered with the WebExtension API
  // manager so the page gets the `browser.*` APIs.
  function createExtensionBrowser(parent, url) {
    const b = document.createXULElement('browser');
    const remote = WebExtensionPolicy.useRemoteWebExtensions;
    b.setAttribute('type', 'content');
    b.setAttribute('disableglobalhistory', 'true');
    b.setAttribute('messagemanagergroup', 'webext-browsers');
    b.setAttribute('webextension-view-type', 'sidebar');
    b.setAttribute('transparent', 'true');
    b.setAttribute('flex', '1');
    if (remote) {
      b.setAttribute('remote', 'true');
      b.setAttribute('remoteType', typeof E10SUtils !== 'undefined' ? E10SUtils.EXTENSION_REMOTE_TYPE : 'extension');
      b.setAttribute('maychangeremoteness', 'true');
    }
    b.setAttribute('initialBrowsingContextGroupId', String(policy.browsingContextGroupId));
    parent.appendChild(b);
    ExtensionParent.apiManager.emit('extension-browser-inserted', b);
    b.fixupAndLoadURIString(url, { triggeringPrincipal: policy.extension.principal });
    return b;
  }

  function currentPolicy() {
    const p = WebExtensionPolicy.getByID(EXTENSION_ID);
    return p && p.active && p.extension ? p : null;
  }

  // Track the extension being installed, enabled, disabled or reloaded.
  function refreshPolicy() {
    const p = currentPolicy();
    if (p === policy) return;
    policy = p;
    toolbar.toggleAttribute('ytmini-missing', !policy);
    if (presence) {
      presence.remove();
      presence = null;
    }
    // Panels from a previous extension instance are dead; drop them.
    for (const card of toolbar.querySelectorAll(`.zen-media-card[${OPEN_ATTR}]`)) closeCard(card);
    for (const slot of toolbar.querySelectorAll('.ytmini-zen-slot')) slot.replaceChildren();
    if (!policy) {
      console.warn(LOG, `extension ${EXTENSION_ID} not found or disabled; buttons hidden`);
      return;
    }
    try {
      const holder = document.createXULElement('vbox');
      holder.className = 'ytmini-zen-presence';
      document.documentElement.appendChild(holder);
      presence = holder;
      createExtensionBrowser(holder, `${policy.getURL(PANEL_PATH)}?presence=1`);
      embedFailed = false;
    } catch (e) {
      console.error(LOG, 'could not embed the extension page', e);
      embedFailed = true;
    }
  }

  // ---------- Card patching ----------

  function makeButton(view, label) {
    const b = document.createXULElement('toolbarbutton');
    b.setAttribute('class', `ytmini-zen-${view} toolbarbutton-1`);
    b.setAttribute('tooltiptext', label);
    b.setAttribute('aria-label', label);
    b.setAttribute(VIEW_ATTR, view);
    return b;
  }

  function makeGroup(where) {
    const group = document.createXULElement('hbox');
    group.setAttribute('class', `ytmini-zen-buttons ytmini-zen-buttons-${where}`);
    group.append(makeButton('search', 'Search YouTube'), makeButton('queue', 'Queue'));
    return group;
  }

  const guardedSlots = new WeakSet();

  // Zen switches to the card's tab on any mousedown in the card that isn't on a
  // button. Keep clicks inside our panel (search results, queue items) from
  // reaching it, or every click would jump to the YouTube tab, which in turn
  // hides the card. Cards are cloned from the template, which doesn't copy
  // listeners, so this runs for every card.
  function guardSlot(card) {
    const slot = card.querySelector('.ytmini-zen-slot');
    if (!slot || guardedSlots.has(slot)) return;
    guardedSlots.add(slot);
    slot.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  // Zen hides a card while its own tab is selected. Close our panel when that
  // happens: Zen measures the front card when the bar reappears and keeps that
  // as the bar's height, so a card that came back open would leave the bar
  // ~330px tall (covering the tab list) once the panel was closed.
  function closeIfHidden(card) {
    if (card.hasAttribute(OPEN_ATTR) && (card.hidden || card.hasAttribute('zen-hiding') || card.hasAttribute('zen-removing'))) {
      closeCard(card);
    }
  }

  // Adds our buttons + panel slot to a card (or to the card template). The
  // buttons go in the controls row; a second copy sits in the title row (next
  // to PiP / close) and CSS shows it instead when the sidebar is too narrow.
  function patch(root) {
    try {
      const controls = root.querySelector('.zen-media-controls-hbox');
      const main = root.querySelector('.zen-media-main-vbox');
      if (!controls || !main || controls.querySelector('.ytmini-zen-search')) return;
      const mute = controls.querySelector('.zen-media-mute-button');
      controls.insertBefore(makeGroup('row'), mute ? mute.nextSibling : null);
      const topButtons = root.querySelector('.zen-media-info-container .zen-media-buttons-hbox');
      if (topButtons) topButtons.insertBefore(makeGroup('top'), topButtons.firstChild);
      const slot = document.createXULElement('vbox');
      slot.setAttribute('class', 'ytmini-zen-slot');
      main.insertBefore(slot, main.firstChild);
    } catch (e) {
      console.error(LOG, 'could not add buttons to a media card', e);
    }
  }

  function panelUrl(card, view) {
    const cs = getComputedStyle(card);
    const params = new URLSearchParams({ fg: cs.color, accent: accentColor(), bg: backgroundOf(card) });
    return `${policy.getURL(PANEL_PATH)}?${params}#${view}`;
  }

  function accentColor() {
    const probe = document.createXULElement('box');
    probe.setAttribute('style', 'color: var(--zen-primary-color, #ff0033)');
    document.documentElement.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }

  function backgroundOf(el) {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      if (bg && bg !== 'transparent' && !/^rgba\(.*,\s*0\)$/.test(bg)) return bg;
    }
    return 'transparent';
  }

  function openCard(card, view) {
    for (const other of toolbar.querySelectorAll(`.zen-media-card[${OPEN_ATTR}]`)) {
      if (other !== card) closeCard(other);
    }
    const slot = card.querySelector('.ytmini-zen-slot');
    if (!slot) return;
    let b = slot.querySelector('browser');
    if (!b) {
      b = createExtensionBrowser(slot, panelUrl(card, view));
    } else {
      // Same-document hash change: switches the panel view without reloading.
      b.fixupAndLoadURIString(`${b.currentURI.spec.split('#')[0]}#${view}`, {
        triggeringPrincipal: policy.extension.principal,
      });
    }
    card.setAttribute(OPEN_ATTR, view);
    syncButtons(card);
  }

  function closeCard(card) {
    card.removeAttribute(OPEN_ATTR);
    syncButtons(card);
  }

  function syncButtons(card) {
    const open = card.getAttribute(OPEN_ATTR);
    for (const b of card.querySelectorAll(`[${VIEW_ATTR}]`)) {
      b.toggleAttribute('checked', b.getAttribute(VIEW_ATTR) === open);
    }
  }

  function onCommand(event) {
    const button = event.target.closest && event.target.closest(`[${VIEW_ATTR}]`);
    if (!button) return;
    event.stopPropagation();
    try {
      refreshPolicy();
      if (!policy) return;
      if (embedFailed) {
        // Embedding isn't possible in this build: open the full player in a tab instead.
        gBrowser.selectedTab = gBrowser.addTab(policy.getURL(FALLBACK_PATH), {
          triggeringPrincipal: policy.extension.principal,
        });
        return;
      }
      const card = button.closest('.zen-media-card');
      if (!card) return;
      const view = button.getAttribute(VIEW_ATTR);
      if (card.getAttribute(OPEN_ATTR) === view) closeCard(card);
      else openCard(card, view);
    } catch (e) {
      console.error(LOG, 'button failed', e);
    }
  }

  // ---------- Startup ----------

  function init() {
    toolbar = document.getElementById('zen-media-controls-toolbar');
    const template = document.getElementById('zen-media-card-template');
    if (!toolbar || !template) return false;

    patch(template.content);
    for (const card of toolbar.querySelectorAll('.zen-media-card')) {
      patch(card);
      guardSlot(card);
    }
    new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes') {
          if (m.target === toolbar) {
            if (toolbar.hidden) {
              for (const card of toolbar.querySelectorAll(`.zen-media-card[${OPEN_ATTR}]`)) closeCard(card);
            }
          } else if (m.target.classList.contains('zen-media-card')) {
            closeIfHidden(m.target);
          }
          continue;
        }
        for (const n of m.addedNodes) {
          if (n.nodeType === 1 && n.classList.contains('zen-media-card')) {
            patch(n);
            guardSlot(n);
          }
        }
      }
    }).observe(toolbar, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden', 'zen-hiding', 'zen-removing'],
    });

    // Capture phase: handle our buttons before Zen's card handler sees the event.
    toolbar.addEventListener('command', onCommand, true);

    refreshPolicy();
    setInterval(() => {
      try {
        refreshPolicy();
      } catch (e) {
        console.error(LOG, e);
      }
    }, POLICY_POLL_MS);
    return true;
  }

  async function start() {
    try {
      if (typeof gBrowser !== 'undefined' && gBrowser.delayedStartupPromise) {
        await gBrowser.delayedStartupPromise;
      }
      ({ ExtensionParent } = ChromeUtils.importESModule('resource://gre/modules/ExtensionParent.sys.mjs'));
      injectStyles();
      // Zen's media controls may be created a little after the window loads.
      for (let i = 0; i < FIND_TOOLBAR_TRIES; i++) {
        if (init()) {
          console.info(LOG.replace(':', ''), `loaded (v${VERSION})`);
          return;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      console.warn(LOG, "Zen's media controls (#zen-media-controls-toolbar) not found; is this Zen Browser?");
    } catch (e) {
      console.error(LOG, 'failed to start', e);
    }
  }

  start();
})();
