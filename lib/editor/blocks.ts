import type { Editor } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
export function selectedBlock(editor: Editor) {
  const index = editor.state.selection.$from.index(0),
    doc = editor.state.doc;
  if (index >= doc.childCount) return null;
  let from = 0;
  for (let i = 0; i < index; i++) from += doc.child(i).nodeSize;
  return { index, from, node: doc.child(index) };
}
export function moveBlock(editor: Editor, direction: -1 | 1) {
  const block = selectedBlock(editor);
  if (!block) return false;
  const other = block.index + direction,
    doc = editor.state.doc;
  if (other < 0 || other >= doc.childCount) return false;
  const target =
    direction < 0
      ? block.from - doc.child(other).nodeSize
      : block.from + doc.child(other).nodeSize;
  const tr = editor.state.tr
    .delete(block.from, block.from + block.node.nodeSize)
    .insert(target, block.node);
  tr.setSelection(
    block.node.type.name === "image" || block.node.type.name === "table"
      ? NodeSelection.create(tr.doc, target)
      : TextSelection.near(tr.doc.resolve(target + 1)),
  );
  editor.view.dispatch(tr.scrollIntoView());
  editor.commands.focus();
  return true;
}
export function removeBlock(editor: Editor) {
  const block = selectedBlock(editor);
  if (!block) return false;
  editor.view.dispatch(
    editor.state.tr
      .delete(block.from, block.from + block.node.nodeSize)
      .scrollIntoView(),
  );
  editor.commands.focus();
  return true;
}
