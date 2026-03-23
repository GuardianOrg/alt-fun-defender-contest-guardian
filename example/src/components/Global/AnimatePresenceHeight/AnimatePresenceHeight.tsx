import { AnimatePresence, motion } from "framer-motion";

const AnimatePresenceHeight = ({
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
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: duration, ease: "easeInOut" }}
          className={className}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default AnimatePresenceHeight;
