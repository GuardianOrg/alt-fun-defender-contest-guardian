import { randomBytes } from "node:crypto";

import {
  MAX_TOKEN_NAME_LENGTH,
  MAX_TOKEN_SYMBOL_LENGTH,
  utf8ByteLength,
} from "@launchpad/shared";

/**
 * Adjective + noun + optional sigil generator. Cheap to maintain, prints
 * something a human can scan in the trade feed (helpful when eyeballing a
 * stress run — undifferentiated `Token0001` / `Token0002` makes UI bugs
 * harder to spot, not easier). Words are short enough that the longest
 * possible composition fits well inside `MAX_TOKEN_NAME_LENGTH` (34 bytes).
 */
const ADJECTIVES = [
  "Brave",
  "Silent",
  "Cosmic",
  "Neon",
  "Frosted",
  "Crimson",
  "Hyper",
  "Mystic",
  "Plasma",
  "Velvet",
  "Lunar",
  "Solar",
  "Stellar",
  "Quantum",
  "Vivid",
  "Dapper",
  "Feral",
  "Lucid",
  "Iron",
  "Atomic",
  "Cyber",
  "Astral",
  "Polar",
  "Wild",
  "Glassy",
  "Toxic",
  "Pixel",
  "Royal",
  "Echo",
  "Bold",
];

const NOUNS = [
  "Tiger",
  "Wave",
  "Dust",
  "Falcon",
  "Lotus",
  "Comet",
  "Tundra",
  "Mirage",
  "Phoenix",
  "Cypher",
  "Orbit",
  "Forge",
  "Saber",
  "Atlas",
  "Beacon",
  "Cascade",
  "Drift",
  "Ember",
  "Glyph",
  "Husk",
  "Ion",
  "Jolt",
  "Kraken",
  "Lattice",
  "Nimbus",
  "Onyx",
  "Prism",
  "Quartz",
  "Rune",
  "Spire",
];

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

/**
 * Short random alphanumeric tag — used to disambiguate names and tickers
 * when the same `(adjective, noun)` pair gets drawn twice in one run.
 * The on-chain `(creator, name, ticker, salt)` quartet is what determines
 * the CREATE2 address, so duplicates would either collide on `userSalt`
 * or just produce noise in the trade feed. Using `randomBytes(2)` →
 * 4-char hex gives 65,536 distinct tags, well past the birthday wall for
 * a 1K-token run.
 */
function randomTag(): string {
  return randomBytes(2).toString("hex").toUpperCase();
}

function clampToBytes(value: string, maxBytes: number): string {
  if (utf8ByteLength(value) <= maxBytes) return value;
  let trimmed = value;
  while (utf8ByteLength(trimmed) > maxBytes) trimmed = trimmed.slice(0, -1);
  return trimmed;
}

export interface RandomTokenIdentity {
  name: string;
  ticker: string;
  description: string;
}

export function randomTokenIdentity(): RandomTokenIdentity {
  const adjective = pick(ADJECTIVES);
  const noun = pick(NOUNS);
  const tag = randomTag();

  const name = clampToBytes(`${adjective} ${noun} ${tag}`, MAX_TOKEN_NAME_LENGTH);
  const tickerBase = `${adjective.slice(0, 3)}${noun.slice(0, 3)}`.toUpperCase();
  const ticker = clampToBytes(`${tickerBase}${tag.slice(0, 2)}`, MAX_TOKEN_SYMBOL_LENGTH);

  const description = `Stress-test token ${name}. Generated automatically — do not trade.`;

  return { name, ticker, description };
}
