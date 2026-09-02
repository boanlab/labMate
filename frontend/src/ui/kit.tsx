import { ReactNode } from "react";
import { dateKST } from "../lib/date";
import { confirmDialog } from "./dialog";

export function Kpi({ label, value, sub, tone, onClick, testid }: { label: string; value: ReactNode; sub?: string; tone?: "blue" | "green" | "amber" | "red"; onClick?: () => void; testid?: string }) {
  return (
    <div className={"kpi" + (tone ? ` k-${tone}` : "")} onClick={onClick} style={onClick ? { cursor: "pointer" } : undefined} data-testid={testid}>
      <div className="l">{label}</div>
      <div className="n">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export function Card({ title, extra, children, pad = true, testid }: { title?: ReactNode; extra?: ReactNode; children: ReactNode; pad?: boolean; testid?: string }) {
  return (
    <div className="card" data-testid={testid}>
      {title && <div className="card-h"><span className="card-t">{title}</span>{extra}</div>}
      {pad ? <div className="bd">{children}</div> : children}
    </div>
  );
}

export function PageHeader({ crumb, title, action, testid }: { crumb?: string; title: string; action?: ReactNode; testid?: string }) {
  return (
    <div className="page-head" data-testid={testid}>
      <div>{crumb && <div className="crumb">{crumb}</div>}<h1>{title}</h1></div>
      {action}
    </div>
  );
}

export const won = (n: number) => (n || 0).toLocaleString() + "원";

// 필수 입력 표시 — 라벨 옆 빨간 별표
export function Req() { return <span style={{ color: "var(--bad-text)", marginLeft: 1 }} title="필수 입력">*</span>; }

// 작성/수정 이력 표시 — 작성자·작성일 (+ 수정됐으면 수정자·수정일)
export function AuthorMeta({ by, updatedBy, createdAt, updatedAt, nameOf, className = "muted small" }: {
  by?: string; updatedBy?: string; createdAt?: string | null; updatedAt?: string | null; nameOf: (id: string) => string; className?: string;
}) {
  const c = dateKST(createdAt), u = dateKST(updatedAt);
  const edited = (!!updatedBy && updatedBy !== by) || (!!u && !!c && u !== c);
  return (
    <span className={className}>
      작성 {nameOf(by || "")}{c ? ` · ${c}` : ""}
      {edited ? ` · 수정 ${nameOf(updatedBy || by || "")}${u ? ` · ${u}` : ""}` : ""}
    </span>
  );
}

// 진행 상태 배지 색 규칙(진행 중=녹색·예정=대기·완료=회색)
const STATUS_BADGE: Record<string, string> = { "진행 중": "s-ok", "진행": "s-ok", "예정": "s-wait", "완료": "s-mute" };
export const statusClass = (s: string) => "badge " + (STATUS_BADGE[s] || "s-info");

// 공용 필터 칩(선택 시 채움 + 선택적 카운트)
export function Chips({ value, onChange, items, testid }: {
  value: string; onChange: (v: string) => void;
  items: { key: string; label?: string; count?: number }[]; testid?: string;
}) {
  return (
    <div className="fchips" data-testid={testid} style={{ marginBottom: 0 }}>
      {items.map((it) => (
        <button key={it.key} type="button" data-testid={testid ? `${testid}-${it.key}` : undefined}
          className={"chip" + (value === it.key ? " on" : "")} onClick={() => onChange(it.key)}>
          {it.label ?? it.key}{it.count != null && <span className="chip-n">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ── 작성 중 이탈 보호 ───────────────────────────────────────────────
// 목록 상단의 "+ 추가" 버튼은 폼이 열린 상태에서 다시 누르면 폼을 닫는 토글이다.
// 입력 중이던 내용이 예고 없이 사라지지 않도록, 스냅샷과 달라졌으면 확인을 받는다.

/** 폼을 열 때의 상태를 문자열로 굳혀 둔다(수정 모드 포함). */
export const formSnapshot = (v: unknown) => JSON.stringify(v);

/** 닫아도 되는지 확인. 변경된 내용이 없으면 곧바로 true. */
export async function confirmDiscard(dirty: boolean): Promise<boolean> {
  if (!dirty) return true;
  return confirmDialog("작성 중인 내용이 있습니다. 닫으면 입력한 내용이 사라집니다.\n닫을까요?", { title: "작성 취소", danger: true });
}

/** 금액을 한글 단위로 읽어준다 — 1500000000 → "15억 원".
 *  연구비는 0 하나 차이로 자릿수를 잘못 넣기 쉬워, 입력 옆에 사람이 읽는 형태를 같이 보여준다. */
export function wonKo(n: number): string {
  const v = Math.floor(Math.abs(Number(n) || 0));
  if (v < 10000) return "";
  let rest = v;
  let out = "";
  for (const [unit, label] of [[1e12, "조"], [1e8, "억"], [1e4, "만"]] as [number, string][]) {
    const q = Math.floor(rest / unit);
    if (q) { out += `${q.toLocaleString()}${label} `; rest -= q * unit; }
  }
  if (rest) out += rest.toLocaleString();
  return (n < 0 ? "-" : "") + out.trim() + "원";
}
