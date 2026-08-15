import {
  provisioningFieldFlags,
  type ProvisioningField,
  type ProvisioningNamespace,
  type ProvisioningState,
  type ProvisioningValue,
} from '../../domain/provisioning';

export function provisioningFieldKey(namespaceId: number, fieldId: number): string {
  return `${namespaceId}:${fieldId}`;
}

export function provisioningNamespaceTree(
  namespaces: readonly ProvisioningNamespace[],
  rootId: number,
): ProvisioningNamespace[] {
  const result: ProvisioningNamespace[] = [];
  const seen = new Set<number>();
  const visit = (namespaceId: number): void => {
    if (seen.has(namespaceId)) return;
    const namespace = namespaces.find((candidate) => candidate.id === namespaceId);
    if (!namespace) return;
    seen.add(namespaceId);
    result.push(namespace);
    for (const child of namespaces) if (child.parentId === namespaceId) visit(child.id);
  };
  visit(rootId);
  return result;
}

export function provisioningNamespaceDepth(
  namespaces: readonly ProvisioningNamespace[],
  rootId: number,
  namespaceId: number,
): number {
  if (namespaceId === rootId) return 0;
  let current = namespaces.find((namespace) => namespace.id === namespaceId);
  let depth = 0;
  const visited = new Set<number>();
  while (current && current.id !== rootId && !visited.has(current.id)) {
    visited.add(current.id);
    depth += 1;
    current = namespaces.find((namespace) => namespace.id === current?.parentId);
  }
  return current?.id === rootId ? depth : 0;
}

export function provisioningFieldIsWriteOnly(field: ProvisioningField): boolean {
  return (field.flags & provisioningFieldFlags.writeOnly) !== 0;
}

export function provisioningFieldIsReadOnly(field: ProvisioningField): boolean {
  return !provisioningFieldIsWriteOnly(field)
    && (field.flags & provisioningFieldFlags.readOnly) !== 0;
}

export function provisioningFieldIsSecret(field: ProvisioningField): boolean {
  return (field.flags & provisioningFieldFlags.secret) !== 0;
}

export function provisioningNamespaceIsReadOnly(
  namespaces: readonly ProvisioningNamespace[],
  namespaceId: number,
): boolean {
  const fields = provisioningNamespaceTree(namespaces, namespaceId)
    .flatMap((namespace) => namespace.fields);
  return fields.length > 0 && fields.every(provisioningFieldIsReadOnly);
}

export function provisioningValuesEqual(
  left: ProvisioningValue | undefined,
  right: ProvisioningValue | undefined,
): boolean {
  if (Object.is(left, right)) return true;
  const leftBytes = provisioningByteArrayValue(left);
  const rightBytes = provisioningByteArrayValue(right);
  if (leftBytes && rightBytes) {
    return leftBytes.length === rightBytes.length
      && leftBytes.every((byte, index) => byte === rightBytes[index]);
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => (
      provisioningValuesEqual(value, right[index])
    ));
  }
  if (left instanceof Map && right instanceof Map) {
    if (left.size !== right.size) return false;
    return Array.from(left).every(([leftKey, leftValue]) => Array.from(right).some(
      ([rightKey, rightValue]) => provisioningValuesEqual(leftKey, rightKey)
        && provisioningValuesEqual(leftValue, rightValue),
    ));
  }
  return false;
}

export function provisioningByteArrayValue(
  value: ProvisioningValue | undefined,
): readonly number[] | undefined {
  if (value instanceof Uint8Array) return Array.from(value);
  if (Array.isArray(value) && value.every((byte) => (
    typeof byte === 'number' && Number.isInteger(byte) && byte >= 0 && byte <= 255
  ))) return value as number[];
  if (value && typeof value === 'object' && !(value instanceof Map)) {
    const indexedBytes = Object.entries(value)
      .filter(([key]) => /^\d+$/.test(key))
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([, byte]) => byte);
    if (indexedBytes.length > 0 && indexedBytes.every((byte) => (
      typeof byte === 'number' && Number.isInteger(byte) && byte >= 0 && byte <= 255
    ))) return indexedBytes as number[];
  }
  return undefined;
}

export function provisioningStateWithDrafts(
  state: ProvisioningState,
  drafts: ProvisioningState = {},
): ProvisioningState {
  const result = cloneProvisioningState(state);
  for (const [namespaceId, fields] of Object.entries(drafts)) {
    result[Number(namespaceId)] = {
      ...(result[Number(namespaceId)] ?? {}),
      ...cloneProvisioningFields(fields),
    };
  }
  return result;
}

export function provisioningStateFieldKeys(state: ProvisioningState = {}): string[] {
  return Object.entries(state).flatMap(([namespaceId, fields]) => (
    Object.keys(fields).map((fieldId) => provisioningFieldKey(Number(namespaceId), Number(fieldId)))
  ));
}

export function provisioningEditableState(
  dirtyFields: readonly string[],
  draft: ProvisioningState,
  namespaceIds: ReadonlySet<number>,
): ProvisioningState {
  const result: ProvisioningState = {};
  for (const key of dirtyFields) {
    const [namespaceId, fieldId] = key.split(':').map(Number);
    if (!namespaceIds.has(namespaceId)) continue;
    const value = draft[namespaceId]?.[fieldId];
    if (value === undefined) continue;
    result[namespaceId] = { ...(result[namespaceId] ?? {}), [fieldId]: value };
  }
  return result;
}

export function provisioningDisplayValue(value: ProvisioningValue | undefined): string {
  if (value === undefined || value === null) return '—';
  if (value instanceof Uint8Array) return provisioningBytesToHex(value);
  if (Array.isArray(value)) return value.map(provisioningDisplayValue).join(', ');
  if (value instanceof Map) return '—';
  return String(value);
}

export function provisioningDisplayListValue(value: ProvisioningValue | undefined): string {
  return Array.isArray(value)
    ? value.map((item) => {
      const bytes = provisioningByteArrayValue(item);
      return bytes ? provisioningBytesToHex(Uint8Array.from(bytes)) : provisioningDisplayValue(item);
    }).join('\n')
    : provisioningDisplayValue(value);
}

export function parseProvisioningBytes(value: string): Uint8Array {
  const normalized = value.replace(/[^0-9a-f]/gi, '');
  if (normalized.length % 2 !== 0) throw new Error('PROVISIONING_BYTES_INVALID');
  return Uint8Array.from(
    { length: normalized.length / 2 },
    (_, index) => Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16),
  );
}

export function parseProvisioningBytesList(value: string): ProvisioningValue[] {
  return value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean).map(parseProvisioningBytes);
}

function provisioningBytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function cloneProvisioningState(state: ProvisioningState): ProvisioningState {
  return Object.fromEntries(Object.entries(state).map(([namespaceId, fields]) => [
    Number(namespaceId),
    cloneProvisioningFields(fields),
  ]));
}

function cloneProvisioningFields(
  fields: Record<number, ProvisioningValue>,
): Record<number, ProvisioningValue> {
  return Object.fromEntries(Object.entries(fields).map(([fieldId, value]) => [
    Number(fieldId),
    cloneProvisioningValue(value),
  ]));
}

function cloneProvisioningValue(value: ProvisioningValue): ProvisioningValue {
  if (value instanceof Uint8Array) return Uint8Array.from(value);
  if (Array.isArray(value)) return value.map(cloneProvisioningValue);
  if (value instanceof Map) {
    return new Map(Array.from(value, ([key, entry]) => [
      cloneProvisioningValue(key),
      cloneProvisioningValue(entry),
    ]));
  }
  return value;
}
