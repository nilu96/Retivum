// swift-tools-version: 5.9
import PackageDescription

// DO NOT MODIFY THIS FILE - managed by Capacitor CLI commands
let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapApp-SPM",
            targets: ["CapApp-SPM"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.4.2"),
        .package(name: "CapacitorCommunityKeepAwake", path: "../../../node_modules/@capacitor-community/keep-awake"),
        .package(name: "CapacitorApp", path: "../../../node_modules/@capacitor/app"),
        .package(name: "CapacitorFilesystem", path: "../../../node_modules/@capacitor/filesystem"),
        .package(name: "CapacitorScreenOrientation", path: "../../../node_modules/@capacitor/screen-orientation"),
        .package(name: "CapacitorShare", path: "../../../node_modules/@capacitor/share"),
        .package(name: "CapgoCapacitorBluetoothLowEnergy", path: "../../../node_modules/@capgo/capacitor-bluetooth-low-energy"),
        .package(name: "DevioartsCapacitorTcpclient", path: "../../../node_modules/@devioarts/capacitor-tcpclient"),
        .package(name: "CapacitorUdpSocket", path: "../../../node_modules/capacitor-udp-socket")
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "CapacitorCommunityKeepAwake", package: "CapacitorCommunityKeepAwake"),
                .product(name: "CapacitorApp", package: "CapacitorApp"),
                .product(name: "CapacitorFilesystem", package: "CapacitorFilesystem"),
                .product(name: "CapacitorScreenOrientation", package: "CapacitorScreenOrientation"),
                .product(name: "CapacitorShare", package: "CapacitorShare"),
                .product(name: "CapgoCapacitorBluetoothLowEnergy", package: "CapgoCapacitorBluetoothLowEnergy"),
                .product(name: "DevioartsCapacitorTcpclient", package: "DevioartsCapacitorTcpclient"),
                .product(name: "CapacitorUdpSocket", package: "CapacitorUdpSocket")
            ]
        )
    ]
)
