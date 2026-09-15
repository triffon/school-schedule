import type { Timetable, Weekday } from "./intake/documents.js";

/**
 * A Block: a maximal run of consecutive Slots on one weekday whose Lessons all
 * name the same subject. Blocks, not individual Lessons, are what Destinations
 * publish (ADR-0008) — one recurring event, one merged cell.
 *
 * A Block is derived here and never stated in the Intake, which records one
 * Lesson per cell: the transcribing agent records cells, not runs. A Block
 * covers whatever lies between its Slots, so it spans a Break regardless of
 * that Break's length.
 */
export interface Block {
  weekday: Weekday;
  /** The position of the first Slot of the run, counting from 1. */
  firstSlot: number;
  /** The position of the last Slot; the same as `firstSlot` for one Slot. */
  lastSlot: number;
  subject: string;
}

/**
 * The Blocks of one weekday, in the order its Slots run. Consecutive is meant
 * by Slot position, so a subject taught either side of a Break is one Block and
 * the same subject taught with another subject between is two.
 */
export function blocksOn(timetable: Timetable, weekday: Weekday): Block[] {
  const blocks: Block[] = [];

  for (const { slot, subject } of lessonsOn(timetable, weekday)) {
    const running = blocks.at(-1);

    if (running !== undefined && running.subject === subject && running.lastSlot === slot - 1) {
      running.lastSlot = slot;
      continue;
    }

    blocks.push({ weekday, firstSlot: slot, lastSlot: slot, subject });
  }

  return blocks;
}

/** One weekday's Lessons, by Slot; the Intake holds them in any order. */
function lessonsOn(timetable: Timetable, weekday: Weekday) {
  return timetable.lessons
    .filter((lesson) => lesson.weekday === weekday)
    .sort((one, other) => one.slot - other.slot);
}
