package de.nilu96.retivum;

import android.Manifest;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

@CapacitorPlugin(
    name = "RetivumImageShare",
    permissions = {
        @Permission(alias = RetivumImageSharePlugin.LEGACY_STORAGE_PERMISSION, strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE })
    }
)
public class RetivumImageSharePlugin extends Plugin {
    static final String LEGACY_STORAGE_PERMISSION = "legacyStorage";

    @PluginMethod
    public void shareImage(PluginCall call) {
        byte[] data = decodeImage(call);
        if (data == null) return;

        getBridge().executeOnMainThread(() -> {
            CharSequence[] actions = {
                getContext().getString(R.string.image_share_save),
                getContext().getString(R.string.image_share_share)
            };
            AlertDialog dialog = new AlertDialog.Builder(getActivity())
                .setItems(actions, (ignored, selected) -> {
                    if (selected == 0) {
                        requestSave(call);
                    } else {
                        shareImage(call, data);
                    }
                })
                .setNegativeButton(R.string.image_share_cancel, (ignored, selected) -> resolve(call, "", false))
                .setOnCancelListener(ignored -> resolve(call, "", false))
                .create();
            dialog.show();
        });
    }

    private byte[] decodeImage(PluginCall call) {
        String encoded = call.getString("data");
        String mimeType = normalizedMimeType(call);
        if (encoded == null) {
            call.reject("The supplied image data is invalid", "INVALID_IMAGE_DATA");
            return null;
        }
        if (!mimeType.startsWith("image/")) {
            call.reject("The supplied media type is not an image", "INVALID_IMAGE_TYPE");
            return null;
        }
        try {
            byte[] data = Base64.decode(encoded, Base64.DEFAULT);
            if (data.length == 0) {
                call.reject("The supplied image data is empty", "INVALID_IMAGE_DATA");
                return null;
            }
            return data;
        } catch (IllegalArgumentException error) {
            call.reject("The supplied image data is invalid", "INVALID_IMAGE_DATA", error);
            return null;
        }
    }

    private void requestSave(PluginCall call) {
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P && getPermissionState(LEGACY_STORAGE_PERMISSION) != PermissionState.GRANTED) {
            requestPermissionForAlias(LEGACY_STORAGE_PERMISSION, call, "legacyStoragePermissionCallback");
            return;
        }
        saveImage(call);
    }

    @PermissionCallback
    private void legacyStoragePermissionCallback(PluginCall call) {
        if (getPermissionState(LEGACY_STORAGE_PERMISSION) != PermissionState.GRANTED) {
            call.reject("Storage access was not granted", "STORAGE_PERMISSION_DENIED");
            return;
        }
        saveImage(call);
    }

    private void saveImage(PluginCall call) {
        byte[] data = decodeImage(call);
        if (data == null) return;
        execute(() -> {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    saveWithMediaStore(data, safeName(call), normalizedMimeType(call));
                } else {
                    saveLegacy(data, safeName(call), normalizedMimeType(call));
                }
                resolve(call, "save-image", true);
            } catch (Exception error) {
                call.reject("The image could not be saved", "IMAGE_SAVE_FAILED", error);
            }
        });
    }

    private void saveWithMediaStore(byte[] data, String name, String mimeType) throws IOException {
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, name);
        values.put(MediaStore.Images.Media.MIME_TYPE, mimeType);
        values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Retivum");
        values.put(MediaStore.Images.Media.IS_PENDING, 1);
        Uri uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
        if (uri == null) throw new IOException("Android did not create a gallery entry");

        boolean published = false;
        try {
            try (OutputStream output = resolver.openOutputStream(uri)) {
                if (output == null) throw new IOException("Android did not open the gallery entry");
                output.write(data);
            }
            values.clear();
            values.put(MediaStore.Images.Media.IS_PENDING, 0);
            if (resolver.update(uri, values, null, null) != 1) {
                throw new IOException("Android did not publish the gallery entry");
            }
            published = true;
        } finally {
            if (!published) resolver.delete(uri, null, null);
        }
    }

    @SuppressWarnings("deprecation")
    private void saveLegacy(byte[] data, String name, String mimeType) throws IOException {
        File directory = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "Retivum");
        if (!directory.exists() && !directory.mkdirs()) throw new IOException("The Retivum image directory could not be created");
        File image = uniqueFile(directory, name);
        try (OutputStream output = new FileOutputStream(image)) {
            output.write(data);
        }
        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, image.getName());
        values.put(MediaStore.Images.Media.MIME_TYPE, mimeType);
        values.put(MediaStore.Images.Media.DATA, image.getAbsolutePath());
        if (getContext().getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) == null) {
            if (!image.delete()) image.deleteOnExit();
            throw new IOException("Android did not publish the gallery entry");
        }
    }

    private void shareImage(PluginCall call, byte[] data) {
        execute(() -> {
            try {
                File directory = new File(getContext().getCacheDir(), "retivum-share");
                if (!directory.exists() && !directory.mkdirs()) throw new IOException("The share cache could not be created");
                File image = new File(directory, System.currentTimeMillis() + "-" + safeName(call));
                try (OutputStream output = new FileOutputStream(image)) {
                    output.write(data);
                }
                Uri uri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    image
                );
                Intent share = new Intent(Intent.ACTION_SEND);
                share.setType(normalizedMimeType(call));
                share.putExtra(Intent.EXTRA_STREAM, uri);
                share.setClipData(ClipData.newRawUri("", uri));
                share.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                Intent chooser = Intent.createChooser(share, getContext().getString(R.string.image_share_chooser_title));
                getBridge().executeOnMainThread(() -> {
                    getActivity().startActivity(chooser);
                    resolve(call, "share", true);
                });
            } catch (Exception error) {
                call.reject("The image could not be shared", "IMAGE_SHARE_FAILED", error);
            }
        });
    }

    private String safeName(PluginCall call) {
        String name = call.getString("name", "image");
        String safe = name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_");
        return safe.isEmpty() ? "image" : safe;
    }

    private String normalizedMimeType(PluginCall call) {
        String mimeType = call.getString("mimeType", "image/*");
        return mimeType == null ? "image/*" : mimeType.trim().toLowerCase();
    }

    private File uniqueFile(File directory, String name) {
        File candidate = new File(directory, name);
        if (!candidate.exists()) return candidate;
        int dot = name.lastIndexOf('.');
        String base = dot > 0 ? name.substring(0, dot) : name;
        String extension = dot > 0 ? name.substring(dot) : "";
        int suffix = 2;
        while (candidate.exists()) {
            candidate = new File(directory, base + " (" + suffix++ + ")" + extension);
        }
        return candidate;
    }

    private void resolve(PluginCall call, String activityType, boolean completed) {
        JSObject result = new JSObject();
        result.put("activityType", activityType);
        result.put("completed", completed);
        call.resolve(result);
    }
}
