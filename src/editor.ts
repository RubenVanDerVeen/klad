import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { gotoLine, openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

const wrapCompartment = new Compartment();

export function createEditor(
  parent: HTMLElement,
  onDocChanged: () => void,
  onCursor: (line: number, col: number) => void,
  initialWrap: boolean = true,
): EditorView {
  return new EditorView({
    state: EditorState.create({
      extensions: [
        history(),
        search({ top: true }),
        // custom bindings first so they win over searchKeymap defaults:
        // Ctrl+G = go to line (Notepad convention), Ctrl+H = replace
        keymap.of([
          { key: "Mod-g", run: gotoLine },
          { key: "Mod-h", run: openSearchPanel },
        ]),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        wrapCompartment.of(initialWrap ? EditorView.lineWrapping : []),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onDocChanged();
          if (u.selectionSet || u.docChanged) {
            const pos = u.state.selection.main.head;
            const line = u.state.doc.lineAt(pos);
            onCursor(line.number, pos - line.from + 1);
          }
        }),
      ],
    }),
    parent,
  });
}

export function setWrap(view: EditorView, on: boolean): void {
  view.dispatch({
    effects: wrapCompartment.reconfigure(on ? EditorView.lineWrapping : []),
  });
}

export function getText(view: EditorView): string {
  return view.state.doc.toString();
}

export function setText(view: EditorView, text: string): void {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
  });
}
