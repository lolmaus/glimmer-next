/*
  This is a proof of concept for a new approach to reactive programming.
  It's related to Glimmer-VM's `@tracked` system, but without invalidation step.
  We explicitly update DOM only when it's needed and only if tags are changed.
*/
import { scheduleRevalidate } from '@/utils/runtime';
import { isFn, isTag, isTagLike } from '@/utils/shared';

export const asyncOpcodes = new WeakSet<tagOp>();
// List of DOM operations for each tag
export const opsForTag: WeakMap<
  Cell | MergedCell,
  Array<tagOp>
> = new WeakMap();
// REVISION replacement, we use a set of tags to revalidate
export const tagsToRevalidate: Set<Cell> = new Set();
// List of derived tags for each cell
export const relatedTags: WeakMap<Cell, Set<MergedCell>> = new WeakMap();

const DEBUG_MERGED_CELLS = new Set<MergedCell>();
const DEBUG_CELLS = new Set<Cell>();

export function getCells() {
  return Array.from(DEBUG_CELLS);
}
export function getMergedCells() {
  return Array.from(DEBUG_MERGED_CELLS);
}

if (IS_DEV_MODE) {
  window['getVM'] = () => ({
    relatedTags,
    tagsToRevalidate,
    opsForTag,
  });
}

export function tracked(
  klass: any,
  key: string,
  descriptor?: PropertyDescriptor & { initializer?: () => any },
): void {
  let value: any = cell(
    descriptor?.value,
    `${klass.constructor.name}.${key}.@tracked`,
  );
  let isInitialized = false;
  let hasInitializer = typeof descriptor?.initializer === 'function';
  return {
    get() {
      if (!isInitialized && hasInitializer) {
        isInitialized = true;
        const initValue = descriptor!.initializer?.();
        const refs = cellsMap.get(this) || {};
        refs[key] = value;
        cellsMap.set(this, refs);
        value.update(initValue);
      } else if (!isInitialized) {
        const refs = cellsMap.get(this) || {};
        refs[key] = value;
        cellsMap.set(this, refs);
      }
      return value.value;
    },
    set(newValue: any) {
      if (newValue === value) {
        return;
      }
      value.update(newValue);
    },
    enumerable: descriptor?.enumerable ?? true,
    configurable: descriptor?.configurable ?? true,
  } as unknown as void;
}
// we have only 2 types of cells
export type AnyCell = Cell | MergedCell;

let currentTracker: Set<Cell> | null = null;
let _isRendering = false;

export function isRendering() {
  return _isRendering;
}
export function setIsRendering(value: boolean) {
  _isRendering = value;
}

function tracker() {
  return new Set<Cell>();
}
// "data" cell, it's value can be updated, and it's used to create derived cells
export class Cell<T extends unknown = unknown> {
  _value!: T;
  declare toHTML: () => string;
  [Symbol.toPrimitive]() {
    return this.value;
  }
  _debugName?: string | undefined;
  [isTag] = true;
  constructor(value: T, debugName?: string) {
    this._value = value;
    if (IS_DEV_MODE) {
      this._debugName = debugName;
      DEBUG_CELLS.add(this);
    }
  }
  get value() {
    if (currentTracker !== null) {
      currentTracker.add(this);
    }
    return this._value;
  }
  set value(value: T) {
    this.update(value);
  }
  update(value: T) {
    this._value = value;
    tagsToRevalidate.add(this);
    scheduleRevalidate();
  }
}

export function listDependentCells(cells: Array<AnyCell>, cell: MergedCell) {
  const msg = [cell._debugName, 'depends on:'];
  cells.forEach((cell) => {
    msg.push(cell._debugName);
  });
  return msg.join(' ');
}

export function opsFor(cell: AnyCell) {
  if (!opsForTag.has(cell)) {
    const ops: tagOp[] = [];
    opsForTag.set(cell, ops);
    return ops;
  }
  return opsForTag.get(cell)!;
}

export function relatedTagsForCell(cell: Cell) {
  if (!relatedTags.has(cell)) {
    const tags = new Set<MergedCell>();
    relatedTags.set(cell, tags);
    return tags;
  }
  return relatedTags.get(cell)!;
}

