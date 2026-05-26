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
};

export default function TerminalSection({
  title,
  children,
  className,
  bodyClassName,
  bodyRef,
  bodyProps,
}: TerminalSectionProps) {
  return (
    <section className={cn(styles.section, className)}>
      <div className={styles.header}>{title}</div>
      <div
        {...bodyProps}
        ref={bodyRef}
        className={cn(styles.body, bodyClassName)}
      >
        {children}
      </div>
    </section>
  );
}
