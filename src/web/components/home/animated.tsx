import { useReducedMotion } from "motion/react";
import { motion } from "motion/react";

// ── Shared viewport config ───────────────────────────

const VIEWPORT = { once: true, margin: "-80px" as const };

// ── FadeInUp ─────────────────────────────────────────

interface FadeInUpProps {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}

export function FadeInUp({ children, delay = 0, className }: FadeInUpProps) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={VIEWPORT}
      transition={{ duration: 0.5, delay, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ── Stagger container + item ─────────────────────────

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.08,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.4, ease: "easeOut" as const },
  },
};

interface StaggerContainerProps {
  children: React.ReactNode;
  className?: string;
}

export function StaggerContainer({ children, className }: StaggerContainerProps) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      variants={reduced ? undefined : containerVariants}
      initial={reduced ? false : "hidden"}
      whileInView="visible"
      viewport={VIEWPORT}
      className={className}
    >
      {children}
    </motion.div>
  );
}

interface StaggerItemProps {
  children: React.ReactNode;
  className?: string;
}

export function StaggerItem({ children, className }: StaggerItemProps) {
  const reduced = useReducedMotion();
  return (
    <motion.div variants={reduced ? undefined : itemVariants} className={className}>
      {children}
    </motion.div>
  );
}

// ── TypewriterLine ───────────────────────────────────

interface TypewriterLineProps {
  children: React.ReactNode;
  delay?: number;
}

export function TypewriterLine({ children, delay = 0 }: TypewriterLineProps) {
  const reduced = useReducedMotion();
  return (
    <motion.span
      className="block"
      initial={reduced ? false : { opacity: 0, x: -8 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={VIEWPORT}
      transition={{ duration: 0.35, delay, ease: "easeOut" }}
    >
      {children}
    </motion.span>
  );
}
