#!/usr/bin/env python3
"""Configure one FCM service and a lock-screen incoming-call Activity."""

from pathlib import Path
import glob
import re
import shutil
import sys


MAIN = Path("android/app/src/main")
main_activities = glob.glob("android/app/src/main/java/**/MainActivity.java", recursive=True)
if not main_activities:
    print("MainActivity.java not found", file=sys.stderr)
    sys.exit(1)

java_dir = Path(main_activities[0]).parent
package = str(java_dir).split("java/", 1)[1].replace("/", ".")

google_services = Path("google-services.json")
if google_services.exists():
    shutil.copyfile(google_services, Path("android/app/google-services.json"))

service_java = f'''package {package};

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

public class CallMessagingService extends com.capacitorjs.plugins.pushnotifications.MessagingService {{
    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {{
        super.onMessageReceived(remoteMessage);
        Map<String, String> data = remoteMessage.getData();
        if (data != null && "call".equals(data.get("type"))) showIncomingCall(data);
    }}

    private void showIncomingCall(Map<String, String> data) {{
        String callId = safe(data.get("callId"));
        if (callId.isEmpty()) return;
        String chatId = safe(data.get("chatId"));
        String fromName = safe(data.get("fromName"));
        String fromUid = safe(data.get("fromUid"));
        String callType = "video".equals(data.get("callType")) ? "video" : "audio";
        if (fromName.isEmpty()) fromName = "Абонент";

        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {{
            NotificationChannel channel = new NotificationChannel("calls", "Звонки", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("Входящие звонки");
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[]{{0, 500, 350, 500, 350, 500}});
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            manager.createNotificationChannel(channel);
        }}

        int notificationId = 1000 + (callId.hashCode() & 0x3fffffff) % 1_000_000;
        Intent fullIntent = new Intent(this, IncomingCallActivity.class)
                .putExtra("callId", callId)
                .putExtra("chatId", chatId)
                .putExtra("fromName", fromName)
                .putExtra("fromUid", fromUid)
                .putExtra("callType", callType)
                .putExtra("notificationId", notificationId)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent fullScreen = PendingIntent.getActivity(this, notificationId, fullIntent, flags);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, "calls")
                .setSmallIcon(android.R.drawable.sym_call_incoming)
                .setContentTitle(fromName)
                .setContentText("video".equals(callType) ? "Входящий видеозвонок" : "Входящий звонок")
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setContentIntent(fullScreen);

        boolean fullScreenAllowed = true;
        if (Build.VERSION.SDK_INT >= 34) fullScreenAllowed = manager.canUseFullScreenIntent();
        if (fullScreenAllowed) builder.setFullScreenIntent(fullScreen, true);
        manager.notify(notificationId, builder.build());
    }}

    private static String safe(String value) {{ return value == null ? "" : value; }}
}}
'''

activity_java = f'''package {package};

import android.app.Activity;
import android.app.KeyguardManager;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

public class IncomingCallActivity extends Activity {{
    private String callId = "";
    private int notificationId = 0;

    @Override
    protected void onCreate(Bundle state) {{
        super.onCreate(state);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {{
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager manager = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            if (manager != null) manager.requestDismissKeyguard(this, null);
        }} else {{
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON |
                    WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON |
                    WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);
        }}

        callId = safe(getIntent().getStringExtra("callId"));
        notificationId = getIntent().getIntExtra("notificationId", 0);
        if (callId.isEmpty()) {{ finish(); return; }}
        String fromName = safe(getIntent().getStringExtra("fromName"));
        String callType = safe(getIntent().getStringExtra("callType"));
        if (fromName.isEmpty()) fromName = "Абонент";

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setPadding(48, 96, 48, 96);
        root.setBackgroundColor(Color.parseColor("#0a0a0f"));

        TextView title = new TextView(this);
        title.setText("video".equals(callType) ? "Входящий видеозвонок" : "Входящий звонок");
        title.setTextColor(Color.parseColor("#00f0ff"));
        title.setTextSize(16);
        title.setGravity(Gravity.CENTER);
        root.addView(title);

        TextView name = new TextView(this);
        name.setText(fromName);
        name.setTextColor(Color.WHITE);
        name.setTextSize(34);
        name.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams nameParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        nameParams.setMargins(0, 40, 0, 140);
        name.setLayoutParams(nameParams);
        root.addView(name);

        LinearLayout buttons = new LinearLayout(this);
        buttons.setOrientation(LinearLayout.HORIZONTAL);
        buttons.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        buttonParams.setMargins(24, 0, 24, 0);

        Button decline = new Button(this);
        decline.setText("Отклонить");
        decline.setTextColor(Color.WHITE);
        decline.setBackgroundColor(Color.parseColor("#ff003c"));
        decline.setOnClickListener(view -> openApp("decline"));

        Button accept = new Button(this);
        accept.setText("Принять");
        accept.setTextColor(Color.BLACK);
        accept.setBackgroundColor(Color.parseColor("#3aff8f"));
        accept.setOnClickListener(view -> openApp("accept"));

        buttons.addView(decline, buttonParams);
        buttons.addView(accept, buttonParams);
        root.addView(buttons);
        setContentView(root);
    }}

    private void openApp(String action) {{
        cancelNotification();
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launch != null) {{
            Uri uri = new Uri.Builder().scheme("nightcity").authority(action).appendQueryParameter("callId", callId).build();
            launch.setData(uri);
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            startActivity(launch);
        }}
        finish();
    }}

    private void cancelNotification() {{
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null && notificationId != 0) manager.cancel(notificationId);
    }}

    private static String safe(String value) {{ return value == null ? "" : value; }}
}}
'''

