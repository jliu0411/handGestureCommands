(() => {
  const installed = globalThis.handGestureControlsListener;
  if (installed) {
    if (!chrome.runtime.onMessage.hasListener(installed)) chrome.runtime.onMessage.addListener(installed);
    return;
  }

  const risk = /\b(?:buy|purchase|checkout|orders?|pay(?:ment|ments)?|billing|invoices?|cart|basket|donate|delete|remove|destroy|erase|cancel|submit|confirm|approve|authorize|accept|decline|sign\s*(?:in|out|up)|log\s*(?:in|out)|register|auth|oauth|password|account|transfer|send|unsubscribe|subscribe|download|settings|admin|reset|save|edit|change|update|create|add|export|revoke|actions?|api)\b/i;
  const ignore = 'form, [role="button"], [role="menuitem"], [role="dialog"], dialog, [contenteditable], [inert], [aria-hidden="true"], [aria-disabled="true"], [onclick], [data-method], [data-confirm], [data-action]';
  const outline = '3px solid #1375e5';
  let selection = null;
  let timeout;
  let scrolling = null;
  let lastScrollStop = -Infinity;
  let stoppedRun = null;
  let lastStart = -Infinity;

  function respondToScroll(active, ok, message) {
    for (const respond of active.waiting.splice(0)) respond({ ok, message });
  }

  function stopScroll(message = 'Scrolling stopped before the page moved.') {
    const active = scrolling;
    scrolling = null;
    if (!active) return;
    cancelAnimationFrame(active.frame);
    clearTimeout(active.timer);
    respondToScroll(active, false, message);
  }

  function refreshLease(active, issuedAt, expiresAt) {
    active.issuedAt = issuedAt;
    active.expiresAt = expiresAt;
    clearTimeout(active.timer);
    active.timer = setTimeout(() => {
      if (scrolling === active && Date.now() >= active.expiresAt) stopScroll('The scroll lease expired.');
    }, Math.max(0, Math.ceil(expiresAt - Date.now())));
  }

  function tick(now) {
    const active = scrolling;
    if (!active || Date.now() >= active.expiresAt || document.hidden) {
      stopScroll('The scroll prediction expired or the page is hidden.');
      return;
    }
    if (active.previous !== null) {
      active.pixels += active.speed * Math.min(now - active.previous, 50) / 1000;
      const top = Math.trunc(active.pixels);
      if (top) {
        try {
          if (!scroll(top)) {
            stopScroll('The page cannot scroll farther in that direction.');
            return;
          }
        } catch (error) {
          stopScroll(error?.message || String(error));
          return;
        }
        active.pixels -= top;
        active.moved = true;
        respondToScroll(active, true, active.speed < 0 ? 'Scrolled up' : 'Scrolled down');
      }
    }
    active.previous = now;
    active.frame = requestAnimationFrame(tick);
  }

  function safeLink(anchor) {
    const href = anchor?.getAttribute('href')?.trim();
    if (!href || !anchor.isConnected || anchor.closest(ignore) || anchor.hasAttribute('download')
        || (anchor.target && anchor.target.toLowerCase() !== '_self') || anchor.hasAttribute('ping')
        || href.startsWith('#') || !anchor.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return null;
    try {
      const url = new URL(anchor.href);
      if (url.origin !== location.origin || !['https:', 'http:'].includes(url.protocol)
          || url.search || url.username || url.password || url.href === location.href
          || /\.(?:zip|exe|pdf|msi|dmg|pkg|docx?|csv)($|\/)/i.test(url.pathname)) return null;
      const label = (anchor.textContent || anchor.getAttribute('aria-label') || '').trim();
      const description = [label, anchor.getAttribute('aria-label'), anchor.title, decodeURIComponent(url.pathname)]
        .join(' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[^\p{L}]+/gu, ' ');
      const style = getComputedStyle(anchor);
      return label && !risk.test(description) && style.visibility === 'visible'
        && style.pointerEvents !== 'none' ? { url: url.href, label: label.slice(0, 80) } : null;
    } catch {
      return null;
    }
  }

  function clear() {
    if (!selection) return;
    const { anchor, appliedOutline, previousOutline, previousOffset, outlinePriority, offsetPriority } = selection;
    if (anchor.style.outline === appliedOutline) anchor.style.setProperty('outline', previousOutline, outlinePriority);
    if (anchor.style.outlineOffset === '3px') anchor.style.setProperty('outline-offset', previousOffset, offsetPriority);
    clearTimeout(timeout);
    selection = null;
  }

  function highlight() {
    const anchors = Array.from(document.querySelectorAll('a[href]')).filter(anchor => safeLink(anchor));
    if (!anchors.length) {
      clear();
      return { ok: false, message: 'No eligible links on this page.' };
    }
    const nextIndex = (anchors.indexOf(selection?.anchor) + 1) % anchors.length;
    clear();
    const anchor = anchors[nextIndex];
    const link = safeLink(anchor);
    if (!link) return { ok: false, message: 'The link changed.' };
    selection = {
      anchor, ...link, previousOutline: anchor.style.outline, previousOffset: anchor.style.outlineOffset,
      outlinePriority: anchor.style.getPropertyPriority('outline'),
      offsetPriority: anchor.style.getPropertyPriority('outline-offset'),
    };
    anchor.style.setProperty('outline', outline, 'important');
    selection.appliedOutline = anchor.style.outline;
    anchor.style.setProperty('outline-offset', '3px', 'important');
    anchor.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    timeout = setTimeout(clear, 12000);
    return { ok: true, message: `Highlighted ${link.label}` };
  }

  function scroll(top) {
    const center = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    for (let element = center; element && element !== document.body; element = element.parentElement) {
      if (element === document.scrollingElement || !/^(auto|scroll|overlay)$/.test(getComputedStyle(element).overflowY)) continue;
      const room = top < 0 ? element.scrollTop : element.scrollHeight - element.clientHeight - element.scrollTop;
      if (room > 1) {
        const previous = element.scrollTop;
        element.scrollBy({ top, behavior: 'instant' });
        if (element.scrollTop !== previous) return true;
      }
    }
    const previous = window.scrollY;
    window.scrollBy({ top, behavior: 'instant' });
    return window.scrollY !== previous;
  }

  function execute({ command, speed, expiresAt, issuedAt, stoppedAt, runId }, respond) {
    const start = command === 'START_SCROLL_UP' || command === 'START_SCROLL_DOWN';
    if (!start && command !== 'UPDATE_SCROLL' && command !== 'STOP_SCROLL') stopScroll();
    switch (command) {
      case 'START_SCROLL_UP':
      case 'START_SCROLL_DOWN':
      case 'UPDATE_SCROLL': {
        if (typeof runId !== 'string' || !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)
            || expiresAt <= Date.now() || ((!stoppedRun || stoppedRun === runId) && issuedAt <= lastScrollStop)) {
          respond({ ok: false, message: 'Scroll lease expired or scrolling was cancelled.' });
          break;
        }
        if (scrolling && Date.now() >= scrolling.expiresAt) stopScroll('The scroll lease expired.');
        if (start && scrolling?.id !== runId) {
          if (!Number.isFinite(speed) || speed < 1 || speed > 1000 || issuedAt <= lastStart) {
            respond({ ok: false, message: 'Scroll start is stale or the speed is invalid.' });
            break;
          }
          const signedSpeed = command === 'START_SCROLL_UP' ? -speed : speed;
          stopScroll();
          lastStart = issuedAt;
          scrolling = { id: runId, speed: signedSpeed, previous: null, pixels: 0, waiting: [],
            frame: requestAnimationFrame(tick) };
        }
        if (scrolling?.id !== runId || issuedAt < scrolling.issuedAt) {
          respond({ ok: false, message: 'The scroll session is no longer active or the update is stale.' });
          break;
        }
        refreshLease(scrolling, issuedAt, expiresAt);
        if (scrolling.moved) {
          respond({ ok: true, message: scrolling.speed < 0 ? 'Scrolling up' : 'Scrolling down' });
          break;
        }
        scrolling.waiting.push(respond);
        return true;
      }
      case 'STOP_SCROLL':
        stoppedRun = runId ?? null;
        lastScrollStop = stoppedAt ?? Date.now();
        if (!runId || scrolling?.id === runId) stopScroll();
        respond({ ok: true, message: 'Scrolling stopped' });
        break;
      case 'highlight':
        respond(highlight());
        break;
      case 'activate': {
        const link = safeLink(selection?.anchor);
        if (!link || link.url !== selection.url || link.label !== selection.label) {
          clear();
          respond({ ok: false, message: 'Highlight an eligible link first. The selection may have expired.' });
          break;
        }
        clear();
        location.assign(link.url);
        respond({ ok: true, message: `Opened ${link.label}` });
        break;
      }
      case 'clear':
        clear();
        respond({ ok: true, message: 'Selection cleared' });
        break;
      default:
        respond({ ok: false, message: 'Unknown content-script command.' });
    }
  }

  function releasePage() {
    stopScroll();
    clear();
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) releasePage(); });
  window.addEventListener('pagehide', releasePage);
  const listener = (message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || sender.tab || message?.scope !== 'hand-gesture-controls') return;
    if (message.pageUrl !== location.href
        || (message.command !== 'STOP_SCROLL' && document.visibilityState !== 'visible')) {
      respond({ ok: false, message: 'The active page changed.' });
      return;
    }
    try {
      return execute(message, respond);
    } catch (error) {
      respond({ ok: false, message: error?.message || String(error) });
    }
  };
  chrome.runtime.onMessage.addListener(listener);
  globalThis.handGestureControlsListener = listener;
})();
