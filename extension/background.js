// On toolbar click: inject the bundle into the current tab (activeTab grants access only
// to the tab the user clicked on, only until it navigates), then toggle the overlay.
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id === undefined) return;
  const target = { tabId: tab.id };
  await chrome.scripting.executeScript({ target, files: ['tov-full.js'] });
  await chrome.scripting.executeScript({ target, func: () => window.TabOrderViz.toggle() });
});
