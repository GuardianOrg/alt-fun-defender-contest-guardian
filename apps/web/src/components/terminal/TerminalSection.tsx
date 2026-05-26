import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { HTMLAttributes, ReactNode, Ref } from "react";

import styles from "./TerminalSection.module.css";
import { cn } from "../../utils/format";

type TerminalSectionProps = {
  title: string;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  bodyRef?: Ref<HTMLDivElement>;
  bodyProps?: Omit<HTMLAttributes<HTMLDivElement>, "children" | "className">;
  fade?: "always" | "overflow" | "none";
};

export default function TerminalSection({
  title,
  children,
  className,
  bodyClassName,
  bodyRef,
  bodyProps,
  fade = "none",
}: TerminalSectionProps) {
  const [hasOverflow, setHasOverflow] = useState(false);
  const bodyNodeRef = useRef<HTMLDivElement | null>(null);

  const setBodyNode = useCallback(
    (node: HTMLDivElement | null) => {
      bodyNodeRef.current = node;
      if (typeof bodyRef === "function") {
        bodyRef(node);
        return;
      }
      if (bodyRef) bodyRef.current = node;
    },
    [bodyRef],
  );

  const measureOverflow = useCallback(() => {
    const bodyNode = bodyNodeRef.current;
    if (!bodyNode) return;
    setHasOverflow(bodyNode.scrollHeight > bodyNode.clientHeight + 1);
  }, []);

  useLayoutEffect(() => {
    if (fade !== "overflow") return;
    measureOverflow();
  }, [children, fade, measureOverflow]);

  useLayoutEffect(() => {
    if (fade !== "overflow") return undefined;
    const bodyNode = bodyNodeRef.current;
    if (!bodyNode) return undefined;

    const resizeObserver = new ResizeObserver(measureOverflow);
    resizeObserver.observe(bodyNode);

    return () => {
      resizeObserver.disconnect();
    };
  }, [fade, measureOverflow]);

  const showFade = fade === "always" || (fade === "overflow" && hasOverflow);

  return (
    <section
      className={cn(styles.section, showFade && styles.sectionFaded, className)}
    >
      <div className={styles.header}>{title}</div>
      <div className={styles.bodyFrame}>
        <div
          {...bodyProps}
          ref={setBodyNode}
          className={cn(styles.body, bodyClassName)}
        >
          {children}
        </div>
      </div>
    </section>
  );
}
