package de.nilu96.retivum;

import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.view.Window;
import android.webkit.WebView;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "RetivumAppearance")
public class RetivumAppearancePlugin extends Plugin {
    @PluginMethod
    public void setBackgroundColor(PluginCall call) {
        String value = call.getString("color");
        if (value == null || !value.matches("^#[0-9a-fA-F]{6}$")) {
            call.reject("The supplied background color is invalid", "INVALID_BACKGROUND_COLOR");
            return;
        }
        int color = Color.parseColor(value);

        getBridge().executeOnMainThread(() -> {
            WebView webView = getBridge().getWebView();
            Window window = getActivity().getWindow();
            webView.setBackgroundColor(color);
            window.getDecorView().setBackgroundColor(color);
            window.setBackgroundDrawable(new ColorDrawable(color));
            call.resolve();
        });
    }
}
