import { MEMORY_INITIAL_ERASERS, MEMORY_DELETE_PENALTY } from "../game/memory";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import Modal from "./Modal";
import { PlayNotebook } from "./PlayChrome";

export interface MemoryNotebookEntry {
  id: string;
  text: string;
  actionLabel: string;
}

export type MemoryDirection = "up" | "down";
export type MemoryPlacement = "before" | "after";
type MaybeAsyncResult = boolean | void | Promise<boolean | void>;

export interface MemoryNotebookProps {
  entries: readonly MemoryNotebookEntry[];
  erasers: number;
  eraserCapacity?: number;
  deletionPenalty?: number;
  tutorial?: boolean;
  activeId?: string | null;
  animating: boolean;
  reviving: boolean;
  canDelete: boolean;
  canReorder: boolean;
  busy?: boolean;
  reducedMotion?: boolean;
  onDelete: (id: string) => MaybeAsyncResult;
  onMove: (id: string, direction: MemoryDirection) => MaybeAsyncResult;
  onPlace: (
    id: string,
    targetId: string,
    position: MemoryPlacement,
  ) => MaybeAsyncResult;
  children?: ReactNode;
  notebookRef?: Ref<HTMLDetailsElement>;
}

interface DropTarget {
  id: string;
  position: MemoryPlacement;
}

