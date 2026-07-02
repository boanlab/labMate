import { lazy, Suspense } from "react";

const Inner = lazy(() => import("./HtmlEditor"));   // CKEditor 청크는 에디터가 실제로 렌더될 때만 로드

// 폼/노트 공용 지연 로드 래퍼 — HtmlEditor와 동일한 props 전달
export default function HtmlEditorLazy(props: {
  value: string; editable?: boolean; onChange: (html: string) => void; fill?: boolean; minHeight?: number; testid?: string;
}) {
  return (
    <Suspense fallback={<div className="muted small" style={{ padding: 12 }}>에디터 불러오는 중…</div>}>
      <Inner {...props} />
    </Suspense>
  );
}
