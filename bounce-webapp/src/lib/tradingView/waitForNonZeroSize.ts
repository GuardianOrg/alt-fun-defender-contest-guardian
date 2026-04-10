/** Some WebViews report 0×0 until after layout; TV autosize needs real dimensions.
 * @returns true once the element has non-zero width and height; false if still 0×0 after timeoutMs.
 */

export const waitForNonZeroSize = (
  el: HTMLElement,
  timeoutMs = 4000,
): Promise<boolean> => {
  if (el.clientWidth > 0 && el.clientHeight > 0) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    let finished = false;
    let ro: ResizeObserver | null = null;
    let rafId = 0;

    function finish(success: boolean) {
      if (finished) return;
      finished = true;
      cleanup();
      resolve(success);
    }

    const timer = window.setTimeout(() => finish(false), timeoutMs);

    function cleanup() {
      ro?.disconnect();
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      }
      window.clearTimeout(timer);
    }

    const check = () => {
      if (el.clientWidth > 0 && el.clientHeight > 0) {
        finish(true);
      }
    };

    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(check);
      ro.observe(el);
    } else {
      const poll = () => {
        if (finished) return;
        check();
        if (!finished) {
          rafId = window.requestAnimationFrame(poll);
        }
      };
      rafId = window.requestAnimationFrame(poll);
    }
  });
};
