import {
  CheckMenuItem,
  Menu,
  MenuItem,
  PredefinedMenuItem,
  Submenu,
} from "@tauri-apps/api/menu";

export interface MenuActions {
  newFile(): void;
  openFile(): void;
  saveFile(): void;
  saveFileAs(): void;
  print(): void;
  exit(): void;
  find(): void;
  replace(): void;
  goToLine(): void;
  setWrap(on: boolean): void;
  zoomIn(): void;
  zoomOut(): void;
  zoomReset(): void;
  chooseFont(): void;
}

export interface MenuHandles {
  wrapItem: CheckMenuItem;
}

export async function setupMenu(
  actions: MenuActions,
  initialWrap: boolean,
): Promise<MenuHandles> {
  const fileMenu = await Submenu.new({
    text: "File",
    items: [
      await MenuItem.new({ id: "new", text: "New", accelerator: "CmdOrCtrl+N", action: actions.newFile }),
      await MenuItem.new({ id: "open", text: "Open…", accelerator: "CmdOrCtrl+O", action: actions.openFile }),
      await MenuItem.new({ id: "save", text: "Save", accelerator: "CmdOrCtrl+S", action: actions.saveFile }),
      await MenuItem.new({ id: "saveAs", text: "Save As…", accelerator: "CmdOrCtrl+Shift+S", action: actions.saveFileAs }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await MenuItem.new({ id: "print", text: "Print…", accelerator: "CmdOrCtrl+P", action: actions.print }),
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
      await PredefinedMenuItem.new({ item: "Separator" }),
      await MenuItem.new({ id: "find", text: "Find…", accelerator: "CmdOrCtrl+F", action: actions.find }),
      await MenuItem.new({ id: "replace", text: "Replace…", accelerator: "CmdOrCtrl+H", action: actions.replace }),
      await MenuItem.new({ id: "goto", text: "Go to Line…", accelerator: "CmdOrCtrl+G", action: actions.goToLine }),
    ],
  });

  let wrapItem: CheckMenuItem | undefined;
  wrapItem = await CheckMenuItem.new({
    id: "wrap",
    text: "Word Wrap",
    checked: initialWrap,
    action: async () => actions.setWrap(await wrapItem!.isChecked()),
  });

  // NOTE for integration: SP-2 also adds an item to this View submenu
  // (Markdown Preview). On merge, keep wrap/zoom first, preview after.
  const viewMenu = await Submenu.new({
    text: "View",
    items: [
      wrapItem,
      await PredefinedMenuItem.new({ item: "Separator" }),
      await MenuItem.new({ id: "zoomIn", text: "Zoom In", accelerator: "CmdOrCtrl+=", action: actions.zoomIn }),
      await MenuItem.new({ id: "zoomOut", text: "Zoom Out", accelerator: "CmdOrCtrl+-", action: actions.zoomOut }),
      await MenuItem.new({ id: "zoomReset", text: "Restore Default Zoom", accelerator: "CmdOrCtrl+0", action: actions.zoomReset }),
    ],
  });

  const formatMenu = await Submenu.new({
    text: "Format",
    items: [
      await MenuItem.new({ id: "font", text: "Font…", action: actions.chooseFont }),
    ],
  });

  const menu = await Menu.new({ items: [fileMenu, editMenu, viewMenu, formatMenu] });
  await menu.setAsAppMenu();
  return { wrapItem };
}