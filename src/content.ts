type StorageResult = {
  closeOnOutsideClick?: unknown;
};

type PanelMessage =
  | { type: "BROWSER_VAULT_CLOSE_ON_OUTSIDE_CLICK"; value: boolean }
  | { type: "BROWSER_VAULT_REQUEST_CLOSE_ON_OUTSIDE_CLICK" }
  | { type: "BROWSER_VAULT_SET_CLOSE_ON_OUTSIDE_CLICK"; value: unknown }
  | { type: "BROWSER_VAULT_TOGGLE" };

type ChromeApi = {
  runtime: {
    getURL: (path: string) => string;
    onMessage: {
      addListener: (listener: (message: PanelMessage) => void) => void;
    };
  };
  storage: {
    local: {
      get: (
        defaults: StorageResult,
        callback: (result: StorageResult) => void,
      ) => void;
      set: (values: StorageResult) => void;
    };
  };
};

declare const chrome: ChromeApi;

export {};

(() => {
  const HOST_ID = "browser-vault-host";
  const PANEL_WIDTH = 440;
  const PANEL_HEIGHT = 680;

  let host: HTMLDivElement | null = null;
  let frame: HTMLIFrameElement | null = null;
  let visible = false;
  let closeOnOutsideClick = true;
  let preferenceLoad: Promise<void> | null = null;
  let toggleQueue = Promise.resolve();

  const loadPreference = () => {
    if (preferenceLoad) return preferenceLoad;

    preferenceLoad = new Promise((resolve) => {
      chrome.storage.local.get({ closeOnOutsideClick: true }, (result) => {
        closeOnOutsideClick = Boolean(result.closeOnOutsideClick);
        resolve();
      });
    });

    return preferenceLoad;
  };

  const setVisible = (nextVisible: boolean) => {
    visible = nextVisible;
    console.log("[Browser Vault content] toggling visibility:", visible);

    if (host) {
      host.style.display = visible ? "block" : "none";
    }

    if (visible) {
      frame?.contentWindow?.postMessage(
        {
          type: "BROWSER_VAULT_CLOSE_ON_OUTSIDE_CLICK",
          value: closeOnOutsideClick,
        },
        "*",
      );
    }
  };

  const createPanel = () => {
    const existing = document.getElementById(HOST_ID);
    if (existing) {
      console.log("[Browser Vault content] reusing floating host");
      host = existing as HTMLDivElement;
      frame = host.querySelector("iframe");
      return;
    }

    console.log("[Browser Vault content] creating floating host");
    host = document.createElement("div");
    host.id = HOST_ID;

    Object.assign(host.style, {
      position: "fixed",
      top: "16px",
      right: "16px",
      width: `${PANEL_WIDTH}px`,
      height: `${PANEL_HEIGHT}px`,
      zIndex: "2147483647",
      display: "none",
      margin: "0",
      padding: "0",
      border: "0",
      background: "transparent",
      pointerEvents: "auto",
    });

    console.log("[Browser Vault content] creating iframe");
    frame = document.createElement("iframe");
    frame.title = "Browser Vault";
    frame.src = chrome.runtime.getURL("index.html");
    frame.setAttribute("frameborder", "0");
    frame.setAttribute("scrolling", "no");

    Object.assign(frame.style, {
      display: "block",
      width: "100%",
      height: "100%",
      margin: "0",
      padding: "0",
      border: "0",
      background: "transparent",
    });

    host.appendChild(frame);
    document.documentElement.appendChild(host);

  };

  const togglePanel = () => {
    toggleQueue = toggleQueue.then(async () => {
      await loadPreference();
      createPanel();
      setVisible(!visible);
    });
  };

  window.addEventListener("message", (event) => {
    if (!frame || event.source !== frame.contentWindow) return;

    const message: unknown = event.data;

    if (!message || typeof message !== "object" || !("type" in message)) {
      return;
    }

    const panelMessage = message as PanelMessage;

    if (
      panelMessage.type ===
      "BROWSER_VAULT_REQUEST_CLOSE_ON_OUTSIDE_CLICK"
    ) {
      frame?.contentWindow?.postMessage(
        {
          type: "BROWSER_VAULT_CLOSE_ON_OUTSIDE_CLICK",
          value: closeOnOutsideClick,
        },
        "*",
      );
      return;
    }

    if (
      panelMessage.type ===
      "BROWSER_VAULT_SET_CLOSE_ON_OUTSIDE_CLICK"
    ) {
      closeOnOutsideClick = Boolean(panelMessage.value);

      chrome.storage.local.set({
        closeOnOutsideClick,
      });
    }
  });

  document.addEventListener(
    "mousedown",
    (event) => {
      if (!visible || !closeOnOutsideClick || !host) return;

      const target = event.target;
      if (target instanceof Node && host.contains(target)) return;

      setVisible(false);
    },
    true,
  );

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "BROWSER_VAULT_TOGGLE") {
      console.log("[Browser Vault content] received BROWSER_VAULT_TOGGLE");
      togglePanel();
    }
  });

  console.log("[Browser Vault content] initialized");
  void loadPreference();
})();
