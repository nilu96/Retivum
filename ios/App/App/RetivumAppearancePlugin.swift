import Capacitor
import UIKit

@objc(RetivumAppearancePlugin)
final class RetivumAppearancePlugin: CAPInstancePlugin, CAPBridgedPlugin {
    let identifier = "RetivumAppearancePlugin"
    let jsName = "RetivumAppearance"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setBackgroundColor", returnType: CAPPluginReturnPromise)
    ]

    @objc func setBackgroundColor(_ call: CAPPluginCall) {
        guard let value = call.getString("color"),
              value.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil,
              let color = UIColor.capacitor.color(fromHex: value) else {
            call.reject("The supplied background color is invalid", "INVALID_BACKGROUND_COLOR")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self, let webView = self.bridge?.webView else {
                call.reject("The native appearance view is unavailable", "APPEARANCE_VIEW_UNAVAILABLE")
                return
            }
            webView.backgroundColor = color
            webView.scrollView.backgroundColor = color
            webView.underPageBackgroundColor = color
            self.bridge?.viewController?.view.backgroundColor = color
            self.bridge?.viewController?.view.window?.backgroundColor = color
            call.resolve()
        }
    }
}
