import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Boundary, isStaleChunk, reloadOnce } from "./ui/Boundary";
import "./styles.css";

// 화면 밖(이벤트 처리·지연 로드)에서 터지는 것은 경계 컴포넌트가 잡지 못한다.
// 배포로 조각이 사라져 생긴 오류면 조용히 한 번 다시 읽는다.
window.addEventListener("vite:preloadError", (e) => { e.preventDefault(); reloadOnce(); });
window.addEventListener("unhandledrejection", (e) => { if (isStaleChunk(e.reason)) reloadOnce(); });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Boundary>
      <App />
    </Boundary>
  </React.StrictMode>
);
