type ChromeTab = {
  id?: number;
};

type ChromeMessage = {
  type: "BROWSER_VAULT_TOGGLE";
};

type ChromeApi = {
  commands: {
    onCommand: {
      addListener: (listener: (command: string) => void) => void;
    };
  };
  action: {
    onClicked: {
      addListener: (listener: (tab: ChromeTab) => void) => void;
    };
  };
  tabs: {
    sendMessage: (tabId: number, message: ChromeMessage) => Promise<unknown>;
    query: (queryInfo: {
      active: boolean;
      lastFocusedWindow: boolean;
    }) => Promise<ChromeTab[]>;
    create: (createProperties: { url: string }) => Promise<unknown>;
  };
  runtime: {
    getURL: (path: string) => string;
  };
  scripting: {
    executeScript: (details: {
      target: { tabId: number };
      files: string[];
    }) => Promise<unknown>;
  };
};

declare const chrome: ChromeApi;

export {};

const togglePanel = async (tabId: number) => {
  console.log("[Browser Vault background] tab ID received:", tabId);

  try {
    console.log("[Browser Vault background] first tabs.sendMessage");
    await chrome.tabs.sendMessage(tabId, {
      type: "BROWSER_VAULT_TOGGLE",
    });
    console.log("[Browser Vault background] first tabs.sendMessage succeeded");
  } catch (error) {
    console.error(
      "[Browser Vault background] first tabs.sendMessage failed:",
      error instanceof Error ? error.message : error,
    );

    try {
      console.log("[Browser Vault background] scripting.executeScript");
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      });
      console.log("[Browser Vault background] scripting.executeScript succeeded");

      console.log("[Browser Vault background] second tabs.sendMessage");
      await chrome.tabs.sendMessage(tabId, {
        type: "BROWSER_VAULT_TOGGLE",
      });
      console.log("[Browser Vault background] second tabs.sendMessage succeeded");
    } catch (error) {
      console.error(
        "[Browser Vault background] executeScript or second tabs.sendMessage failed:",
        error instanceof Error ? error.message : error,
      );

      await chrome.tabs.create({ url: chrome.runtime.getURL("index.html") });
    }
  }
};

const handleCommand = (command: string, tab: ChromeTab | undefined) => {
  if (command !== "open-browser-vault") {
    return;
  }

  if (tab?.id === undefined) {
    console.error("[Browser Vault background] command tab ID is undefined");
    return;
  }

  void togglePanel(tab.id);
};

chrome.commands.onCommand.addListener((command) => {
  console.log("[Browser Vault background] chrome.commands.onCommand fired");

  void chrome.tabs
    .query({ active: true, lastFocusedWindow: true })
    .then((tabs) => handleCommand(command, tabs[0]));
});

chrome.action.onClicked.addListener((tab) => {
  console.log("[Browser Vault background] chrome.action.onClicked fired");

  if (tab.id === undefined) {
    console.error("[Browser Vault background] tab ID is undefined");
    return;
  }

  void togglePanel(tab.id);
});
