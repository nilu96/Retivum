import Capacitor

final class RetivumBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(RetivumImageSharePlugin())
    }
}
