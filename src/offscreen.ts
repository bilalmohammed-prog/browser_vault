type CopyMessage = {
  type: "BROWSER_VAULT_OFFSCREEN_COPY";
  text: string;
};

type ChromeApi = {
  runtime: {
    onMessage: {
      addListener: (
        listener: (
          message: CopyMessage,
          sender: unknown,
          sendResponse: (response: { success: boolean }) => void,
        ) => boolean | void,
      ) => void;
    };
  };
};

declare const chrome: ChromeApi;

export {};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "BROWSER_VAULT_OFFSCREEN_COPY") return;

  console.log("[Vault Copy] Offscreen: received COPY");
  console.log("[Vault Copy] Offscreen: attempting clipboard write");
  let textarea: HTMLTextAreaElement | null = null;
  try {
    textarea = document.createElement("textarea");
    textarea.value = message.text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    const success = document.execCommand("copy");

    if (success) {
      console.log("[Vault Copy] Offscreen: clipboard write succeeded");
    } else {
      console.error("[Vault Copy] Offscreen: clipboard write failed", {
        reason: "document.execCommand(\"copy\") returned false",
      });
    }
    sendResponse({ success });
  } catch (error) {
    console.error("[Vault Copy] Offscreen: clipboard write failed", error);
    sendResponse({ success: false });
  } finally {
    textarea?.remove();
  }

  return true;
});