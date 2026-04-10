import styles from "./Skeleton.module.css";

interface SkeletonProps {
  height?: string | number;
  width?: string | number;
  className?: string;
  style?: React.CSSProperties;
}

const Skeleton = ({ height, width, className, style }: SkeletonProps) => {
  const skeletonStyle: React.CSSProperties = {
    height: typeof height === "number" ? `${height}rem` : height,
    width: typeof width === "number" ? `${width}rem` : width,
    ...style,
  };

  return (
    <div
      className={`${styles.skeleton} ${className || ""}`}
      style={skeletonStyle}
    />
  );
};

export default Skeleton;
