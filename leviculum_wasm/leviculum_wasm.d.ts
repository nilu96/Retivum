/* tslint:disable */
/* eslint-disable */

export interface LxmfFileAttachment { name: string; data: Uint8Array; }
export interface LxmfImageAttachment { format: string; data: Uint8Array; }
export interface LxmfAudioAttachment { mode: 'codec2-450pwb' | 'codec2-450' | 'codec2-700c' | 'codec2-1200' | 'codec2-1300' | 'codec2-1400' | 'codec2-1600' | 'codec2-2400' | 'codec2-3200' | 'opus-ogg' | 'opus-lbw' | 'opus-mbw' | 'opus-ptt' | 'opus-rt-hdx' | 'opus-rt-fdx' | 'opus-standard' | 'opus-hq' | 'opus-broadcast' | 'opus-lossless' | 'custom'; data: Uint8Array; }
export interface LxmfMessageAttachments { files: LxmfFileAttachment[]; image?: LxmfImageAttachment; audio?: LxmfAudioAttachment; }
export interface LxmfMessageOptions { destinationHash: Uint8Array; title?: Uint8Array; content?: Uint8Array; fields?: Array<{ key: string; valueMsgpack: Uint8Array }>; attachments?: LxmfMessageAttachments; timestamp?: number; method?: 'opportunistic' | 'direct' | 'propagated' | 'paper'; includeTicket?: boolean; }



/**
 * A signed LXMF message prepared independently of the live Reticulum node.
 */
export class LxmfMessage {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    attachments(): LxmfMessageAttachments;
    content(): Uint8Array;
    destinationHash(): Uint8Array;
    fields(): any;
    messageId(): Uint8Array;
    method(): string;
    onAir(): Uint8Array;
    pack(): Uint8Array;
    setStamp(stamp: Uint8Array): void;
    sourceHash(): Uint8Array;
    stamp(): Uint8Array | undefined;
    timestamp(): number;
    title(): Uint8Array;
}

