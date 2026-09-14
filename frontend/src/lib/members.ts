// 사람을 고르는 자리에 세울 구성원 목록.
//
// /members/users 는 교수·관리자에게 퇴사(비활성) 구성원까지 내려준다 — 지난 기록을
// 들여다보라는 뜻이지, 새 일을 맡기라는 뜻이 아니다. 그래서 선택 목록에서는 뺀다.
// 다만 이미 골라 둔 사람은 남긴다. 옛 항목을 열었을 때 담당자가 조용히 사라지거나
// 참석자 칩이 없어져 해제조차 못 하는 일을 막는다.
export function selectable<T extends { id: string; active?: boolean }>(
  users: T[],
  ...keep: (string | string[] | undefined | null)[]
): T[] {
  const on = new Set(keep.flat().filter(Boolean) as string[]);
  return users.filter((u) => u.active !== false || on.has(u.id));
}
