type StorageResult = {
  closeOnOutsideClick?: unknown;
  vaultPosition?: unknown;
  vaultSize?: unknown;
};

type VaultPosition = {
  x: number;
  y: number;
};

type VaultSize = {
  width: number;
  height: number;
};

type PanelMessage =
  | { type: "BROWSER_VAULT_CLOSE_ON_OUTSIDE_CLICK"; value: boolean }
  | { type: "BROWSER_VAULT_START_DRAG"; screenX: number; screenY: number }
  | { type: "BROWSER_VAULT_DRAG_MOVE"; screenX: number; screenY: number }
  | { type: "BROWSER_VAULT_END_DRAG" }
  | {
      type: "BROWSER_VAULT_START_RESIZE";
      clientX: number;
      clientY: number;
    }
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
    onChanged: {
      addListener: (
        listener: (
          changes: Record<string, { newValue?: unknown }>,
          areaName: string,
        ) => void,
      ) => void;
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
  let vaultPosition: VaultPosition | null = null;
  let vaultSize: VaultSize | null = null;
  let preferenceLoad: Promise<void> | null = null;
  let toggleQueue = Promise.resolve();
  let movePanelFromFrame: ((clientX: number, clientY: number) => void) | null =
    null;
  let stopMovingPanelFromFrame: (() => void) | null = null;

  const isVaultPosition = (value: unknown): value is VaultPosition =>
    typeof value === "object" &&
    value !== null &&
    "x" in value &&
    "y" in value &&
    typeof value.x === "number" &&
    Number.isFinite(value.x) &&
    typeof value.y === "number" &&
    Number.isFinite(value.y);

  const isVaultSize = (value: unknown): value is VaultSize =>
    typeof value === "object" &&
    value !== null &&
    "width" in value &&
    "height" in value &&
    typeof value.width === "number" &&
    Number.isFinite(value.width) &&
    typeof value.height === "number" &&
    Number.isFinite(value.height);

  const clampSize = (size: VaultSize): VaultSize => ({
    width: Math.min(
      Math.max(300, window.innerWidth - 32),
      Math.max(300, size.width),
    ),
    height: Math.min(
      Math.max(360, window.innerHeight - 32),
      Math.max(360, size.height),
    ),
  });

  const applySize = (size: VaultSize) => {
    if (!host) return;

    const clampedSize = clampSize(size);
    host.style.width = `${clampedSize.width}px`;
    host.style.height = `${clampedSize.height}px`;
  };

  const clampPosition = (position: VaultPosition): VaultPosition => {
    if (!host) return position;

    const maxLeft = Math.max(0, window.innerWidth - host.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - host.offsetHeight);

    return {
      x: Math.min(maxLeft, Math.max(0, position.x)),
      y: Math.min(maxTop, Math.max(0, position.y)),
    };
  };

  const applyPosition = (position: VaultPosition) => {
    if (!host) return;

    const clampedPosition = clampPosition(position);
    host.style.left = `${clampedPosition.x}px`;
    host.style.top = `${clampedPosition.y}px`;
    host.style.right = "auto";
  };

  const savePosition = () => {
    if (!host) return;

    const rect = host.getBoundingClientRect();
    const position = clampPosition({ x: rect.left, y: rect.top });
    vaultPosition = position;
    chrome.storage.local.set({ vaultPosition: position });
  };

  const saveSize = () => {
    if (!host) return;

    const size = clampSize({
      width: host.offsetWidth,
      height: host.offsetHeight,
    });
    vaultSize = size;
    chrome.storage.local.set({ vaultSize: size });
  };

  const loadPreference = () => {
    if (preferenceLoad) return preferenceLoad;

    preferenceLoad = new Promise((resolve) => {
      chrome.storage.local.get(
        {
          closeOnOutsideClick: true,
          vaultPosition: null,
          vaultSize: null,
        },
        (result) => {
          closeOnOutsideClick = Boolean(result.closeOnOutsideClick);
          if (isVaultPosition(result.vaultPosition)) {
            vaultPosition = result.vaultPosition;
          }
          if (isVaultSize(result.vaultSize)) {
            vaultSize = result.vaultSize;
          }
          resolve();
        },
      );
    });

    return preferenceLoad;
  };

  const setVisible = (nextVisible: boolean) => {
    visible = nextVisible;

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
      host = existing as HTMLDivElement;
      frame = host.querySelector("iframe");
      if (vaultSize) applySize(vaultSize);
      if (vaultPosition) applyPosition(vaultPosition);
      return;
    }

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
      border: "1px solid rgba(255, 255, 255, 0.12)",
      borderRadius: "8px",
      background: "transparent",
      pointerEvents: "auto",
      overflow: "hidden",
      resize: "none",
      minWidth: "300px",
      minHeight: "360px",
      maxWidth: "calc(100vw - 32px)",
      maxHeight: "calc(100vh - 32px)",
      boxSizing: "border-box",
    });

    frame = document.createElement("iframe");
    frame.title = "Browser Vault";
    frame.allow = "clipboard-write";
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

    const resizeGrip = document.createElement("div");
    resizeGrip.setAttribute("aria-label", "Resize Browser Vault");

    // resizing icon
    Object.assign(resizeGrip.style, {
      position: "absolute",
      right: "0",
      bottom: "0",
      width: "24px",
      height: "24px",
      zIndex: "1",
      cursor: "nwse-resize",
      background:
        "linear-gradient(135deg, transparent 0 57%, rgba(255,255,255,0.18) 58% 61%, transparent 62% 68%, rgba(255,255,255,0.32) 69% 72%, transparent 73%)",
      touchAction: "none",
    });
    resizeGrip.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      resizeGrip.setPointerCapture(event.pointerId);

      window.postMessage(
        {
          type: "BROWSER_VAULT_START_RESIZE",
          clientX: event.clientX,
          clientY: event.clientY,
        },
        "*",
      );
    });

    host.appendChild(frame);
    host.appendChild(resizeGrip);
    document.documentElement.appendChild(host);

    if (vaultSize) applySize(vaultSize);
    if (vaultPosition) applyPosition(vaultPosition);

  };

  const togglePanel = () => {
    toggleQueue = toggleQueue.then(async () => {
      await loadPreference();
      createPanel();
      setVisible(!visible);
    });
  };

  window.addEventListener("message", (event) => {
    const message: unknown = event.data;
    const resizeFromGrip =
      event.source === window &&
      message &&
      typeof message === "object" &&
      "type" in message &&
      message.type === "BROWSER_VAULT_START_RESIZE";

    if (!frame || (event.source !== frame.contentWindow && !resizeFromGrip)) {
      return;
    }

    if (!message || typeof message !== "object" || !("type" in message)) {
      return;
    }

    const panelMessage = message as PanelMessage;
    if (panelMessage.type === "BROWSER_VAULT_DRAG_MOVE") {
      movePanelFromFrame?.(panelMessage.screenX, panelMessage.screenY);
      return;
    }

    if (panelMessage.type === "BROWSER_VAULT_END_DRAG") {
      stopMovingPanelFromFrame?.();
      return;
    }

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
      return;
    }

    if (panelMessage.type === "BROWSER_VAULT_START_DRAG") {
      stopMovingPanelFromFrame?.();

      const startX = panelMessage.screenX;
      const startY = panelMessage.screenY;
      const startLeft = host?.getBoundingClientRect().left ?? 0;
      const startTop = host?.getBoundingClientRect().top ?? 0;

      const movePanel = (clientX: number, clientY: number) => {
        if (!host) return;

        const width = host.offsetWidth;
        const height = host.offsetHeight;
        const maxLeft = Math.max(0, window.innerWidth - width);
        const maxTop = Math.max(0, window.innerHeight - height);

        host.style.left = `${Math.min(
          maxLeft,
          Math.max(0, startLeft + clientX - startX),
        )}px`;
        host.style.top = `${Math.min(
          maxTop,
          Math.max(0, startTop + clientY - startY),
        )}px`;
        host.style.right = "auto";
      };

      const movePanelFromDocument = (moveEvent: PointerEvent) => {
        movePanel(moveEvent.screenX, moveEvent.screenY);
      };

      const stopMovingPanel = () => {
        if (!movePanelFromFrame && !stopMovingPanelFromFrame) return;

        document.removeEventListener("pointermove", movePanelFromDocument);
        document.removeEventListener("pointerup", stopMovingPanel);
        document.removeEventListener("pointercancel", stopMovingPanel);
        document.documentElement.style.userSelect = "";
        savePosition();
        movePanelFromFrame = null;
        stopMovingPanelFromFrame = null;
      };

      movePanelFromFrame = (screenX, screenY) =>
        movePanel(screenX, screenY);
      stopMovingPanelFromFrame = stopMovingPanel;
      document.documentElement.style.userSelect = "none";
      document.addEventListener("pointermove", movePanelFromDocument);
      document.addEventListener("pointerup", stopMovingPanel, { once: true });
      document.addEventListener("pointercancel", stopMovingPanel, {
        once: true,
      });
      return;
    }

    if (panelMessage.type === "BROWSER_VAULT_START_RESIZE") {
      if (!host) return;

      const startX = panelMessage.clientX;
      const startY = panelMessage.clientY;
      const startWidth = host.offsetWidth;
      const startHeight = host.offsetHeight;
      const maxWidth = Math.max(300, window.innerWidth - 32);
      const maxHeight = Math.max(360, window.innerHeight - 32);

      const resizePanel = (moveEvent: PointerEvent) => {
        if (!host) return;

        host.style.width = `${Math.min(
          maxWidth,
          Math.max(300, startWidth + moveEvent.clientX - startX),
        )}px`;
        host.style.height = `${Math.min(
          maxHeight,
          Math.max(360, startHeight + moveEvent.clientY - startY),
        )}px`;
      };

      const stopResizingPanel = () => {
        document.removeEventListener("pointermove", resizePanel);
        document.removeEventListener("pointerup", stopResizingPanel);
        document.documentElement.style.userSelect = "";
        saveSize();
      };

      document.documentElement.style.userSelect = "none";
      document.addEventListener("pointermove", resizePanel);
      document.addEventListener("pointerup", stopResizingPanel, { once: true });
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
      togglePanel();
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;

    if (isVaultPosition(changes.vaultPosition?.newValue)) {
      vaultPosition = changes.vaultPosition.newValue;
    }

    if (isVaultSize(changes.vaultSize?.newValue)) {
      vaultSize = changes.vaultSize.newValue;
      if (host) {
        applySize(vaultSize);
      }
    }

    if (host && vaultPosition) applyPosition(vaultPosition);
  });

  void loadPreference();
})();
