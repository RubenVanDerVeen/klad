import { createEditor } from "./editor";

const view = createEditor(
  document.getElementById("editor")!,
  () => {},
  () => {},
);
view.focus();
