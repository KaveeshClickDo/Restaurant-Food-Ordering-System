"use client";

import { useEffect, useRef } from "react";
import {
  Bold, Italic, Underline, Strikethrough,
  List, ListOrdered, AlignLeft, AlignCenter, AlignRight,
  Minus, Undo2, Heading1, Heading2,
} from "lucide-react";

interface RichEditorProps {
  /** Changing this key resets the editor to `initialValue` (use when switching between pages). */
  editorKey: string;
  initialValue: string;
  onChange: (html: string) => void;
  /** Minimum height of the editable area in px. Default 300. */
  minHeight?: number;
}

/**
 * Lightweight contenteditable rich-text editor.
 *
 * Uses document.execCommand for formatting — deprecated by the spec but
 * supported across all modern browsers with no sign of removal. Suitable for
 * admin tooling where a full ProseMirror/Tiptap dependency isn't warranted.
 *
 * Content is stored as plain HTML (no variable substitution).
 * For an editor with variable-chip insertion see EmailTemplatesPanel.
 */
export default function RichEditor({
  editorKey,
  initialValue,
  onChange,
  minHeight = 300,
}: RichEditorProps) {
  const editorRef  = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);

  // Reset the editor's DOM whenever the key changes (i.e. a different page
  // is selected). We set innerHTML directly to avoid React state causing
  // cursor-jumping on every keystroke.
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = initialValue;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorKey]);

  function saveRange() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const r = sel.getRangeAt(0);
      if (editorRef.current?.contains(r.commonAncestorContainer)) {
        savedRange.current = r.cloneRange();
      }
    }
  }

  function exec(cmd: string, value?: string) {
    editorRef.current?.focus();
    document.execCommand(cmd, false, value);
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  }

  function ToolbarBtn({
    onClick,
    title,
    children,
  }: {
    onClick: () => void;
    title: string;
    children: React.ReactNode;
  }) {
    return (
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); saveRange(); }}
        onClick={onClick}
        title={title}
        className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-200 hover:text-gray-800 transition"
      >
        {children}
      </button>
    );
  }

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 flex-wrap px-3 py-2 bg-gray-50 border-b border-gray-200">
        <ToolbarBtn onClick={() => exec("bold")}          title="Bold">          <Bold size={13} /></ToolbarBtn>
        <ToolbarBtn onClick={() => exec("italic")}        title="Italic">        <Italic size={13} /></ToolbarBtn>
        <ToolbarBtn onClick={() => exec("underline")}     title="Underline">     <Underline size={13} /></ToolbarBtn>
        <ToolbarBtn onClick={() => exec("strikeThrough")} title="Strikethrough"> <Strikethrough size={13} /></ToolbarBtn>

        <span className="w-px h-4 bg-gray-300 mx-1" />

        <ToolbarBtn onClick={() => exec("formatBlock", "<h1>")} title="Heading 1"><Heading1 size={14} /></ToolbarBtn>
        <ToolbarBtn onClick={() => exec("formatBlock", "<h2>")} title="Heading 2"><Heading2 size={14} /></ToolbarBtn>
        <ToolbarBtn onClick={() => exec("formatBlock", "<p>")}  title="Paragraph">
          <span className="text-[11px] font-bold">P</span>
        </ToolbarBtn>

        <span className="w-px h-4 bg-gray-300 mx-1" />

        <ToolbarBtn onClick={() => exec("insertUnorderedList")} title="Bullet list">  <List size={13} /></ToolbarBtn>
        <ToolbarBtn onClick={() => exec("insertOrderedList")}   title="Numbered list"><ListOrdered size={13} /></ToolbarBtn>

        <span className="w-px h-4 bg-gray-300 mx-1" />

        <ToolbarBtn onClick={() => exec("justifyLeft")}   title="Align left">  <AlignLeft size={13} /></ToolbarBtn>
        <ToolbarBtn onClick={() => exec("justifyCenter")} title="Align center"><AlignCenter size={13} /></ToolbarBtn>
        <ToolbarBtn onClick={() => exec("justifyRight")}  title="Align right"> <AlignRight size={13} /></ToolbarBtn>

        <span className="w-px h-4 bg-gray-300 mx-1" />

        <ToolbarBtn onClick={() => exec("insertHorizontalRule")} title="Divider">         <Minus size={13} /></ToolbarBtn>
        <ToolbarBtn onClick={() => exec("removeFormat")}          title="Clear formatting"><Undo2 size={13} /></ToolbarBtn>
      </div>

      {/* Editable content area */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={() => { if (editorRef.current) onChange(editorRef.current.innerHTML); }}
        onKeyUp={saveRange}
        onMouseUp={saveRange}
        className="p-5 focus:outline-none rich-content"
        style={{ minHeight, caretColor: "#ea580c" }}
      />
    </div>
  );
}
