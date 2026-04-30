import { createSignal, JSX, onCleanup, onMount, Show } from "solid-js";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  fullScreen?: boolean;
  children: JSX.Element;
}

export function Sheet(props: SheetProps) {
  const [dragOffset, setDragOffset] = createSignal(0);
  const [dragging, setDragging] = createSignal(false);
  const [forceFull, setForceFull] = createSignal(false);

  const checkHeight = () => setForceFull(window.innerHeight < 700);
  onMount(() => {
    checkHeight();
    window.addEventListener("resize", checkHeight);
    onCleanup(() => window.removeEventListener("resize", checkHeight));
  });

  let startY = 0;
  const onPointerDown = (e: PointerEvent) => {
    startY = e.clientY;
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!dragging()) return;
    const offset = Math.max(0, e.clientY - startY);
    setDragOffset(offset);
  };
  const onPointerUp = () => {
    if (dragOffset() > 100) props.onClose();
    setDragOffset(0);
    setDragging(false);
  };

  const isFull = () => props.fullScreen || forceFull();

  return (
    <Show when={props.open}>
      <div class="sheet-backdrop" onClick={props.onClose}>
        <div
          class={`sheet ${isFull() ? "sheet-full" : ""}`}
          style={{ transform: `translateY(${dragOffset()}px)`, transition: dragging() ? "none" : "transform 250ms ease-out" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            class="sheet-handle-area"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <div class="sheet-handle" />
          </div>
          <Show when={props.title || isFull()}>
            <div class="sheet-header">
              <Show when={isFull()}>
                <button class="sheet-cancel" onClick={props.onClose}>Abbrechen</button>
              </Show>
              <h2 class="sheet-title">{props.title ?? ""}</h2>
              <span class="sheet-spacer" />
            </div>
          </Show>
          <div class="sheet-body">{props.children}</div>
        </div>
      </div>
    </Show>
  );
}
