export const ACCESS_HELP = 'Chrome is withholding website access. Open this extension’s Details and choose On all sites under Site access.';

export function permittedPage(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
        || url.hostname === 'chromewebstore.google.com'
        || (url.hostname === 'chrome.google.com' && /^\/webstore(?:\/|$)/.test(url.pathname))) return null;
    return url;
  } catch {
    return null;
  }
}

export function originPattern(url) {
  return `${url.protocol}//${url.hostname}/*`;
}

export function isCurrentTab(tab, target) {
  return tab.id === target.tabId && tab.windowId === target.windowId && tab.active
    && tab.url === target.url && !tab.pendingUrl && tab.status === 'complete';
}

export function hasSiteAccess(url) {
  return chrome.permissions.contains({ origins: [originPattern(url)] });
}

export async function inspectPage(tab, focused) {
  if (!tab) return { site: '—', status: 'No active tab.' };
  const url = permittedPage(tab.url);
  const site = url?.origin ?? '—';
  if (tab.url && !url) return { site, status: 'Gesture controls are unavailable on this restricted page.' };
  if (!focused) return { site, status: 'Focus this Chrome window to control its active tab.' };
  if (tab.status !== 'complete' || tab.pendingUrl) return { site, status: 'Waiting for the page to finish loading.' };
  // Chrome can hide the tab URL when host access is withheld. Avoid reading it
  // through the broader tabs permission just to tell these cases apart.
  if (!url) return {
    site, status: 'Chrome hid the tab URL. For ordinary sites, choose On all sites in this extension’s Details. Restricted pages remain unavailable.',
  };
  if (!(await hasSiteAccess(url))) return { site, status: ACCESS_HELP };
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [0] }, func: () => location.href,
    });
    if (!result?.documentId || result.result !== tab.url) {
      return { site, status: 'The active page changed. Checking again…' };
    }
    return { site, status: 'Accessible in Chrome',
      target: { tabId: tab.id, windowId: tab.windowId, url: tab.url, documentId: result.documentId } };
  } catch {
    return { site, status: 'Chrome blocked this page. Check On all sites in the extension’s Details; some pages are restricted.' };
  }
}
