package net.nightcity.chat;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(IconChangerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
