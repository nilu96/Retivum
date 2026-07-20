import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const pluginRoot = join(process.cwd(), 'node_modules', 'capacitor-udp-socket');
const swiftPluginPath = join(pluginRoot, 'ios', 'Plugin', 'UdpSocketPlugin.swift');
const packageManifestPath = join(pluginRoot, 'Package.swift');

const packageManifest = `// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CapacitorUdpSocket",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "CapacitorUdpSocket", targets: ["CapacitorUdpSocketPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0"),
        .package(url: "https://github.com/robbiehanson/CocoaAsyncSocket.git", from: "7.6.5")
    ],
    targets: [
        .target(
            name: "CapacitorUdpSocketPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "CocoaAsyncSocket", package: "CocoaAsyncSocket")
            ],
            path: "ios/Plugin",
            exclude: ["Info.plist", "UdpSocketPlugin.h", "UdpSocketPlugin.m"]
        )
    ]
)
`;

const bridgeDeclaration = `public class UdpSocketPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "UdpSocketPlugin"
    public let jsName = "UdpSocket"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "create", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "bind", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "send", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sendBatch", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "closeAllSockets", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setPaused", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getInfo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getSockets", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setBroadcast", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "joinGroup", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "leaveGroup", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getJoinedGroups", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setMulticastTimeToLive", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setMulticastLoopbackMode", returnType: CAPPluginReturnPromise)
    ]`;

let swiftPlugin = await readFile(swiftPluginPath, 'utf8');
if (!swiftPlugin.includes('CAPBridgedPlugin')) {
  const marker = 'public class UdpSocketPlugin: CAPPlugin {';
  if (!swiftPlugin.includes(marker)) throw new Error('UDP_PLUGIN_SWIFT_BRIDGE_MARKER_NOT_FOUND');
  swiftPlugin = swiftPlugin.replace(marker, bridgeDeclaration);
}

if (!swiftPlugin.includes('CAPPluginMethod(name: "sendBatch"')) {
  const marker = '        CAPPluginMethod(name: "send", returnType: CAPPluginReturnPromise),';
  if (!swiftPlugin.includes(marker)) throw new Error('UDP_PLUGIN_SEND_METHOD_MARKER_NOT_FOUND');
  swiftPlugin = swiftPlugin.replace(
    marker,
    `${marker}\n        CAPPluginMethod(name: "sendBatch", returnType: CAPPluginReturnPromise),`,
  );
}

if (!swiftPlugin.includes('private let receiveBatchQueue')) {
  const marker = '    private var nextSocketId: Int = 0';
  if (!swiftPlugin.includes(marker)) throw new Error('UDP_PLUGIN_SOCKET_STATE_MARKER_NOT_FOUND');
  swiftPlugin = swiftPlugin.replace(marker, `${marker}
    private let receiveBatchQueue = DispatchQueue(label: "de.nilu96.retivum.udp.receive", qos: .userInitiated)
    private var receiveBatch: [[String: Any]] = []
    private var receiveBatchScheduled = false
    private let receiveBatchLimit = 32`);
}

const receiveHandler = `        socket.onReceivedHandler = { data in
            self.notifyListeners("receive", data: data, retainUntilConsumed: false)
        }`;
if (swiftPlugin.includes(receiveHandler)) {
  swiftPlugin = swiftPlugin.replace(receiveHandler, `        socket.onReceivedHandler = { data in
            self.enqueueReceivedPacket(data)
        }`);
}

const receiveErrorHandler = `        socket.onReceivedErrorHandler = { data in
            self.notifyListeners("receiveError", data: data, retainUntilConsumed: false)
        }`;
if (swiftPlugin.includes(receiveErrorHandler)) {
  swiftPlugin = swiftPlugin.replace(receiveErrorHandler, `        socket.onReceivedErrorHandler = { data in
            DispatchQueue.main.async {
                self.notifyListeners("receiveError", data: data, retainUntilConsumed: false)
            }
        }`);
}

if (!swiftPlugin.includes('@objc func sendBatch(')) {
  const marker = '    @objc func close(_ call: CAPPluginCall) {';
  if (!swiftPlugin.includes(marker)) throw new Error('UDP_PLUGIN_CLOSE_METHOD_MARKER_NOT_FOUND');
  const sendBatch = `    @objc func sendBatch(_ call: CAPPluginCall) {
        guard let socketId = call.getInt("socketId"), let socket = sockets[socketId] else {
            call.reject("Socket not found")
            return
        }
        guard let port = call.getInt("port"),
              let buffers = call.getArray("buffers", String.self),
              !buffers.isEmpty else {
            call.reject("Invalid batch")
            return
        }

        let address = call.getString("address", "")
        var bytesSent = 0
        do {
            for encoded in buffers {
                let data = Data(base64Encoded: encoded, options: .ignoreUnknownCharacters) ?? Data()
                try socket.send(data, address: address, port: port)
                bytesSent += data.count
            }
            call.resolve(["bytesSent": bytesSent, "packetsSent": buffers.count])
        } catch let SocketsError.Error(msg) {
            call.reject(msg)
        } catch {
            call.reject("batch send error")
        }
    }

`;
  swiftPlugin = swiftPlugin.replace(marker, sendBatch + marker);
}

if (!swiftPlugin.includes('private func enqueueReceivedPacket')) {
  const marker = '    private func handleUdpForward(_ notification: Notification) {';
  if (!swiftPlugin.includes(marker)) throw new Error('UDP_PLUGIN_FORWARD_METHOD_MARKER_NOT_FOUND');
  const receiveBatching = `    private func enqueueReceivedPacket(_ packet: [String: Any]) {
        receiveBatchQueue.async {
            self.receiveBatch.append(packet)
            if self.receiveBatch.count >= self.receiveBatchLimit {
                self.flushReceivedPackets()
            } else if !self.receiveBatchScheduled {
                self.receiveBatchScheduled = true
                self.receiveBatchQueue.asyncAfter(deadline: .now() + .milliseconds(2)) {
                    self.flushReceivedPackets()
                }
            }
        }
    }

    private func flushReceivedPackets() {
        guard !receiveBatch.isEmpty else {
            receiveBatchScheduled = false
            return
        }
        let packets = receiveBatch
        receiveBatch.removeAll(keepingCapacity: true)
        receiveBatchScheduled = false
        DispatchQueue.main.async {
            self.notifyListeners("receiveBatch", data: ["packets": packets], retainUntilConsumed: false)
        }
    }

`;
  swiftPlugin = swiftPlugin.replace(marker, receiveBatching + marker);
}

await writeFile(swiftPluginPath, swiftPlugin);

const udpSocketPath = join(pluginRoot, 'ios', 'Plugin', 'UdpSocket.swift');
let udpSocket = await readFile(udpSocketPath, 'utf8');
const mainDelegateQueue = 'self.socket = GCDAsyncUdpSocket.init(delegate: self, delegateQueue: DispatchQueue.main)';
if (udpSocket.includes(mainDelegateQueue)) {
  udpSocket = udpSocket.replace(
    mainDelegateQueue,
    'self.socket = GCDAsyncUdpSocket.init(delegate: self, delegateQueue: DispatchQueue(label: "de.nilu96.retivum.udp.socket", qos: .userInitiated))',
  );
  await writeFile(udpSocketPath, udpSocket);
}

await writeFile(packageManifestPath, packageManifest);
