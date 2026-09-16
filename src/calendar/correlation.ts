import type { Block } from "../blocks.js";
import type { Term } from "../intake/documents.js";
import type { CalendarEventInput } from "../ports/calendar.js";

/**
 * The private extended properties every published event is stamped with, and
 * what a later run reads back off the calendar to decide which Block an event
 * already there belongs to (ADR-0006). All three are plain text, so they read
 * in the Google UI as well as in a listing.
 */

/** Says the event is the pipeline's own, whatever Block or Term it holds. */
const PUBLISHED_BY = "publishedBy";
const PIPELINE = "school-schedule";

/**
 * The `events.list` filter that returns the pipeline's own events and nothing
 * else — which is what stops a run mistaking an event the operator created for
 * one of its own, and what lets it see a previous Term's events to sweep them.
 */
export const PIPELINE_EVENTS = `${PUBLISHED_BY}=${PIPELINE}`;

/**
 * What an event is stamped with. The Term is identified by the dates it is in
 * force over rather than by Config's label for it: the label is a display
 * choice, and an event already published should not be swept and rebuilt
 * because the school reworded it.
 */
export function stampOf(block: Block, term: Term): Record<string, string> {
  return {
    [PUBLISHED_BY]: PIPELINE,
    block: `${block.weekday}-${block.firstSlot}`,
    term: `${term.start}/${term.end}`,
  };
}

/**
 * What an event correlates on: its Block within its Term, so that an event
 * carrying a Term that is no longer in force matches no Block of this run and
 * is swept rather than updated.
 *
 * `undefined` for an event that has lost part of its stamp — stripped in the
 * Google UI, or published by a run that stamped something else. Such an event
 * is an orphan: it is deleted and its Block published afresh rather than
 * updated in place.
 */
export function correlationOf(event: CalendarEventInput): string | undefined {
  const stamped = event.extendedProperties?.private;
  if (stamped?.block === undefined || stamped.term === undefined) return undefined;
  return `${stamped.term} ${stamped.block}`;
}
