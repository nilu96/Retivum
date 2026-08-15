import {
  commitPayload,
  decodeProvisioningEnvelope,
  encodeProvisioningRequest,
  getStatePayload,
  namespaceListPayload,
  parseCommitResult,
  parseProvisioningInfo,
  parseProvisioningSchema,
  parseProvisioningStateResult,
  parseSetStateResult,
  provisioningOperations,
  provisioningStatePayload,
  type ProvisioningInfo,
  type ProvisioningNode,
  type ProvisioningSchema,
  type ProvisioningState,
  type ProvisioningStateResult,
  type ProvisioningValue,
} from '../../domain/provisioning';
import { BrowserProvisioningRepository } from '../database/provisioning-repository';
import type { ProvisioningRequestStage } from './protocol';
import { ProvisioningRequestFailure, reticulumRuntime } from './runtime';

export interface LoadedProvisioningDevice {
  info: ProvisioningInfo;
  schema: ProvisioningSchema;
  state: ProvisioningState;
  drafts?: ProvisioningState;
}

export type ProvisioningProgressHandler = (
  stage: ProvisioningRequestStage,
  progress?: number,
  dataSize?: number,
) => void;

export class ProvisioningFieldFailure extends Error {
  constructor(
    readonly namespaceId: number,
    readonly fieldId: number,
    readonly code: number,
  ) {
    super(`PROVISIONING_FIELD_ERROR_${namespaceId}_${fieldId}_${code}`);
    this.name = 'ProvisioningFieldFailure';
  }
}

export class ProvisioningClient {
  protected sequence = 1;
  private structuredStateProtocol = false;
  private readonly repository = new BrowserProvisioningRepository();

  constructor(
    readonly provisioningNode: ProvisioningNode,
    private readonly onProgress?: ProvisioningProgressHandler,
  ) {}

  async load(): Promise<LoadedProvisioningDevice> {
    const info = await this.getInfo();
    let schema: ProvisioningSchema | undefined;
    if (info.schemaVersion !== undefined && info.schemaHash !== undefined) {
      schema = await this.repository.loadSchema(info.schemaVersion, info.schemaHash);
    }
    if (!schema) {
      schema = await this.getSchema();
      if (info.schemaVersion !== undefined && info.schemaHash !== undefined) {
        await this.repository.saveSchema(info.schemaVersion, info.schemaHash, schema);
      }
    }
    const state = await this.getStateSnapshot(
      schema.namespaces.map((namespace) => namespace.id),
      true,
    );
    return { info, schema, state: state.values, drafts: state.drafts ?? {} };
  }

  async getInfo(): Promise<ProvisioningInfo> {
    return parseProvisioningInfo(await this.request(provisioningOperations.getInfo));
  }

  async getSchema(): Promise<ProvisioningSchema> {
    return parseProvisioningSchema(await this.request(provisioningOperations.getSchema));
  }

  async getState(namespaceIds?: number[], pending = false): Promise<ProvisioningState> {
    return (await this.getStateSnapshot(namespaceIds, pending)).values;
  }

  async getStateSnapshot(namespaceIds?: number[], pending = false): Promise<ProvisioningStateResult> {
    const result = parseProvisioningStateResult(await this.request(
      provisioningOperations.getState,
      getStatePayload(namespaceIds, pending),
    ));
    this.structuredStateProtocol = result.structured;
    return result;
  }

  async stage(state: ProvisioningState): Promise<ReturnType<typeof parseSetStateResult>> {
    const staged = parseSetStateResult(await this.request(
      provisioningOperations.setState,
      provisioningStatePayload(state, this.structuredStateProtocol, this.structuredStateProtocol),
      false,
    ));
    if (staged.fieldErrors.length) {
      const first = staged.fieldErrors[0];
      throw new ProvisioningFieldFailure(first.namespace, first.field, first.code);
    }
    return staged;
  }

  async commit(namespaceIds?: number[]): Promise<ReturnType<typeof parseCommitResult>> {
    return parseCommitResult(await this.request(
      provisioningOperations.commit,
      this.structuredStateProtocol
        ? commitPayload(namespaceIds, true)
        : namespaceListPayload(namespaceIds),
      false,
    ));
  }

  async save(state: ProvisioningState, namespaceIds?: number[]): Promise<{ applied: number; needsReboot: boolean }> {
    const staged = await this.stage(state);
    const committed = await this.commit(namespaceIds);
    return {
      applied: committed.applied || staged.applied,
      needsReboot: committed.needsReboot || staged.draftHasReboot,
    };
  }

  async discard(namespaceIds?: number[]): Promise<void> {
    await this.request(provisioningOperations.discard, namespaceListPayload(namespaceIds), false);
  }

  async factoryReset(): Promise<void> {
    await this.request(provisioningOperations.factoryReset, undefined, false);
  }

  async reboot(): Promise<void> {
    try {
      await this.request(provisioningOperations.reboot, undefined, false, 3_000);
    } catch (error) {
      if (!(error instanceof ProvisioningRequestFailure)
        || !['PROVISIONING_REQUEST_TIMEOUT', 'PROVISIONING_LINK_CLOSED'].includes(error.code)) throw error;
    } finally {
      this.close();
    }
  }

  close(): void {
    reticulumRuntime.cancelProvisioning(this.provisioningNode.destinationHash, true);
  }

  protected async request(
    operation: number,
    payload?: ProvisioningValue,
    safeToRetry = true,
    responseTimeoutMs?: number,
  ): Promise<ProvisioningValue> {
    const sequence = this.sequence++;
    const response = await reticulumRuntime.requestProvisioning(
      this.provisioningNode,
      encodeProvisioningRequest(operation, sequence, payload),
      safeToRetry,
      this.onProgress,
      responseTimeoutMs,
    );
    const envelope = decodeProvisioningEnvelope(response);
    if (envelope.sequence !== sequence) throw new Error('PROVISIONING_SEQUENCE_MISMATCH');
    return envelope.body;
  }
}
