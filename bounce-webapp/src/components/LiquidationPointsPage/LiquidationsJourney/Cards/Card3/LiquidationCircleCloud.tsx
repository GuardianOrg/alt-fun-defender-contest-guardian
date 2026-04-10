/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo } from "react";

import { hierarchy, pack } from "d3-hierarchy";
import { scaleSqrt } from "d3-scale";
import { motion } from "framer-motion";

import { useAssetLogos } from "../assetLogos";

type Asset = {
  asset: string;
  totalLiquidationNotional: number;
};

type PackedAsset = Asset & {
  value: number;
};

type PackedNode = {
  x: number;
  y: number;
  r: number;
  data: PackedAsset;
};

type Props = {
  assets: Asset[];
  isActive: boolean;
  width?: number;
  height?: number;
};

const MAX_RADIUS = 150;
const MIN_RADIUS = 8;

const pseudoRandom = (seed: number, index: number) => {
  const t = seed + index * 99991;
  return (((Math.sin(t) * 43758.5453) % 1) + 1) % 1;
};

export const LiquidationCircleCloud = ({
  assets,
  isActive,
  width = 320,
  height = 320,
}: Props) => {
  const { getHasLogo, getAssetLogoUrl } = useAssetLogos();

  // ------------------- Compute circle layout -------------------
  const nodes = useMemo<PackedNode[]>(() => {
    if (!assets || assets.length === 0) return [];

    const seed = Math.floor(assets[0]?.totalLiquidationNotional ?? 12345);

    const sorted = [...assets].sort(
      (a, b) => b.totalLiquidationNotional - a.totalLiquidationNotional,
    );

    const top = sorted.slice(0, 6);
    const remainingCount = sorted.length - top.length;

    const displayAssets: Asset[] =
      remainingCount > 0
        ? [
            ...top,
            {
              asset: `+${remainingCount}`,
              totalLiquidationNotional:
                top[top.length - 1].totalLiquidationNotional * 0.6,
            },
          ]
        : top;

    const scale = scaleSqrt()
      .domain([
        Math.min(...displayAssets.map((d) => d.totalLiquidationNotional)),
        Math.max(...displayAssets.map((d) => d.totalLiquidationNotional)),
      ])
      .range([MIN_RADIUS, MAX_RADIUS]);

    const root = hierarchy({
      children: displayAssets.map((d) => ({
        ...d,
        value: scale(d.totalLiquidationNotional),
      })),
    })
      .sum((d: { value: any }) => d.value)
      .sort(
        (a: { value: any }, b: { value: any }) =>
          (b.value ?? 0) - (a.value ?? 0),
      );

    let packedNodes = pack()
      .size([width, height])
      .padding(6)(root)
      .leaves() as unknown as PackedNode[];

    const center = {
      x: packedNodes.reduce((s, n) => s + n.x, 0) / packedNodes.length,
      y: packedNodes.reduce((s, n) => s + n.y, 0) / packedNodes.length,
    };

    const angle = pseudoRandom(seed, 999) * 2 * Math.PI;

    packedNodes = packedNodes.map((n) => {
      const dx = n.x - center.x;
      const dy = n.y - center.y;
      return {
        ...n,
        x: dx * Math.cos(angle) - dy * Math.sin(angle),
        y: dx * Math.sin(angle) + dy * Math.cos(angle),
      };
    });

    const minX = Math.min(...packedNodes.map((n) => n.x - n.r));
    const maxX = Math.max(...packedNodes.map((n) => n.x + n.r));
    const minY = Math.min(...packedNodes.map((n) => n.y - n.r));
    const maxY = Math.max(...packedNodes.map((n) => n.y + n.r));

    const offsetX = width / 2 - (minX + (maxX - minX) / 2);
    const offsetY = height / 2 - (minY + (maxY - minY) / 2);

    return packedNodes.map((n) => ({
      ...n,
      x: n.x + offsetX,
      y: n.y + offsetY,
    }));
  }, [assets, width, height]);

  return (
    <div
      style={{
        position: "relative",
        width,
        height,
      }}
    >
      {/* Plus more circle */}
      <svg width={width} height={height}>
        {nodes.map((node) => {
          const isMore = node.data.asset.startsWith("+");
          if (!isMore) return null;

          return (
            <g
              key={node.data.asset}
              transform={`translate(${node.x}, ${node.y})`}
            >
              <motion.g
                initial={{ scale: 0, opacity: 0 }}
                animate={
                  isActive ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }
                }
                transition={{
                  type: "spring",
                  stiffness: 120,
                  damping: 14,
                  delay: node.r * 0.002,
                }}
              >
                <circle
                  r={node.r}
                  fill="rgba(255,255,255,0.08)"
                  stroke="rgba(255,255,255,0.25)"
                />
                <text
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="white"
                  fontSize={Math.min(14, node.r / 2)}
                  fontWeight={600}
                  pointerEvents="none"
                >
                  {node.data.asset}
                </text>
              </motion.g>
            </g>
          );
        })}
      </svg>

      {nodes.map((node) => {
        if (node.data.asset.startsWith("+")) return null;
        if (!getHasLogo(node.data.asset)) return null;

        const size = node.r * 2;
        const left = node.x - node.r;
        const top = node.y - node.r;

        return (
          <motion.img
            key={node.data.asset}
            src={getAssetLogoUrl(node.data.asset)}
            alt={node.data.asset}
            initial={{ scale: 0, opacity: 0 }}
            animate={
              isActive ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }
            }
            transition={{
              type: "spring",
              stiffness: 120,
              damping: 14,
              delay: node.r * 0.002,
            }}
            style={{
              position: "absolute",
              left,
              top,
              width: size,
              height: size,
              borderRadius: "50%",
              background: "white",
              boxSizing: "border-box",
              objectFit: "contain",
              pointerEvents: "none",
              filter: "drop-shadow(0 0 3px white)",
            }}
          />
        );
      })}
    </div>
  );
};
