import { Extension } from '@tiptap/core';
import { senseEditorDebugLog } from '../editorDebug';

const LIST_ITEM_NODE = 'listItem';

const ListKeymapExtension = Extension.create({
  name: 'listKeymapExtension',

  addKeyboardShortcuts() {
    return {
      Tab: () => {
        if (!this.editor?.isActive?.(LIST_ITEM_NODE)) return false;
        const canSink = this.editor.can().sinkListItem(LIST_ITEM_NODE);
        const didSink = canSink ? this.editor.commands.sinkListItem(LIST_ITEM_NODE) : false;
        senseEditorDebugLog('list-keymap', 'Tab handled in list item', {
          canSink,
          didSink
        });
        return true;
      },
      'Shift-Tab': () => {
        if (!this.editor?.isActive?.(LIST_ITEM_NODE)) return false;
        const canLift = this.editor.can().liftListItem(LIST_ITEM_NODE);
        const didLift = canLift ? this.editor.commands.liftListItem(LIST_ITEM_NODE) : false;
        senseEditorDebugLog('list-keymap', 'Shift-Tab handled in list item', {
          canLift,
          didLift
        });
        return true;
      }
    };
  }
});

export default ListKeymapExtension;
