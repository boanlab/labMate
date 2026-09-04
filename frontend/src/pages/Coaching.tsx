// 지도 현황(교수용) — 학생을 지도할 때 근거로 쓸 데이터.
//
// 개별 지적은 멘토가 학생에게 직접 한다(교수가 매번 지적하면 학생이 위축된다).
// 이 화면은 '누구를 언제 챙겨야 하는가'를 추이로 보여 주는 자리다.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api, apiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { todayKST } from "../lib/date";
import { Card, PageHeader } from "../ui/kit";
import { useColumnResize, useTableSort } from "../ui/tableTools";

interface U { id: string; name: string; role: string; active: boolean }
interface T { id: string; assignee_id: string; status: string; due: string | null; done_date: string | null; start: string | null; title: string }
interface Obj { id: string; owner_id: string; period: string; title: string; key_results: { target: number; current: number }[] }

const ROLE_KO: Record<string, string> = { prof: "지도교수", phd: "박사과정", master: "석사과정", under: "학부연구생", staff: "행정" };
const STUDENT = ["phd", "master", "under"];

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / 86400000);
}

export default function Coaching() {
  const { me } = useAuth();
  const nav = useNavigate();
  const isMgr = me?.role === "prof" || me?.role === "staff" || me?.role === "admin";
  const [users, setUsers] = useState<U[]>([]);
  const [tasks, setTasks] = useState<T[]>([]);
  const [objs, setObjs] = useState<Obj[]>([]);
  const [err, setErr] = useState("");
  const tableRef = useColumnResize("coaching");
  const sort = useTableSort({ key: "risk", dir: -1 }, "coaching");

  useEffect(() => {
    if (!isMgr) return;
    Promise.all([
      api.get<U[]>("/members/users"),
      api.get<T[]>("/projects/tasks"),
      api.get<Obj[]>("/projects/objectives"),
    ]).then(([u, t, o]) => { setUsers(u.data); setTasks(t.data); setObjs(o.data); })
      .catch((e) => setErr(apiError(e)));
  }, [isMgr]);

  const today = todayKST();
  const rows = useMemo(() => users
    .filter((u) => u.active !== false && STUDENT.includes(u.role))
    .map((u) => {
      const mine = tasks.filter((t) => t.assignee_id === u.id);
      const closed = mine.filter((t) => t.status === "완료" && t.due && t.done_date);
      const onTime = closed.filter((t) => (t.done_date as string) <= (t.due as string)).length;
      // 기한 준수율 — 마감이 있는 완료 업무 기준. 표본이 적으면 판단하지 않는다.
      const keep = closed.length >= 3 ? Math.round((onTime / closed.length) * 100) : null;
      const overdue = mine.filter((t) => t.status !== "완료" && t.due && t.due < today);
      const oldest = overdue.length ? Math.max(...overdue.map((t) => daysBetween(t.due as string, today))) : 0;
      const stuck = mine.filter((t) => t.status === "진행 중" && t.start && daysBetween(t.start, today) >= 14).length;
      const myObjs = objs.filter((o) => o.owner_id === u.id);
      const okr = myObjs.length
        ? Math.round(myObjs.reduce((a, o) => a + (o.key_results.length
            ? o.key_results.reduce((x, k) => x + Math.min(1, k.target > 0 ? k.current / k.target : 0), 0) / o.key_results.length
            : 0), 0) / myObjs.length * 100)
        : null;
      // 챙겨야 할 순서 — 지연 일수와 정체 업무를 합쳐 단순 점수로 낸다.
      const risk = oldest * 2 + stuck * 10 + overdue.length * 3;
      return { u, keep, overdue: overdue.length, oldest, stuck, okr, objCount: myObjs.length, open: mine.filter((t) => t.status !== "완료").length, risk };
    }), [users, tasks, objs, today]);

  const shown = sort.apply(rows, {
    name: (r) => r.u.name, role: (r) => r.u.role, keep: (r) => r.keep ?? -1,
    overdue: (r) => r.overdue, stuck: (r) => r.stuck, okr: (r) => r.okr ?? -1, risk: (r) => r.risk,
  });

  if (!isMgr) return <div><PageHeader crumb="연구실 › 지도 현황" title="지도 현황" /><div className="form-err">지도교수·행정만 볼 수 있습니다.</div></div>;

  return (
    <div>
      <PageHeader crumb="연구실 › 지도 현황" title="지도 현황" />
      {err && <div className="form-err">{err}</div>}
      <Card title={`구성원 ${shown.length}명`} testid="coaching-card"
        extra={<span className="muted small">밀린 일에 대한 개별 안내는 멘토가 학생에게 직접 합니다</span>}>
        <div className="scroll">
          <table ref={tableRef} className="tbl fit" data-testid="coaching-table">
            <thead><tr>
              <th {...sort.th("name")} style={{ width: 110 }}>이름{sort.mark("name")}</th>
              <th {...sort.th("role", "hide-sm")} style={{ width: 96 }}>역할{sort.mark("role")}</th>
              <th {...sort.th("keep")} style={{ width: 96 }}>기한 준수{sort.mark("keep")}</th>
              <th {...sort.th("overdue")} style={{ width: 96 }}>지연{sort.mark("overdue")}</th>
              <th {...sort.th("stuck", "hide-sm")} style={{ width: 90 }}>정체{sort.mark("stuck")}</th>
              <th {...sort.th("okr", "hide-sm")} style={{ width: 96 }}>목표 달성{sort.mark("okr")}</th>
              <th style={{ width: 120 }}>진행 중</th>
            </tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.u.id} style={{ cursor: "pointer" }} onClick={() => nav(`/goals`)}>
                  <td><b>{r.u.name}</b></td>
                  <td className="hide-sm">{ROLE_KO[r.u.role] || r.u.role}</td>
                  <td>{r.keep === null
                    ? <span className="muted small">표본 부족</span>
                    : <span className={"badge " + (r.keep >= 80 ? "s-ok" : r.keep >= 50 ? "s-wait" : "s-bad")}>{r.keep}%</span>}</td>
                  <td>{r.overdue
                    ? <span className="badge s-bad">{r.overdue}건{r.oldest ? ` · ${r.oldest}일` : ""}</span>
                    : <span className="muted small">없음</span>}</td>
                  <td className="hide-sm">{r.stuck ? <span className="badge s-wait">{r.stuck}건</span> : <span className="muted small">없음</span>}</td>
                  <td className="hide-sm">{r.okr === null
                    ? <span className="muted small">목표 없음</span>
                    : <span className={"badge " + (r.okr >= 70 ? "s-ok" : r.okr >= 30 ? "s-wait" : "s-bad")}>{r.okr}%</span>}</td>
                  <td className="small">{r.open}건</td>
                </tr>
              ))}
              {!shown.length && <tr><td colSpan={7} className="muted" style={{ textAlign: "center", padding: 20 }}>학생 구성원이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="muted small" style={{ marginTop: 8 }}>
          기한 준수율은 마감이 있는 완료 업무 3건 이상일 때만 계산합니다 · 정체 = 2주 넘게 진행 중
        </div>
      </Card>
    </div>
  );
}
