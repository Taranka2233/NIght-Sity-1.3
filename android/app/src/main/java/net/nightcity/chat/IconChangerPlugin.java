package net.nightcity.chat;

import android.content.ComponentName;
import android.content.pm.PackageManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "IconChanger")
public class IconChangerPlugin extends Plugin {
    private static final String[] ALL = {"Icon01","Icon02","Icon03","Icon04","Icon05","Icon06","Icon07","Icon08","Icon09","Icon10"};

    @PluginMethod
    public void setIcon(PluginCall call) {
        String icon = call.getString("icon");
        if (icon == null) { call.reject("icon required"); return; }
        PackageManager pm = getContext().getPackageManager();
        String pkg = getContext().getPackageName();
        for (String a : ALL) {
            int state = a.equals(icon)
                ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                : PackageManager.COMPONENT_ENABLED_STATE_DISABLED;
            pm.setComponentEnabledSetting(new ComponentName(pkg, pkg + "." + a), state, PackageManager.DONT_KILL_APP);
        }
        call.resolve();
    }
}
