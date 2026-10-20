package com.greenbiz.app;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle state) {
        registerPlugin(SessionVaultPlugin.class);
        registerPlugin(BusinessToolsPlugin.class);
        super.onCreate(state);
        ViewCompat.setOnApplyWindowInsetsListener(getBridge().getWebView(), (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return insets;
        });
    }
    @Override protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent); setIntent(intent);
        if (intent.getBooleanExtra("greenbizPayments", false) && getBridge() != null) {
            getBridge().triggerWindowJSEvent("greenbizPayment");
            // Handled here; left on the intent it would reopen the prompt at the next status() check.
            intent.removeExtra("greenbizPayments");
        }
    }
}