function bindAllCellsToTag(cells: Set<Cell>, tag: MergedCell) {
  cells.forEach((cell) => {
    const tags = relatedTagsForCell(cell);
    tags.add(tag);
  });
}

// "derived" cell, it's value is calculated from other cells, and it's value can't be updated
export class MergedCell {
  fn: Fn | Function;
  declare toHTML: () => string;
  isConst = false;
  isDestroyed = false;
  [Symbol.toPrimitive]() {
    return this.value;
  }
  _debugName?: string | undefined;
  relatedCells: Set<Cell> | null = null;
  [isTag] = true;
  constructor(fn: Fn | Function, debugName?: string) {
    this.fn = fn;
    if (IS_DEV_MODE) {
      this._debugName = debugName;
      DEBUG_MERGED_CELLS.add(this);
    }
  }
  destroy() {
    this.isDestroyed = true;
    opsForTag.delete(this);
    if (this.relatedCells !== null) {
      this.relatedCells.forEach((cell) => {
        relatedTags.get(cell)?.delete(this);
      });
      this.relatedCells.clear();
    }
    if (IS_DEV_MODE) {
      DEBUG_MERGED_CELLS.delete(this);
    }
  }
  get value() {
    if (this.isDestroyed) {
      return;
    } else if (this.isConst) {
      return this.fn();
    } else if (null === currentTracker && _isRendering) {
      currentTracker = tracker();
      try {
        return this.fn();
      } finally {
        if (currentTracker.size > 0) {
          bindAllCellsToTag(currentTracker, this);
        } else {
          this.isConst = true;
        }
        this.relatedCells = currentTracker;
        currentTracker = null;
      }
    } else {
      return this.fn();
    }
  }
}

// this function is called when we need to update DOM, values represented by tags are changed
export type tagOp = (...values: unknown[]) => Promise<void> | void;

// this is runtime function, it's called when we need to update DOM for a specific tag
export async function executeTag(tag: Cell | MergedCell) {
  let opcode: null | tagOp = null;
  // we always have ops for a tag
  if (!opsForTag.has(tag)) {
    return;
  }
  const ops = opsFor(tag)!;
  try {
    const value = tag.value;
    for (const op of ops) {
      opcode = op;
      if (asyncOpcodes.has(op)) {
        await op(value);
      } else {
        op(value);
      }
    }
  } catch (e: any) {
    if (IS_DEV_MODE) {
      console.error({
        message: 'Error executing tag',
        error: e,
        tag,
        opcode: opcode?.toString(),
      });
    }
    if (opcode) {
      let index = ops.indexOf(opcode);
      if (index > -1) {
        ops.splice(index, 1);
      }
    }
  }
}

const cellsMap = new WeakMap<object, Record<string, Cell<unknown>>>();
// this is function to create a reactive cell from an object property
export function cellFor<T extends object, K extends keyof T>(
  obj: T,
  key: K,
): Cell<T[K]> {
  const refs = cellsMap.get(obj) || {};
  if (key in refs) {
    return refs[key as unknown as string] as Cell<T[K]>;
  }
  const cellValue = new Cell<T[K]>(
    obj[key],
    `${obj.constructor.name}.${String(key)}`,
  );
  refs[key as unknown as string] = cellValue;
  cellsMap.set(obj, refs);
  Object.defineProperty(obj, key, {
    get() {
      return cellValue.value;
    },
    set(val) {
      cellValue.update(val);
    },
  });
  return cellValue;
}

type Fn = () => unknown;

export function formula(fn: Function | Fn, debugName?: string) {
  return new MergedCell(fn, `formula:${debugName ?? 'unknown'}`);
}

export function deepFnValue(fn: Function | Fn) {
  const cell = fn();
  if (isFn(cell)) {
    return deepFnValue(cell);
  } else if (typeof cell === 'object' && cell !== null && isTagLike(cell)) {
    return deepFnValue(() => cell.value);
  } else {
    return cell;
  }
}

export function cell<T>(value: T, debugName?: string) {
  return new Cell(value, debugName);
}
