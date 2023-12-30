import { Cell } from "./reactive";

// write decorator to track changes
export function tracked(target: any, key: string) {
    console.log('trakced', arguments);

  const cell = new Cell(target[key]);
  // define getter and setter
  Object.defineProperty(target, key, {
    get() {
      return cell.value;
    },
    set(value) {
        cell.update(value);
    },
  });
}