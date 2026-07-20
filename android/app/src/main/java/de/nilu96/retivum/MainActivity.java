package de.nilu96.retivum;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RetivumImageSharePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
