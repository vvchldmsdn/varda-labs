export type SimulationCuratedApprovedVectorSnapshotRecord = Readonly<
  Record<string, unknown>
>;

export function snapshotSimulationCuratedApprovedVectorRecord(
  value: unknown,
  fields: readonly string[],
  optionalFields: readonly string[] = [],
): SimulationCuratedApprovedVectorSnapshotRecord | null {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      Object.getPrototypeOf(value) !== Object.prototype
    ) {
      return null;
    }
    const keys = Reflect.ownKeys(value);
    const requiredFields = fields.filter(
      (field) => !optionalFields.includes(field),
    );
    if (
      keys.length < requiredFields.length ||
      keys.length > fields.length ||
      keys.some(
        (key) => typeof key !== "string" || !fields.includes(key),
      ) ||
      requiredFields.some((field) => !keys.includes(field))
    ) {
      return null;
    }

    const snapshot: Record<string, unknown> = Object.create(null);
    for (const field of fields) {
      const descriptor = Object.getOwnPropertyDescriptor(value, field);
      if (!descriptor && optionalFields.includes(field)) {
        snapshot[field] = undefined;
        continue;
      }
      if (
        !descriptor ||
        !Object.hasOwn(descriptor, "value") ||
        descriptor.enumerable !== true
      ) {
        return null;
      }
      snapshot[field] = descriptor.value;
    }
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
}

export function snapshotSimulationCuratedApprovedVectorArray(
  value: unknown,
  maxLength: number,
): readonly unknown[] | null {
  try {
    if (
      !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype
    ) {
      return null;
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !lengthDescriptor ||
      !Object.hasOwn(lengthDescriptor, "value") ||
      !Number.isInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > maxLength
    ) {
      return null;
    }
    const length = lengthDescriptor.value as number;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== length + 1) return null;

    const expectedKeys = new Set<string>(["length"]);
    for (let index = 0; index < length; index += 1) {
      expectedKeys.add(String(index));
    }
    if (
      keys.some(
        (key) => typeof key !== "string" || !expectedKeys.has(key),
      )
    ) {
      return null;
    }

    const snapshot = new Array<unknown>(length);
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        !descriptor ||
        !Object.hasOwn(descriptor, "value") ||
        descriptor.enumerable !== true
      ) {
        return null;
      }
      snapshot[index] = descriptor.value;
    }
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
}
