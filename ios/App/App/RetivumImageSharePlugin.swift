import Capacitor
import Photos
import UIKit

@objc(RetivumImageSharePlugin)
final class RetivumImageSharePlugin: CAPInstancePlugin, CAPBridgedPlugin {
    let identifier = "RetivumImageSharePlugin"
    let jsName = "RetivumImageShare"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "shareImage", returnType: CAPPluginReturnPromise)
    ]

    @objc func shareImage(_ call: CAPPluginCall) {
        guard let base64Data = call.getString("data"),
              let data = Data(base64Encoded: base64Data) else {
            call.reject("The supplied image data is invalid", "INVALID_IMAGE_DATA")
            return
        }
        guard let image = UIImage(data: data) else {
            call.reject("The supplied image encoding is not supported by iOS", "UNSUPPORTED_IMAGE_ENCODING")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self, let viewController = self.bridge?.viewController else {
                call.reject("The image share view is unavailable", "IMAGE_SHARE_UNAVAILABLE")
                return
            }
            guard viewController.presentedViewController == nil else {
                call.reject("Another native view is already open", "IMAGE_SHARE_BUSY")
                return
            }

            let actionController = UIAlertController(
                title: nil,
                message: nil,
                preferredStyle: .actionSheet
            )
            actionController.addAction(UIAlertAction(
                title: call.getString("saveLabel") ?? NSLocalizedString(
                    "imageShare.save",
                    value: "Save Image",
                    comment: "Save a received image to the photo library"
                ),
                style: .default
            ) { _ in
                self.saveImage(image, call: call)
            })
            actionController.addAction(UIAlertAction(
                title: call.getString("shareLabel") ?? NSLocalizedString(
                    "imageShare.share",
                    value: "Share…",
                    comment: "Open the system share sheet for a received image"
                ),
                style: .default
            ) { _ in
                DispatchQueue.main.async {
                    self.presentShareSheet(image, from: viewController, call: call)
                }
            })
            actionController.addAction(UIAlertAction(
                title: call.getString("cancelLabel")
                    ?? NSLocalizedString("common.cancel", value: "Cancel", comment: "Cancel an action"),
                style: .cancel
            ) { _ in
                call.resolve(["activityType": "", "completed": false])
            })
            self.setCenteredPopover(actionController)
            viewController.present(actionController, animated: true)
        }
    }

    private func saveImage(_ image: UIImage, call: CAPPluginCall) {
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            guard status == .authorized || status == .limited else {
                call.reject("Photo library access was not granted", "PHOTO_LIBRARY_PERMISSION_DENIED")
                return
            }
            PHPhotoLibrary.shared().performChanges {
                PHAssetChangeRequest.creationRequestForAsset(from: image)
            } completionHandler: { saved, error in
                if let error {
                    call.reject("The image could not be saved", "IMAGE_SAVE_FAILED", error)
                    return
                }
                guard saved else {
                    call.reject("The image could not be saved", "IMAGE_SAVE_FAILED")
                    return
                }
                call.resolve(["activityType": "save-image", "completed": true])
            }
        }
    }

    private func presentShareSheet(
        _ image: UIImage,
        from viewController: UIViewController,
        call: CAPPluginCall
    ) {
        guard viewController.presentedViewController == nil else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                self.presentShareSheet(image, from: viewController, call: call)
            }
            return
        }
        let activityController = UIActivityViewController(activityItems: [image], applicationActivities: nil)
        setCenteredPopover(activityController)
        activityController.completionWithItemsHandler = { activityType, completed, _, error in
            if let error {
                call.reject("The image could not be shared", nil, error)
                return
            }
            call.resolve([
                "activityType": activityType?.rawValue ?? "",
                "completed": completed
            ])
        }
        viewController.present(activityController, animated: true)
    }
}
