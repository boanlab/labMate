import { ReactNode } from "react";
import { dateKST } from "../lib/date";

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
