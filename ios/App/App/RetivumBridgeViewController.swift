import Capacitor

final class RetivumBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        webView?.allowsBackForwardNavigationGestures = true
        webView?.underPageBackgroundColor = webView?.backgroundColor
        bridge?.registerPluginInstance(RetivumAppearancePlugin())
        bridge?.registerPluginInstance(RetivumImageSharePlugin())
    }
}
