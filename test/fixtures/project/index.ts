/** Fixture project with known-cheap and known-expensive types. */

// cheap
export type UserId = string;
export type Count = number;

export interface Simple {
  id: UserId;
  count: Count;
  label: string;
}

// structural depth
export type DeepChain = {
  a: { b: { c: { d: { e: { f: { g: number } } } } } };
};

// large union
export type Digit =
  0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
  10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 |
  20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 |
  30 | 31 | 32 | 33 | 34 | 35 | 36 | 37 | 38 | 39;

// mapped type machinery
export type Table<T, K extends keyof T> = {
  [P in K]: { key: P; value: T[P]; computed: `col-${string & P}` };
};

export interface RowShape {
  id: number;
  name: string;
  price: number;
  tags: string[];
  meta: Record<string, number>;
}

export type RowTable = Table<RowShape, 'id' | 'name' | 'price' | 'tags'>;

// recursive
export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json };

// conditional + template
export type EventName<T extends string> = `on${Capitalize<T>}`;
export type RowEvents = EventName<keyof RowShape & string>;

export const typedConfig: {
  rows: RowTable;
  events: RowEvents;
  deep: DeepChain;
  digit: Digit;
  payload: Json;
} = null as unknown as {
  rows: RowTable;
  events: RowEvents;
  deep: DeepChain;
  digit: Digit;
  payload: Json;
};

export function renderRow(row: RowTable['id']): string {
  return `${row.key}=${String(row.value)}`;
}
