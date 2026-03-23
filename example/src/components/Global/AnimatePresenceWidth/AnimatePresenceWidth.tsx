import { AnimatePresence, motion } from "framer-motion";

const AnimatePresenceWidth = ({
  children,
  shouldDisplay,
  className,
  duration = 0.25,
}: {
  children: React.ReactNode;
  shouldDisplay: boolean;
  className?: string;
  duration?: number;
}) => {
  return (
    <AnimatePresence>
      {shouldDisplay && (
        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: "auto", opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: duration, ease: "easeInOut" }}
          className={className}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default AnimatePresenceWidth;
