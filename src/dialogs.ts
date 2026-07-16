const savePrompt = document.getElementById("savePrompt") as HTMLDialogElement;
const savePromptMsg = document.getElementById("savePromptMsg")!;
const errorBox = document.getElementById("errorBox") as HTMLDialogElement;
const errorMsg = document.getElementById("errorMsg")!;

export function askSave(name: string): Promise<"save" | "discard" | "cancel"> {
  savePromptMsg.textContent = `Do you want to save changes to ${name}?`;
  savePrompt.showModal();
  return new Promise((resolve) => {
    const done = (result: "save" | "discard" | "cancel") => {
      savePrompt.close();
      resolve(result);
    };
    document.getElementById("btnSave")!.onclick = () => done("save");
    document.getElementById("btnDiscard")!.onclick = () => done("discard");
    document.getElementById("btnCancel")!.onclick = () => done("cancel");
    savePrompt.oncancel = (e) => {
      e.preventDefault();
      done("cancel");
    };
  });
}

export function showError(message: string): void {
  errorMsg.textContent = message;
  errorBox.showModal();
  document.getElementById("btnErrOk")!.onclick = () => errorBox.close();
}