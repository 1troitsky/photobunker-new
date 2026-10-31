/** Stable typed application boundary; Vue can be redesigned without rewriting edits or encryption. */
export {openEditor,saveEditor,EditSession,emptyEdit,normalizedPoint,updateText,renderEdits} from './infrastructure/editor'
export type {EditorSource,EditDocument,Point,Tool} from './infrastructure/editor'
export {default as EditorScreen} from './ui/EditorScreen.vue'
