import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";

export interface MenuActions {
  newFile(): void;
  openFile(): void;
  saveFile(): void;
  saveFileAs(): void;
  exit(): void;
}

export async function setupMenu(actions: MenuActions): Promise<void> {
  const fileMenu = await Submenu.new({
    text: "File",
    items: [
      await MenuItem.new({ id: "new", text: "New", accelerator: "CmdOrCtrl+N", action: actions.newFile }),
      await MenuItem.new({ id: "open", text: "Open\u2026", accelerator: "CmdOrCtrl+O", action: actions.openFile }),
      await MenuItem.new({ id: "save", text: "Save", accelerator: "CmdOrCtrl+S", action: actions.saveFile }),
      await MenuItem.new({ id: "saveAs", text: "Save As\u2026", accelerator: "CmdOrCtrl+Shift+S", action: actions.saveFileAs }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await MenuItem.new({ id: "exit", text: "Exit", action: actions.exit }),
    ],
  });

  const editMenu = await Submenu.new({
    text: "Edit",
    items: [
      await PredefinedMenuItem.new({ item: "Undo" }),
      await PredefinedMenuItem.new({ item: "Redo" }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await PredefinedMenuItem.new({ item: "Cut" }),
      await PredefinedMenuItem.new({ item: "Copy" }),
      await PredefinedMenuItem.new({ item: "Paste" }),
      await PredefinedMenuItem.new({ item: "SelectAll" }),
    ],
  });

  const menu = await Menu.new({ items: [fileMenu, editMenu] });
  await menu.setAsAppMenu();
}
