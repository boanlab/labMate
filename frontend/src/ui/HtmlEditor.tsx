import { CKEditor } from "@ckeditor/ckeditor5-react";
import {
  ClassicEditor, Essentials, Paragraph, Heading, Bold, Italic, Underline, Strikethrough, Code, Subscript, Superscript,
  Highlight, FontColor, FontBackgroundColor, FontSize,
  List, ListProperties, TodoList, Link, AutoLink, LinkImage, BlockQuote, CodeBlock,
  Table, TableToolbar, TableCaption, TableProperties, TableCellProperties, TableColumnResize,
  Image, ImageToolbar, ImageCaption, ImageStyle, ImageResize, ImageUpload, ImageInsert, AutoImage, PictureEditing,
  MediaEmbed, HorizontalLine, Autoformat, PasteFromOffice, Indent, IndentBlock, Alignment, RemoveFormat,
  GeneralHtmlSupport,
} from "ckeditor5";
import "ckeditor5/ckeditor5.css";
import { api } from "../api/client";

// 붙여넣기/삽입 이미지·파일을 /projects/uploads 로 업로드하는 어댑터(인증 토큰은 api 인터셉터가 처리)
function uploadAdapter(editor: any) {
  editor.plugins.get("FileRepository").createUploadAdapter = (loader: any) => ({
    async upload() {
      const file = await loader.file;
      const fd = new FormData();
      fd.append("files", file);
      const r = await api.post<{ name: string; url: string }[]>("/projects/uploads", fd, { headers: { "Content-Type": "multipart/form-data" } });
      return { default: r.data[0].url };
    },
    abort() { /* noop */ },
  });
}

const PLUGINS = [
  Essentials, Paragraph, Heading, Bold, Italic, Underline, Strikethrough, Code, Subscript, Superscript,
  Highlight, FontColor, FontBackgroundColor, FontSize,
  List, ListProperties, TodoList, Link, AutoLink, LinkImage, BlockQuote, CodeBlock,
  Table, TableToolbar, TableCaption, TableProperties, TableCellProperties, TableColumnResize,
  Image, ImageToolbar, ImageCaption, ImageStyle, ImageResize, ImageUpload, ImageInsert, AutoImage, PictureEditing,
  MediaEmbed, HorizontalLine, Autoformat, PasteFromOffice, Indent, IndentBlock, Alignment, RemoveFormat,
  GeneralHtmlSupport,
];

const CONFIG: any = {
  licenseKey: "GPL",
  plugins: PLUGINS,
  extraPlugins: [uploadAdapter],
  toolbar: {
    items: [
      "undo", "redo", "|",
      "heading", "|",
      "bold", "italic", "underline", "strikethrough", "code", "removeFormat", "|",
      "fontColor", "fontBackgroundColor", "highlight", "|",
      "link", "insertImage", "insertTable", "mediaEmbed", "blockQuote", "codeBlock", "horizontalLine", "|",
      "bulletedList", "numberedList", "todoList", "outdent", "indent", "|",
      "alignment",
    ],
    shouldNotGroupWhenFull: false,   // 넘치는 버튼은 에디터 폭 기준 ⋮ 메뉴로 접힘
  },
  heading: {
    options: [
      { model: "paragraph", title: "본문", class: "ck-heading_paragraph" },
      { model: "heading1", view: "h2", title: "제목 1", class: "ck-heading_heading1" },
      { model: "heading2", view: "h3", title: "제목 2", class: "ck-heading_heading2" },
      { model: "heading3", view: "h4", title: "제목 3", class: "ck-heading_heading3" },
    ],
  },
  image: {
    toolbar: ["imageStyle:inline", "imageStyle:block", "imageStyle:side", "|", "toggleImageCaption", "imageTextAlternative", "|", "resizeImage"],
    insert: { type: "auto" },
  },
  table: { contentToolbar: ["tableColumn", "tableRow", "mergeTableCells", "tableProperties", "tableCellProperties", "toggleTableCaption"] },
  htmlSupport: { allow: [{ name: /.*/, attributes: true, classes: true, styles: true }] },   // 붙여넣은 서식 보존
};

/**
 * 공용 HTML 에디터(CKEditor 5). HTML 문자열을 value/onChange로 다룸.
 * - fill: 부모 높이를 채우고 내부 스크롤(연구노트용)
 * - minHeight: 폼용 최소 높이(px, 기본 140)
 */
export default function HtmlEditor({ value, editable = true, onChange, fill = false, minHeight = 140, testid }: {
  value: string;
  editable?: boolean;
  onChange: (html: string) => void;
  fill?: boolean;
  minHeight?: number;
  testid?: string;
}) {
  return (
    <div className={"ck-host" + (fill ? " fill" : "")} data-testid={testid} style={fill ? undefined : ({ ["--ck-min-h" as any]: `${minHeight}px` })}>
      <CKEditor
        editor={ClassicEditor}
        data={value}
        disabled={!editable}
        config={CONFIG}
        onChange={(_e: any, editor: any) => onChange(editor.getData())}
      />
    </div>
  );
}