export class ReticulumNode {
    free(): void;
    [Symbol.dispose](): void;
    acceptResource(link_id: Uint8Array): any;
    activeLinkCount(): number;
    addInterface(options: any): number;
    announce(destination_hash: Uint8Array, app_data?: Uint8Array | null): any;
    announceLxmf(options: any): any;
    cancelLxmf(message_id: Uint8Array): any;
    cancelLxmfPropagationRequest(): any;
    clearDirtyPersistentState(): void;
    closeLink(link_id: Uint8Array): any;
    connect(destination_hash: Uint8Array, destination_signing_key: Uint8Array): any;
    deregisterRequestHandler(path: string): boolean;
    diagnosticDump(): string;
    /**
     * Remove one cached path by destination hash without disturbing any
     * other path-table entries or live links.
     */
    dropPath(destination_hash: Uint8Array): boolean;
    /**
     * Enable one LXMF delivery router on this Reticulum node.
     */
    enableLxmf(options: any): any;
    enqueueLxmf(message: LxmfMessage): any;
    exportIdentityPersistentState(): any;
    exportIdentityPrivateKey(): Uint8Array;
    exportNetworkPersistentState(): any;
    exportPersistentState(): any;
    static fullHash(data: Uint8Array): Uint8Array;
    static generateIdentity(): any;
    /**
     * Calculate the independent outer stamp accepted by a propagation node.
     * This operates on the transient ID exposed by
     * `lxmfPropagationStampPending`, not on the clear LXMF message ID.
     */
    static generateLxmfPropagationStamp(transient_id: Uint8Array, cost: number, yield_every?: number | null): Promise<Uint8Array>;
    /**
     * Calculate a detached PoW stamp for a queued/restored message ID. Since
     * this is a static operation, no `ReticulumNode` or `LxmfMessage` borrow
     * is held while JavaScript awaits it.
     */
    static generateLxmfStamp(message_id: Uint8Array, cost: number, yield_every?: number | null): Promise<Uint8Array>;
    hasLxmfMessage(message_id: Uint8Array): boolean;
    hasLxmfOutboundTicket(destination_hash: Uint8Array): boolean;
    hasPath(destination_hash: Uint8Array): boolean;
    /**
     * Derive a destination hash from its full name and a complete public
     * identity. This is equivalent to Python Reticulum's
     * `Destination.hash_from_name_and_identity(full_name, identity)`.
     */
    static hashFromNameAndIdentity(full_name: string, public_key: Uint8Array): Uint8Array;
    hopsTo(destination_hash: Uint8Array): number | undefined;
    identifyLink(link_id: Uint8Array): any;
    static identityFromPrivateKey(private_key: Uint8Array): any;
    identityHash(): Uint8Array;
    identityPublicKey(): Uint8Array;
    ingestLxmfPaper(uri: string): any;
    linkStats(link_id: Uint8Array): any;
    lxmfDeliveryDestinationHash(): Uint8Array | undefined;
    lxmfOutbound(): any;
    /**
     * Query the currently prepared propagation work item for a queued
     * message. This also restores the handoff after reloading persistence.
     */
    lxmfOutboundPropagationStampRequest(message_id: Uint8Array): any;
    lxmfOutboundStampCost(destination_hash: Uint8Array): number | undefined;
    lxmfPropagationNodes(): any;
    lxmfPropagationStatus(): any;
    memoryReport(): any;
    constructor(options: any);
    nextDeadlineMs(): bigint | undefined;
    paperLxmfUri(message: LxmfMessage): string;
    /**
     * Inspect announce app-data only when its Reticulum name hash identifies
     * an LXMF delivery destination. This keeps MessagePack compatibility and
     * legacy announce parsing inside the Rust implementation.
     */
    static parseLxmfDeliveryAnnounce(name_hash: Uint8Array, app_data: Uint8Array): any;
    /**
     * Inspect and validate announce app-data only when its Reticulum name
     * hash identifies an LXMF propagation destination.
     */
    static parseLxmfPropagationAnnounce(name_hash: Uint8Array, app_data: Uint8Array): any;
    pathCount(): number;
    pendingLinkCount(): number;
    prepareLxmfMessage(options: LxmfMessageOptions): LxmfMessage;
    receive(interface_id: number, data: Uint8Array): any;
    registerDestination(options: any): Uint8Array;
    registerRequestHandler(options: any): void;
    rejectLink(link_id: Uint8Array): void;
    rejectResource(link_id: Uint8Array): any;
    /**
     * Register a complete remote Reticulum identity learned out of band.
     */
    rememberIdentity(destination_hash: Uint8Array, public_key: Uint8Array): void;
    requestLxmfMessages(max_messages?: number | null): any;
    requestPath(destination_hash: Uint8Array): any;
    /**
     * Select the preferred propagation node when it is announced and
     * reachable, or the best reachable announced node otherwise.
     */
    selectLxmfPropagationNode(preferred_destination_hash?: Uint8Array | null): any;
    sendDataProof(link_id: Uint8Array, packet_hash: Uint8Array): any;
    sendOnLink(link_id: Uint8Array, data: Uint8Array): any;
    sendPacketOnLink(link_id: Uint8Array, data: Uint8Array): any;
    sendProof(packet_hash: Uint8Array, destination_hash: Uint8Array, interface_index?: number | null): any;
    /**
     * Send a request, automatically using a Resource when the encoded request
     * exceeds the Link MDU. The returned hash is always the request id.
     */
    sendRequest(link_id: Uint8Array, path: string, data?: Uint8Array | null, timeout_ms?: bigint | null): any;
    sendResource(link_id: Uint8Array, data: Uint8Array, metadata?: Uint8Array | null, auto_compress?: boolean | null): any;
    /**
     * Send a response, automatically using a Resource when the encoded
     * response exceeds the Link MDU.
     */
    sendResponse(link_id: Uint8Array, request_id: Uint8Array, response_data: Uint8Array): any;
    sendResponseResource(link_id: Uint8Array, request_id: Uint8Array, response_data: Uint8Array): any;
    sendSinglePacket(destination_hash: Uint8Array, data: Uint8Array): any;
    setInterfaceOnline(id: number, online: boolean): any;
    /**
     * Replace the identity-bound LXMF inbound ignore policy.
     *
     * `destination_hashes` is a flat sequence of 16-byte destination hashes.
     * The complete set is checkpointed with the router so frontends can
     * reconcile their durable block list atomically after startup and
     * identity changes.
     */
    setLxmfIgnoredDestinations(destination_hashes: Uint8Array): any;
    /**
     * Apply a detached inbound stamp validation result only while the
     * retained message, stamp and configured cost still match.
     */
    setLxmfInboundStampResult(message_id: Uint8Array, stamp: Uint8Array, target_cost: number, valid: boolean): any;
    /**
     * Attach a detached propagation-node stamp to a prepared outbound upload.
     */
    setLxmfOutboundPropagationStamp(message_id: Uint8Array, stamp: Uint8Array): any;
    /**
     * Apply a worker result only if the encrypted transient and advertised
     * propagation cost still match the work item that was calculated.
     */
    setLxmfOutboundPropagationStampResult(message_id: Uint8Array, transient_id: Uint8Array, target_cost: number, stamp: Uint8Array): any;
    /**
     * Attach a detached, worker-generated or restored-queue stamp and make
     * the queued entry immediately eligible for another delivery attempt.
     */
    setLxmfOutboundStamp(message_id: Uint8Array, stamp: Uint8Array): any;
    /**
     * Apply a detached worker result only if the destination's current stamp
     * cost still matches the emitted request.
     */
    setLxmfOutboundStampResult(message_id: Uint8Array, target_cost: number, stamp: Uint8Array): any;
    setLxmfPropagationNode(destination_hash?: Uint8Array | null): any;
    sign(message: Uint8Array): Uint8Array;
    tick(): any;
    transportedPacketCount(): bigint;
    static truncatedHash(data: Uint8Array): Uint8Array;
    unregisterDestination(destination_hash: Uint8Array): void;
    /**
     * Validate a detached inbound delivery stamp without borrowing the live
     * Reticulum node across the asynchronous workblock calculation.
     */
    static validateLxmfStamp(message_id: Uint8Array, stamp: Uint8Array, cost: number, yield_every?: number | null): Promise<boolean>;
    static validateSignature(public_key: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean;
}

export function start(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_lxmfmessage_free: (a: number, b: number) => void;
    readonly lxmfmessage_attachments: (a: number) => [number, number, number];
    readonly lxmfmessage_content: (a: number) => [number, number];
    readonly lxmfmessage_destinationHash: (a: number) => [number, number];
    readonly lxmfmessage_fields: (a: number) => [number, number, number];
    readonly lxmfmessage_messageId: (a: number) => [number, number];
    readonly lxmfmessage_method: (a: number) => [number, number];
    readonly lxmfmessage_onAir: (a: number) => [number, number, number, number];
    readonly lxmfmessage_pack: (a: number) => [number, number];
    readonly lxmfmessage_setStamp: (a: number, b: number, c: number) => [number, number];
    readonly lxmfmessage_sourceHash: (a: number) => [number, number];
    readonly lxmfmessage_stamp: (a: number) => [number, number];
    readonly lxmfmessage_timestamp: (a: number) => number;
    readonly lxmfmessage_title: (a: number) => [number, number];
    readonly reticulumnode_announceLxmf: (a: number, b: any) => [number, number, number];
    readonly reticulumnode_cancelLxmf: (a: number, b: number, c: number) => [number, number, number];
    readonly reticulumnode_cancelLxmfPropagationRequest: (a: number) => [number, number, number];
    readonly reticulumnode_enableLxmf: (a: number, b: any) => [number, number, number];
    readonly reticulumnode_enqueueLxmf: (a: number, b: number) => [number, number, number];
    readonly reticulumnode_generateLxmfPropagationStamp: (a: number, b: number, c: number, d: number, e: number) => any;
    readonly reticulumnode_generateLxmfStamp: (a: number, b: number, c: number, d: number, e: number) => any;
    readonly reticulumnode_hasLxmfMessage: (a: number, b: number, c: number) => [number, number, number];
    readonly reticulumnode_hasLxmfOutboundTicket: (a: number, b: number, c: number) => [number, number, number];
    readonly reticulumnode_ingestLxmfPaper: (a: number, b: number, c: number) => [number, number, number];
    readonly reticulumnode_lxmfDeliveryDestinationHash: (a: number) => [number, number];
    readonly reticulumnode_lxmfOutbound: (a: number) => [number, number, number];
    readonly reticulumnode_lxmfOutboundPropagationStampRequest: (a: number, b: number, c: number) => [number, number, number];
    readonly reticulumnode_lxmfOutboundStampCost: (a: number, b: number, c: number) => [number, number, number];
    readonly reticulumnode_lxmfPropagationNodes: (a: number) => [number, number, number];
    readonly reticulumnode_lxmfPropagationStatus: (a: number) => [number, number, number];
    readonly reticulumnode_paperLxmfUri: (a: number, b: number) => [number, number, number, number];
    readonly reticulumnode_parseLxmfDeliveryAnnounce: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly reticulumnode_parseLxmfPropagationAnnounce: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly reticulumnode_prepareLxmfMessage: (a: number, b: any) => [number, number, number];
    readonly reticulumnode_requestLxmfMessages: (a: number, b: number, c: number) => [number, number, number];
    readonly reticulumnode_selectLxmfPropagationNode: (a: number, b: number, c: number) => [number, number, number];
    readonly reticulumnode_setLxmfIgnoredDestinations: (a: number, b: number, c: number) => [number, number, number];
    readonly reticulumnode_setLxmfInboundStampResult: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly reticulumnode_setLxmfOutboundPropagationStamp: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly reticulumnode_setLxmfOutboundPropagationStampResult: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly reticulumnode_setLxmfOutboundStamp: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly reticulumnode_setLxmfOutboundStampResult: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly reticulumnode_setLxmfPropagationNode: (a: number, b: number, c: number) => [number, number, number];
    readonly reticulumnode_validateLxmfStamp: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => any;
    readonly __wbg_reticulumnode_free: (a: number, b: number) => void;
    readonly reticulumnode_acceptResource: (a: number, b: number, c: number) => [number, number, number];
    readonly reticulumnode_activeLinkCount: (a: number) => number;
    readonly reticulumnode_addInterface: (a: number, b: any) => [number, number, number];
    readonly reticulumnode_announce: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly reticulumnode_clearDirtyPersistentState: (a: number) => void;
    readonly reticulumnode_closeLink: (a: number, b: number, c: number) => [number, number, number];
    readonly reticulumnode_connect: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly reticulumnode_deregisterRequestHandler: (a: number, b: number, c: number) => number;
    readonly reticulumnode_diagnosticDump: (a: number) => [number, number];
    readonly reticulumnode_dropPath: (a: number, b: number, c: number) => [number, number, number];
    readonly reticulumnode_exportIdentityPersistentState: (a: number) => [number, number, number];
    readonly reticulumnode_exportIdentityPrivateKey: (a: number) => [number, number, number, number];
    readonly reticulumnode_exportNetworkPersistentState: (a: number) => [number, number, number];
    readonly reticulumnode_exportPersistentState: (a: number) => [number, number, number];
    readonly reticulumnode_fullHash: (a: number, b: number) => [number, number];
    readonly reticulumnode_generateIdentity: () => [number, number, number];
    readonly reticulumnode_hasPath: (a: number, b: number, c: number) => [number, number, number];
    readonly reticulumnode_hashFromNameAndIdentity: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly reticulumnode_hopsTo: (a: number, b: number, c: number) => [number, number, number];
    readonly reticulumnode_identifyLink: (a: number, b: number, c: number) => [number, number, number];
    readonly reticulumnode_identityFromPrivateKey: (a: number, b: number) => [number, number, number];
    readonly reticulumnode_identityHash: (a: number) => [number, number];
    readonly reticulumnode_identityPublicKey: (a: number) => [number, number];
    readonly reticulumnode_linkStats: (a: number, b: number, c: number) => [number, number, number];
    readonly reticulumnode_memoryReport: (a: number) => any;
    readonly reticulumnode_new: (a: any) => [number, number, number];
    readonly reticulumnode_nextDeadlineMs: (a: number) => [number, bigint];
    readonly reticulumnode_pathCount: (a: number) => number;
    readonly reticulumnode_pendingLinkCount: (a: number) => number;
    readonly reticulumnode_receive: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly reticulumnode_registerDestination: (a: number, b: any) => [number, number, number, number];
    readonly reticulumnode_registerRequestHandler: (a: number, b: any) => [number, number];
    readonly reticulumnode_rejectLink: (a: number, b: number, c: number) => [number, number];
    readonly reticulumnode_rejectResource: (a: number, b: number, c: number) => [number, number, number];
    readonly reticulumnode_rememberIdentity: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly reticulumnode_requestPath: (a: number, b: number, c: number) => [number, number, number];
    readonly reticulumnode_sendDataProof: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly reticulumnode_sendOnLink: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly reticulumnode_sendPacketOnLink: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly reticulumnode_sendProof: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly reticulumnode_sendRequest: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: bigint) => [number, number, number];
    readonly reticulumnode_sendResource: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly reticulumnode_sendResponse: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly reticulumnode_sendResponseResource: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly reticulumnode_sendSinglePacket: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly reticulumnode_setInterfaceOnline: (a: number, b: number, c: number) => [number, number, number];
    readonly reticulumnode_sign: (a: number, b: number, c: number) => [number, number, number, number];
    readonly reticulumnode_tick: (a: number) => [number, number, number];
    readonly reticulumnode_transportedPacketCount: (a: number) => bigint;
    readonly reticulumnode_truncatedHash: (a: number, b: number) => [number, number];
    readonly reticulumnode_unregisterDestination: (a: number, b: number, c: number) => [number, number];
    readonly reticulumnode_validateSignature: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly start: () => void;
    readonly wasm_bindgen__convert__closures_____invoke__h708329bea8352ec0: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen__convert__closures_____invoke__h7f25ef40d1292e5c: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h0031a6302a7a92b7: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h90e1ddde9608ccfa: (a: number, b: number) => number;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
