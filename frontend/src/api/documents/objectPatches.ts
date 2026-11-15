import type { SceneObject } from "../types/paint";
export type ObjectPatch = {
    id: string;
} & Record<string, unknown>;
export const field = (object: SceneObject | undefined, key: string): unknown => (object as unknown as Record<string, unknown> | undefined)?.[key];
export const equal = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);
export function objectChanges(before: SceneObject[], after: SceneObject[]) {
    const previous = new Map(before.map((o) => [o.id, o]));
    const ids = new Set(after.map((o) => o.id));
    const changes: ObjectPatch[] = [];
    for (const object of after) {
        const old = previous.get(object.id);
        if (!old) {
            changes.push({ ...object });
            continue;
        }
        if (old === object)
            continue;
        const patch: ObjectPatch = { id: object.id };
        for (const key of new Set([...Object.keys(old), ...Object.keys(object)])) {
            if (field(old, key) !== field(object, key))
                patch[key] = field(object, key) ?? null;
        }
        if (Object.keys(patch).length > 1)
            changes.push(patch);
    }
    return { changes, removed: before.filter((o) => !ids.has(o.id)).map((o) => o.id) };
}
export function mergeObjects(remote: SceneObject[], changes: ObjectPatch[], removed: string[]) {
    const objects = new Map(remote.filter((o) => !removed.includes(o.id)).map((o) => [o.id, o]));
    for (const change of changes)
        objects.set(change.id!, { ...objects.get(change.id!), ...change } as SceneObject);
    return [...objects.values()];
}
