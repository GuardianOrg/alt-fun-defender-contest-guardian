declare module "canvas-confetti" {
  interface ConfettiOptions {
    particleCount?: number;
    angle?: number;
    spread?: number;
    startVelocity?: number;
    decay?: number;
    gravity?: number;
    drift?: number;
    flat?: boolean;
    ticks?: number;
    origin?: {
      x?: number;
      y?: number;
    };
    colors?: string[];
    shapes?: string[];
    scalar?: number;
    zIndex?: number;
    disableForReducedMotion?: boolean;
  }

  interface ConfettiInstance {
    (options?: ConfettiOptions): Promise<void> | null;
    reset(): void;
  }

  interface GlobalOptions {
    resize?: boolean;
    useWorker?: boolean;
    disableForReducedMotion?: boolean;
  }

  type Shape = Record<string, unknown>;

  function confetti(options?: ConfettiOptions): Promise<void> | null;

  namespace confetti {
    function reset(): void;
    function create(
      canvas: HTMLCanvasElement,
      globalOptions?: GlobalOptions,
    ): ConfettiInstance;
    function shapeFromPath(options: { path: string; matrix?: number[] }): Shape;
    function shapeFromText(options: {
      text: string;
      scalar?: number;
      color?: string;
      fontFamily?: string;
    }): Shape;
  }

  export = confetti;
}
