import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { DialogHost } from "./ui/dialog";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import ChangePassword from "./pages/ChangePassword";
import Dashboard from "./pages/Dashboard";
import Members from "./pages/Members";
import MyPage from "./pages/MyPage";
import Projects from "./pages/Projects";
import Publications from "./pages/Publications";
import Expenses from "./pages/Expenses";
import Payroll from "./pages/Payroll";
import BudgetPage from "./pages/Budget";
import Admin from "./pages/Admin";
import AuditLog from "./pages/AuditLog";
import Attendance from "./pages/Attendance";
import AttendanceAdmin from "./pages/AttendanceAdmin";
import Leave from "./pages/Leave";
import Notices from "./pages/Notices";
import Board from "./pages/Board";
import Notes from "./pages/Notes";
import Library from "./pages/Library";
import Meetings from "./pages/Meetings";
import CalendarPage from "./pages/Calendar";
import Approvals from "./pages/Approvals";
import Assets from "./pages/Assets";
import Infra from "./pages/Infra";
import Booking from "./pages/Booking";
import { ReactNode } from "react";

// 연구원 전체(학사 포함) 접근 가능 라우트. 연구비집행·예산은 교수·행정만(별도 지정).
const STUDENT5 = ["prof", "phd", "master", "under", "staff"];
// 행정(staff) 차단 모듈 — 프로젝트·전자결재·자원예약·게시판·회의록·자료실. 위임 학생은 본인 역할로 접근.
const NO_STAFF = ["prof", "phd", "master", "under"];
function Protected({ children, roles }: { children: ReactNode; roles?: string[] }) {
  const { me, loading } = useAuth();
  if (loading) return <div className="center muted">불러오는 중…</div>;
  if (!me) return <Navigate to="/login" replace />;
  // 비밀번호 변경 강제: 변경 화면 외에는 접근 차단
  if (me.must_change_password) return <Navigate to="/change-password" replace />;
  // 역할 가드 — 위임(delegated_admin)은 staff 권한도 보유한 것으로 간주
  if (roles && !(roles.includes(me.role) || (me.delegated_admin && roles.includes("staff")))) {
    return <Layout>
      <div className="page-head"><div><div className="crumb">접근 제한</div><h1>접근 권한 없음</h1></div></div>
      <div className="card"><div className="bd muted" data-testid="no-access">이 메뉴에 접근할 권한이 없습니다. 필요한 경우 관리자에게 문의하세요.</div></div>
    </Layout>;
  }
  return <Layout>{children}</Layout>;
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/change-password" element={<ChangePassword />} />
          <Route path="/" element={<Protected><Dashboard /></Protected>} />
          <Route path="/grants" element={<Protected roles={STUDENT5}><Projects key="grant" kind="grant" /></Protected>} />
          <Route path="/projects" element={<Protected roles={NO_STAFF}><Projects key="activity" kind="activity" /></Protected>} />
          <Route path="/notes" element={<Protected roles={NO_STAFF}><Notes /></Protected>} />
          <Route path="/publications" element={<Protected roles={STUDENT5}><Publications /></Protected>} />
          <Route path="/expenses" element={<Protected roles={["prof", "staff"]}><Expenses /></Protected>} />
          <Route path="/payroll" element={<Protected roles={STUDENT5}><Payroll /></Protected>} />
          <Route path="/budget" element={<Protected roles={["prof", "staff"]}><BudgetPage /></Protected>} />
          <Route path="/admin" element={<Protected roles={["admin"]}><Admin /></Protected>} />
          <Route path="/audit" element={<Protected roles={["admin"]}><AuditLog /></Protected>} />
          <Route path="/attendance" element={<Protected><Attendance /></Protected>} />
          <Route path="/att-admin" element={<Protected roles={["prof"]}><AttendanceAdmin /></Protected>} />
          <Route path="/leave" element={<Protected roles={STUDENT5}><Leave /></Protected>} />
          <Route path="/calendar" element={<Protected><CalendarPage /></Protected>} />
          <Route path="/notices" element={<Protected roles={STUDENT5}><Notices /></Protected>} />
          <Route path="/board" element={<Protected roles={NO_STAFF}><Board /></Protected>} />
          <Route path="/meetings" element={<Protected roles={NO_STAFF}><Meetings /></Protected>} />
          <Route path="/approvals" element={<Protected roles={NO_STAFF}><Approvals /></Protected>} />
          <Route path="/library" element={<Protected roles={NO_STAFF}><Library /></Protected>} />
          <Route path="/assets" element={<Protected><Assets /></Protected>} />
          <Route path="/infra" element={<Protected><Infra /></Protected>} />
          <Route path="/booking" element={<Protected roles={NO_STAFF}><Booking /></Protected>} />
          <Route path="/members" element={<Protected><Members /></Protected>} />
          <Route path="/mypage" element={<Protected><MyPage /></Protected>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <DialogHost />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
