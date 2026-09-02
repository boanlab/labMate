import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * 목록과 상세를 한 라우트 안에서 오가는 화면에서, 열려 있는 상세를 URL(`?open=<id>`)에 담는다.
 *
 * 이걸 하지 않으면 상세를 보다 새로고침하면 목록으로 튕기고, 뒤로가기는 이전 메뉴로 빠져나가며,
 * "이 공지 좀 봐" 하고 링크를 건네줄 수도 없다. 그룹웨어에서는 링크 공유가 특히 아쉽다.
 *
 * @param items   목록 데이터(로드 완료 후 URL 의 id 를 여기서 찾는다)
 * @param open    현재 열린 상세(없으면 null)
 * @param onOpen  상세를 여는 동작(서버 조회가 필요하면 여기서 한다)
 * @param onClose 상세를 닫는 동작
 */
export function useDetailParam<T extends { id: string }>(
  items: T[],
  open: T | null,
  onOpen: (item: T) => void,
  onClose: () => void,
) {
  const [sp, setSp] = useSearchParams();

  useEffect(() => {
    const oid = sp.get("open");
    if (oid) {
      if (open?.id === oid || !items.length) return;
      const found = items.find((x) => x.id === oid);
      if (found) onOpen(found);
    } else if (open) {
      onClose();                       // 뒤로가기 등으로 ?open= 이 사라지면 목록으로
    }
  }, [sp, items]);

  return {
    /** 상세 열기 — URL 을 바꾸면 위 effect 가 onOpen 을 부른다 */
    show: (x: T) => { if (sp.get("open") === x.id) onOpen(x); else setSp({ open: x.id }); },
    /** 목록으로 돌아가기 */
    hide: () => setSp({}),
  };
}
