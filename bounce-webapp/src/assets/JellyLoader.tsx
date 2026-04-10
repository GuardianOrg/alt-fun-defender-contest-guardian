import React from "react";

const JellyLoader: React.FC<{
  size?: number;
  color?: string;
}> = ({ size = 4, color = "var(--primary-500)" }) => {
  return (
    <>
      <div
        className="jelly-container"
        style={
          {
            "--uib-size": `${size}rem`,
            "--uib-color": color,
            "--uib-speed": "1s",
          } as React.CSSProperties
        }
        data-testid="jellyLoader"
      ></div>

      <svg width="0" height="0" className="jelly-svg">
        <defs>
          <filter id="uib-jelly-ooze">
            <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7"
              result="ooze"
            />
            <feBlend in="SourceGraphic" in2="ooze" />
          </filter>
        </defs>
      </svg>

      <style>
        {`
        .jelly-container {
          position: relative;
          height: calc(var(--uib-size) / 2);
          width: var(--uib-size);
          filter: url('#uib-jelly-ooze');
          animation: rotate calc(var(--uib-speed) * 2) linear infinite;
          will-change: transform;
        }

        .jelly-container::before,
        .jelly-container::after {
          content: '';
          position: absolute;
          top: 0%;
          left: 25%;
          width: 50%;
          height: 100%;
          background-color: var(--uib-color);
          border-radius: 100%;
          will-change: transform;
          transition: background-color 0.25s ease;
        }

        .jelly-container::before {
          animation: shift-left var(--uib-speed) ease infinite;
        }

        .jelly-container::after {
          animation: shift-right var(--uib-speed) ease infinite;
        }

        .jelly-svg {
          width: 0;
          height: 0;
          position: absolute;
        }

        @keyframes rotate {
          0%, 49.999%, 100% {
            transform: none;
          }
          50%, 99.999% {
            transform: rotate(90deg);
          }
        }

        @keyframes shift-left {
          0%, 100% {
            transform: translateX(0%);
          }
          50% {
            transform: scale(0.65) translateX(-75%);
          }
        }

        @keyframes shift-right {
          0%, 100% {
            transform: translateX(0%);
          }
          50% {
            transform: scale(0.65) translateX(75%);
          }
        }
      `}
      </style>
    </>
  );
};

export default JellyLoader;