export function MemoryNotebook({
  entries,
  erasers,
  eraserCapacity = MEMORY_INITIAL_ERASERS,
  deletionPenalty = MEMORY_DELETE_PENALTY,
  tutorial = false,
  activeId,
  animating,
  reviving,
  canDelete,
  canReorder,
  busy = false,
  reducedMotion = false,
  onDelete,
  onMove,
  onPlace,
  children,
  notebookRef,
}: MemoryNotebookProps) {
  const localNotebookRef = useRef<HTMLDetailsElement>(null);
  const dragRef = useRef<string | null>(null);
  const dropRef = useRef<DropTarget | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [priorityNotice, setPriorityNotice] = useState("");

  const reorderEnabled = canReorder && !busy && !deleting;
  const deleteEnabled = canDelete && !busy && !deleting && !tutorial;
  const selected = entries.find((entry) => entry.id === deleteId);

  const resetDrag = useCallback(() => {
    dragRef.current = null;
    dropRef.current = null;
    setDraggedId(null);
    setDropTarget(null);
  }, []);

  useEffect(() => {
    if (!reorderEnabled) {
      setEditingId(null);
      resetDrag();
    }
  }, [reorderEnabled, resetDrag]);

  useEffect(() => {
    if (!deleteId || entries.some((entry) => entry.id === deleteId)) return;
    setDeleteId(null);
  }, [deleteId, entries]);

  useEffect(() => {
    if (!localNotebookRef.current?.open || window.innerWidth <= 800) return;
    const list =
      localNotebookRef.current.querySelector<HTMLUListElement>(
        ".instruction-list",
      );
    const active = list?.querySelector<HTMLElement>(".instruction.active");
    if (!list || !active) return;
    const top =
      active.getBoundingClientRect().top -
      list.getBoundingClientRect().top +
      list.scrollTop;
    list.scrollTo({
      top: Math.max(0, top - 8),
      behavior: reducedMotion ? "instant" : "smooth",
    });
  }, [activeId, reducedMotion]);

  const startDrag = (id: string) => {
    if (!reorderEnabled) return false;
    dragRef.current = id;
    setDraggedId(id);
    setEditingId(null);
    return true;
  };

  const targetDrag = (clientX: number, clientY: number) => {
    if (!dragRef.current || !reorderEnabled) return;
    const list =
      localNotebookRef.current?.querySelector<HTMLElement>(".instruction-list");
    if (list) {
      const bounds = list.getBoundingClientRect();
      if (clientY < bounds.top + 28) list.scrollTop -= 18;
      else if (clientY > bounds.bottom - 28) list.scrollTop += 18;
    }
    const row = document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>("[data-memory-id]");
    const id = row?.dataset.memoryId;
    if (!row || !id || id === dragRef.current) {
      dropRef.current = null;
      setDropTarget(null);
      return;
    }
    const bounds = row.getBoundingClientRect();
    const target: DropTarget = {
      id,
      position: clientY < bounds.top + bounds.height / 2 ? "before" : "after",
    };
    dropRef.current = target;
    setDropTarget(target);
  };

  const finishDrag = async (apply: boolean) => {
    const id = dragRef.current;
    const target = dropRef.current;
    resetDrag();
    if (!apply || !reorderEnabled || !id || !target) return;
    const changed = await onPlace(id, target.id, target.position);
    if (changed !== false) setPriorityNotice("메모 우선순위를 바꿨어요.");
  };

  const move = async (
    entry: MemoryNotebookEntry,
    direction: MemoryDirection,
  ) => {
    if (!reorderEnabled) return;
    const changed = await onMove(entry.id, direction);
    if (changed !== false) {
      setPriorityNotice(
        `“${entry.text}” 우선순위를 ${direction === "up" ? "높였어요" : "낮췄어요"}.`,
      );
    }
  };

  const confirmDelete = async () => {
    if (!selected || !deleteEnabled) return;
    setDeleting(true);
    try {
      if (!reducedMotion) {
        await new Promise((resolve) => window.setTimeout(resolve, 220));
      }
      const deleted = await onDelete(selected.id);
      if (deleted !== false) setDeleteId(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <PlayNotebook
        count={entries.length}
        className={reviving ? "remembering" : undefined}
        notebookRef={(node) => {
          localNotebookRef.current = node;
          if (typeof notebookRef === "function") notebookRef(node);
          else if (notebookRef) notebookRef.current = node;
        }}
      >
        <p className="memory-priority">상황이 맞으면 위쪽 메모부터 ↓</p>
        <span className="sr-only" role="status">
          {priorityNotice}
        </span>
        <ul
          className="instruction-list"
          aria-label="위쪽부터 우선 적용하는 메모. 손잡이 드래그 또는 메모 관리 메뉴로 순서를 바꿀 수 있어요"
        >
          {entries.map((entry, index) => (
            <li
              key={entry.id}
              data-memory-id={entry.id}
              data-drop-position={
                dropTarget?.id === entry.id ? dropTarget.position : undefined
              }
              className={`instruction ${draggedId === entry.id ? "dragging" : ""} ${deleting && deleteId === entry.id ? "erasing" : ""} ${activeId === entry.id ? "active" : ""}`}
              onDragOver={(event) => {
                if (!dragRef.current || !reorderEnabled) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                targetDrag(event.clientX, event.clientY);
              }}
              onDrop={(event) => {
                event.preventDefault();
                targetDrag(event.clientX, event.clientY);
                void finishDrag(true);
              }}
            >
              <span
                className={`memory-drag-handle ${reorderEnabled ? "enabled" : ""}`}
                draggable={reorderEnabled}
                title="드래그해서 우선순위 변경"
                aria-hidden="true"
                onDragStart={(event) => {
                  if (!startDrag(entry.id)) {
                    event.preventDefault();
                    return;
                  }
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", entry.id);
                }}
                onDragEnd={() => void finishDrag(false)}
                onPointerDown={(event) => {
                  if (event.pointerType === "mouse" || !startDrag(entry.id))
                    return;
                  event.preventDefault();
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  if (
                    event.pointerType === "mouse" ||
                    !event.currentTarget.hasPointerCapture(event.pointerId)
                  )
                    return;
                  event.preventDefault();
                  targetDrag(event.clientX, event.clientY);
                }}
                onPointerUp={(event) => {
                  if (
                    event.pointerType === "mouse" ||
                    !event.currentTarget.hasPointerCapture(event.pointerId)
                  )
                    return;
                  targetDrag(event.clientX, event.clientY);
                  void finishDrag(true);
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }}
                onPointerCancel={() => void finishDrag(false)}
              >
                ⠿
              </span>
              <span className="line-text">
                {entry.text}
                {activeId === entry.id ? (
                  <span className="memory-selected">
                    {animating ? "이번에 따르는 기억" : "방금 따른 기억"}
                  </span>
                ) : null}
                <small>{entry.actionLabel}</small>
              </span>
              <div className="memory-actions">
                <button
                  type="button"
                  className="erase-button"
                  aria-label={`${entry.text} 삭제`}
                  title="메모 삭제"
                  onClick={() => setDeleteId(entry.id)}
                  disabled={!deleteEnabled}
                >
                  ⌫
                </button>
                <button
                  type="button"
                  className="memory-menu-toggle"
                  aria-label={`${entry.text} 메모 관리`}
                  aria-expanded={editingId === entry.id}
                  aria-controls={`memory-tools-${entry.id}`}
                  disabled={!reorderEnabled || entries.length < 2}
                  onClick={() =>
                    setEditingId((open) =>
                      open === entry.id ? null : entry.id,
                    )
                  }
                >
                  ···
                </button>
              </div>
              {editingId === entry.id && reorderEnabled ? (
                <div
                  className="memory-tools"
                  id={`memory-tools-${entry.id}`}
                  role="group"
                  aria-label={`${entry.text} 메모 편집`}
                >
                  {entries.length > 1 ? (
                    <div
                      className="priority-controls"
                      aria-label={`${entry.text} 우선순위`}
                    >
                      <button
                        type="button"
                        aria-label={`${entry.text} 우선순위 높이기`}
                        title="우선순위 높이기"
                        disabled={!reorderEnabled || index === 0}
                        onClick={() => void move(entry, "up")}
                      >
                        ↑ 위로
                      </button>
                      <button
                        type="button"
                        aria-label={`${entry.text} 우선순위 낮추기`}
                        title="우선순위 낮추기"
                        disabled={
                          !reorderEnabled || index === entries.length - 1
                        }
                        onClick={() => void move(entry, "down")}
                      >
                        ↓ 아래로
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
          {entries.length === 0 ? (
            <li className="empty-note">
              아직 비어 있는 작은 메모장.
              <br />첫 번째 기억을 남겨주세요.
            </li>
          ) : null}
          {Array.from(
            { length: Math.max(0, 3 - entries.length) },
            (_, index) => (
              <li
                className="empty-line"
                key={`empty${index}`}
                aria-hidden="true"
              />
            ),
          )}
        </ul>
        <div className="paper-foot">
          <span>남은 지우개</span>
          <div className="erasers" aria-label={`지우개 ${erasers}개`}>
            {Array.from({ length: eraserCapacity }, (_, index) => (
              <span
                key={index}
                className={`eraser ${index >= erasers ? "spent" : ""}`}
              />
            ))}
          </div>
        </div>
        <p className="paper-note">
          지우개를 다 쓰면, 한 줄을 지울 때 +{deletionPenalty}데스.
        </p>
        {children}
      </PlayNotebook>
      {selected ? (
        <Modal
          title="이 기억을 지울까요?"
          onClose={() => {
            if (!deleting) setDeleteId(null);
          }}
        >
          <blockquote>{selected.text}</blockquote>
          <p>
            비용:{" "}
            <strong>
              {erasers > 0 ? "지우개 1개" : `${deletionPenalty}데스`}
            </strong>
            . 지운 기억은 되돌릴 수 없어요.
            {erasers === 0 ? " 패널티로 새 작성 기회가 생기지는 않아요." : ""}
          </p>
          <div className="action-row">
            <button
              className="primary danger"
              onClick={() => void confirmDelete()}
              disabled={!deleteEnabled}
            >
              비용을 사용하고 삭제
            </button>
            <button
              className="secondary"
              disabled={deleting}
              onClick={() => setDeleteId(null)}
            >
              취소
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
