import { useEffect, useRef } from "react";

// Esc closes one layer at a time: the innermost one open. An open message, the assistant panel
// and a dialog on top of either each register here while open, and one document listener hands
// Esc to the layer opened last. Separate document listeners would all run, in the order they
// were added, so Esc on a dialog inside the open message would close the message too.

type EscapeHandler = (event: KeyboardEvent) => void;

const layers: { current: EscapeHandler }[] = [];

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  layers.at(-1)?.current(event);
}

/**
 * While `active`, this layer is the innermost one from the moment it opens until a layer opens
 * on top of it, and `onEscape` runs on Esc only then. The handler may change on every render;
 * the layer keeps its place in the stack.
 */
export function useEscapeLayer(active: boolean, onEscape: EscapeHandler) {
  const handler = useRef(onEscape);
  handler.current = onEscape;
  useEffect(() => {
    if (!active) return;
    const layer = { current: (event: KeyboardEvent) => handler.current(event) };
    layers.push(layer);
    if (layers.length === 1) document.addEventListener("keydown", onKeyDown);
    return () => {
      const at = layers.indexOf(layer);
      if (at >= 0) layers.splice(at, 1);
      if (layers.length === 0) document.removeEventListener("keydown", onKeyDown);
    };
  }, [active]);
}
