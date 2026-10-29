import { CaptureStore } from '../features/network-capture/store';
const capture = new CaptureStore();
chrome.devtools.network.onRequestFinished.addListener(capture.accept);
chrome.devtools.panels.create(
  'ReproForge',
  'icons/icon32.png',
  'panel.html',
  (panel) => {
    panel.onShown.addListener((win) => {
      const target = win as Window;
      target.__reproforge = capture;
      target.dispatchEvent(new Event('reproforge-ready'));
    });
  },
);