(java_dir / "CallMessagingService.java").write_text(service_java, encoding="utf-8")
(java_dir / "IncomingCallActivity.java").write_text(activity_java, encoding="utf-8")

manifest_path = MAIN / "AndroidManifest.xml"
manifest = manifest_path.read_text(encoding="utf-8")
if "xmlns:tools" not in manifest:
    manifest = manifest.replace(
        '<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
        '<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools">',
        1,
    )

permissions = [
    "android.permission.RECORD_AUDIO",
    "android.permission.MODIFY_AUDIO_SETTINGS",
    "android.permission.CAMERA",
    "android.permission.POST_NOTIFICATIONS",
    "android.permission.READ_CONTACTS",
    "android.permission.ACCESS_COARSE_LOCATION",
    "android.permission.ACCESS_FINE_LOCATION",
    "android.permission.USE_FULL_SCREEN_INTENT",
    "android.permission.WAKE_LOCK",
    "android.permission.VIBRATE",
]
permission_xml = "".join(
    f'    <uses-permission android:name="{permission}" />\n'
    for permission in permissions if permission not in manifest
)
if permission_xml:
    manifest = manifest.replace("    <application", permission_xml + "    <application", 1)

for feature in ["android.hardware.camera", "android.hardware.microphone"]:
    if feature not in manifest:
        manifest = manifest.replace("    <application", f'    <uses-feature android:name="{feature}" android:required="false" />\n    <application', 1)

services = '''        <service
            android:name="com.capacitorjs.plugins.pushnotifications.MessagingService"
            tools:node="remove" />
        <service
            android:name=".CallMessagingService"
            android:exported="false">
            <intent-filter>
                <action android:name="com.google.firebase.MESSAGING_EVENT" />
            </intent-filter>
        </service>
        <activity
            android:name=".IncomingCallActivity"
            android:exported="false"
            android:showWhenLocked="true"
            android:turnScreenOn="true"
            android:excludeFromRecents="true"
            android:launchMode="singleTask"
            android:theme="@android:style/Theme.Material.NoActionBar" />
'''
# Always converge old generated manifests to the secure definitions above.
manifest = re.sub(r'\s*<service\b(?=[^>]*android:name="\.CallMessagingService")[\s\S]*?</service>', '', manifest)
manifest = re.sub(r'\s*<service\b(?=[^>]*android:name="com\.capacitorjs\.plugins\.pushnotifications\.MessagingService")[^>]*/>', '', manifest)
manifest = re.sub(r'\s*<activity\b(?=[^>]*android:name="\.IncomingCallActivity")[^>]*/>', '', manifest)
manifest = manifest.replace("    </application>", services + "    </application>", 1)
manifest = re.sub(r'android:allowBackup="true"', 'android:allowBackup="false"', manifest, count=1)
if "android:usesCleartextTraffic" not in manifest:
    manifest = manifest.replace("android:allowBackup=\"false\"", "android:allowBackup=\"false\"\n        android:usesCleartextTraffic=\"false\"", 1)
manifest_path.write_text(manifest, encoding="utf-8")

gradle_path = Path("android/app/build.gradle")
gradle = gradle_path.read_text(encoding="utf-8")
gradle = re.sub(r'versionCode\s+\d+', 'versionCode 2077207', gradle, count=1)
gradle = re.sub(r'versionName\s+"[^"]+"', 'versionName "2.077.207"', gradle, count=1)
gradle = gradle.replace(
    'implementation "com.google.firebase:firebase-messaging:$firebaseMessagingVersion"',
    'implementation "com.google.firebase:firebase-messaging:25.0.1"',
)
if 'firebase-messaging:25.0.1' not in gradle:
    gradle = re.sub(
        r"(dependencies\s*\{)",
        r'\1\n    implementation "com.google.firebase:firebase-messaging:25.0.1"',
        gradle,
        count=1,
    )
gradle_path.write_text(gradle, encoding="utf-8")

print(f"Native incoming calls configured for {package}")
