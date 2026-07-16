import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

export function createEditor(
  parent: HTMLElement,
  onDocChanged: () => void,
  onCursor: (line: number, col: number) => void,
): EditorView {
  return new EditorView({
    state: EditorState.create({
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
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

export function getText(view: EditorView): string {
  return view.state.doc.toString();
}

export function setText(view: EditorView, text: string): void {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
  });
}
