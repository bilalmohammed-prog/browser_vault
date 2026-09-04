type ChromeTab = {
  id?: number;
};

type ChromeMessage = {
  type: "BROWSER_VAULT_TOGGLE";
};

type ChromeApi = {
  action: {
    onClicked: {
      addListener: (listener: (tab: ChromeTab) => void) => void;
    };
  };
  tabs: {
    sendMessage: (tabId: number, message: ChromeMessage) => Promise<unknown>;
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
    }
  }
};

chrome.action.onClicked.addListener((tab) => {
  console.log("[Browser Vault background] chrome.action.onClicked fired");

  if (tab.id === undefined) {
    console.error("[Browser Vault background] tab ID is undefined");
    return;
  }

  void togglePanel(tab.id);
});
