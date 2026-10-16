import {
  Component,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Alert, Button, Card, Loading, PageHeader } from "../components";

// The frame the app shell puts around every page of a workspace. Pages come from the slices,
// and a page that shows nothing (still loading, nothing to list, or not built yet) would leave
// an empty <main>; one that throws would take the whole shell down. The frame keeps the page's
// heading on screen in both cases, with a loading, empty or error state under it.

/** How long an empty page counts as loading before it says there's nothing to show. */
const EMPTY_AFTER_MS = 1500;

function Fallback({ title, children }: { title: string | null; children: ReactNode }) {
  return (
    <div>
      {title && <PageHeader title={title} />}
      {children}
    </div>
  );
}

/** What shows on its own without any text: a page with one of these isn't blank. */
const SHOWS_WITHOUT_TEXT = "img, svg, video, canvas, iframe, input, select, textarea, button";

/** True while the element shows nothing: no text and nothing visual inside it. */
function useIsEmpty(ref: RefObject<HTMLElement | null>): boolean {
  const [empty, setEmpty] = useState(false);
  // Before paint, and again whenever the page's DOM changes, so a page that renders late (or
  // empties out) is noticed without a frame of blank screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () =>
      setEmpty(!el.textContent?.trim() && el.querySelector(SHOWS_WITHOUT_TEXT) === null);
    check();
    const observer = new MutationObserver(check);
    observer.observe(el, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [ref]);
  return empty;
}

function EmptyState() {
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), EMPTY_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);
  if (!waited) return <Loading />;
  return (
    <Card>
      <p className="text-sm text-stone-600">Nothing to show here yet.</p>
    </Card>
  );
}

function NeverBlank({ title, children }: { title: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const empty = useIsEmpty(ref);
  return (
    <>
      {/* The page stays mounted (and its queries running) while the fallback shows. */}
      <div ref={ref} className="contents">
        {children}
      </div>
      {empty && (
        <Fallback title={title}>
          <EmptyState />
        </Fallback>
      )}
    </>
  );
}

class PageErrorBoundary extends Component<
  { title: string | null; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Fallback title={this.props.title}>
        <Alert title="This page couldn't be shown">
          <p>Something went wrong on our side. Reload to try again.</p>
          <Button variant="secondary" className="mt-2" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </Alert>
      </Fallback>
    );
  }
}

/**
 * One page of a workspace. `title` is the page's name (its navigation label); without one, the
 * page only gets the error state. Key it by page, so a failed page doesn't stay failed after the
 * user moves on.
 */
export function PageFrame({ title, children }: { title: string | null; children: ReactNode }) {
  return (
    <PageErrorBoundary title={title}>
      {title ? <NeverBlank title={title}>{children}</NeverBlank> : children}
    </PageErrorBoundary>
  );
}
